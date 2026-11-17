import { describe, expect, it } from "vitest";
import { reconcileCustomTunnelFeedback } from "../src/connection-recovery-feedback";

const stale = {
  state: "failed" as const,
  code: "CUSTOM_TUNNEL_UNVERIFIED",
  message: "Custom Tunnel reachability is not verified.",
  nextAction: "diagnostics" as const,
};

describe("One-shot Tunnel recovery warning refresh", () => {
  it("resolves a stale startup warning after a verified health snapshot", () => {
    expect(reconcileCustomTunnelFeedback(stale, true)).toEqual({
      state: "ready", code: null, nextAction: "none",
      message: "Custom Tunnel and control-plane health verified. Remote ChatGPT MCP invocation has not been independently verified.",
    });
  });
  it("does not silence an ongoing outage", () => {
    expect(reconcileCustomTunnelFeedback(stale, false)).toBe(stale);
  });
  it("does not hide unrelated authorization or durable Cloud failures", () => {
    const other = { ...stale, code: "CLOUD_DEVICE_ENROLLMENT_INCOMPLETE" };
    expect(reconcileCustomTunnelFeedback(other, true)).toBe(other);
    expect(reconcileCustomTunnelFeedback(null, true)).toBeNull();
  });
});
