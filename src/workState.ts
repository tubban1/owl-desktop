import type {
  AgentRequest,
  PlannerContinuationSummary,
  RuntimeEventBridgeStatus,
} from "./types";

export type WorkStateKind =
  | "working"
  | "waiting"
  | "possibly_stuck"
  | "needs_attention"
  | "idle";

export type WorkState = {
  state: WorkStateKind;
  label: string;
  title: string;
  detail: string;
  signal: string;
  progress: number | null;
  lastChangedAt: string | null;
};

type RuntimeRow = Record<string, any>;

type ProductReadiness = {
  title: string;
  description: string;
};

const durationLabel = (milliseconds: number) => {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
};

const shortCommand = (value?: string) => {
  if (!value) return "Background work";
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 96 ? normalized.slice(0, 93) + "…" : normalized;
};

const TERMINAL_INCIDENT_VISIBILITY_MS = 15 * 60_000;

const taskLastMeaningfulMs = (task: RuntimeRow) => {
  const value =
    task.progress?.lastMeaningfulAt ??
    task.progress?.lastEvent?.at ??
    task.updatedAt ??
    null;
  if (!value) return Number.NaN;
  return Date.parse(value);
};

const terminalIncidentIsCurrent = (task: RuntimeRow, now: number) => {
  if (task.progress?.terminal !== true) return true;
  const changedAt = taskLastMeaningfulMs(task);
  return (
    Number.isFinite(changedAt) &&
    now - changedAt <= TERMINAL_INCIDENT_VISIBILITY_MS
  );
};

