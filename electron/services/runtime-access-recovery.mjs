export async function recoverRuntimeAccessProjection({
  cloudState,
  enrollmentService,
  projectRuntimeAccess,
} = {}) {
  if (cloudState?.status !== "ready") return null;
  if (!enrollmentService) {
    throw new Error("Runtime access recovery requires Cloud enrollment service.");
  }
  if (typeof projectRuntimeAccess !== "function") {
    throw new Error("Runtime access recovery requires access projector.");
  }

  enrollmentService.recoverDeviceIdFromCredential?.();
  const resumed = await enrollmentService.resumeFromRefreshToken();
  if (!resumed) return null;

  const deviceId =
    resumed.deviceId ?? cloudState.deviceId ?? null;
  const account =
    resumed.account ?? cloudState.account ?? null;
  const access = resumed.access ?? null;
  const entitlement =
    resumed.entitlement ??
    resumed.account?.entitlement ??
    cloudState.entitlement ??
    null;
  const runtimeLease = resumed.runtimeLease ?? null;

  const runtimeAccess = await projectRuntimeAccess({
    account,
    access,
    deviceId,
    runtimeLease,
  });

  return {
    runtimeAccess,
    state: {
      ...cloudState,
      status: "ready",
      account,
      access,
      entitlement,
      runtimeAccess,
      deviceId,
      lastErrorCode: null,
      lastErrorMessage: null,
    },
    resumed,
  };
}
