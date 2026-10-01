import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RemoteSubmissionStore } from "../electron/services/remote-submission-store.mjs";
import {
  RemoteDeviceControlService,
  remoteSubmissionIdentity,
} from "../electron/services/remote-device-control-service.mjs";

const scratch = [];

function makeStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "owl-remote-submit-test-"));
  scratch.push(dir);
  return new RemoteSubmissionStore({
    file: path.join(dir, "remote-submissions.json"),
  });
}

function commandFromInput(deviceId, input, commandId = "cmd_1") {
  return {
    commandId,
    deviceId,
    kind: input.kind,
    kindVersion: 1,
    status: "queued",
    label: input.payload.label,
    clientSubmissionId: input.payload.clientSubmissionId,
    orchestration: input.payload.orchestration ?? null,
    createdAt: "2026-10-01T20:00:00.000Z",
    expiresAt: null,
    dispatchedAt: null,
    acceptedAt: null,
    rejectedAt: null,
    cancelledAt: null,
    rejectionReason: null,
    runtimeTaskId: null,
    runtimeRunId: null,
  };
}

function fixture({
  loseFirstResponse = false,
  terminalEvent = true,
} = {}) {
  const commands = [];
  let first = true;
  const controlPlane = {
    listDevices: vi.fn(async () => [
      {
        deviceId: "dev_1",
        displayName: "Mac mini",
        platform: "darwin-arm64",
        registrationState: "active",
        lastSeenAt: "2026-10-01T20:00:00.000Z",
        capabilities: {},
        runtimeCompatibility: {},
      },
    ]),
    listCommands: vi.fn(async () => [...commands]),
    createCommand: vi.fn(async (deviceId, input) => {
      const command = commandFromInput(
        deviceId,
        input,
        "cmd_" + String(commands.length + 1),
      );
      commands.unshift(command);
      if (loseFirstResponse && first) {
        first = false;
        const error = new Error("response lost after Cloud commit");
        error.code = "CLOUD_NETWORK_ERROR";
        throw error;
      }
      first = false;
      return command;
    }),
    findTaskTerminalEvent: vi.fn(async (_deviceId, commandId) =>
      terminalEvent
        ? {
            eventId: "evt_terminal",
            occurredAt: "2026-10-01T20:01:00.000Z",
            commandId,
            runtimeTaskId: "task_remote_1",
            status: "completed",
            progressRevision: 9,
          }
        : null,
    ),
    cancelCommand: vi.fn(async (commandId) => {
      const command = commands.find((item) => item.commandId === commandId);
      command.status = "cancelled_before_accept";
      command.cancelledAt = "2026-10-01T20:00:30.000Z";
      return command;
    }),
  };
  const store = makeStore();
  return {
    service: new RemoteDeviceControlService({ controlPlane, store }),
    store,
    controlPlane,
    commands,
  };
}

const request = {
  ownerId: "owl-owner:test",
  submissionId: "release-check-1",
  deviceId: "dev_1",
  label: "Remote release validation",
  steps: [{ id: "info", action: "runtime.info", args: {} }],
  maxConcurrency: 1,
  failFast: true,
  orchestration: {
    orchestrationId: "orch_release",
    label: "OWL LAB release",
    parentTaskId: "task_parent",
  },
};

