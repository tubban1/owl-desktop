import { describe, expect, it, vi } from "vitest";
import { CloudMcpCallConsumer } from "../connection-host/cloud-mcp-call-consumer.mjs";

function call(id = "mcp_1") {
  return {
    callId: id,
    toolName: "runtime_info",
    arguments: {},
    status: "dispatched",
  };
}

describe("CloudMcpCallConsumer parity", () => {
  it("is single-flight and claims before execution", async () => {
    const order = [];
    const cloudClient = {
      pullMcpCalls: vi.fn(async () => ({ calls: [call()] })),
      claimMcpCall: vi.fn(async () => {
        order.push("claim");
        return { ...call(), status: "executing" };
      }),
      completeMcpCall: vi.fn(async () => {
        order.push("complete");
        return { ...call(), status: "completed" };
      }),
    };
    const executor = {
      execute: vi.fn(async () => {
        order.push("execute");
        return { content: [{ type: "text", text: "ok" }] };
      }),
      snapshot: () => ({ lastProofAt: "now" }),
    };
    const consumer = new CloudMcpCallConsumer({
      cloudClient,
      executor,
      claimantId: "host-a",
      pollIntervalMs: 60_000,
    });
    await consumer.start();
    expect(order).toEqual(["claim", "execute", "complete"]);
    expect(consumer.snapshot()).toMatchObject({
      state: "ready",
      ready: true,
      processed: 1,
    });
    await consumer.stop();
  });

  it("skips a call already claimed by another connector", async () => {
    const conflict = Object.assign(new Error("claimed"), {
      code: "CONFLICT",
      status: 409,
    });
    const cloudClient = {
      pullMcpCalls: vi.fn(async () => ({ calls: [call()] })),
      claimMcpCall: vi.fn(async () => {
        throw conflict;
      }),
      completeMcpCall: vi.fn(),
    };
    const executor = { execute: vi.fn(), snapshot: () => null };
    const consumer = new CloudMcpCallConsumer({
      cloudClient,
      executor,
      pollIntervalMs: 60_000,
    });
    await consumer.start();
    expect(executor.execute).not.toHaveBeenCalled();
    expect(cloudClient.completeMcpCall).not.toHaveBeenCalled();
    await consumer.stop();
  });

  it("never converts a successful execution into a failed completion when persistence is transiently unavailable", async () => {
    let completionAttempts = 0;
    const cloudClient = {
      pullMcpCalls: vi.fn(async () => ({ calls: [call()] })),
      claimMcpCall: vi.fn(async () => ({ ...call(), status: "executing" })),
      completeMcpCall: vi.fn(async (_id, payload) => {
        completionAttempts += 1;
        if (completionAttempts === 1) {
          const error = Object.assign(new Error("network down"), {
            code: "CLOUD_NETWORK_ERROR",
          });
          throw error;
        }
        return { ...call(), status: "completed", result: payload.result };
      }),
    };
    const sideEffects = new Set();
    const executor = {
      execute: vi.fn(async ({ callId }) => {
        sideEffects.add(callId);
        return { content: [{ type: "text", text: "same-result" }] };
      }),
      snapshot: () => null,
    };
    const consumer = new CloudMcpCallConsumer({
      cloudClient,
      executor,
      claimantId: "host-a",
      pollIntervalMs: 60_000,
    });
    consumer.running = true;
    await expect(consumer.tick()).resolves.toMatchObject({ state: "degraded" });
    expect(sideEffects.size).toBe(1);
    expect(cloudClient.completeMcpCall.mock.calls[0][1]).toEqual({
      claimantId: "host-a",
      result: { content: [{ type: "text", text: "same-result" }] },
    });
    expect(cloudClient.completeMcpCall.mock.calls[0][1]).not.toHaveProperty("error");
    consumer.running = false;
  });

  it("backs off after Cloud failure without crashing the consumer", async () => {
    const cloudClient = {
      pullMcpCalls: vi
        .fn()
        .mockRejectedValueOnce(Object.assign(new Error("offline"), { code: "CLOUD_NETWORK_ERROR" }))
        .mockResolvedValueOnce({ calls: [] }),
    };
    const executor = { execute: vi.fn(), snapshot: () => null };
    const consumer = new CloudMcpCallConsumer({
      cloudClient,
      executor,
      random: () => 0.5,
      pollIntervalMs: 60_000,
    });
    const degraded = await consumer.start();
    expect(degraded.state).toBe("degraded");
    expect(degraded.failureCount).toBe(1);
    await consumer.tick();
    expect(consumer.snapshot()).toMatchObject({
      state: "ready",
      failureCount: 0,
    });
    await consumer.stop();
  });
});

  it("replays a locally journaled completion without executing the tool again", async () => {
    const cloudClient = {
      pullMcpCalls: vi.fn(async () => ({ calls: [{ ...call(), requestDigest: "digest-1" }] })),
      claimMcpCall: vi.fn(async () => ({ ...call(), status: "executing" })),
      completeMcpCall: vi.fn(async () => ({ ...call(), status: "completed" })),
    };
    const executor = { execute: vi.fn(), snapshot: () => null };
    const completionStore = {
      get: vi.fn(() => ({
        callId: "mcp_1",
        requestDigest: "digest-1",
        payload: { result: { content: [{ type: "text", text: "persisted" }] } },
      })),
      delete: vi.fn(),
    };
    const consumer = new CloudMcpCallConsumer({
      cloudClient,
      executor,
      completionStore,
      pollIntervalMs: 60_000,
    });
    await consumer.start();
    expect(executor.execute).not.toHaveBeenCalled();
    expect(cloudClient.completeMcpCall).toHaveBeenCalledWith(
      "mcp_1",
      expect.objectContaining({
        result: { content: [{ type: "text", text: "persisted" }] },
      }),
    );
    expect(completionStore.delete).toHaveBeenCalledWith("mcp_1");
    await consumer.stop();
  });

  it("renews the Cloud claim lease while a tool is still executing", async () => {
    let intervalCallback = null;
    const intervalHandle = { unref: vi.fn() };
    const cloudClient = {
      pullMcpCalls: vi.fn(async () => ({ calls: [call()] })),
      claimMcpCall: vi.fn(async () => ({ ...call(), status: "executing" })),
      completeMcpCall: vi.fn(async () => ({ ...call(), status: "completed" })),
    };
    const executor = {
      execute: vi.fn(async () => {
        await intervalCallback();
        return { content: [{ type: "text", text: "ok" }] };
      }),
      snapshot: () => null,
    };
    const consumer = new CloudMcpCallConsumer({
      cloudClient,
      executor,
      leaseMs: 5_000,
      pollIntervalMs: 60_000,
      setIntervalImpl(callback) {
        intervalCallback = callback;
        return intervalHandle;
      },
      clearIntervalImpl: vi.fn(),
    });
    await consumer.start();
    expect(cloudClient.claimMcpCall).toHaveBeenCalledTimes(2);
    expect(intervalHandle.unref).toHaveBeenCalled();
    await consumer.stop();
  });
