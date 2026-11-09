export type TaskContinuityDiagnosis = {
  schemaVersion: 1;
  taskId: string | null;
  status: string;
  terminal: boolean;
  outcome: string;
  nextAction: string;
  progress: { stepSuccessPercent: number | null; percentMeaning: "ratio_of_succeeded_steps_not_time_remaining"; completedSteps: number; totalSteps: number; failedSteps: number; revision: number | null; lastMeaningfulAt: string | null; ageMs: number | null; noRecentProgressEvent: boolean };
  verification: { required: number; verified: number; missing: number; uncertain: number; failed: number; complete: boolean };
  transport: { planner: string; runtime: string; mcp: string; tunnel: string };
  interruption: string;
  sourceOfTruth: "runtime_task";
  chatResponseOutcome: "not_observable_from_runtime";
  causeAttribution: "unconfirmed";
  safeToAutomaticallyReplay: false;
  safeToAutomaticallySendChatTurn: false;
  chatWakeRequires: string;
};
export declare function diagnoseTaskContinuity(input?: {
  task?: Record<string, any> | null;
  plannerConnected?: boolean | null;
  runtimeObserved?: boolean;
  mcpConnected?: boolean | null;
  tunnelConnected?: boolean | null;
  now?: number;
  staleAfterMs?: number;
}): TaskContinuityDiagnosis;
