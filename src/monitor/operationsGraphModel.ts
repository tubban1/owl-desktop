import type {
  ActivityEntry,
  RuntimeSnapshot,
} from "../types";
import {
  buildMcpInteractionFeed,
  type McpInteraction,
} from "./interactionModel";
import type {
  MonitorWorkstream,
  WorkstreamBoard,
} from "./workstreamModel";

type Row = Record<string, unknown>;

export type OperationsNodeKind =
  | "source"
  | "transport"
  | "cloud"
  | "command"
  | "authorization"
  | "runtime"
  | "tool"
  | "task"
  | "process"
  | "approval"
  | "request"
  | "target"
  | "result"
  | "generic";

export type OperationsState =
  | "active"
  | "healthy"
  | "waiting"
  | "attention"
  | "locked"
  | "idle"
  | "offline";

export type OperationsGraphNode = {
  id: string;
  groupId: string;
  kind: OperationsNodeKind;
  label: string;
  detail: string | null;
  state: OperationsState;
  current: boolean;
  observedAt: string | null;
  workstreamId: string | null;
  evidence: string[];
  meta?: Record<string, unknown>;
};

export type OperationsGraphEdge = {
  id: string;
  from: string;
  to: string;
  state: OperationsState;
  relation:
    | "request"
    | "dispatch"
    | "authorize"
    | "execute"
    | "result"
    | "return"
    | "support"
    | "durable"
    | "coordination";
  label: string | null;
  observed: boolean;
  workstreamId: string | null;
};

export type OperationsGraphGroup = {
  id: string;
  label: string;
  order: number;
  nodeIds: string[];
};

export type OperationsAssurance = {
  id: "persistent" | "observable" | "authorized";
  label: string;
  state: OperationsState;
  value: string;
  detail: string;
};

export type OperationsLoopPath = {
  id: string;
  workstreamId: string | null;
  sourceNodeId: string;
  sourceLabel: string;
  resultNodeId: string;
  requestLabel: string;
  responseLabel: string;
  state: OperationsState;
  running: boolean;
  observedAt: string | null;
};

export type OperationsToolBreakdown = {
  tool: string;
  count: number;
  errors: number;
};

export type OperationsWorkstreamSummary = {
  id: string;
  sourceLabel: string;
  goal: string;
  status: "running" | "completed" | "attention" | "waiting" | "idle";
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  toolCallCount: number;
  toolBreakdown: OperationsToolBreakdown[];
  runtimeActionCount: number;
  runtimeActionSucceeded: number;
  runtimeActionFailed: number;
  runtimeActionNeedsReview: number;
  runtimeActionBreakdown: OperationsToolBreakdown[];
  progressCount: number;
  errorCount: number;
  warningCount: number;
  reconnectCount: number;
  taskCount: number;
  completedTaskCount: number;
  failedTaskCount: number;
  taskErrorCount: number;
  taskNeedsReviewCount: number;
  outcome: string;
  summaryText: string;
};

export type OperationsGraphModel = {
  generatedAt: string;
  groups: OperationsGraphGroup[];
  nodes: OperationsGraphNode[];
  edges: OperationsGraphEdge[];
  loopPaths: OperationsLoopPath[];
  summaries: OperationsWorkstreamSummary[];
  assurances: OperationsAssurance[];
  interactions: McpInteraction[];
  currentWorkstreams: MonitorWorkstream[];
  nextActions: string[];
  latestInteraction: McpInteraction | null;
  runningInteractions: McpInteraction[];
};

export type OperationsGraphPolicy = {
  recentWindowMs: number;
  maxInteractionHistory: number;
};

function timestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rows(value: unknown, keys: string[]): Row[] {
  if (Array.isArray(value)) {
    return value.filter(
      (item): item is Row => Boolean(item && typeof item === "object"),
    );
  }
  if (!value || typeof value !== "object") return [];
  const object = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = object[key];
    if (Array.isArray(candidate)) {
      return candidate.filter(
        (item): item is Row => Boolean(item && typeof item === "object"),
      );
    }
  }
  return rows(object.result, keys);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : null;
}

function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function short(value: string | null | undefined, length = 8) {
  if (!value) return null;
  return value.length <= length ? value : value.slice(-length);
}

