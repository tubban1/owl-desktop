import type {
  AgentRequest,
  CloudBridgeCommandRecord,
  ConversationContinuityStatus,
  PlannerContinuationOwner,
  RuntimeSnapshot,
} from "../types";

type Row = Record<string, any>;

const ACTIVE_TASK_STATES = new Set([
  "pending",
  "running",
  "waiting_approval",
  "blocked",
  "paused",
  "needs_review",
]);

const WAITING_CHECKPOINT_STATES = new Set([
  "waiting_runtime",
  "waiting_user",
  "waiting_external",
]);

function rows(value: unknown, keys: string[]): Row[] {
  if (Array.isArray(value)) {
    return value.filter(
      (item): item is Row => Boolean(item && typeof item === "object"),
    );
  }
  if (!value || typeof value !== "object") return [];
  const object = value as Record<string, unknown>;
  for (const key of keys) {
    if (Array.isArray(object[key])) {
      return (object[key] as unknown[]).filter(
        (item): item is Row => Boolean(item && typeof item === "object"),
      );
    }
  }
  return rows(object.result, keys);
}

function timestamp(value: unknown): number {
  if (typeof value !== "string") return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function short(value: string, length = 8): string {
  if (value.length <= length) return value;
  return value.slice(-length);
}

function clientLabel(owner: Partial<PlannerContinuationOwner> & { ownerId: string }) {
  if (owner.clientLabel?.trim()) return owner.clientLabel.trim();
  const suffix = short(owner.ownerId, 6);
  switch (owner.clientKind) {
    case "worker":
      return `Worker · ${suffix}`;
    case "cloud":
      return `Cloud agent · ${suffix}`;
    case "desktop":
      return `Desktop · ${suffix}`;
    case "mcp":
      return `MCP session · ${suffix}`;
    case "agent":
      return `Agent · ${suffix}`;
    case "chatgpt":
    default:
      return `ChatGPT · ${suffix}`;
  }
}

function sourceRole(kind: PlannerContinuationOwner["clientKind"]) {
  switch (kind) {
    case "worker":
      return "Worker";
    case "cloud":
      return "Cloud";
    case "desktop":
      return "Desktop";
    case "mcp":
      return "MCP";
    case "agent":
      return "Agent";
    case "chatgpt":
    default:
      return "ChatGPT";
  }
}

function runtimeTaskStatus(task: Row): string {
  return String(task.status ?? task.progress?.phase ?? "unknown");
}

function runtimeTaskIsLive(task: Row): boolean {
  return (
    task.progress?.terminal !== true &&
    ACTIVE_TASK_STATES.has(runtimeTaskStatus(task))
  );
}

function projectedTaskIsLive(task: WorkstreamTask): boolean {
  return task.terminal !== true && ACTIVE_TASK_STATES.has(task.status);
}

function taskProgress(task: Row): number | null {
  const counts = task.counts ?? task.progress?.counts ?? {};
  const total = Number(counts.total ?? 0);
  const succeeded = Number(counts.succeeded ?? 0);
  if (!Number.isFinite(total) || total <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((succeeded / total) * 100)));
}

export type WorkstreamMessage = {
  id: string;
  at: string | null;
  from: string;
  to: string;
  kind: "intent" | "dispatch" | "status" | "progress" | "request" | "remote";
  summary: string;
  tone: "neutral" | "active" | "waiting" | "attention" | "healthy";
};

export type WorkstreamTask = {
  id: string;
  label: string;
  status: string;
  terminal: boolean;
  progressPercent: number | null;
  current: string | null;
  updatedAt: string | null;
  actionCount?: number;
  succeededActions?: number;
  failedActions?: number;
  needsReviewActions?: number;
  actions?: Array<{
    action: string;
    state: string;
  }>;
};

export type MonitorWorkstream = {
  id: string;
  ownerId: string;
  sourceKind: string;
  sourceLabel: string;
  connected: boolean;
  transportCount: number;
  status: "working" | "waiting" | "attention" | "idle" | "disconnected";
  isCurrent: boolean;
  goal: string;
  phase: string | null;
  summary: string | null;
  updatedAt: string | null;
  orchestrationId: string | null;
  latestHandoffId: string | null;
  continuity: ConversationContinuityStatus | null;
  currentExecutor: string;
  currentAction: string;
  tasks: WorkstreamTask[];
  messages: WorkstreamMessage[];
  nextActions: string[];
  toolStats: {
    totalToolSteps: number;
    recentTools: Array<{
      at: string | null;
      tool: string;
      outcome: "success" | "error";
      durationMs: number;
    }>;
  };
  progressPolicy: {
    intervalMs: number;
    maxToolSteps: number;
    checkpointAgeMs: number | null;
    lastProgressAt: string | null;
    toolStepsSinceProgress: number;
    updateRecommended: boolean;
  };
};

