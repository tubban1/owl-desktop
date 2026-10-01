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

async function startDelayedRuntime() {
  let completed = 0;
  let received = 0;
  let resolveReceived;
  const receivedOnce = new Promise((resolve) => {
    resolveReceived = resolve;
  });
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    received += 1;
    resolveReceived?.();
    resolveReceived = null;
    await new Promise((resolve) => setTimeout(resolve, 180));
    completed += 1;
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
    received: () => received,
    waitUntilReceived: () => receivedOnce,
    completed: () => completed,
  };
}

describe("OWL MCP upstream disconnect survival", () => {
  it("does not cancel an accepted Runtime call when the MCP transport disconnects", async () => {
    const runtime = await startDelayedRuntime();
    const mcp = await startOwlMcpHttpServer({
      port: 0,
      runtimeBaseUrl: runtime.baseUrl,
    });
    closers.push(() => mcp.close());

    const client = new Client({
      name: "disconnect-survival-test",
      version: "0.1.0",
    });
    const transport = new StreamableHTTPClientTransport(new URL(mcp.url), {
      requestInit: {
        headers: { "x-owl-owner-id": "disconnect-survival-owner" },
      },
    });
    await client.connect(transport);

    const pending = client.callTool({
      name: "runtime_info",
      arguments: {},
    }).catch(() => null);

    await Promise.race([
      runtime.waitUntilReceived(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Runtime never accepted the MCP request.")), 5_000),
      ),
    ]);
    expect(runtime.received()).toBe(1);

    await transport.close().catch(() => undefined);
    await pending.catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 260));

    expect(runtime.completed()).toBe(1);
  }, 20_000);
});
