import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = path.join(
    path.dirname(file),
    "." + path.basename(file) + "." + process.pid + "." + randomUUID() + ".tmp",
  );
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(temp, file);
}

function initialState() {
  return {
    version: 1,
    owners: {},
    handoffs: {},
  };
}

function compactStringList(value, maxItems = 20, maxChars = 600) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === "string" && item.trim())
    .slice(0, maxItems)
    .map((item) => item.trim().slice(0, maxChars));
}

function compactEvidenceRefs(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item) =>
        item &&
        typeof item === "object" &&
        typeof item.kind === "string" &&
        item.kind.trim() &&
        typeof item.id === "string" &&
        item.id.trim(),
    )
    .slice(0, 50)
    .map((item) => ({
      kind: item.kind.trim().slice(0, 80),
      id: item.id.trim().slice(0, 240),
      ...(typeof item.label === "string" && item.label.trim()
        ? { label: item.label.trim().slice(0, 240) }
        : {}),
    }));
}

function compactHandoff(record) {
  if (!record) return null;
  return {
    ...record,
    capsule: record.capsule
      ? {
          ...record.capsule,
          completed: [...(record.capsule.completed ?? [])],
          nextActions: [...(record.capsule.nextActions ?? [])],
          decisions: [...(record.capsule.decisions ?? [])],
          constraints: [...(record.capsule.constraints ?? [])],
          doNotRepeat: [...(record.capsule.doNotRepeat ?? [])],
          taskIds: [...(record.capsule.taskIds ?? [])],
        }
      : null,
    evidenceRefs: [...(record.evidenceRefs ?? [])],
  };
}

function ownerRecord(state, ownerId) {
  if (!state.owners[ownerId]) {
    state.owners[ownerId] = {
      ownerId,
      checkpoint: null,
      transports: {},
      updatedAt: null,
    };
  }
  return state.owners[ownerId];
}

function transportRows(owner) {
  return Object.values(owner?.transports ?? {});
}

function compactOwner(owner) {
  if (!owner) return null;
  const transports = transportRows(owner);
  const connected = transports.filter((item) => item.connected === true);
  const latest = [...transports].sort(
    (a, b) =>
      Date.parse(b.lastSeenAt ?? b.connectedAt ?? "") -
      Date.parse(a.lastSeenAt ?? a.connectedAt ?? ""),
  )[0] ?? null;
  return {
    ownerId: owner.ownerId,
    clientKind: latest?.clientKind ?? owner.clientKind ?? null,
    clientLabel: latest?.clientLabel ?? owner.clientLabel ?? null,
    ownerSource: latest?.ownerSource ?? owner.ownerSource ?? null,
    plannerConnected: connected.length > 0,
    connectedTransportCount: connected.length,
    lastTransportSeenAt: latest?.lastSeenAt ?? latest?.connectedAt ?? null,
    lastDisconnectedAt:
      [...transports]
        .filter((item) => item.disconnectedAt)
        .sort(
          (a, b) =>
            Date.parse(b.disconnectedAt) - Date.parse(a.disconnectedAt),
        )[0]?.disconnectedAt ?? null,
    checkpoint: owner.checkpoint ?? null,
    workstream: owner.workstream ?? null,
    latestHandoffId: owner.latestHandoffId ?? null,
    updatedAt: owner.updatedAt ?? null,
  };
}

export class PlannerContinuationStore {
  constructor({ file }) {
    this.file = file;
  }

  read() {
    const value = readJson(this.file, initialState());
    if (
      value?.version !== 1 ||
      !value.owners ||
      typeof value.owners !== "object" ||
      Array.isArray(value.owners)
    ) {
      return initialState();
    }
    if (
      !value.handoffs ||
      typeof value.handoffs !== "object" ||
      Array.isArray(value.handoffs)
    ) {
      value.handoffs = {};
    }
    return value;
  }

  write(state) {
    writeJsonAtomic(this.file, state);
  }

  get(ownerId) {
    if (!ownerId) return null;
    return compactOwner(this.read().owners[ownerId] ?? null);
  }

