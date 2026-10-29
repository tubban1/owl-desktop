import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { startOwlMcpHttpServer } from "../mcp/http-server.mjs";
import { LocalMcpExecutor } from "../connection-host/local-mcp-executor.mjs";

const closers = [];
afterEach(async () => {
  while (closers.length) await closers.pop()?.();
});

async function fakeRuntime() {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    requests.push({ body, headers: req.headers });
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      ok: true,
      apiVersion: "0.1",
      requestId: body.id,
      result: {
        apiVersion: "0.1",
        runtimeVersion: "parity-runtime",
      },
    }));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  closers.push(() => new Promise((resolve) => server.close(resolve)));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
  };
}

describe("LocalMcpExecutor", () => {
  it("proves local MCP readiness without executing a Runtime tool", async () => {
    const runtime = await fakeRuntime();
    const mcp = await startOwlMcpHttpServer({
      port: 0,
      runtimeBaseUrl: runtime.url,
    });
    closers.push(() => mcp.close());

    const executor = new LocalMcpExecutor({ mcpUrl: mcp.url });
    const proof = await executor.probe();

    expect(proof.lastProofAt).toBeTruthy();
    expect(proof.lastError).toBeNull();
    expect(runtime.requests).toHaveLength(0);
  });

  it("checks lightweight health without initializing another MCP transport", async () => {
    const runtime = await fakeRuntime();
    const events=[];
    const mcp = await startOwlMcpHttpServer({
      port:0,runtimeBaseUrl:runtime.url,
      onEvent:(_level,message)=>events.push(message),
    });
    closers.push(()=>mcp.close());
    const executor=new LocalMcpExecutor({mcpUrl:mcp.url});
    await executor.probe();
    const openedBefore=events.filter(x=>x==="MCP transport session opened").length;
    const fullProofAt=executor.snapshot().lastProofAt;
    expect(openedBefore).toBe(1);
    await executor.probeLightweight();
    await executor.probeLightweight();
    expect(executor.snapshot()).toMatchObject({
      lastProofAt:fullProofAt,lastError:null,
    });
    expect(executor.snapshot().lastLivenessProofAt).toBeTruthy();
    expect(events.filter(x=>x==="MCP transport session opened")).toHaveLength(1);
    // Each /health request proves downstream Runtime connectivity,
    // but never registers new MCP tools or owner sessions.
    expect(runtime.requests).toHaveLength(2);
  });

  it("rejects unhealthy liveness and does not falsify the previous full proof", async()=>{
    const executor=new LocalMcpExecutor({mcpUrl:"http://127.0.0.1:1/mcp",connectTimeoutMs:500});
    await expect(executor.probeLightweight()).rejects.toThrow();
    expect(executor.snapshot().lastProofAt).toBeNull();
    expect(executor.snapshot().lastError).toBeTruthy();
  });

  it("reuses one stable Runtime idempotency identity across fresh MCP transports", async () => {
    const runtime = await fakeRuntime();
    const mcp = await startOwlMcpHttpServer({
      port: 0,
      runtimeBaseUrl: runtime.url,
    });
    closers.push(() => mcp.close());

    const executor = new LocalMcpExecutor({ mcpUrl: mcp.url });
    const first = await executor.execute({
      callId: "mcp_stable_1",
      ownerId: "planner-explicit-1",
      toolName: "runtime_info",
      arguments: {},
    });
    const second = await executor.execute({
      callId: "mcp_stable_1",
      ownerId: "planner-explicit-1",
      toolName: "runtime_info",
      arguments: {},
    });

    expect(first.isError).not.toBe(true);
    expect(second.isError).not.toBe(true);
    expect(runtime.requests.length).toBe(2);
    expect(runtime.requests[0].headers["x-owl-idempotency-key"]).toBeTruthy();
    expect(runtime.requests[1].headers["x-owl-idempotency-key"]).toBe(
      runtime.requests[0].headers["x-owl-idempotency-key"],
    );
    expect(runtime.requests[1].headers["x-owl-session-id"]).toBe(
      runtime.requests[0].headers["x-owl-session-id"],
    );
    expect(executor.snapshot().lastProofAt).toBeTruthy();
  });

  it("isolates calls with no proven planner owner instead of merging conversations", async () => {
    const runtime = await fakeRuntime();
    const mcp = await startOwlMcpHttpServer({
      port: 0,
      runtimeBaseUrl: runtime.url,
    });
    closers.push(() => mcp.close());

    const executor = new LocalMcpExecutor({ mcpUrl: mcp.url });
    await executor.execute({
      callId: "mcp_isolated_a",
      toolName: "runtime_info",
      arguments: {},
    });
    await executor.execute({
      callId: "mcp_isolated_b",
      toolName: "runtime_info",
      arguments: {},
    });

    expect(runtime.requests.length).toBe(2);
    expect(runtime.requests[0].headers["x-owl-session-id"]).not.toBe(
      runtime.requests[1].headers["x-owl-session-id"],
    );
  });
});
