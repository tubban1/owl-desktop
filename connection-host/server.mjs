import express from "express";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { startOwlMcpHttpServer } from "../mcp/http-server.mjs";
import { TunnelSupervisor } from "../electron/services/tunnel-supervisor.mjs";
import { PlannerContinuationStore } from "../electron/services/planner-continuation-store.mjs";
import { createDesktopBridgeRpc } from "./bridge-rpc.mjs";
import { CloudHttpClient } from "../electron/services/cloud-http-client.mjs";
import { CloudMcpCallConsumer } from "./cloud-mcp-call-consumer.mjs";
import { CloudMcpCompletionStore } from "./cloud-mcp-completion-store.mjs";
import { LocalMcpExecutor } from "./local-mcp-executor.mjs";

function required(name, fallback = "") {
  const value = process.env[name]?.trim() || fallback;
  if (!value) throw new Error(`Missing required ${name}.`);
  return value;
}

const runtimeBaseUrl = required("OWL_RUNTIME_URL", "http://127.0.0.1:8788");
const runtimeToken = process.env.OWL_RUNTIME_API_TOKEN?.trim() || undefined;
const mcpToken = process.env.OWL_MCP_API_TOKEN?.trim() || undefined;
const mcpPort = Number(process.env.OWL_MCP_PORT || "8790");
const controlPort = Number(process.env.OWL_CONNECTION_HOST_PORT || "8791");
const controlToken = required("OWL_CONNECTION_HOST_CONTROL_TOKEN");
const desktopBridgeUrl = required(
  "OWL_DESKTOP_CAPABILITY_BRIDGE_URL",
  "http://127.0.0.1:8792",
);
const desktopBridgeToken =
  process.env.OWL_DESKTOP_CAPABILITY_BRIDGE_TOKEN?.trim() || controlToken;
const userDataRoot = path.resolve(
  required(
    "OWL_DESKTOP_USER_DATA_DIR",
    path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "OWL LAB",
      "desktop",
    ),
  ),
);
const fallbackOwnerId =
  process.env.OWL_DESKTOP_FALLBACK_OWNER_ID?.trim() || undefined;

fs.mkdirSync(userDataRoot, { recursive: true, mode: 0o700 });

const events = [];
function record(level, source, message, meta = {}) {
  events.unshift({
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    at: new Date().toISOString(),
    level,
    source,
    message,
    meta,
  });
  if (events.length > 400) events.length = 400;
}

