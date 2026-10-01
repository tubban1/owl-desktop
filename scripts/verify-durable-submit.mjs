#!/usr/bin/env node
import assert from "node:assert/strict";
import http from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startOwlMcpHttpServer } from "../mcp/http-server.mjs";

const observed = [];
const taskId = "task_durable_submit_1";

const runtime = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  observed.push({
    method: body.method,
    sessionId: req.headers["x-owl-session-id"],
    idempotencyKey: req.headers["x-owl-idempotency-key"],
  });
  let result;
  if (body.method === "tasks.create") {
    result = { id: taskId, status: "pending" };
  } else if (body.method === "tasks.start") {
    result = {
      accepted: true,
      taskId,
      status: "running",
      progress: { revision: 1, terminal: false },
    };
  } else if (body.method === "tasks.list") {
    result = [{ id: taskId, status: "running" }];
  } else {
    result = { ok: true };
  }

  res.statusCode = 200;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({
    ok: true,
    apiVersion: "0.1",
    requestId: body.id,
    result,
  }));
});
await new Promise((resolve, reject) => {
  runtime.once("error", reject);
  runtime.listen(0, "127.0.0.1", resolve);
});
const runtimeAddress = runtime.address();
const runtimeBaseUrl =
  `http://127.0.0.1:${runtimeAddress.port}`;

const mcp = await startOwlMcpHttpServer({
  port: 0,
  runtimeBaseUrl,
  fallbackOwnerId: "owl-desktop:persistent-test-session",
});

async function connect(label) {
  const client = new Client({
    name: `durable-submit-${label}`,
    version: "0.1.0",
  });
  const transport = new StreamableHTTPClientTransport(
    new URL(mcp.url),
  );
  await client.connect(transport);
  return { client, transport };
}

async function submit(connection) {
  const result = await connection.client.callTool({
    name: "task_submit",
    arguments: {
      submission_id: "user-request-42",
      label: "Durable submit recovery test",
      steps: [{
        id: "step-1",
        action: "fs.write",
        args: { path: "/tmp/example", content: "x" },
      }],
    },
  });
  assert.notEqual(result.isError, true);
  return JSON.parse(
    result.content.filter((part) => part.type === "text")
      .map((part) => part.text).join("\n"),
  );
}
const first = await connect("first");
const firstResult = await submit(first);
assert.equal(firstResult.taskId, taskId);
assert.equal(firstResult.accepted, true);
await first.transport.close();

const second = await connect("second");
const listed = await second.client.callTool({
  name: "task_list",
  arguments: { active_only: true },
});
assert.notEqual(listed.isError, true);
const tasks = JSON.parse(
  listed.content.filter((part) => part.type === "text")
    .map((part) => part.text).join("\n"),
);
assert.equal(tasks.some((task) => task.id === taskId), true);

const retryResult = await submit(second);
assert.equal(retryResult.taskId, taskId);
await second.transport.close();
const createCalls = observed.filter(
  (entry) => entry.method === "tasks.create",
);
const startCalls = observed.filter(
  (entry) => entry.method === "tasks.start",
);
assert.equal(createCalls.length, 2);
assert.equal(startCalls.length, 2);
assert.equal(
  createCalls[0].idempotencyKey,
  createCalls[1].idempotencyKey,
);
assert.equal(
  startCalls[0].idempotencyKey,
  startCalls[1].idempotencyKey,
);

const sessions = new Set(
  observed.map((entry) => entry.sessionId),
);
assert.equal(sessions.size, 1);

await mcp.close();
await new Promise((resolve) => runtime.close(resolve));

console.log(JSON.stringify({
  ok: true,
  taskId,
  transports: 2,
  stableRuntimeSessions: sessions.size,
  createReplayStable:
    createCalls[0].idempotencyKey ===
    createCalls[1].idempotencyKey,
  startReplayStable:
    startCalls[0].idempotencyKey ===
    startCalls[1].idempotencyKey,
  rediscovered: true,
}, null, 2));
