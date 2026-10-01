import { createHash, randomUUID } from "node:crypto";

import {
  OWL_COMPATIBILITY_V1,
  supportsRemoteCommand,
} from "./compatibility-v1.mjs";

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedString(value, max = 160) {
  return String(value ?? "").slice(0, max);
}

function errorCode(error) {
  return boundedString(error?.code || error?.name || "ERROR", 80);
}

function errorFingerprint(error) {
  return createHash("sha256")
    .update(`${errorCode(error)}:${error?.name ?? "Error"}`)
    .digest("hex")
    .slice(0, 24);
}

function backoffMs(attempts) {
  return Math.min(60_000, 1_000 * 2 ** Math.min(attempts, 6));
}

const VERIFICATION_OPERATORS = new Set([
  "exists",
  "equals",
  "contains",
  "matches",
  "truthy",
  "falsy",
  "gt",
  "gte",
  "lt",
  "lte",
]);

const EXECUTION_TARGET_KINDS = new Set(["host", "sandbox", "remote"]);

class CommandValidationError extends Error {
  constructor(code) {
    super(code);
    this.name = "CommandValidationError";
    this.code = code;
  }
}

function invalid(code) {
  throw new CommandValidationError(code);
}

function sanitizeVerification(value) {
  if (value === undefined) return undefined;
  if (!isObject(value)) invalid("VERIFY_OBJECT_REQUIRED");
  if (typeof value.id !== "string" || !value.id.trim()) {
    invalid("VERIFY_ID_REQUIRED");
  }
  if (!Array.isArray(value.expectations)) {
    invalid("VERIFY_EXPECTATIONS_ARRAY_REQUIRED");
  }

  const expectations = value.expectations.map((item) => {
    if (!isObject(item)) invalid("VERIFY_EXPECTATION_OBJECT_REQUIRED");
    if (typeof item.path !== "string" || !item.path.trim()) {
      invalid("VERIFY_EXPECTATION_PATH_REQUIRED");
    }
    if (
      typeof item.operator !== "string" ||
      !VERIFICATION_OPERATORS.has(item.operator)
    ) {
      invalid("VERIFY_EXPECTATION_OPERATOR_INVALID");
    }
    if (item.description !== undefined && typeof item.description !== "string") {
      invalid("VERIFY_EXPECTATION_DESCRIPTION_INVALID");
    }
    return {
      path: item.path,
      operator: item.operator,
      ...(Object.prototype.hasOwnProperty.call(item, "expected")
        ? { expected: item.expected }
        : {}),
      ...(typeof item.description === "string"
        ? { description: item.description }
        : {}),
    };
  });

  if (value.description !== undefined && typeof value.description !== "string") {
    invalid("VERIFY_DESCRIPTION_INVALID");
  }

  return {
    id: value.id,
    ...(typeof value.description === "string"
      ? { description: value.description }
      : {}),
    expectations,
  };
}

function sanitizeExecutionTarget(value) {
  if (value === undefined) return undefined;
  if (!isObject(value)) invalid("EXECUTION_TARGET_OBJECT_REQUIRED");
  if (
    typeof value.kind !== "string" ||
    !EXECUTION_TARGET_KINDS.has(value.kind)
  ) {
    invalid("EXECUTION_TARGET_KIND_INVALID");
  }
  if (value.targetId !== undefined && typeof value.targetId !== "string") {
    invalid("EXECUTION_TARGET_ID_INVALID");
  }
  if (
    value.providerAffinity !== undefined &&
    (!Array.isArray(value.providerAffinity) ||
      value.providerAffinity.some((item) => typeof item !== "string"))
  ) {
    invalid("EXECUTION_TARGET_PROVIDER_AFFINITY_INVALID");
  }
  if (value.allowFallback !== undefined && value.allowFallback !== false) {
    invalid("EXECUTION_TARGET_FALLBACK_FORBIDDEN");
  }

  return {
    kind: value.kind,
    ...(typeof value.targetId === "string" ? { targetId: value.targetId } : {}),
    ...(Array.isArray(value.providerAffinity)
      ? { providerAffinity: [...value.providerAffinity] }
      : {}),
    ...(value.allowFallback === false ? { allowFallback: false } : {}),
  };
}