export type WorkstreamBoard = {
  generatedAt: string;
  activeCount: number;
  connectedSources: number;
  workingCount: number;
  waitingCount: number;
  attentionCount: number;
  streams: MonitorWorkstream[];
};

type OwnerSeed = Partial<PlannerContinuationOwner> & {
  ownerId: string;
};

function ownerSeeds(snapshot: RuntimeSnapshot | null, tasks: Row[]): OwnerSeed[] {
  const map = new Map<string, OwnerSeed>();
  for (const owner of snapshot?.mcp.continuation?.owners ?? []) {
    map.set(owner.ownerId, owner);
  }

  const latestActive = snapshot?.mcp.continuation?.latestActive;
  if (latestActive && !map.has(latestActive.ownerId)) {
    map.set(latestActive.ownerId, latestActive);
  }

  for (const session of snapshot?.mcp.sessions ?? []) {
    if (!session.runtimeSessionId) continue;
    const existing = map.get(session.runtimeSessionId);
    map.set(session.runtimeSessionId, {
      ...(existing ?? { ownerId: session.runtimeSessionId }),
      ownerId: session.runtimeSessionId,
      clientKind: existing?.clientKind ?? session.clientKind ?? null,
      clientLabel: existing?.clientLabel ?? session.clientLabel ?? null,
      ownerSource: existing?.ownerSource ?? session.ownerSource,
      plannerConnected: true,
      connectedTransportCount:
        existing?.connectedTransportCount ??
        snapshot!.mcp.sessions.filter(
          (candidate) =>
            candidate.runtimeSessionId === session.runtimeSessionId,
        ).length,
      lastTransportSeenAt:
        existing?.lastTransportSeenAt ?? session.lastSeenAt,
      updatedAt: existing?.updatedAt ?? session.lastSeenAt,
    });
  }

  for (const task of tasks) {
    const ownerId =
      typeof task.ownerSessionId === "string" ? task.ownerSessionId : null;
    if (!ownerId || map.has(ownerId)) continue;
    map.set(ownerId, {
      ownerId,
      clientKind: ownerId.startsWith("owl-owner:") ? "chatgpt" : "agent",
      clientLabel: null,
      ownerSource: "runtime-task",
      plannerConnected: false,
      connectedTransportCount: 0,
      lastTransportSeenAt: null,
      lastDisconnectedAt: null,
      checkpoint: null,
      updatedAt: task.updatedAt ?? task.createdAt ?? null,
    });
  }

  return [...map.values()];
}

function taskBelongsToOwner(task: Row, owner: OwnerSeed): boolean {
  if (task.ownerSessionId === owner.ownerId) return true;
  const checkpoint = owner.checkpoint;
  if (!checkpoint) return false;
  if (checkpoint.taskIds?.includes(String(task.id))) return true;
  const taskOrchestrationId =
    task.orchestration?.orchestrationId ??
    task.orchestration?.orchestration_id ??
    null;
  return Boolean(
    checkpoint.orchestrationId &&
      taskOrchestrationId === checkpoint.orchestrationId,
  );
}

function requestBelongsToOwner(request: AgentRequest, ownerId: string): boolean {
  return request.claim?.ownerId === ownerId;
}

function cloudCommandForTasks(
  command: CloudBridgeCommandRecord,
  taskIds: Set<string>,
): boolean {
  return Boolean(command.runtimeTaskId && taskIds.has(command.runtimeTaskId));
}

function cloudCommandSource(command: CloudBridgeCommandRecord): string {
  const origin = command.origin;
  if (!origin) return "OWL Cloud";
  if (origin.label?.trim()) return origin.label.trim();
  switch (origin.kind) {
    case "worker":
      return origin.id ? `Worker · ${short(origin.id, 6)}` : "Worker";
    case "chatgpt":
      return origin.id ? `ChatGPT · ${short(origin.id, 6)}` : "ChatGPT";
    case "user":
      return "User via Cloud";
    case "agent":
      return origin.id ? `Agent · ${short(origin.id, 6)}` : "Agent";
    case "cloud":
    default:
      return "OWL Cloud";
  }
}

