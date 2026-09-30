import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { CloudBridgeService } from "../electron/services/cloud-bridge-service.mjs";
import { CloudBridgeStore } from "../electron/services/cloud-bridge-store.mjs";
import { CloudHttpClient } from "../electron/services/cloud-http-client.mjs";
import { RuntimeHttpClient } from "../electron/runtime-http-client.mjs";

function assert(condition, message, details) {
  if (!condition) {
    throw new Error(
      message + (details === undefined ? "" : "\n" + JSON.stringify(details, null, 2)),
    );
  }
}

const runtimeBaseUrl =
  process.env.OWL_RUNTIME_URL?.trim() || "http://127.0.0.1:18891";
const repo = process.env.OWL_E2E_REPO?.trim() || process.cwd();
const deviceId = "dev_http_bridge_e2e";
const deviceCredential = `owldev1.${deviceId}.fixture-secret`;
const commandId = `cmd_http_e2e_${Date.now().toString(36)}`;
const command = {
  commandId,
  deviceId,
  kind: "runtime.task.create-and-start",
  kindVersion: 1,
  payload: {
    label: "Cloud Bridge HTTP live E2E",
    steps: [
      {
        id: "status",
        action: "git.status",
        args: { cwd: repo },
      },
    ],
    maxConcurrency: 1,
    failFast: true,
  },
  status: "dispatched",
  createdAt: new Date().toISOString(),
};

const cloud = {
  pulls: 0,
  accepts: [],
  rejects: [],
  events: [],
  telemetry: [],
  presence: [],
};

function json(res, status, value) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(value));
}

const server = http.createServer(async (req, res) => {
  const auth = req.headers.authorization;
  if (auth !== `Device ${deviceCredential}`) {
    json(res, 401, { error: "UNAUTHORIZED", message: "Invalid fixture device credential" });
    return;
  }

  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString("utf8");
  const body = rawBody ? JSON.parse(rawBody) : {};

  if (req.method === "POST" && url.pathname === "/device/v1/presence") {
    cloud.presence.push(body);
    json(res, 200, { deviceId, ok: true });
    return;
  }

  if (req.method === "GET" && url.pathname === "/device/v1/commands") {
    cloud.pulls += 1;
    // Deliberately replay the same delivery once after local acceptance to
    // prove commandId dedupe at the Desktop boundary.
    json(res, 200, { commands: cloud.pulls <= 2 ? [command] : [] });
    return;
  }

  const accept = url.pathname.match(/^\/device\/v1\/commands\/([^/]+)\/accept$/);
  if (req.method === "POST" && accept) {
    cloud.accepts.push({
      commandId: decodeURIComponent(accept[1]),
      mapping: body,
    });
    json(res, 200, {
      commandId: decodeURIComponent(accept[1]),
      status: "accepted",
      ...body,
    });
    return;
  }

  const reject = url.pathname.match(/^\/device\/v1\/commands\/([^/]+)\/reject$/);
  if (req.method === "POST" && reject) {
    cloud.rejects.push({
      commandId: decodeURIComponent(reject[1]),
      reason: body.reason,
    });
    json(res, 200, {
      commandId: decodeURIComponent(reject[1]),
      status: "rejected",
      rejectionReason: body.reason,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/device/v1/events") {
    const duplicate = cloud.events.some((event) => event.eventId === body.eventId);
    if (!duplicate) cloud.events.push(body);
    json(res, 202, { eventId: body.eventId, duplicate });
    return;
  }

  if (req.method === "POST" && url.pathname === "/device/v1/telemetry") {
    for (const event of body.events ?? []) {
      if (!cloud.telemetry.some((item) => item.eventId === event.eventId)) {
        cloud.telemetry.push(event);
      }
    }
    json(res, 202, {
      accepted: (body.events ?? []).length,
      duplicates: 0,
    });
    return;
  }

  json(res, 404, { error: "NOT_FOUND", message: "fixture route not found" });
});

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const address = server.address();
assert(address && typeof address === "object", "Cloud fixture did not bind.");
const cloudBaseUrl = `http://127.0.0.1:${address.port}`;

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "owl-cloud-http-live-"));
const store = new CloudBridgeStore({
  file: path.join(scratch, "cloud-bridge-state.json"),
});
const runtime = new RuntimeHttpClient({
  baseUrl: runtimeBaseUrl,
  sessionId: "owl-desktop:cloud-http-live-e2e",
  token: process.env.OWL_RUNTIME_API_TOKEN?.trim() || undefined,
});
const cloudClient = new CloudHttpClient({
  baseUrl: cloudBaseUrl,
  deviceCredential,
});

