import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { missionApprovalDigest, missionApprovalScope, missionApprovalStatus } from "./mission-approval.mjs";

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
  // This durable snapshot is machine-owned; pretty printing needlessly inflates
  // multi-workstream persistence cost on every MCP tool call. Keep all fields.
  fs.writeFileSync(temp, JSON.stringify(value) + "\n", { mode: 0o600 });
  fs.renameSync(temp, file);
}

// Atomic snapshots are replaced with rename; the inode changes on every
// supported store write. Check all identity fields so readers also notice
// out-of-process rewrites without relying on a timer or stale in-memory data.
function snapshotSignature(file) {
  try {
    const stat = fs.statSync(file);
    return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
  } catch {
    return null;
  }
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

function missionContract(input, now) {
  return {
    version: 1,
    // MCP cannot independently inspect the human's original chat message.
    // Never describe planner-supplied constraints as user-verified authority.
    provenance: "planner_asserted_unverified",
    originalGoal: input.goal,
    allowedRepositories: compactStringList(input.missionContract?.allowedRepositories, 12, 240),
    prohibitedChanges: compactStringList(input.missionContract?.prohibitedChanges),
    acceptanceCriteria: compactStringList(input.missionContract?.acceptanceCriteria),
    createdAt: now,
  };
}

function retainConstraints(...inputs) {
  return [...new Set(inputs.flatMap((v) => compactStringList(v)))].slice(0, 20);
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
  constructor({
    file,
    implicitIdleTtlMs = 10 * 60_000,
    archivedRetentionMs = 0,
  }) {
    this.file = file;
    this.implicitIdleTtlMs = Math.max(Number(implicitIdleTtlMs) || 0, 60_000);
    this.archivedRetentionMs = Math.max(Number(archivedRetentionMs) || 0, 0);
    this._getCache = null;
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
    // Keep mutation reads fresh: only repeated read-only lookups are cached.
    this._getCache = null;
  }

  get(ownerId) {
    if (!ownerId) return null;
    const signature = snapshotSignature(this.file);
    if (!this._getCache || this._getCache.signature !== signature) {
      this._getCache = {
        signature,
        owners: this.read().owners,
      };
    }
    // Never expose cached nested objects: callers must not mutate persisted
    // workstream/checkpoint views, nor accidentally modify other owners.
    return structuredClone(compactOwner(this._getCache.owners[ownerId] ?? null));
  }

  checkpoint(ownerId, input, now = new Date().toISOString()) {
    if (!ownerId) throw new Error("Planner continuation requires an owner.");
    const state = this.read();
    const owner = ownerRecord(state, ownerId);
    const previous = owner.checkpoint;
    const pinnedGoal = owner.workstream?.implicit
      ? previous?.goal ?? null // First explicit user checkpoint pins implicit sessions.
      : owner.workstream?.missionContract?.originalGoal ??
        owner.workstream?.goal ?? previous?.goal ?? null;
    const suggestedGoalDrift = Boolean(
      pinnedGoal && typeof input.goal === "string" && input.goal !== pinnedGoal,
    );
    if (suggestedGoalDrift) {
      // Discard the entire proposed checkpoint, including phase, new actions,
      // task IDs, and completion claims. No additional approval loop.
      if (owner.workstream) {
        owner.workstream.lastMissionDrift = {
          proposedGoal: input.goal.slice(0, 1000),
          retainedGoal: pinnedGoal,
          detectedAt: now,
          disposition: "discarded_unverified_change",
        };
      }
      owner.updatedAt = now;
      this.write(state);
      return compactOwner(owner);
    }
    const revision = Number(previous?.revision ?? 0) + 1;
    owner.checkpoint = {
      schemaVersion: 1,
      revision,
      status: input.status ?? "active",
      goal: pinnedGoal ?? input.goal,
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
      // User prohibitions already recorded must survive a planner resume
      // or another checkpoint with an incomplete context window.
      constraints: retainConstraints(previous?.constraints, input.constraints),
      doNotRepeat: retainConstraints(
        previous?.doNotRepeat,
        owner.workstream?.missionContract?.prohibitedChanges,
        input.doNotRepeat,
      ),
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
    if (
      owner.workstream &&
      !["completed", "archived"].includes(owner.workstream.status)
    ) {
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
      missionContract: missionContract(input, now),
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
      doNotRepeat: compactStringList(input.missionContract?.prohibitedChanges),
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
    const pending = owner.workstream.progressBoundary;
    owner.workstream = {
      ...owner.workstream,
      clientKind: owner.clientKind,
      clientLabel: owner.clientLabel,
      ...(input.label ? { label: input.label } : {}),
      ...(pending?.pending ? {
        progressBoundary: null,
        lastReleasedProgressBoundary: {
          boundaryId: pending.boundaryId,
          createdAt: pending.createdAt,
          releasedAt: now,
          reason: "nonblocking_progress_migration",
          acknowledged: false,
        },
      } : {}),
      updatedAt: now,
    };
    owner.updatedAt = now;
    this.write(state);
    return compactOwner(owner);
  }
  listMissionReviews({ limit = 30, sinceMs = 7 * 86_400_000 } = {}) {
    const now = Date.now();
    return Object.values(this.read().owners)
      .filter(owner =>
        owner?.workstream?.status !== "completed" &&
        (owner?.workstream?.missionContract?.allowedRepositories?.length ?? 0) > 0 &&
        Date.parse(owner.updatedAt ?? owner.workstream.createdAt ?? "") >= now - sinceMs)
      .sort((a,b)=> Date.parse(b.updatedAt??"") - Date.parse(a.updatedAt??""))
      .slice(0, Math.min(limit, 100))
      .map(owner => {
        const status = missionApprovalStatus(owner, path.join(path.dirname(this.file),"human-approval-signer.json"));
        return {
          workstreamId: owner.ownerId,
          goal: owner.workstream.goal,
          label: owner.workstream.label ?? null,
          status: status.approved ? "approved" : "needs_review",
          reason: status.reason,
          scope: status.scope,
          pendingProgressBoundary: owner.workstream.progressBoundary?.pending === true,
        };
      });
  }

  attachMissionApproval(ownerId, signed, now = new Date().toISOString()) {
    const state = this.read();
    const owner = state.owners[ownerId];
    if (!owner?.workstream || owner.workstream.status === "completed")
      throw Object.assign(new Error("MISSION_WORKSTREAM_NOT_ACTIVE"), {code:"MISSION_WORKSTREAM_NOT_ACTIVE"});
    const scope = missionApprovalScope(owner);
    const digest = missionApprovalDigest(scope);
    if (!scope?.workspaceRoot || !Array.isArray(scope.allowedRepositories) ||
        scope.allowedRepositories.length === 0 ||
        !scope.allowedRepositories.includes(path.basename(scope.workspaceRoot)))
      throw Object.assign(new Error("MISSION_SCOPE_INCOMPLETE"), {code:"MISSION_SCOPE_INCOMPLETE"});
    const before = owner.workstream.missionContract.approval;
    owner.workstream.missionContract = {
      ...owner.workstream.missionContract,
      approval: {digest,signature:signed,approvedAt:now,source:"desktop_human_dialog"},
    };
    const verification = missionApprovalStatus(owner,path.join(path.dirname(this.file),"human-approval-signer.json"));
    if (!verification.approved) {
      owner.workstream.missionContract.approval = before;
      throw Object.assign(new Error("MISSION_SIGNATURE_INVALID"), {code:"MISSION_SIGNATURE_INVALID"});
    }
    owner.updatedAt = now;
    this.write(state);
    return {workstreamId:ownerId, approved:true, digest, scope};
  }

  noteProgressAdvisory(ownerId, now = new Date().toISOString()) {
    const state = this.read();
    const owner = state.owners[ownerId];
    if (!owner?.workstream || owner.workstream.progressBoundary?.pending ||
        owner.workstream.status === "completed") return null;
    // Do not advance actual progress/goal or reset the gate by reminding.
    owner.workstream.lastProgressAdvisoryAt = now;
    this.write(state);
    return compactOwner(owner);
  }

  releaseUnacknowledgedProgressBoundary(ownerId, now = new Date().toISOString()) {
    const state = this.read();
    const owner = state.owners[ownerId];
    const pending = owner?.workstream?.progressBoundary;
    if (!pending?.pending) return owner ? compactOwner(owner) : null;
    // Unblock legacy protocol without falsely asserting a user-visible report.
    // Keep auditable evidence; don't modify the checkpoint or progress clock.
    owner.workstream.progressBoundary = null;
    owner.workstream.lastReleasedProgressBoundary = {
      boundaryId: pending.boundaryId,
      createdAt: pending.createdAt,
      releasedAt: now,
      reason: "nonblocking_progress_migration",
      acknowledged: false,
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
    if (!pendingBoundary?.pending && input.progressBoundaryId) {
      const prior = owner.workstream.lastAcknowledgedProgressBoundary;
      if (prior?.boundaryId === input.progressBoundaryId &&
          (input.visibleProgressReported === true ||
            prior?.userVisibleProgress === input.userVisibleProgress)) {
        // Retried acknowledgements are idempotent and owner-scoped.
        return compactOwner(owner);
      }
      const error = new Error("PROGRESS_ACK_STALE: no matching boundary.");
      error.code = "PROGRESS_ACK_STALE";
      throw error;
    }
    if (pendingBoundary?.pending === true) {
      if (input.progressBoundaryId !== pendingBoundary.boundaryId) {
        const error = new Error(
          "PROGRESS_ACK_REQUIRED: acknowledge the pending progress boundary with its boundary_id before continuing.",
        );
        error.code = "PROGRESS_ACK_REQUIRED";
        error.progressBoundary = pendingBoundary;
        throw error;
      }
      // Structured ACK attests that a *previously posted* user-visible
      // update exists. Localized messages need not equal generated English.
      // Legacy callers can still submit the exact pending text.
      const legacyTextMatched =
        typeof input.userVisibleProgress === "string" &&
        input.userVisibleProgress.trim() ===
          String(pendingBoundary.userVisibleProgress ?? "").trim();
      if (input.visibleProgressReported !== true && !legacyTextMatched) {
        const error = new Error(
          "PROGRESS_VISIBLE_UPDATE_REQUIRED: post a user-visible progress update first; then acknowledge with visible_progress_reported=true and the pending boundary ID, or use legacy exact text.",
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
      lastAcknowledgedProgressBoundary: pendingBoundary?.pending
        ? {
            boundaryId: pendingBoundary.boundaryId,
            userVisibleProgress: pendingBoundary.userVisibleProgress,
            acknowledgementMode: input.visibleProgressReported === true
              ? "structured" : "legacy_text",
            at: now,
          }
        : owner.workstream.lastAcknowledgedProgressBoundary ?? null,
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
      ...(owner.continuity ?? {}),
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
    const continuityEpochStartedMs = Date.parse(
      continuity.epochStartedAt ?? owner.workstream.createdAt ?? "",
    );
    const sessionAgeMs = Number.isFinite(continuityEpochStartedMs)
      ? Math.max(0, nowMs - continuityEpochStartedMs)
      : 0;
    const workstreamAgeMs = Number.isFinite(workstreamCreatedMs)
      ? Math.max(0, nowMs - workstreamCreatedMs)
      : 0;
    const checkpointUpdatedMs = Date.parse(
      owner.checkpoint?.updatedAt ?? "",
    );
    const checkpointAgeMs = Number.isFinite(checkpointUpdatedMs)
      ? Math.max(0, nowMs - checkpointUpdatedMs)
      : null;
    const toolCallBaseline = Math.max(
      0,
      Number(continuity.toolCallBaseline ?? 0),
    );
    const toolCallCount = Math.max(
      0,
      Number(owner.workstream.totalToolSteps ?? 0) - toolCallBaseline,
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

    if (observedChars >= 360_000) {
      addReason(
        "observed_volume",
        30,
        "OWL-observed context floor >= ~90K token-equivalent",
      );
    } else if (observedChars >= 240_000) {
      addReason(
        "observed_volume",
        20,
        "OWL-observed context floor >= ~60K token-equivalent",
      );
    } else if (observedChars >= 160_000) {
      addReason(
        "observed_volume",
        10,
        "OWL-observed context floor >= ~40K token-equivalent",
      );
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
      modelVersion: 2,
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
      workstreamAgeMs,
      continuityEpochId: continuity.epochId ?? null,
      continuityEpochStartedAt:
        continuity.epochStartedAt ?? owner.workstream.createdAt ?? null,
      checkpointAgeMs,
      activeTaskCount,
      reasons,
    };
  }

  startContinuityEpoch(
    ownerId,
    input = {},
    now = new Date().toISOString(),
  ) {
    if (!ownerId) {
      throw new Error("Conversation Continuity epoch requires an owner.");
    }
    const state = this.read();
    const owner = state.owners[ownerId];
    if (!owner?.workstream || owner.workstream.status === "completed") {
      throw new Error(
        "CONTINUITY_WORKSTREAM_NOT_ACTIVE: start an epoch on an active OWL workstream.",
      );
    }

    const nowMs = Date.parse(now);
    const previousStatus = this.continuityStatus(
      ownerId,
      Number.isFinite(nowMs) ? nowMs : Date.now(),
      state,
    );
    const previous = owner.continuity ?? {};
    const history = Array.isArray(previous.history)
      ? [...previous.history]
      : [];
    if (previousStatus) {
      history.push({
        epochId:
          previous.epochId ??
          ("legacy:" + (owner.workstream.createdAt ?? "unknown")),
        startedAt:
          previous.epochStartedAt ?? owner.workstream.createdAt ?? null,
        endedAt: now,
        reason: String(input.reason ?? "planner_resume").slice(0, 80),
        ...(typeof input.handoffId === "string" && input.handoffId
          ? { handoffId: input.handoffId.slice(0, 220) }
          : {}),
        observedChars: previousStatus.observedChars,
        observedTokenEquivalent: previousStatus.observedTokenEquivalent,
        duplicateRatio: previousStatus.duplicateRatio,
        toolCallCount: previousStatus.toolCallCount,
        sessionAgeMs: previousStatus.sessionAgeMs,
        score: previousStatus.score,
        risk: previousStatus.risk,
        state: previousStatus.state,
      });
    }

    owner.continuity = {
      epochId: "continuity:" + randomUUID(),
      epochStartedAt: now,
      toolCallBaseline: Math.max(
        0,
        Number(owner.workstream.totalToolSteps ?? 0),
      ),
      observedChars: 0,
      duplicateChars: 0,
      recentTraffic: [],
      history: history.slice(-8),
    };
    owner.updatedAt = now;
    this.write(state);
    return this.continuityStatus(
      ownerId,
      Number.isFinite(nowMs) ? nowMs : Date.now(),
    );
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

  garbageCollect(nowMs = Date.now()) {
    const state = this.read();
    let changed = false;
    const readyHandoffWorkstreams = new Set(
      Object.values(state.handoffs ?? {})
        .filter((handoff) => handoff?.status === "ready" && handoff?.sourceWorkstreamId)
        .map((handoff) => handoff.sourceWorkstreamId),
    );

    for (const [ownerId, owner] of Object.entries(state.owners)) {
      const workstream = owner?.workstream;
      const transports = transportRows(owner);
      const connected = transports.some((transport) => transport.connected === true);
      const hasCheckpoint = Boolean(owner?.checkpoint);
      const hasReadyHandoff = Boolean(
        workstream?.workstreamId &&
          readyHandoffWorkstreams.has(workstream.workstreamId),
      );
      const timestamps = [
        owner.updatedAt,
        workstream?.updatedAt,
        workstream?.lastProgressAt,
        workstream?.archivedAt,
        ...transports.flatMap((transport) => [
          transport.lastSeenAt,
          transport.disconnectedAt,
          transport.connectedAt,
        ]),
      ]
        .map((value) => Date.parse(value ?? ""))
        .filter(Number.isFinite);
      const lastActivityMs = timestamps.length > 0 ? Math.max(...timestamps) : 0;
      const staleUndurable =
        !connected &&
        !hasCheckpoint &&
        !hasReadyHandoff &&
        lastActivityMs > 0 &&
        nowMs - lastActivityMs >= this.implicitIdleTtlMs;

      if (workstream?.status === "archived" && !hasCheckpoint && !hasReadyHandoff) {
        const archivedAt = Date.parse(workstream.archivedAt ?? "");
        if (
          this.archivedRetentionMs === 0 ||
          (Number.isFinite(archivedAt) &&
            nowMs - archivedAt >= this.archivedRetentionMs)
        ) {
          delete state.owners[ownerId];
          changed = true;
          continue;
        }
      }

      if (
        staleUndurable &&
        (!workstream ||
          (workstream.implicit === true && workstream.status === "active"))
      ) {
        if (this.archivedRetentionMs === 0) {
          delete state.owners[ownerId];
          changed = true;
          continue;
        }

        const archivedAt = new Date(nowMs).toISOString();
        owner.workstream = {
          ...workstream,
          schemaVersion: workstream?.schemaVersion ?? 1,
          workstreamId: workstream?.workstreamId ?? ownerId,
          implicit: true,
          status: "archived",
          archivedAt,
          archiveReason: "implicit_idle_gc",
          updatedAt: archivedAt,
          completedAt: workstream?.completedAt ?? archivedAt,
          progressBoundary: null,
        };
        owner.updatedAt = archivedAt;
        changed = true;
      }
    }

    if (changed) this.write(state);
    return { changed, state };
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
  healthSummary() {
    const nowMs = Date.now();
    const { state } = this.garbageCollect(nowMs);
    const owners = Object.values(state.owners);
    const visibleOwners = owners.filter(
      (owner) => owner?.workstream?.status !== "archived",
    );
    const activeCheckpoints = visibleOwners.filter(
      (owner) =>
        owner?.checkpoint && owner.checkpoint.status !== "completed",
    );
    const connectedOwnerCount = visibleOwners.filter((owner) =>
      transportRows(owner).some((transport) => transport.connected === true),
    ).length;
    const readyHandoffCount = Object.values(state.handoffs ?? {}).filter(
      (handoff) => handoff?.status === "ready",
    ).length;
    return {
      ownerCount: visibleOwners.length,
      connectedOwnerCount,
      activeCheckpointCount: activeCheckpoints.length,
      readyHandoffCount,
      implicitActiveCount: visibleOwners.filter(
        (owner) =>
          owner?.workstream?.implicit === true &&
          owner.workstream.status === "active",
      ).length,
      progressPolicy: {
        recommendedUpdateIntervalMs: 10_000,
        recommendedMaxToolStepsWithoutUpdate: 3,
      },
    };
  }

  summary() {
    const nowMs = Date.now();
    const { state } = this.garbageCollect(nowMs);
    const owners = Object.values(state.owners)
      .map((owner) => ({
        ...compactOwner(owner),
        continuity: this.continuityStatus(owner.ownerId, nowMs, state),
      }))
      .filter(
        (owner) =>
          Boolean(owner) &&
          !(
            owner.workstream?.status === "archived" &&
            !owner.checkpoint &&
            owner.connectedTransportCount === 0
          ),
      )
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
    // Do not conflate a recoverable, disconnected checkpoint with an
    // actively executing workstream. Projection only; never mutate history.
    const activityAgeMs=(owner)=>{
      const stamp=Date.parse(owner.workstream?.lastProgressAt ??
        owner.workstream?.updatedAt ?? owner.checkpoint?.updatedAt ??
        owner.updatedAt ?? "");
      return Number.isFinite(stamp)?Math.max(0,nowMs-stamp):Infinity;
    };
    const liveActive=active.filter(owner=>owner.plannerConnected &&
      activityAgeMs(owner)<=5*60_000);
    const staleActive=active.filter(owner=>!owner.plannerConnected &&
      activityAgeMs(owner)>15*60_000);
    const waitingReconnect=active.filter(owner=>!owner.plannerConnected &&
      activityAgeMs(owner)<=15*60_000);
    const readyHandoffs = Object.values(state.handoffs ?? {})
      .filter((handoff) => handoff?.status === "ready")
      .sort(
        (a, b) =>
          Date.parse(b.updatedAt ?? b.createdAt ?? "") -
          Date.parse(a.updatedAt ?? a.createdAt ?? ""),
      );
    return {
      activeCheckpointCount: active.length, // legacy recoverable count
      currentlyActiveCheckpointCount:liveActive.length,
      staleActiveCheckpointCount:staleActive.length,
      waitingReconnectCheckpointCount:waitingReconnect.length,
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
