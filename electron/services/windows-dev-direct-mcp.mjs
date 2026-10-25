import fs from "node:fs/promises";
import path from "node:path";

// Developer mode only. Real proof comes from the locally running official
// tunnel-client (health+control-plane) AND this device's OWL MCP health.
// Neither a stored tunnel ID nor local listener alone is evidence of readiness.
export async function probeWindowsDevDirectMcp({
  platform = process.platform,
  packaged = false,
  appData = process.env.APPDATA,
  mcpPort = 8790,
  request = fetch,
} = {}) {
  const inactive = { ready: false, mode: "inactive" };
  if (platform !== "win32" || packaged || !appData) return inactive;
  try {
    const markerFile = path.join(appData, "OWL LAB", "dev", "direct-mcp-tunnel.json");
    const marker = JSON.parse(await fs.readFile(markerFile, "utf8"));
    if (!/^tunnel_[a-f0-9]{32}$/.test(marker.tunnelId ?? "") ||
        marker.mcpPort !== mcpPort ||
        marker.healthPort !== 18081 ||
        marker.mcpUrl !== `http://127.0.0.1:${mcpPort}/mcp`) {
      return { ready: false, mode: "invalid_dev_tunnel_config" };
    }
    const [tunnelReply, mcpReply] = await Promise.all([
      request("http://127.0.0.1:18081/health?details=true", {
        signal: AbortSignal.timeout(2500),
      }),
      request(`http://127.0.0.1:${mcpPort}/health`, {
        signal: AbortSignal.timeout(2500),
      }),
    ]);
    if (!tunnelReply.ok || !mcpReply.ok) {
      return { ready: false, mode: "unreachable" };
    }
    const [tunnel, mcp] = await Promise.all([
      tunnelReply.json(), mcpReply.json(),
    ]);
    const healthy =
      tunnel.ready === true &&
      tunnel.live === true &&
      tunnel.components?.["control-plane"]?.status === "ok" &&
      tunnel.components?.dispatcher?.status === "ok" &&
      mcp.ok === true &&
      mcp.service === "owl-mcp" &&
      mcp.runtimeUrl === "http://127.0.0.1:8788";
    return {
      ready: healthy,
      mode: healthy ? "direct_openai_tunnel" : "not_ready",
      ...(healthy ? { tunnelId: marker.tunnelId } : {}),
    };
  } catch {
    return { ready: false, mode: "unavailable" };
  }
}
