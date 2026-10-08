import { describe, expect, it } from "vitest";
import { executionAccessView } from "../src/executionAccessView";

describe("Desktop execution authorization projection", () => {
  it("does not report authorization required from a missing/failed Runtime access probe", () => {
    expect(executionAccessView(true, null)).toBe("verifying");
    expect(executionAccessView(true, undefined)).toBe("verifying");
  });
  it("accepts only verified Runtime READY or explicit compat mode", () => {
    expect(executionAccessView(true, { state:"READY", mode:"enforced" } as never)).toBe("ready");
    expect(executionAccessView(true, { state:"LOCKED", mode:"compat" } as never)).toBe("ready");
    expect(executionAccessView(false, { state:"READY" } as never)).toBe("verifying");
  });
  it("preserves genuine Runtime authorization denial", () => {
    expect(executionAccessView(true, { state:"LOCKED", reasonCode:"ACCOUNT_LOGGED_OUT" } as never)).toBe("locked");
    expect(executionAccessView(true, { state:"REVOKED" } as never)).toBe("locked");
  });
});
