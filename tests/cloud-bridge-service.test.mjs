import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudBridgeService } from "../electron/services/cloud-bridge-service.mjs";
import { CloudBridgeStore } from "../electron/services/cloud-bridge-store.mjs";

const scratch = [];

function createStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "owl-cloud-bridge-"));
  scratch.push(dir);
  return new CloudBridgeStore({
    file: path.join(dir, "cloud-bridge-state.json"),
  });
}

function command(overrides = {}) {
  return {
    commandId: "cmd_1",
    deviceId: "dev_1",
    kind: "runtime.task.create",
    payload: {
      label: "Cloud task",
      steps: [
        {
          id: "status",
          action: "git.status",
          args: { cwd: "/workspace" },
        },
      ],
    },
    status: "dispatched",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function createClient(overrides = {}) {
  return {
    heartbeat: vi.fn(async () => ({ deviceId: "dev_1" })),
    pullCommands: vi.fn(async () => ({ commands: [] })),
    acceptCommand: vi.fn(async (_id, mapping) => ({
      status: "accepted",
      ...mapping,
    })),
    rejectCommand: vi.fn(async (_id, reason) => ({
      status: "rejected",
      rejectionReason: reason,
    })),
    postEvent: vi.fn(async (event) => ({
      eventId: event.eventId,
      duplicate: false,
    })),
    postTelemetry: vi.fn(async (events) => ({
      accepted: events.length,
      duplicates: 0,
    })),
    ...overrides,
  };
}

function createService({
  client = createClient(),
  runtimeClient = {
    createTask: vi.fn(async () => ({ id: "task_1" })),
    startTask: vi.fn(async () => ({
      id: "task_1",
      accepted: true,
      alreadyRunning: false,
      status: "running",
      progress: { terminal: false, revision: 2 },
    })),
    getTask: vi.fn(async () => ({
      id: "task_1",
      status: "running",
      progress: { terminal: false, revision: 2 },
    })),
  },
  store = createStore(),
  onAgentRequest = vi.fn(),
  onAuthRejected = vi.fn(),
} = {}) {
  return {
    client,
    runtimeClient,
    store,
    onAgentRequest,
    onAuthRejected,
    service: new CloudBridgeService({
      client,
      runtimeClient,
      store,
      deviceId: "dev_1",
      appVersion: "0.1.0",
      pollIntervalMs: 60_000,
      presenceIntervalMs: 60_000,
      buildPresence: async () => ({
        capabilities: { cloudBridge: "m1-polling-v1" },
        runtimeCompatibility: { runtimeApiVersion: "0.1" },
      }),
      onAgentRequest,
      onAuthRejected,
    }),
  };
}

afterEach(() => {
  for (const dir of scratch.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("CloudBridgeService", () => {
  it("maps runtime.task.create once and replays only the Cloud accept on redelivery", async () => {
    const setup = createService();
    const input = command();

    await setup.service.processCommand(input);
    await setup.service.processCommand(input);

    expect(setup.runtimeClient.createTask).toHaveBeenCalledTimes(1);
    expect(setup.runtimeClient.createTask).toHaveBeenCalledWith(
      input.payload,
      {
        requestId: "cloud:cmd_1:create",
        idempotencyKey: "cloud-command:cmd_1:create",
      },
    );
    expect(setup.client.acceptCommand).toHaveBeenCalledTimes(2);
    expect(setup.client.acceptCommand).toHaveBeenLastCalledWith(
      "cmd_1",
      { runtimeTaskId: "task_1" },
    );
    expect(setup.store.getCommand("cmd_1")).toMatchObject({
      status: "accepted",
      runtimeTaskId: "task_1",
    });
  });

  it("maps runtime.task.create-and-start to one durable Task start", async () => {
    const setup = createService();
    const input = command({
      commandId: "cmd_start",
      kind: "runtime.task.create-and-start",
    });

    await setup.service.processCommand(input);
    await setup.service.processCommand(input);

    expect(setup.runtimeClient.createTask).toHaveBeenCalledTimes(1);
    expect(setup.runtimeClient.startTask).toHaveBeenCalledTimes(1);
    expect(setup.runtimeClient.startTask).toHaveBeenCalledWith(
      "task_1",
      {
        requestId: "cloud:cmd_start:start",
        idempotencyKey: "cloud-command:cmd_start:start",
      },
    );
    expect(setup.client.acceptCommand).toHaveBeenCalledTimes(2);
    expect(setup.store.getCommand("cmd_start")).toMatchObject({
      status: "accepted",
      runtimeTaskId: "task_1",
      runtimeTerminalProjectedAt: null,
    });
  });

  it("projects canonical Runtime terminal truth to Cloud exactly once", async () => {
    const runtimeClient = {
      createTask: vi.fn(async () => ({ id: "task_terminal" })),
      startTask: vi.fn(async () => ({
        id: "task_terminal",
        accepted: true,
        status: "running",
        progress: { terminal: false, revision: 2 },
      })),
      getTask: vi.fn(async () => ({
        id: "task_terminal",
        status: "completed",
        progress: { terminal: true, revision: 9 },
      })),
    };
    const client = createClient();
    const setup = createService({ client, runtimeClient });
    const input = command({
      commandId: "cmd_terminal",
      kind: "runtime.task.create-and-start",
    });

    await setup.service.processCommand(input);
    await setup.service.projectRuntimeTerminalStates();
    await setup.service.flushOutbox();
    await setup.service.projectRuntimeTerminalStates();
    await setup.service.flushOutbox();

    expect(runtimeClient.getTask).toHaveBeenCalledTimes(1);
    expect(setup.store.getCommand("cmd_terminal")).toMatchObject({
      runtimeTerminalStatus: "completed",
      runtimeTerminalRevision: 9,
    });
    expect(client.postEvent).toHaveBeenCalledTimes(2);
    expect(client.postEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "desktop.cloud.task.terminal",
        correlationId: "cmd_terminal",
        payload: expect.objectContaining({
          runtimeTaskId: "task_terminal",
          status: "completed",
          progressRevision: 9,
        }),
      }),
    );
    expect(client.postTelemetry).toHaveBeenCalled();
  });

  it("keeps accepted mapping when the Cloud ACK fails after Runtime success", async () => {
    const client = createClient({
      acceptCommand: vi.fn(async () => {
        const error = new Error("network down");
        error.code = "CLOUD_NETWORK_ERROR";
        throw error;
      }),
    });
    const setup = createService({ client });

    await expect(setup.service.processCommand(command())).rejects.toMatchObject({
      code: "CLOUD_NETWORK_ERROR",
    });

    expect(setup.runtimeClient.createTask).toHaveBeenCalledTimes(1);
    expect(setup.store.getCommand("cmd_1")).toMatchObject({
      status: "accepted",
      runtimeTaskId: "task_1",
    });
  });

  it("never re-executes a command recovered as uncertain after restart", async () => {
    const store = createStore();
    const input = command({ commandId: "cmd_uncertain" });
    store.beginCommand(input);
    store.recoverProcessingAsUncertain();

    const setup = createService({ store });
    await setup.service.processCommand(input);

    expect(setup.runtimeClient.createTask).not.toHaveBeenCalled();
    expect(setup.client.acceptCommand).not.toHaveBeenCalled();
    expect(setup.client.rejectCommand).not.toHaveBeenCalled();
    expect(store.getCommand("cmd_uncertain")).toMatchObject({
      status: "uncertain",
    });
  });

  it("rejects unknown command kinds without touching Runtime", async () => {
    const setup = createService();
    await setup.service.processCommand(
      command({
        commandId: "cmd_unknown",
        kind: "runtime.anything",
      }),
    );

    expect(setup.runtimeClient.createTask).not.toHaveBeenCalled();
    expect(setup.client.rejectCommand).toHaveBeenCalledWith(
      "cmd_unknown",
      "UNSUPPORTED_COMMAND_KIND:runtime.anything",
    );
    expect(setup.store.getCommand("cmd_unknown")).toMatchObject({
      status: "rejected",
    });
  });

  it("rejects malformed task.create before Runtime", async () => {
    const setup = createService();
    await setup.service.processCommand(
      command({
        commandId: "cmd_bad",
        payload: { label: "Missing steps" },
      }),
    );

    expect(setup.runtimeClient.createTask).not.toHaveBeenCalled();
    expect(setup.client.rejectCommand).toHaveBeenCalledTimes(1);
    expect(setup.store.getCommand("cmd_bad").status).toBe("rejected");
  });

  it("sanitizes task.create to the public Runtime contract before invocation", async () => {
    const setup = createService();
    await setup.service.processCommand(
      command({
        commandId: "cmd_sanitize",
        payload: {
          label: "Sanitized task",
          ignoredTopLevel: "must-not-cross-adapter",
          executionTarget: {
            kind: "host",
            allowFallback: false,
            ignoredTargetField: "drop-me",
          },
          steps: [
            {
              id: "status",
              action: "git.status",
              args: { cwd: "/workspace" },
              dependsOn: [],
              ignoredStepField: "drop-me",
              verify: {
                id: "verify-status",
                ignoredVerifyField: "drop-me",
                expectations: [
                  {
                    path: "exitCode",
                    operator: "equals",
                    expected: 0,
                    ignoredExpectationField: "drop-me",
                  },
                ],
              },
            },
          ],
        },
      }),
    );

    expect(setup.runtimeClient.createTask).toHaveBeenCalledWith(
      {
        label: "Sanitized task",
        executionTarget: {
          kind: "host",
          allowFallback: false,
        },
        steps: [
          {
            id: "status",
            action: "git.status",
            args: { cwd: "/workspace" },
            dependsOn: [],
            verify: {
              id: "verify-status",
              expectations: [
                {
                  path: "exitCode",
                  operator: "equals",
                  expected: 0,
                },
              ],
            },
          },
        ],
      },
      {
        requestId: "cloud:cmd_sanitize:create",
        idempotencyKey: "cloud-command:cmd_sanitize:create",
      },
    );
  });

  it("uses bounded validation codes instead of user-provided step text", async () => {
    const setup = createService();
    await setup.service.processCommand(
      command({
        commandId: "cmd_validation_privacy",
        payload: {
          label: "Task",
          steps: [
            {
              id: "private-user-step-name",
            },
          ],
        },
      }),
    );

    expect(setup.runtimeClient.createTask).not.toHaveBeenCalled();
    expect(setup.client.rejectCommand).toHaveBeenCalledWith(
      "cmd_validation_privacy",
      "INVALID_COMMAND_PAYLOAD:TASK_STEP_ACTION_REQUIRED",
    );
    expect(
      setup.store.getCommand("cmd_validation_privacy").rejectionReason,
    ).not.toContain("private-user-step-name");
  });

  it("turns a transport-level Runtime failure into uncertain without Cloud rejection", async () => {
    const runtimeClient = {
      createTask: vi.fn(async () => {
        const error = new Error("connection lost");
        error.code = "ECONNRESET";
        throw error;
      }),
    };
    const setup = createService({ runtimeClient });

    await setup.service.processCommand(
      command({ commandId: "cmd_runtime_unknown" }),
    );

    expect(setup.client.rejectCommand).not.toHaveBeenCalled();
    expect(setup.store.getCommand("cmd_runtime_unknown")).toMatchObject({
      status: "uncertain",
      lastErrorCode: "ECONNRESET",
    });
    expect(setup.onAgentRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "cloud.command.reconcile",
        producer: "desktop",
        priority: "high",
        subject: { kind: "cloud_command", id: "cmd_runtime_unknown" },
        reasonCode: "RUNTIME_COMPLETION_UNCERTAIN",
        errorCodes: ["ECONNRESET"],
        dedupeKey: "cloud-command:cmd_runtime_unknown:uncertain",
      }),
    );
  });

  it("rejects an explicit Runtime response and does not retry it as uncertain", async () => {
    const runtimeClient = {
      createTask: vi.fn(async () => {
        const error = new Error("Unknown routed action");
        error.code = "Error";
        error.runtimeResponded = true;
        throw error;
      }),
    };
    const setup = createService({ runtimeClient });

    await setup.service.processCommand(
      command({ commandId: "cmd_runtime_reject" }),
    );

    expect(setup.client.rejectCommand).toHaveBeenCalledWith(
      "cmd_runtime_reject",
      "RUNTIME_REJECTED:Error",
    );
    expect(setup.store.getCommand("cmd_runtime_reject")).toMatchObject({
      status: "rejected",
    });
  });

  it("notifies the Desktop access broker when Cloud rejects device authentication", async () => {
    const authError = new Error("Device revoked");
    authError.code = "UNAUTHORIZED";
    authError.status = 401;
    const client = createClient({
      heartbeat: vi.fn(async () => {
        throw authError;
      }),
    });
    const onAuthRejected = vi.fn();
    const setup = createService({ client, onAuthRejected });

    await setup.service.start();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onAuthRejected).toHaveBeenCalledTimes(1);
    expect(onAuthRejected).toHaveBeenCalledWith(authError);
    expect(setup.service.snapshot()).toMatchObject({
      status: "degraded",
      lastErrorCode: "UNAUTHORIZED",
    });
    await setup.service.stop();
  });

  it("heartbeats, polls and drains durable outbox in a sync cycle", async () => {
    const client = createClient();
    const setup = createService({ client });
    setup.service.queueTelemetry({
      eventType: "desktop.cloud.bridge.test",
      severity: "info",
    }, "telemetry:test");

    await setup.service.syncOnce({ forceHeartbeat: true });

    expect(client.heartbeat).toHaveBeenCalledTimes(1);
    expect(client.pullCommands).toHaveBeenCalledTimes(1);
    expect(client.postTelemetry).toHaveBeenCalledTimes(1);
    expect(setup.store.snapshot().outboxPending).toBe(0);
    expect(setup.service.snapshot().status).toBe("connected");
  });
});
