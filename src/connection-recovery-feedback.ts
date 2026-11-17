export type ConnectionRecoveryFeedback = {
  state: "checking" | "ready" | "failed";
  message: string;
  code: string | null;
  nextAction: "none" | "account" | "diagnostics";
};

// Only a later independently refreshed healthy snapshot can supersede the
// one-off, pre-health-poll Tunnel startup error. Do not mask unrelated errors.
export function reconcileCustomTunnelFeedback(
  current: ConnectionRecoveryFeedback | null,
  verifiedCustomTunnel: boolean,
): ConnectionRecoveryFeedback | null {
  if (!verifiedCustomTunnel || current?.code !== "CUSTOM_TUNNEL_UNVERIFIED") {
    return current;
  }
  return {
    state: "ready",
    message: "Custom Tunnel and control-plane health verified. Remote ChatGPT MCP invocation has not been independently verified.",
    code: null,
    nextAction: "none",
  };
}