afterEach(() => {
  for (const dir of scratch.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("RemoteDeviceControlService", () => {
  it("persists one remote submission and replays the same command identity", async () => {
    const f = fixture();

    const first = await f.service.submitTask(request);
    const replay = await f.service.submitTask(request);

    expect(first).toMatchObject({
      accepted: true,
      idempotent: false,
      commandId: "cmd_1",
      deviceId: "dev_1",
      orchestration: {
        orchestrationId: "orch_release",
        label: "OWL LAB release",
        parentTaskId: "task_parent",
      },
      doNotCreateReplacementCommand: true,
    });
    expect(replay).toMatchObject({
      accepted: true,
      idempotent: true,
      commandId: "cmd_1",
      doNotCreateReplacementCommand: true,
    });
    expect(f.controlPlane.createCommand).toHaveBeenCalledTimes(1);

    const identity = remoteSubmissionIdentity(
      request.ownerId,
      request.submissionId,
    );
    const reopened = new RemoteSubmissionStore({ file: f.store.file });
    expect(reopened.get(identity.submissionKey)).toMatchObject({
      commandId: "cmd_1",
      status: "queued",
      deviceId: "dev_1",
      clientSubmissionId: identity.clientSubmissionId,
    });
  });

  it("reconciles a Cloud commit after the create response is lost without creating twice", async () => {
    const f = fixture({ loseFirstResponse: true });

    await expect(f.service.submitTask(request)).rejects.toMatchObject({
      code: "REMOTE_SUBMISSION_UNCERTAIN",
      causeCode: "CLOUD_NETWORK_ERROR",
    });
    expect(f.commands).toHaveLength(1);
    expect(f.controlPlane.createCommand).toHaveBeenCalledTimes(1);

    const recovered = await f.service.submitTask(request);
    expect(recovered).toMatchObject({
      accepted: true,
      idempotent: true,
      reconciled: true,
      commandId: "cmd_1",
      doNotCreateReplacementCommand: true,
    });
    expect(f.controlPlane.listCommands).toHaveBeenCalled();
    expect(f.controlPlane.createCommand).toHaveBeenCalledTimes(1);
  });

  it("fails closed when a submission id is reused for different work", async () => {
    const f = fixture();
    await f.service.submitTask(request);

    await expect(
      f.service.submitTask({
        ...request,
        label: "Different remote work",
      }),
    ).rejects.toMatchObject({
      code: "REMOTE_SUBMISSION_CONFLICT",
    });
    expect(f.controlPlane.createCommand).toHaveBeenCalledTimes(1);
  });

  it("projects Cloud terminal truth without treating command acceptance as completion", async () => {
    const f = fixture();
    const submitted = await f.service.submitTask(request);
    const command = f.commands.find(
      (item) => item.commandId === submitted.commandId,
    );
    command.status = "accepted";
    command.runtimeTaskId = "task_remote_1";

    const status = await f.service.status({
      ownerId: request.ownerId,
      submissionId: request.submissionId,
    });

    expect(status).toMatchObject({
      commandStatus: "accepted",
      runtimeTaskId: "task_remote_1",
      terminal: {
        commandId: "cmd_1",
        runtimeTaskId: "task_remote_1",
        status: "completed",
        progressRevision: 9,
      },
      doNotCreateReplacementCommand: true,
    });
  });

  it("recovers terminal Runtime truth even when command history no longer returns the command", async () => {
    const f = fixture();
    const submitted = await f.service.submitTask(request);
    expect(submitted.commandId).toBe("cmd_1");

    f.commands.splice(0, f.commands.length);

    const status = await f.service.status({
      ownerId: request.ownerId,
      submissionId: request.submissionId,
    });

    expect(status).toMatchObject({
      accepted: true,
      commandId: "cmd_1",
      runtimeTaskId: "task_remote_1",
      needsReconciliation: false,
      terminal: {
        commandId: "cmd_1",
        runtimeTaskId: "task_remote_1",
        status: "completed",
        progressRevision: 9,
      },
      doNotCreateReplacementCommand: true,
    });
    expect(f.controlPlane.createCommand).toHaveBeenCalledTimes(1);
  });

  it("refuses cancellation when terminal evidence already exists", async () => {
    const f = fixture();
    await f.service.submitTask(request);
    f.commands.splice(0, f.commands.length);

    await expect(
      f.service.cancel({
        ownerId: request.ownerId,
        submissionId: request.submissionId,
      }),
    ).rejects.toMatchObject({
      code: "REMOTE_SUBMISSION_TERMINAL",
    });
    expect(f.controlPlane.cancelCommand).not.toHaveBeenCalled();
  });

  it("cancels only after the canonical command identity is known", async () => {
    const f = fixture({ terminalEvent: false });
    await f.service.submitTask(request);
    const result = await f.service.cancel({
      ownerId: request.ownerId,
      submissionId: request.submissionId,
    });

    expect(result).toMatchObject({
      cancelled: true,
      commandId: "cmd_1",
      commandStatus: "cancelled_before_accept",
    });
    expect(f.controlPlane.cancelCommand).toHaveBeenCalledWith("cmd_1");
  });
});
