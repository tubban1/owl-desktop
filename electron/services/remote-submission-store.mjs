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

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = path.join(
    path.dirname(file),
    "." + path.basename(file) + "." + process.pid + "." + randomUUID() + ".tmp",
  );
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(temp, file);
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

export function remoteSubmissionDigest(value) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function initialState() {
  return {
    version: 1,
    submissions: {},
  };
}

export class RemoteSubmissionStore {
  constructor({ file }) {
    this.file = file;
  }

  read() {
    const value = readJson(this.file, initialState());
    if (
      value?.version !== 1 ||
      !value.submissions ||
      typeof value.submissions !== "object" ||
      Array.isArray(value.submissions)
    ) {
      return initialState();
    }
    return value;
  }

  write(state) {
    writeJsonAtomic(this.file, state);
  }

  get(submissionKey) {
    return this.read().submissions[submissionKey] ?? null;
  }

  begin(
    {
      submissionKey,
      ownerId,
      submissionId,
      clientSubmissionId,
      deviceId,
      digest,
    },
    now = new Date().toISOString(),
  ) {
    const state = this.read();
    const existing = state.submissions[submissionKey];
    if (existing) {
      return {
        existing: true,
        conflict:
          existing.digest !== digest ||
          existing.deviceId !== deviceId ||
          existing.clientSubmissionId !== clientSubmissionId,
        record: existing,
      };
    }
    const record = {
      submissionKey,
      ownerId,
      submissionId,
      clientSubmissionId,
      deviceId,
      digest,
      status: "creating",
      commandId: null,
      commandStatus: null,
      createdAt: now,
      updatedAt: now,
      lastErrorCode: null,
    };
    state.submissions[submissionKey] = record;
    this.write(state);
    return { existing: false, conflict: false, record };
  }

  markQueued(
    submissionKey,
    command,
    now = new Date().toISOString(),
  ) {
    const state = this.read();
    const record = state.submissions[submissionKey];
    if (!record) {
      throw new Error("Unknown remote submission: " + submissionKey);
    }
    record.status = "queued";
    record.commandId = String(command.commandId);
    record.commandStatus = String(command.status ?? "queued");
    record.updatedAt = now;
    record.lastErrorCode = null;
    this.write(state);
    return record;
  }

  markCommandStatus(
    submissionKey,
    command,
    now = new Date().toISOString(),
  ) {
    const state = this.read();
    const record = state.submissions[submissionKey];
    if (!record) {
      throw new Error("Unknown remote submission: " + submissionKey);
    }
    if (command?.commandId) record.commandId = String(command.commandId);
    if (command?.status) record.commandStatus = String(command.status);
    record.status =
      ["rejected", "cancelled", "cancelled_before_accept", "expired"].includes(
        String(command?.status ?? ""),
      )
        ? "terminal"
        : "queued";
    record.updatedAt = now;
    record.lastErrorCode = null;
    this.write(state);
    return record;
  }

  markUncertain(
    submissionKey,
    errorCode,
    now = new Date().toISOString(),
  ) {
    const state = this.read();
    const record = state.submissions[submissionKey];
    if (!record) {
      throw new Error("Unknown remote submission: " + submissionKey);
    }
    record.status = "uncertain";
    record.updatedAt = now;
    record.lastErrorCode = String(errorCode || "REMOTE_SUBMISSION_UNCERTAIN");
    this.write(state);
    return record;
  }
}