function sanitizeTaskStep(step) {
  if (!isObject(step)) invalid("TASK_STEP_OBJECT_REQUIRED");
  if (typeof step.id !== "string" || !step.id.trim()) {
    invalid("TASK_STEP_ID_REQUIRED");
  }
  if (typeof step.action !== "string" || !step.action.trim()) {
    invalid("TASK_STEP_ACTION_REQUIRED");
  }
  if (step.args !== undefined && !isObject(step.args)) {
    invalid("TASK_STEP_ARGS_OBJECT_REQUIRED");
  }
  if (
    step.dependsOn !== undefined &&
    (!Array.isArray(step.dependsOn) ||
      step.dependsOn.some((item) => typeof item !== "string"))
  ) {
    invalid("TASK_STEP_DEPENDS_ON_INVALID");
  }

  const verify = sanitizeVerification(step.verify);
  return {
    id: step.id,
    action: step.action,
    ...(isObject(step.args) ? { args: step.args } : {}),
    ...(Array.isArray(step.dependsOn)
      ? { dependsOn: [...step.dependsOn] }
      : {}),
    ...(verify ? { verify } : {}),
  };
}

function sanitizeBoundedText(value, code, maxLength, required = false) {
  if (value === undefined) {
    if (required) invalid(code);
    return undefined;
  }
  if (typeof value !== "string") invalid(code);
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > maxLength ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    invalid(code);
  }
  return normalized;
}

function sanitizeTaskOrchestration(value) {
  if (value === undefined) return undefined;
  if (!isObject(value)) invalid("TASK_ORCHESTRATION_OBJECT_REQUIRED");
  const orchestrationId = sanitizeBoundedText(
    value.orchestrationId,
    "TASK_ORCHESTRATION_ID_INVALID",
    160,
    true,
  );
  const label = sanitizeBoundedText(
    value.label,
    "TASK_ORCHESTRATION_LABEL_INVALID",
    240,
  );
  const parentTaskId = sanitizeBoundedText(
    value.parentTaskId,
    "TASK_ORCHESTRATION_PARENT_INVALID",
    200,
  );
  const allowed = new Set(["orchestrationId", "label", "parentTaskId"]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) invalid(`TASK_ORCHESTRATION_FIELD_UNSUPPORTED:${key}`);
  }
  return {
    orchestrationId,
    ...(label ? { label } : {}),
    ...(parentTaskId ? { parentTaskId } : {}),
  };
}

function validateTaskCreatePayload(payload) {
  if (!isObject(payload)) invalid("PAYLOAD_OBJECT_REQUIRED");
  if (typeof payload.label !== "string" || !payload.label.trim()) {
    invalid("TASK_LABEL_REQUIRED");
  }
  if (!Array.isArray(payload.steps) || payload.steps.length === 0) {
    invalid("TASK_STEPS_REQUIRED");
  }
  if (
    payload.maxConcurrency !== undefined &&
    (!Number.isInteger(payload.maxConcurrency) || payload.maxConcurrency <= 0)
  ) {
    invalid("TASK_MAX_CONCURRENCY_INVALID");
  }
  if (payload.failFast !== undefined && typeof payload.failFast !== "boolean") {
    invalid("TASK_FAIL_FAST_INVALID");
  }
  sanitizeBoundedText(
    payload.clientSubmissionId,
    "TASK_CLIENT_SUBMISSION_ID_INVALID",
    160,
  );

  const orchestration = sanitizeTaskOrchestration(payload.orchestration);
  const executionTarget = sanitizeExecutionTarget(payload.executionTarget);
  return {
    label: payload.label,
    steps: payload.steps.map(sanitizeTaskStep),
    ...(Number.isInteger(payload.maxConcurrency)
      ? { maxConcurrency: payload.maxConcurrency }
      : {}),
    ...(typeof payload.failFast === "boolean"
      ? { failFast: payload.failFast }
      : {}),
    ...(orchestration ? { orchestration } : {}),
    ...(executionTarget ? { executionTarget } : {}),
  };
}

