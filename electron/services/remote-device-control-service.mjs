import { createHash } from "node:crypto";
import { remoteSubmissionDigest } from "./remote-submission-store.mjs";

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function boundedText(value, field, maxLength) {
  if (typeof value !== "string") {
    throw codedError("REMOTE_SUBMISSION_INVALID", field + " must be a string.");
  }
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > maxLength ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw codedError("REMOTE_SUBMISSION_INVALID", field + " is invalid.");
  }
  return normalized;
}

function safeOptionalText(value, field, maxLength) {
  if (value === undefined || value === null || value === "") return undefined;
  return boundedText(value, field, maxLength);
}

function submissionIdentity(ownerId, submissionId) {
  const digest = createHash("sha256")
    .update(JSON.stringify({ ownerId, submissionId }))
    .digest("hex")
    .slice(0, 40);
  return {
    submissionKey: "remote:" + digest,
    clientSubmissionId: "owl-remote-submit:" + digest,
  };
}

function normalizeOrchestration(value) {
  if (value === undefined || value === null) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw codedError(
      "REMOTE_SUBMISSION_INVALID",
      "orchestration must be an object.",
    );
  }
  const orchestrationId = boundedText(
    value.orchestrationId,
    "orchestration.orchestrationId",
    160,
  );
  const label = safeOptionalText(value.label, "orchestration.label", 240);
  const parentTaskId = safeOptionalText(
    value.parentTaskId,
    "orchestration.parentTaskId",
    200,
  );
  return {
    orchestrationId,
    ...(label ? { label } : {}),
    ...(parentTaskId ? { parentTaskId } : {}),
  };
}

function compactSubmission(record, command = null, extra = {}) {
  const terminal = extra?.terminal ?? null;
  return {
    schemaVersion: 1,
    submissionId: record.submissionId,
    deviceId: record.deviceId,
    clientSubmissionId: record.clientSubmissionId,
    state: record.status,
    commandId: record.commandId,
    commandStatus: command?.status ?? record.commandStatus ?? null,
    runtimeTaskId:
      command?.runtimeTaskId ??
      terminal?.runtimeTaskId ??
      null,
    orchestration: command?.orchestration ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastErrorCode: record.lastErrorCode,
    ...extra,
  };
}

export class RemoteDeviceControlService {
  constructor({ controlPlane, store }) {
    if (!controlPlane) {
      throw new Error("RemoteDeviceControlService requires controlPlane.");
    }
    if (!store) {
      throw new Error("RemoteDeviceControlService requires store.");
    }
    this.controlPlane = controlPlane;
    this.store = store;
  }

  listDevices() {
    return this.controlPlane.listDevices();
  }

  listCommands(deviceId, limit = 25) {
    return this.controlPlane.listCommands(deviceId, limit);
  }

  async reconcileRecord(record) {
    const commands = await this.controlPlane.listCommands(record.deviceId, 100);
    const match = commands.find(
      (command) =>
        (record.commandId && command.commandId === record.commandId) ||
        command.clientSubmissionId === record.clientSubmissionId,
    );
    if (!match) return { record, command: null };
    if (!record.commandId) {
      this.store.markQueued(record.submissionKey, match);
    }
    this.store.markCommandStatus(record.submissionKey, match);
    return { record: this.store.get(record.submissionKey), command: match };
  }

