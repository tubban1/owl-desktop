import path from "node:path";

export function createTunnelRecoveryPlan({
  settings,
  apiKey,
  binaryPath,
  mcpUrl,
}) {
  const tunnelId =
    typeof settings?.tunnelId === "string" ? settings.tunnelId.trim() : "";
  const resolvedBinary =
    typeof binaryPath === "string" && binaryPath.trim()
      ? path.resolve(binaryPath)
      : "";
  const resolvedMcp =
    typeof mcpUrl === "string" ? mcpUrl.trim() : "";

  if (!tunnelId) {
    return { action: "skip", reason: "tunnel_id_missing" };
  }
  if (!apiKey) {
    return { action: "skip", reason: "tunnel_api_key_missing" };
  }
  if (!resolvedBinary) {
    return { action: "skip", reason: "tunnel_binary_missing" };
  }
  if (!resolvedMcp.startsWith("http://127.0.0.1:")) {
    return { action: "skip", reason: "mcp_url_not_loopback" };
  }

  return {
    action: "start",
    config: {
      binaryPath: resolvedBinary,
      tunnelId,
      apiKey,
      mcpUrl: resolvedMcp,
    },
  };
}
