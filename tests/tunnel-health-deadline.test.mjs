import http from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TunnelSupervisor } from "../electron/services/tunnel-supervisor.mjs";

const healthy = () => ({
  ok: true,
  status: 200,
  json: async () => ({
    components: {
      "control-plane": {
        status: "ok",
        details: { last_success: new Date().toISOString() },
      },
    },
  }),
});

function supervisorFor(fetchImpl) {
  const supervisor = new TunnelSupervisor({
    fetchImpl,
    healthRequestTimeoutMs: 50,
    healthCheckIntervalMs: 100,
    healthStartupGraceMs: 0,
    healthStaleAfterMs: 1_000,
  });
  supervisor.child = { pid: 123 };
  supervisor.activeGeneration = 1;
  supervisor.startedMonotonicAtMs = performance.now();
  supervisor.healthBaseUrl = "http://127.0.0.1:41000";
  return supervisor;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Tunnel health response deadline", () => {
  it("recovers from a real loopback response stalled after headers", async () => {
    let stalled = true;
    const server = http.createServer(async (request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      if (stalled && request.url.startsWith("/health?")) {
        response.flushHeaders();
        response.write('{"components":');
        return;
      }
      response.end(JSON.stringify(await healthy().json()));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const supervisor = supervisorFor(fetch);
    supervisor.healthBaseUrl = `http://127.0.0.1:${server.address().port}`;
    try {
      const failed = await supervisor.checkHealthNow();
      expect(failed.reachability).toMatchObject({
        state: "degraded",
        localReady: false,
        lastError: { code: "TUNNEL_HEALTH_TIMEOUT" },
      });
      stalled = false;
      expect((await supervisor.checkHealthNow()).reachability.state).toBe("ready");
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("bounds a stalled JSON body and permits the next healthy probe", async () => {
    vi.useFakeTimers();
    let stalled = true;
    const supervisor = supervisorFor(async (url) =>
      stalled && String(url).includes("/health?")
        ? { ok: true, status: 200, json: () => new Promise(() => {}) }
        : healthy(),
    );
    let result;
    const pending = supervisor.checkHealthNow().then((status) => { result = status; });
    await vi.advanceTimersByTimeAsync(51);
    expect(result?.reachability).toMatchObject({
      state: "degraded",
      localReady: false,
      consecutiveFailures: 1,
      lastError: { code: "TUNNEL_HEALTH_TIMEOUT" },
    });
    await pending;

    stalled = false;
    expect((await supervisor.checkHealthNow()).reachability).toMatchObject({
      state: "ready",
      localReady: true,
      consecutiveFailures: 0,
      lastError: null,
    });
  });

  it("uses one deadline for headers and body and dispatches stale recovery", async () => {
    vi.useFakeTimers();
    const supervisor = supervisorFor(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return {
        ok: true,
        status: 200,
        json: async () => {
          await new Promise((resolve) => setTimeout(resolve, 30));
          return (await healthy().json());
        },
      };
    });
    supervisor.startedMonotonicAtMs = performance.now() - 1_500;
    const recovery = vi.spyOn(supervisor, "recoverFromStale").mockImplementation(async (reason) => {
      supervisor.transitionReachability("recovering", reason);
      return supervisor.status();
    });
    let result;
    const pending = supervisor.checkHealthNow().then((status) => { result = status; });
    await vi.advanceTimersByTimeAsync(51);
    expect(recovery).toHaveBeenCalledExactlyOnceWith("health_probe_stale");
    expect(result?.reachability).toMatchObject({
      state: "recovering",
      localReady: false,
      lastError: { code: "TUNNEL_HEALTH_TIMEOUT" },
    });
    await pending;
    await vi.advanceTimersByTimeAsync(20);
    expect(supervisor.status().reachability.state).toBe("recovering");
  });

  it("does not write a body timeout into a replacement generation", async () => {
    vi.useFakeTimers();
    const supervisor = supervisorFor(async () => ({
      ok: true,
      status: 200,
      json: () => new Promise(() => {}),
    }));
    let completed = false;
    const pending = supervisor.checkHealthNow().then(() => { completed = true; });
    await vi.advanceTimersByTimeAsync(1);
    supervisor.child = { pid: 456 };
    supervisor.activeGeneration = 2;
    supervisor.resetHealthEvidenceForSpawn();
    await vi.advanceTimersByTimeAsync(50);
    expect(completed).toBe(true);
    await pending;
    expect(supervisor.status()).toMatchObject({
      pid: 456,
      generation: 2,
      reachability: { state: "starting", consecutiveFailures: 0, lastError: null },
    });
  });
});