  checkpoint(ownerId, input, now = new Date().toISOString()) {
    if (!ownerId) throw new Error("Planner continuation requires an owner.");
    const state = this.read();
    const owner = ownerRecord(state, ownerId);
    const previous = owner.checkpoint;
    const revision = Number(previous?.revision ?? 0) + 1;
    owner.checkpoint = {
      schemaVersion: 1,
      revision,
      status: input.status ?? "active",
      goal: input.goal,
      phase: input.phase ?? null,
      summary: input.summary ?? null,
      completed: Array.isArray(input.completed) ? [...input.completed] : [],
      nextActions: Array.isArray(input.nextActions) ? [...input.nextActions] : [],
      workspace: input.workspace ?? null,
      orchestrationId: input.orchestrationId ?? null,
      taskIds: Array.isArray(input.taskIds) ? [...input.taskIds] : [],
      decisions: Array.isArray(input.decisions)
        ? compactStringList(input.decisions)
        : compactStringList(previous?.decisions),
      constraints: Array.isArray(input.constraints)
        ? compactStringList(input.constraints)
        : compactStringList(previous?.constraints),
      doNotRepeat: Array.isArray(input.doNotRepeat)
        ? compactStringList(input.doNotRepeat)
        : compactStringList(previous?.doNotRepeat),
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      completedAt: input.status === "completed" ? now : null,
    };
    owner.updatedAt = now;
    this.write(state);
    return compactOwner(owner);
  }

  complete(ownerId, summary, now = new Date().toISOString()) {
    const state = this.read();
    const owner = state.owners[ownerId];
    if (!owner?.checkpoint) return null;
    owner.checkpoint = {
      ...owner.checkpoint,
      revision: Number(owner.checkpoint.revision ?? 0) + 1,
      status: "completed",
      ...(summary ? { summary } : {}),
      updatedAt: now,
      completedAt: now,
      nextActions: [],
    };
    owner.updatedAt = now;
    this.write(state);
    return compactOwner(owner);
  }

  ensureImplicitWorkstream(
    ownerId,
    input = {},
    now = new Date().toISOString(),
  ) {
    if (!ownerId) {
      throw new Error("Implicit OWL workstream requires a stable owner.");
    }
    const state = this.read();
    const owner = ownerRecord(state, ownerId);
    if (owner.workstream && owner.workstream.status !== "completed") {
      return compactOwner(owner);
    }

    const clientKind = input.clientKind ?? owner.clientKind ?? "chatgpt";
    const clientLabel = input.clientLabel ?? owner.clientLabel ?? null;
    owner.clientKind = clientKind;
    owner.clientLabel = clientLabel;
    owner.ownerSource = owner.ownerSource ?? "implicit-workstream";
    owner.workstream = {
      schemaVersion: 1,
      workstreamId: ownerId,
      implicit: true,
      status: "active",
      goal: input.goal ?? "Interactive OWL session",
      label: input.label ?? clientLabel ?? null,
      clientKind,
      clientLabel,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      lastProgressAt: now,
      toolStepsSinceProgress: 0,
      totalToolSteps: 0,
      progressAckProtocol: 2,
      progressBoundary: null,
      progressEvents: [],
      recentTools: [],
    };
    owner.updatedAt = now;
    this.write(state);
    return compactOwner(owner);
  }

  openWorkstream(input, now = new Date().toISOString()) {
    const ownerId = `owl-workstream:${randomUUID()}`;
    const state = this.read();
    const owner = ownerRecord(state, ownerId);
    const clientKind = input.clientKind ?? "chatgpt";
    const clientLabel = input.clientLabel ?? null;
    owner.clientKind = clientKind;
    owner.clientLabel = clientLabel;
    owner.ownerSource = "workstream";
    owner.workstream = {
      schemaVersion: 1,
      workstreamId: ownerId,
      status: input.status ?? "active",
      goal: input.goal,
      label: input.label ?? null,
      clientKind,
      clientLabel,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      lastProgressAt: now,
      toolStepsSinceProgress: 0,
      totalToolSteps: 0,
      progressAckProtocol: 2,
      progressBoundary: null,
      progressEvents: [],
      recentTools: [],
    };
    owner.checkpoint = {
      schemaVersion: 1,
      revision: 1,
      status: input.status ?? "active",
      goal: input.goal,
      phase: input.phase ?? null,
      summary: input.summary ?? null,
      completed: [],
      nextActions: Array.isArray(input.nextActions) ? [...input.nextActions] : [],
      workspace: input.workspace ?? null,
      orchestrationId: null,
      taskIds: [],
      decisions: [],
      constraints: [],
      doNotRepeat: [],
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };
    owner.updatedAt = now;
    this.write(state);
    return compactOwner(owner);
  }

