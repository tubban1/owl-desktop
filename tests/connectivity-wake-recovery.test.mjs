import { describe, expect, it, vi } from "vitest";
import { createConnectivityWakeRecovery } from "../electron/services/connectivity-wake-recovery.mjs";

describe("createConnectivityWakeRecovery", () => {
  it("runs reconciliation immediately on resume", async () => {
    const reconcile = vi.fn(async () => undefined);
    const recovery = createConnectivityWakeRecovery({ reconcile });
    await recovery.trigger("power_resume");
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(recovery.snapshot()).toMatchObject({
      running: false,
      pending: false,
      runs: 1,
      lastReason: "power_resume",
    });
  });

  it("coalesces wake bursts and runs one follow-up reconciliation", async () => {
    let release;
    const first = new Promise((resolve) => {
      release = resolve;
    });
    const reconcile = vi
      .fn()
      .mockImplementationOnce(() => first)
      .mockResolvedValue(undefined);
    const recovery = createConnectivityWakeRecovery({ reconcile });

    const pending = recovery.trigger("power_resume");
    recovery.trigger("unlock_resume");
    expect(recovery.snapshot()).toMatchObject({ running: true, pending: true });
    release();
    await pending;

    expect(reconcile).toHaveBeenCalledTimes(2);
    expect(recovery.snapshot()).toMatchObject({
      running: false,
      pending: false,
      runs: 2,
      lastReason: "unlock_resume",
    });
  });

  it("does not deadlock future wake recovery after a failed reconcile", async () => {
    const events = [];
    const reconcile = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("offline"), { code: "OFFLINE" }))
      .mockResolvedValueOnce(undefined);
    const recovery = createConnectivityWakeRecovery({
      reconcile,
      onEvent(level, message, meta) {
        events.push({ level, message, meta });
      },
    });

    await recovery.trigger("power_resume");
    await recovery.trigger("power_resume");

    expect(reconcile).toHaveBeenCalledTimes(2);
    expect(
      events.some(
        (event) => event.message === "Connectivity wake recovery failed",
      ),
    ).toBe(true);
    expect(recovery.snapshot().running).toBe(false);
  });
});
