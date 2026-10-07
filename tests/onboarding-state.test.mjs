import { describe, expect, it } from "vitest";
import { normalizeOnboardingState } from "../electron/services/onboarding-state.mjs";

describe("Desktop onboarding lifecycle", () => {
  it("starts onboarding for a brand-new install", () => {
    expect(normalizeOnboardingState({})).toEqual({
      onboardingInProgress: true,
      onboardingCompletedAt: null,
    });
  });

  it("does not force migrated enrolled users back into first-run setup", () => {
    expect(
      normalizeOnboardingState({
        cloudDeviceId: "dev_existing",
      }),
    ).toEqual({
      onboardingInProgress: false,
      onboardingCompletedAt: null,
    });
  });

  it("keeps an explicitly started onboarding flow active after device enrollment", () => {
    expect(
      normalizeOnboardingState({
        cloudDeviceId: "dev_new",
        onboardingInProgress: true,
      }),
    ).toEqual({
      onboardingInProgress: true,
      onboardingCompletedAt: null,
    });
  });

  it("preserves a completed onboarding receipt", () => {
    expect(
      normalizeOnboardingState({
        onboardingInProgress: false,
        onboardingCompletedAt: "2026-10-07T20:00:00.000Z",
      }),
    ).toEqual({
      onboardingInProgress: false,
      onboardingCompletedAt: "2026-10-07T20:00:00.000Z",
    });
  });
});