  resumeWorkstream(ownerId, input = {}, now = new Date().toISOString()) {
    const state = this.read();
    const owner = state.owners[ownerId];
    if (!owner?.workstream) {
      throw new Error("Unknown OWL workstream.");
    }
    if (owner.workstream.status === "completed") {
      throw new Error("Completed OWL workstreams cannot be resumed.");
    }
    owner.clientKind = input.clientKind ?? owner.clientKind ?? "chatgpt";
    owner.clientLabel = input.clientLabel ?? owner.clientLabel ?? null;
    owner.ownerSource = "workstream";
    owner.workstream = {
      ...owner.workstream,
      clientKind: owner.clientKind,
      clientLabel: owner.clientLabel,
      ...(input.label ? { label: input.label } : {}),
      updatedAt: now,
    };
    owner.updatedAt = now;
    this.write(state);
    return compactOwner(owner);
  }

  markProgressBoundary(
    ownerId,
    input,
    now = new Date().toISOString(),
  ) {
    const state = this.read();
    const owner = state.owners[ownerId];
    if (!owner?.workstream || owner.workstream.status === "completed") {
      return null;
    }

    const existing = owner.workstream.progressBoundary;
    if (existing?.pending === true) {
      return compactOwner(owner);
    }

    owner.workstream = {
      ...owner.workstream,
      updatedAt: now,
      progressBoundary: {
        boundaryId: `progress-boundary:${randomUUID()}`,
        pending: true,
        createdAt: now,
        toolStepsSinceProgress: Math.max(
          0,
          Number(input.toolStepsSinceProgress ?? 0),
        ),
        silenceMs: Math.max(0, Number(input.silenceMs ?? 0)),
        retryTool: String(input.retryTool ?? "unknown").slice(0, 120),
        completed: compactStringList(input.completed),
        current: String(input.current ?? "Progress checkpoint").slice(0, 600),
        nextActions: compactStringList(input.nextActions),
        userVisibleProgress: String(input.userVisibleProgress ?? "").slice(
          0,
          2400,
        ),
      },
    };
    owner.updatedAt = now;
    this.write(state);
    return compactOwner(owner);
  }

  progressWorkstream(ownerId, input, now = new Date().toISOString()) {
    const state = this.read();
    const owner = state.owners[ownerId];
    if (!owner?.workstream) {
      throw new Error("WORKSTREAM_NOT_OPEN: call workstream_open first.");
    }
    if (owner.workstream.status === "completed") {
      throw new Error("WORKSTREAM_COMPLETED: completed work cannot report progress.");
    }

    const pendingBoundary = owner.workstream.progressBoundary;
    if (pendingBoundary?.pending === true) {
      if (input.progressBoundaryId !== pendingBoundary.boundaryId) {
        const error = new Error(
          "PROGRESS_ACK_REQUIRED: acknowledge the pending progress boundary with its boundary_id before continuing.",
        );
        error.code = "PROGRESS_ACK_REQUIRED";
        error.progressBoundary = pendingBoundary;
        throw error;
      }
      if (
        typeof input.userVisibleProgress !== "string" ||
        input.userVisibleProgress.trim() !==
          String(pendingBoundary.userVisibleProgress ?? "").trim()
      ) {
        const error = new Error(
          "PROGRESS_VISIBLE_UPDATE_REQUIRED: user_visible_progress must match the pending progress update exactly.",
        );
        error.code = "PROGRESS_VISIBLE_UPDATE_REQUIRED";
        error.progressBoundary = pendingBoundary;
        throw error;
      }
    }

    const status = input.status ?? "active";
    const completed = Array.isArray(input.completed) ? [...input.completed] : [];
    const nextActions = Array.isArray(input.nextActions) ? [...input.nextActions] : [];
    const event = {
      eventId: `progress:${randomUUID()}`,
      at: now,
      status,
      completed,
      current: input.current ?? null,
      nextActions,
      summary: input.summary ?? null,
    };
    const events = [
      ...(Array.isArray(owner.workstream.progressEvents)
        ? owner.workstream.progressEvents
        : []),
      event,
    ].slice(-24);
    owner.workstream = {
      ...owner.workstream,
      status,
      updatedAt: now,
      lastProgressAt: now,
      toolStepsSinceProgress: 0,
      progressBoundary: null,
      progressEvents: events,
    };
    const previous = owner.checkpoint;
    owner.checkpoint = {
      schemaVersion: 1,
      revision: Number(previous?.revision ?? 0) + 1,
      status,
      goal: previous?.goal ?? owner.workstream.goal,
      phase: input.current ?? previous?.phase ?? null,
      summary: input.summary ?? previous?.summary ?? null,
      completed:
        completed.length > 0 ? completed : Array.isArray(previous?.completed) ? previous.completed : [],
      nextActions,
      workspace: previous?.workspace ?? null,
      orchestrationId: previous?.orchestrationId ?? null,
      taskIds: Array.isArray(previous?.taskIds) ? previous.taskIds : [],
      decisions: compactStringList(previous?.decisions),
      constraints: compactStringList(previous?.constraints),
      doNotRepeat: compactStringList(previous?.doNotRepeat),
      createdAt: previous?.createdAt ?? owner.workstream.createdAt ?? now,
      updatedAt: now,
      completedAt: null,
    };
    owner.updatedAt = now;
    this.write(state);
    return compactOwner(owner);
  }

