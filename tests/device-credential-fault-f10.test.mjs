import { describe, expect, it, vi } from "vitest";
import { rotateDeviceCredentialLifecycle as rotate, revokeDeviceCredentialLifecycle as revoke } from "../electron/services/device-credential-lifecycle.mjs";
const okRotate = async () => ({ deviceId: "dev_1", rotated: true });
const okRevoke = async () => ({ deviceId: "dev_1", registrationState: "revoked" });
const fail = async () => { throw new Error("isolated fault"); };
describe("F10 isolated credential partial failures", () => {
  it("keeps rebinding independent transports even if Bridge rebind fails", async () => {
    const call = [];
    await expect(rotate({
      deviceId: "dev_1", controlPlane: { rotateCurrentDeviceCredential: okRotate },
      restartCloudBridge: async () => { call.push("bridge"); await fail(); },
      rebindCloudMcp: async () => { call.push("mcp"); },
      restartManagedTunnel: async () => { call.push("tunnel"); }, managedTunnelEnabled: true,
    })).rejects.toMatchObject({ code: "DEVICE_CREDENTIAL_REBIND_INCOMPLETE", failedStages: ["cloudBridgeRebind"] });
    expect(call).toEqual(["bridge", "mcp", "tunnel"]);
  });
  it("stops the old Cloud consumer when rebind fails", async () => {
    const stopCloudMcp = vi.fn(async () => {});
    await expect(rotate({
      deviceId: "dev_1", controlPlane: { rotateCurrentDeviceCredential: okRotate },
      restartCloudBridge: async () => {},
      rebindCloudMcp: fail, stopCloudMcp,
    })).rejects.toMatchObject({ code: "DEVICE_CREDENTIAL_REBIND_INCOMPLETE", failedStages: ["cloudMcpRebind"] });
    expect(stopCloudMcp).toHaveBeenCalledOnce();
  });
  it("discloses both rebind and fail-closed stop failures", async () => {
    await expect(rotate({
      deviceId: "dev_1", controlPlane: { rotateCurrentDeviceCredential: okRotate },
      restartCloudBridge: async () => {},
      rebindCloudMcp: fail, stopCloudMcp: fail,
    })).rejects.toMatchObject({ code: "DEVICE_CREDENTIAL_REBIND_INCOMPLETE", failedStages: ["cloudMcpRebind", "stopStaleCloudMcp"] });
  });
  it("performs all local teardown steps after Cloud revoke despite intermediate errors", async () => {
    const steps = [];
    const action = (name, invalid = false) => async () => {
      steps.push(name);
      if (invalid) await fail();
      return name === "runtime" ? { state: "REVOKED" } : undefined;
    };
    await expect(revoke({
      deviceId: "dev_1",
      controlPlane: { revokeCurrentDevice: async () => { steps.push("cloud"); return okRevoke(); } },
      deleteLocalCredential: action("delete"),
      stopCloudBridge: action("bridge", true),
      stopCloudMcp: action("mcp"),
      stopTunnel: action("tunnel", true),
      updateLocalSettings: action("settings"),
      revokeRuntimeAccess: action("runtime"),
    })).rejects.toMatchObject({ code: "DEVICE_REVOCATION_LOCAL_CLEANUP_INCOMPLETE", failedStages: ["stopCloudBridge", "stopTunnel"] });
    expect(steps).toEqual(["cloud", "delete", "bridge", "mcp", "tunnel", "settings", "runtime"]);
  });
  it("does not falsely claim Runtime was locked when no lock proof was returned", async () => {
    await expect(revoke({
      deviceId: "dev_1", controlPlane: { revokeCurrentDevice: okRevoke },
      deleteLocalCredential: async () => {},
      stopCloudBridge: async () => {},
      stopCloudMcp: async () => {},
      stopTunnel: async () => {},
      updateLocalSettings: async () => {},
      revokeRuntimeAccess: async () => null,
    })).rejects.toMatchObject({ code: "DEVICE_REVOCATION_LOCAL_CLEANUP_INCOMPLETE", failedStages: ["revokeRuntimeAccess"] });
  });
});
