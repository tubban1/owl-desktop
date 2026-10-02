import express from "express";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { startOwlMcpHttpServer } from "../mcp/http-server.mjs";
import { TunnelSupervisor } from "../electron/services/tunnel-supervisor.mjs";
import { PlannerContinuationStore } from "../electron/services/planner-continuation-store.mjs";

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

async function bridgeRpc(domain, method, args = []) {
  const response = await fetch(`${desktopBridgeUrl}/rpc`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${desktopBridgeToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ domain, method, args }),
  }).catch((error) => {
    const wrapped = new Error(
      "OWL Desktop capability bridge is temporarily unavailable.",
    );
    wrapped.code = "DESKTOP_BRIDGE_UNAVAILABLE";
    wrapped.cause = error;
    throw wrapped;
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok !== true) {
    const error = new Error(
      body?.error?.message ||
        `OWL Desktop capability bridge failed with HTTP ${response.status}.`,
    );
    error.code = body?.error?.code || "DESKTOP_BRIDGE_UNAVAILABLE";
    throw error;
  }
  return body.result;
}

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

async function shutdown(signal) {
  record("info", "connection-host", "OWL Connection Host stopping", { signal });
  await tunnelSupervisor.stop().catch(() => undefined);
  await mcpServer.close().catch(() => undefined);
  await new Promise((resolve) => listener.close(resolve));
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
