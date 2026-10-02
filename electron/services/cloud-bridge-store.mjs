import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), { mode: 0o600 });
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function commandOrigin(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const allowedKinds = new Set(["worker", "chatgpt", "cloud", "user", "agent"]);
  const kind = allowedKinds.has(value.kind) ? value.kind : null;
  if (!kind) return null;
  const bounded = (input, max) =>
    typeof input === "string" && input.trim()
      ? input.trim().slice(0, max)
      : null;
  return {
    kind,
    id: bounded(value.id, 160),
    label: bounded(value.label, 120),
  };
}

export function cloudCommandDigest(command) {
  const canonical = {
    commandId: command?.commandId ?? null,
    deviceId: command?.deviceId ?? null,
    kind: command?.kind ?? null,
    kindVersion: command?.kindVersion ?? null,
    payload: command?.payload ?? {},
    expiresAt: command?.expiresAt ?? null,
    origin: commandOrigin(command?.origin),
  };
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(canonical)))
    .digest("hex");
}

function initialState() {
  return {
    version: 1,
    commands: {},
    approvalDecisions: {},
    outbox: [],
  };
}

export class CloudBridgeStore {
  constructor({ file }) {
    this.file = file;
  }

  read() {
    const value = readJson(this.file, initialState());
    if (value?.version !== 1 || typeof value.commands !== "object" || !Array.isArray(value.outbox)) {
      return initialState();
    }
    return {
      ...value,
      approvalDecisions:
        value.approvalDecisions && typeof value.approvalDecisions === "object"
          ? value.approvalDecisions
          : {},
    };
  }

  write(state) {
    writeJson(this.file, state);
  }

  recoverProcessingAsUncertain(now = new Date().toISOString()) {
    const state = this.read();
    const recovered = [];
    for (const record of Object.values(state.commands)) {
      if (record.status !== "processing") continue;
      record.status = "uncertain";
      record.updatedAt = now;
      record.lastErrorCode = "DESKTOP_RESTART_DURING_RUNTIME_REQUEST";
      recovered.push(record.commandId);
    }
    if (recovered.length) this.write(state);
    return recovered;
  }

  getCommand(commandId) {
    return this.read().commands[commandId] ?? null;
  }

  getApprovalDecision(approvalDecisionId) {
    return this.read().approvalDecisions[approvalDecisionId] ?? null;
  }

  beginApprovalDecision(decision, now = new Date().toISOString()) {
    const state = this.read();
    const existing = state.approvalDecisions[decision.approvalDecisionId];
    const digest = createHash("sha256")
      .update(
        JSON.stringify(
          canonicalize({
            approvalDecisionId: decision.approvalDecisionId,
            deviceId: decision.deviceId,
            approvalId: decision.approvalId,
            decision: decision.decision,
            source: decision.source,
          }),
        ),
      )
      .digest("hex");
    if (existing) {
      return {
        existing: true,
        conflict: existing.digest !== digest,
        record: existing,
      };
    }
    const record = {
      approvalDecisionId: decision.approvalDecisionId,
      deviceId: decision.deviceId,
      approvalId: decision.approvalId,
      decision: decision.decision,
      source: decision.source,
      digest,
      status: "processing",
      receivedAt: now,
      updatedAt: now,
      runtimeOutcome: null,
    };
    state.approvalDecisions[decision.approvalDecisionId] = record;
    this.write(state);
    return { existing: false, conflict: false, record };
  }

  markApprovalDecisionAcknowledged(
    approvalDecisionId,
    runtimeOutcome,
    now = new Date().toISOString(),
  ) {
    const state = this.read();
    const record = state.approvalDecisions[approvalDecisionId];
    if (!record) {
      throw new Error(
        `Unknown Cloud approval decision journal entry: ${approvalDecisionId}`,
      );
    }
    record.status = "acknowledged";
    record.runtimeOutcome = runtimeOutcome;
    record.updatedAt = now;
    this.write(state);
    return record;
  }

  beginCommand(command, now = new Date().toISOString()) {
    const state = this.read();
    const digest = cloudCommandDigest(command);
    const existing = state.commands[command.commandId];
    if (existing) {
      return {
        existing: true,
        conflict: existing.digest !== digest,
        record: existing,
      };
    }
    const record = {
      commandId: command.commandId,
      deviceId: command.deviceId,
      kind: command.kind,
      origin: commandOrigin(command.origin),
      digest,
      status: "processing",
      receivedAt: now,
      updatedAt: now,
      runtimeTaskId: null,
      runtimeRunId: null,
      runtimeTerminalStatus: null,
      runtimeTerminalRevision: null,
      runtimeTerminalProjectedAt: null,
      rejectionReason: null,
      lastErrorCode: null,
    };
    state.commands[command.commandId] = record;
    this.write(state);
    return { existing: false, conflict: false, record };
  }

