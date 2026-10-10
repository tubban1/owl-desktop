import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PlannerContinuationStore } from "../electron/services/planner-continuation-store.mjs";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startOwlMcpHttpServer } from "../mcp/http-server.mjs";

const closers = [];
const reconnectSoakCycles = Math.max(
  1,
  Math.min(Number(process.env.OWL_MCP_RECONNECT_SOAK_CYCLES) || 25, 500),
);
const bindingSoakCycles = Math.max(
  1,
  Math.min(Number(process.env.OWL_MCP_BIND_SOAK_CYCLES) || 15, 500),
);

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
      ...(ownerId ? { "x-owl-owner-id": ownerId } : {}),
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

async function rawCall(url, sessionId, method, params, id = 2) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-session-id": sessionId,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  expect(response.status).toBe(200);
  const body = await response.text();
  const data = response.headers.get("content-type")?.includes("text/event-stream")
    ? body.split(/\r?\n/).find((line) => line.startsWith("data: "))?.slice(6)
    : body;
  expect(data).toBeTruthy();
  return JSON.parse(data);
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
  it("reconciles old inactive transports when new no-header sessions bind the same workstream", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "owl-mcp-rebind-"));
    closers.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    const continuation = new PlannerContinuationStore({
      file: path.join(dir, "planner-continuation.json"),
    });
    const runtime = await startFakeRuntime();
    const events = [];
    let tick = 100;
    const mcp = await startOwlMcpHttpServer({
      port: 0,
      runtimeBaseUrl: runtime.baseUrl,
      plannerContinuation: continuation,
      ownerSupersedeGraceMs: 1_000,
      sessionIdleTtlMs: 60_000,
      maxSessions: 8,
      monotonicNow: () => tick,
      onEvent: (level, message, meta) => events.push({ level, message, meta }),
    });
    closers.push(() => mcp.close());

    const first = await rawInitialize(mcp.url);
    const opened = await rawCall(mcp.url, first, "tools/call", {
      name: "workstream_open",
      arguments: { goal: "Long-lived chat workstream", label: "Chat A" },
    });
    expect(opened.error).toBeUndefined();
    const workstreamId = JSON.parse(opened.result.content[0].text).workstreamId;
    expect(workstreamId).toMatch(/^owl-workstream:/);
    expect(mcp.snapshot().sessions[0].ownerSource).toBe("workstream-binding");

    // Each new HTTP transport may start with no x-owl-owner-id header. It
    // only gains its durable identity when the workstream is resumed.
    for (let cycle = 0; cycle < bindingSoakCycles; cycle += 1) {
      tick += 1_100;
      const next = await rawInitialize(mcp.url);
      const resumed = await rawCall(mcp.url, next, "tools/call", {
        name: "workstream_open",
        arguments: { goal: "Long-lived chat workstream", resume_workstream_id: workstreamId },
      }, cycle + 3);
      expect(resumed.error).toBeUndefined();
      expect(JSON.parse(resumed.result.content[0].text).workstreamId).toBe(workstreamId);
      const bound = mcp.snapshot().sessions;
      expect(bound.map((session) => session.transportSessionId)).toEqual([next]);
      expect(bound[0].runtimeSessionId).toBe(workstreamId);
    }

    expect(mcp.sessionCount()).toBe(1);
    expect(events.filter((event) => event.message === "MCP transport session reclaimed" &&
      event.meta?.reason === "session_cap")).toHaveLength(0);
    expect(events.filter((event) => event.message === "MCP stale owner transports superseded")).toHaveLength(bindingSoakCycles);
    expect(continuation.get(workstreamId).workstream.status).toBe("active");
  }, 30_000);

  it("cleans up transport sessions across repeated reconnects", async () => {
    const runtime = await startFakeRuntime();
    const mcp = await startOwlMcpHttpServer({
      port: 0,
      runtimeBaseUrl: runtime.baseUrl,
      sessionIdleTtlMs: 1_000,
      maxSessions: 8,
    });
    closers.push(() => mcp.close());

    for (let index = 0; index < reconnectSoakCycles; index += 1) {
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

    expect(runtime.calls()).toBeGreaterThanOrEqual(reconnectSoakCycles);
    expect(mcp.sessionCount()).toBeLessThanOrEqual(8);

    await new Promise((resolve) => setTimeout(resolve, 1_150));
    expect(mcp.sessionCount()).toBe(0);
  }, 60_000);

  it("uses monotonic time for idle TTL even when the wall clock jumps", async () => {
    const runtime = await startFakeRuntime();
    let monotonicMs = 0;
    const mcp = await startOwlMcpHttpServer({
      port: 0,
      runtimeBaseUrl: runtime.baseUrl,
      sessionIdleTtlMs: 1_000,
      maxSessions: 8,
      monotonicNow: () => monotonicMs,
    });
    closers.push(() => mcp.close());

    await rawInitialize(mcp.url, "clock-skew-session-owner");
    expect(mcp.sessionCount()).toBe(1);

    const realDateNow = Date.now;
    try {
      Date.now = () => realDateNow() + 24 * 60 * 60 * 1000;
      monotonicMs = 500;
      expect(mcp.sessionCount()).toBe(1);

      Date.now = () => realDateNow() - 24 * 60 * 60 * 1000;
      monotonicMs = 1_100;
      expect(mcp.sessionCount()).toBe(0);
    } finally {
      Date.now = realDateNow;
    }
  });

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