  recordWorkstreamToolStep(
    ownerId,
    input,
    now = new Date().toISOString(),
  ) {
    const state = this.read();
    const owner = state.owners[ownerId];
    if (!owner?.workstream || owner.workstream.status === "completed") {
      return null;
    }
    const recentTools = [
      ...(Array.isArray(owner.workstream.recentTools)
        ? owner.workstream.recentTools
        : []),
      {
        at: now,
        tool: String(input.tool ?? "unknown").slice(0, 120),
        outcome: input.outcome === "error" ? "error" : "success",
        durationMs: Math.max(0, Number(input.durationMs ?? 0)),
      },
    ].slice(-12);
    owner.workstream = {
      ...owner.workstream,
      updatedAt: now,
      toolStepsSinceProgress:
        Number(owner.workstream.toolStepsSinceProgress ?? 0) + 1,
      totalToolSteps: Number(owner.workstream.totalToolSteps ?? 0) + 1,
      recentTools,
    };
    owner.updatedAt = now;
    this.write(state);
    return compactOwner(owner);
  }

  completeWorkstream(ownerId, input = {}, now = new Date().toISOString()) {
    const state = this.read();
    const owner = state.owners[ownerId];
    if (!owner?.workstream) {
      throw new Error("WORKSTREAM_NOT_OPEN: call workstream_open first.");
    }
    owner.workstream = {
      ...owner.workstream,
      status: "completed",
      updatedAt: now,
      completedAt: now,
      lastProgressAt: now,
      toolStepsSinceProgress: 0,
      progressBoundary: null,
    };
    const previous = owner.checkpoint;
    owner.checkpoint = {
      ...(previous ?? {
        schemaVersion: 1,
        revision: 0,
        goal: owner.workstream.goal,
        phase: null,
        summary: null,
        completed: [],
        nextActions: [],
        workspace: null,
        orchestrationId: null,
        taskIds: [],
        decisions: [],
        constraints: [],
        doNotRepeat: [],
        createdAt: owner.workstream.createdAt ?? now,
      }),
      revision: Number(previous?.revision ?? 0) + 1,
      status: "completed",
      ...(input.summary ? { summary: input.summary } : {}),
      nextActions: [],
      updatedAt: now,
      completedAt: now,
    };
    owner.updatedAt = now;
    this.write(state);
    return compactOwner(owner);
  }

  noteTransportConnected(
    ownerId,
    transportSessionId,
    now = new Date().toISOString(),
    metadata = {},
  ) {
    if (!ownerId || !transportSessionId) return null;
    const state = this.read();
    const owner = ownerRecord(state, ownerId);
    const previous = owner.transports[transportSessionId];
    owner.transports[transportSessionId] = {
      transportSessionId,
      connected: true,
      connectedAt: previous?.connectedAt ?? now,
      lastSeenAt: now,
      disconnectedAt: null,
      disconnectReason: null,
      clientKind: metadata.clientKind ?? previous?.clientKind ?? null,
      clientLabel: metadata.clientLabel ?? previous?.clientLabel ?? null,
      ownerSource: metadata.ownerSource ?? previous?.ownerSource ?? null,
    };
    owner.clientKind = metadata.clientKind ?? owner.clientKind ?? null;
    owner.clientLabel = metadata.clientLabel ?? owner.clientLabel ?? null;
    owner.ownerSource = metadata.ownerSource ?? owner.ownerSource ?? null;
    owner.updatedAt = now;
    this.trimTransports(owner);
    this.write(state);
    return compactOwner(owner);
  }

