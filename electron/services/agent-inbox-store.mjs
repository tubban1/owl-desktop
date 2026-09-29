import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const PRIORITIES = ["low", "normal", "high", "urgent"];
const PRODUCERS = ["desktop", "runtime", "cloud", "worker"];
const STATUSES = ["pending", "claimed", "completed", "cancelled"];

function nowIso(now = new Date()) {
  return now.toISOString();
}

function bounded(value, max = 160) {
  const text = String(value ?? "");
  return text.length <= max ? text : text.slice(0, max);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), { mode: 0o600 });
}

function emptyState() {
  return {
    version: 1,
    requests: {},
  };
}

function sanitizeStringArray(values, maxItems = 32, itemMax = 120) {
  if (!Array.isArray(values)) return [];
  return values
    .filter((item) => typeof item === "string" && item.trim())
    .slice(0, maxItems)
    .map((item) => bounded(item, itemMax));
}

function sanitizeRefs(values) {
  if (!Array.isArray(values)) return [];
  return values
    .filter((item) => item && typeof item === "object")
    .slice(0, 24)
    .map((item) => ({
      kind: bounded(item.kind, 80),
      id: bounded(item.id, 180),
      ...(item.revision !== undefined
        ? { revision: bounded(item.revision, 80) }
        : {}),
    }))
    .filter((item) => item.kind && item.id);
}

function priorityRank(priority) {
  return PRIORITIES.indexOf(priority);
}

function isExpiredClaim(request, nowMs) {
  if (request.status !== "claimed") return false;
  if (!request.claim?.leaseExpiresAt) return true;
  return new Date(request.claim.leaseExpiresAt).getTime() <= nowMs;
}

function normalizeInput(input) {
  if (!input || typeof input !== "object") {
    throw new Error("AgentRequest input must be an object.");
  }

  const type = bounded(input.type, 120);
  if (!type || !/^[a-z0-9][a-z0-9_.-]*$/i.test(type)) {
    throw new Error("AgentRequest type is invalid.");
  }

  const producer = PRODUCERS.includes(input.producer)
    ? input.producer
    : "desktop";

  const priority = PRIORITIES.includes(input.priority)
    ? input.priority
    : "normal";

  const subject =
    input.subject && typeof input.subject === "object"
      ? {
          kind: bounded(input.subject.kind, 80),
          id: bounded(input.subject.id, 180),
          ...(input.subject.revision !== undefined
            ? { revision: bounded(input.subject.revision, 80) }
            : {}),
        }
      : null;

  if (!subject?.kind || !subject?.id) {
    throw new Error("AgentRequest subject.kind and subject.id are required.");
  }

  return {
    type,
    producer,
    priority,
    subject,
    reasonCode: bounded(input.reasonCode || "UNSPECIFIED", 100),
    errorCodes: sanitizeStringArray(input.errorCodes, 32, 100),
    contextRefs: sanitizeRefs(input.contextRefs),
    allowedActions: sanitizeStringArray(input.allowedActions, 32, 120),
    requiresUserConfirmation: input.requiresUserConfirmation !== false,
    ...(input.correlationId
      ? { correlationId: bounded(input.correlationId, 180) }
      : {}),
    ...(input.dedupeKey ? { dedupeKey: bounded(input.dedupeKey, 220) } : {}),
    ...(input.availableAt
      ? { availableAt: new Date(input.availableAt).toISOString() }
      : {}),
    ...(input.expiresAt
      ? { expiresAt: new Date(input.expiresAt).toISOString() }
      : {}),
  };
}

export class AgentInboxStore {
  constructor({ file }) {
    this.file = file;
  }

  read() {
    const value = readJson(this.file, emptyState());
    if (
      value?.version !== 1 ||
      !value.requests ||
      typeof value.requests !== "object"
    ) {
      return emptyState();
    }
    return value;
  }

  write(state) {
    writeJson(this.file, state);
  }

  recoverExpiredClaims(now = new Date()) {
    const state = this.read();
    const nowMs = now.getTime();
    let changed = false;

    for (const request of Object.values(state.requests)) {
      if (!isExpiredClaim(request, nowMs)) continue;
      request.status = "pending";
      request.claim = null;
      request.updatedAt = nowIso(now);
      changed = true;
    }

    if (changed) this.write(state);
  }

