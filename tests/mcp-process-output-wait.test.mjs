import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startOwlMcpHttpServer } from "../mcp/http-server.mjs";

const closers = [];

afterEach(async () => {
  while (closers.length) await closers.pop()?.();
});

function sample(stdout, { running = true, status = "running", exitCode = null } = {}) {
  return {
    processId: "process_test",
    running,
    status,
    exitCode,
    stdout,
    stderr: "",
    recoveredAfterRestart: false,
  };
}

async function startProcessRuntime(sequence) {
  let outputCalls = 0;
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    let result = { apiVersion: "0.1", runtimeVersion: "test-runtime" };

    if (
      body.method === "primitive.call" &&
      body.params?.primitive === "process.manage" &&
      body.params?.op === "output"
    ) {
      const index = Math.min(outputCalls, sequence.length - 1);
      result = { result: sequence[index] };
      outputCalls += 1;
    }

    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        ok: true,
        apiVersion: "0.1",
        requestId: body.id,
        result,
      }),
    );
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  closers.push(() => new Promise((resolve) => server.close(resolve)));

  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    outputCalls: () => outputCalls,
  };
}

async function connect(runtimeBaseUrl, owner = "process-output-owner") {
  const mcp = await startOwlMcpHttpServer({ port: 0, runtimeBaseUrl });
  closers.push(() => mcp.close());

  const client = new Client({ name: "process-output-test", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(mcp.url), {
    requestInit: { headers: { "x-owl-owner-id": owner } },
  });
  await client.connect(transport);
  closers.push(() => transport.close().catch(() => undefined));
  return client;
}

function value(result) {
  return JSON.parse(result.content[0].text);
}

describe("OWL MCP managed process output wait", () => {
  it("returns a cursor immediately on the first durable output read", async () => {
    const runtime = await startProcessRuntime([sample("alpha")]);
    const client = await connect(runtime.baseUrl);

    const result = value(
      await client.callTool({
        name: "get_process_output",
        arguments: { process_id: "process_test", tail_chars: 4000 },
      }),
    );

    expect(result).toMatchObject({
      processId: "process_test",
      running: true,
      stdout: "alpha",
      changed: true,
      pollCount: 1,
    });
    expect(result.cursor).toMatch(/^[a-f0-9]{32}$/);
    expect(runtime.outputCalls()).toBe(1);
  });

  it("waits only until durable output changes and then returns immediately", async () => {
    const runtime = await startProcessRuntime([
      sample("alpha"),
      sample("alpha"),
      sample("alpha"),
      sample("beta"),
    ]);
    const client = await connect(runtime.baseUrl, "process-output-change-owner");

    const first = value(
      await client.callTool({
        name: "get_process_output",
        arguments: { process_id: "process_test" },
      }),
    );

    const second = value(
      await client.callTool({
        name: "get_process_output",
        arguments: {
          process_id: "process_test",
          after_cursor: first.cursor,
          wait_ms: 2000,
        },
      }),
    );

    expect(second).toMatchObject({
      stdout: "beta",
      changed: true,
    });
    expect(second.cursor).not.toBe(first.cursor);
    expect(second.pollCount).toBeGreaterThan(1);
    expect(second.waitedMs).toBeLessThan(2000);
  });

  it("returns unchanged after the bounded wait instead of holding the stream open", async () => {
    const runtime = await startProcessRuntime([
      sample("alpha"),
      sample("alpha"),
      sample("alpha"),
      sample("alpha"),
    ]);
    const client = await connect(runtime.baseUrl, "process-output-timeout-owner");

    const first = value(
      await client.callTool({
        name: "get_process_output",
        arguments: { process_id: "process_test" },
      }),
    );

    const second = value(
      await client.callTool({
        name: "get_process_output",
        arguments: {
          process_id: "process_test",
          after_cursor: first.cursor,
          wait_ms: 250,
        },
      }),
    );

    expect(second.changed).toBe(false);
    expect(second.cursor).toBe(first.cursor);
    expect(second.pollCount).toBeGreaterThan(1);
    expect(second.waitedMs).toBeGreaterThanOrEqual(200);
    expect(second.waitedMs).toBeLessThan(1500);
  });

  it("does not wait when the process has already become terminal", async () => {
    const terminal = sample("done", {
      running: false,
      status: "exited",
      exitCode: 0,
    });
    const runtime = await startProcessRuntime([terminal, terminal]);
    const client = await connect(runtime.baseUrl, "process-output-terminal-owner");

    const first = value(
      await client.callTool({
        name: "get_process_output",
        arguments: { process_id: "process_test" },
      }),
    );

    const second = value(
      await client.callTool({
        name: "get_process_output",
        arguments: {
          process_id: "process_test",
          after_cursor: first.cursor,
          wait_ms: 5000,
        },
      }),
    );

    expect(second).toMatchObject({
      running: false,
      status: "exited",
      exitCode: 0,
      changed: false,
      pollCount: 1,
    });
    expect(second.waitedMs).toBeLessThan(500);
  });
});