  noteTransportActivity(
    ownerId,
    transportSessionId,
    now = new Date().toISOString(),
    metadata = {},
  ) {
    if (!ownerId || !transportSessionId) return null;
    const state = this.read();
    const owner = ownerRecord(state, ownerId);
    const previous = owner.transports[transportSessionId];
    owner.transports[transportSessionId] = {
      transportSessionId,
      connected: true,
      connectedAt: previous?.connectedAt ?? now,
      lastSeenAt: now,
      disconnectedAt: null,
      disconnectReason: null,
      clientKind: metadata.clientKind ?? previous?.clientKind ?? null,
      clientLabel: metadata.clientLabel ?? previous?.clientLabel ?? null,
      ownerSource: metadata.ownerSource ?? previous?.ownerSource ?? null,
    };
    owner.clientKind = metadata.clientKind ?? owner.clientKind ?? null;
    owner.clientLabel = metadata.clientLabel ?? owner.clientLabel ?? null;
    owner.ownerSource = metadata.ownerSource ?? owner.ownerSource ?? null;
    owner.updatedAt = now;
    this.trimTransports(owner);
    this.write(state);
    return compactOwner(owner);
  }

  noteTransportDisconnected(
    ownerId,
    transportSessionId,
    reason = "transport_close",
    now = new Date().toISOString(),
  ) {
    if (!ownerId || !transportSessionId) return null;
    const state = this.read();
    const owner = ownerRecord(state, ownerId);
    const previous = owner.transports[transportSessionId] ?? {
      transportSessionId,
      connectedAt: null,
      lastSeenAt: null,
    };
    owner.transports[transportSessionId] = {
      ...previous,
      transportSessionId,
      connected: false,
      disconnectedAt: now,
      disconnectReason: reason,
    };
    owner.updatedAt = now;
    this.trimTransports(owner);
    this.write(state);
    return compactOwner(owner);
  }

  recoverConnectedTransports(
    reason = "mcp_restart",
    now = new Date().toISOString(),
  ) {
    const state = this.read();
    let changed = false;
    for (const owner of Object.values(state.owners)) {
      let ownerChanged = false;
      for (const transport of Object.values(owner.transports ?? {})) {
        if (transport.connected !== true) continue;
        transport.connected = false;
        transport.disconnectedAt = now;
        transport.disconnectReason = reason;
        changed = true;
        ownerChanged = true;
      }
      if (ownerChanged) owner.updatedAt = now;
    }
    if (changed) this.write(state);
    return changed;
  }

  recordConversationTraffic(
    ownerId,
    input,
    now = new Date().toISOString(),
  ) {
    if (!ownerId) return null;
    const state = this.read();
    const owner = state.owners[ownerId];
    if (!owner?.workstream || owner.workstream.status === "completed") {
      return null;
    }

    const requestChars = Math.max(0, Number(input.requestChars ?? 0));
    const responseChars = Math.max(0, Number(input.responseChars ?? 0));
    const requestDigest =
      typeof input.requestDigest === "string" ? input.requestDigest : null;
    const responseDigest =
      typeof input.responseDigest === "string" ? input.responseDigest : null;
    const recent = Array.isArray(owner.continuity?.recentTraffic)
      ? owner.continuity.recentTraffic
      : [];

    const duplicateRequest =
      requestChars > 0 &&
      requestDigest &&
      recent.some((item) => item.requestDigest === requestDigest);
    const duplicateResponse =
      responseChars > 0 &&
      responseDigest &&
      recent.some((item) => item.responseDigest === responseDigest);
    const duplicateChars =
      (duplicateRequest ? requestChars : 0) +
      (duplicateResponse ? responseChars : 0);

    const sample = {
      at: now,
      tool: String(input.tool ?? "unknown").slice(0, 120),
      requestChars,
      responseChars,
      duplicateChars,
      requestDigest,
      responseDigest,
    };
    owner.continuity = {
      observedChars:
        Math.max(0, Number(owner.continuity?.observedChars ?? 0)) +
        requestChars +
        responseChars,
      duplicateChars:
        Math.max(0, Number(owner.continuity?.duplicateChars ?? 0)) +
        duplicateChars,
      recentTraffic: [...recent, sample].slice(-96),
    };
    owner.updatedAt = now;
    this.write(state);
    return this.continuityStatus(ownerId, Date.parse(now));
  }

