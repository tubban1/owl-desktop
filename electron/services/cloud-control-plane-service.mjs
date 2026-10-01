import { cloudEnrollmentSecretNames } from "./cloud-enrollment-service.mjs";

const SUPPORTED_COMMAND_KINDS = new Set([
  "runtime.task.create",
  "runtime.task.create-and-start",
]);

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? structuredClone(value)
    : {};
}

function safeDevice(device) {
  return {
    deviceId: String(device?.deviceId ?? ""),
    organizationId: String(device?.organizationId ?? ""),
    displayName: String(device?.displayName ?? "OWL device"),
    platform: String(device?.platform ?? "unknown"),
    registrationState: String(device?.registrationState ?? "unknown"),
    lastSeenAt:
      typeof device?.lastSeenAt === "string" ? device.lastSeenAt : null,
    capabilities: safeObject(device?.capabilities),
    runtimeCompatibility: safeObject(device?.runtimeCompatibility),
    createdAt: typeof device?.createdAt === "string" ? device.createdAt : null,
  };
}

function safeCommand(command) {
  const payload = safeObject(command?.payload);
  return {
    commandId: String(command?.commandId ?? ""),
    deviceId: String(command?.deviceId ?? ""),
    kind: String(command?.kind ?? ""),
    kindVersion: Number(command?.kindVersion ?? 1),
    status: String(command?.status ?? "unknown"),
    label:
      typeof payload.label === "string" && payload.label.trim()
        ? payload.label.trim()
        : String(command?.kind ?? "Remote task"),
    clientSubmissionId:
      typeof payload.clientSubmissionId === "string"
        ? payload.clientSubmissionId
        : null,
    orchestration:
      payload.orchestration && typeof payload.orchestration === "object"
        ? {
            orchestrationId:
              typeof payload.orchestration.orchestrationId === "string"
                ? payload.orchestration.orchestrationId
                : null,
            label:
              typeof payload.orchestration.label === "string"
                ? payload.orchestration.label
                : null,
            parentTaskId:
              typeof payload.orchestration.parentTaskId === "string"
                ? payload.orchestration.parentTaskId
                : null,
          }
        : null,
    createdAt:
      typeof command?.createdAt === "string" ? command.createdAt : null,
    expiresAt:
      typeof command?.expiresAt === "string" ? command.expiresAt : null,
    dispatchedAt:
      typeof command?.dispatchedAt === "string" ? command.dispatchedAt : null,
    acceptedAt:
      typeof command?.acceptedAt === "string" ? command.acceptedAt : null,
    rejectedAt:
      typeof command?.rejectedAt === "string" ? command.rejectedAt : null,
    cancelledAt:
      typeof command?.cancelledAt === "string" ? command.cancelledAt : null,
    rejectionReason:
      typeof command?.rejectionReason === "string"
        ? command.rejectionReason
        : null,
    runtimeTaskId:
      typeof command?.runtimeTaskId === "string"
        ? command.runtimeTaskId
        : null,
    runtimeRunId:
      typeof command?.runtimeRunId === "string"
        ? command.runtimeRunId
        : null,
  };
}

export class CloudControlPlaneService {
  constructor({ cloudClient, auth, store } = {}) {
    if (!cloudClient) {
      throw new Error("CloudControlPlaneService requires a Cloud client.");
    }
    if (!auth) {
      throw new Error("CloudControlPlaneService requires account auth.");
    }
    if (!store) {
      throw new Error("CloudControlPlaneService requires Desktop store.");
    }
    this.cloudClient = cloudClient;
    this.auth = auth;
    this.store = store;
  }

