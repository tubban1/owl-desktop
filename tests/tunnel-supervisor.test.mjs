import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  TunnelSupervisor,
  classifyTunnelDiagnostic,
} from "../electron/services/tunnel-supervisor.mjs";

const scratch = [];
const supervisors = [];

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async json() {
      return payload;
    },
  };
}

function createLongRunningFakeTunnel(dir, name = "fake-tunnel") {
  const binary = path.join(dir, name);
  fs.writeFileSync(
    binary,
    [
      "#!/bin/sh",
      "trap 'exit 0' TERM INT",
      "while true; do sleep 1; done",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  return binary;
}

afterEach(async () => {
  for (const supervisor of supervisors.splice(0)) {
    await supervisor.stop().catch(() => undefined);
  }
  for (const dir of scratch.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("TunnelSupervisor", () => {
  it("does not treat every stderr diagnostic as a warning", () => {
    expect(classifyTunnelDiagnostic("connected to control plane")).toBe("info");
    expect(classifyTunnelDiagnostic("starting MCP transport")).toBe("info");
    expect(classifyTunnelDiagnostic("reconnecting websocket")).toBe("info");
    expect(classifyTunnelDiagnostic("warning: transient transport issue")).toBe("warn");
    expect(classifyTunnelDiagnostic("connection refused")).toBe("warn");
    expect(classifyTunnelDiagnostic("startup timeout")).toBe("warn");
  });
  it("spawns a loopback-only tunnel and removes the ephemeral secret on stop", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "owl-tunnel-test-"));
    scratch.push(dir);
    const binary = path.join(dir, "fake-tunnel");
    fs.writeFileSync(
      binary,
      [
        "#!/bin/sh",
        "trap 'exit 0' TERM INT",
        "while true; do sleep 1; done",
        "",
      ].join("\n"),
      { mode: 0o755 },
    );

    const supervisor = new TunnelSupervisor();
    supervisors.push(supervisor);
    const status = await supervisor.start({
      binaryPath: binary,
      tunnelId: "tunnel_test_123456",
      apiKey: "not-a-real-secret",
      mcpUrl: "http://127.0.0.1:8790/mcp",
    });

    expect(status.state).toBe("running");
    expect(status.pid).toBeTypeOf("number");
    expect(status.secretStorage).toBe("ephemeral-file-0600");
    expect(supervisor.secretFile).toBeTruthy();
    expect(fs.statSync(supervisor.secretFile).mode & 0o777).toBe(0o600);

    const secretPath = supervisor.secretFile;
    await supervisor.stop();
    expect(supervisor.status().state).toBe("stopped");
    expect(fs.existsSync(secretPath)).toBe(false);
  });


  it("automatically restarts after an unexpected tunnel exit", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "owl-tunnel-restart-test-"));
    scratch.push(dir);
    const binary = path.join(dir, "fake-tunnel");
    const counter = path.join(dir, "count");
    fs.writeFileSync(
      binary,
      [
        "#!/bin/sh",
        `COUNT_FILE=${JSON.stringify(counter)}`,
        "COUNT=0",
        "if [ -f \"$COUNT_FILE\" ]; then COUNT=$(cat \"$COUNT_FILE\"); fi",
        "COUNT=$((COUNT + 1))",
        "printf '%s' \"$COUNT\" > \"$COUNT_FILE\"",
        "if [ \"$COUNT\" -eq 1 ]; then exit 17; fi",
        "trap 'exit 0' TERM INT",
        "while true; do sleep 1; done",
        "",
      ].join("\n"),
      { mode: 0o755 },
    );

    const events = [];
    const supervisor = new TunnelSupervisor({
      restartBaseDelayMs: 20,
      restartMaxDelayMs: 40,
      onEvent(level, message, meta) {
        events.push({ level, message, meta });
      },
    });
    supervisors.push(supervisor);

    await supervisor.start({
      binaryPath: binary,
      tunnelId: "tunnel_restart_123456",
      apiKey: "not-a-real-secret",
      mcpUrl: "http://127.0.0.1:8790/mcp",
    });

    const deadline = Date.now() + 8_000;
    let observedCount = 0;
    while (Date.now() < deadline) {
      observedCount = fs.existsSync(counter)
        ? Number(fs.readFileSync(counter, "utf8"))
        : 0;
      if (observedCount >= 2 && supervisor.status().state === "running") break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    expect(observedCount).toBeGreaterThanOrEqual(2);
    expect(supervisor.status()).toMatchObject({
      state: "running",
      desiredRunning: true,
    });
    expect(
      events.some((event) => event.message === "Tunnel restart scheduled"),
    ).toBe(true);
  }, 15_000);

  it("bounds a tunnel health request even when fetch ignores AbortSignal", async () => {
    const supervisor = new TunnelSupervisor({
      fetchImpl: () => new Promise(() => {}),
      healthRequestTimeoutMs: 20,
      healthCheckIntervalMs: 60_000,
    });
    supervisors.push(supervisor);
    supervisor.child = { pid: 303 };
    supervisor.activeGeneration = 1;
    supervisor.generation = 1;
    supervisor.healthBaseUrl = "http://127.0.0.1:41000";
    supervisor.startedAt = new Date().toISOString();
    supervisor.startedMonotonicAtMs = supervisor.monotonicNow();

    await expect(supervisor.fetchHealth("/healthz")).rejects.toMatchObject({
      code: "TUNNEL_HEALTH_TIMEOUT",
    });

    supervisor.child = null;
    supervisor.activeGeneration = 0;
  });

  it("reports READY only from tunnel health and control-plane evidence", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "owl-tunnel-health-test-"));
    scratch.push(dir);
    const binary = createLongRunningFakeTunnel(dir);
    const now = new Date().toISOString();
    const fetchImpl = async (url) => {
      if (String(url).endsWith("/readyz")) {
        return jsonResponse(null);
      }
      if (String(url).includes("/health?details=true")) {
        return jsonResponse({
          live: true,
          ready: true,
          components: {
            "control-plane": {
              status: "ok",
              state: "idle",
              observed_at: now,
              details: {
                last_success: now,
                consecutive_failures: 0,
              },
            },
          },
        });
      }
      throw new Error(`Unexpected health URL: ${url}`);
    };

    const supervisor = new TunnelSupervisor({
      fetchImpl,
      healthCheckIntervalMs: 60_000,
    });
    supervisors.push(supervisor);
    await supervisor.start({
      binaryPath: binary,
      tunnelId: "tunnel_health_123456",
      apiKey: "not-a-real-secret",
      mcpUrl: "http://127.0.0.1:8790/mcp",
    });
    fs.writeFileSync(
      supervisor.healthUrlFile,
      "http://127.0.0.1:41001\n",
      "utf8",
    );

    const status = await supervisor.checkHealthNow();

    expect(status.reachability).toMatchObject({
      state: "ready",
      healthUrl: "http://127.0.0.1:41001",
      localReady: true,
      consecutiveFailures: 0,
      controlPlane: {
        status: "ok",
        state: "idle",
        lastSuccess: now,
      },
    });
    expect(status.reachability.lastHealthOkAt).toBeTruthy();
    expect(status.reachability.lastControlPlaneOkAt).toBe(now);
  });

  it("keeps local readiness and upstream reachability separate", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "owl-tunnel-degraded-test-"));
    scratch.push(dir);
    const binary = createLongRunningFakeTunnel(dir);
    const now = new Date().toISOString();
    const fetchImpl = async (url) => {
      if (String(url).endsWith("/readyz")) {
        return jsonResponse(null, { ok: false, status: 503 });
      }
      return jsonResponse({
        live: true,
        ready: false,
        components: {
          "control-plane": {
            status: "ok",
            state: "polling",
            observed_at: now,
            details: {
              last_success: now,
              consecutive_failures: 0,
            },
          },
        },
      });
    };

    const supervisor = new TunnelSupervisor({
      fetchImpl,
      healthStartupGraceMs: 0,
      healthCheckIntervalMs: 60_000,
    });
    supervisors.push(supervisor);
    await supervisor.start({
      binaryPath: binary,
      tunnelId: "tunnel_degraded_123456",
      apiKey: "not-a-real-secret",
      mcpUrl: "http://127.0.0.1:8790/mcp",
    });
    fs.writeFileSync(
      supervisor.healthUrlFile,
      "http://127.0.0.1:41002\n",
      "utf8",
    );

    const status = await supervisor.checkHealthNow();

    expect(status.reachability).toMatchObject({
      state: "degraded",
      localReady: false,
      controlPlane: {
        status: "ok",
        state: "polling",
      },
    });
    expect(status.state).toBe("running");
  });

  it("recovers a live tunnel process when control-plane evidence becomes stale", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "owl-tunnel-stale-test-"));
    scratch.push(dir);
    const binary = createLongRunningFakeTunnel(dir);
    const events = [];
    const oldSuccess = new Date(Date.now() - 10_000).toISOString();
    const fetchImpl = async (url) => {
      if (String(url).endsWith("/readyz")) {
        return jsonResponse(null, { ok: false, status: 503 });
      }
      return jsonResponse({
        live: true,
        ready: false,
        components: {
          "control-plane": {
            status: "degraded",
            state: "backoff",
            reason_code: "network",
            observed_at: new Date().toISOString(),
            details: {
              last_success: oldSuccess,
              last_error: new Date().toISOString(),
              consecutive_failures: 4,
              failure_category: "network",
            },
          },
        },
      });
    };

    let monotonicMs = 0;
    const supervisor = new TunnelSupervisor({
      fetchImpl,
      random: () => 0.5,
      monotonicNow: () => monotonicMs,
      restartBaseDelayMs: 5_000,
      restartMaxDelayMs: 5_000,
      healthCheckIntervalMs: 100,
      healthStartupGraceMs: 0,
      healthStaleAfterMs: 1_000,
      onEvent(level, message, meta) {
        events.push({ level, message, meta });
      },
    });
    supervisors.push(supervisor);
    await supervisor.start({
      binaryPath: binary,
      tunnelId: "tunnel_stale_123456",
      apiKey: "not-a-real-secret",
      mcpUrl: "http://127.0.0.1:8790/mcp",
    });
    fs.writeFileSync(
      supervisor.healthUrlFile,
      "http://127.0.0.1:41003\n",
      "utf8",
    );

    const firstStatus = await supervisor.checkHealthNow();
    expect(firstStatus.state).toBe("running");
    expect(firstStatus.reachability.state).toBe("degraded");

    monotonicMs = 1_500;
    const realDateNow = Date.now;
    Date.now = () => realDateNow() - 6 * 60 * 60 * 1000;
    let status;
    try {
      status = await supervisor.checkHealthNow();
    } finally {
      Date.now = realDateNow;
    }

    expect(status.state).toBe("restarting");
    expect(status.reachability.state).toBe("recovering");
    expect(status.restartAttempts).toBe(1);
    expect(
      events.some(
        (event) =>
          event.message === "Tunnel reachability recovery started" &&
          event.meta?.reason === "control_plane_stale",
      ),
    ).toBe(true);
  });

  it("ignores stale health results from a superseded tunnel generation", async () => {
    let releaseHealth;
    const healthPayload = new Promise((resolve) => {
      releaseHealth = resolve;
    });
    const supervisor = new TunnelSupervisor({
      fetchImpl: async (url) => {
        if (String(url).includes("/health?details=true")) {
          return {
            ok: true,
            status: 200,
            json: () => healthPayload,
          };
        }
        return jsonResponse(null);
      },
      healthCheckIntervalMs: 60_000,
    });
    supervisors.push(supervisor);

    const oldChild = { pid: 101 };
    const newChild = { pid: 202 };
    supervisor.child = oldChild;
    supervisor.activeGeneration = 1;
    supervisor.generation = 1;
    supervisor.startedAt = new Date().toISOString();
    supervisor.healthBaseUrl = "http://127.0.0.1:41004";
    supervisor.reachabilityState = "starting";

    const pending = supervisor.checkHealthNow();

    supervisor.child = newChild;
    supervisor.activeGeneration = 2;
    supervisor.generation = 2;
    supervisor.reachabilityState = "recovering";
    supervisor.lastHealthOkAt = null;
    releaseHealth({
      live: true,
      ready: true,
      components: {
        "control-plane": {
          status: "ok",
          state: "idle",
          observed_at: new Date().toISOString(),
          details: {
            last_success: new Date().toISOString(),
            consecutive_failures: 0,
          },
        },
      },
    });

    await pending;

    expect(supervisor.status()).toMatchObject({
      pid: 202,
      generation: 2,
      reachability: {
        state: "recovering",
        lastHealthOkAt: null,
      },
    });

    supervisor.child = null;
    supervisor.activeGeneration = 0;
  });

  it("refuses a non-loopback MCP target", async () => {
    const supervisor = new TunnelSupervisor();
    supervisors.push(supervisor);
    await expect(supervisor.start({
      binaryPath: process.execPath,
      tunnelId: "tunnel_test_123456",
      apiKey: "not-a-real-secret",
      mcpUrl: "https://example.com/mcp",
    })).rejects.toThrow("must be loopback");
  });
});
