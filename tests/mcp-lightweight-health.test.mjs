import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { startOwlMcpHttpServer } from "../mcp/http-server.mjs";

const closers = [];
afterEach(async () => { while (closers.length) await closers.pop()(); });

async function runtime() {
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      ok: true, apiVersion: "0.1", requestId: data.id,
      result: { apiVersion: "0.1", runtimeVersion: "test" },
    }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  closers.push(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

describe("MCP lightweight health and bounded latency diagnostics", () => {
  it("does not serialize checkpoint history on readiness probes", async () => {
    const hugePrivateHistory = { owners: Array.from({ length: 50 }, (_, i) => ({
      ownerId: `historic-${i}`, checkpoint: { summary: "history".repeat(600) },
    })) };
    let heavyReads = 0;
    let lightReads = 0;
    const plannerContinuation = {
      recoverConnectedTransports: () => {},
      healthSummary: () => { lightReads += 1; return { ownerCount: 50, connectedOwnerCount: 0, activeCheckpointCount: 34 }; },
      summary: () => { heavyReads += 1; return hugePrivateHistory; },
    };
    const server = await startOwlMcpHttpServer({
      port: 0, runtimeBaseUrl: await runtime(), plannerContinuation,
    });
    closers.push(() => server.close());
    const base = new URL(server.url).origin;

    for (let i = 0; i < 4; i += 1) {
      const response = await fetch(`${base}/health`);
      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body.length).toBeLessThan(1500);
      expect(body).not.toContain("historic-");
      expect(JSON.parse(body).plannerContinuation.activeCheckpointCount).toBe(34);
    }
    expect(heavyReads).toBe(0);
    expect(lightReads).toBe(4);

    const diagnostic = await (await fetch(`${base}/diagnostics`)).json();
    expect(diagnostic.plannerContinuation.owners).toHaveLength(50);
    expect(heavyReads).toBe(1);
    expect(diagnostic.mcpLatency.sampleCount).toBe(0);
  });

  it("records bounded, payload-free MCP request timing", async () => {
    const server = await startOwlMcpHttpServer({
      port: 0, runtimeBaseUrl: await runtime(),
    });
    closers.push(() => server.close());
    const base = new URL(server.url).origin;
    const response = await fetch(server.url, { method: "POST", headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    }, body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2025-11-25", capabilities: {},
        clientInfo: { name: "health-regression", version: "1.0.0" } },
    }) });
    expect(response.ok).toBe(true);
    await response.text();
    const health = await (await fetch(`${base}/health`)).json();
    expect(health.mcpLatency.sampleCount).toBe(1);
    expect(health.mcpLatency.p50Ms).toBeGreaterThanOrEqual(0);
    const diagnostics = await (await fetch(`${base}/diagnostics`)).json();
    expect(diagnostics.recentMcpCalls[0]).toMatchObject({ method: "initialize", status: 200 });
    expect(diagnostics.recentMcpCalls[0]).not.toHaveProperty("params");
    expect(diagnostics.recentMcpCalls[0]).not.toHaveProperty("requestBody");
  });
});