  markAccepted(commandId, mapping, now = new Date().toISOString()) {
    const state = this.read();
    const record = state.commands[commandId];
    if (!record) throw new Error(`Unknown Cloud command journal entry: ${commandId}`);
    record.status = "accepted";
    record.runtimeTaskId = mapping.runtimeTaskId ?? null;
    record.runtimeRunId = mapping.runtimeRunId ?? null;
    record.updatedAt = now;
    record.lastErrorCode = null;
    this.write(state);
    return record;
  }

  listAcceptedRuntimeMappingsPendingTerminal(limit = 100) {
    return Object.values(this.read().commands)
      .filter(
        (record) =>
          record.status === "accepted" &&
          record.runtimeTaskId &&
          !record.runtimeTerminalProjectedAt,
      )
      .slice(0, Math.max(1, Math.min(Number(limit) || 100, 500)));
  }

  markRuntimeTerminal(
    commandId,
    { status, revision = null },
    now = new Date().toISOString(),
  ) {
    const state = this.read();
    const record = state.commands[commandId];
    if (!record) throw new Error(`Unknown Cloud command journal entry: ${commandId}`);
    record.runtimeTerminalStatus = String(status || "unknown");
    record.runtimeTerminalRevision =
      Number.isInteger(revision) ? revision : null;
    record.runtimeTerminalProjectedAt = now;
    record.updatedAt = now;
    this.write(state);
    return record;
  }

  markRejected(commandId, reason, now = new Date().toISOString()) {
    const state = this.read();
    const record = state.commands[commandId];
    if (!record) throw new Error(`Unknown Cloud command journal entry: ${commandId}`);
    record.status = "rejected";
    record.rejectionReason = String(reason || "Rejected locally");
    record.updatedAt = now;
    this.write(state);
    return record;
  }

  markUncertain(commandId, errorCode, now = new Date().toISOString()) {
    const state = this.read();
    const record = state.commands[commandId];
    if (!record) throw new Error(`Unknown Cloud command journal entry: ${commandId}`);
    record.status = "uncertain";
    record.lastErrorCode = errorCode || "UNCERTAIN";
    record.updatedAt = now;
    this.write(state);
    return record;
  }

  enqueueOutbox(kind, payload, id = payload?.eventId ?? randomUUID()) {
    if (!["event", "telemetry"].includes(kind)) {
      throw new Error(`Unsupported Cloud outbox kind: ${kind}`);
    }
    const state = this.read();
    const existing = state.outbox.find((entry) => entry.id === id);
    if (existing) return existing;
    const now = new Date().toISOString();
    const record = {
      id,
      kind,
      payload,
      attempts: 0,
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now,
      lastErrorCode: null,
    };
    state.outbox.push(record);
    this.write(state);
    return record;
  }

  dueOutbox(now = new Date(), limit = 100) {
    const at = now.getTime();
    return this.read().outbox
      .filter((entry) => new Date(entry.nextAttemptAt).getTime() <= at)
      .slice(0, limit);
  }

  markOutboxDelivered(ids) {
    const idSet = new Set(ids);
    if (!idSet.size) return;
    const state = this.read();
    state.outbox = state.outbox.filter((entry) => !idSet.has(entry.id));
    this.write(state);
  }

  markOutboxFailed(id, errorCode, delayMs) {
    const state = this.read();
    const entry = state.outbox.find((item) => item.id === id);
    if (!entry) return;
    entry.attempts += 1;
    entry.updatedAt = new Date().toISOString();
    entry.nextAttemptAt = new Date(Date.now() + delayMs).toISOString();
    entry.lastErrorCode = errorCode || "CLOUD_SEND_FAILED";
    this.write(state);
  }

  snapshot() {
    const state = this.read();
    const counts = {
      processing: 0,
      accepted: 0,
      rejected: 0,
      uncertain: 0,
    };
    for (const record of Object.values(state.commands)) {
      if (record.status in counts) counts[record.status] += 1;
    }
    return {
      commandCounts: counts,
      outboxPending: state.outbox.length,
      commands: Object.values(state.commands)
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
        .slice(0, 25),
    };
  }
}