  continuityStatus(ownerId, nowMs = Date.now(), stateOverride = null) {
    if (!ownerId) return null;
    const state = stateOverride ?? this.read();
    const owner = state.owners[ownerId];
    if (!owner?.workstream) return null;

    const continuity = owner.continuity ?? {};
    const observedChars = Math.max(
      0,
      Number(continuity.observedChars ?? 0),
    );
    const duplicateChars = Math.max(
      0,
      Number(continuity.duplicateChars ?? 0),
    );
    const recentTraffic = Array.isArray(continuity.recentTraffic)
      ? continuity.recentTraffic
      : [];
    const recentWindowStart = nowMs - 10 * 60_000;
    const recentRows = recentTraffic.filter((item) => {
      const at = Date.parse(item.at ?? "");
      return Number.isFinite(at) && at >= recentWindowStart;
    });
    const recentGrowthChars = recentRows.reduce(
      (sum, item) =>
        sum +
        Math.max(0, Number(item.requestChars ?? 0)) +
        Math.max(0, Number(item.responseChars ?? 0)),
      0,
    );
    const duplicateRatio =
      observedChars > 0 ? duplicateChars / observedChars : 0;
    const workstreamCreatedMs = Date.parse(
      owner.workstream.createdAt ?? "",
    );
    const sessionAgeMs = Number.isFinite(workstreamCreatedMs)
      ? Math.max(0, nowMs - workstreamCreatedMs)
      : 0;
    const checkpointUpdatedMs = Date.parse(
      owner.checkpoint?.updatedAt ?? "",
    );
    const checkpointAgeMs = Number.isFinite(checkpointUpdatedMs)
      ? Math.max(0, nowMs - checkpointUpdatedMs)
      : null;
    const toolCallCount = Math.max(
      0,
      Number(owner.workstream.totalToolSteps ?? 0),
    );
    const activeTaskCount = Array.isArray(owner.checkpoint?.taskIds)
      ? owner.checkpoint.taskIds.length
      : 0;
    const handoffReady = Object.values(state.handoffs ?? {}).some(
      (handoff) =>
        handoff?.status === "ready" &&
        handoff?.sourceWorkstreamId === owner.workstream.workstreamId,
    );

    let score = 0;
    const reasons = [];
    const addReason = (code, points, detail) => {
      score += points;
      reasons.push({ code, points, detail });
    };

    if (observedChars >= 3_000_000) {
      addReason("observed_volume", 30, "OWL-observed payload volume >= 3M chars");
    } else if (observedChars >= 1_500_000) {
      addReason("observed_volume", 20, "OWL-observed payload volume >= 1.5M chars");
    } else if (observedChars >= 500_000) {
      addReason("observed_volume", 10, "OWL-observed payload volume >= 500K chars");
    }

    if (recentGrowthChars >= 300_000) {
      addReason("growth_rate", 20, "OWL-observed growth >= 300K chars / 10 min");
    } else if (recentGrowthChars >= 100_000) {
      addReason("growth_rate", 10, "OWL-observed growth >= 100K chars / 10 min");
    }

    if (toolCallCount >= 100) {
      addReason("tool_calls", 20, "At least 100 substantive OWL tool calls");
    } else if (toolCallCount >= 50) {
      addReason("tool_calls", 10, "At least 50 substantive OWL tool calls");
    }

    if (sessionAgeMs >= 4 * 60 * 60_000) {
      addReason("session_age", 20, "OWL workstream age >= 4 hours");
    } else if (sessionAgeMs >= 90 * 60_000) {
      addReason("session_age", 10, "OWL workstream age >= 90 minutes");
    }

    if (duplicateRatio >= 0.5) {
      addReason("duplicate_payload", 20, "At least 50% exact duplicate observed payload");
    } else if (duplicateRatio >= 0.25) {
      addReason("duplicate_payload", 10, "At least 25% exact duplicate observed payload");
    }

    if (
      activeTaskCount > 0 &&
      checkpointAgeMs !== null &&
      checkpointAgeMs >= 15 * 60_000
    ) {
      addReason(
        "stale_checkpoint",
        10,
        "Active Runtime task refs with checkpoint older than 15 minutes",
      );
    }
    if (activeTaskCount > 0) {
      addReason("active_durable_work", 5, "Active durable work is referenced by the checkpoint");
    }

    const risk =
      score >= 75
        ? "critical"
        : score >= 50
          ? "high"
          : score >= 25
            ? "medium"
            : "low";
    const stateLabel = handoffReady
      ? "handoff_ready"
      : risk === "high" || risk === "critical"
        ? "handoff_recommended"
        : risk === "medium"
          ? "growing"
          : "healthy";

    return {
      modelVersion: 1,
      basis: "owl_observed_mcp_traffic",
      risk,
      state: stateLabel,
      score,
      handoffReady,
      observedChars,
      observedTokenEquivalent: Math.ceil(observedChars / 4),
      tokenEquivalentHeuristic: "characters_divided_by_4_not_openai_context",
      recentGrowthChars,
      recentGrowthTokenEquivalent: Math.ceil(recentGrowthChars / 4),
      windowMinutes: 10,
      duplicateChars,
      duplicateRatio,
      toolCallCount,
      sessionAgeMs,
      checkpointAgeMs,
      activeTaskCount,
      reasons,
    };
  }

