import type { McpInteraction } from "./interactionModel";
import type {
  OperationsGraphEdge, OperationsGraphModel, OperationsGraphNode,
} from "./operationsGraphModel";

const STAGES = [
  { id: "sources", label: "Source", hint: "Who requested it" },
  { id: "ingress", label: "Ingress", hint: "Where the request entered" },
  { id: "authorization", label: "Authorization", hint: "Execution permission" },
  { id: "runtime", label: "Runtime", hint: "Execution engine" },
  { id: "execution", label: "Execution", hint: "What OWL is doing" },
  { id: "results", label: "Result", hint: "What came back" },
] as const;

export type FocusedStage = {
  id: (typeof STAGES)[number]["id"];
  label: string;
  hint: string;
  title: string;
  detail: string;
  evidence: "observed" | "contract" | "status" | "none";
  state: "running" | "done" | "waiting" | "attention" | "neutral";
  note: string | null;
  hiddenCount: number;
};

function eventTime(node: OperationsGraphNode) {
  return Date.parse(node.observedAt ?? "") || 0;
}

function bestNode(nodes: OperationsGraphNode[], ids: Set<string>, ownerId: string | null) {
  return [...nodes].sort((a, b) => {
    const score = (node: OperationsGraphNode) =>
      (ownerId && node.workstreamId === ownerId ? 100 : 0) +
      (ids.has(node.id) ? 40 : 0) +
      (node.current && node.workstreamId === ownerId ? 20 : 0);
    return score(b) - score(a) || eventTime(b) - eventTime(a);
  })[0] ?? null;
}

function relevantEdge(edge: OperationsGraphEdge, workstreamId: string | null, interaction: McpInteraction | null) {
  return Boolean(
    (workstreamId && edge.workstreamId === workstreamId) ||
    (interaction && (edge.from === "tool:" + interaction.id ||
      edge.to === "tool:" + interaction.id ||
      edge.from === "result:" + interaction.id ||
      edge.to === "result:" + interaction.id))
  );
}

/**
 * A projection, never an invented trace. Non-observed hops are explicitly
 * classified as contract-inferred or status-only, even when a node is healthy.
 */
export function buildFocusedFlow(
  model: OperationsGraphModel,
  workstreamId: string | null,
  interaction: McpInteraction | null,
): FocusedStage[] {
  const pathEdges = model.edges.filter((edge) => relevantEdge(edge, workstreamId, interaction));
  const pathIds = new Set(pathEdges.flatMap((edge) => [edge.from, edge.to]));
  const stream = model.currentWorkstreams.find((item) => item.id === workstreamId);
  const byGroup = new Map<string, OperationsGraphNode[]>();
  for (const node of model.nodes) {
    const rows = byGroup.get(node.groupId) ?? [];
    rows.push(node);
    byGroup.set(node.groupId, rows);
  }

  return STAGES.map((stage): FocusedStage => {
    const all = byGroup.get(stage.id) ?? [];
    const candidates = all.filter((node) =>
      (workstreamId && node.workstreamId === workstreamId) ||
      pathIds.has(node.id) ||
      node.workstreamId === null,
    );
    const exactId = interaction && (stage.id === "execution" ? "tool:" + interaction.id :
      stage.id === "results" ? "result:" + interaction.id : null);
    const selected = (exactId && candidates.find((node) => node.id === exactId)) ||
      bestNode(candidates, pathIds, workstreamId);
    const incoming = selected ? pathEdges.filter((edge) => edge.to === selected.id || edge.from === selected.id) : [];
    let evidence: FocusedStage["evidence"] =
      incoming.some((edge) => edge.observed) ? "observed" :
      incoming.length > 0 ? "contract" :
      selected ? "status" : "none";
    let title = selected?.label ?? "Not observed";
    let detail = selected?.detail ?? "No event observed for this stage.";
    let note: string | null = null;
    let state: FocusedStage["state"] = "neutral";

    if (stage.id === "sources" && interaction) {
      title = interaction.clientLabel;
      detail = "Origin of the selected MCP request";
      evidence = "observed";
    }

    if (stage.id === "authorization" && selected) {
      if (evidence === "status") note = "Access status only — not proof this request passed the gate.";
      if (selected.state === "locked" || selected.state === "attention") state = "attention";
    }

    if (stage.id === "runtime" && evidence === "status") {
      note = "Runtime status available; this call has no observed Runtime hop.";
    }

    if (stage.id === "execution" && interaction) {
      title = interaction.tool;
      detail = interaction.status === "running" ? "Waiting for the tool response" :
        interaction.status === "success" ? "Tool operation succeeded" :
        interaction.status === "error" ? "Tool returned an error" :
        interaction.status === "progress" ? "Progress acknowledgement required" :
        "No response was observed before this interaction became stale";
      evidence = "observed";
      state = interaction.status === "running" ? "running" :
        interaction.status === "success" ? "done" :
        interaction.status === "progress" ? "waiting" : "attention";
    }

    if (stage.id === "results" && interaction) {
      title = interaction.status === "running" ? "Awaiting response" :
        interaction.status === "success" ? "Response received" :
        interaction.status === "progress" ? "Progress checkpoint" :
        interaction.status === "error" ? "Error response" : "Response not observed";
      detail = interaction.durationMs !== null
        ? [
            "MCP: " + interaction.durationMs + " ms",
            ...(typeof interaction.queueWaitMs === "number"
              ? ["Queue: " + interaction.queueWaitMs + " ms"] : []),
            ...(typeof interaction.executionDurationMs === "number"
              ? ["Execute: " + interaction.executionDurationMs + " ms"] : []),
            ...(interaction.executionPhase === "admission"
              ? ["Capacity wait timed out before execution"] : []),
          ].join(" · ")
        : "No completed response yet";
      // An expected result is a contract hop, never count it as observed.
      evidence = interaction.status === "running" ? "contract" : "observed";
      state = interaction.status === "running" ? "waiting" :
        interaction.status === "success" ? "done" :
        interaction.status === "progress" ? "waiting" : "attention";
    }

    if (stage.id === "sources" && !interaction && stream) {
      title = stream.sourceLabel;
      detail = stream.goal;
      evidence = "status";
    }

    if (stage.id === "authorization" && !incoming.length && interaction) {
      note = "No authorization hop identified in this selected interaction.";
    }

    if (evidence === "none" && !interaction) {
      detail = "Waiting for trace events";
    }

    return {
      id: stage.id, label: stage.label, hint: stage.hint,
      title, detail, evidence, state, note,
      hiddenCount: Math.max(0, all.length - (selected ? 1 : 0)),
    };
  });
}