  create(input, now = new Date()) {
    const normalized = normalizeInput(input);
    const state = this.read();
    const timestamp = nowIso(now);

    if (normalized.dedupeKey) {
      const existing = Object.values(state.requests).find(
        (request) =>
          request.dedupeKey === normalized.dedupeKey &&
          !["completed", "cancelled"].includes(request.status),
      );
      if (existing) return { created: false, request: existing };
    }

    const requestId = `ar_${randomUUID()}`;
    const request = {
      requestId,
      ...normalized,
      status: "pending",
      claim: null,
      resolution: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    state.requests[requestId] = request;
    this.write(state);
    return { created: true, request };
  }

  get(requestId) {
    this.recoverExpiredClaims();
    return this.read().requests[requestId] ?? null;
  }

  list({
    statuses = ["pending", "claimed"],
    limit = 50,
    ownerId,
    now = new Date(),
  } = {}) {
    this.recoverExpiredClaims(now);
    const state = this.read();
    const nowMs = now.getTime();
    const allowed = new Set(
      (Array.isArray(statuses) ? statuses : [statuses])
        .filter((status) => STATUSES.includes(status)),
    );

    return Object.values(state.requests)
      .filter((request) => allowed.has(request.status))
      .filter((request) => {
        if (request.availableAt) {
          if (new Date(request.availableAt).getTime() > nowMs) return false;
        }
        if (request.expiresAt) {
          if (new Date(request.expiresAt).getTime() <= nowMs) return false;
        }
        if (
          request.status === "claimed" &&
          ownerId &&
          request.claim?.ownerId !== ownerId
        ) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        const priorityDelta =
          priorityRank(b.priority) - priorityRank(a.priority);
        if (priorityDelta !== 0) return priorityDelta;
        return String(a.createdAt).localeCompare(String(b.createdAt));
      })
      .slice(0, Math.min(Math.max(Number(limit) || 50, 1), 200));
  }

  summary(now = new Date()) {
    this.recoverExpiredClaims(now);
    const state = this.read();
    const nowMs = now.getTime();
    const pending = [];
    const claimed = [];

    for (const request of Object.values(state.requests)) {
      if (
        request.expiresAt &&
        new Date(request.expiresAt).getTime() <= nowMs
      ) {
        continue;
      }
      if (
        request.availableAt &&
        new Date(request.availableAt).getTime() > nowMs
      ) {
        continue;
      }
      if (request.status === "pending") pending.push(request);
      if (request.status === "claimed") claimed.push(request);
    }

    const highestPriority = pending.length
      ? pending
          .map((item) => item.priority)
          .sort((a, b) => priorityRank(b) - priorityRank(a))[0]
      : null;

    const byType = {};
    for (const request of pending) {
      byType[request.type] = (byType[request.type] ?? 0) + 1;
    }

    return {
      pending: pending.length,
      claimed: claimed.length,
      highestPriority,
      byType,
    };
  }

  claim(
    requestId,
    {
      ownerId,
      ownerStable = false,
      leaseSeconds = 900,
      now = new Date(),
    },
  ) {
    if (!ownerId) throw new Error("AgentRequest claim owner is required.");
    this.recoverExpiredClaims(now);

    const state = this.read();
    const request = state.requests[requestId];
    if (!request) throw new Error("AgentRequest not found.");

    if (["completed", "cancelled"].includes(request.status)) {
      throw new Error(`AgentRequest is already ${request.status}.`);
    }

    if (
      request.status === "claimed" &&
      request.claim?.ownerId !== ownerId
    ) {
      throw new Error("AgentRequest is already claimed by another agent.");
    }

    const boundedLeaseSeconds = Math.min(
      Math.max(Number(leaseSeconds) || 900, 60),
      3600,
    );

    request.status = "claimed";
    request.claim = {
      ownerId: bounded(ownerId, 220),
      ownerStable: ownerStable === true,
      claimedAt: request.claim?.claimedAt ?? nowIso(now),
      leaseExpiresAt: new Date(
        now.getTime() + boundedLeaseSeconds * 1000,
      ).toISOString(),
    };
    request.updatedAt = nowIso(now);
    this.write(state);
    return request;
  }

  release(requestId, { ownerId, now = new Date() }) {
    const state = this.read();
    const request = state.requests[requestId];
    if (!request) throw new Error("AgentRequest not found.");
    if (request.status !== "claimed") return request;
    if (request.claim?.ownerId !== ownerId) {
      throw new Error("Only the claiming agent may release AgentRequest.");
    }

    request.status = "pending";
    request.claim = null;
    request.updatedAt = nowIso(now);
    this.write(state);
    return request;
  }

  complete(
    requestId,
    {
      ownerId,
      outcome = "completed",
      resultRef,
      now = new Date(),
    },
  ) {
    const state = this.read();
    const request = state.requests[requestId];
    if (!request) throw new Error("AgentRequest not found.");

    if (request.status === "completed") return request;
    if (request.status !== "claimed") {
      throw new Error("AgentRequest must be claimed before completion.");
    }
    if (request.claim?.ownerId !== ownerId) {
      throw new Error("Only the claiming agent may complete AgentRequest.");
    }

    request.status = "completed";
    request.resolution = {
      outcome: bounded(outcome, 80),
      ...(resultRef ? { resultRef: bounded(resultRef, 220) } : {}),
      completedAt: nowIso(now),
    };
    request.updatedAt = nowIso(now);
    this.write(state);
    return request;
  }

  cancel(requestId, { reasonCode = "CANCELLED", now = new Date() } = {}) {
    const state = this.read();
    const request = state.requests[requestId];
    if (!request) throw new Error("AgentRequest not found.");

    request.status = "cancelled";
    request.claim = null;
    request.resolution = {
      outcome: bounded(reasonCode, 80),
      completedAt: nowIso(now),
    };
    request.updatedAt = nowIso(now);
    this.write(state);
    return request;
  }
}
