import { describe, expect, it, vi } from "vitest";
import {
  CloudEnrollmentService,
  cloudEnrollmentSecretNames,
} from "../electron/services/cloud-enrollment-service.mjs";

function fakeStore() {
  const settings = { cloudDeviceId: "", cloudEnabled: false };
  const secrets = [];
  return {
    settings,
    secrets,
    getSettings: vi.fn(() => ({ ...settings })),
    updateSettings: vi.fn((patch) => Object.assign(settings, patch)),
    upsertSecret: vi.fn(({ name, project, value }) => {
      const existing = secrets.find(
        (item) => item.name === name && item.project === project,
      );
      if (existing) existing.value = value;
      else secrets.push({
        id: `secret-${secrets.length + 1}`,
        name,
        project,
        value,
      });
      return { name, project };
    }),
    readSecret: vi.fn((name, project) =>
      secrets.find(
        (item) => item.name === name && (!project || item.project === project),
      )?.value,
    ),
    listSecrets: vi.fn(() =>
      secrets.map(({ value: _value, ...meta }) => ({ ...meta })),
    ),
    deleteSecret: vi.fn((id) => {
      const index = secrets.findIndex((item) => item.id === id);
      if (index >= 0) secrets.splice(index, 1);
      return { ok: true };
    }),
  };
}

describe("CloudEnrollmentService", () => {
  it("persists one-time device credential before non-secret device settings", async () => {
    const order = [];
    const store = fakeStore();
    store.upsertSecret.mockImplementation(({ name, project, value }) => {
      order.push(`secret:${name}`);
      const existing = store.secrets.find(
        (item) => item.name === name && item.project === project,
      );
      if (existing) existing.value = value;
      else store.secrets.push({
        id: `secret-${store.secrets.length + 1}`,
        name,
        project,
        value,
      });
      return { name, project };
    });
    store.updateSettings.mockImplementation((patch) => {
      order.push("settings");
      return Object.assign(store.settings, patch);
    });

    const cloudClient = {
      bootstrap: vi.fn(async () => ({
        user: { userId: "user_1" },
        organization: { organizationId: "org_1" },
      })),
      registerDevice: vi.fn(async () => ({
        deviceId: "dev_1",
        deviceCredential: "owldev1.dev_1.secret",
        displayName: "This Mac",
        platform: "darwin-arm64",
      })),
      getDeviceAccess: vi.fn(async () => ({
        deviceId: "dev_1",
        canView: true,
        canRun: true,
        canSchedule: true,
        canApprove: true,
      })),
    };
    const auth = {
      complete: vi.fn(async () => ({
        idToken: "id-token",
        accessToken: "access-token",
        refreshToken: "refresh-token",
        expiresIn: 3600,
        tokenType: "Bearer",
      })),
    };

    const service = new CloudEnrollmentService({
      cloudClient,
      auth,
      store,
      platform: "darwin-arm64",
      displayName: "This Mac",
    });

    const result = await service.complete(
      "owl-desktop://auth/callback?code=x&state=y",
    );

    expect(order[0]).toBe(
      `secret:${cloudEnrollmentSecretNames.deviceCredential}`,
    );
    expect(store.settings).toMatchObject({
      cloudDeviceId: "dev_1",
      cloudEnabled: true,
    });
    expect(
      store.readSecret(
        cloudEnrollmentSecretNames.deviceCredential,
        "owl-cloud",
      ),
    ).toBe("owldev1.dev_1.secret");
    expect(
      store.readSecret(
        cloudEnrollmentSecretNames.accountRefreshToken,
        "owl-cloud",
      ),
    ).toBe("refresh-token");
    expect(result.device.deviceCredential).toBeUndefined();
    expect(result.access.canRun).toBe(true);
  });

  it("recovers deviceId from the encrypted credential metadata boundary", () => {
    const store = fakeStore();
    store.upsertSecret({
      name: cloudEnrollmentSecretNames.deviceCredential,
      project: "owl-cloud",
      value: "owldev1.dev_recovered.secret-material",
    });
    const service = new CloudEnrollmentService({
      cloudClient: {},
      auth: {},
      store,
    });

    expect(service.recoverDeviceIdFromCredential()).toBe("dev_recovered");
    expect(store.settings.cloudDeviceId).toBe("dev_recovered");
  });

  it("resumes account context using only the OS-vault refresh token", async () => {
    const store = fakeStore();
    store.settings.cloudDeviceId = "dev_1";
    store.upsertSecret({
      name: cloudEnrollmentSecretNames.accountRefreshToken,
      project: "owl-cloud",
      value: "refresh-token",
    });
    const auth = {
      refresh: vi.fn(async () => ({
        idToken: "new-id-token",
        accessToken: "new-access-token",
        refreshToken: "refresh-token",
        expiresIn: 3600,
        tokenType: "Bearer",
      })),
    };
    const cloudClient = {
      bootstrap: vi.fn(async () => ({ user: { userId: "user_1" } })),
      getDeviceAccess: vi.fn(async () => ({
        deviceId: "dev_1",
        canRun: true,
      })),
    };
    const service = new CloudEnrollmentService({
      cloudClient,
      auth,
      store,
    });

    const snapshot = await service.resumeFromRefreshToken();

    expect(auth.refresh).toHaveBeenCalledWith("refresh-token");
    expect(cloudClient.bootstrap).toHaveBeenCalledWith("new-id-token");
    expect(snapshot.access.canRun).toBe(true);
  });
});
