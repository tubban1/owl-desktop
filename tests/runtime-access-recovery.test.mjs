import { describe, expect, it, vi } from "vitest";
import { recoverRuntimeAccessProjection } from "../electron/services/runtime-access-recovery.mjs";

describe("Runtime access recovery after reconnect", () => {
  it("does nothing when the Cloud account is not ready", async () => {
    const enrollmentService = {
      recoverDeviceIdFromCredential: vi.fn(),
      resumeFromRefreshToken: vi.fn(),
    };
    const projectRuntimeAccess = vi.fn();

    const result = await recoverRuntimeAccessProjection({
      cloudState: {
        status: "needs_login",
        deviceId: "dev_1",
      },
      enrollmentService,
      projectRuntimeAccess,
    });

    expect(result).toBeNull();
    expect(enrollmentService.recoverDeviceIdFromCredential).not.toHaveBeenCalled();
    expect(enrollmentService.resumeFromRefreshToken).not.toHaveBeenCalled();
    expect(projectRuntimeAccess).not.toHaveBeenCalled();
  });

  it("uses the stored refresh session to restore Runtime access without interactive login", async () => {
    const enrollmentService = {
      recoverDeviceIdFromCredential: vi.fn(() => "dev_1"),
      resumeFromRefreshToken: vi.fn(async () => ({
        account: {
          userId: "user_1",
          entitlement: {
            plan: "trial",
            status: "trial_active",
            canRun: true,
            features: { runtime: true },
          },
        },
        deviceId: "dev_1",
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
        runtimeLease: {
          canRun: true,
          leaseToken: "owllease1.payload.signature",
          lease: { leaseId: "lease_reconnect" },
        },
      })),
    };
    const projectRuntimeAccess = vi.fn(async (input) => ({
      state: "READY",
      grant: {
        deviceId: input.deviceId,
        expiresAt: "2026-10-07T22:00:00.000Z",
      },
    }));

    const result = await recoverRuntimeAccessProjection({
      cloudState: {
        status: "ready",
        account: { userId: "user_1" },
        access: { deviceId: "dev_1", canRun: true },
        entitlement: null,
        runtimeAccess: {
          state: "LOCKED",
          reasonCode: "AUTHORIZATION_REQUIRED",
        },
        deviceId: "dev_1",
        lastErrorCode: "RUNTIME_UNREACHABLE",
        lastErrorMessage: "Runtime restarted",
      },
      enrollmentService,
      projectRuntimeAccess,
    });

    expect(enrollmentService.recoverDeviceIdFromCredential).toHaveBeenCalledTimes(1);
    expect(enrollmentService.resumeFromRefreshToken).toHaveBeenCalledTimes(1);
    expect(projectRuntimeAccess).toHaveBeenCalledWith({
      account: expect.objectContaining({ userId: "user_1" }),
      access: expect.objectContaining({ canRun: true }),
      deviceId: "dev_1",
      runtimeLease: expect.objectContaining({
        leaseToken: "owllease1.payload.signature",
      }),
    });
    expect(result).toMatchObject({
      runtimeAccess: {
        state: "READY",
      },
      state: {
        status: "ready",
        deviceId: "dev_1",
        runtimeAccess: {
          state: "READY",
        },
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    });
  });

  it("returns null when there is no stored refresh session to resume", async () => {
    const enrollmentService = {
      recoverDeviceIdFromCredential: vi.fn(() => "dev_1"),
      resumeFromRefreshToken: vi.fn(async () => null),
    };
    const projectRuntimeAccess = vi.fn();

    const result = await recoverRuntimeAccessProjection({
      cloudState: {
        status: "ready",
        deviceId: "dev_1",
      },
      enrollmentService,
      projectRuntimeAccess,
    });

    expect(result).toBeNull();
    expect(projectRuntimeAccess).not.toHaveBeenCalled();
  });
});
