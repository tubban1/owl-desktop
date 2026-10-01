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
      getRuntimeLease: vi.fn(async () => ({
        canRun: true,
        access: {
          deviceId: "dev_1",
          canView: true,
          canRun: true,
          canSchedule: true,
          canApprove: true,
        },
        entitlement: {
          plan: "trial",
          status: "trial_active",
          canRun: true,
          features: { runtime: true },
        },
        leaseToken: "owllease1.payload.signature",
        lease: { leaseId: "lease_1" },
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
    expect(result.entitlement.status).toBe("trial_active");
    expect(result.runtimeLease.leaseToken).toBe("owllease1.payload.signature");
  });


  it("reuses an already-enrolled active device instead of consuming another plan slot", async () => {
    const store = fakeStore();
    store.settings.cloudDeviceId = "dev_existing";
    store.upsertSecret({
      name: cloudEnrollmentSecretNames.deviceCredential,
      project: "owl-cloud",
      value: "owldev1.dev_existing.secret",
    });
    const cloudClient = {
      bootstrap: vi.fn(async () => ({
        userId: "user_1",
        entitlement: {
          plan: "trial",
          status: "trial_active",
          canRun: true,
          features: { runtime: true },
        },
      })),
      listDevices: vi.fn(async () => ({
        devices: [
          {
            deviceId: "dev_existing",
            registrationState: "active",
            displayName: "This Mac",
            platform: "darwin-arm64",
          },
        ],
      })),
      registerDevice: vi.fn(),
      getRuntimeLease: vi.fn(async () => ({
        canRun: true,
        access: { deviceId: "dev_existing", canRun: true },
        entitlement: {
          plan: "trial",
          status: "trial_active",
          canRun: true,
          features: { runtime: true },
        },
        leaseToken: "owllease1.payload.signature",
        lease: { leaseId: "lease_existing" },
      })),
    };
    const auth = {
      complete: vi.fn(async () => ({
        idToken: "id-token",
        refreshToken: "refresh-token-2",
        expiresIn: 3600,
        tokenType: "Bearer",
      })),
    };
    const service = new CloudEnrollmentService({
      cloudClient,
      auth,
      store,
    });

    const result = await service.complete(
      "owl-desktop://auth/callback?code=x&state=y",
    );

    expect(cloudClient.listDevices).toHaveBeenCalledWith("id-token");
    expect(cloudClient.registerDevice).not.toHaveBeenCalled();
    expect(result.device.deviceId).toBe("dev_existing");
    expect(result.runtimeLease.lease.leaseId).toBe("lease_existing");
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
      bootstrap: vi.fn(async () => ({ userId: "user_1" })),
      getRuntimeLease: vi.fn(async () => ({
        canRun: true,
        access: {
          deviceId: "dev_1",
          canRun: true,
        },
        entitlement: {
          plan: "trial",
          status: "trial_active",
          canRun: true,
          features: { runtime: true },
        },
        leaseToken: "owllease1.payload.signature",
        lease: { leaseId: "lease_resume" },
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

it("sign-out removes only the account refresh token and preserves enrolled device identity", () => {
  const store = fakeStore();
  store.upsertSecret({
    name: cloudEnrollmentSecretNames.deviceCredential,
    project: cloudEnrollmentSecretNames.project,
    value: "owldev1.dev_keep.device-secret",
  });
  store.upsertSecret({
    name: cloudEnrollmentSecretNames.accountRefreshToken,
    project: cloudEnrollmentSecretNames.project,
    value: "refresh-remove",
  });
  const service = new CloudEnrollmentService({
    cloudClient: {},
    auth: {},
    store,
  });

  service.clearAccountSession();

  expect(
    store.readSecret(
      cloudEnrollmentSecretNames.accountRefreshToken,
      cloudEnrollmentSecretNames.project,
    ),
  ).toBeUndefined();
  expect(
    store.readSecret(
      cloudEnrollmentSecretNames.deviceCredential,
      cloudEnrollmentSecretNames.project,
    ),
  ).toBe("owldev1.dev_keep.device-secret");
});
