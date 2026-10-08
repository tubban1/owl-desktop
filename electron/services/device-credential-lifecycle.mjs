function incomplete(code, failedStages) {
  const error = new Error("Device credential lifecycle needs attention after partial local cleanup.");
  error.code = code;
  error.failedStages = failedStages;
  return error;
}

async function runStages(stages) {
  const results = {};
  const failures = [];
  for (const [name, action] of stages) {
    try {
      const result = await action();
      if (
        (name === "cloudBridgeRebind" && result?.running === false) ||
        (name === "cloudMcpRebind" && result?.ready === false) ||
        (name === "managedTunnelRebind" && result?.projection?.managedTunnel?.available === false)
      ) {
        throw new Error("Transport has not re-established readiness.");
      }
      results[name] = result;
    } catch { failures.push(name); }
  }
  return { results, failures };
}

export async function rotateDeviceCredentialLifecycle({
  deviceId, controlPlane, restartCloudBridge, rebindCloudMcp,
  restartManagedTunnel, stopCloudMcp = async () => {},
  managedTunnelEnabled = false,
}) {
  const result = await controlPlane.rotateCurrentDeviceCredential(deviceId);
  // The old credential is already invalid at Cloud; never claim healthy
  // until every transport has actually re-bound to the new credential.
  const { failures } = await runStages([
    ["cloudBridgeRebind", restartCloudBridge],
    ["cloudMcpRebind", rebindCloudMcp],
    ...(managedTunnelEnabled ? [["managedTunnelRebind", restartManagedTunnel]] : []),
  ]);
  if (failures.includes("cloudMcpRebind")) {
    const cleanup = await runStages([["stopStaleCloudMcp", stopCloudMcp]]);
    failures.push(...cleanup.failures);
  }
  if (failures.length) throw incomplete("DEVICE_CREDENTIAL_REBIND_INCOMPLETE", failures);
  return result;
}

export async function revokeDeviceCredentialLifecycle({
  deviceId, controlPlane, deleteLocalCredential, stopCloudBridge,
  stopCloudMcp, stopTunnel, updateLocalSettings, revokeRuntimeAccess,
}) {
  const revokedDevice = await controlPlane.revokeCurrentDevice(deviceId);
  // Do not allow a failed stop/delete to skip subsequent security cleanup.
  const { results, failures } = await runStages([
    ["deleteLocalCredential", deleteLocalCredential],
    ["stopCloudBridge", stopCloudBridge],
    ["stopCloudMcp", stopCloudMcp],
    ["stopTunnel", stopTunnel],
    ["updateLocalSettings", updateLocalSettings],
    ["revokeRuntimeAccess", revokeRuntimeAccess],
  ]);
  if (results.revokeRuntimeAccess?.state !== "REVOKED" && !failures.includes("revokeRuntimeAccess")) {
    failures.push("revokeRuntimeAccess");
  }
  if (failures.length) throw incomplete("DEVICE_REVOCATION_LOCAL_CLEANUP_INCOMPLETE", failures);
  return { revokedDevice, runtimeAccess: results.revokeRuntimeAccess };
}
