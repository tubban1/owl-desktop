import type {
  ActivityEntry,
  AgentRequest,
  RuntimeSnapshot,
  SkillManagerSnapshot,
} from "../types";

type Row = Record<string, any>;

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

function countBy<T extends string>(
  values: T[],
  keys: readonly T[],
): Record<T, number> {
  return Object.fromEntries(
    keys.map((key) => [key, values.filter((value) => value === key).length]),
  ) as Record<T, number>;
}

function number(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function newestFirst<T extends { updatedAt?: string; createdAt?: string }>(
  items: T[],
): T[] {
  return [...items].sort((a, b) => {
    const aTime = Date.parse(a.updatedAt ?? a.createdAt ?? "");
    const bTime = Date.parse(b.updatedAt ?? b.createdAt ?? "");
    return (Number.isFinite(bTime) ? bTime : 0) -
      (Number.isFinite(aTime) ? aTime : 0);
  });
}

export type MonitorHealthState = "healthy" | "attention" | "offline";

export type MonitorModel = {
  generatedAt: string;
  connectivity: Array<{
    id: string;
    label: string;
    state: MonitorHealthState;
    detail: string;
  }>;
  requests: {
    total: number;
    pending: number;
    claimed: number;
    completed: number;
    cancelled: number;
    needsConfirmation: number;
    highPriorityOpen: number;
  };
  tasks: {
    total: number;
    active: number;
    running: number;
    waitingApproval: number;
    completed: number;
    failed: number;
    needsReview: number;
    totalSteps: number;
    succeededSteps: number;
    runningSteps: number;
  };
  verification: {
    required: number;
    receipts: number;
    verified: number;
    failed: number;
    uncertain: number;
    missing: number;
  };
  processes: {
    total: number;
    running: number;
    succeeded: number;
    failed: number;
    recovered: number;
  };
  skills: {
    installed: number;
    ready: number;
    disabled: number;
    needsAttention: number;
    activeCandidates: number;
    invalidCandidates: number;
    installedUserSkills: number;
    registrySupported: boolean;
    discoverySupported: boolean;
  };
  cloud: {
    connected: boolean;
    processing: number;
    accepted: number;
    rejected: number;
    uncertain: number;
    outboxPending: number;
  };
  activity: {
    total: number;
    info: number;
    warn: number;
    error: number;
    bySource: Array<{ source: string; count: number }>;
  };
  attention: Array<{
    id: string;
    severity: "warning" | "error";
    title: string;
    detail: string;
  }>;
  recentTasks: Array<{
    id: string;
    label: string;
    status: string;
    updatedAt: string | null;
    progressPercent: number | null;
    message: string | null;
  }>;
};

export function buildMonitorModel({
  snapshot,
  agentRequests,
  skillSnapshot,
  activity,
  now = Date.now(),
}: {
  snapshot: RuntimeSnapshot | null;
  agentRequests: AgentRequest[];
  skillSnapshot: SkillManagerSnapshot | null;
  activity: ActivityEntry[];
  now?: number;
}): MonitorModel {
  const taskRows = rows(snapshot?.tasks, ["tasks", "items"]);
  const processRows = rows(snapshot?.processes, ["processes", "items"]);

  const requestCounts = countBy(
    agentRequests.map((request) => request.status),
    ["pending", "claimed", "completed", "cancelled"] as const,
  );

  let running = 0;
  let waitingApproval = 0;
  let completed = 0;
  let failed = 0;
  let needsReview = 0;
  let totalSteps = 0;
  let succeededSteps = 0;
  let runningSteps = 0;
  let verificationRequired = 0;
  let verificationReceipts = 0;
  let verificationVerified = 0;
  let verificationFailed = 0;
  let verificationUncertain = 0;
  let verificationMissing = 0;

  for (const task of taskRows) {
    const counts = task.counts ?? task.progress?.counts ?? {};
    totalSteps += number(counts.total);
    succeededSteps += number(counts.succeeded);
    runningSteps += number(counts.running);
    const verificationCounts = task.verificationCounts ?? {};
    verificationRequired += number(verificationCounts.required);
    verificationReceipts += number(verificationCounts.receipts);
    verificationVerified += number(verificationCounts.verified);
    verificationFailed += number(verificationCounts.failed);
    verificationUncertain += number(verificationCounts.uncertain);
    verificationMissing += number(verificationCounts.missing);
    if (
      task.status === "running" ||
      task.progress?.phase === "executing" ||
      number(counts.running) > 0
    ) {
      running += 1;
    }
    if (
      task.status === "waiting_approval" ||
      number(counts.waitingApproval) > 0
    ) {
      waitingApproval += 1;
    }
    if (task.status === "completed") completed += 1;
    if (task.status === "failed" || number(counts.failed) > 0) failed += 1;
    if (
      task.status === "needs_review" ||
      number(counts.needsReview) > 0
    ) {
      needsReview += 1;
    }
  }

  const active =
    taskRows.filter((task) =>
      [
        "pending",
        "running",
        "waiting_approval",
        "blocked",
        "paused",
        "needs_review",
      ].includes(String(task.status)),
    ).length;

  const runningProcesses = processRows.filter(
    (process) => process.running === true,
  ).length;
  const failedProcesses = processRows.filter(
    (process) =>
      process.status === "failed" ||
      process.status === "lost" ||
      (process.status === "exited" && number(process.exitCode) !== 0),
  ).length;
  const succeededProcesses = processRows.filter(
    (process) => process.status === "exited" && number(process.exitCode) === 0,
  ).length;
  const recoveredProcesses = processRows.filter(
    (process) => process.recoveredAfterRestart === true,
  ).length;

  const skills = skillSnapshot?.skills ?? [];
  const candidates = skillSnapshot?.candidates ?? [];
  const userSkills = skillSnapshot?.userSkills ?? [];
  const activeCandidates = candidates.filter(
    (candidate) => candidate.status === "active",
  );
  const invalidCandidates = activeCandidates.filter(
    (candidate) => candidate.validation?.valid === false,
  ).length;
  const installedUserSkills = userSkills.filter(
    (skill) => Boolean(skill.activeVersion),
  ).length;

  const activityLevels = activity.map((entry) => entry.level);
  const sourceCounts = new Map<string, number>();
  for (const entry of activity) {
    sourceCounts.set(entry.source, (sourceCounts.get(entry.source) ?? 0) + 1);
  }

  const attention: MonitorModel["attention"] = [];
  if (snapshot?.runtimeEvents?.status === "needs_attention") {
    attention.push({
      id: "runtime-events",
      severity: "error",
      title: "Runtime event history needs reconciliation",
      detail:
        snapshot.runtimeEvents.reconciliation?.message ??
        "Desktop cannot prove contiguous durable event replay.",
    });
  }
  if (failed > 0) {
    attention.push({
      id: "task-failed",
      severity: "error",
      title: `${failed} task${failed === 1 ? "" : "s"} failed`,
      detail: "Inspect canonical Task evidence before retrying side effects.",
    });
  }
  if (needsReview > 0) {
    attention.push({
      id: "task-review",
      severity: "warning",
      title: `${needsReview} task${needsReview === 1 ? "" : "s"} need review`,
      detail: "Verification or side-effect resolution is incomplete.",
    });
  }
  const confirmationCount = agentRequests.filter(
    (request) =>
      request.status === "pending" && request.requiresUserConfirmation,
  ).length;
  if (confirmationCount > 0) {
    attention.push({
      id: "agent-confirmation",
      severity: "warning",
      title: `${confirmationCount} request${confirmationCount === 1 ? "" : "s"} need confirmation`,
      detail: "AgentRequests coordinate repair work but do not grant execution permission.",
    });
  }
  if ((skillSnapshot?.summary.needsAttention ?? 0) > 0 || invalidCandidates > 0) {
    attention.push({
      id: "skill-attention",
      severity: "warning",
      title: "Skill governance needs attention",
      detail: `${skillSnapshot?.summary.needsAttention ?? 0} installed skill issue(s), ${invalidCandidates} invalid active candidate(s).`,
    });
  }
  if ((snapshot?.cloud.commandCounts.uncertain ?? 0) > 0) {
    attention.push({
      id: "cloud-uncertain",
      severity: "error",
      title: "Cloud command outcome is uncertain",
      detail:
        "Do not replay consequential work until Runtime/Cloud reconciliation is complete.",
    });
  }

  const runtimeOnline = snapshot?.mode === "live";
  const mcpOnline = snapshot?.mcp.status === "running";
  const tunnelOnline = snapshot?.tunnel.state === "running";
  const cloudOnline = snapshot?.cloud.status === "connected";
  const eventState = snapshot?.runtimeEvents?.status ?? "stopped";
  const skillRegistry = skillSnapshot?.lifecycle.registrySupported === true;

  const connectivity: MonitorModel["connectivity"] = [
    {
      id: "runtime",
      label: "Runtime",
      state: runtimeOnline ? "healthy" : "offline",
      detail: runtimeOnline
        ? `${snapshot?.info?.runtimeVersion ?? "online"} · ${snapshot?.latencyMs ?? "—"} ms`
        : snapshot?.error ?? "Offline",
    },
    {
      id: "mcp",
      label: "MCP",
      state: mcpOnline ? "healthy" : "offline",
      detail: mcpOnline
        ? `${snapshot?.mcp.sessionCount ?? 0} transport session(s)`
        : snapshot?.mcp.error ?? "Stopped",
    },
    {
      id: "tunnel",
      label: "Tunnel",
      state: tunnelOnline ? "healthy" : "offline",
      detail: tunnelOnline ? "Remote transport active" : snapshot?.tunnel.state ?? "stopped",
    },
    {
      id: "cloud",
      label: "Cloud",
      state: cloudOnline ? "healthy" : "offline",
      detail: cloudOnline ? "Account/device bridge connected" : snapshot?.cloud.status ?? "stopped",
    },
    {
      id: "events",
      label: "Events",
      state:
        eventState === "healthy"
          ? "healthy"
          : eventState === "needs_attention" || eventState === "degraded"
            ? "attention"
            : "offline",
      detail:
        eventState === "healthy"
          ? `cursor ${snapshot?.runtimeEvents?.consumer.lastSequence ?? "—"}`
          : eventState.replaceAll("_", " "),
    },
    {
      id: "skills",
      label: "Skill registry",
      state: skillRegistry ? "healthy" : "attention",
      detail: skillRegistry
        ? "Runtime User Skill Registry v1"
        : "Registry extension unavailable",
    },
  ];

  const recentTasks = newestFirst<Row>(
    taskRows.map((task) => ({
      ...task,
      updatedAt: task.updatedAt ?? task.progress?.lastMeaningfulAt,
    })),
  )
    .slice(0, 8)
    .map((task) => {
      const counts = task.counts ?? task.progress?.counts ?? {};
      const total = number(counts.total);
      const succeeded = number(counts.succeeded);
      return {
        id: String(task.id ?? ""),
        label: String(task.label ?? task.id ?? "Task"),
        status: String(task.status ?? task.progress?.phase ?? "unknown"),
        updatedAt: task.updatedAt ?? null,
        progressPercent:
          total > 0
            ? Math.max(0, Math.min(100, Math.round((succeeded / total) * 100)))
            : null,
        message:
          typeof task.progress?.message === "string"
            ? task.progress.message
            : null,
      };
    });

  return {
    generatedAt: new Date(now).toISOString(),
    connectivity,
    requests: {
      total: agentRequests.length,
      pending: requestCounts.pending,
      claimed: requestCounts.claimed,
      completed: requestCounts.completed,
      cancelled: requestCounts.cancelled,
      needsConfirmation: confirmationCount,
      highPriorityOpen: agentRequests.filter(
        (request) =>
          ["pending", "claimed"].includes(request.status) &&
          ["high", "urgent"].includes(request.priority),
      ).length,
    },
    tasks: {
      total: taskRows.length,
      active,
      running,
      waitingApproval,
      completed,
      failed,
      needsReview,
      totalSteps,
      succeededSteps,
      runningSteps,
    },
    verification: {
      required: verificationRequired,
      receipts: verificationReceipts,
      verified: verificationVerified,
      failed: verificationFailed,
      uncertain: verificationUncertain,
      missing: verificationMissing,
    },
    processes: {
      total: processRows.length,
      running: runningProcesses,
      succeeded: succeededProcesses,
      failed: failedProcesses,
      recovered: recoveredProcesses,
    },
    skills: {
      installed: skillSnapshot?.summary.installed ?? skills.length,
      ready:
        skillSnapshot?.summary.ready ??
        skills.filter((skill) => skill.availability === "ready").length,
      disabled:
        skillSnapshot?.summary.disabled ??
        skills.filter((skill) => skill.availability === "disabled").length,
      needsAttention:
        skillSnapshot?.summary.needsAttention ??
        skills.filter((skill) =>
          [
            "needs_attention",
            "missing_capability",
            "missing_permission",
            "incompatible",
            "integrity_failed",
          ].includes(skill.availability),
        ).length,
      activeCandidates: activeCandidates.length,
      invalidCandidates,
      installedUserSkills,
      registrySupported: skillRegistry,
      discoverySupported:
        skillSnapshot?.lifecycle.discoverySupported === true,
    },
    cloud: {
      connected: cloudOnline,
      processing: snapshot?.cloud.commandCounts.processing ?? 0,
      accepted: snapshot?.cloud.commandCounts.accepted ?? 0,
      rejected: snapshot?.cloud.commandCounts.rejected ?? 0,
      uncertain: snapshot?.cloud.commandCounts.uncertain ?? 0,
      outboxPending: snapshot?.cloud.outboxPending ?? 0,
    },
    activity: {
      total: activity.length,
      info: activityLevels.filter((level) => level === "info").length,
      warn: activityLevels.filter((level) => level === "warn").length,
      error: activityLevels.filter((level) => level === "error").length,
      bySource: [...sourceCounts.entries()]
        .map(([source, count]) => ({ source, count }))
        .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source)),
    },
    attention,
    recentTasks,
  };
}
