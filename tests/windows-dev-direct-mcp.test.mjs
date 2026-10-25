import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { probeWindowsDevDirectMcp } from "../electron/services/windows-dev-direct-mcp.mjs";

const tempRoots = [];
async function fixture() {
  const appData = await fs.mkdtemp(path.join(os.tmpdir(), "owl-direct-mcp-"));
  tempRoots.push(appData);
  const config = path.join(appData, "OWL LAB", "dev");
  await fs.mkdir(config, { recursive: true });
  await fs.writeFile(path.join(config, "direct-mcp-tunnel.json"), JSON.stringify({
    tunnelId: "tunnel_6addf9491dec8191a2d8d335eac1e9f5",
    mcpPort: 8790,
    mcpUrl: "http://127.0.0.1:8790/mcp",
    healthPort: 18081,
  }));
  return appData;
}
afterEach(async () => {
  for (const dir of tempRoots.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
const good = (payload) => ({ ok: true, json: async () => payload });
const goodTunnel = {
  ready: true, live: true,
  components: {
    "control-plane": { status: "ok", state: "polling" },
    dispatcher: { status: "ok", state: "accepting" }
  }
};
const goodMcp = {
  ok: true, service: "owl-mcp", runtimeUrl: "http://127.0.0.1:8788"
};
describe("Windows developer independent direct MCP probe", () => {
  it("is never considered ready in a packaged build or on Mac", async () => {
    const appData = await fixture();
    const request = vi.fn();
    expect((await probeWindowsDevDirectMcp({ platform: "darwin", appData, request })).ready).toBe(false);
    expect((await probeWindowsDevDirectMcp({ platform: "win32", packaged: true, appData, request })).ready).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });
  it("requires both official tunnel readiness and the OWL local MCP identity", async () => {
    const appData = await fixture();
    const request = vi.fn(async (url) => good(url.includes("18081") ? goodTunnel : goodMcp));
    const state = await probeWindowsDevDirectMcp({ platform: "win32", appData, request });
    expect(state).toEqual({
      ready: true,
      mode: "direct_openai_tunnel",
      tunnelId: "tunnel_6addf9491dec8191a2d8d335eac1e9f5",
    });
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("does not mark an offline tunnel or a wrong MCP port ready", async () => {
    const appData = await fixture();
    const request = vi.fn(async (url) => good(url.includes("18081") ? {...goodTunnel, ready: false} : goodMcp));
    expect((await probeWindowsDevDirectMcp({ platform: "win32", appData, request })).ready).toBe(false);
    expect((await probeWindowsDevDirectMcp({ platform: "win32", appData, mcpPort: 8787, request })).ready).toBe(false);
  });
  it("requires the correct OWL backend even if the tunnel itself is healthy", async () => {
    const appData = await fixture();
    const request = vi.fn(async (url) => good(url.includes("18081") ? goodTunnel : {
      ...goodMcp,
      service: "computer-mcp"
    }));
    expect((await probeWindowsDevDirectMcp({ platform: "win32", appData, request })).ready).toBe(false);
  });
});
