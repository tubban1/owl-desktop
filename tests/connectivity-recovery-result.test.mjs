import { describe, expect, it } from "vitest";
import { assessConnectivityRecovery, waitForCustomTunnelReadiness, isVerifiedCustomTunnelStatus } from "../electron/services/connectivity-recovery-result.mjs";

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
    expect(assessConnectivityRecovery({ ...base, mode: "custom_tunnel", tunnel: {
      state: "running", reachability: { state: "ready", localReady: true, controlPlane: { status: "ok" } },
    } })).toMatchObject({ ready: true });
  });
  it("waits for verified recovery evidence rather than reporting a transient startup failure", async () => {
    const starting = { state: "running", reachability: { state: "starting" } };
    const healthy = { state: "running", reachability: {
      state: "ready", localReady: true, controlPlane: { status: "ok" },
    } };
    let checks = 0;
    const tunnel = await waitForCustomTunnelReadiness(starting, async () =>
      ++checks === 1 ? starting : healthy, { attempts: 3, sleep: async () => {} });
    expect(checks).toBe(2);
    expect(tunnel).toEqual(healthy);
    expect(assessConnectivityRecovery({ ...base, mode: "custom_tunnel", tunnel }))
      .toMatchObject({ ready: true, code: null });
  });

  it("never promotes an unverified or degraded Tunnel into a healthy result", async () => {
    const notProven = { state: "running", reachability: { state: "ready", localReady: true,
      controlPlane: { status: "degraded" } } };
    expect(isVerifiedCustomTunnelStatus(notProven)).toBe(false);
    const candidate = await waitForCustomTunnelReadiness(notProven,
      async () => notProven, { attempts: 2, sleep: async () => {} });
    expect(assessConnectivityRecovery({ ...base, mode: "custom_tunnel", tunnel: candidate }))
      .toMatchObject({ ready: false, code: "CUSTOM_TUNNEL_UNVERIFIED" });
  });

  it("enforces a real deadline even when the Connection Host never answers", async () => {
    const starting = { state: "running", reachability: { state: "starting" } };
    const began = Date.now();
    const result = await waitForCustomTunnelReadiness(starting,
      () => new Promise(() => {}), {
        attempts: 14, pollIntervalMs: 1, maxWaitMs: 35,
      });
    expect(Date.now() - began).toBeLessThan(400);
    expect(result).toEqual(starting);
  });

  it("bounds waiting when a health check never completes or the Host disconnects", async () => {
    const starting = { state: "running", reachability: { state: "starting" } };
    let count = 0;
    const result = await waitForCustomTunnelReadiness(starting, async () => {
      count++;
      return starting;
    }, { attempts: 3, sleep: async () => {} });
    expect(count).toBe(3);
    expect(assessConnectivityRecovery({ ...base, mode: "custom_tunnel", tunnel: result }).ready).toBe(false);
    const disconnected = await waitForCustomTunnelReadiness(starting,
      async () => { throw Error("Disconnected"); }, { attempts: 10, sleep: async () => {} });
    expect(disconnected).toBe(starting);
  });

});
