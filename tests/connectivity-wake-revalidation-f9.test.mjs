import { describe, expect, it, vi } from "vitest";
import { CloudMcpCallConsumer } from "../connection-host/cloud-mcp-call-consumer.mjs";
import { recheckConnectivityAfterWake } from "../connection-host/recheck-after-wake.mjs";

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { resolve, promise };
}
describe("F9 wake-revalidation", () => {
  it("drops pre-sleep Ready and only restores it after a fresh successful Cloud poll", async () => {
    let online = true;
    const executor = {
      execute: vi.fn(),
      probe: vi.fn(async () => {}),
      snapshot: () => ({ lastProofAt: new Date().toISOString() }),
    };
    const consumer = new CloudMcpCallConsumer({
      cloudClient: { pullMcpCalls: async () => {
        if (!online) throw Object.assign(new Error("offline"), { code: "CLOUD_NETWORK_ERROR" });
        return { calls: [] };
      } },
      executor,
      pollIntervalMs: 60000,
    });
    await consumer.start();
    expect(consumer.snapshot().ready).toBe(true);
    online = false;
    consumer.markWakePending();
    expect(consumer.snapshot()).toMatchObject({ ready: false, lastError: { code: "CLOUD_WAKE_REVALIDATION_REQUIRED" } });
    expect((await consumer.revalidateAfterWake({ alreadyInvalidated: true })).ready).toBe(false);
    expect(executor.probe).toHaveBeenCalledTimes(1);
    // Cached initial proof, but wake forces a new executor probe.
    online = true;
    expect((await consumer.revalidateAfterWake()).ready).toBe(true);
    await consumer.stop();
  });

  it("ignores a stale in-flight successful poll from before wake", async () => {
    const previous = deferred();
    let calls = 0;
    const consumer = new CloudMcpCallConsumer({
      cloudClient: { pullMcpCalls: () => ++calls === 1 ? previous.promise : Promise.resolve({ calls: [] }) },
      executor: { execute: vi.fn(), snapshot: () => null },
      pollIntervalMs: 60000,
    });
    consumer.running = true;
    const old = consumer.tick();
    const wake = consumer.revalidateAfterWake();
    expect(consumer.snapshot().ready).toBe(false);
    previous.resolve({ calls: [] });
    const stale = await old;
    expect(stale.ready).toBe(false);
    expect(stale.lastError?.code).toBe("CLOUD_WAKE_PROOF_STALE");
    expect((await wake).ready).toBe(true);
    expect(calls).toBe(2);
    await consumer.stop();
  });

  it("invalidates Cloud and Tunnel before concurrently re-probing both", async () => {
    const t = deferred(), c = deferred();
    const states = { tunnel: "ready", cloud: "ready" };
    const result = recheckConnectivityAfterWake({
      tunnelSupervisor: {
        status: () => ({ desiredRunning: true }),
        markWakePending: () => { states.tunnel = "recovering"; },
        checkHealthNow: () => t.promise,
      },
      cloudMcpConsumer: {
        running: true,
        markWakePending: () => { states.cloud = "degraded"; },
        revalidateAfterWake: () => c.promise,
      },
    });
    expect(states).toEqual({ tunnel: "recovering", cloud: "degraded" });
    t.resolve({ reachability: { state: "ready" } });
    c.resolve({ state: "degraded", ready: false, lastError: { code: "CLOUD_TIMEOUT" } });
    expect(await result).toMatchObject({
      tunnel: { ready: true },
      cloudMcp: { ready: false, errorCode: "CLOUD_TIMEOUT" },
    });
  });
});
