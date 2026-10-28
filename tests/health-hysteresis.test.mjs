import { describe, it, expect } from "vitest";
import { createHealthHysteresis } from "../electron/services/health-hysteresis.mjs";

describe("connection host health hysteresis", () => {
  it("does not hide first-start failure", () => {
    expect(createHealthHysteresis().failure(0)).toBe(true);
  });
  it("keeps a previously healthy host online during a brief CPU stall", () => {
    const gate = createHealthHysteresis();
    gate.success();
    expect(gate.failure(1000)).toBe(false);
    expect(gate.failure(5000)).toBe(false);
    expect(gate.failure(9100)).toBe(true);
  });
  it("success resets a failed probe streak", () => {
    const gate = createHealthHysteresis();
    gate.success();
    gate.failure(1000);
    gate.failure(3000);
    gate.success();
    expect(gate.failure(15000)).toBe(false);
    expect(gate.failure(24000)).toBe(true);
  });
});
