export type OnboardingStepState = "complete" | "current" | "pending";

export type OnboardingStep = {
  id: "runtime" | "account" | "execution" | "chatgpt";
  label: string;
  detail: string;
  state: OnboardingStepState;
};

export type OnboardingModel = {
  ready: boolean;
  completedCount: number;
  totalCount: number;
  steps: OnboardingStep[];
};

export function buildOnboardingModel(input: {
  runtimeReady: boolean;
  accountReady: boolean;
  executionReady: boolean;
  mcpReady: boolean;
  remoteTransportReady: boolean;
}): OnboardingModel {
  const definitions = [
    {
      id: "runtime" as const,
      label: "Local Runtime",
      detail: "Prepare the local OWL execution engine.",
      complete: input.runtimeReady,
    },
    {
      id: "account" as const,
      label: "OWL LAB account",
      detail: "Sign in and enroll this Mac.",
      complete: input.accountReady,
    },
    {
      id: "execution" as const,
      label: "Execution access",
      detail: "Verify this device may run local work.",
      complete: input.executionReady,
    },
    {
      id: "chatgpt" as const,
      label: "Connect ChatGPT",
      detail: "Bring the remote OWL path online.",
      complete: input.mcpReady && input.remoteTransportReady,
    },
  ];

  const firstIncomplete = definitions.findIndex((step) => !step.complete);
  const steps = definitions.map((step, index) => ({
    id: step.id,
    label: step.label,
    detail: step.detail,
    state: step.complete
      ? ("complete" as const)
      : index === firstIncomplete
        ? ("current" as const)
        : ("pending" as const),
  }));

  const completedCount = definitions.filter((step) => step.complete).length;
  return {
    ready: completedCount === definitions.length,
    completedCount,
    totalCount: definitions.length,
    steps,
  };
}
