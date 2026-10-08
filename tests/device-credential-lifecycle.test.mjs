import { describe, expect, it, vi } from "vitest";
import {
  revokeDeviceCredentialLifecycle,
  rotateDeviceCredentialLifecycle,
} from "../electron/services/device-credential-lifecycle.mjs";

describe("device credential lifecycle", () => {
  it("rotates first, then rebinds Cloud transports without exposing a credential", async () => {
    const order = [];
    const result = await rotateDeviceCredentialLifecycle({
      deviceId: "dev_1",
      controlPlane: {
        rotateCurrentDeviceCredential: async (deviceId) => {
          order.push("cloud-rotate");
          return { deviceId, rotated: true };
        },
      },
      restartCloudBridge: async () => order.push("cloud-bridge"),
      rebindCloudMcp: async () => order.push("cloud-mcp"),
      managedTunnelEnabled: true,
      restartManagedTunnel: async () => order.push("managed-tunnel"),
    });

    expect(result).toEqual({ deviceId: "dev_1", rotated: true });
    expect(JSON.stringify(result)).not.toContain("deviceCredential");
    expect(order).toEqual([
      "cloud-rotate",
      "cloud-bridge",
      "cloud-mcp",
      "managed-tunnel",
    ]);
  });

  it("does not restart Managed Tunnel when that mode is disabled", async () => {
    const restartManagedTunnel = vi.fn();
    await rotateDeviceCredentialLifecycle({
      deviceId: "dev_1",
      controlPlane: {
        rotateCurrentDeviceCredential: async () => ({
          deviceId: "dev_1",
          rotated: true,
        }),
      },
      restartCloudBridge: async () => undefined,
      rebindCloudMcp: async () => undefined,
      managedTunnelEnabled: false,
      restartManagedTunnel,
    });
    expect(restartManagedTunnel).not.toHaveBeenCalled();
  });

  it("revokes Cloud first, then tears down local access in fail-closed order", async () => {
    const order = [];
    const result = await revokeDeviceCredentialLifecycle({
      deviceId: "dev_1",
      controlPlane: {
        revokeCurrentDevice: async () => {
          order.push("cloud-revoke");
          return { deviceId: "dev_1", registrationState: "revoked" };
        },
      },
      deleteLocalCredential: async () => order.push("delete-local-credential"),
      stopCloudBridge: async () => order.push("stop-cloud-bridge"),
      stopCloudMcp: async () => order.push("stop-cloud-mcp"),
      stopTunnel: async () => order.push("stop-tunnel"),
      updateLocalSettings: async () => order.push("update-settings"),
      revokeRuntimeAccess: async () => {
        order.push("revoke-runtime");
        return { state: "REVOKED", reasonCode: "CLOUD_DEVICE_REVOKED" };
      },
    });

    expect(order).toEqual([
      "cloud-revoke",
      "delete-local-credential",
      "stop-cloud-bridge",
      "stop-cloud-mcp",
      "stop-tunnel",
      "update-settings",
      "revoke-runtime",
    ]);
    expect(result.runtimeAccess).toMatchObject({
      state: "REVOKED",
      reasonCode: "CLOUD_DEVICE_REVOKED",
    });
  });

  it("keeps local identity intact when Cloud revoke itself fails", async () => {
    const deleteLocalCredential = vi.fn();
    await expect(
      revokeDeviceCredentialLifecycle({
        deviceId: "dev_1",
        controlPlane: {
          revokeCurrentDevice: async () => {
            throw Object.assign(new Error("forbidden"), { code: "FORBIDDEN" });
          },
        },
        deleteLocalCredential,
        stopCloudBridge: vi.fn(),
        stopCloudMcp: vi.fn(),
        stopTunnel: vi.fn(),
        updateLocalSettings: vi.fn(),
        revokeRuntimeAccess: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(deleteLocalCredential).not.toHaveBeenCalled();
  });
});
