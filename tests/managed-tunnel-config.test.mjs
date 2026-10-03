import { describe, expect, it } from "vitest";
import { buildManagedTunnelConfig } from "../electron/services/managed-tunnel-config.mjs";

describe("buildManagedTunnelConfig", () => {
  it("uses only the OWL device credential for Managed Tunnel auth", () => {
    const config = buildManagedTunnelConfig({
      projection: {
        mode: "managed_tunnel",
        managedTunnel: {
          available: true,
          state: "active",
          tunnelId: "tunnel_0123456789abcdef0123456789abcdef",
          controlPlaneBaseUrl: "https://cloud.example.test/tunnel",
          pollTimeoutMs: 30_000,
          credentialSource: "device",
        },
      },
      deviceCredential: "owldev1.dev_1.device-secret",
      binaryPath: "/tmp/tunnel-client-runtime",
      mcpUrl: "http://127.0.0.1:8790/mcp",
    });

    expect(config).toEqual({
      binaryPath: "/tmp/tunnel-client-runtime",
      tunnelId: "tunnel_0123456789abcdef0123456789abcdef",
      apiKey: "owldev1.dev_1.device-secret",
      mcpUrl: "http://127.0.0.1:8790/mcp",
      controlPlaneBaseUrl: "https://cloud.example.test/tunnel",
      pollTimeoutMs: 20_000,
    });
    expect(JSON.stringify(config)).not.toContain("OWL_TUNNEL_API_KEY");
  });

  it("does not build a Tunnel config when Cloud Durable MCP is the fallback", () => {
    expect(
      buildManagedTunnelConfig({
        projection: {
          mode: "cloud_durable",
          managedTunnel: {
            available: false,
            state: "not_configured",
            reason: "chatgpt_workspace_not_configured",
          },
        },
        deviceCredential: "owldev1.dev_1.device-secret",
        binaryPath: "/tmp/tunnel-client-runtime",
        mcpUrl: "http://127.0.0.1:8790/mcp",
      }),
    ).toBeNull();
  });

  it("rejects a managed projection that asks for any credential source other than device", () => {
    expect(() =>
      buildManagedTunnelConfig({
        projection: {
          mode: "managed_tunnel",
          managedTunnel: {
            available: true,
            state: "active",
            tunnelId: "tunnel_0123456789abcdef0123456789abcdef",
            controlPlaneBaseUrl: "https://cloud.example.test/tunnel",
            credentialSource: "openai_api_key",
          },
        },
        deviceCredential: "owldev1.dev_1.device-secret",
        binaryPath: "/tmp/tunnel-client-runtime",
        mcpUrl: "http://127.0.0.1:8790/mcp",
      }),
    ).toThrow(/credential source must be the OWL device/i);
  });
});
