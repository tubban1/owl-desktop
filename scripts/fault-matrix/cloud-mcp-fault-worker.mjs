#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { startOwlMcpHttpServer } from "../../mcp/http-server.mjs";
import { CloudMcpCallConsumer } from "../../connection-host/cloud-mcp-call-consumer.mjs";
import { CloudMcpCompletionStore } from "../../connection-host/cloud-mcp-completion-store.mjs";
import { LocalMcpExecutor } from "../../connection-host/local-mcp-executor.mjs";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required ${name}.`);
  return value;
}

const phase = required("OWL_FAULT_PHASE");
const runtimeBaseUrl = required("OWL_FAULT_RUNTIME_URL");
const runtimeToken = required("OWL_FAULT_RUNTIME_TOKEN");
const completionRoot = required("OWL_FAULT_COMPLETION_ROOT");
const targetFile = required("OWL_FAULT_TARGET_FILE");
const resultFile = required("OWL_FAULT_RESULT_FILE");
const markerFile = process.env.OWL_FAULT_MARKER_FILE?.trim() || "";
const callId = process.env.OWL_FAULT_CALL_ID?.trim() || "mcp_fault_once";
const ownerId = process.env.OWL_FAULT_OWNER_ID?.trim() || "owl-fault-matrix-owner";
const requestDigest =
  process.env.OWL_FAULT_REQUEST_DIGEST?.trim() || "fault-matrix-request-v1";

const call = {
  callId,
  ownerId,
  toolName: "primitive_call",
  arguments: {
    primitive: "fs.write",
    op: "append",
    args: {
      path: targetFile,
      content: "once\n",
    },
  },
  requestDigest,
  status: "dispatched",
};

fs.mkdirSync(path.dirname(resultFile), { recursive: true });
fs.mkdirSync(completionRoot, { recursive: true });

const mcp = await startOwlMcpHttpServer({
  port: 0,
  runtimeBaseUrl,
  runtimeToken,
});

const baseExecutor = new LocalMcpExecutor({
  mcpUrl: mcp.url,
  callTimeoutMs: 30_000,
  connectTimeoutMs: 5_000,
});

let executeCount = 0;
let completionAttempts = 0;
let claimAttempts = 0;
let pullAttempts = 0;
const duplicateBatch = phase === "f3-duplicate";
let firstPull = true;

const executor = {
  probe: (...args) => baseExecutor.probe(...args),
  snapshot: () => baseExecutor.snapshot(),
  async execute(input) {
    executeCount += 1;
    const result = await baseExecutor.execute(input);
    if (phase === "f5-crash-window") {
      if (!markerFile) throw new Error("F5 crash window requires marker file.");
      fs.writeFileSync(
        markerFile,
        JSON.stringify({
          runtimeReturned: true,
          callId,
          executeCount,
          at: new Date().toISOString(),
        }),
        { mode: 0o600 },
      );
      // Parent SIGKILLs this Host-like worker here: Runtime has committed its
      // durable replay receipt, but Desktop has not journaled completion yet.
      await new Promise(() => {});
    }
    return result;
  },
};

const cloudClient = {
  async pullMcpCalls() {
    pullAttempts += 1;
    if (!firstPull) return { calls: [] };
    firstPull = false;
    return { calls: duplicateBatch ? [call, call] : [call] };
  },
  async claimMcpCall(id) {
    claimAttempts += 1;
    if (id !== callId) throw new Error("Unexpected call id.");
    return { ...call, status: "executing" };
  },
  async completeMcpCall(id, payload) {
    completionAttempts += 1;
    if (id !== callId) throw new Error("Unexpected completion call id.");
    if (phase === "f4-ack-loss") {
      throw Object.assign(
        new Error("Injected completion acknowledgement loss."),
        { code: "CLOUD_NETWORK_ERROR" },
      );
    }
    return { ...call, status: payload?.error ? "failed" : "completed" };
  },
};

const completionStore = new CloudMcpCompletionStore({
  root: completionRoot,
});

const consumer = new CloudMcpCallConsumer({
  cloudClient,
  executor,
  completionStore,
  claimantId: `fault-worker:${phase}`,
  pollIntervalMs: 60_000,
  leaseMs: 5_000,
});

let snapshot;
let fatal = null;
try {
  snapshot = await consumer.start();
} catch (error) {
  fatal = {
    code: error?.code ?? error?.name ?? "ERROR",
    message: error instanceof Error ? error.message : String(error),
  };
  snapshot = consumer.snapshot();
} finally {
  await consumer.stop().catch(() => undefined);
  await mcp.close().catch(() => undefined);
}

const result = {
  ok: !fatal,
  phase,
  callId,
  executeCount,
  pullAttempts,
  claimAttempts,
  completionAttempts,
  completionPending: completionStore.snapshot().pending,
  consumer: snapshot,
  fatal,
};

fs.writeFileSync(resultFile, JSON.stringify(result, null, 2) + "\n", {
  mode: 0o600,
});
console.log(JSON.stringify(result));
if (fatal) process.exitCode = 1;