function parsePreview(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

const SUMMARY_KEYS = [
  "label",
  "goal",
  "current",
  "path",
  "url",
  "command",
  "query",
  "skill",
  "primitive",
  "op",
  "cwd",
  "process_id",
  "task_id",
  "request_id",
];

function displayValue(key: string, value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (key === "path" || key === "cwd") {
    const parts = raw.split("/").filter(Boolean);
    const tail = parts.slice(-2).join("/");
    return tail || raw;
  }
  if (key === "command") {
    const firstLine = raw.split("\n")[0]?.trim() ?? raw;
    return firstLine.length > 88
      ? firstLine.slice(0, 88) + "…"
      : firstLine;
  }
  return raw.length > 88 ? raw.slice(0, 88) + "…" : raw;
}

export function summarizeInteraction(interaction: McpInteraction): string {
  const payload = parsePreview(interaction.requestPreview);
  if (payload) {
    for (const key of SUMMARY_KEYS) {
      const value = displayValue(key, payload[key]);
      if (value) return value;
    }
  }
  return interaction.tool;
}

function sourceIdentity(interaction: McpInteraction) {
  return (
    interaction.workstreamId ??
    interaction.runtimeSessionId ??
    interaction.transportSessionId ??
    `${interaction.clientKind ?? "client"}:${interaction.clientLabel}`
  );
}

function sourceKind(interaction: McpInteraction): string {
  return interaction.clientKind ?? "mcp";
}

function sourceLabel(interaction: McpInteraction): string {
  if (interaction.clientLabel && interaction.clientLabel !== "MCP client") {
    return interaction.clientLabel;
  }
  const suffix = short(
    interaction.workstreamId ??
      interaction.runtimeSessionId ??
      interaction.transportSessionId,
    6,
  );
  return suffix ? `MCP client · ${suffix}` : "MCP client";
}

function stateFromInteraction(interaction: McpInteraction): OperationsState {
  if (interaction.status === "running") return "active";
  if (interaction.status === "error") return "attention";
  if (interaction.status === "progress") return "waiting";
  return "healthy";
}

type InteractionRouteKind =
  | "runtime-gated"
  | "runtime-bypass"
  | "host-local"
  | "desktop-control"
  | "remote-control";

function interactionRouteKind(tool: string): InteractionRouteKind {
  if (tool === "runtime_info") return "runtime-bypass";
  if (
    tool.startsWith("workstream_") ||
    tool.startsWith("planner_checkpoint")
  ) {
    return "host-local";
  }
  if (tool.startsWith("agent_requests_")) return "desktop-control";
  if (tool.startsWith("device_") || tool.startsWith("remote_task_")) {
    return "remote-control";
  }
  return "runtime-gated";
}

function stateFromWorkstream(stream: MonitorWorkstream): OperationsState {
  if (stream.status === "working") return "active";
  if (stream.status === "waiting") return "waiting";
  if (stream.status === "attention") return "attention";
  if (stream.status === "disconnected") return "offline";
  return "idle";
}

function isActiveTask(status: string) {
  return [
    "pending",
    "running",
    "waiting_approval",
    "blocked",
    "paused",
    "needs_review",
  ].includes(status);
}

function isExecutingTask(status: string) {
  return status === "running";
}

function relevantWorkstream(
  stream: MonitorWorkstream,
  now: number,
  recentWindowMs: number,
) {
  if (stream.id === "agent-inbox") return false;
  if (stream.connected) return true;
  if (stream.tasks.some((task) => isActiveTask(task.status))) return true;
  const updated = timestamp(stream.updatedAt);
  if (updated > 0 && now - updated <= recentWindowMs) return true;
  if (
    ["waiting"].includes(stream.status) &&
    stream.nextActions.length > 0 &&
    updated > 0 &&
    now - updated <= recentWindowMs * 2
  ) {
    return true;
  }
  return false;
}

function currentProcessRows(snapshot: RuntimeSnapshot | null) {
  return rows(snapshot?.processes, ["processes", "items"]).filter((row) => {
    const status = text(row.status)?.toLowerCase();
    return (
      bool(row.running) === true ||
      status === "running" ||
      status === "waiting" ||
      status === "starting"
    );
  });
}

function pendingApprovalRows(snapshot: RuntimeSnapshot | null) {
  return rows(snapshot?.approvals, ["approvals", "items"]).filter((row) => {
    const status = text(row.status)?.toLowerCase();
    return (
      status === "pending" ||
      status === "waiting" ||
      status === "requested" ||
      status === "needs_approval"
    );
  });
}

function cloudCommandLabel(command: RuntimeSnapshot["cloud"]["commands"][number]) {
  const origin = command.origin;
  if (origin?.label?.trim()) return origin.label.trim();
  if (origin?.kind) {
    const suffix = short(origin.id, 6);
    return suffix
      ? `${origin.kind[0].toUpperCase() + origin.kind.slice(1)} · ${suffix}`
      : origin.kind[0].toUpperCase() + origin.kind.slice(1);
  }
  return "OWL Cloud";
}

function buildPolicy(snapshot: RuntimeSnapshot | null): OperationsGraphPolicy {
  const cadence =
    snapshot?.mcp.continuation?.progressPolicy?.recommendedUpdateIntervalMs ??
    15_000;
  return {
    recentWindowMs: Math.max(60_000, cadence * 20),
    maxInteractionHistory: 40,
  };
}

function minTimestamp(values: Array<string | null | undefined>): string | null {
  const valid = values
    .map((value) => ({ value, at: timestamp(value) }))
    .filter((item) => item.value && item.at > 0)
    .sort((a, b) => a.at - b.at);
  return valid[0]?.value ?? null;
}

function maxTimestamp(values: Array<string | null | undefined>): string | null {
  const valid = values
    .map((value) => ({ value, at: timestamp(value) }))
    .filter((item) => item.value && item.at > 0)
    .sort((a, b) => b.at - a.at);
  return valid[0]?.value ?? null;
}

function buildWorkstreamSummaries({
  streams,
  interactions,
  activity,
}: {
  streams: MonitorWorkstream[];
  interactions: McpInteraction[];
  activity: ActivityEntry[];
}): OperationsWorkstreamSummary[] {
  return streams.map((stream) => {
    const streamInteractions = interactions.filter(
      (item) =>
        item.workstreamId === stream.ownerId ||
        item.runtimeSessionId === stream.ownerId,
    );
    const substantiveInteractions = streamInteractions.filter(
      (item) => item.status !== "progress",
    );
    const toolCounts = new Map<string, OperationsToolBreakdown>();
    const toolEvidence =
      substantiveInteractions.length > 0
        ? substantiveInteractions.map((item) => ({
            tool: item.tool,
            outcome: item.status === "error" ? "error" : "success",
          }))
        : (stream.toolStats?.recentTools ?? []);
    for (const item of toolEvidence) {
      const current = toolCounts.get(item.tool) ?? {
        tool: item.tool,
        count: 0,
        errors: 0,
      };
      current.count += 1;
      if (item.outcome === "error") current.errors += 1;
      toolCounts.set(item.tool, current);
    }

    const runtimeActionCounts = new Map<string, OperationsToolBreakdown>();
    for (const task of stream.tasks) {
      for (const action of task.actions ?? []) {
        const current = runtimeActionCounts.get(action.action) ?? {
          tool: action.action,
          count: 0,
          errors: 0,
        };
        current.count += 1;
        if (["failed", "blocked"].includes(action.state)) current.errors += 1;
        runtimeActionCounts.set(action.action, current);
      }
    }
    const runtimeActionCount = stream.tasks.reduce(
      (sum, task) => sum + (task.actionCount ?? 0),
      0,
    );
    const runtimeActionSucceeded = stream.tasks.reduce(
      (sum, task) => sum + (task.succeededActions ?? 0),
      0,
    );
    const runtimeActionFailed = stream.tasks.reduce(
      (sum, task) => sum + (task.failedActions ?? 0),
      0,
    );
    const runtimeActionNeedsReview = stream.tasks.reduce(
      (sum, task) => sum + (task.needsReviewActions ?? 0),
      0,
    );

    const taskErrorCount = stream.tasks.filter((task) =>
      ["failed", "blocked"].includes(task.status),
    ).length;
    const taskNeedsReviewCount = stream.tasks.filter(
      (task) => task.status === "needs_review",
    ).length;
    const taskFailed = taskErrorCount + taskNeedsReviewCount;
    const taskCompleted = stream.tasks.filter((task) =>
      ["completed", "cancelled"].includes(task.status),
    ).length;
    const taskActive = stream.tasks.some((task) => isActiveTask(task.status));
    const hasErrors =
      taskFailed > 0 ||
      substantiveInteractions.some((item) => item.status === "error");

    let status: OperationsWorkstreamSummary["status"] = "idle";
    if (stream.status === "attention" || hasErrors) status = "attention";
    else if (stream.status === "working" || taskActive) status = "running";
    else if (stream.status === "waiting") status = "waiting";
    else if (
      stream.tasks.length > 0 &&
      stream.tasks.every((task) =>
        ["completed", "cancelled"].includes(task.status),
      )
    ) {
      status = "completed";
    }

    const relatedActivity = activity.filter((entry) => {
      const meta = entry.meta ?? {};
      return (
        meta.workstreamId === stream.ownerId ||
        meta.runtimeSessionId === stream.ownerId
      );
    });
    const warningCount = relatedActivity.filter(
      (entry) => entry.level === "warn",
    ).length;
    const reconnectCount = relatedActivity.filter((entry) =>
      /reconnect|reclaim|supersed|transport session opened/i.test(
        entry.message ?? "",
      ),
    ).length;

    const startedAt = minTimestamp([
      ...streamInteractions.map(
        (item) => item.startedAt ?? item.completedAt,
      ),
      ...stream.messages.map((message) => message.at),
      stream.updatedAt,
    ]);
    const lastObservedAt = maxTimestamp([
      ...streamInteractions.map(
        (item) => item.completedAt ?? item.startedAt,
      ),
      ...stream.messages.map((message) => message.at),
      ...stream.tasks.map((task) => task.updatedAt),
      stream.updatedAt,
    ]);
    const completedAt =
      status === "completed" || status === "attention"
        ? lastObservedAt
        : null;
    const durationMs =
      startedAt && completedAt
        ? Math.max(0, timestamp(completedAt) - timestamp(startedAt))
        : null;
    const progressCount = Math.max(
      stream.messages.filter((message) => message.kind === "progress").length,
      streamInteractions.filter(
        (item) =>
          item.tool === "workstream_progress" ||
          item.status === "progress",
      ).length,
    );
    const errorCount =
      substantiveInteractions.length > 0
        ? substantiveInteractions.filter((item) => item.status === "error").length
        : (stream.toolStats?.recentTools ?? []).filter(
            (item) => item.outcome === "error",
          ).length;

    const outcome =
      status === "completed"
        ? "Completed"
        : status === "attention"
          ? taskFailed > 0
            ? taskFailed + " task" + (taskFailed === 1 ? "" : "s") + " need attention"
            : errorCount + " interaction error" + (errorCount === 1 ? "" : "s")
          : status === "running"
            ? "Executing"
            : status === "waiting"
              ? "Waiting"
              : "Idle";

    const lastProgress = stream.messages.find(
      (message) => message.kind === "progress",
    );
    const summaryText =
      stream.summary ??
      lastProgress?.summary ??
      (status === "completed"
        ? stream.goal + " completed."
        : stream.currentAction || stream.goal);

    return {
      id: stream.ownerId,
      sourceLabel: stream.sourceLabel,
      goal: stream.goal,
      status,
      startedAt,
      completedAt,
      durationMs,
      toolCallCount: Math.max(
        substantiveInteractions.length,
        stream.toolStats?.totalToolSteps ?? 0,
      ),
      toolBreakdown: [...toolCounts.values()].sort(
        (a, b) => b.count - a.count || a.tool.localeCompare(b.tool),
      ),
      runtimeActionCount,
      runtimeActionSucceeded,
      runtimeActionFailed,
      runtimeActionNeedsReview,
      runtimeActionBreakdown: [...runtimeActionCounts.values()].sort(
        (a, b) => b.count - a.count || a.tool.localeCompare(b.tool),
      ),
      progressCount,
      errorCount,
      warningCount,
      reconnectCount,
      taskCount: stream.tasks.length,
      completedTaskCount: taskCompleted,
      failedTaskCount: taskFailed,
      taskErrorCount,
      taskNeedsReviewCount,
      outcome,
      summaryText,
    };
  });
}

export function buildOperationsGraphModel({
  snapshot,
  activity,
  board,
  now = Date.now(),
  policy = buildPolicy(snapshot),
}: {
  snapshot: RuntimeSnapshot | null;
  activity: ActivityEntry[];
  board: WorkstreamBoard;
  now?: number;
  policy?: OperationsGraphPolicy;
}): OperationsGraphModel {
  const interactions = buildMcpInteractionFeed(
    activity,
    policy.maxInteractionHistory,
  );
  const summaryInteractions = buildMcpInteractionFeed(activity, 200);
  const recentInteractions = interactions.filter((interaction) => {
    if (interaction.status === "running") return true;
    const at = timestamp(interaction.completedAt ?? interaction.startedAt);
    return at > 0 && now - at <= policy.recentWindowMs;
  });
  const latestInteraction = recentInteractions[0] ?? null;
  const runningInteractions = recentInteractions.filter(
    (interaction) => interaction.status === "running",
  );
  const routeKinds = new Set(
    recentInteractions.map((interaction) =>
      interactionRouteKind(interaction.tool),
    ),
  );
  const desktopControlVisible =
    routeKinds.has("desktop-control") || routeKinds.has("remote-control");
  const remoteControlVisible = routeKinds.has("remote-control");
  const runtimeGateNeeded = routeKinds.has("runtime-gated");
  const currentWorkstreams = board.streams.filter((stream) =>
    relevantWorkstream(stream, now, policy.recentWindowMs),
  );

  const nodes = new Map<string, OperationsGraphNode>();
  const edges = new Map<string, OperationsGraphEdge>();
  const groups = new Map<string, OperationsGraphGroup>();

  const ensureGroup = (id: string, label: string, order: number) => {
    if (!groups.has(id)) {
      groups.set(id, { id, label, order, nodeIds: [] });
    }
    return groups.get(id)!;
  };

  const addNode = (
    node: OperationsGraphNode,
    groupLabel: string,
    groupOrder: number,
  ) => {
    const existing = nodes.get(node.id);
    if (existing) {
      nodes.set(node.id, {
        ...existing,
        ...node,
        evidence: [...new Set([...existing.evidence, ...node.evidence])],
      });
      return nodes.get(node.id)!;
    }
    nodes.set(node.id, node);
    const group = ensureGroup(node.groupId, groupLabel, groupOrder);
    if (!group.nodeIds.includes(node.id)) group.nodeIds.push(node.id);
    return node;
  };

  const addEdge = (edge: OperationsGraphEdge) => {
    const existing = edges.get(edge.id);
    if (!existing) {
      edges.set(edge.id, edge);
      return;
    }
    const stateOrder: OperationsState[] = [
      "idle",
      "healthy",
      "waiting",
      "active",
      "attention",
      "locked",
      "offline",
    ];
    edges.set(edge.id, {
      ...existing,
      ...edge,
      state:
        stateOrder.indexOf(edge.state) > stateOrder.indexOf(existing.state)
          ? edge.state
          : existing.state,
      observed: existing.observed || edge.observed,
    });
  };

  const access = snapshot?.runtimeAccess ?? null;
  const accessReady = access?.state === "READY";
  const accessLocked =
    access?.state === "LOCKED" || access?.state === "REVOKED";

  // Open extension contract: future Worker / Cloud / Provider components can
  // publish graph nodes and edges without requiring a UI release.
  for (const entry of activity) {
    const meta = entry.meta ?? {};
    if (meta.eventKind === "operations_flow_node") {
      const id = text(meta.nodeId);
      const groupId = text(meta.groupId);
      const groupLabel = text(meta.groupLabel);
      const label = text(meta.label);
      if (!id || !groupId || !groupLabel || !label) continue;
      const kindValue = text(meta.kind);
      const stateValue = text(meta.state);
      const allowedKinds: OperationsNodeKind[] = [
        "source",
        "transport",
        "cloud",
        "command",
        "authorization",
        "runtime",
        "tool",
        "task",
        "process",
        "approval",
        "request",
        "target",
        "result",
        "generic",
      ];
      const allowedStates: OperationsState[] = [
        "active",
        "healthy",
        "waiting",
        "attention",
        "locked",
        "idle",
        "offline",
      ];
      const kind = allowedKinds.includes(kindValue as OperationsNodeKind)
        ? (kindValue as OperationsNodeKind)
        : "generic";
      const state = allowedStates.includes(stateValue as OperationsState)
        ? (stateValue as OperationsState)
        : "idle";
      const order =
        typeof meta.groupOrder === "number" && Number.isFinite(meta.groupOrder)
          ? meta.groupOrder
          : 50;
      addNode(
        {
          id,
          groupId,
          kind,
          label,
          detail: text(meta.detail),
          state,
          current: meta.current === true,
          observedAt: entry.at,
          workstreamId: text(meta.workstreamId),
          evidence: [`activity:${entry.id}`],
          meta:
            meta.nodeMeta &&
            typeof meta.nodeMeta === "object" &&
            !Array.isArray(meta.nodeMeta)
              ? (meta.nodeMeta as Record<string, unknown>)
              : undefined,
        },
        groupLabel,
        order,
      );
    }
  }

  for (const entry of activity) {
    const meta = entry.meta ?? {};
    if (meta.eventKind !== "operations_flow_edge") continue;
    const id = text(meta.edgeId);
    const from = text(meta.from);
    const to = text(meta.to);
    if (!id || !from || !to) continue;
    const stateValue = text(meta.state);
    const relationValue = text(meta.relation);
    const allowedStates: OperationsState[] = [
      "active",
      "healthy",
      "waiting",
      "attention",
      "locked",
      "idle",
      "offline",
    ];
    const allowedRelations: OperationsGraphEdge["relation"][] = [
      "request",
      "dispatch",
      "authorize",
      "execute",
      "result",
      "return",
      "support",
      "durable",
      "coordination",
    ];
    addEdge({
      id,
      from,
      to,
      state: allowedStates.includes(stateValue as OperationsState)
        ? (stateValue as OperationsState)
        : "idle",
      relation: allowedRelations.includes(
        relationValue as OperationsGraphEdge["relation"],
      )
        ? (relationValue as OperationsGraphEdge["relation"])
        : "coordination",
      label: text(meta.label),
      observed: meta.observed !== false,
      workstreamId: text(meta.workstreamId),
    });
  }

  // Source nodes are derived only from real recent traffic, connected sessions,
  // current durable work, or active Cloud commands. Apply oldest first so the
  // newest observation wins when a source node is merged repeatedly.
  for (const interaction of [...recentInteractions].reverse()) {
    const identity = sourceIdentity(interaction);
    addNode(
      {
        id: `source:${identity}`,
        groupId: "sources",
        kind: "source",
        label: sourceLabel(interaction),
        detail:
          interaction.status === "running"
            ? `Running ${interaction.tool}`
            : `Last ${interaction.tool} · ${interaction.status}`,
        state: stateFromInteraction(interaction),
        current: interaction.status === "running",
        observedAt: interaction.completedAt ?? interaction.startedAt,
        workstreamId: interaction.workstreamId,
        evidence: [interaction.id],
        meta: { clientKind: sourceKind(interaction) },
      },
      "Sources",
      10,
    );
  }

  for (const stream of currentWorkstreams) {
    addNode(
      {
        id: `source:${stream.ownerId}`,
        groupId: "sources",
        kind: "source",
        label: stream.sourceLabel,
        detail: stream.goal,
        state:
          runningInteractions.some(
            (interaction) => sourceIdentity(interaction) === stream.ownerId,
          )
            ? "active"
            : stateFromWorkstream(stream),
        current:
          stream.tasks.some((task) => isExecutingTask(task.status)) ||
          runningInteractions.some(
            (interaction) => sourceIdentity(interaction) === stream.ownerId,
          ),
        observedAt: stream.updatedAt,
        workstreamId: stream.ownerId,
        evidence: [`workstream:${stream.id}`],
        meta: { sourceKind: stream.sourceKind },
      },
      "Sources",
      10,
    );
  }

  const activeCloudCommands = snapshot?.cloud.commands.filter((command) =>
    ["processing", "uncertain"].includes(command.status),
  ) ?? [];

  for (const command of activeCloudCommands) {
    const sourceId =
      command.origin?.id ??
      command.origin?.label ??
      `cloud:${command.commandId}`;
    addNode(
      {
        id: `source:${sourceId}`,
        groupId: "sources",
        kind: "source",
        label: cloudCommandLabel(command),
        detail: command.kind,
        state: command.status === "uncertain" ? "attention" : "active",
        current: true,
        observedAt: command.updatedAt,
        workstreamId: null,
        evidence: [`cloud-command:${command.commandId}`],
        meta: { sourceKind: command.origin?.kind ?? "cloud" },
      },
      "Sources",
      10,
    );
  }

  const mcpNeeded =
    recentInteractions.length > 0 ||
    (snapshot?.mcp.sessionCount ?? 0) > 0 ||
    snapshot?.mcp.status === "running";
  if (mcpNeeded) {
    addNode(
      {
        id: "transport:mcp",
        groupId: "ingress",
        kind: "transport",
        label: "OWL MCP",
        detail:
          snapshot?.mcp.status === "running"
            ? `${snapshot.mcp.sessionCount} active transport session${snapshot.mcp.sessionCount === 1 ? "" : "s"}`
            : snapshot?.mcp.status ?? "stopped",
        state:
          snapshot?.mcp.status === "running"
            ? runningInteractions.length > 0
              ? "active"
              : "healthy"
            : snapshot?.mcp.status === "error"
              ? "attention"
              : "offline",
        current: runningInteractions.length > 0,
        observedAt: snapshot?.checkedAt ?? null,
        workstreamId: null,
        evidence: recentInteractions.map((item) => item.id),
      },
      "Ingress",
      20,
    );
  }

  const tunnelVisible =
    snapshot?.tunnel.state &&
    snapshot.tunnel.state !== "stopped";
  if (tunnelVisible) {
    const reachability = snapshot?.tunnel.reachability?.state ?? null;
    const tunnelNodeState: OperationsState =
      reachability === "ready"
        ? "healthy"
        : reachability === "degraded" || reachability === "stale"
          ? "attention"
          : reachability === "starting" || reachability === "recovering"
            ? "waiting"
            : reachability === "unreachable"
              ? "offline"
              : snapshot?.tunnel.state === "running"
                ? "healthy"
                : "offline";
    const tunnelDetail = reachability
      ? `${reachability} · local ${snapshot?.tunnel.reachability?.localReady ? "ready" : "not ready"} · control plane ${snapshot?.tunnel.reachability?.controlPlane?.status ?? "unknown"}`
      : snapshot?.tunnel.state ?? "unknown";

    addNode(
      {
        id: "transport:tunnel",
        groupId: "ingress",
        kind: "transport",
        label: "OWL Tunnel",
        detail: tunnelDetail,
        state: tunnelNodeState,
        current: reachability === "recovering",
        observedAt:
          snapshot?.tunnel.reachability?.lastHealthOkAt ??
          snapshot?.tunnel.reachability?.lastProbeAt ??
          snapshot?.checkedAt ??
          null,
        workstreamId: null,
        evidence: reachability
          ? ["tunnel-health", "tunnel-status"]
          : ["tunnel-status"],
      },
      "Ingress",
      20,
    );
    if (mcpNeeded) {
      addEdge({
        id: "edge:tunnel:mcp",
        from: "transport:tunnel",
        to: "transport:mcp",
        state: tunnelNodeState,
        relation: "support",
        label: "remote transport",
        observed: Boolean(snapshot?.tunnel.reachability?.lastHealthOkAt),
        workstreamId: null,
      });
    }
  }

  if (desktopControlVisible) {
    const desktopInteractions = recentInteractions.filter((interaction) => {
      const route = interactionRouteKind(interaction.tool);
      return route === "desktop-control" || route === "remote-control";
    });
    addNode(
      {
        id: "transport:desktop-capability",
        groupId: "coordination",
        kind: "transport",
        label: "Desktop Capability Bridge",
        detail: "localhost control plane",
        state: desktopInteractions.some(
          (interaction) => interaction.status === "running",
        )
          ? "active"
          : "healthy",
        current: desktopInteractions.some(
          (interaction) => interaction.status === "running",
        ),
        observedAt:
          desktopInteractions[0]?.completedAt ??
          desktopInteractions[0]?.startedAt ??
          snapshot?.checkedAt ??
          null,
        workstreamId: null,
        evidence: desktopInteractions.map((interaction) => interaction.id),
      },
      "Coordination",
      25,
    );
  }

  if (activeCloudCommands.length > 0 || remoteControlVisible) {
    const remoteInteractions = recentInteractions.filter(
      (interaction) => interactionRouteKind(interaction.tool) === "remote-control",
    );
    addNode(
      {
        id: "transport:cloud-bridge",
        groupId: "ingress",
        kind: "cloud",
        label: "OWL Cloud Bridge",
        detail: snapshot?.cloud.status ?? "unknown",
        state:
          snapshot?.cloud.status === "connected"
            ? activeCloudCommands.length > 0 ||
              remoteInteractions.some(
                (interaction) => interaction.status === "running",
              )
              ? "active"
              : "healthy"
            : snapshot?.cloud.status === "degraded"
              ? "attention"
              : "waiting",
        current:
          activeCloudCommands.length > 0 ||
          remoteInteractions.some(
            (interaction) => interaction.status === "running",
          ),
        observedAt:
          remoteInteractions[0]?.completedAt ??
          remoteInteractions[0]?.startedAt ??
          snapshot?.cloud.lastCloudContactAt ??
          snapshot?.cloud.lastPollAt ??
          null,
        workstreamId: null,
        evidence: [
          ...activeCloudCommands.map(
            (command) => `cloud-command:${command.commandId}`,
          ),
          ...remoteInteractions.map((interaction) => interaction.id),
        ],
      },
      "Ingress",
      20,
    );

    for (const command of activeCloudCommands) {
      const commandNodeId = `command:${command.commandId}`;
      addNode(
        {
          id: commandNodeId,
          groupId: "coordination",
          kind: "command",
          label: command.kind,
          detail:
            command.status === "uncertain"
              ? command.lastErrorCode ?? "uncertain delivery"
              : command.status,
          state:
            command.status === "uncertain" ? "attention" : "active",
          current: true,
          observedAt: command.updatedAt,
          workstreamId: null,
          evidence: [`cloud-command:${command.commandId}`],
        },
        "Coordination",
        25,
      );
      const sourceId =
        command.origin?.id ??
        command.origin?.label ??
        `cloud:${command.commandId}`;
      addEdge({
        id: `edge:source:${sourceId}:cloud`,
        from: `source:${sourceId}`,
        to: "transport:cloud-bridge",
        state:
          command.status === "uncertain" ? "attention" : "active",
        relation: "request",
        label: null,
        observed: true,
        workstreamId: null,
      });
      addEdge({
        id: `edge:cloud:${command.commandId}`,
        from: "transport:cloud-bridge",
        to: commandNodeId,
        state:
          command.status === "uncertain" ? "attention" : "active",
        relation: "coordination",
        label: null,
        observed: true,
        workstreamId: null,
      });
    }
  }

  const durableRuntimeVisible = currentWorkstreams.some((stream) =>
    stream.tasks.some((task) => isActiveTask(task.status)),
  );
  const runtimeVisible =
    routeKinds.has("runtime-gated") ||
    routeKinds.has("runtime-bypass") ||
    durableRuntimeVisible ||
    activeCloudCommands.length > 0;
  const runtimeAccessVisible =
    runtimeGateNeeded ||
    durableRuntimeVisible ||
    activeCloudCommands.length > 0;

  if (access && runtimeAccessVisible) {
    const leaseSource =
      access.grant?.source === "cloud-signed-lease"
        ? "Cloud-signed lease"
        : access.mode === "compat"
          ? "Compatibility access"
          : "Runtime access";
    addNode(
      {
        id: "gate:runtime-access",
        groupId: "authorization",
        kind: "authorization",
        label:
          access.state === "LOCKED"
            ? "Runtime access locked"
            : access.state === "REVOKED"
              ? "Runtime access revoked"
              : leaseSource,
        detail:
          access.state === "READY"
            ? access.grant?.expiresAt
              ? `expires ${new Date(access.grant.expiresAt).toLocaleTimeString()}`
              : access.mode
            : access.reasonCode ?? access.state,
        state:
          access.state === "READY"
            ? access.grant?.signatureVerified === true || access.mode === "compat"
              ? "healthy"
              : "waiting"
            : "locked",
        current: recentInteractions.length > 0 || activeCloudCommands.length > 0,
        observedAt: access.updatedAt,
        workstreamId: null,
        evidence: [
          `access:${access.state}`,
          ...(access.grant?.grantId ? [`grant:${access.grant.grantId}`] : []),
        ],
      },
      "Authorization",
      30,
    );
  }

  if (runtimeVisible && (snapshot?.mode === "live" || snapshot?.info)) {
    addNode(
      {
        id: "runtime:local",
        groupId: "runtime",
        kind: "runtime",
        label: "OWL Runtime",
        detail:
          snapshot?.info?.runtimeVersion ??
          snapshot?.runtimeEndpoint ??
          "runtime available",
        state: snapshot?.mode === "live" ? "healthy" : "offline",
        current:
          runningInteractions.length > 0 ||
          currentWorkstreams.some((stream) =>
            stream.tasks.some((task) => isActiveTask(task.status)),
          ),
        observedAt: snapshot?.checkedAt ?? null,
        workstreamId: null,
        evidence: ["runtime-snapshot"],
      },
      "Runtime",
      40,
    );
  }

  // Recent traffic determines observed source → ingress → gate → runtime routes.
  const latestBySource = new Map<string, McpInteraction>();
  for (const interaction of recentInteractions) {
    const identity = sourceIdentity(interaction);
    if (!latestBySource.has(identity)) latestBySource.set(identity, interaction);
  }

  for (const interaction of [...recentInteractions.slice(0, 12)].reverse()) {
    const identity = sourceIdentity(interaction);
    const edgeState = stateFromInteraction(interaction);
    if (mcpNeeded) {
      addEdge({
        id: `edge:${identity}:mcp`,
        from: `source:${identity}`,
        to: "transport:mcp",
        state: edgeState,
        relation: "request",
        label: interaction.tool,
        observed: true,
        workstreamId: interaction.workstreamId,
      });
    }

    const route = interactionRouteKind(interaction.tool);
    let executionFrom = "transport:mcp";
    let executionRelation: OperationsGraphEdge["relation"] = "execute";
    let executionObserved = route === "host-local";

    if (route === "runtime-gated") {
      if (access && nodes.has("gate:runtime-access")) {
        addEdge({
          id: `edge:mcp:gate:${identity}`,
          from: "transport:mcp",
          to: "gate:runtime-access",
          state: accessLocked ? "locked" : edgeState,
          relation: "authorize",
          label: "lease gate",
          observed: false,
          workstreamId: interaction.workstreamId,
        });
        executionFrom = "gate:runtime-access";
      }

      if (!accessLocked && nodes.has("runtime:local")) {
        addEdge({
          id: `edge:gate:runtime:${identity}`,
          from: executionFrom,
          to: "runtime:local",
          state: edgeState,
          relation: "execute",
          label: "runtime API",
          observed: false,
          workstreamId: interaction.workstreamId,
        });
        executionFrom = "runtime:local";
      }
    } else if (route === "runtime-bypass") {
      if (nodes.has("runtime:local")) {
        addEdge({
          id: `edge:mcp:runtime:${identity}`,
          from: "transport:mcp",
          to: "runtime:local",
          state: edgeState,
          relation: "execute",
          label: "public runtime API",
          observed: false,
          workstreamId: interaction.workstreamId,
        });
        executionFrom = "runtime:local";
      }
    } else if (route === "desktop-control") {
      if (nodes.has("transport:desktop-capability")) {
        addEdge({
          id: `edge:mcp:desktop:${identity}`,
          from: "transport:mcp",
          to: "transport:desktop-capability",
          state: edgeState,
          relation: "coordination",
          label: "localhost RPC",
          observed: false,
          workstreamId: interaction.workstreamId,
        });
        executionFrom = "transport:desktop-capability";
        executionRelation = "coordination";
      }
    } else if (route === "remote-control") {
      if (nodes.has("transport:desktop-capability")) {
        addEdge({
          id: `edge:mcp:desktop:${identity}`,
          from: "transport:mcp",
          to: "transport:desktop-capability",
          state: edgeState,
          relation: "coordination",
          label: "localhost RPC",
          observed: false,
          workstreamId: interaction.workstreamId,
        });
        executionFrom = "transport:desktop-capability";
      }
      if (nodes.has("transport:cloud-bridge")) {
        addEdge({
          id: `edge:desktop:cloud:${identity}`,
          from: executionFrom,
          to: "transport:cloud-bridge",
          state: edgeState,
          relation: "dispatch",
          label: "cloud control",
          observed: false,
          workstreamId: interaction.workstreamId,
        });
        executionFrom = "transport:cloud-bridge";
        executionRelation = "dispatch";
      }
    }

    const toolNodeId = `tool:${interaction.id}`;
    addNode(
      {
        id: toolNodeId,
        groupId: "execution",
        kind: "tool",
        label: interaction.tool,
        detail: summarizeInteraction(interaction),
        state: edgeState,
        current: interaction.status === "running",
        observedAt: interaction.completedAt ?? interaction.startedAt,
        workstreamId: interaction.workstreamId,
        evidence: [interaction.id],
      },
      "Execution",
      50,
    );

    if (route === "runtime-gated" && accessLocked && access) {
      addEdge({
        id: `edge:gate:${toolNodeId}`,
        from: "gate:runtime-access",
        to: toolNodeId,
        state: "locked",
        relation: "authorize",
        label: "denied",
        observed: false,
        workstreamId: interaction.workstreamId,
      });
    } else {
      addEdge({
        id: `edge:route:${toolNodeId}`,
        from: executionFrom,
        to: toolNodeId,
        state: edgeState,
        relation: executionRelation,
        label:
          route === "host-local"
            ? "handled in Connection Host"
            : null,
        observed: executionObserved,
        workstreamId: interaction.workstreamId,
      });
    }

    const resultNodeId = `result:${interaction.id}`;
    addNode(
      {
        id: resultNodeId,
        groupId: "results",
        kind: "result",
        label:
          interaction.status === "running"
            ? "Running"
            : interaction.status === "success"
              ? "Success"
              : interaction.status === "progress"
                ? "Progress checkpoint"
                : "Error",
        detail:
          interaction.status === "running"
            ? interaction.tool
            : `${interaction.tool}${interaction.durationMs !== null ? ` · ${interaction.durationMs} ms` : ""}`,
        state: edgeState,
        current: interaction.status === "running",
        observedAt: interaction.completedAt ?? interaction.startedAt,
        workstreamId: interaction.workstreamId,
        evidence: [interaction.id],
      },
      "Results",
      60,
    );
    addEdge({
      id: `edge:${toolNodeId}:${resultNodeId}`,
      from: toolNodeId,
      to: resultNodeId,
      state: edgeState,
      relation: "result",
      label: null,
      observed: interaction.status !== "running",
      workstreamId: interaction.workstreamId,
    });
    addEdge({
      id: `edge:return:${interaction.id}`,
      from: resultNodeId,
      to: `source:${identity}`,
      state: edgeState,
      relation: "return",
      label: "response",
      observed: interaction.status !== "running",
      workstreamId: interaction.workstreamId,
    });
  }

  // Durable work remains visible even when the source transport disappears.
  for (const stream of currentWorkstreams) {
    const sourceNodeId = `source:${stream.ownerId}`;
    const activeTasks = stream.tasks.filter((task) => isActiveTask(task.status));
    for (const task of activeTasks) {
      const taskNodeId = `task:${task.id}`;
      addNode(
        {
          id: taskNodeId,
          groupId: "execution",
          kind: "task",
          label: task.label,
          detail: task.current ?? task.status,
          state:
            task.status === "running"
              ? "active"
              : ["blocked", "needs_review"].includes(task.status)
                ? "attention"
                : "waiting",
          current: isExecutingTask(task.status),
          observedAt: task.updatedAt,
          workstreamId: stream.ownerId,
          evidence: [`task:${task.id}`],
        },
        "Execution",
        50,
      );
      if (nodes.has("runtime:local")) {
        if (!stream.connected) {
          addEdge({
            id: `edge:durable:${stream.ownerId}:runtime`,
            from: sourceNodeId,
            to: "runtime:local",
            state:
              task.status === "running"
                ? "active"
                : ["blocked", "needs_review"].includes(task.status)
                  ? "attention"
                  : "waiting",
            relation: "durable",
            label: "survives disconnect",
            observed: true,
            workstreamId: stream.ownerId,
          });
        }
        addEdge({
          id: `edge:runtime:task:${task.id}`,
          from: "runtime:local",
          to: taskNodeId,
          state:
            task.status === "running"
              ? "active"
              : ["blocked", "needs_review"].includes(task.status)
                ? "attention"
                : "waiting",
          relation: "execute",
          label: null,
          observed: true,
          workstreamId: stream.ownerId,
        });
      }
    }

    for (const message of stream.messages.filter(
      (item) => item.kind === "request",
    )) {
      const requestNodeId = `request:${message.id}`;
      addNode(
        {
          id: requestNodeId,
          groupId: "execution",
          kind: "request",
          label: "Agent request",
          detail: message.summary,
          state:
            message.tone === "attention"
              ? "attention"
              : message.tone === "healthy"
                ? "healthy"
                : "waiting",
          current: true,
          observedAt: message.at,
          workstreamId: stream.ownerId,
          evidence: [`agent-request:${message.id}`],
        },
        "Execution",
        50,
      );
      if (nodes.has("runtime:local")) {
        addEdge({
          id: `edge:runtime:request:${message.id}`,
          from: "runtime:local",
          to: requestNodeId,
          state:
            message.tone === "attention" ? "attention" : "waiting",
          relation: "coordination",
          label: null,
          observed: true,
          workstreamId: stream.ownerId,
        });
      }
    }
  }

  for (const process of currentProcessRows(snapshot)) {
    const processId =
      text(process.processId) ??
      text(process.id) ??
      `anonymous-${nodes.size}`;
    addNode(
      {
        id: `process:${processId}`,
        groupId: "execution",
        kind: "process",
        label:
          text(process.label) ??
          `Process · ${short(processId, 6) ?? "running"}`,
        detail: text(process.status) ?? "running",
        state: "active",
        current: true,
        observedAt: snapshot?.checkedAt ?? null,
        workstreamId: text(process.ownerSessionId),
        evidence: [`process:${processId}`],
      },
      "Execution",
      50,
    );
    if (nodes.has("runtime:local")) {
      addEdge({
        id: `edge:runtime:process:${processId}`,
        from: "runtime:local",
        to: `process:${processId}`,
        state: "active",
        relation: "execute",
        label: null,
        observed: true,
        workstreamId: text(process.ownerSessionId),
      });
    }
  }

  const approvals = pendingApprovalRows(snapshot);
  if (approvals.length > 0) {
    addNode(
      {
        id: "approval:pending",
        groupId: "execution",
        kind: "approval",
        label: `${approvals.length} approval${approvals.length === 1 ? "" : "s"} pending`,
        detail: "Waiting for user authorization",
        state: "waiting",
        current: true,
        observedAt: snapshot?.checkedAt ?? null,
        workstreamId: null,
        evidence: approvals
          .map((row) => text(row.approvalId) ?? text(row.id))
          .filter((value): value is string => Boolean(value))
          .map((value) => `approval:${value}`),
      },
      "Execution",
      50,
    );
    if (nodes.has("runtime:local")) {
      addEdge({
        id: "edge:runtime:approvals",
        from: "runtime:local",
        to: "approval:pending",
        state: "waiting",
        relation: "authorize",
        label: null,
        observed: true,
        workstreamId: null,
      });
    }
  }

  for (const command of activeCloudCommands) {
    const commandNodeId = `command:${command.commandId}`;
    const nextNode = access
      ? "gate:runtime-access"
      : nodes.has("runtime:local")
        ? "runtime:local"
        : null;
    if (nextNode) {
      addEdge({
        id: `edge:command:next:${command.commandId}`,
        from: commandNodeId,
        to: nextNode,
        state:
          command.status === "uncertain" ? "attention" : "active",
        relation: "dispatch",
        label: null,
        observed: true,
        workstreamId: null,
      });
    }
  }

  const currentDurable = currentWorkstreams.filter((stream) =>
    stream.tasks.some((task) => isExecutingTask(task.status)),
  );
  const retainedDurable = currentWorkstreams.filter(
    (stream) =>
      !stream.tasks.some((task) => isExecutingTask(task.status)) &&
      stream.tasks.some((task) => isActiveTask(task.status)),
  );
  const recoverable = currentWorkstreams.filter(
    (stream) => !stream.connected && stream.isCurrent,
  );
  const runtimeLive = snapshot?.mode === "live";
  const observableHealthy =
    runtimeLive && snapshot?.runtimeEvents?.status === "healthy";
  const signedLease =
    access?.mode === "enforced" &&
    access.state === "READY" &&
    access.grant?.signatureVerified === true;

  const assurances: OperationsAssurance[] = [
    {
      id: "persistent",
      label: "PERSISTENT",
      state: !runtimeLive
        ? "offline"
        : currentDurable.length > 0
          ? "active"
          : retainedDurable.length > 0 || recoverable.length > 0
            ? "waiting"
            : "healthy",
      value: !runtimeLive
        ? "Offline"
        : currentDurable.length > 0
          ? "Active"
          : retainedDurable.length > 0
            ? "Retained"
            : recoverable.length > 0
              ? "Recoverable"
              : "Ready",
      detail:
        currentDurable.length > 0
          ? `${currentDurable.length} durable workstream${currentDurable.length === 1 ? "" : "s"} executing`
          : retainedDurable.length > 0
            ? `${retainedDurable.length} durable workstream${retainedDurable.length === 1 ? "" : "s"} retained / waiting`
            : recoverable.length > 0
              ? `${recoverable.length} workstream${recoverable.length === 1 ? "" : "s"} survives source disconnect`
              : "No durable execution currently running",
    },
    {
      id: "observable",
      label: "OBSERVABLE",
      state: observableHealthy
        ? runningInteractions.length > 0
          ? "active"
          : "healthy"
        : runtimeLive
          ? "attention"
          : "offline",
      value: observableHealthy
        ? runningInteractions.length > 0
          ? "Traffic live"
          : "Live"
        : snapshot?.runtimeEvents?.status?.replaceAll("_", " ") ?? "Offline",
      detail:
        latestInteraction
          ? `Latest ${latestInteraction.tool} · ${new Date(latestInteraction.completedAt ?? latestInteraction.startedAt ?? "").toLocaleTimeString()}`
          : snapshot?.runtimeEvents?.lastSuccessAt
            ? `Runtime events current · ${new Date(snapshot.runtimeEvents.lastSuccessAt).toLocaleTimeString()}`
            : "Waiting for observable traffic",
    },
    {
      id: "authorized",
      label: "AUTHORIZED",
      state: signedLease
        ? "healthy"
        : accessLocked
          ? "locked"
          : accessReady
            ? "waiting"
            : "idle",
      value: signedLease
        ? "Verified"
        : access?.state === "LOCKED"
          ? "Locked"
          : access?.state === "REVOKED"
            ? "Revoked"
            : access?.mode === "compat" && accessReady
              ? "Compatibility"
              : "Check",
      detail: signedLease
        ? `${access?.grant?.entitlementStatus ?? "authorized"} · lease expires ${new Date(access!.grant!.expiresAt).toLocaleTimeString()}`
        : accessLocked
          ? access?.reasonCode ?? "Runtime access denied"
          : access?.mode === "compat"
            ? "Development compatibility access"
            : access?.state ?? "Authorization unavailable",
    },
  ];

  const nextActions = currentWorkstreams
    .flatMap((stream) => stream.nextActions)
    .filter((value, index, values) => values.indexOf(value) === index);

  const loopPaths: OperationsLoopPath[] = [...latestBySource.entries()].map(
    ([identity, interaction]) => ({
      id: "loop:" + identity,
      workstreamId: interaction.workstreamId,
      sourceNodeId: "source:" + identity,
      sourceLabel:
        nodes.get("source:" + identity)?.label ?? sourceLabel(interaction),
      resultNodeId: "result:" + interaction.id,
      requestLabel:
        interaction.tool + " · " + summarizeInteraction(interaction),
      responseLabel:
        interaction.status === "running"
          ? "Awaiting result"
          : interaction.status === "error"
            ? interaction.errorCode ?? "Error returned"
            : interaction.status === "progress"
              ? "Progress checkpoint"
              : interaction.durationMs !== null
                ? "Result · " + interaction.durationMs + " ms"
                : "Result returned",
      state: stateFromInteraction(interaction),
      running: interaction.status === "running",
      observedAt: interaction.completedAt ?? interaction.startedAt,
    }),
  );

  const summaries = buildWorkstreamSummaries({
    streams: currentWorkstreams,
    interactions: summaryInteractions,
    activity,
  }).sort((a, b) => {
    const rank = (status: OperationsWorkstreamSummary["status"]) =>
      status === "running"
        ? 5
        : status === "attention"
          ? 4
          : status === "waiting"
            ? 3
            : status === "completed"
              ? 2
              : 1;
    return (
      rank(b.status) - rank(a.status) ||
      timestamp(b.completedAt ?? b.startedAt) -
        timestamp(a.completedAt ?? a.startedAt)
    );
  });

  const orderedGroups = [...groups.values()]
    .filter((group) => group.nodeIds.some((id) => nodes.has(id)))
    .sort((a, b) => a.order - b.order);

  return {
    generatedAt: new Date(now).toISOString(),
    groups: orderedGroups,
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    loopPaths,
    summaries,
    assurances,
    interactions: recentInteractions,
    currentWorkstreams,
    nextActions,
    latestInteraction,
    runningInteractions,
  };
}
