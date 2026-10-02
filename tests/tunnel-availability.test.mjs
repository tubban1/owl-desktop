import { describe, expect, it } from "vitest";
import { tunnelTransportAvailable } from "../electron/services/tunnel-availability.mjs";

describe("tunnelTransportAvailable", () => {
  it("requires proven reachability rather than process liveness", () => {
    expect(
      tunnelTransportAvailable({
        state: "running",
        reachability: {
          state: "ready",
          localReady: true,
          controlPlane: { status: "ok" },
        },
      }),
    ).toBe(true);

    for (const reachabilityState of [
      "starting",
      "degraded",
      "stale",
      "recovering",
      "unreachable",
      "stopped",
    ]) {
      expect(
        tunnelTransportAvailable({
          state: "running",
          reachability: {
            state: reachabilityState,
            localReady: true,
            controlPlane: { status: "ok" },
          },
        }),
      ).toBe(false);
    }
  });

  it("fails closed when reachability evidence is absent or contradictory", () => {
    expect(tunnelTransportAvailable({ state: "running" })).toBe(false);
    expect(
      tunnelTransportAvailable({
        state: "running",
        reachability: {
          state: "ready",
          localReady: false,
          controlPlane: { status: "ok" },
        },
      }),
    ).toBe(false);
    expect(
      tunnelTransportAvailable({
        state: "running",
        reachability: {
          state: "ready",
          localReady: true,
          controlPlane: { status: "degraded" },
        },
      }),
    ).toBe(false);
  });
});
