import { describe, expect, it } from "vitest";
import { assessConnectivityRecovery } from "../electron/services/connectivity-recovery-result.mjs";

const base = {
  mode: "cloud_durable",
  hostConnected: true,
  mcpRunning: true,
  cloudEnabled: true,
  cloudBaseUrl: "https://cloud.example.test",
  deviceId: "dev_1",
  deviceCredentialAvailable: true,
};

describe("Recover Cloud result from real proof, not IPC success", () => {
  it("reports verified durable MCP polling as ready", () => {
    expect(assessConnectivityRecovery({
      ...base, cloudMcp: { configured: true, consumer: { ready: true, lastSuccessAt: "2026-10-23T00:00:00Z" } },
    })).toMatchObject({ ready: true, code: null });
  });
  it("shows a durable error after IPC itself completes successfully", () => {
    const v = assessConnectivityRecovery({ ...base, cloudMcp: {
      configured: true, consumer: { ready: false, lastError: { code: "NOT_FOUND", message: "some internal URL" } }
    } });
    expect(v).toMatchObject({ ready: false, code: "NOT_FOUND" });
    expect(v.message).toContain("deployment");
    expect(v.message).not.toContain("internal URL");
  });
  it("does not claim success if the host has disappeared", () => {
    expect(assessConnectivityRecovery({ ...base, hostConnected: false, cloudMcp: { configured: true, consumer: { ready: true } } }))
      .toMatchObject({ ready: false, code: "CONNECTION_HOST_UNAVAILABLE" });
  });
  it("explains a missing encrypted device credential without revealing tokens", () => {
    expect(assessConnectivityRecovery({ ...base, deviceCredentialAvailable: false, cloudMcp: null }))
      .toMatchObject({ ready: false, code: "CLOUD_DEVICE_ENROLLMENT_INCOMPLETE", nextAction: "account" });
  });
  it("distinguishes local MCP unavailable from Cloud errors", () => {
    expect(assessConnectivityRecovery({ ...base, mcpRunning: false }))
      .toMatchObject({ ready: false, code: "LOCAL_MCP_NOT_RUNNING" });
  });
  it("treats a consumer in starting state as incomplete", () => {
    expect(assessConnectivityRecovery({ ...base, cloudMcp: { configured: true, consumer: { ready: false, state: "starting" } } }))
      .toMatchObject({ ready: false, code: "CLOUD_MCP_NOT_READY" });
  });
  it("keeps custom Tunnel validation separate from managed Cloud MCP", () => {
    expect(assessConnectivityRecovery({ ...base, mode: "custom_tunnel", tunnel: { reachability: { state: "stale" } } }))
      .toMatchObject({ ready: false, code: "CUSTOM_TUNNEL_UNVERIFIED" });
    expect(assessConnectivityRecovery({ ...base, mode: "custom_tunnel", tunnel: { reachability: { state: "ready" } } }))
      .toMatchObject({ ready: true });
  });
});
