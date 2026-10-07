export function normalizeOnboardingState(stored = {}) {
  const completedAt =
    typeof stored.onboardingCompletedAt === "string" &&
    stored.onboardingCompletedAt.trim()
      ? stored.onboardingCompletedAt.trim()
      : null;
  const hasExistingDevice =
    typeof stored.cloudDeviceId === "string" &&
    stored.cloudDeviceId.trim().length > 0;
  const inProgress =
    typeof stored.onboardingInProgress === "boolean"
      ? stored.onboardingInProgress
      : !completedAt && !hasExistingDevice;

  return {
    onboardingInProgress: inProgress,
    onboardingCompletedAt: completedAt,
  };
}