  prepareHandoff(ownerId, input = {}, now = new Date().toISOString()) {
    if (!ownerId) throw new Error("Planner handoff requires an owner.");
    const state = this.read();
    const owner = state.owners[ownerId];
    const workstream = owner?.workstream;
    if (!workstream || workstream.status === "completed") {
      throw new Error("HANDOFF_WORKSTREAM_NOT_ACTIVE: prepare a handoff from an active OWL workstream.");
    }

    const checkpoint = owner.checkpoint ?? null;
    const goal = checkpoint?.goal ?? workstream.goal;
    if (!goal) {
      throw new Error("HANDOFF_GOAL_REQUIRED: the active workstream has no recoverable goal.");
    }

    const readyForWorkstream = Object.values(state.handoffs ?? {})
      .filter(
        (item) =>
          item?.status === "ready" &&
          item?.sourceWorkstreamId === workstream.workstreamId,
      )
      .sort(
        (a, b) =>
          Date.parse(b.updatedAt ?? b.createdAt ?? "") -
          Date.parse(a.updatedAt ?? a.createdAt ?? ""),
      )[0] ?? null;

    const handoffId =
      readyForWorkstream?.id ??
      ("handoff_" +
        Date.now().toString(36) +
        "_" +
        randomUUID().replaceAll("-", "").slice(0, 12));
    const project =
      input.project ??
      readyForWorkstream?.project ??
      checkpoint?.workspace?.repo ??
      null;

    const record = {
      schemaVersion: 1,
      id: handoffId,
      status: "ready",
      project: project ? String(project).trim().slice(0, 240) : null,
      reason: String(input.reason ?? readyForWorkstream?.reason ?? "manual")
        .trim()
        .slice(0, 80),
      continuityRisk:
        input.continuityRisk ?? readyForWorkstream?.continuityRisk ?? null,
      sourceOwnerId: ownerId,
      sourceWorkstreamId: workstream.workstreamId,
      sourceCheckpointRevision:
        Number.isFinite(Number(checkpoint?.revision))
          ? Number(checkpoint.revision)
          : null,
      capsule: {
        goal: String(goal).slice(0, 1000),
        phase: checkpoint?.phase ?? null,
        summary: input.summary ?? checkpoint?.summary ?? null,
        completed: Array.isArray(input.completed)
          ? compactStringList(input.completed)
          : compactStringList(checkpoint?.completed),
        nextActions: Array.isArray(input.nextActions)
          ? compactStringList(input.nextActions)
          : compactStringList(checkpoint?.nextActions),
        decisions: Array.isArray(input.decisions)
          ? compactStringList(input.decisions)
          : compactStringList(checkpoint?.decisions),
        constraints: Array.isArray(input.constraints)
          ? compactStringList(input.constraints)
          : compactStringList(checkpoint?.constraints),
        doNotRepeat: Array.isArray(input.doNotRepeat)
          ? compactStringList(input.doNotRepeat)
          : compactStringList(checkpoint?.doNotRepeat),
        workspace: checkpoint?.workspace ?? null,
        orchestrationId: checkpoint?.orchestrationId ?? null,
        taskIds: Array.isArray(input.taskIds)
          ? compactStringList(input.taskIds, 50, 220)
          : compactStringList(checkpoint?.taskIds, 50, 220),
      },
      evidenceRefs: Array.isArray(input.evidenceRefs)
        ? compactEvidenceRefs(input.evidenceRefs)
        : compactEvidenceRefs(readyForWorkstream?.evidenceRefs),
      createdAt: readyForWorkstream?.createdAt ?? now,
      updatedAt: now,
      consumedAt: null,
      consumedByOwnerId: null,
    };

    state.handoffs[handoffId] = record;
    owner.latestHandoffId = handoffId;
    owner.updatedAt = now;
    this.write(state);
    return compactHandoff(record);
  }

