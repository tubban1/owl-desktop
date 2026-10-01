import type {
  ActivityEntry,
  AgentRequest,
  RuntimeSnapshot,
  SkillManagerSnapshot,
} from "../types";
import type { MonitorModel } from "./monitorModel";

type Row = Record<string, any>;

const ACTIVE_TASK_STATES = new Set([
  "pending",
  "running",
  "waiting_approval",
  "blocked",
  "paused",
  "needs_review",
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

function num(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function timestamp(value: unknown): number {
  if (typeof value !== "string") return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function statusTone(status: string) {
  if (["completed", "succeeded", "verified", "healthy"].includes(status)) {
    return "healthy" as const;
  }
  if (
    ["failed", "blocked", "needs_review", "uncertain", "error"].includes(status)
  ) {
    return "attention" as const;
  }
  if (["running", "claimed", "processing"].includes(status)) {
    return "active" as const;
  }
  if (["waiting_approval", "pending", "queued", "paused"].includes(status)) {
    return "waiting" as const;
  }
  return "neutral" as const;
}

export type OrchestrationActor = {
  id: string;
  label: string;
  role: string;
  action: string;
  detail: string;
  status: string;
  tone: "healthy" | "attention" | "active" | "waiting" | "neutral";
  progressPercent: number | null;
};

export type OrchestrationMilestone = {
  id: string;
  at: string | null;
  title: string;
  detail: string;
  source: string;
  status: string;
  tone: "healthy" | "attention" | "active" | "waiting" | "neutral";
  stepId?: string | null;
};

export type OrchestrationGraphNode = {
  id: string;
  label: string;
  detail: string;
  status: string;
  tone: "healthy" | "attention" | "active" | "waiting" | "neutral";
  level: number;
  order: number;
  dependsOn: string[];
  durationMs: number | null;
  verificationStatus: string | null;
};

export type OrchestrationGraphEdge = {
  from: string;
  to: string;
};

export type OrchestrationTaskInspector = {
  id: string;
  label: string;
  status: string;
  owner: string;
  createdAt: string | null;
  updatedAt: string | null;
  currentAction: string;
  currentDetail: string;
  progressPercent: number | null;
  stepCounts: {
    total: number;
    pending: number;
    running: number;
    waitingApproval: number;
    succeeded: number;
    failed: number;
    needsReview: number;
  };
  verification: {
    required: number;
    receipts: number;
    verified: number;
    failed: number;
    uncertain: number;
    missing: number;
  };
  memory: {
    eventCount: number;
    stagedArtifacts: number;
    workingOutputs: number;
  };
  nextStep: string | null;
};

export type OrchestrationModel = {
  headline: {
    label: string;
    detail: string;
    overallPercent: number;
    running: number;
    waiting: number;
    completedSteps: number;
    totalSteps: number;
    status: string;
  };
  workset: {
    orchestrationId: string;
    label: string;
    taskCount: number;
    tasks: Array<{
      id: string;
      label: string;
      status: string;
      progressPercent: number | null;
      parentTaskId: string | null;
    }>;
  } | null;
  focusTaskId: string | null;
  taskChoices: Array<{
    id: string;
    label: string;
    status: string;
    updatedAt: string | null;
  }>;
  actors: OrchestrationActor[];
  milestones: OrchestrationMilestone[];
  graph: {
    nodes: OrchestrationGraphNode[];
    edges: OrchestrationGraphEdge[];
    criticalPathNodeIds: string[];
  };
  inspector: OrchestrationTaskInspector | null;
  system: MonitorModel;
};

function taskProgressPercent(task: Row | null | undefined): number | null {
  if (!task) return null;
  const counts = task.counts ?? task.progress?.counts ?? {};
  const total = num(counts.total);
  const succeeded = num(counts.succeeded);
  if (total <= 0) return null;
  return Math.round((succeeded / total) * 100);
}

function chooseFocusTask(tasks: Row[], selectedTaskId?: string | null): Row | null {
  if (selectedTaskId) {
    const selected = tasks.find((task) => task.id === selectedTaskId);
    if (selected) return selected;
  }
  return (
    [...tasks]
      .sort((a, b) => {
        const activeDelta =
          Number(ACTIVE_TASK_STATES.has(String(b.status))) -
          Number(ACTIVE_TASK_STATES.has(String(a.status)));
        if (activeDelta !== 0) return activeDelta;
        return timestamp(b.updatedAt) - timestamp(a.updatedAt);
      })[0] ?? null
  );
}

function buildActors(input: {
  snapshot: RuntimeSnapshot | null;
  task: Row | null;
  detail: Row | null;
  skillSnapshot: SkillManagerSnapshot | null;
  agentRequests: AgentRequest[];
}): OrchestrationActor[] {
  const { snapshot, task, detail, skillSnapshot, agentRequests } = input;
  const actors: OrchestrationActor[] = [];

  if (task) {
    const owner = String(detail?.ownerSessionId ?? task.ownerSessionId ?? "");
    actors.push({
      id: "agent-session",
      label: "Agent session",
      role: "Coordinator / owner",
      action:
        ACTIVE_TASK_STATES.has(String(task.status))
          ? "Owns " + String(task.label ?? task.id)
          : "Last owned " + String(task.label ?? task.id),
      detail: owner
        ? "Stable owner " + (owner.length > 34 ? owner.slice(0, 31) + "…" : owner)
        : "Task owner is not exposed in the lightweight summary.",
      status: String(task.status ?? "unknown"),
      tone: statusTone(String(task.status ?? "unknown")),
      progressPercent: taskProgressPercent(task),
    });
  }

  const detailSteps: Row[] = Array.isArray(detail?.steps) ? detail.steps : [];
  const activeStep =
    detailSteps.find((step) => step.state === "running") ??
    detailSteps.find((step) => step.state === "waiting_approval") ??
    detailSteps.find((step) => step.state === "needs_review") ??
    null;

  actors.push({
    id: "runtime",
    label: "OWL Runtime",
    role: "Execution authority",
    action: activeStep
      ? String(activeStep.action ?? activeStep.primitive ?? activeStep.id)
      : task
        ? String(task.progress?.message ?? "Task " + String(task.status))
        : "Ready for durable work",
    detail: task
      ? String(task.label ?? task.id) +
        " · " +
        num(task.counts?.succeeded ?? task.progress?.counts?.succeeded) +
        "/" +
        num(task.counts?.total ?? task.progress?.counts?.total) +
        " steps"
      : "No retained Task is available.",
    status: String(activeStep?.state ?? task?.status ?? "idle"),
    tone: statusTone(String(activeStep?.state ?? task?.status ?? "idle")),
    progressPercent: taskProgressPercent(task),
  });

  const eventStatus = snapshot?.runtimeEvents?.status ?? "stopped";
  actors.push({
    id: "desktop",
    label: "Desktop",
    role: "Observer / control surface",
    action:
      eventStatus === "healthy"
        ? "Projecting Runtime state"
        : "Runtime event projection needs attention",
    detail:
      eventStatus === "healthy"
        ? "RuntimeEvent cursor " +
          String(snapshot?.runtimeEvents?.consumer.lastSequence ?? "—")
        : snapshot?.runtimeEvents?.lastErrorMessage ??
          eventStatus.replaceAll("_", " "),
    status: eventStatus,
    tone:
      eventStatus === "healthy"
        ? "healthy"
        : eventStatus === "needs_attention" || eventStatus === "degraded"
          ? "attention"
          : "neutral",
    progressPercent: null,
  });

  const openRequests = agentRequests.filter((request) =>
    ["pending", "claimed"].includes(request.status),
  );
  if (openRequests.length > 0) {
    const request = [...openRequests].sort(
      (a, b) => timestamp(b.updatedAt) - timestamp(a.updatedAt),
    )[0];
    actors.push({
      id: "agent-request",
      label: "AgentRequest",
      role: "Coordination",
      action:
        request.status === "claimed"
          ? "Claimed " + request.type
          : "Waiting for " + request.type,
      detail:
        request.reasonCode +
        " · " +
        request.subject.kind +
        ":" +
        request.subject.id,
      status: request.status,
      tone: statusTone(request.status),
      progressPercent: null,
    });
  }

  const activeCandidates =
    skillSnapshot?.candidates.filter((candidate) => candidate.status === "active") ??
    [];
  if (activeCandidates.length > 0) {
    const invalid = activeCandidates.filter(
      (candidate) => candidate.validation?.valid === false,
    ).length;
    actors.push({
      id: "skills",
      label: "Skills",
      role: "Governed lifecycle",
      action:
        invalid > 0
          ? String(invalid) +
            " candidate" +
            (invalid === 1 ? "" : "s") +
            " need repair"
          : String(activeCandidates.length) +
            " candidate" +
            (activeCandidates.length === 1 ? "" : "s") +
            " under review",
      detail:
        String(skillSnapshot?.summary.ready ?? 0) +
        " ready · " +
        String(skillSnapshot?.summary.installed ?? 0) +
        " installed",
      status: invalid > 0 ? "needs_review" : "running",
      tone: invalid > 0 ? "attention" : "active",
      progressPercent: null,
    });
  }

  const cloudStatus = snapshot?.cloud.status ?? "stopped";
  if (cloudStatus !== "stopped" || snapshot?.cloud.commandCounts.processing) {
    actors.push({
      id: "cloud",
      label: "Cloud",
      role: "Remote coordination",
      action:
        (snapshot?.cloud.commandCounts.processing ?? 0) > 0
          ? String(snapshot?.cloud.commandCounts.processing) +
            " remote command(s) processing"
          : cloudStatus === "connected"
            ? "Connected and waiting"
            : "Cloud " + cloudStatus.replaceAll("_", " "),
      detail:
        String(snapshot?.cloud.commandCounts.accepted ?? 0) +
        " accepted · " +
        String(snapshot?.cloud.commandCounts.uncertain ?? 0) +
        " uncertain",
      status:
        (snapshot?.cloud.commandCounts.uncertain ?? 0) > 0
          ? "uncertain"
          : cloudStatus,
      tone:
        (snapshot?.cloud.commandCounts.uncertain ?? 0) > 0
          ? "attention"
          : cloudStatus === "connected"
            ? "healthy"
            : "waiting",
      progressPercent: null,
    });
  }

  return actors;
}

function eventTitle(type: string, fallback: string): string {
  const labels: Record<string, string> = {
    task_created: "Task created",
    staging_initialized: "Staging initialized",
    run_started: "Run started",
    step_started: "Step started",
    step_verified: "Postcondition verified",
    step_verification_failed: "Verification failed",
    step_verification_uncertain: "Verification uncertain",
    step_waiting_approval: "Waiting for approval",
    approval_granted: "Approval granted",
    approval_denied: "Approval denied",
    step_succeeded: "Step completed",
    step_failed: "Step failed",
    task_completed: "Task completed",
    task_failed: "Task failed",
    task_cancelled: "Task cancelled",
    task_paused: "Task paused",
    task_resumed: "Task resumed",
    wave_completed: "Execution wave completed",
    global_episode_indexed: "Experience indexed",
  };
  return labels[type] ?? fallback;
}

function buildMilestones(
  detail: Row | null,
  agentRequests: AgentRequest[],
): OrchestrationMilestone[] {
  const events = Array.isArray(detail?.events) ? detail.events : [];
  const taskMilestones: OrchestrationMilestone[] = events.map(
    (event: Row, index: number) => {
      const type = String(event.type ?? "runtime_event");
      let status = "neutral";
      if (/failed|denied/.test(type)) status = "failed";
      else if (/uncertain|review/.test(type)) status = "uncertain";
      else if (/waiting|paused/.test(type)) status = "waiting_approval";
      else if (/started/.test(type)) status = "running";
      else if (/verified|succeeded|completed|indexed/.test(type)) {
        status = "completed";
      }
      return {
        id:
          "task-event:" +
          String(index) +
          ":" +
          String(event.at ?? ""),
        at: typeof event.at === "string" ? event.at : null,
        title: eventTitle(type, type.replaceAll("_", " ")),
        detail: String(event.message ?? ""),
        source: event.stepId ? "Runtime · " + String(event.stepId) : "Runtime",
        status,
        tone: statusTone(status),
        stepId: typeof event.stepId === "string" ? event.stepId : null,
      };
    },
  );

  const requestMilestones: OrchestrationMilestone[] = [];
  for (const request of agentRequests) {
    requestMilestones.push({
      id: "request-created:" + request.requestId,
      at: request.createdAt,
      title: "AgentRequest proposed",
      detail: request.type + " · " + request.reasonCode,
      source: request.producer,
      status: "pending",
      tone: "waiting",
    });
    if (request.claim?.claimedAt) {
      requestMilestones.push({
        id: "request-claimed:" + request.requestId,
        at: request.claim.claimedAt,
        title: "AgentRequest claimed",
        detail: request.type,
        source: request.claim.ownerId,
        status: "claimed",
        tone: "active",
      });
    }
    if (request.resolution?.completedAt) {
      requestMilestones.push({
        id: "request-resolved:" + request.requestId,
        at: request.resolution.completedAt,
        title:
          request.status === "cancelled"
            ? "AgentRequest cancelled"
            : "AgentRequest completed",
        detail: request.resolution.outcome,
        source: "Agent Inbox",
        status: request.status,
        tone: statusTone(request.status),
      });
    }
  }

  return [...taskMilestones, ...requestMilestones]
    .sort((a, b) => timestamp(a.at) - timestamp(b.at))
    .slice(-80);
}

function buildGraph(detail: Row | null) {
  const steps: Row[] = Array.isArray(detail?.steps) ? detail.steps : [];
  const byId = new Map(steps.map((step) => [String(step.id), step]));
  const levelMemo = new Map<string, number>();
  const visiting = new Set<string>();

  const levelOf = (id: string): number => {
    if (levelMemo.has(id)) return levelMemo.get(id)!;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const step = byId.get(id);
    const dependencies = Array.isArray(step?.dependsOn)
      ? step.dependsOn.map(String).filter((dep: string) => byId.has(dep))
      : [];
    const level =
      dependencies.length === 0
        ? 0
        : 1 + Math.max(...dependencies.map((dep: string) => levelOf(dep)));
    visiting.delete(id);
    levelMemo.set(id, level);
    return level;
  };

  const levelOrder = new Map<number, number>();
  const nodes: OrchestrationGraphNode[] = steps.map((step) => {
    const id = String(step.id);
    const level = levelOf(id);
    const order = levelOrder.get(level) ?? 0;
    levelOrder.set(level, order + 1);
    const verificationStatus =
      typeof step.verification?.status === "string"
        ? step.verification.status
        : step.requiresVerification
          ? "missing"
          : null;
    return {
      id,
      label: String(step.action ?? step.primitive ?? id),
      detail: String(step.id),
      status: String(step.state ?? "pending"),
      tone: statusTone(String(step.state ?? "pending")),
      level,
      order,
      dependsOn: Array.isArray(step.dependsOn)
        ? step.dependsOn.map(String)
        : [],
      durationMs:
        typeof step.durationMs === "number" ? step.durationMs : null,
      verificationStatus,
    };
  });

  const edges = nodes.flatMap((node) =>
    node.dependsOn
      .filter((dependency) => byId.has(dependency))
      .map((dependency) => ({ from: dependency, to: node.id })),
  );

  const pathMemo = new Map<string, string[]>();
  const longestTo = (id: string): string[] => {
    if (pathMemo.has(id)) return pathMemo.get(id)!;
    const node = nodes.find((candidate) => candidate.id === id);
    if (!node || node.dependsOn.length === 0) {
      const path = [id];
      pathMemo.set(id, path);
      return path;
    }
    const candidates = node.dependsOn
      .filter((dependency) => byId.has(dependency))
      .map((dependency) => [...longestTo(dependency), id]);
    const path = candidates.sort((a, b) => b.length - a.length)[0] ?? [id];
    pathMemo.set(id, path);
    return path;
  };
  const criticalPathNodeIds =
    nodes
      .map((node) => longestTo(node.id))
      .sort((a, b) => b.length - a.length)[0] ?? [];

  return { nodes, edges, criticalPathNodeIds };
}

function buildInspector(
  task: Row | null,
  detail: Row | null,
): OrchestrationTaskInspector | null {
  if (!task) return null;
  const source = detail ?? task;
  const counts = source.progress?.counts ?? source.counts ?? {};
  const verification = source.verificationCounts ?? {};
  const steps: Row[] = Array.isArray(detail?.steps) ? detail.steps : [];
  const activeStep =
    steps.find((step) => step.state === "running") ??
    steps.find((step) => step.state === "waiting_approval") ??
    steps.find((step) => step.state === "needs_review") ??
    null;
  const nextStep =
    steps.find((step) => step.state === "pending") ??
    steps.find((step) => step.state === "waiting_approval") ??
    null;

  return {
    id: String(source.id ?? task.id),
    label: String(source.label ?? task.label ?? task.id),
    status: String(source.status ?? task.status ?? "unknown"),
    owner: String(source.ownerSessionId ?? task.ownerSessionId ?? "—"),
    createdAt: typeof source.createdAt === "string" ? source.createdAt : null,
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : null,
    currentAction: activeStep
      ? String(activeStep.action ?? activeStep.primitive ?? activeStep.id)
      : source.progress?.terminal
        ? "Terminal"
        : String(source.progress?.phase ?? source.status ?? "unknown"),
    currentDetail: activeStep
      ? String(activeStep.id) + " · " + String(activeStep.state)
      : String(source.progress?.message ?? ""),
    progressPercent: taskProgressPercent(source),
    stepCounts: {
      total: num(counts.total),
      pending: num(counts.pending),
      running: num(counts.running),
      waitingApproval: num(counts.waitingApproval),
      succeeded: num(counts.succeeded),
      failed: num(counts.failed),
      needsReview: num(counts.needsReview),
    },
    verification: {
      required: num(verification.required),
      receipts: num(verification.receipts),
      verified: num(verification.verified),
      failed: num(verification.failed),
      uncertain: num(verification.uncertain),
      missing: num(verification.missing),
    },
    memory: {
      eventCount: num(source.memoryLayers?.episodic?.eventCount),
      stagedArtifacts: num(
        source.memoryLayers?.staging?.artifactCount ??
          source.staging?.artifactCount,
      ),
      workingOutputs: num(source.memoryLayers?.working?.succeededOutputs),
    },
    nextStep: nextStep
      ? String(nextStep.action ?? nextStep.primitive ?? nextStep.id)
      : null,
  };
}

export function buildOrchestrationModel(input: {
  snapshot: RuntimeSnapshot | null;
  agentRequests: AgentRequest[];
  skillSnapshot: SkillManagerSnapshot | null;
  activity: ActivityEntry[];
  system: MonitorModel;
  selectedTaskId?: string | null;
  taskDetail?: Record<string, unknown> | null;
}): OrchestrationModel {
  const {
    snapshot,
    agentRequests,
    skillSnapshot,
    system,
    selectedTaskId,
    taskDetail,
  } = input;
  const tasks = rows(snapshot?.tasks, ["tasks", "items"]);
  const focusTask = chooseFocusTask(tasks, selectedTaskId);
  const detail =
    taskDetail && focusTask && taskDetail.id === focusTask.id
      ? (taskDetail as Row)
      : null;

  const orchestrationId =
    focusTask && typeof focusTask.orchestration?.orchestrationId === "string"
      ? focusTask.orchestration.orchestrationId
      : null;
  const scope = orchestrationId
    ? tasks.filter(
        (task) => task.orchestration?.orchestrationId === orchestrationId,
      )
    : focusTask
      ? [focusTask]
      : [];
  const orchestrationLabel =
    orchestrationId && typeof focusTask?.orchestration?.label === "string"
      ? focusTask.orchestration.label
      : focusTask
        ? String(focusTask.label ?? focusTask.id)
        : "No durable work selected";
  const totalSteps = scope.reduce(
    (sum, task) =>
      sum + num(task.counts?.total ?? task.progress?.counts?.total),
    0,
  );
  const completedSteps = scope.reduce(
    (sum, task) =>
      sum + num(task.counts?.succeeded ?? task.progress?.counts?.succeeded),
    0,
  );
  const running = scope.reduce(
    (sum, task) =>
      sum + num(task.counts?.running ?? task.progress?.counts?.running),
    0,
  );
  const waiting = scope.reduce(
    (sum, task) =>
      sum +
      num(
        task.counts?.waitingApproval ??
          task.progress?.counts?.waitingApproval,
      ) +
      num(task.counts?.needsReview ?? task.progress?.counts?.needsReview),
    0,
  );
  const overallPercent =
    totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;
  const aggregateStatus = scope.some((task) =>
    ["failed", "blocked", "needs_review"].includes(String(task.status)),
  )
    ? "needs_attention"
    : scope.some((task) => String(task.status) === "running")
      ? "running"
      : scope.some((task) =>
            ["pending", "waiting_approval", "paused"].includes(
              String(task.status),
            ),
          )
        ? "waiting"
        : scope.length > 0 &&
            scope.every((task) => String(task.status) === "completed")
          ? "completed"
          : String(focusTask?.status ?? "idle");

  return {
    headline: {
      label: orchestrationLabel,
      detail: focusTask
        ? orchestrationId
          ? String(scope.length) +
            " durable task" +
            (scope.length === 1 ? "" : "s") +
            " · selected " +
            String(focusTask.label ?? focusTask.id)
          : String(focusTask.status ?? "unknown") +
            " · " +
            String(focusTask.ownerSessionId ?? "unowned")
        : "Runtime is ready for a new Task.",
      overallPercent,
      running,
      waiting,
      completedSteps,
      totalSteps,
      status: aggregateStatus,
    },
    workset: orchestrationId
      ? {
          orchestrationId,
          label: orchestrationLabel,
          taskCount: scope.length,
          tasks: [...scope]
            .sort((a, b) => timestamp(a.createdAt) - timestamp(b.createdAt))
            .map((task) => ({
              id: String(task.id),
              label: String(task.label ?? task.id),
              status: String(task.status ?? "unknown"),
              progressPercent: taskProgressPercent(task),
              parentTaskId:
                typeof task.orchestration?.parentTaskId === "string"
                  ? task.orchestration.parentTaskId
                  : null,
            })),
        }
      : null,
    focusTaskId: focusTask ? String(focusTask.id) : null,
    taskChoices: [...tasks]
      .sort((a, b) => timestamp(b.updatedAt) - timestamp(a.updatedAt))
      .slice(0, 30)
      .map((task) => ({
        id: String(task.id),
        label: String(task.label ?? task.id),
        status: String(task.status ?? "unknown"),
        updatedAt: typeof task.updatedAt === "string" ? task.updatedAt : null,
      })),
    actors: buildActors({
      snapshot,
      task: focusTask,
      detail,
      skillSnapshot,
      agentRequests,
    }),
    milestones: buildMilestones(detail, agentRequests),
    graph: buildGraph(detail),
    inspector: buildInspector(focusTask, detail),
    system,
  };
}
