import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startOwlMcpHttpServer } from "../mcp/http-server.mjs";
import { resolveOwnerIdentity } from "../mcp/owner-identity.mjs";
import { PlannerContinuationStore } from "../electron/services/planner-continuation-store.mjs";

const closers = [];
const roots = [];

afterEach(async () => {
  while (closers.length) await closers.pop()?.();
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

async function startRuntime() {
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const rpc = body ? JSON.parse(body) : {};
    const result =
      rpc.method === "info"
        ? { apiVersion: "0.1", runtimeVersion: "test-runtime" }
        : {};
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true, apiVersion: "0.1", result }));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  closers.push(() => new Promise((resolve) => server.close(resolve)));
  return "http://127.0.0.1:" + server.address().port;
}

async function connect(url, name) {
  const client = new Client({ name, version: "1.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(url));
  await client.connect(transport);
  closers.push(() => transport.close().catch(() => undefined));
  return client;
}

describe("MCP owner identity", () => {
  it("derives a stable owner from an unlabelled MCP transport instead of the Desktop fallback", () => {
    const first = resolveOwnerIdentity({}, "transport-a", "desktop-global");
    const same = resolveOwnerIdentity({}, "transport-a", "desktop-global");
    const second = resolveOwnerIdentity({}, "transport-b", "desktop-global");

    expect(first).toMatchObject({
      stable: true,
      source: "transport-session",
      clientKind: "mcp",
    });
    expect(same.runtimeSessionId).toBe(first.runtimeSessionId);
    expect(second.runtimeSessionId).not.toBe(first.runtimeSessionId);
  });

  it("uses the Desktop fallback only for an explicitly labelled Desktop client", () => {
    const headers = { "x-owl-client-kind": "desktop" };
    const first = resolveOwnerIdentity(headers, "transport-a", "desktop-global");
    const second = resolveOwnerIdentity(headers, "transport-b", "desktop-global");

    expect(first).toMatchObject({
      stable: true,
      source: "desktop-session",
      clientKind: "desktop",
    });
    expect(second.runtimeSessionId).toBe(first.runtimeSessionId);
  });

  it("keeps implicit workstreams isolated across two headerless MCP sessions", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "owl-owner-identity-"));
    roots.push(root);
    const continuation = new PlannerContinuationStore({
      file: path.join(root, "planner-continuation.json"),
    });
    const runtimeBaseUrl = await startRuntime();
    const mcp = await startOwlMcpHttpServer({
      port: 0,
      runtimeBaseUrl,
      fallbackOwnerId: "desktop-global",
      plannerContinuation: continuation,
    });
    closers.push(() => mcp.close());

    const chatA = await connect(mcp.url, "chat-a");
    const chatB = await connect(mcp.url, "chat-b");

    await chatA.callTool({ name: "runtime_info", arguments: {} });
    await chatB.callTool({ name: "runtime_info", arguments: {} });
    await chatA.callTool({ name: "runtime_info", arguments: {} });

    const implicitOwners = Object.values(continuation.read().owners).filter(
      (owner) => owner?.workstream?.implicit === true,
    );

    expect(implicitOwners).toHaveLength(2);
    expect(new Set(implicitOwners.map((owner) => owner.ownerId)).size).toBe(2);
    expect(
      implicitOwners.every((owner) => owner.ownerSource === "transport-session"),
    ).toBe(true);
    expect(
      implicitOwners
        .map((owner) => owner.workstream.totalToolSteps)
        .sort((a, b) => a - b),
    ).toEqual([1, 2]);
  }, 30_000);
});
