// The canonical Runtime Task, not the ChatGPT response stream, owns completion.
// This projection does not retry work, send chat messages or infer the cause of
// a failed delivery from an overlapping transport incident.
function nonnegative(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}
function timestamp(value) {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}
const TERMINAL = new Set(["completed", "failed", "cancelled", "blocked"]);
export function diagnoseTaskContinuity({
  task = null,
  plannerConnected = null,
  runtimeObserved = true,
  mcpConnected = null,
  tunnelConnected = null,
  now = Date.now(),
  staleAfterMs = 300_000,
} = {}) {
  const counts = task?.counts ?? task?.progress?.counts ?? {};
  const verification = task?.verificationCounts ?? {};
  const total = nonnegative(counts.total);
  const succeeded = nonnegative(counts.succeeded);
  const failed = nonnegative(counts.failed);
  const required = nonnegative(verification.required);
  const verified = nonnegative(verification.verified);
  const missing = nonnegative(verification.missing);
  const uncertain = nonnegative(verification.uncertain);
  const verificationFailed = nonnegative(verification.failed);
  const status = typeof task?.status === "string" ? task.status : "unobserved";
  const terminal = task?.progress?.terminal === true || TERMINAL.has(status);
  const lastProgressAt = task?.progress?.lastMeaningfulAt ?? task?.updatedAt ?? null;
  const at = timestamp(lastProgressAt);
  const ageMs = at === null ? null : Math.max(0, now - at);
  const stale = !terminal && ageMs !== null && ageMs > staleAfterMs;
  const percent = total > 0 ? Math.max(0, Math.min(100, Math.round(succeeded / total * 100))) : null;
  const verificationComplete = required > 0 && verified === required &&
    missing === 0 && uncertain === 0 && verificationFailed === 0;
  let outcome = "unknown";
  let nextAction = "reconcile_existing_task";
  if (status === "completed") {
    outcome = failed > 0 || verificationFailed > 0 || uncertain > 0
      ? "completion_evidence_conflict"
      : verificationComplete ? "verified_completed" : "reported_completed";
    nextAction = outcome === "verified_completed" ? "report_canonical_completion" : "inspect_completion_receipts";
  } else if (status === "failed") {
    outcome = "task_failed";
    nextAction = "inspect_failure_before_retry";
  } else if (status === "cancelled") {
    outcome = "task_cancelled";
    nextAction = "do_not_resume_cancelled_task";
  } else if (status === "needs_review" || status === "blocked") {
    outcome = "requires_review";
    nextAction = "inspect_review_or_side_effect_evidence";
  } else if (status === "waiting_approval") {
    outcome = "waiting_for_authorization";
    nextAction = "wait_for_authorized_approval";
  } else if (status === "paused") {
    outcome = "paused";
    nextAction = "inspect_pause_before_resume";
  } else if (status === "pending" || status === "running") {
    outcome = status === "running" ? "still_running" : "queued";
    nextAction = "observe_existing_task";
  }
  if (runtimeObserved !== true && !terminal && task) {
    outcome = "previously_observed_nonterminal";
    nextAction = "reconcile_runtime_before_decision";
  }
  const transport = {
    planner: plannerConnected === true ? "connected" :
      plannerConnected === false ? "disconnected" : "unknown",
    runtime: runtimeObserved === true ? "observed" : "unobserved",
    mcp: mcpConnected === true ? "connected" :
      mcpConnected === false ? "disconnected" : "unknown",
    tunnel: tunnelConnected === true ? "connected" :
      tunnelConnected === false ? "disconnected" : "unknown",
  };
  // An interrupted model response does not establish that a Runtime Task
  // failed. A lack of new Task events does not prove a long step stalled.
  const transportEvidence = plannerConnected === false ||
    mcpConnected === false || tunnelConnected === false;
  const interruption = !task
    ? "task_unobserved"
    : runtimeObserved !== true
      ? "runtime_not_currently_observable"
    : terminal
      ? "none_terminal"
      : transportEvidence
        ? "transport_observed_disconnected_task_not_proven_failed"
        : stale ? "no_recent_progress_event" : "none_observed";
  return {
    schemaVersion: 1,
    taskId: typeof task?.id === "string" ? task.id : null,
    status,
    terminal,
    outcome,
    nextAction,
    progress: {
      stepSuccessPercent: percent,
      percentMeaning: "ratio_of_succeeded_steps_not_time_remaining",
      completedSteps: succeeded,
      totalSteps: total,
      failedSteps: failed,
      revision: Number.isInteger(task?.progress?.revision) ? task.progress.revision : null,
      lastMeaningfulAt: lastProgressAt,
      ageMs,
      noRecentProgressEvent: stale,
    },
    verification: { required, verified, missing, uncertain, failed: verificationFailed, complete: verificationComplete },
    transport,
    interruption,
    sourceOfTruth: "runtime_task",
    chatResponseOutcome: "not_observable_from_runtime",
    causeAttribution: "unconfirmed",
    safeToAutomaticallyReplay: false,
    safeToAutomaticallySendChatTurn: false,
    chatWakeRequires: "exact_conversation_binding_and_explicit_authorization",
  };
}