let runtimeTaskId;
try {
  const info = await runtime.info();
  console.log(`PASS Runtime reachable (${info.runtimeVersion}, API ${info.apiVersion})`);

  const access = await runtime.authorizeRuntimeAccess(
    {
      deviceId,
      organizationId: "org_http_bridge_e2e",
      principalId: "user_http_bridge_e2e",
      canRun: true,
      leaseExpiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      evidence: { source: "i4-http-live-e2e" },
    },
    {
      requestId: `i4:${commandId}:access`,
      idempotencyKey: `i4:${commandId}:access`,
    },
  );
  assert(access.state === "READY", "Runtime did not enter READY for I4.", access);

  const service = new CloudBridgeService({
    client: cloudClient,
    runtimeClient: runtime,
    store,
    deviceId,
    appVersion: "i4-e2e",
    pollIntervalMs: 60_000,
    presenceIntervalMs: 60_000,
    telemetryEnabled: true,
    buildPresence: async () => ({
      capabilities: {
        cloudBridge: "m1-polling-v1",
        supportedRemoteCommands: [
          "runtime.task.create",
          "runtime.task.create-and-start",
        ],
      },
      runtimeCompatibility: {
        runtimeApiVersion: info.apiVersion,
        runtimeVersion: info.runtimeVersion,
      },
    }),
  });

  await service.syncOnce({ forceHeartbeat: true });
  const accepted = store.getCommand(commandId);
  assert(
    accepted?.status === "accepted" && accepted.runtimeTaskId,
    "Cloud command did not map to one accepted Runtime Task.",
    accepted,
  );
  runtimeTaskId = accepted.runtimeTaskId;
  console.log(`PASS RemoteCommand mapped to ${runtimeTaskId}`);

  const deadline = Date.now() + 15_000;
  let finalTask = await runtime.getTask(runtimeTaskId, false);
  while (
    !finalTask?.progress?.terminal &&
    Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 120));
    await service.syncOnce();
    finalTask = await runtime.getTask(runtimeTaskId, false);
  }
  await service.syncOnce();

  assert(finalTask?.status === "completed", "Runtime Task did not complete.", finalTask);
  const finalRecord = store.getCommand(commandId);
  assert(
    finalRecord?.runtimeTerminalStatus === "completed" &&
      finalRecord?.runtimeTerminalProjectedAt,
    "Desktop journal did not record terminal projection.",
    finalRecord,
  );

  assert(cloud.accepts.length === 2, "Duplicate delivery did not replay exactly one existing mapping.", cloud.accepts);
  assert(
    cloud.accepts.every((item) => item.mapping.runtimeTaskId === runtimeTaskId),
    "Cloud accept mappings diverged across duplicate delivery.",
    cloud.accepts,
  );
  assert(cloud.rejects.length === 0, "I4 command was unexpectedly rejected.", cloud.rejects);

  const terminalEvents = cloud.events.filter(
    (event) =>
      event.eventType === "desktop.cloud.task.terminal" &&
      event.correlationId === commandId,
  );
  assert(terminalEvents.length === 1, "Terminal Cloud projection was not exactly once.", cloud.events);
  assert(
    terminalEvents[0]?.payload?.runtimeTaskId === runtimeTaskId &&
      terminalEvents[0]?.payload?.status === finalTask.status &&
      terminalEvents[0]?.payload?.progressRevision === finalTask.progress.revision,
    "Cloud terminal projection does not match canonical Runtime truth.",
    { terminalEvent: terminalEvents[0], finalTask },
  );

  const terminalTelemetry = cloud.telemetry.filter(
    (event) =>
      event.eventType === "desktop.cloud.task.terminal" &&
      event.correlationId === commandId,
  );
  assert(terminalTelemetry.length === 1, "Terminal telemetry was not projected exactly once.", cloud.telemetry);
  assert(cloud.presence.length >= 1, "Desktop did not send device presence.");

  const tasks = await runtime.tasks();
  assert(
    tasks.filter((task) => task.id === runtimeTaskId).length === 1,
    "Duplicate command delivery created duplicate Runtime Tasks.",
    tasks,
  );

  const rawJournal = fs.readFileSync(store.file, "utf8");
  assert(
    !rawJournal.includes(command.payload.label) && !rawJournal.includes(repo),
    "Local bridge journal leaked raw RemoteCommand payload.",
  );

  console.log("PASS HTTP device transport presence/pull/accept/event/telemetry");
  console.log("PASS duplicate RemoteCommand -> one Runtime Task");
  console.log("PASS detached Runtime execution reached canonical completed");
  console.log("PASS Cloud terminal projection exactly matches Runtime terminal truth");
  console.log(JSON.stringify({
    ok: true,
    gate: "I4 Cloud HTTP -> Desktop -> Runtime -> terminal projection",
    runtimeTaskId,
    cloudPulls: cloud.pulls,
    cloudAccepts: cloud.accepts.length,
    cloudTerminalEvents: terminalEvents.length,
    cloudTerminalTelemetry: terminalTelemetry.length,
    finalRuntimeStatus: finalTask.status,
    finalProgressRevision: finalTask.progress.revision,
  }, null, 2));
} finally {
  if (runtimeTaskId) {
    await runtime.invoke(
      "tasks.delete",
      { taskId: runtimeTaskId },
      {
        requestId: `i4:${commandId}:cleanup`,
        idempotencyKey: `i4:${commandId}:cleanup`,
        timeoutMs: 10_000,
      },
    ).catch(() => undefined);
  }
  await runtime.lockRuntimeAccess("I4_E2E_COMPLETE", {
    requestId: `i4:${commandId}:lock`,
    idempotencyKey: `i4:${commandId}:lock`,
  }).catch(() => undefined);
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(scratch, { recursive: true, force: true });
}
