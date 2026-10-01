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

  noteTransportConnected(
    ownerId,
    transportSessionId,
    now = new Date().toISOString(),
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
    };
    owner.updatedAt = now;
    this.trimTransports(owner);
    this.write(state);
    return compactOwner(owner);
  }

  noteTransportActivity(
    ownerId,
    transportSessionId,
    now = new Date().toISOString(),
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
    };
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

  summary() {
    const owners = Object.values(this.read().owners).map(compactOwner);
    const active = owners
      .filter(
        (owner) =>
          owner?.checkpoint &&
          owner.checkpoint.status !== "completed",
      )
      .sort(
        (a, b) =>
          Date.parse(b.checkpoint.updatedAt ?? "") -
          Date.parse(a.checkpoint.updatedAt ?? ""),
      );
    return {
      activeCheckpointCount: active.length,
      connectedOwnerCount: owners.filter((owner) => owner.plannerConnected).length,
      latestActive: active[0] ?? null,
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
