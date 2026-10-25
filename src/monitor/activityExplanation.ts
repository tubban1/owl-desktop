import type { McpInteraction } from "./interactionModel";
import type { MonitorWorkstream } from "./workstreamModel";
import type { OperationsGraphNode } from "./operationsGraphModel";

const TOOL_ACTIONS: Record<string, { action: string; reason: string }> = {
  execute_command: { action: "Running a command", reason: "OWL is asking the computer to execute a command and is waiting for the result." },
  start_process: { action: "Starting background work", reason: "A long-running command or test is being started. It can continue even if the chat reconnects." },
  get_process_output: { action: "Checking a running process", reason: "OWL is reading the latest output from a background command or test." },
  read_file: { action: "Reading a file", reason: "OWL is inspecting a file to understand the project." },
  edit_file: { action: "Editing a file", reason: "OWL is applying a targeted change to a file." },
  search_files: { action: "Finding relevant files", reason: "OWL is locating files that match the request." },
  workstream_progress: { action: "Saving a progress checkpoint", reason: "OWL is recording its progress so the work can resume after reconnection." },
  workstream_open: { action: "Opening a workstream", reason: "OWL is linking the request with a durable workspace context." },
  workstream_complete: { action: "Completing a workstream", reason: "OWL is marking the work as completed." },
};
export function explainCurrentActivity(input: {
  stream: MonitorWorkstream | null;
  interaction: McpInteraction | null;
  node: OperationsGraphNode | null;
  now: number;
}) {
  const { stream, interaction, node, now } = input;
  const ongoing = interaction?.status === "running";
  const start = Date.parse(interaction?.startedAt ?? "");
  const lastUpdate = Date.parse(stream?.updatedAt ?? interaction?.completedAt ?? interaction?.startedAt ?? "");
  const elapsedMs = ongoing && Number.isFinite(start) ? Math.max(0, now - start) : null;
  const silentMs = Number.isFinite(lastUpdate) ? Math.max(0, now - lastUpdate) : null;
  const tool = interaction?.tool ?? null;
  const mapped = tool ? TOOL_ACTIONS[tool] : undefined;
  const waiting = stream?.status === "waiting";
  const attention = stream?.status === "attention" || stream?.status === "disconnected";
  const waitingProgress = waiting && stream?.currentAction?.includes("Legacy progress reminder");
  const title = attention ? "This workstream needs attention"
    : waitingProgress ? "Progress reminder — not blocked"
    : ongoing ? (mapped?.action ?? "Waiting for a tool response")
    : waiting ? "Waiting for the next step"
    : stream?.currentAction && stream.status === "working" ? stream.currentAction
    : "No tool call is currently running";
  const explanation = attention
    ? "The current workstream reports an attention or connection problem. Inspect the event log before retrying."
    : waitingProgress ? "The legacy progress checkpoint is informational. Resume the original workstream; do not treat it as lost connectivity or approve unrelated actions."
    : ongoing ? (mapped?.reason ?? "A request is in progress. Open the interaction log below for its exact operation.")
    : waiting ? "The previous action has finished or paused. OWL is waiting for the planner, Runtime or user to continue."
    : "The graph shows the most recently observed activity, not proof that a command is still executing.";
  const prolonged = elapsedMs !== null && elapsedMs >= 60_000;
  return {
    title,
    explanation,
    nodeLabel: node?.label ?? "No active graph node",
    detail: stream?.summary ?? node?.detail ?? null,
    tool,
    elapsedMs,
    silentMs,
    prolonged,
    attention,
    waiting,
    lastUpdatedAt: Number.isFinite(lastUpdate) ? new Date(lastUpdate).toISOString() : null,
    note: waitingProgress ? "Continue this workstream normally; the historical progress reminder does not require resetting another session." :
      prolonged ? "This call has lasted over a minute. It may be a long-running task or a wait; open its output to check progress." :
      !ongoing && silentMs !== null && silentMs > 120_000 ? "No new workstream update for over two minutes; this is not necessarily a failure." : null,
  };
}
