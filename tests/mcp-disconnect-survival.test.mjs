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

async function startDelayedRuntime(delayMs = 180) {
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
    await new Promise((resolve) => setTimeout(resolve, delayMs));
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

  it("does not reclaim a live Streamable HTTP event stream after the idle TTL", async () => {
    const runtime = await startDelayedRuntime();
    const mcp = await startOwlMcpHttpServer({
      port: 0,
      runtimeBaseUrl: runtime.baseUrl,
      sessionIdleTtlMs: 1_000,
      maxSessions: 8,
    });
    closers.push(() => mcp.close());

    const client = new Client({
      name: "live-stream-survival-test",
      version: "0.1.0",
    });
    const transport = new StreamableHTTPClientTransport(new URL(mcp.url), {
      requestInit: {
        headers: { "x-owl-owner-id": "live-stream-survival-owner" },
      },
    });
    await client.connect(transport);

    const streamDeadline = Date.now() + 2_000;
    while (
      Date.now() < streamDeadline &&
      !mcp.snapshot().sessions.some((session) => session.activeRequestCount > 0)
    ) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    expect(
      mcp.snapshot().sessions.some((session) => session.activeRequestCount > 0),
    ).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 1_100));

    expect(mcp.sessionCount()).toBe(1);
    const result = await client.callTool({
      name: "runtime_info",
      arguments: {},
    });
    expect(result.isError).not.toBe(true);

    await transport.close();
  }, 20_000);

  it("does not reclaim an in-flight MCP session after the idle TTL elapses", async () => {
    const runtime = await startDelayedRuntime(1_500);
    const mcp = await startOwlMcpHttpServer({
      port: 0,
      runtimeBaseUrl: runtime.baseUrl,
      sessionIdleTtlMs: 1_000,
      maxSessions: 8,
    });
    closers.push(() => mcp.close());

    const client = new Client({
      name: "inflight-session-survival-test",
      version: "0.1.0",
    });
    const transport = new StreamableHTTPClientTransport(new URL(mcp.url), {
      requestInit: {
        headers: { "x-owl-owner-id": "inflight-session-survival-owner" },
      },
    });
    await client.connect(transport);

    const pending = client.callTool({
      name: "runtime_info",
      arguments: {},
    });

    await Promise.race([
      runtime.waitUntilReceived(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Runtime never accepted the MCP request.")), 5_000),
      ),
    ]);

    await new Promise((resolve) => setTimeout(resolve, 1_100));

    expect(mcp.sessionCount()).toBe(1);
    const snapshot = mcp.snapshot();
    expect(snapshot.sessions).toHaveLength(1);
    expect(snapshot.sessions[0].activeRequestCount).toBeGreaterThan(0);

    const result = await pending;
    expect(result.isError).not.toBe(true);
    expect(runtime.completed()).toBe(1);

    await transport.close();
  }, 20_000);
});
