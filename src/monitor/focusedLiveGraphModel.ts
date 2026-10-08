import type { McpInteraction } from "./interactionModel";
import type { OperationsGraphEdge, OperationsGraphModel } from "./operationsGraphModel";

const order = ["sources", "ingress", "authorization", "runtime", "execution", "results"];
export type FocusedLiveLink = {
  id: string;
  from: number;
  to: number;
  observed: boolean;
  via: string[];
  relation: string;
};
export type FocusedLiveTrace = {
  links: FocusedLiveLink[];
  traversed: number[];
  returned: boolean;
  observedResponse: boolean;
  requestRecent: boolean;
  responseRecent: boolean;
};

const groupIndex = (id: string, model: OperationsGraphModel) =>
  order.indexOf(model.nodes.find((n) => n.id === id)?.groupId ?? "");

export function buildFocusedLiveTrace(
  model: OperationsGraphModel,
  interaction: McpInteraction | null,
  now = Date.now(),
): FocusedLiveTrace {
  const empty: FocusedLiveTrace = {
    links: [], traversed: [], returned: false, observedResponse: false,
    requestRecent: false, responseRecent: false,
  };
  if (!interaction) return empty;
  const toolId = "tool:" + interaction.id;
  const resultId = "result:" + interaction.id;
  const owner = interaction.workstreamId;
  const eligible = (e: OperationsGraphEdge) =>
    e.workstreamId === owner && e.relation !== "return" &&
    e.relation !== "support";

  // Walk backward from the exact chosen tool call, not every edge from the
  // workstream. Shared source / ingress hops can be reused by several calls.
  const backward: OperationsGraphEdge[] = [];
  const visited = new Set<string>([toolId]);
  let cursor = toolId;
  for (let i = 0; i < 12; i += 1) {
    const inbound = model.edges.filter((e) => e.to === cursor && eligible(e) && !visited.has(e.from));
    // Prefer a source-linked trace, not arbitrary fan-out from past calls.
    const edge = inbound.find((e) => e.relation !== "durable") ?? inbound[0];
    if (!edge) break;
    backward.push(edge);
    cursor = edge.from;
    visited.add(cursor);
    if (groupIndex(cursor, model) === 0) break;
  }
  const ordered = backward.reverse();
  const response = model.edges.find((e) => e.from === toolId && e.to === resultId &&
    e.relation === "result" && e.workstreamId === owner);
  if (response) ordered.push(response);

  const links: FocusedLiveLink[] = [];
  const traversed = new Set<number>();
  if (ordered.length > 0) {
    let previousStage = groupIndex(ordered[0]!.from, model);
    let segment: OperationsGraphEdge[] = [];
    let via: string[] = [];
    if (previousStage >= 0) traversed.add(previousStage);
    for (const edge of ordered) {
      segment.push(edge);
      const nextStage = groupIndex(edge.to, model);
      if (nextStage < 0) {
        via.push(edge.to);
        continue;
      }
      traversed.add(nextStage);
      if (nextStage === previousStage) {
        // Several physical nodes can belong to the same visible stage. Keep
        // their evidence in the next crossing rather than silently dropping it.
        via.push(edge.to);
        continue;
      }
      if (previousStage >= 0 && nextStage > previousStage) {
        links.push({
          id: "focused:" + links.length,
          from: previousStage,
          to: nextStage,
          observed: segment.every((item) => item.observed),
          via: [...via],
          relation: segment.map((item) => item.relation).join(" → "),
        });
      }
      previousStage = nextStage;
      segment = [];
      via = [];
    }
  }
  const returned = Boolean(response?.observed && model.edges.some(
    (e) => e.from === resultId && e.relation === "return" && e.observed &&
      e.workstreamId === owner,
  ));
  const started = Date.parse(interaction.startedAt ?? "");
  const completed = Date.parse(interaction.completedAt ?? "");
  return {
    links, traversed: [...traversed].sort((a, b) => a - b),
    returned, observedResponse: Boolean(response?.observed),
    requestRecent: interaction.status === "running" && Number.isFinite(started) &&
      now >= started && now - started < 9_000,
    responseRecent: returned && Number.isFinite(completed) &&
      now >= completed && now - completed < 9_000,
  };
}
