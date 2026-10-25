import { describe, expect, it } from "vitest";
import { buildOnboardingModel } from "../src/onboardingModel";

describe("onboarding model", () => {
  it("points a new user at the first incomplete step only", () => {
    const model = buildOnboardingModel({
      runtimeReady: true,
      accountReady: false,
      executionReady: false,
      mcpReady: false,
      remoteTransportReady: false,
    });

    expect(model).toMatchObject({
      ready: false,
      completedCount: 1,
      totalCount: 4,
    });
    expect(model.steps[1].detail).toBe("Sign in and enroll this device.");
    expect(model.steps.map((step) => step.state)).toEqual([
      "complete",
      "current",
      "pending",
      "pending",
    ]);
  });

  it("keeps ChatGPT connection incomplete until both local MCP and remote transport are ready", () => {
    const model = buildOnboardingModel({
      runtimeReady: true,
      accountReady: true,
      executionReady: true,
      mcpReady: true,
      remoteTransportReady: false,
    });

    expect(model.ready).toBe(false);
    expect(model.steps.at(-1)).toMatchObject({
      id: "chatgpt",
      state: "current",
    });
  });

  it("becomes ready only when all product dependencies are ready", () => {
    const model = buildOnboardingModel({
      runtimeReady: true,
      accountReady: true,
      executionReady: true,
      mcpReady: true,
      remoteTransportReady: true,
    });

    expect(model.ready).toBe(true);
    expect(model.completedCount).toBe(4);
    expect(model.steps.every((step) => step.state === "complete")).toBe(true);
  });
});
