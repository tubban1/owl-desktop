import { describe, expect, it } from "vitest";
import { createTunnelRecoveryPlan } from "../electron/services/tunnel-recovery-plan.mjs";

describe("createTunnelRecoveryPlan", () => {
  it("builds a loopback-only restart payload without persisting the secret", () => {
    expect(
      createTunnelRecoveryPlan({
        settings: { tunnelId: " tunnel_live_123 " },
        apiKey: "secret-from-os-vault",
        binaryPath: "/tmp/owl/tunnel-client-runtime",
        mcpUrl: "http://127.0.0.1:8790/mcp",
      }),
    ).toEqual({
      action: "start",
      config: {
        binaryPath: "/tmp/owl/tunnel-client-runtime",
        tunnelId: "tunnel_live_123",
        apiKey: "secret-from-os-vault",
        mcpUrl: "http://127.0.0.1:8790/mcp",
      },
    });
  });

  it("fails closed when the OS-vault secret is unavailable", () => {
    expect(
      createTunnelRecoveryPlan({
        settings: { tunnelId: "tunnel_live_123" },
        apiKey: "",
        binaryPath: "/tmp/owl/tunnel-client-runtime",
        mcpUrl: "http://127.0.0.1:8790/mcp",
      }),
    ).toEqual({
      action: "skip",
      reason: "tunnel_api_key_missing",
    });
  });

  it("refuses a non-loopback MCP target", () => {
    expect(
      createTunnelRecoveryPlan({
        settings: { tunnelId: "tunnel_live_123" },
        apiKey: "secret-from-os-vault",
        binaryPath: "/tmp/owl/tunnel-client-runtime",
        mcpUrl: "https://example.com/mcp",
      }),
    ).toEqual({
      action: "skip",
      reason: "mcp_url_not_loopback",
    });
  });
});
