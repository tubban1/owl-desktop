import { describe, expect, it, vi } from "vitest";
import { createConnectivityWakeRecovery } from "../electron/services/connectivity-wake-recovery.mjs";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("Connectivity wake recovery coordinator", () => {
  it("requires a reconciliation function", () => {
    expect(() => createConnectivityWakeRecovery()).toThrow(/reconcile/);
  });

  it("runs one bounded single-flight recovery and publishes completion", async () => {
    const gate = deferred();
    const reconcile = vi.fn(() => gate.promise);
    const events = [];
    const recovery = createConnectivityWakeRecovery({
      reconcile,
      onEvent: (level, message, meta) => events.push({ level, message, meta }),
    });

    const pending = recovery.trigger("system_resume");
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(recovery.snapshot()).toMatchObject({
      running: true,
      pending: false,
      runs: 1,
      lastReason: "system_resume",
    });
    gate.resolve();
    await pending;
    expect(recovery.snapshot()).toMatchObject({
      running: false,
      pending: false,
      runs: 1,
    });
    expect(events.some((e) => e.message === "Connectivity wake recovery completed"))
      .toBe(true);
  });

  it("coalesces simultaneous resume/network triggers and preserves a trailing recovery", async () => {
    const first = deferred();
    const second = deferred();
    const reconcile = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const events = [];
    const recovery = createConnectivityWakeRecovery({
      reconcile,
      onEvent: (level, message, meta) => events.push({ level, message, meta }),
    });

    const run = recovery.trigger("system_resume");
    const joined = recovery.trigger("network_return");
    recovery.trigger("system_resume");
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(recovery.snapshot()).toMatchObject({
      running: true,
      pending: true,
      runs: 1,
    });

    first.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(reconcile).toHaveBeenCalledTimes(2);
    expect(recovery.snapshot()).toMatchObject({
      running: true,
      pending: false,
      runs: 2,
    });
    second.resolve();
    await Promise.all([run, joined]);
    expect(reconcile).toHaveBeenCalledTimes(2);
    expect(recovery.snapshot()).toMatchObject({
      running: false,
      pending: false,
      runs: 2,
      lastReason: "system_resume",
    });
    expect(events.filter((event) => event.message === "Connectivity wake recovery coalesced"))
      .toHaveLength(2);
  });

  it("records failure and permits another recovery without a service restart", async () => {
    const error = Object.assign(new Error("Cloud temporarily offline"), { code: "CLOUD_NETWORK_ERROR" });
    const reconcile = vi.fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(undefined);
    const events = [];
    const recovery = createConnectivityWakeRecovery({
      reconcile,
      onEvent: (level, message, meta) => events.push({ level, message, meta }),
    });

    await recovery.trigger("system_resume");
    expect(recovery.snapshot()).toMatchObject({ running: false, runs: 1 });
    expect(events.find((event) => event.message === "Connectivity wake recovery failed"))
      .toMatchObject({ level: "warn", meta: { code: "CLOUD_NETWORK_ERROR" } });
    await recovery.trigger("network_return");
    expect(reconcile).toHaveBeenCalledTimes(2);
    expect(recovery.snapshot()).toMatchObject({ running: false, runs: 2 });
    expect(events.at(-1).message).toBe("Connectivity wake recovery completed");
  });
});
