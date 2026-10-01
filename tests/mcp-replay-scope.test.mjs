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
  const observed = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    observed.push({
      requestId: req.headers["x-owl-request-id"],
      idempotencyKey: req.headers["x-owl-idempotency-key"],
      sessionId: req.headers["x-owl-session-id"],
      body,
    });
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      ok: true,
      apiVersion: "0.1",
      requestId: body.id,
      result: {
        apiVersion: "0.1",
        runtimeVersion: "test-runtime",
        transport: "in-process",
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
    observed,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function callRuntimeInfo(mcpUrl, { owner, clientIdempotencyKey } = {}) {
  const client = new Client({ name: "replay-scope-test", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
    requestInit: {
      headers: {
        "x-owl-owner-id": owner,
        ...(clientIdempotencyKey
          ? { "x-owl-idempotency-key": clientIdempotencyKey }
          : {}),
      },
    },
  });
  await client.connect(transport);
  try {
    const result = await client.callTool({
      name: "runtime_info",
      arguments: {},
    });
    expect(result.isError).not.toBe(true);
  } finally {
    await transport.close();
  }
}

describe("OWL MCP replay scope", () => {
  it("does not reuse Runtime replay keys across fresh MCP transports for the same owner", async () => {
    const runtime = await startFakeRuntime();
    const mcp = await startOwlMcpHttpServer({
      port: 0,
      runtimeBaseUrl: runtime.baseUrl,
    });
    closers.push(() => mcp.close());

    await callRuntimeInfo(mcp.url, { owner: "same-logical-owner" });
    await callRuntimeInfo(mcp.url, { owner: "same-logical-owner" });

    expect(runtime.observed).toHaveLength(2);
    expect(runtime.observed[0].sessionId).toBe(runtime.observed[1].sessionId);
    expect(runtime.observed[0].idempotencyKey).toBeTruthy();
    expect(runtime.observed[1].idempotencyKey).toBeTruthy();
    expect(runtime.observed[0].idempotencyKey).not.toBe(
      runtime.observed[1].idempotencyKey,
    );
  }, 30_000);

  it("allows an explicit client idempotency key to survive a fresh MCP transport", async () => {
    const runtime = await startFakeRuntime();
    const mcp = await startOwlMcpHttpServer({
      port: 0,
      runtimeBaseUrl: runtime.baseUrl,
    });
    closers.push(() => mcp.close());

    await callRuntimeInfo(mcp.url, {
      owner: "same-logical-owner",
      clientIdempotencyKey: "client-retry-token-1",
    });
    await callRuntimeInfo(mcp.url, {
      owner: "same-logical-owner",
      clientIdempotencyKey: "client-retry-token-1",
    });

    expect(runtime.observed).toHaveLength(2);
    expect(runtime.observed[0].sessionId).toBe(runtime.observed[1].sessionId);
    expect(runtime.observed[0].idempotencyKey).toBe(
      runtime.observed[1].idempotencyKey,
    );
  }, 30_000);
});