  async userJwt() {
    const refreshToken = this.store.readSecret(
      cloudEnrollmentSecretNames.accountRefreshToken,
      cloudEnrollmentSecretNames.project,
    );
    if (!refreshToken) {
      throw codedError(
        "ACCOUNT_LOGIN_REQUIRED",
        "Sign in to OWL LAB before controlling another device.",
      );
    }

    const tokens = await this.auth.refresh(refreshToken);
    if (!tokens?.idToken) {
      throw codedError(
        "ACCOUNT_SESSION_INVALID",
        "OWL Cloud account refresh did not return an ID token.",
      );
    }

    if (tokens.refreshToken && tokens.refreshToken !== refreshToken) {
      this.store.upsertSecret({
        name: cloudEnrollmentSecretNames.accountRefreshToken,
        project: cloudEnrollmentSecretNames.project,
        value: tokens.refreshToken,
      });
    }

    return tokens.idToken;
  }

  async listDevices() {
    const userJwt = await this.userJwt();
    const result = await this.cloudClient.listDevices(userJwt);
    const devices = Array.isArray(result?.devices) ? result.devices : [];
    return devices.map(safeDevice).filter((device) => device.deviceId);
  }

  async listCommands(deviceId, limit = 50) {
    if (!deviceId) throw codedError("DEVICE_ID_REQUIRED", "deviceId is required.");
    const userJwt = await this.userJwt();
    const result = await this.cloudClient.listCommands(
      userJwt,
      deviceId,
      limit,
    );
    const commands = Array.isArray(result?.commands) ? result.commands : [];
    return commands.map(safeCommand).filter((command) => command.commandId);
  }

  async findTaskTerminalEvent(deviceId, commandId, limit = 100) {
    if (!deviceId) {
      throw codedError("DEVICE_ID_REQUIRED", "deviceId is required.");
    }
    if (!commandId) {
      throw codedError("COMMAND_ID_REQUIRED", "commandId is required.");
    }
    const userJwt = await this.userJwt();
    const result = await this.cloudClient.listDeviceEvents(
      userJwt,
      deviceId,
      limit,
    );
    const events = Array.isArray(result?.events) ? result.events : [];
    const event = events.find(
      (entry) =>
        entry?.eventType === "desktop.cloud.task.terminal" &&
        entry?.correlationId === commandId,
    );
    if (!event) return null;
    const payload =
      event.payload && typeof event.payload === "object" ? event.payload : {};
    return {
      eventId: typeof event.eventId === "string" ? event.eventId : null,
      occurredAt:
        typeof event.occurredAt === "string" ? event.occurredAt : null,
      commandId,
      runtimeTaskId:
        typeof payload.runtimeTaskId === "string"
          ? payload.runtimeTaskId
          : null,
      status: typeof payload.status === "string" ? payload.status : null,
      progressRevision:
        Number.isInteger(payload.progressRevision)
          ? payload.progressRevision
          : null,
    };
  }

  async createCommand(deviceId, input) {
    if (!deviceId) throw codedError("DEVICE_ID_REQUIRED", "deviceId is required.");
    const kind = String(input?.kind ?? "");
    if (!SUPPORTED_COMMAND_KINDS.has(kind)) {
      throw codedError(
        "REMOTE_COMMAND_KIND_UNSUPPORTED",
        `Unsupported remote command kind: ${kind || "missing"}`,
      );
    }
    if (!input?.payload || typeof input.payload !== "object") {
      throw codedError(
        "REMOTE_COMMAND_PAYLOAD_REQUIRED",
        "Remote command payload is required.",
      );
    }

    const userJwt = await this.userJwt();
    const command = await this.cloudClient.createCommand(userJwt, deviceId, {
      kind,
      kindVersion: 1,
      payload: structuredClone(input.payload),
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    });
    return safeCommand(command);
  }

  async cancelCommand(commandId) {
    if (!commandId) {
      throw codedError("COMMAND_ID_REQUIRED", "commandId is required.");
    }
    const userJwt = await this.userJwt();
    return safeCommand(
      await this.cloudClient.cancelCommand(userJwt, commandId),
    );
  }
}

export const cloudControlPlaneSafeDto = {
  device: safeDevice,
  command: safeCommand,
};
