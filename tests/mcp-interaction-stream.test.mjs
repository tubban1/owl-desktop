import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startOwlMcpHttpServer } from "../mcp/http-server.mjs";

const closers = [];

afterEach(async () => {
  while (closers.length) await closers.pop()?.();
});

async function startRuntime() {
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const rpc = body ? JSON.parse(body) : {};
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      ok: true,
      apiVersion: "0.1",
      result:
        rpc.method === "primitive.call"
          ? {
              exitCode: 0,
              stdout: "actual runtime output",
              credential: "must-not-leak",
            }
          : { apiVersion: "0.1", runtimeVersion: "test-runtime" },
    }));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  closers.push(() => new Promise((resolve) => server.close(resolve)));
  return "http://127.0.0.1:" + server.address().port;
}

describe("MCP real interaction stream", () => {
  it("emits paired request/response events with real bounded payload and redaction", async () => {
    const events = [];
    const mcp = await startOwlMcpHttpServer({
      port: 0,
      runtimeBaseUrl: await startRuntime(),
      onEvent(level, message, meta) {
        events.push({ level, message, meta });
      },
    });
    closers.push(() => mcp.close());

    const client = new Client({ name: "interaction-stream", version: "0.1.0" });
    const transport = new StreamableHTTPClientTransport(new URL(mcp.url), {
      requestInit: {
        headers: {
          "x-owl-owner-id": "chat-a",
          "x-owl-client-kind": "chatgpt",
          "x-owl-client-label": "Chat A",
        },
      },
    });
    await client.connect(transport);
    closers.push(() => transport.close().catch(() => undefined));

    const result = await client.callTool({
      name: "primitive_call",
      arguments: {
        primitive: "test.echo",
        op: "run",
        args: {
          command: "npm test",
          password: "super-secret",
        },
      },
    });
    expect(result.isError).not.toBe(true);

    const interactions = events.filter(
      (event) => event.meta?.eventKind === "mcp_interaction",
    );
    expect(interactions).toHaveLength(2);
    const request = interactions.find((event) => event.meta.phase === "request");
    const response = interactions.find((event) => event.meta.phase === "response");

    expect(request).toMatchObject({
      message: "MCP interaction request",
      meta: {
        tool: "primitive_call",
        clientKind: "chatgpt",
        clientLabel: "Chat A",
        status: "running",
      },
    });
    expect(request.meta.payload).toContain("npm test");
    expect(request.meta.payload).toContain("[redacted]");
    expect(request.meta.payload).not.toContain("super-secret");

    expect(response).toMatchObject({
      message: "MCP interaction response",
      meta: {
        tool: "primitive_call",
        status: "success",
      },
    });
    expect(response.meta.payload).toContain("actual runtime output");
    expect(response.meta.payload).toContain("[redacted]");
    expect(response.meta.payload).not.toContain("must-not-leak");
    expect(response.meta.interactionId).toBe(request.meta.interactionId);
    const diag=await (await fetch(new URL(mcp.url).origin+"/diagnostics")).json();
    const timing=diag.recentMcpCalls.find(item=>item.tool==="primitive_call");
    expect(timing).toMatchObject({primitive:"test.echo",primitiveOp:"run"});
    expect(timing).not.toHaveProperty("args");
    expect(JSON.stringify(timing)).not.toContain("super-secret");
    const longSync=await client.callTool({name:"primitive_call",arguments:{
      primitive:"sys.exec",op:"run",args:{command:"sleep 200",timeout_ms:180000},
    }});
    expect(longSync.isError).toBe(true);
    expect(JSON.stringify(longSync)).toContain("LONG_SYNC_EXEC_REQUIRES_DURABLE_PROCESS");
    const latest=await (await fetch(new URL(mcp.url).origin+"/diagnostics")).json();
    expect(latest.recentMcpCalls.some(x=>x.tool==="primitive_call"
      && x.toolErrorCode==="LONG_SYNC_EXEC_REQUIRES_DURABLE_PROCESS")).toBe(true);
  });
});
