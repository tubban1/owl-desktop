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

async function rawInitialize(url, ownerId) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "x-owl-owner-id": ownerId,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: {
          name: "raw-owner-takeover-test",
          version: "0.1.0",
        },
      },
    }),
  });
  expect(response.ok).toBe(true);
  const sessionId = response.headers.get("mcp-session-id");
  expect(sessionId).toBeTruthy();
  await response.text();
  return sessionId;
}

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
  }, 60_000);

  it("supersedes stale inactive transports for the same logical owner", async () => {
    const runtime = await startFakeRuntime();
    const events = [];
    const mcp = await startOwlMcpHttpServer({
      port: 0,
      runtimeBaseUrl: runtime.baseUrl,
      sessionIdleTtlMs: 60_000,
      ownerSupersedeGraceMs: 1_000,
      maxSessions: 128,
      onEvent: (level, message, context) => {
        events.push({ level, message, context });
      },
    });
    closers.push(() => mcp.close());

    const first = await rawInitialize(mcp.url, "owner-takeover-test");
    expect(mcp.sessionCount()).toBe(1);

    await new Promise((resolve) => setTimeout(resolve, 1_100));

    const second = await rawInitialize(mcp.url, "owner-takeover-test");
    expect(second).not.toBe(first);
    expect(mcp.sessionCount()).toBe(1);
    expect(mcp.snapshot().sessions[0].transportSessionId).toBe(second);

    const takeover = events.find(
      (event) =>
        event.message === "MCP stale owner transports superseded" &&
        event.context?.reason === "owner_superseded",
    );
    expect(takeover?.context?.reclaimedCount).toBe(1);
    expect(takeover?.context?.reclaimedTransportSessionIds).toContain(first);
  }, 20_000);

  it("never supersedes a live event stream for the same logical owner", async () => {
    const runtime = await startFakeRuntime();
    const mcp = await startOwlMcpHttpServer({
      port: 0,
      runtimeBaseUrl: runtime.baseUrl,
      sessionIdleTtlMs: 60_000,
      ownerSupersedeGraceMs: 1_000,
      maxSessions: 128,
    });
    closers.push(() => mcp.close());

    const client = new Client({
      name: "owner-takeover-live-stream",
      version: "0.1.0",
    });
    const transport = new StreamableHTTPClientTransport(new URL(mcp.url), {
      requestInit: {
        headers: { "x-owl-owner-id": "owner-takeover-live-stream" },
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
    const live = mcp.snapshot().sessions.find(
      (session) => session.activeRequestCount > 0,
    );
    expect(live).toBeTruthy();

    await new Promise((resolve) => setTimeout(resolve, 1_100));

    const replacement = await rawInitialize(
      mcp.url,
      "owner-takeover-live-stream",
    );
    expect(replacement).not.toBe(live.transportSessionId);
    expect(mcp.sessionCount()).toBe(2);
    expect(
      mcp.snapshot().sessions.some(
        (session) =>
          session.transportSessionId === live.transportSessionId &&
          session.activeRequestCount > 0,
      ),
    ).toBe(true);

    await transport.close();
  }, 20_000);
});