async function boundedStep(label, operation, timeoutMs) {
  let timeout;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timeout = setTimeout(() => {
          const error = new Error(
            `${label} timed out after ${timeoutMs}ms.`,
          );
          error.code = "CONNECTION_HOST_SHUTDOWN_TIMEOUT";
          reject(error);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

const bridgeRpc = createDesktopBridgeRpc({
  baseUrl: desktopBridgeUrl,
  token: desktopBridgeToken,
  timeoutMs: Number(process.env.OWL_DESKTOP_CAPABILITY_BRIDGE_TIMEOUT_MS || "5000"),
  onEvent(level, message, meta) {
    record(level, "desktop-bridge", message, meta);
  },
});

const agentInboxProxy = {
  summary: () => bridgeRpc("agentInbox", "summary"),
  list: (options) => bridgeRpc("agentInbox", "list", [options]),
  claim: (requestId, options) =>
    bridgeRpc("agentInbox", "claim", [requestId, options]),
  release: (requestId, options) =>
    bridgeRpc("agentInbox", "release", [requestId, options]),
  complete: (requestId, options) =>
    bridgeRpc("agentInbox", "complete", [requestId, options]),
};

const remoteDeviceProxy = {
  listDevices: () => bridgeRpc("remoteDevice", "listDevices"),
  listCommands: (deviceId, limit) =>
    bridgeRpc("remoteDevice", "listCommands", [deviceId, limit]),
  submitTask: (input) => bridgeRpc("remoteDevice", "submitTask", [input]),
  status: (input) => bridgeRpc("remoteDevice", "status", [input]),
  cancel: (input) => bridgeRpc("remoteDevice", "cancel", [input]),
};

const plannerContinuation = new PlannerContinuationStore({
  file: path.join(userDataRoot, "planner-continuation.json"),
});
plannerContinuation.recoverConnectedTransports("connection_host_restart");

const mcpServer = await startOwlMcpHttpServer({
  port: mcpPort,
  runtimeBaseUrl,
  runtimeToken,
  mcpToken,
  fallbackOwnerId,
  agentInbox: agentInboxProxy,
  remoteDeviceControl: remoteDeviceProxy,
  plannerContinuation,
  onEvent(level, message, meta) {
    record(level, "mcp", message, meta);
  },
});

const tunnelSupervisor = new TunnelSupervisor({
  onEvent(level, message, meta) {
    record(level, "tunnel", message, meta);
  },
});

const cloudMcpCompletionStore = new CloudMcpCompletionStore({
  root: path.join(userDataRoot, "connectivity", "cloud-mcp-completions"),
});
const cloudMcpExecutor = new LocalMcpExecutor({
  mcpUrl: mcpServer.url,
  mcpToken,
  onEvent(level, message, meta) {
    record(level, "cloud-mcp-executor", message, meta);
  },
});
let cloudMcpConsumer = null;
let cloudMcpConfig = null;

async function stopCloudMcpConsumer() {
  const current = cloudMcpConsumer;
  cloudMcpConsumer = null;
  cloudMcpConfig = null;
  if (current) await current.stop();
}

async function configureCloudMcpConsumer(config = {}) {
  const baseUrl = String(config.baseUrl ?? "").trim();
  const deviceCredential = String(config.deviceCredential ?? "").trim();
  const deviceId = String(config.deviceId ?? "").trim();
  if (!baseUrl || !deviceCredential || !deviceId) {
    const error = new Error("Cloud MCP requires baseUrl, deviceId, and deviceCredential.");
    error.code = "CLOUD_MCP_CONFIG_INVALID";
    throw error;
  }

  await stopCloudMcpConsumer();
  const client = new CloudHttpClient({ baseUrl, deviceCredential });
  const consumer = new CloudMcpCallConsumer({
    cloudClient: client,
    executor: cloudMcpExecutor,
    completionStore: cloudMcpCompletionStore,
    pollIntervalMs: config.pollIntervalMs,
    leaseMs: config.leaseMs,
    onEvent(level, message, meta) {
      record(level, "cloud-mcp", message, meta);
    },
  });
  cloudMcpConfig = { baseUrl, deviceId };
  cloudMcpConsumer = consumer;
  await consumer.start();
  return consumer.snapshot();
}

function authorized(req) {
  return req.headers.authorization === `Bearer ${controlToken}`;
}

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use((req, res, next) => {
  if (authorized(req)) return next();
  res.status(401).json({ ok: false, error: { code: "UNAUTHORIZED" } });
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "owl-connection-host",
    pid: process.pid,
    startedAt,
    runtimeBaseUrl,
    mcp: {
      status: "running",
      url: mcpServer.url,
      ...mcpServer.snapshot(),
    },
    tunnel: tunnelSupervisor.status(),
    cloudMcp: {
      configured: Boolean(cloudMcpConfig),
      config: cloudMcpConfig,
      consumer: cloudMcpConsumer?.snapshot?.() ?? null,
      completionStore: cloudMcpCompletionStore.snapshot(),
    },
    events: events.slice(0, 120),
  });
});

app.post("/tunnel/start", async (req, res) => {
  try {
    const result = await tunnelSupervisor.start(req.body ?? {});
    res.json({ ok: true, result });
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: {
        code: error?.code ?? "TUNNEL_START_FAILED",
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
});

app.post("/tunnel/restart", async (req, res) => {
  try {
    const result = await tunnelSupervisor.restart(req.body ?? {});
    res.json({ ok: true, result });
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: {
        code: error?.code ?? "TUNNEL_RESTART_FAILED",
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
});

app.post("/tunnel/stop", async (_req, res) => {
  const result = await tunnelSupervisor.stop();
  res.json({ ok: true, result });
});

app.post("/cloud-mcp/configure", async (req, res) => {
  try {
    const result = await configureCloudMcpConsumer(req.body ?? {});
    res.json({ ok: true, result });
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: {
        code: error?.code ?? "CLOUD_MCP_CONFIGURE_FAILED",
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
});

app.post("/cloud-mcp/stop", async (_req, res) => {
  await stopCloudMcpConsumer();
  res.json({ ok: true, result: { state: "stopped" } });
});

const startedAt = new Date().toISOString();
const listener = await new Promise((resolve, reject) => {
  const candidate = app.listen(controlPort, "127.0.0.1", () =>
    resolve(candidate),
  );
  candidate.once("error", reject);
});
record("info", "connection-host", "OWL Connection Host started", {
  pid: process.pid,
  controlPort,
  mcpUrl: mcpServer.url,
});

console.log(
  `OWL Connection Host listening on http://127.0.0.1:${controlPort} · MCP ${mcpServer.url}`,
);

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  record("info", "connection-host", "OWL Connection Host stopping", { signal });

  const results = await Promise.allSettled([
    boundedStep(
      "Connection Host HTTP listener close",
      () =>
        new Promise((resolve, reject) => {
          listener.close((error) => {
            if (error) reject(error);
            else resolve();
          });
        }),
      2_500,
    ),
    boundedStep("Tunnel stop", () => tunnelSupervisor.stop(), 6_000),
    boundedStep("Cloud MCP consumer stop", () => stopCloudMcpConsumer(), 5_000),
    boundedStep("OWL MCP close", () => mcpServer.close(), 5_000),
  ]);

  const labels = ["listener", "tunnel", "cloud-mcp", "mcp"];
  results.forEach((result, index) => {
    if (result.status !== "rejected") return;
    record("warn", "connection-host", "Shutdown step did not complete cleanly", {
      step: labels[index],
      message:
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason),
      code: result.reason?.code ?? null,
    });
  });

  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
