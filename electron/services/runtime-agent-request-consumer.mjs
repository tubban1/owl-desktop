import fs from "node:fs";
import path from "node:path";

const EVENT_TYPES = new Set([
  "agent_request.proposed",
  "agent_request.withdrawn",
]);
const PRIORITIES = new Set(["low", "normal", "high", "urgent"]);
const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_.:-]*$/;
const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9_.:-]*$/i;

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function assertAllowedKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new Error(`${label} contains unsupported field "${key}".`);
    }
  }
}

function requiredString(value, label, max = 220, pattern) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  const normalized = value.trim();
  if (normalized.length > max) {
    throw new Error(`${label} exceeds ${max} characters.`);
  }
  if (pattern && !pattern.test(normalized)) {
    throw new Error(`${label} has an invalid format.`);
  }
  return normalized;
}

function optionalString(value, label, max = 220, pattern) {
  if (value === undefined) return undefined;
  return requiredString(value, label, max, pattern);
}

function requiredIsoTimestamp(value, label) {
  const input = requiredString(value, label, 80);
  const timestamp = new Date(input);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error(`${label} must be an ISO timestamp.`);
  }
  return timestamp.toISOString();
}

function parsePosition(input) {
  let sequence;
  let cursor;

  if (input.sequence !== undefined) {
    if (!Number.isSafeInteger(input.sequence) || input.sequence < 0) {
      throw new Error("AgentRequest event sequence must be a non-negative safe integer.");
    }
    sequence = input.sequence;
  }

  if (input.cursor !== undefined) {
    cursor = requiredString(input.cursor, "AgentRequest event cursor", 220);
  }

  if (sequence === undefined && cursor === undefined) {
    throw new Error("AgentRequest event requires sequence or cursor.");
  }

  return {
    ...(sequence !== undefined ? { sequence } : {}),
    ...(cursor !== undefined ? { cursor } : {}),
  };
}

function parseSubject(value) {
  const subject = assertObject(value, "AgentRequest subject");
  assertAllowedKeys(
    subject,
    new Set(["kind", "id", "revision"]),
    "AgentRequest subject",
  );

  return {
    kind: requiredString(
      subject.kind,
      "AgentRequest subject.kind",
      80,
      IDENTIFIER_PATTERN,
    ),
    id: requiredString(subject.id, "AgentRequest subject.id", 180),
    ...(subject.revision !== undefined
      ? {
          revision: requiredString(
            String(subject.revision),
            "AgentRequest subject.revision",
            80,
          ),
        }
      : {}),
  };
}

function parseRefs(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 24) {
    throw new Error("AgentRequest contextRefs must contain at most 24 items.");
  }
  return value.map((item) => parseSubject(item));
}

function parseStringList(value, label, { maxItems = 32, maxLength = 120, pattern } = {}) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new Error(`${label} must contain at most ${maxItems} items.`);
  }
  return value.map((item, index) =>
    requiredString(item, `${label}[${index}]`, maxLength, pattern),
  );
}

function parseCommon(input) {
  const eventType = requiredString(
    input.eventType,
    "AgentRequest eventType",
    80,
    IDENTIFIER_PATTERN,
  );
  if (!EVENT_TYPES.has(eventType)) {
    throw new Error(`Unsupported AgentRequest eventType "${eventType}".`);
  }

  return {
    eventType,
    eventId: requiredString(input.eventId, "AgentRequest eventId", 200),
    proposalId: requiredString(
      input.proposalId,
      "AgentRequest proposalId",
      200,
    ),
    ...parsePosition(input),
    occurredAt: requiredIsoTimestamp(
      input.occurredAt,
      "AgentRequest occurredAt",
    ),
  };
}