function streamStatus(
  connected: boolean,
  checkpointStatus: string | null,
  tasks: WorkstreamTask[],
): MonitorWorkstream["status"] {
  const liveTasks = tasks.filter(projectedTaskIsLive);
  if (
    liveTasks.some((task) =>
      ["failed", "blocked", "needs_review"].includes(task.status),
    )
  ) {
    return "attention";
  }
  if (liveTasks.some((task) => task.status === "running")) return "working";
  if (
    liveTasks.some((task) =>
      ["pending", "waiting_approval", "paused"].includes(task.status),
    ) ||
    (checkpointStatus && WAITING_CHECKPOINT_STATES.has(checkpointStatus))
  ) {
    return "waiting";
  }
  if (checkpointStatus === "active") return connected ? "working" : "disconnected";
  return connected ? "idle" : "disconnected";
}

export function buildWorkstreamBoard({
  snapshot,
  agentRequests,
  now = Date.now(),
}: {
  snapshot: RuntimeSnapshot | null;
  agentRequests: AgentRequest[];
  now?: number;
}): WorkstreamBoard {
  const taskRows = rows(snapshot?.tasks, ["tasks", "items"]);
  const owners = ownerSeeds(snapshot, taskRows).filter((owner) => {
    const workstream = owner.workstream ?? null;
    const explicitDurableWorkstream =
      Boolean(workstream) &&
      workstream?.implicit !== true &&
      workstream?.status !== "completed";
    const hasPlannerCheckpoint =
      Boolean(owner.checkpoint) && owner.checkpoint?.status !== "completed";
    const hasPlannerHandoff = Boolean(owner.latestHandoffId);
    const hasActiveRuntimeTask = taskRows.some(
      (task) =>
        taskBelongsToOwner(task, owner) && runtimeTaskIsLive(task),
    );

    // A transport-scoped implicit workstream is compatibility plumbing, not a
    // user-level workstream. It remains visible in Real Traffic / topology,
    // but only durable planner/work evidence promotes it into LIVE WORKSTREAMS.
    return (
      explicitDurableWorkstream ||
      hasPlannerCheckpoint ||
      hasPlannerHandoff ||
      hasActiveRuntimeTask
    );
  });
  const progressIntervalMs =
    snapshot?.mcp.continuation?.progressPolicy?.recommendedUpdateIntervalMs ??
    15_000;
  const maxToolSteps =
    snapshot?.mcp.continuation?.progressPolicy
      ?.recommendedMaxToolStepsWithoutUpdate ?? 3;

  const streams = owners
    .map((owner): MonitorWorkstream => {
      const ownerTasks = taskRows
        .filter((task) => taskBelongsToOwner(task, owner))
        .sort(
          (a, b) =>
            timestamp(b.updatedAt ?? b.progress?.lastMeaningfulAt) -
            timestamp(a.updatedAt ?? a.progress?.lastMeaningfulAt),
        )
        .map((task): WorkstreamTask => ({
          id: String(task.id),
          label: String(task.label ?? task.id ?? "Task"),
          status: runtimeTaskStatus(task),
          terminal: task.progress?.terminal === true,
          progressPercent: taskProgress(task),
          current:
            typeof task.progress?.message === "string"
              ? task.progress.message
              : null,
          updatedAt:
            task.updatedAt ?? task.progress?.lastMeaningfulAt ?? null,
          actionCount: Math.max(
            0,
            Number(task.counts?.total ?? task.progress?.counts?.total ?? 0),
          ),
          succeededActions: Math.max(
            0,
            Number(
              task.counts?.succeeded ??
                task.progress?.counts?.succeeded ??
                0,
            ),
          ),
          failedActions: Math.max(
            0,
            Number(task.counts?.failed ?? task.progress?.counts?.failed ?? 0),
          ),
          needsReviewActions: Math.max(
            0,
            Number(
              task.counts?.needsReview ??
                task.progress?.counts?.needsReview ??
                0,
            ),
          ),
          actions: Array.isArray(task.steps)
            ? task.steps.slice(0, 100).map((step: any) => ({
                action: String(step.action ?? step.id ?? "unknown"),
                state: String(step.state ?? "unknown"),
              }))
            : [],
        }));

      const taskIds = new Set(ownerTasks.map((task) => task.id));
      const requests = agentRequests
        .filter((request) => requestBelongsToOwner(request, owner.ownerId))
        .sort((a, b) => timestamp(a.createdAt) - timestamp(b.createdAt));
      const commands = (snapshot?.cloud.commands ?? [])
        .filter((command) => cloudCommandForTasks(command, taskIds))
        .sort((a, b) => timestamp(a.receivedAt) - timestamp(b.receivedAt));

      const workstream = owner.workstream ?? null;
      const label =
        workstream?.clientLabel?.trim() ||
        workstream?.label?.trim() ||
        clientLabel(owner);
      const checkpoint = owner.checkpoint ?? null;
      const messages: WorkstreamMessage[] = [];

      if (checkpoint) {
        messages.push({
          id: `${owner.ownerId}:intent:${checkpoint.revision}`,
          at: checkpoint.createdAt,
          from: "User / caller",
          to: label,
          kind: "intent",
          summary: checkpoint.goal,
          tone: "neutral",
        });
      }

      for (const event of workstream?.progressEvents ?? []) {
        const completed =
          event.completed.length > 0
            ? `Completed: ${event.completed.join(" · ")}`
            : null;
        const current = event.current ? `Now: ${event.current}` : null;
        const next =
          event.nextActions.length > 0
            ? `Next: ${event.nextActions.join(" · ")}`
            : null;
        messages.push({
          id: event.eventId,
          at: event.at,
          from: label,
          to: "User",
          kind: "progress",
          summary:
            (event.summary ??
              [completed, current, next].filter(Boolean).join(" · ")) ||
            "Progress updated",
          tone:
            event.status === "waiting_user"
              ? "attention"
              : event.status === "active"
                ? "active"
                : "waiting",
        });
      }

      for (const task of ownerTasks.slice().reverse()) {
        messages.push({
          id: `${owner.ownerId}:dispatch:${task.id}`,
          at: task.updatedAt,
          from: label,
          to: "OWL Runtime",
          kind: "dispatch",
          summary: task.label,
          tone:
            task.status === "running"
              ? "active"
              : ["failed", "blocked", "needs_review"].includes(task.status)
                ? "attention"
                : task.status === "completed"
                  ? "healthy"
                  : "waiting",
        });
        if (task.current) {
          messages.push({
            id: `${owner.ownerId}:status:${task.id}`,
            at: task.updatedAt,
            from: "OWL Runtime",
            to: label,
            kind: "status",
            summary: task.current,
            tone:
              task.status === "completed"
                ? "healthy"
                : ["failed", "blocked", "needs_review"].includes(task.status)
                  ? "attention"
                  : "active",
          });
        }
      }

      for (const request of requests) {
        const producer =
          request.producer === "runtime"
            ? "OWL Runtime"
            : request.producer === "worker"
              ? "Worker"
              : request.producer === "cloud"
                ? "OWL Cloud"
                : "Desktop";
        messages.push({
          id: request.requestId,
          at: request.updatedAt,
          from: producer,
          to: label,
          kind: "request",
          summary: `${request.type} · ${request.reasonCode}`,
          tone:
            request.status === "completed"
              ? "healthy"
              : request.requiresUserConfirmation
                ? "attention"
                : "waiting",
        });
      }

      for (const command of commands) {
        messages.push({
          id: command.commandId,
          at: command.receivedAt,
          from: cloudCommandSource(command),
          to: "Desktop → OWL Runtime",
          kind: "remote",
          summary: `${command.kind} · ${command.status}`,
          tone:
            command.status === "accepted"
              ? "healthy"
              : command.status === "processing"
                ? "active"
                : command.status === "uncertain"
                  ? "attention"
                  : "waiting",
        });
      }

      messages.sort((a, b) => timestamp(b.at) - timestamp(a.at));

      const activeTask =
        ownerTasks.find(
          (task) => task.status === "running" && projectedTaskIsLive(task),
        ) ??
        ownerTasks.find(projectedTaskIsLive) ??
        null;
      const checkpointStatus =
        workstream?.status ?? checkpoint?.status ?? null;
      const connected = owner.plannerConnected === true;
      const status = streamStatus(connected, checkpointStatus, ownerTasks);
      const checkpointTime = checkpoint?.updatedAt
        ? timestamp(checkpoint.updatedAt)
        : 0;
      const checkpointAgeMs =
        checkpointTime > 0 ? Math.max(0, now - checkpointTime) : null;
      const lastProgressAt =
        workstream?.lastProgressAt ??
        workstream?.createdAt ??
        checkpoint?.updatedAt ??
        null;
      const lastProgressTime = timestamp(lastProgressAt);
      const progressAgeMs =
        lastProgressTime > 0 ? Math.max(0, now - lastProgressTime) : null;
      const toolStepsSinceProgress = Number(
        workstream?.toolStepsSinceProgress ?? 0,
      );

      let currentExecutor = label;
      let currentAction =
        workstream?.progressEvents?.at(-1)?.current ??
        checkpoint?.phase ??
        "Waiting";
      if (activeTask && ACTIVE_TASK_STATES.has(activeTask.status)) {
        currentExecutor = "OWL Runtime";
        currentAction = activeTask.current ?? activeTask.label;
      } else if (WAITING_CHECKPOINT_STATES.has(checkpointStatus ?? "")) {
        currentExecutor =
          checkpointStatus === "waiting_user"
            ? "User"
            : checkpointStatus === "waiting_runtime"
              ? "OWL Runtime"
              : "External dependency";
        currentAction = checkpoint?.phase ?? checkpointStatus!.replaceAll("_", " ");
      }

      return {
        id: owner.ownerId,
        ownerId: owner.ownerId,
        sourceKind: sourceRole(owner.clientKind ?? null),
        sourceLabel: label,
        connected,
        transportCount: owner.connectedTransportCount ?? 0,
        status,
        isCurrent:
          connected ||
          Boolean(workstream && workstream.status !== "completed") ||
          ownerTasks.some(projectedTaskIsLive),
        goal:
          workstream?.goal ??
          checkpoint?.goal ??
          activeTask?.label ??
          "Connected session — no planner checkpoint yet",
        phase:
          workstream?.progressEvents?.at(-1)?.current ??
          checkpoint?.phase ??
          null,
        summary:
          workstream?.progressEvents?.at(-1)?.summary ??
          checkpoint?.summary ??
          null,
        updatedAt:
          checkpoint?.updatedAt ??
          activeTask?.updatedAt ??
          owner.lastTransportSeenAt ??
          owner.updatedAt ??
          null,
        orchestrationId: checkpoint?.orchestrationId ?? null,
        latestHandoffId: owner.latestHandoffId ?? null,
        continuity: owner.continuity ?? null,
        currentExecutor,
        currentAction,
        tasks: ownerTasks,
        messages: messages.slice(0, 6),
        nextActions:
          workstream?.progressEvents?.at(-1)?.nextActions?.slice(0, 6) ??
          checkpoint?.nextActions?.slice(0, 6) ??
          [],
        toolStats: {
          totalToolSteps: Number(workstream?.totalToolSteps ?? 0),
          recentTools: Array.isArray(workstream?.recentTools)
            ? workstream.recentTools.slice(-24).map((item: any) => ({
                at: typeof item.at === "string" ? item.at : null,
                tool: String(item.tool ?? "unknown"),
                outcome: item.outcome === "error" ? "error" : "success",
                durationMs: Math.max(0, Number(item.durationMs ?? 0)),
              }))
            : [],
        },
        progressPolicy: {
          intervalMs: progressIntervalMs,
          maxToolSteps,
          checkpointAgeMs,
          lastProgressAt,
          toolStepsSinceProgress,
          updateRecommended:
            status === "working" &&
            ((progressAgeMs !== null && progressAgeMs >= progressIntervalMs) ||
              toolStepsSinceProgress >= maxToolSteps),
        },
      };
    })
    .filter((stream) => {
      const updated = timestamp(stream.updatedAt);
      const recent = updated > 0 && now - updated <= 5 * 60_000;
      return stream.isCurrent || recent;
    });

  const claimedRequestIds = new Set(
    streams.flatMap((stream) =>
      agentRequests
        .filter((request) => request.claim?.ownerId === stream.ownerId)
        .map((request) => request.requestId),
    ),
  );
  const unclaimedRequests = agentRequests.filter(
    (request) =>
      ["pending", "claimed"].includes(request.status) &&
      !claimedRequestIds.has(request.requestId),
  );
  if (unclaimedRequests.length > 0) {
    streams.push({
      id: "agent-inbox",
      ownerId: "agent-inbox",
      sourceKind: "Inbox",
      sourceLabel: "Agent Inbox",
      connected: true,
      transportCount: 0,
      status: unclaimedRequests.some((request) => request.requiresUserConfirmation)
        ? "attention"
        : "waiting",
      isCurrent: true,
      goal: `${unclaimedRequests.length} request${unclaimedRequests.length === 1 ? "" : "s"} waiting for an agent`,
      phase: "Coordination",
      summary: null,
      updatedAt: unclaimedRequests
        .map((request) => request.updatedAt)
        .sort()
        .at(-1) ?? null,
      orchestrationId: null,
      latestHandoffId: null,
      continuity: null,
      currentExecutor: "Agent Inbox",
      currentAction: "Waiting for claim",
      tasks: [],
      messages: unclaimedRequests.slice(0, 6).map((request) => ({
        id: request.requestId,
        at: request.updatedAt,
        from:
          request.producer === "runtime"
            ? "OWL Runtime"
            : request.producer === "worker"
              ? "Worker"
              : request.producer === "cloud"
                ? "OWL Cloud"
                : "Desktop",
        to: "Available agent",
        kind: "request" as const,
        summary: `${request.type} · ${request.reasonCode}`,
        tone: request.requiresUserConfirmation
          ? ("attention" as const)
          : ("waiting" as const),
      })),
      nextActions: ["Claim a relevant request when an agent is available"],
      toolStats: { totalToolSteps: 0, recentTools: [] },
      progressPolicy: {
        intervalMs: progressIntervalMs,
        maxToolSteps,
        checkpointAgeMs: null,
        lastProgressAt: null,
        toolStepsSinceProgress: 0,
        updateRecommended: false,
      },
    });
  }

  const mappedCommandIds = new Set(
    streams.flatMap((stream) =>
      stream.messages
        .filter((message) => message.kind === "remote")
        .map((message) => message.id),
    ),
  );
  const unmatchedCommands = (snapshot?.cloud.commands ?? []).filter(
    (command) =>
      ["processing", "uncertain"].includes(command.status) &&
      !mappedCommandIds.has(command.commandId),
  );
  for (const command of unmatchedCommands) {
    const sourceLabel = cloudCommandSource(command);
    const sourceKind =
      command.origin?.kind === "worker"
        ? "Worker"
        : command.origin?.kind === "chatgpt"
          ? "ChatGPT"
          : command.origin?.kind === "agent"
            ? "Agent"
            : "Cloud";
    streams.push({
      id: `cloud-command:${command.commandId}`,
      ownerId: `cloud-command:${command.commandId}`,
      sourceKind,
      sourceLabel,
      connected: snapshot?.cloud.status === "connected",
      transportCount: 0,
      status: command.status === "uncertain" ? "attention" : "working",
      isCurrent: true,
      goal: `Remote command · ${command.kind}`,
      phase: "Cloud → Desktop → Runtime",
      summary: null,
      updatedAt: command.updatedAt,
      orchestrationId: null,
      latestHandoffId: null,
      continuity: null,
      currentExecutor: "Desktop",
      currentAction:
        command.status === "uncertain"
          ? "Reconciling uncertain command"
          : "Routing remote command",
      tasks: [],
      messages: [
        {
          id: command.commandId,
          at: command.receivedAt,
          from: sourceLabel,
          to: "Desktop → OWL Runtime",
          kind: "remote" as const,
          summary: `${command.kind} · ${command.status}`,
          tone:
            command.status === "uncertain"
              ? ("attention" as const)
              : ("active" as const),
        },
      ],
      nextActions: [
        command.status === "uncertain"
          ? "Reconcile uncertain command before replay"
          : "Wait for Runtime acceptance",
      ],
      toolStats: { totalToolSteps: 0, recentTools: [] },
      progressPolicy: {
        intervalMs: progressIntervalMs,
        maxToolSteps,
        checkpointAgeMs: null,
        lastProgressAt: null,
        toolStepsSinceProgress: 0,
        updateRecommended: false,
      },
    });
  }

  streams.sort((a, b) => {
    const rank = (status: MonitorWorkstream["status"]) =>
      status === "attention"
        ? 5
        : status === "working"
          ? 4
          : status === "waiting"
            ? 3
            : status === "idle"
              ? 2
              : 1;
    return rank(b.status) - rank(a.status) || timestamp(b.updatedAt) - timestamp(a.updatedAt);
  });

  return {
    generatedAt: new Date(now).toISOString(),
    activeCount: streams.filter((stream) =>
      ["working", "waiting", "attention"].includes(stream.status),
    ).length,
    connectedSources: streams.filter((stream) => stream.connected).length,
    workingCount: streams.filter((stream) => stream.status === "working").length,
    waitingCount: streams.filter((stream) => stream.status === "waiting").length,
    attentionCount: streams.filter((stream) => stream.status === "attention").length,
    streams: streams.slice(0, 12),
  };
}
