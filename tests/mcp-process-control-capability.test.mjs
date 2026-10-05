import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startOwlMcpHttpServer } from "../mcp/http-server.mjs";

const closers = [];

afterEach(async () => {
  while (closers.length) await closers.pop()?.();
});

async function startFakeRuntime() {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    calls.push(body);

    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      ok: true,
      apiVersion: "0.1",
      requestId: body.id,
      result:
        body.method === "runtime.info"
          ? { apiVersion: "0.1", runtimeVersion: "test-runtime" }
          : { result: { ok: true } },
    }));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  closers.push(() => new Promise((resolve) => server.close(resolve)));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    calls,
  };
}

async function connect(runtimeBaseUrl, owner) {
  const mcp = await startOwlMcpHttpServer({ port: 0, runtimeBaseUrl });
  closers.push(() => mcp.close());

  const client = new Client({ name: "process-control-test", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(mcp.url), {
    requestInit: { headers: { "x-owl-owner-id": owner } },
  });
  await client.connect(transport);
  closers.push(() => transport.close().catch(() => undefined));
  return client;
}

describe("OWL MCP durable process control capability", () => {
  it("publishes control_token on process mutation tools", async () => {
    const runtime = await startFakeRuntime();
    const client = await connect(runtime.baseUrl, "schema-owner");
    const listed = await client.listTools();

    for (const name of ["send_process_input", "kill_process"]) {
      const tool = listed.tools.find((candidate) => candidate.name === name);
      expect(tool, `missing tool ${name}`).toBeTruthy();
      expect(tool.inputSchema?.properties).toHaveProperty("control_token");
    }
  });

  it("forwards control_token unchanged to Runtime process.manage", async () => {
    const runtime = await startFakeRuntime();
    const client = await connect(runtime.baseUrl, "caller-after-reconnect");
    const token = "process-control-capability-token-1234567890";

    await client.callTool({
      name: "send_process_input",
      arguments: {
        process_id: "process_demo",
        input: "continue\n",
        control_token: token,
      },
    });
    await client.callTool({
      name: "kill_process",
      arguments: {
        process_id: "process_demo",
        signal: "SIGTERM",
        control_token: token,
      },
    });

    const processCalls = runtime.calls.filter(
      (body) =>
        body.method === "primitive.call" &&
        body.params?.primitive === "process.manage",
    );
    expect(processCalls).toHaveLength(2);
    expect(processCalls[0].params).toMatchObject({
      op: "input",
      args: {
        process_id: "process_demo",
        input: "continue\n",
        control_token: token,
      },
    });
    expect(processCalls[1].params).toMatchObject({
      op: "kill",
      args: {
        process_id: "process_demo",
        signal: "SIGTERM",
        control_token: token,
      },
    });
  });
});
