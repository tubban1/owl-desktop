import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startOwlMcpHttpServer } from "../mcp/http-server.mjs";

const closers = [];

afterEach(async () => {
  while (closers.length) {
    await closers.pop()?.();
  }
});

async function startFakeRuntime() {
  let calls = 0;
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    calls += 1;
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      ok: true,
      apiVersion: "0.1",
      requestId: body.id,
      result: {
        apiVersion: "0.1",
        runtimeVersion: "test-runtime",
      },
    }));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  closers.push(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    calls: () => calls,
  };
}

describe("OWL MCP reconnect soak", () => {
  it("cleans up transport sessions across repeated reconnects", async () => {
    const runtime = await startFakeRuntime();
    const mcp = await startOwlMcpHttpServer({
      port: 0,
      runtimeBaseUrl: runtime.baseUrl,
      sessionIdleTtlMs: 1_000,
      maxSessions: 8,
    });
    closers.push(() => mcp.close());

    for (let index = 0; index < 25; index += 1) {
      const client = new Client({
        name: `reconnect-soak-${index}`,
        version: "0.1.0",
      });
      const transport = new StreamableHTTPClientTransport(new URL(mcp.url), {
        requestInit: {
          headers: { "x-owl-owner-id": "reconnect-soak-owner" },
        },
      });
      await client.connect(transport);
      const result = await client.callTool({
        name: "runtime_info",
        arguments: {},
      });
      expect(result.isError).not.toBe(true);
      await transport.close();
    }

    expect(runtime.calls()).toBeGreaterThanOrEqual(25);
    expect(mcp.sessionCount()).toBeLessThanOrEqual(8);

    await new Promise((resolve) => setTimeout(resolve, 1_150));
    expect(mcp.sessionCount()).toBe(0);
  }, 20_000);
});
