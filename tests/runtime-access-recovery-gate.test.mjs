import { describe, expect, it, vi } from "vitest";
import { createRuntimeAccessRecoveryGate } from "../electron/services/runtime-access-recovery-gate.mjs";

describe("Runtime Cloud lease recovery is non-reentrant and bounded", () => {
  it("shares one Cloud refresh across overlapping UI snapshots", async () => {
    let finish;
    const recover = vi.fn(() => new Promise((resolve) => {finish = resolve;}));
    const gate = createRuntimeAccessRecoveryGate({ recover, now: () => 1000 });
    const a = gate.run(); const b = gate.run();
    expect(a).toBe(b);
    await Promise.resolve();
    expect(recover).toHaveBeenCalledTimes(1);
    finish({ state: "READY" });
    expect(await a).toEqual({state:"READY"});
    await Promise.resolve(); await Promise.resolve();
    expect(await gate.run()).toBeNull();
    expect(recover).toHaveBeenCalledTimes(1);
  });
  it("avoids retry storm even when Cloud rejects or Runtime remains LOCKED", async () => {
    let time = 5000;
    const recover = vi.fn().mockRejectedValueOnce(new Error("LEASE_EXPIRED")).mockResolvedValueOnce({state:"LOCKED"}).mockResolvedValueOnce({state:"READY"});
    const gate = createRuntimeAccessRecoveryGate({ recover, now: () => time, retryDelayMs: 45000 });
    await expect(gate.run()).rejects.toThrow("LEASE_EXPIRED");
    await Promise.resolve();
    expect(await gate.run()).toBeNull();
    time += 45000;
    expect(await gate.run()).toEqual({state:"LOCKED"});
    await Promise.resolve();
    expect(await gate.run()).toBeNull();
    time += 45000;
    expect(await gate.run()).toEqual({state:"READY"});
    expect(recover).toHaveBeenCalledTimes(3);
  });
  it("explicit manual reauthorization can retry without waiting 45 seconds", async () => {
    const recover = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({state:"READY"});
    const gate = createRuntimeAccessRecoveryGate({ recover, now: () => 10 });
    expect(await gate.run()).toBeNull();
    await Promise.resolve();
    expect(await gate.run({force:true})).toEqual({state:"READY"});
    expect(recover).toHaveBeenCalledTimes(2);
  });
  it("force shares an already-running recovery instead of starting competing leases", async () => {
    let finish;
    const recover = vi.fn(() => new Promise(resolve=> {finish=resolve;}));
    const gate = createRuntimeAccessRecoveryGate({ recover, now: () => 10 });
    const a=gate.run();const b=gate.run({force:true});
    expect(a).toBe(b);
    await Promise.resolve();
    finish({state:"READY"});
    await a;
    expect(recover).toHaveBeenCalledTimes(1);
  });
});
