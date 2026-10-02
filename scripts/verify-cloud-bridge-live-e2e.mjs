import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CloudBridgeService } from "../electron/services/cloud-bridge-service.mjs";
import { CloudBridgeStore } from "../electron/services/cloud-bridge-store.mjs";
import { RuntimeHttpClient } from "../electron/runtime-http-client.mjs";

const runtimeBaseUrl =
  process.env.OWL_RUNTIME_URL?.trim() || "http://127.0.0.1:18788";
const repo =
  process.env.OWL_E2E_REPO?.trim() || process.cwd();

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "owl-cloud-bridge-live-"));
const store = new CloudBridgeStore({
  file: path.join(scratch, "cloud-bridge-state.json"),
});

const accepted = [];
const rejected = [];

const cloudTransportFixture = {
  async heartbeat() {
    return { ok: true };
  },
  async pullCommands() {
    return { commands: [] };
  },
  async acceptCommand(commandId, mapping) {
    accepted.push({ commandId, mapping });
    return { commandId, status: "accepted", ...mapping };
  },
  async rejectCommand(commandId, reason) {
    rejected.push({ commandId, reason });
    return { commandId, status: "rejected", rejectionReason: reason };
  },
  async postEvent(event) {
    return { eventId: event.eventId, duplicate: false };
  },
  async postTelemetry(events) {
    return { accepted: events.length, duplicates: 0 };
  },
};

const runtime = new RuntimeHttpClient({
  baseUrl: runtimeBaseUrl,
  sessionId: "owl-desktop:cloud-bridge-live-e2e",
  token: process.env.OWL_RUNTIME_API_TOKEN?.trim() || undefined,
});

const service = new CloudBridgeService({
  client: cloudTransportFixture,
  runtimeClient: runtime,
  store,
  deviceId: "dev_local_bridge_e2e",
  appVersion: "0.1.0",
  telemetryEnabled: true,
});

const command = {
  commandId: `cmd_local_e2e_${Date.now().toString(36)}`,
  deviceId: "dev_local_bridge_e2e",
  kind: "runtime.task.create",
  kindVersion: 1,
  payload: {
    label: "Cloud Bridge local live E2E",
    steps: [
      {
        id: "status",
        action: "git.status",
        args: { cwd: repo },
      },
    ],
  },
  status: "dispatched",
  createdAt: new Date().toISOString(),
};

let runtimeTaskId;
try {
  const info = await runtime.info();
  console.log(
    `PASS RuntimeClient info (${info.runtimeVersion}, API ${info.apiVersion})`,
  );

  await service.processCommand(command);

  const record = store.getCommand(command.commandId);
  if (record?.status !== "accepted" || !record.runtimeTaskId) {
    throw new Error("Bridge did not persist accepted Runtime task mapping.");
  }
  runtimeTaskId = record.runtimeTaskId;

  if (accepted.length !== 1 || rejected.length !== 0) {
    throw new Error("Bridge did not emit exactly one accept and zero rejects.");
  }

  const task = await runtime.invoke("tasks.get", {
    taskId: runtimeTaskId,
    includeResults: false,
  });
  if (task?.id !== runtimeTaskId || task?.status !== "pending") {
    throw new Error("Runtime task mapping did not resolve to the created task.");
  }
  console.log("PASS Cloud command -> real Runtime task mapping");

  await service.processCommand(command);
  if (accepted.length !== 2) {
    throw new Error("Duplicate delivery did not replay the canonical accept.");
  }

  const tasks = await runtime.tasks();
  const matching = Array.isArray(tasks)
    ? tasks.filter((item) => item?.id === runtimeTaskId)
    : [];
  if (matching.length !== 1) {
    throw new Error("Duplicate delivery created or lost the Runtime task.");
  }
  console.log("PASS duplicate command -> one Runtime task");

  const rawJournal = fs.readFileSync(store.file, "utf8");
  if (
    rawJournal.includes(command.payload.label) ||
    rawJournal.includes(repo)
  ) {
    throw new Error("Cloud command payload leaked into the local dedupe journal.");
  }
  console.log("PASS command journal stores digest/mapping, not raw payload");
} finally {
  if (runtimeTaskId) {
    await runtime
      .invoke("tasks.delete", { taskId: runtimeTaskId })
      .catch(() => undefined);
  }
  fs.rmSync(scratch, { recursive: true, force: true });
}