export class CloudBridgeService {
  constructor({
    client,
    runtimeClient,
    store,
    deviceId,
    appVersion = "0.0.0",
    pollIntervalMs = 5_000,
    presenceIntervalMs = 30_000,
    commandLimit = 25,
    telemetryEnabled = true,
    buildPresence = async () => ({}),
    onEvent = () => {},
    onAgentRequest = () => {},
    onAuthRejected = () => {},
  }) {
    this.client = client;
    this.runtimeClient = runtimeClient;
    this.store = store;
    this.deviceId = deviceId;
    this.appVersion = appVersion;
    this.pollIntervalMs = Math.max(Number(pollIntervalMs) || 5_000, 1_000);
    this.presenceIntervalMs = Math.max(
      Number(presenceIntervalMs) || 30_000,
      5_000,
    );
    this.commandLimit = Math.min(Math.max(Number(commandLimit) || 25, 1), 100);
    this.telemetryEnabled = telemetryEnabled !== false;
    this.buildPresence = buildPresence;
    this.onEvent = onEvent;
    this.onAgentRequest = onAgentRequest;
    this.onAuthRejected = onAuthRejected;
    this.running = false;
    this.timer = null;
    this.syncing = false;
    this.approvalDecisionCapability = {
      status: "unknown",
      nextProbeAtMs: 0,
    };
    this.state = {
      status: "stopped",
      lastHeartbeatAt: null,
      lastPollAt: null,
      lastCloudContactAt: null,
      lastErrorCode: null,
      lastErrorAt: null,
      recoveredUncertain: 0,
    };
  }

  snapshot() {
    return {
      ...this.state,
      running: this.running,
      deviceId: this.deviceId,
      supportedCommandKinds: Object.entries(
        OWL_COMPATIBILITY_V1.remoteCommands,
      ).flatMap(([kind, versions]) => versions.map((version) => `${kind}@${version}`)),
      approvalDecisionSync: {
        status: this.approvalDecisionCapability.status,
        nextProbeAt:
          this.approvalDecisionCapability.nextProbeAtMs > 0
            ? new Date(this.approvalDecisionCapability.nextProbeAtMs).toISOString()
            : null,
      },
      ...this.store.snapshot(),
    };
  }

  async start() {
    if (this.running) return this.snapshot();
    if (!this.deviceId) {
      throw new Error("OWL Cloud deviceId is not configured.");
    }

    const recovered = this.store.recoverProcessingAsUncertain();
    this.state.recoveredUncertain += recovered.length;
    for (const commandId of recovered) {
      this.queueIntegrationEvent(
        "desktop.cloud.command.uncertain",
        commandId,
        { reason: "desktop_restart_during_runtime_request" },
        `uncertain:${commandId}`,
      );
      this.onAgentRequest({
        type: "cloud.command.reconcile",
        producer: "desktop",
        priority: "high",
        subject: { kind: "cloud_command", id: commandId },
        reasonCode: "DESKTOP_RESTART_DURING_RUNTIME_REQUEST",
        errorCodes: ["COMMAND_COMPLETION_UNCERTAIN"],
        contextRefs: [{ kind: "cloud_command", id: commandId }],
        allowedActions: [
          "agent.inspect",
          "runtime.diagnostics",
          "cloud.command.reconcile",
        ],
        requiresUserConfirmation: true,
        correlationId: commandId,
        dedupeKey: `cloud-command:${commandId}:uncertain`,
      });
    }

    this.running = true;
    this.state.status = "starting";
    this.onEvent("info", "Cloud Bridge starting", {
      deviceId: this.deviceId,
      recoveredUncertain: recovered.length,
    });

    await this.syncOnce({ forceHeartbeat: true }).catch((error) => {
      this.noteError(error);
    });
    this.scheduleNext();
    return this.snapshot();
  }

