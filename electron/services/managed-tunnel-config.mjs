export function buildManagedTunnelConfig({
  projection,
  deviceCredential,
  binaryPath,
  mcpUrl,
}) {
  const managed = projection?.managedTunnel ?? null;
  if (
    projection?.mode !== "managed_tunnel" ||
    managed?.available !== true ||
    managed?.state !== "active"
  ) {
    return null;
  }
  if (!deviceCredential?.trim()) {
    throw new Error("OWL device credential is required for Managed Tunnel.");
  }
  if (managed.credentialSource !== "device") {
    throw new Error("Managed Tunnel credential source must be the OWL device.");
  }
  if (!managed.tunnelId?.trim()) {
    throw new Error("Managed Tunnel ID is missing.");
  }
  if (!managed.controlPlaneBaseUrl?.trim()) {
    throw new Error("Managed Tunnel control plane is missing.");
  }

  return {
    binaryPath,
    tunnelId: managed.tunnelId.trim(),
    apiKey: deviceCredential,
    mcpUrl,
    controlPlaneBaseUrl: managed.controlPlaneBaseUrl.trim(),
    pollTimeoutMs: Math.max(
      1_000,
      Math.min(20_000, Number(managed.pollTimeoutMs) || 20_000),
    ),
  };
}