  latestHandoff(input = {}) {
    const state = this.read();
    const project =
      typeof input.project === "string" && input.project.trim()
        ? input.project.trim()
        : null;
    const rows = Object.values(state.handoffs ?? {})
      .filter(
        (item) =>
          item?.status === "ready" &&
          (!project || item.project === project),
      )
      .sort(
        (a, b) =>
          Date.parse(b.updatedAt ?? b.createdAt ?? "") -
          Date.parse(a.updatedAt ?? a.createdAt ?? ""),
      );
    return compactHandoff(rows[0] ?? null);
  }

  getHandoff(handoffId) {
    if (!handoffId) return null;
    return compactHandoff(this.read().handoffs?.[handoffId] ?? null);
  }

  consumeHandoff(handoffId, consumerOwnerId, now = new Date().toISOString()) {
    if (!handoffId) throw new Error("Planner handoff ID is required.");
    if (!consumerOwnerId) throw new Error("Planner handoff consumer owner is required.");
    const state = this.read();
    const record = state.handoffs?.[handoffId];
    if (!record) {
      throw new Error("HANDOFF_NOT_FOUND: unknown Planner Handoff.");
    }
    if (record.status === "consumed") {
      return {
        handoff: compactHandoff(record),
        alreadyConsumed: true,
      };
    }
    if (record.status !== "ready") {
      throw new Error("HANDOFF_NOT_READY: Planner Handoff is not consumable.");
    }
    record.status = "consumed";
    record.updatedAt = now;
    record.consumedAt = now;
    record.consumedByOwnerId = consumerOwnerId;
    this.write(state);
    return {
      handoff: compactHandoff(record),
      alreadyConsumed: false,
    };
  }
  summary() {
    const state = this.read();
    const nowMs = Date.now();
    const owners = Object.values(state.owners)
      .map((owner) => ({
        ...compactOwner(owner),
        continuity: this.continuityStatus(owner.ownerId, nowMs, state),
      }))
      .filter(Boolean)
      .sort(
        (a, b) =>
          Date.parse(
            b.checkpoint?.updatedAt ??
              b.lastTransportSeenAt ??
              b.updatedAt ??
              "",
          ) -
          Date.parse(
            a.checkpoint?.updatedAt ??
              a.lastTransportSeenAt ??
              a.updatedAt ??
              "",
          ),
      )
      .slice(0, 48);
    const active = owners.filter(
      (owner) =>
        owner?.checkpoint &&
        owner.checkpoint.status !== "completed",
    );
    const readyHandoffs = Object.values(state.handoffs ?? {})
      .filter((handoff) => handoff?.status === "ready")
      .sort(
        (a, b) =>
          Date.parse(b.updatedAt ?? b.createdAt ?? "") -
          Date.parse(a.updatedAt ?? a.createdAt ?? ""),
      );
    return {
      activeCheckpointCount: active.length,
      readyHandoffCount: readyHandoffs.length,
      latestReadyHandoff: compactHandoff(readyHandoffs[0] ?? null),
      connectedOwnerCount: owners.filter((owner) => owner.plannerConnected).length,
      latestActive: active[0] ?? null,
      owners,
      progressPolicy: {
        recommendedUpdateIntervalMs: 10_000,
        recommendedMaxToolStepsWithoutUpdate: 3,
      },
    };
  }

  trimTransports(owner) {
    const entries = Object.entries(owner.transports ?? {});
    if (entries.length <= 24) return;
    entries
      .sort(
        ([, a], [, b]) =>
          Date.parse(b.lastSeenAt ?? b.connectedAt ?? "") -
          Date.parse(a.lastSeenAt ?? a.connectedAt ?? ""),
      )
      .slice(24)
      .forEach(([key]) => delete owner.transports[key]);
  }
}
