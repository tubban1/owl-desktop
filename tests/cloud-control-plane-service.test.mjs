import { describe, expect, it, vi } from "vitest";
import { CloudControlPlaneService } from "../electron/services/cloud-control-plane-service.mjs";

function fixture() {
  const secrets = new Map([
    ["owl-cloud:OWL_CLOUD_ACCOUNT_REFRESH_TOKEN", "refresh-old"],
  ]);
  const store = {
    readSecret: vi.fn((name, project) => secrets.get(`${project}:${name}`)),
    upsertSecret: vi.fn(({ name, project, value }) => {
      secrets.set(`${project}:${name}`, value);
    }),
  };
  const seenRefreshTokens = [];
  const auth = {
    refresh: vi.fn(async (token) => {
      seenRefreshTokens.push(token);
      expect(["refresh-old", "refresh-new"]).toContain(token);
      return {
        idToken: "id-token-secret",
        accessToken: "access-token-secret",
        refreshToken: "refresh-new",
      };
    }),
  };
  const cloudClient = {
    listDevices: vi.fn(async (jwt) => {
      expect(jwt).toBe("id-token-secret");
      return {
        devices: [
          {
            deviceId: "dev_1",
            organizationId: "org_1",
            ownerUserId: "usr_owner",
            displayName: "Jenny MacBook Air",
            platform: "darwin-arm64",
            registrationState: "active",
            lastSeenAt: "2026-10-01T18:00:00.000Z",
            capabilities: { browser: true, gui: true },
            runtimeCompatibility: { runtimeVersion: "1.0.0-rc.4" },
            createdAt: "2026-09-30T18:00:00.000Z",
            deviceCredential: "must-never-leak",
          },
        ],
      };
    }),
    listCommands: vi.fn(async (jwt, deviceId) => {
      expect(jwt).toBe("id-token-secret");
      expect(deviceId).toBe("dev_1");
      return {
        commands: [
          {
            commandId: "cmd_1",
            deviceId: "dev_1",
            createdByUserId: "usr_owner",
            kind: "runtime.task.create-and-start",
            kindVersion: 1,
            payload: {
              label: "Remote health check",
              clientSubmissionId: "owl-remote-submit:test123",
              orchestration: {
                orchestrationId: "orch_test",
                label: "Test goal",
                parentTaskId: "task_parent",
              },
              steps: [{ id: "info", action: "runtime.info" }],
              secretInput: "must-never-leak",
            },
            status: "accepted",
            createdAt: "2026-10-01T18:01:00.000Z",
            runtimeTaskId: "task_1",
          },
        ],
      };
    }),
    listDeviceEvents: vi.fn(async (jwt, deviceId) => {
      expect(jwt).toBe("id-token-secret");
      expect(deviceId).toBe("dev_1");
      return {
        events: [
          {
            eventId: "evt_other",
            eventType: "runtime.health",
            occurredAt: "2026-10-01T18:02:30.000Z",
            correlationId: "other",
            payload: { secret: "must-not-leak" },
          },
          {
            eventId: "evt_terminal",
            eventType: "desktop.cloud.task.terminal",
            occurredAt: "2026-10-01T18:03:00.000Z",
            correlationId: "cmd_1",
            payload: {
              runtimeTaskId: "task_1",
              status: "completed",
              progressRevision: 9,
              secret: "must-not-leak",
            },
          },
        ],
      };
    }),
    createCommand: vi.fn(async (jwt, deviceId, input) => {
      expect(jwt).toBe("id-token-secret");
      expect(deviceId).toBe("dev_1");
      return {
        commandId: "cmd_new",
        deviceId,
        createdByUserId: "usr_owner",
        ...input,
        status: "queued",
        createdAt: "2026-10-01T18:02:00.000Z",
      };
    }),
    cancelCommand: vi.fn(async () => ({
      commandId: "cmd_2",
      deviceId: "dev_1",
      kind: "runtime.task.create",
      kindVersion: 1,
      payload: { label: "Cancel me" },
      status: "cancelled_before_accept",
      createdAt: "2026-10-01T18:01:00.000Z",
      cancelledAt: "2026-10-01T18:02:00.000Z",
    })),
  };

  return {
    service: new CloudControlPlaneService({ cloudClient, auth, store }),
    cloudClient,
    auth,
    store,
    secrets,
  };
}

describe("CloudControlPlaneService", () => {
  it("refreshes account auth in main process and returns safe device/command DTOs", async () => {
    const f = fixture();
    const devices = await f.service.listDevices();
    expect(devices).toEqual([
      expect.objectContaining({
        deviceId: "dev_1",
        displayName: "Jenny MacBook Air",
        capabilities: { browser: true, gui: true },
      }),
    ]);
    expect(JSON.stringify(devices)).not.toContain("usr_owner");
    expect(JSON.stringify(devices)).not.toContain("must-never-leak");

    const commands = await f.service.listCommands("dev_1");
    expect(commands[0]).toMatchObject({
      commandId: "cmd_1",
      label: "Remote health check",
      status: "accepted",
      runtimeTaskId: "task_1",
      clientSubmissionId: "owl-remote-submit:test123",
      orchestration: {
        orchestrationId: "orch_test",
        label: "Test goal",
        parentTaskId: "task_parent",
      },
    });
    expect(JSON.stringify(commands)).not.toContain("secretInput");
    expect(JSON.stringify(commands)).not.toContain("id-token-secret");
    expect(JSON.stringify(commands)).not.toContain("createdByUserId");
    expect(f.secrets.get("owl-cloud:OWL_CLOUD_ACCOUNT_REFRESH_TOKEN")).toBe(
      "refresh-new",
    );

    const terminal = await f.service.findTaskTerminalEvent("dev_1", "cmd_1");
    expect(terminal).toEqual({
      eventId: "evt_terminal",
      occurredAt: "2026-10-01T18:03:00.000Z",
      commandId: "cmd_1",
      runtimeTaskId: "task_1",
      status: "completed",
      progressRevision: 9,
    });
    expect(JSON.stringify(terminal)).not.toContain("must-not-leak");
  });

  it("creates supported remote tasks without returning the task payload", async () => {
    const f = fixture();
    const result = await f.service.createCommand("dev_1", {
      kind: "runtime.task.create-and-start",
      payload: {
        label: "Remote test",
        steps: [{ id: "info", action: "runtime.info" }],
      },
    });
    expect(result).toMatchObject({
      commandId: "cmd_new",
      deviceId: "dev_1",
      label: "Remote test",
      status: "queued",
    });
    expect(result).not.toHaveProperty("payload");
    expect(f.cloudClient.createCommand).toHaveBeenCalledWith(
      "id-token-secret",
      "dev_1",
      expect.objectContaining({
        kind: "runtime.task.create-and-start",
        kindVersion: 1,
      }),
    );
  });

  it("fails closed when account login is unavailable", async () => {
    const f = fixture();
    f.secrets.delete("owl-cloud:OWL_CLOUD_ACCOUNT_REFRESH_TOKEN");
    await expect(f.service.listDevices()).rejects.toMatchObject({
      code: "ACCOUNT_LOGIN_REQUIRED",
    });
    expect(f.auth.refresh).not.toHaveBeenCalled();
  });

  it("rejects unsupported remote command kinds before Cloud", async () => {
    const f = fixture();
    await expect(
      f.service.createCommand("dev_1", {
        kind: "shell.exec",
        payload: { command: "echo no" },
      }),
    ).rejects.toMatchObject({
      code: "REMOTE_COMMAND_KIND_UNSUPPORTED",
    });
    expect(f.cloudClient.createCommand).not.toHaveBeenCalled();
  });
});