  async submitTask({
    ownerId,
    submissionId,
    deviceId,
    label,
    steps,
    maxConcurrency,
    failFast,
    orchestration,
    expiresAt,
  }) {
    const normalizedOwner = boundedText(ownerId, "ownerId", 240);
    const normalizedSubmission = boundedText(
      submissionId,
      "submissionId",
      200,
    );
    const normalizedDevice = boundedText(deviceId, "deviceId", 220);
    const normalizedLabel = boundedText(label, "label", 240);
    if (!Array.isArray(steps) || steps.length === 0) {
      throw codedError(
        "REMOTE_SUBMISSION_INVALID",
        "steps must be a non-empty array.",
      );
    }
    if (
      maxConcurrency !== undefined &&
      (!Number.isInteger(maxConcurrency) || maxConcurrency < 1 || maxConcurrency > 8)
    ) {
      throw codedError(
        "REMOTE_SUBMISSION_INVALID",
        "maxConcurrency must be an integer from 1 to 8.",
      );
    }
    if (failFast !== undefined && typeof failFast !== "boolean") {
      throw codedError(
        "REMOTE_SUBMISSION_INVALID",
        "failFast must be a boolean.",
      );
    }

    const identity = submissionIdentity(
      normalizedOwner,
      normalizedSubmission,
    );
    const normalizedOrchestration = normalizeOrchestration(orchestration);
    const payload = {
      label: normalizedLabel,
      steps: structuredClone(steps),
      clientSubmissionId: identity.clientSubmissionId,
      ...(maxConcurrency !== undefined ? { maxConcurrency } : {}),
      ...(failFast !== undefined ? { failFast } : {}),
      ...(normalizedOrchestration
        ? { orchestration: normalizedOrchestration }
        : {}),
    };
    const request = {
      deviceId: normalizedDevice,
      kind: "runtime.task.create-and-start",
      payload,
      ...(expiresAt ? { expiresAt } : {}),
    };
    const digest = remoteSubmissionDigest(request);
    const begun = this.store.begin({
      ...identity,
      ownerId: normalizedOwner,
      submissionId: normalizedSubmission,
      deviceId: normalizedDevice,
      digest,
    });

    if (begun.conflict) {
      throw codedError(
        "REMOTE_SUBMISSION_CONFLICT",
        "submissionId was already used with different remote work.",
      );
    }

    if (begun.existing) {
      const reconciled = await this.reconcileRecord(begun.record);
      if (reconciled.command) {
        return compactSubmission(reconciled.record, reconciled.command, {
          accepted: true,
          idempotent: true,
          reconciled: begun.record.commandId === null,
          doNotCreateReplacementCommand: true,
        });
      }
      return compactSubmission(reconciled.record, null, {
        accepted: false,
        idempotent: true,
        reconciled: false,
        needsReconciliation: true,
        doNotCreateReplacementCommand: true,
      });
    }

    try {
      const command = await this.controlPlane.createCommand(normalizedDevice, {
        kind: "runtime.task.create-and-start",
        payload,
        ...(expiresAt ? { expiresAt } : {}),
      });
      const record = this.store.markQueued(identity.submissionKey, command);
      return compactSubmission(record, command, {
        accepted: true,
        idempotent: false,
        reconciled: false,
        doNotCreateReplacementCommand: true,
      });
    } catch (error) {
      this.store.markUncertain(
        identity.submissionKey,
        error?.code ?? "REMOTE_SUBMISSION_UNCERTAIN",
      );
      const wrapped = codedError(
        "REMOTE_SUBMISSION_UNCERTAIN",
        "Remote command outcome is uncertain. Reuse the same submissionId to reconcile; do not create replacement work.",
      );
      wrapped.causeCode = error?.code ?? null;
      throw wrapped;
    }
  }

  async status({ ownerId, submissionId }) {
    const normalizedOwner = boundedText(ownerId, "ownerId", 240);
    const normalizedSubmission = boundedText(
      submissionId,
      "submissionId",
      200,
    );
    const identity = submissionIdentity(
      normalizedOwner,
      normalizedSubmission,
    );
    const record = this.store.get(identity.submissionKey);
    if (!record) {
      throw codedError(
        "REMOTE_SUBMISSION_NOT_FOUND",
        "No remote submission exists for this logical owner and submissionId.",
      );
    }
    const reconciled = await this.reconcileRecord(record);
    const commandId =
      reconciled.command?.commandId ??
      reconciled.record.commandId ??
      null;
    const terminal =
      commandId &&
      typeof this.controlPlane.findTaskTerminalEvent === "function"
        ? await this.controlPlane.findTaskTerminalEvent(
            reconciled.record.deviceId,
            commandId,
            100,
          )
        : null;
    return compactSubmission(reconciled.record, reconciled.command, {
      accepted: Boolean(reconciled.command || terminal),
      idempotent: true,
      reconciled:
        record.commandId === null && Boolean(reconciled.command),
      needsReconciliation: !reconciled.command && !terminal,
      terminal,
      doNotCreateReplacementCommand: true,
    });
  }

  async cancel({ ownerId, submissionId }) {
    const normalizedOwner = boundedText(ownerId, "ownerId", 240);
    const normalizedSubmission = boundedText(
      submissionId,
      "submissionId",
      200,
    );
    const identity = submissionIdentity(
      normalizedOwner,
      normalizedSubmission,
    );
    const record = this.store.get(identity.submissionKey);
    if (!record) {
      throw codedError(
        "REMOTE_SUBMISSION_NOT_FOUND",
        "No remote submission exists for this logical owner and submissionId.",
      );
    }
    const reconciled = await this.reconcileRecord(record);
    const commandId =
      reconciled.command?.commandId ??
      reconciled.record.commandId ??
      null;
    if (!commandId) {
      throw codedError(
        "REMOTE_SUBMISSION_UNCERTAIN",
        "Remote command identity is still uncertain and cannot be safely cancelled.",
      );
    }
    const terminal =
      typeof this.controlPlane.findTaskTerminalEvent === "function"
        ? await this.controlPlane.findTaskTerminalEvent(
            reconciled.record.deviceId,
            commandId,
            100,
          )
        : null;
    if (terminal) {
      throw codedError(
        "REMOTE_SUBMISSION_TERMINAL",
        "Remote task is already terminal and cannot be cancelled.",
      );
    }
    if (!reconciled.command) {
      throw codedError(
        "REMOTE_SUBMISSION_UNCERTAIN",
        "Remote command is not visible in device history and cannot be safely cancelled.",
      );
    }
    const command = await this.controlPlane.cancelCommand(commandId);
    const updated = this.store.markCommandStatus(
      identity.submissionKey,
      command,
    );
    return compactSubmission(updated, command, {
      cancelled: true,
      doNotCreateReplacementCommand: true,
    });
  }
}

export const remoteSubmissionIdentity = submissionIdentity;