export function parseRuntimeAgentRequestEvent(value) {
  const input = assertObject(value, "Runtime AgentRequest event");
  const common = parseCommon(input);

  if (common.eventType === "agent_request.proposed") {
    assertAllowedKeys(
      input,
      new Set([
        "eventType",
        "eventId",
        "proposalId",
        "sequence",
        "cursor",
        "requestType",
        "priority",
        "subject",
        "reasonCode",
        "errorCodes",
        "contextRefs",
        "allowedActions",
        "requiresUserConfirmation",
        "dedupeKey",
        "occurredAt",
      ]),
      "Runtime AgentRequest proposal",
    );

    const priority = requiredString(
      input.priority,
      "AgentRequest priority",
      20,
      IDENTIFIER_PATTERN,
    );
    if (!PRIORITIES.has(priority)) {
      throw new Error(`Unsupported AgentRequest priority "${priority}".`);
    }
    if (typeof input.requiresUserConfirmation !== "boolean") {
      throw new Error(
        "AgentRequest requiresUserConfirmation must be a boolean.",
      );
    }

    return {
      ...common,
      requestType: requiredString(
        input.requestType,
        "AgentRequest requestType",
        120,
        IDENTIFIER_PATTERN,
      ),
      priority,
      subject: parseSubject(input.subject),
      reasonCode: requiredString(
        input.reasonCode,
        "AgentRequest reasonCode",
        100,
        CODE_PATTERN,
      ),
      errorCodes: parseStringList(input.errorCodes, "AgentRequest errorCodes", {
        maxItems: 32,
        maxLength: 100,
        pattern: CODE_PATTERN,
      }),
      contextRefs: parseRefs(input.contextRefs),
      allowedActions: parseStringList(
        input.allowedActions,
        "AgentRequest allowedActions",
        {
          maxItems: 32,
          maxLength: 120,
          pattern: IDENTIFIER_PATTERN,
        },
      ),
      requiresUserConfirmation: input.requiresUserConfirmation,
      dedupeKey: requiredString(
        input.dedupeKey,
        "AgentRequest dedupeKey",
        220,
      ),
    };
  }

  assertAllowedKeys(
    input,
    new Set([
      "eventType",
      "eventId",
      "proposalId",
      "sequence",
      "cursor",
      "subject",
      "reasonCode",
      "dedupeKey",
      "occurredAt",
    ]),
    "Runtime AgentRequest withdrawal",
  );

  return {
    ...common,
    subject: parseSubject(input.subject),
    reasonCode: requiredString(
      input.reasonCode,
      "AgentRequest withdrawal reasonCode",
      100,
      CODE_PATTERN,
    ),
    dedupeKey: requiredString(
      input.dedupeKey,
      "AgentRequest withdrawal dedupeKey",
      220,
    ),
  };
}

function emptyConsumerState() {
  return {
    version: 1,
    lastSequence: null,
    lastCursor: null,
    events: [],
  };
}

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), {
    mode: 0o600,
  });
  fs.renameSync(temporary, file);
}

function allInboxRequests(inbox, now) {
  inbox.recoverExpiredClaims(now);
  const state = inbox.read();
  return Object.values(state?.requests ?? {});
}

function findMaterialized(inbox, event, now) {
  const sameDedupe = allInboxRequests(inbox, now).filter(
    (request) => request.dedupeKey === event.dedupeKey,
  );

  const collision = sameDedupe.find(
    (request) => request.correlationId !== event.proposalId,
  );
  if (collision) {
    throw new Error(
      `AGENT_REQUEST_DEDUPE_COLLISION:${event.dedupeKey}`,
    );
  }

  return (
    sameDedupe.find(
      (request) => request.correlationId === event.proposalId,
    ) ?? null
  );
}

export class RuntimeAgentRequestEventConsumer {
  constructor({ inbox, stateFile, maxJournalEntries = 1000 }) {
    if (!inbox) throw new Error("Runtime AgentRequest consumer requires inbox.");
    if (!stateFile) {
      throw new Error("Runtime AgentRequest consumer requires stateFile.");
    }
    this.inbox = inbox;
    this.stateFile = stateFile;
    this.maxJournalEntries = Math.min(
      Math.max(Number(maxJournalEntries) || 1000, 100),
      5000,
    );
  }

  readState() {
    const state = readJson(this.stateFile, emptyConsumerState());
    if (
      state?.version !== 1 ||
      !Array.isArray(state.events) ||
      !(
        state.lastSequence === null ||
        (Number.isSafeInteger(state.lastSequence) && state.lastSequence >= 0)
      ) ||
      !(state.lastCursor === null || typeof state.lastCursor === "string")
    ) {
      throw new Error("AGENT_REQUEST_CONSUMER_STATE_INVALID");
    }
    return state;
  }

