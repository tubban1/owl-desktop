// Explain an explicit user-triggered recovery attempt. A successful IPC call
// only means recovery was attempted: Cloud MCP must prove a durable poll before
// we tell a user that ChatGPT can reach this device.
const result = (ready, code, message, nextAction = "diagnostics") =>
  ({ ready, code, message, nextAction });

export function assessConnectivityRecovery({
  mode,
  hostConnected,
  mcpRunning,
  cloudEnabled,
  cloudBaseUrl,
  deviceId,
  deviceCredentialAvailable,
  cloudMcp,
  tunnel,
} = {}) {
  if (!mcpRunning) {
    return result(false, "LOCAL_MCP_NOT_RUNNING",
      "Local MCP is not running. Open Settings → Diagnostics to check the Runtime and Connection Host.");
  }
  if (mode === "custom_tunnel") {
    // A process that exists is not proof of a usable remote channel.
    // Match the TunnelSupervisor's verified healthy state, not its startup
    // acknowledgement; this must fail closed when health data is missing.
    const reachable = isVerifiedCustomTunnelStatus(tunnel);
    return reachable
      ? result(true, null, "Custom Tunnel and control-plane health verified. Remote ChatGPT MCP invocation has not been independently verified.", "none")
      : result(false, "CUSTOM_TUNNEL_UNVERIFIED",
          "Custom Tunnel reachability is not verified. Open Settings → Diagnostics to inspect the connection.");
  }
  if (!hostConnected) {
    return result(false, "CONNECTION_HOST_UNAVAILABLE",
      "The background Connection Host did not respond. Open Settings → Diagnostics to repair the local connection.");
  }
  if (!cloudEnabled || !cloudBaseUrl || !deviceId || !deviceCredentialAvailable) {
    if (!deviceId || !deviceCredentialAvailable) {
      return result(false, "CLOUD_DEVICE_ENROLLMENT_INCOMPLETE",
        "This Mac is missing its Cloud device registration or secure credential. Open Account to check device enrollment; a missing device credential requires secure recovery.",
        "account");
    }
    return result(false, "CLOUD_CONNECTION_NOT_CONFIGURED",
      "OWL Cloud connection settings are incomplete. Open Settings to check the Cloud connection.");
  }
  const consumer = cloudMcp?.consumer ?? (cloudMcp && "ready" in cloudMcp ? cloudMcp : null);
  if (consumer?.ready === true && cloudMcp?.configured !== false) {
    return result(true, null, "OWL Cloud MCP connected and verified. ChatGPT remote transport is ready.", "none");
  }
  const code = String(consumer?.lastError?.code ?? "CLOUD_MCP_NOT_READY")
    .slice(0, 80).replace(/[^A-Za-z0-9_-]/g, "_");
  if (["UNAUTHORIZED", "FORBIDDEN"].includes(code)) {
    return result(false, code,
      `OWL Cloud rejected this device (code: ${code}). Open Account to check authorization and device enrollment.`, "account");
  }
  if (code === "NOT_FOUND" || code === "HTTP_404") {
    return result(false, code,
      "OWL Cloud does not recognize the durable MCP endpoint (NOT_FOUND). The server deployment may be out of date; send Diagnostics to OWL LAB support.");
  }
  if (consumer?.lastError) {
    return result(false, code,
      `Cloud MCP verification failed (code: ${code}). Open Settings → Diagnostics for the detailed failure; no new remote access is confirmed.`);
  }
  return result(false, code,
    "Cloud MCP has not completed a verified poll. Open Settings → Diagnostics to inspect the Connection Host and Cloud connectivity.");
}

export const isVerifiedCustomTunnelStatus = (tunnel) =>
  tunnel?.state === "running" &&
  tunnel?.reachability?.state === "ready" &&
  tunnel?.reachability?.localReady === true &&
  tunnel?.reachability?.controlPlane?.status === "ok";

// Starting a Tunnel is asynchronous: the OS process may start before the
// read-only local and control-plane health probes complete. Never turn that
// normal interval into a permanent error banner. Wait only a bounded interval
// for actual evidence; no extra starts or tool calls are issued.
export async function waitForCustomTunnelReadiness(initialStatus, readStatus, {
  attempts = 14,
  pollIntervalMs = 350,
  maxWaitMs = 5_000,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  let current = initialStatus;
  if (isVerifiedCustomTunnelStatus(current)) return current;
  const deadline = Date.now() + maxWaitMs;
  for (let i = 0; i < attempts; i += 1) {
    if (!["running", "restarting"].includes(current?.state)) break;
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await sleep(Math.min(pollIntervalMs, remaining));
    const probeBudget = deadline - Date.now();
    if (probeBudget <= 0) break;
    let timer;
    try {
      // An unresponsive Host health request may take longer than the polling
      // interval. Bound the entire recovery IPC, not just the number of polls.
      const next = await Promise.race([
        readStatus(),
        new Promise((resolve) => { timer = setTimeout(() => resolve(null), probeBudget); }),
      ]);
      if (!next) break;
      current = next;
    } catch {
      break; // A failed control IPC must never be treated as proof.
    } finally {
      clearTimeout(timer);
    }
    if (isVerifiedCustomTunnelStatus(current)) return current;
  }
  return current;
}