  async stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.state.status = "stopped";
    return this.snapshot();
  }

  scheduleNext() {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.syncOnce()
        .catch((error) => this.noteError(error))
        .finally(() => this.scheduleNext());
    }, this.pollIntervalMs);
    this.timer.unref?.();
  }

  noteContact() {
    this.state.lastCloudContactAt = new Date().toISOString();
    this.state.lastErrorCode = null;
    this.state.status = "connected";
  }

  noteError(error) {
    this.state.status = "degraded";
    this.state.lastErrorCode = errorCode(error);
    if (
      error?.status === 401 ||
      ["UNAUTHORIZED", "DEVICE_REVOKED", "INVALID_DEVICE_CREDENTIAL"].includes(
        this.state.lastErrorCode,
      )
    ) {
      Promise.resolve(this.onAuthRejected(error)).catch(() => undefined);
    }
    this.state.lastErrorAt = new Date().toISOString();
    this.onEvent("warn", "Cloud Bridge sync failed", {
      code: this.state.lastErrorCode,
    });
    this.queueTelemetry({
      eventType: "desktop.cloud.bridge.error",
      severity: "warn",
      operation: "sync",
      errorCode: this.state.lastErrorCode,
      errorFingerprint: errorFingerprint(error),
      recoverable: true,
    });
  }

  async syncOnce({ forceHeartbeat = false } = {}) {
    if (this.syncing) return this.snapshot();
    this.syncing = true;
    try {
      await this.flushOutbox();

      const now = Date.now();
      const lastHeartbeat = this.state.lastHeartbeatAt
        ? new Date(this.state.lastHeartbeatAt).getTime()
        : 0;
      if (forceHeartbeat || now - lastHeartbeat >= this.presenceIntervalMs) {
        const presence = await this.buildPresence();
        await this.client.heartbeat(presence);
        this.state.lastHeartbeatAt = new Date().toISOString();
        this.noteContact();
      }

      const pulled = await this.client.pullCommands(this.commandLimit);
      this.state.lastPollAt = new Date().toISOString();
      this.noteContact();

      const commands = Array.isArray(pulled?.commands) ? pulled.commands : [];
      for (const command of commands) {
        await this.processCommand(command);
      }

      let approvalBatch = { decisions: [] };
      const approvalPullAvailable =
        typeof this.client.pullApprovalDecisions === "function";
      const approvalProbeDue =
        this.approvalDecisionCapability.status !== "unavailable" ||
        Date.now() >= this.approvalDecisionCapability.nextProbeAtMs;

      if (approvalPullAvailable && approvalProbeDue) {
        const previousApprovalStatus =
          this.approvalDecisionCapability.status;
        try {
          approvalBatch = await this.client.pullApprovalDecisions(
            this.commandLimit,
          );
          this.approvalDecisionCapability = {
            status: "supported",
            nextProbeAtMs: 0,
          };
          if (previousApprovalStatus === "unavailable") {
            this.onEvent(
              "info",
              "Cloud approval decision sync recovered",
              {
                previousStatus: previousApprovalStatus,
                status: "supported",
              },
            );
          }
        } catch (error) {
          if (error?.status === 404 || errorCode(error) === "NOT_FOUND") {
            this.approvalDecisionCapability = {
              status: "unavailable",
              nextProbeAtMs: Date.now() + 60_000,
            };
            if (previousApprovalStatus !== "unavailable") {
              this.onEvent(
                "warn",
                "Cloud approval decision sync is unavailable on this deployment",
                {
                  code: errorCode(error),
                  retryAfterMs: 60_000,
                },
              );
            }
          } else {
            throw error;
          }
        }
      }

      const decisions = Array.isArray(approvalBatch?.decisions)
        ? approvalBatch.decisions
        : [];
      for (const decision of decisions) {
        await this.processApprovalDecision(decision);
      }

      await this.projectRuntimeTerminalStates();
      await this.flushOutbox();
      return this.snapshot();
    } finally {
      this.syncing = false;
    }
  }

  async processCommand(command) {
    const commandId = typeof command?.commandId === "string"
      ? command.commandId
      : "";
    if (!commandId) return;

    const begun = this.store.beginCommand(command);

    if (begun.conflict) {
      this.onEvent("error", "Cloud command digest conflict", { commandId });
      this.queueTelemetry({
        eventType: "desktop.cloud.command.digest_conflict",
        severity: "critical",
        operation: "command_dedupe",
        errorCode: "COMMAND_DIGEST_CONFLICT",
        correlationId: commandId,
        recoverable: false,
        attributes: { commandKind: boundedString(command.kind, 80) },
      }, `telemetry:conflict:${commandId}`);
      return;
    }

    if (begun.existing) {
      const record = begun.record;
      if (record.status === "accepted") {
        await this.client.acceptCommand(commandId, {
          ...(record.runtimeTaskId
            ? { runtimeTaskId: record.runtimeTaskId }
            : {}),
          ...(record.runtimeRunId
            ? { runtimeRunId: record.runtimeRunId }
            : {}),
        });
        this.noteContact();
      } else if (record.status === "rejected") {
        await this.client.rejectCommand(
          commandId,
          record.rejectionReason || "Rejected locally",
        );
        this.noteContact();
      }
      return;
    }

    if (command.deviceId !== this.deviceId) {
      return await this.rejectNewCommand(
        commandId,
        "DEVICE_TARGET_MISMATCH",
      );
    }

    if (
      command.expiresAt &&
      Number.isFinite(new Date(command.expiresAt).getTime()) &&
      new Date(command.expiresAt).getTime() <= Date.now()
    ) {
      return await this.rejectNewCommand(commandId, "COMMAND_EXPIRED_LOCAL");
    }

    if (!supportsRemoteCommand(command.kind, command.kindVersion)) {
      const knownKind = ["runtime.task.create", "runtime.task.create-and-start"].includes(
        command.kind,
      );
      return await this.rejectNewCommand(
        commandId,
        knownKind
          ? `UNSUPPORTED_COMMAND_VERSION:${boundedString(command.kind, 80)}@${boundedString(command.kindVersion, 20)}`
          : `UNSUPPORTED_COMMAND_KIND:${boundedString(command.kind, 80)}`,
      );
    }

    if (
      command.kind === "runtime.task.create" ||
      command.kind === "runtime.task.create-and-start"
    ) {
      let request;
      try {
        request = validateTaskCreatePayload(command.payload);
      } catch (error) {
        return await this.rejectNewCommand(
          commandId,
          `INVALID_COMMAND_PAYLOAD:${errorCode(error)}`,
        );
      }

      try {
        const task = await this.runtimeClient.createTask(request, {
          requestId: `cloud:${commandId}:create`,
          idempotencyKey: `cloud-command:${commandId}:create`,
        });
        const runtimeTaskId =
          typeof task?.id === "string"
            ? task.id
            : typeof task?.taskId === "string"
              ? task.taskId
              : null;
        if (!runtimeTaskId) {
          throw Object.assign(
            new Error("Runtime task creation returned no task identity."),
            { code: "RUNTIME_IDENTITY_MISSING", runtimeResponded: true },
          );
        }

        if (command.kind === "runtime.task.create-and-start") {
          await this.runtimeClient.startTask(runtimeTaskId, {
            requestId: `cloud:${commandId}:start`,
            idempotencyKey: `cloud-command:${commandId}:start`,
          });
        }

        const mapping = { runtimeTaskId };
        this.store.markAccepted(commandId, mapping);
        this.queueIntegrationEvent(
          "desktop.cloud.command.mapped",
          commandId,
          { commandKind: command.kind, runtimeTaskId },
          `mapped:${commandId}`,
        );
        this.queueTelemetry({
          eventType: "desktop.cloud.command.accepted",
          severity: "info",
          operation: command.kind,
          correlationId: commandId,
          taskId: runtimeTaskId,
          attributes: { commandKind: command.kind },
        }, `telemetry:accepted:${commandId}`);

        await this.client.acceptCommand(commandId, mapping);
        this.noteContact();
        this.onEvent("info", "Cloud command accepted", {
          commandId,
          runtimeTaskId,
        });
      } catch (error) {
        const current = this.store.getCommand(commandId);
        if (current?.status === "accepted") {
          this.onEvent("warn", "Cloud accept acknowledgement failed", {
            commandId,
            runtimeTaskId: current.runtimeTaskId,
            code: errorCode(error),
          });
          throw error;
        }

        if (error?.runtimeResponded === true) {
          this.store.markRejected(
            commandId,
            `RUNTIME_REJECTED:${errorCode(error)}`,
          );
          this.queueTelemetry({
            eventType: "desktop.cloud.command.rejected",
            severity: "warn",
            operation: "runtime.task.create",
            errorCode: errorCode(error),
            errorFingerprint: errorFingerprint(error),
            correlationId: commandId,
            recoverable: false,
            attributes: { commandKind: command.kind },
          }, `telemetry:rejected:${commandId}`);
          await this.client.rejectCommand(
            commandId,
            `RUNTIME_REJECTED:${errorCode(error)}`,
          );
          this.noteContact();
          return;
        }

        this.store.markUncertain(commandId, errorCode(error));
        this.onAgentRequest({
          type: "cloud.command.reconcile",
          producer: "desktop",
          priority: "high",
          subject: { kind: "cloud_command", id: commandId },
          reasonCode: "RUNTIME_COMPLETION_UNCERTAIN",
          errorCodes: [errorCode(error)],
          contextRefs: [{ kind: "cloud_command", id: commandId }],
          allowedActions: [
            "agent.inspect",
            "runtime.diagnostics",
            "cloud.command.reconcile",
          ],
          requiresUserConfirmation: true,
          correlationId: commandId,
          dedupeKey: `cloud-command:${commandId}:uncertain`,
        });
        this.queueIntegrationEvent(
          "desktop.cloud.command.uncertain",
          commandId,
          {
            commandKind: command.kind,
            errorCode: errorCode(error),
          },
          `uncertain:${commandId}`,
        );
        this.queueTelemetry({
          eventType: "desktop.cloud.command.uncertain",
          severity: "error",
          operation: "runtime.task.create",
          errorCode: errorCode(error),
          errorFingerprint: errorFingerprint(error),
          correlationId: commandId,
          recoverable: true,
          attributes: { commandKind: command.kind },
        }, `telemetry:uncertain:${commandId}`);
        this.onEvent("error", "Cloud command completion is uncertain", {
          commandId,
          code: errorCode(error),
        });
      }
    }
  }

  async processApprovalDecision(decision) {
    const approvalDecisionId =
      typeof decision?.approvalDecisionId === "string"
        ? decision.approvalDecisionId
        : "";
    const approvalId =
      typeof decision?.approvalId === "string" ? decision.approvalId : "";
    if (!approvalDecisionId || !approvalId) return;

    const begun = this.store.beginApprovalDecision(decision);
    if (begun.conflict) {
      this.onEvent("error", "Cloud approval decision digest conflict", {
        approvalDecisionId,
        approvalId,
      });
      return;
    }

    if (begun.existing && begun.record.status === "acknowledged") {
      await this.client.acknowledgeApprovalDecision(
        approvalDecisionId,
        begun.record.runtimeOutcome,
      );
      this.noteContact();
      return;
    }

    if (!["approve", "deny"].includes(decision.decision)) {
      this.onEvent("warn", "Cloud approval decision rejected locally", {
        approvalDecisionId,
        approvalId,
        decision: boundedString(decision.decision, 40),
      });
      return;
    }

    const action =
      decision.decision === "approve"
        ? this.runtimeClient.approveApproval.bind(this.runtimeClient)
        : this.runtimeClient.denyApproval.bind(this.runtimeClient);
    const suffix = decision.decision === "approve" ? "approve" : "deny";

    const result = await action(approvalId, {
      requestId: `cloud-approval:${approvalDecisionId}:${suffix}`,
      idempotencyKey: `cloud-approval:${approvalDecisionId}:${suffix}`,
    });

    const finalApproval =
      typeof this.runtimeClient.getApproval === "function"
        ? await this.runtimeClient
            .getApproval(approvalId)
            .catch(() => result?.approval ?? null)
        : result?.approval ?? null;
    const approvalState = String(finalApproval?.state ?? result?.approval?.state ?? "unknown");
    const runtimeTaskId =
      result?.task?.id ??
      finalApproval?.ownerTaskId ??
      result?.approval?.ownerTaskId ??
      null;
    const finalTask =
      runtimeTaskId && typeof this.runtimeClient.getTask === "function"
        ? await Promise.resolve(
            this.runtimeClient.getTask(runtimeTaskId, false),
          ).catch(() => result?.task ?? null)
        : result?.task ?? null;
    const taskStatus = finalTask?.status ?? result?.task?.status ?? null;
    const outcome = {
      approvalState,
      ...(runtimeTaskId ? { runtimeTaskId } : {}),
      ...(taskStatus ? { taskStatus } : {}),
      consumed: approvalState === "consumed",
    };

    this.store.markApprovalDecisionAcknowledged(
      approvalDecisionId,
      outcome,
    );
    await this.client.acknowledgeApprovalDecision(
      approvalDecisionId,
      outcome,
    );
    this.noteContact();
    this.queueIntegrationEvent(
      "desktop.cloud.approval.acknowledged",
      approvalDecisionId,
      {
        approvalId,
        decision: decision.decision,
        approvalState,
        ...(runtimeTaskId ? { runtimeTaskId } : {}),
        ...(taskStatus ? { taskStatus } : {}),
      },
      `approval:${approvalDecisionId}`,
    );
    this.onEvent("info", "Cloud approval decision applied to Runtime", {
      approvalDecisionId,
      approvalId,
      decision: decision.decision,
      approvalState,
      runtimeTaskId,
      taskStatus,
    });
  }

  async projectRuntimeTerminalStates(limit = 100) {
    const records =
      this.store.listAcceptedRuntimeMappingsPendingTerminal(limit);

    for (const record of records) {
      try {
        const task = await this.runtimeClient.getTask(
          record.runtimeTaskId,
          false,
        );
        const terminal =
          task?.progress?.terminal === true ||
          ["completed", "failed", "blocked", "cancelled"].includes(
            task?.status,
          );
        if (!terminal) continue;

        const status = String(task.status ?? "unknown");
        const revision = Number.isInteger(task?.progress?.revision)
          ? task.progress.revision
          : null;

        this.queueIntegrationEvent(
          "desktop.cloud.task.terminal",
          record.commandId,
          {
            runtimeTaskId: record.runtimeTaskId,
            status,
            progressRevision: revision,
          },
          `terminal:${record.commandId}`,
        );
        this.queueTelemetry(
          {
            eventType: "desktop.cloud.task.terminal",
            severity: status === "completed" ? "info" : "warn",
            operation: "runtime.task.terminal",
            correlationId: record.commandId,
            taskId: record.runtimeTaskId,
            attributes: {
              runtimeStatus: status,
              progressRevision: revision,
            },
          },
          `telemetry:terminal:${record.commandId}`,
        );
        this.store.markRuntimeTerminal(record.commandId, {
          status,
          revision,
        });
        this.onEvent("info", "Runtime terminal state projected to Cloud", {
          commandId: record.commandId,
          runtimeTaskId: record.runtimeTaskId,
          status,
          progressRevision: revision,
        });
      } catch (error) {
        this.onEvent("warn", "Runtime terminal projection deferred", {
          commandId: record.commandId,
          runtimeTaskId: record.runtimeTaskId,
          code: errorCode(error),
        });
      }
    }
  }

  async rejectNewCommand(commandId, reason) {
    this.store.markRejected(commandId, reason);
    this.queueTelemetry({
      eventType: "desktop.cloud.command.rejected",
      severity: "warn",
      operation: "command_validation",
      errorCode: boundedString(reason.split(":")[0], 80),
      correlationId: commandId,
      recoverable: false,
    }, `telemetry:rejected:${commandId}`);
    await this.client.rejectCommand(commandId, reason);
    this.noteContact();
    this.onEvent("warn", "Cloud command rejected", {
      commandId,
      reason: boundedString(reason, 160),
    });
  }

  queueIntegrationEvent(eventType, correlationId, payload, eventId) {
    return this.store.enqueueOutbox(
      "event",
      {
        eventId: eventId ?? `desktop:${randomUUID()}`,
        eventType,
        eventVersion: 1,
        occurredAt: new Date().toISOString(),
        producer: "owl-desktop",
        deviceId: this.deviceId,
        correlationId,
        payload,
      },
      eventId,
    );
  }

  queueTelemetry(input, eventId) {
    if (!this.telemetryEnabled) return null;
    const payload = {
      eventId: eventId ?? `telemetry:${randomUUID()}`,
      eventType: input.eventType,
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      producer: "owl-desktop",
      severity: input.severity ?? "info",
      component: "cloud-bridge",
      componentVersion: this.appVersion,
      ...(input.operation ? { operation: boundedString(input.operation, 120) } : {}),
      ...(input.errorCode ? { errorCode: boundedString(input.errorCode, 80) } : {}),
      ...(input.errorFingerprint
        ? { errorFingerprint: boundedString(input.errorFingerprint, 80) }
        : {}),
      ...(typeof input.durationMs === "number"
        ? { durationMs: input.durationMs }
        : {}),
      ...(typeof input.retryCount === "number"
        ? { retryCount: input.retryCount }
        : {}),
      ...(typeof input.recoverable === "boolean"
        ? { recoverable: input.recoverable }
        : {}),
      ...(input.correlationId
        ? { correlationId: boundedString(input.correlationId, 160) }
        : {}),
      ...(input.taskId ? { taskId: boundedString(input.taskId, 160) } : {}),
      ...(input.runId ? { runId: boundedString(input.runId, 160) } : {}),
      ...(isObject(input.attributes)
        ? {
            attributes: Object.fromEntries(
              Object.entries(input.attributes)
                .slice(0, 20)
                .filter(([, value]) =>
                  value === null ||
                  ["string", "number", "boolean"].includes(typeof value),
                )
                .map(([key, value]) => [
                  boundedString(key, 80),
                  typeof value === "string" ? boundedString(value, 256) : value,
                ]),
            ),
          }
        : {}),
    };
    return this.store.enqueueOutbox("telemetry", payload, payload.eventId);
  }

  async flushOutbox() {
    const due = this.store.dueOutbox(new Date(), 100);
    if (!due.length) return;

    const telemetry = due.filter((entry) => entry.kind === "telemetry");
    if (telemetry.length) {
      try {
        await this.client.postTelemetry(telemetry.map((entry) => entry.payload));
        this.store.markOutboxDelivered(telemetry.map((entry) => entry.id));
        this.noteContact();
      } catch (error) {
        for (const entry of telemetry) {
          this.store.markOutboxFailed(
            entry.id,
            errorCode(error),
            backoffMs(entry.attempts),
          );
        }
      }
    }

    for (const entry of due.filter((item) => item.kind === "event")) {
      try {
        await this.client.postEvent(entry.payload);
        this.store.markOutboxDelivered([entry.id]);
        this.noteContact();
      } catch (error) {
        this.store.markOutboxFailed(
          entry.id,
          errorCode(error),
          backoffMs(entry.attempts),
        );
      }
    }
  }
}

export function supportedCloudCommandKinds() {
  return [...SUPPORTED_COMMAND_KINDS];
}