  writeState(state) {
    writeJsonAtomic(this.stateFile, state);
  }

  noteEvent(
    state,
    event,
    outcome,
    now,
    { advancePosition = true } = {},
  ) {
    if (advancePosition && event.sequence !== undefined) {
      state.lastSequence =
        state.lastSequence === null
          ? event.sequence
          : Math.max(state.lastSequence, event.sequence);
    }
    if (advancePosition && event.cursor !== undefined) {
      state.lastCursor = event.cursor;
    }

    state.events.push({
      eventId: event.eventId,
      eventType: event.eventType,
      proposalId: event.proposalId,
      ...(event.sequence !== undefined ? { sequence: event.sequence } : {}),
      ...(event.cursor !== undefined ? { cursor: event.cursor } : {}),
      occurredAt: event.occurredAt,
      appliedAt: now.toISOString(),
      outcome,
    });
    state.events = state.events.slice(-this.maxJournalEntries);
    this.writeState(state);
  }

  consume(value, now = new Date()) {
    const event = parseRuntimeAgentRequestEvent(value);
    const state = this.readState();

    if (state.events.some((item) => item.eventId === event.eventId)) {
      return {
        status: "duplicate",
        eventId: event.eventId,
        proposalId: event.proposalId,
      };
    }

    if (event.sequence !== undefined && state.lastSequence !== null) {
      if (event.sequence === state.lastSequence) {
        throw new Error(
          `AGENT_REQUEST_EVENT_SEQUENCE_CONFLICT:${event.sequence}`,
        );
      }

      if (event.sequence < state.lastSequence) {
        this.noteEvent(
          state,
          event,
          "stale_sequence_ignored",
          now,
          { advancePosition: false },
        );
        return {
          status: "stale",
          eventId: event.eventId,
          proposalId: event.proposalId,
        };
      }

      if (event.sequence > state.lastSequence + 1) {
        throw new Error(
          `AGENT_REQUEST_EVENT_GAP:${state.lastSequence + 1}:${event.sequence}`,
        );
      }
    }

    if (event.eventType === "agent_request.proposed") {
      const existing = findMaterialized(this.inbox, event, now);
      if (existing) {
        const outcome = `already_materialized:${existing.status}`;
        this.noteEvent(state, event, outcome, now);
        return {
          status: "applied",
          outcome,
          request: existing,
        };
      }

      const created = this.inbox.create(
        {
          type: event.requestType,
          producer: "runtime",
          priority: event.priority,
          subject: event.subject,
          reasonCode: event.reasonCode,
          errorCodes: event.errorCodes,
          contextRefs: event.contextRefs,
          allowedActions: event.allowedActions,
          requiresUserConfirmation: event.requiresUserConfirmation,
          correlationId: event.proposalId,
          dedupeKey: event.dedupeKey,
        },
        now,
      );

      const outcome = created.created
        ? "materialized"
        : `already_materialized:${created.request.status}`;
      this.noteEvent(state, event, outcome, now);
      return {
        status: "applied",
        outcome,
        request: created.request,
      };
    }

    const existing = findMaterialized(this.inbox, event, now);
    if (!existing) {
      const outcome = "withdrawal_without_materialization";
      this.noteEvent(state, event, outcome, now);
      return {
        status: "applied",
        outcome,
        request: null,
      };
    }

    if (existing.status !== "pending") {
      const outcome =
        existing.status === "claimed"
          ? "claimed_not_cancelled"
          : `${existing.status}_not_cancelled`;
      this.noteEvent(state, event, outcome, now);
      return {
        status: "applied",
        outcome,
        request: existing,
      };
    }

    const cancelled = this.inbox.cancel(existing.requestId, {
      reasonCode: `RUNTIME_WITHDRAWN:${event.reasonCode}`,
      now,
    });
    this.noteEvent(state, event, "pending_cancelled", now);
    return {
      status: "applied",
      outcome: "pending_cancelled",
      request: cancelled,
    };
  }
}