export function deriveWorkState({
  taskRows,
  runningProcesses,
  readinessReady,
  productReadiness,
  runtimeEventNeedsAttention,
  runtimeEventStatus,
  claimedAgentRequests,
  pendingAgentRequests,
  plannerContinuation,
  wakeName,
  checkedAt,
  now,
}: {
  taskRows: RuntimeRow[];
  runningProcesses: RuntimeRow[];
  readinessReady: boolean;
  productReadiness: ProductReadiness;
  runtimeEventNeedsAttention: boolean;
  runtimeEventStatus?: RuntimeEventBridgeStatus | null;
  claimedAgentRequests: AgentRequest[];
  pendingAgentRequests: AgentRequest[];
  plannerContinuation?: PlannerContinuationSummary | null;
  wakeName?: string | null;
  checkedAt?: string | null;
  now: number;
}): WorkState {
  const plannerOwner = plannerContinuation?.latestActive ?? null;
  const plannerCheckpoint =
    plannerOwner?.checkpoint?.status !== "completed"
      ? plannerOwner?.checkpoint ?? null
      : null;
  const plannerTransportMissing =
    Boolean(plannerCheckpoint) && plannerOwner?.plannerConnected !== true;
  const waitingTask = taskRows.find(
    (task) =>
      terminalIncidentIsCurrent(task, now) &&
      (task.status === "waiting_approval" ||
        task.status === "blocked" ||
        task.status === "paused" ||
        Number(task.counts?.waitingApproval ?? 0) > 0),
  );
  const attentionTask = taskRows.find(
    (task) =>
      terminalIncidentIsCurrent(task, now) &&
      (task.status === "failed" ||
        task.status === "needs_review" ||
        Number(task.counts?.failed ?? 0) > 0 ||
        Number(task.counts?.needsReview ?? 0) > 0),
  );
  const runningTask = taskRows.find((task) =>
    task.status === "running" ||
    task.progress?.phase === "running" ||
    Number(task.counts?.running ?? 0) > 0,
  );

  if (!readinessReady) {
    return {
      state: "needs_attention",
      label: "Needs attention",
      title: productReadiness.title,
      detail: productReadiness.description,
      signal: "Action required before OWL can work",
      progress: null,
      lastChangedAt: checkedAt ?? null,
    };
  }

  if (runtimeEventNeedsAttention) {
    return {
      state: "needs_attention",
      label: "Needs attention",
      title: "Runtime history needs reconciliation",
      detail:
        runtimeEventStatus?.reconciliation?.message ??
        "OWL stopped automatic replay to avoid skipping missing history.",
      signal: "Review before continuing",
      progress: null,
      lastChangedAt:
        runtimeEventStatus?.reconciliation?.detectedAt ??
        runtimeEventStatus?.lastPollAt ??
        runtimeEventStatus?.lastSuccessAt ??
        null,
    };
  }

  if (attentionTask) {
    return {
      state: "needs_attention",
      label: "Needs attention",
      title: attentionTask.label ?? "A task needs review",
      detail:
        attentionTask.progress?.message ??
        attentionTask.progress?.lastEvent?.message ??
        "A Runtime task failed or requires review.",
      signal: "Task stopped",
      progress: null,
      lastChangedAt:
        attentionTask.progress?.lastMeaningfulAt ??
        attentionTask.updatedAt ??
        null,
    };
  }

  if (waitingTask) {
    return {
      state: "waiting",
      label: "Waiting",
      title: waitingTask.label ?? "OWL is waiting",
      detail:
        Number(waitingTask.counts?.waitingApproval ?? 0) > 0
          ? "Waiting for your approval before continuing."
          : waitingTask.progress?.message ??
            "The task is paused or waiting on an external dependency.",
      signal: "Not stuck — waiting deliberately",
      progress: null,
      lastChangedAt:
        waitingTask.progress?.lastMeaningfulAt ??
        waitingTask.updatedAt ??
        null,
    };
  }

  if (runningTask) {
    const lastMeaningfulAt =
      runningTask.progress?.lastMeaningfulAt ?? runningTask.updatedAt ?? null;
    const lastMeaningfulMs = lastMeaningfulAt
      ? Date.parse(lastMeaningfulAt)
      : Number.NaN;
    const recommendedPollAfterMs = Number(
      runningTask.progress?.recommendedPollAfterMs ?? 0,
    );
    const staleAfterMs = Math.max(
      120_000,
      Number.isFinite(recommendedPollAfterMs)
        ? recommendedPollAfterMs * 8
        : 0,
    );
    const stale =
      Number.isFinite(lastMeaningfulMs) &&
      now - lastMeaningfulMs > staleAfterMs;
    const total = Number(
      runningTask.progress?.counts?.total ?? runningTask.counts?.total ?? 0,
    );
    const succeeded = Number(
      runningTask.progress?.counts?.succeeded ??
        runningTask.counts?.succeeded ??
        0,
    );
    return {
      state: stale ? "possibly_stuck" : "working",
      label: stale ? "Possibly stuck" : "Working",
      title: runningTask.label ?? "OWL is working",
      detail:
        runningTask.progress?.message ??
        runningTask.progress?.lastEvent?.message ??
        "Executing the current task.",
      signal: stale
        ? `No meaningful progress for ${durationLabel(now - lastMeaningfulMs)}`
        : plannerTransportMissing
          ? "Runtime continues — ChatGPT transport is not connected"
          : lastMeaningfulAt
            ? `Progress ${durationLabel(now - lastMeaningfulMs)} ago`
            : "Work is active",
      progress:
        total > 0 ? Math.min(100, Math.max(0, (succeeded / total) * 100)) : null,
      lastChangedAt: lastMeaningfulAt,
    };
  }

  if (runningProcesses.length > 0) {
    const process = runningProcesses[0];
    const startedAt = process.startedAt ? Date.parse(process.startedAt) : NaN;
    return {
      state: "working",
      label: "Working",
      title: "Background process running",
      detail: shortCommand(process.command),
      signal: plannerTransportMissing
        ? "Runtime continues — ChatGPT transport is not connected"
        : Number.isFinite(startedAt)
          ? `Running for ${durationLabel(now - startedAt)}`
          : "Process is active",
      progress: null,
      lastChangedAt: process.startedAt ?? null,
    };
  }

  if (claimedAgentRequests.length > 0 || pendingAgentRequests.length > 0) {
    return {
      state: "waiting",
      label: "Waiting",
      title:
        claimedAgentRequests.length > 0
          ? "Agent work is being handled"
          : "Work is waiting for an agent",
      detail:
        claimedAgentRequests.length > 0
          ? `${claimedAgentRequests.length} request(s) are currently claimed.`
          : `${pendingAgentRequests.length} request(s) are queued in Agent Inbox.`,
      signal: "Queue is healthy",
      progress: null,
      lastChangedAt:
        claimedAgentRequests[0]?.updatedAt ??
        pendingAgentRequests[0]?.updatedAt ??
        null,
    };
  }

  if (plannerCheckpoint) {
    const nextAction = plannerCheckpoint.nextActions?.[0] ?? null;
    return {
      state: "waiting",
      label: "Waiting",
      title: plannerCheckpoint.goal,
      detail:
        plannerCheckpoint.summary ??
        (plannerCheckpoint.phase
          ? `Saved planner checkpoint at “${plannerCheckpoint.phase}”.`
          : "A planner recovery point is saved for this work."),
      signal: plannerTransportMissing
        ? "Waiting for ChatGPT to reconnect — recovery point saved"
        : nextAction
          ? `Ready to resume — next: ${nextAction}`
          : "Planner checkpoint active — ready to resume",
      progress: null,
      lastChangedAt: plannerCheckpoint.updatedAt ?? null,
    };
  }

  return {
    state: "idle",
    label: "Idle",
    title: `${wakeName || "OWL"} is ready for work`,
    detail: "No task or background process is currently running.",
    signal: "Ready for a new request",
    progress: null,
    lastChangedAt: checkedAt ?? null,
  };
}
