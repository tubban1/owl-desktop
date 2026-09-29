import fs from "node:fs";
import path from "node:path";

const AGENT_REQUEST_EVENT_TYPES = [
  "agent_request.proposed",
  "agent_request.withdrawn",
];

const RECONCILIATION_CODES = new Set([
  "CURSOR_EXPIRED",
  "CURSOR_AHEAD",
  "PUBLIC_EVENT_JOURNAL_CORRUPT",
  "AGENT_REQUEST_EVENT_GAP",
  "AGENT_REQUEST_EVENT_SEQUENCE_CONFLICT",
  "AGENT_REQUEST_DEDUPE_COLLISION",
  "AGENT_REQUEST_CONSUMER_STATE_INVALID",
  "RUNTIME_EVENT_PAGE_INVALID",
  "RUNTIME_EVENT_PAGE_CURSOR_MISMATCH",
  "LOCAL_RUNTIME_EVENT_CHECKPOINT_MISSING",
  "EVENT_LIST_TYPE_FILTER_INCOMPLETE_CHANNEL",
]);

function nowIso() {
  return new Date().toISOString();
}

function emptyState() {
  return {
    version: 1,
    status: "stopped",
    supported: null,
    lastPollAt: null,
    lastSuccessAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    acceptedEvents: 0,
    acceptedPages: 0,
    retention: null,
    reconciliation: null,
    updatedAt: nowIso(),
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

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function extensionVersion(capabilities, name) {
  const raw = capabilities?.extensions?.[name]?.version;
  const value = Number(raw ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function errorCode(error) {
  if (typeof error?.code === "string" && error.code.trim()) {
    return error.code.trim();
  }
  const message = error instanceof Error ? error.message : String(error);
  const match = /^([A-Z][A-Z0-9_]{2,100})(?::|\b)/.exec(message);
  return match?.[1] ?? "RUNTIME_EVENT_SYNC_FAILED";
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function parseRetentionGap(message) {
  const requested = /requested=(\d+)/.exec(message)?.[1];
  const oldest = /oldestRetained=(\d+)/.exec(message)?.[1];
  return {
    ...(requested ? { requestedSequence: Number(requested) } : {}),
    ...(oldest ? { oldestRetainedSequence: Number(oldest) } : {}),
  };
}

function validatePage(value) {
  const page = asObject(value);
  if (
    !page ||
    !Array.isArray(page.events) ||
    typeof page.nextCursor !== "string" ||
    typeof page.hasMore !== "boolean"
  ) {
    const error = new Error(
      "RUNTIME_EVENT_PAGE_INVALID: events.list returned an invalid page.",
    );
    error.code = "RUNTIME_EVENT_PAGE_INVALID";
    throw error;
  }

  if (page.retention !== undefined && page.retention !== null) {
    const retention = asObject(page.retention);
    if (
      !retention ||
      retention.strategy !== "count" ||
      !Number.isSafeInteger(retention.maxEvents)
    ) {
      const error = new Error(
        "RUNTIME_EVENT_PAGE_INVALID: retention metadata is invalid.",
      );
      error.code = "RUNTIME_EVENT_PAGE_INVALID";
      throw error;
    }
  }

  return page;
}

function isIntegrityError(code) {
  return (
    RECONCILIATION_CODES.has(code) ||
    code.startsWith("AGENT_REQUEST_EVENT_") ||
    code.startsWith("AGENT_REQUEST_CONSUMER_") ||
    code.startsWith("RUNTIME_EVENT_PAGE_")
  );
}

export class RuntimeAgentRequestEventBridge {
  constructor({
    client,
    consumer,
    inbox,
    stateFile,
    pollIntervalMs = 3000,
    pageLimit = 100,
    maxPagesPerSync = 20,
    onEvent,
  }) {
    if (!client) throw new Error("Runtime event bridge requires client.");
    if (!consumer) throw new Error("Runtime event bridge requires consumer.");
    if (!inbox) throw new Error("Runtime event bridge requires inbox.");
    if (!stateFile) throw new Error("Runtime event bridge requires stateFile.");

    this.client = client;
    this.consumer = consumer;
    this.inbox = inbox;
    this.stateFile = stateFile;
    this.pollIntervalMs = Math.min(
      Math.max(Number(pollIntervalMs) || 3000, 500),
      60_000,
    );
    this.pageLimit = Math.min(
      Math.max(Number(pageLimit) || 100, 1),
      500,
    );
    this.maxPagesPerSync = Math.min(
      Math.max(Number(maxPagesPerSync) || 20, 1),
      100,
    );
    this.onEvent = typeof onEvent === "function" ? onEvent : () => {};
    this.running = false;
    this.timer = null;
    this.syncing = null;
  }

  readState() {
    let state;
    try {
      state = readJson(this.stateFile, emptyState());
    } catch (error) {
      const wrapped = new Error(
        "RUNTIME_EVENT_BRIDGE_STATE_INVALID: " + errorMessage(error),
      );
      wrapped.code = "RUNTIME_EVENT_BRIDGE_STATE_INVALID";
      throw wrapped;
    }
    if (
      state?.version !== 1 ||
      typeof state.status !== "string" ||
      !(
        state.supported === null ||
        typeof state.supported === "boolean"
      ) ||
      !Number.isSafeInteger(state.acceptedEvents) ||
      state.acceptedEvents < 0 ||
      !Number.isSafeInteger(state.acceptedPages) ||
      state.acceptedPages < 0
    ) {
      const error = new Error("RUNTIME_EVENT_BRIDGE_STATE_INVALID");
      error.code = "RUNTIME_EVENT_BRIDGE_STATE_INVALID";
      throw error;
    }
    return state;
  }

  writeState(state) {
    state.updatedAt = nowIso();
    writeJsonAtomic(this.stateFile, state);
  }

  consumerPosition() {
    try {
      const state = this.consumer.readState();
      return {
        lastSequence: state.lastSequence,
        lastCursor: state.lastCursor,
      };
    } catch (error) {
      return {
        lastSequence: null,
        lastCursor: null,
        error: errorMessage(error),
      };
    }
  }

  snapshot() {
    let state;
    try {
      state = this.readState();
    } catch (error) {
      state = {
        ...emptyState(),
        status: "needs_attention",
        lastErrorCode: errorCode(error),
        lastErrorMessage: errorMessage(error),
        reconciliation: {
          reasonCode: errorCode(error),
          message: errorMessage(error),
          detectedAt: nowIso(),
          savedCursor: null,
          savedSequence: null,
        },
      };
    }
    return {
      ...state,
      running: this.running,
      pollIntervalMs: this.pollIntervalMs,
      consumer: this.consumerPosition(),
    };
  }

  async detectSupport() {
    const capabilities = await this.client.capabilities(
      "public runtime events agent request",
    );
    return (
      extensionVersion(capabilities, "publicEventJournal") >= 1 &&
      extensionVersion(capabilities, "agentRequestProducer") >= 1
    );
  }

  hasRuntimeInboxHistory(now = new Date()) {
    this.inbox.recoverExpiredClaims(now);
    const state = this.inbox.read();
    return Object.values(state?.requests ?? {}).some(
      (request) => request?.producer === "runtime",
    );
  }

  markReconciliation(error, state, extra = {}) {
    const code = errorCode(error);
    const message = errorMessage(error);
    const position = this.consumerPosition();
    const previous = state.reconciliation;

    state.status = "needs_attention";
    state.lastErrorCode = code;
    state.lastErrorMessage = message;
    state.reconciliation = {
      reasonCode: code,
      message,
      detectedAt: previous?.detectedAt ?? nowIso(),
      lastObservedAt: nowIso(),
      savedCursor: position.lastCursor ?? null,
      savedSequence: position.lastSequence ?? null,
      ...parseRetentionGap(message),
      ...extra,
    };
    this.writeState(state);
    this.onEvent("warn", "Runtime event reconciliation required", {
      code,
      cursor: position.lastCursor ?? null,
      sequence: position.lastSequence ?? null,
    });
    return this.snapshot();
  }

  async syncOnce({ forceRetry = false } = {}) {
    if (this.syncing) return await this.syncing;

    this.syncing = this.#syncOnce({ forceRetry }).finally(() => {
      this.syncing = null;
    });
    return await this.syncing;
  }

  async #syncOnce({ forceRetry }) {
    let state;
    try {
      state = this.readState();
    } catch (error) {
      state = emptyState();
      return this.markReconciliation(error, state);
    }

    if (state.reconciliation && !forceRetry) {
      return this.snapshot();
    }

    state.lastPollAt = nowIso();

    try {
      const supported = await this.detectSupport();
      state.supported = supported;

      if (!supported) {
        if (state.reconciliation) {
          state.status = "needs_attention";
          state.supported = false;
          state.lastErrorCode = state.reconciliation.reasonCode;
          state.lastErrorMessage = state.reconciliation.message;
          state.reconciliation.lastObservedAt = nowIso();
        } else {
          state.status = "unsupported";
          state.lastErrorCode = null;
          state.lastErrorMessage = null;
        }
        this.writeState(state);
        return this.snapshot();
      }

      let position;
      try {
        position = this.consumer.readState();
      } catch (error) {
        return this.markReconciliation(error, state);
      }

      if (
        position.lastCursor === null &&
        position.lastSequence === null &&
        this.hasRuntimeInboxHistory()
      ) {
        const error = new Error(
          "LOCAL_RUNTIME_EVENT_CHECKPOINT_MISSING: Runtime-produced AgentRequest history exists but the durable Runtime event cursor is empty.",
        );
        error.code = "LOCAL_RUNTIME_EVENT_CHECKPOINT_MISSING";
        return this.markReconciliation(error, state);
      }

      let pages = 0;
      let totalAccepted = 0;

      while (pages < this.maxPagesPerSync) {
        const before = this.consumer.readState();
        const afterCursor = before.lastCursor ?? undefined;
        let page;
        try {
          page = validatePage(
            await this.client.listEvents({
              ...(afterCursor ? { afterCursor } : {}),
              limit: this.pageLimit,
              types: AGENT_REQUEST_EVENT_TYPES,
            }),
          );
        } catch (error) {
          const code = errorCode(error);
          if (isIntegrityError(code)) {
            return this.markReconciliation(error, state);
          }
          throw error;
        }

        for (const event of page.events) {
          try {
            const result = this.consumer.consume(event);
            if (result?.status !== "duplicate") totalAccepted += 1;
          } catch (error) {
            return this.markReconciliation(error, state, {
              pageNextCursor: page.nextCursor,
            });
          }
        }

        const after = this.consumer.readState();
        if (
          page.events.length > 0 &&
          after.lastCursor !== page.nextCursor
        ) {
          const error = new Error(
            `RUNTIME_EVENT_PAGE_CURSOR_MISMATCH: accepted=${after.lastCursor ?? "null"} page=${page.nextCursor}`,
          );
          error.code = "RUNTIME_EVENT_PAGE_CURSOR_MISMATCH";
          return this.markReconciliation(error, state, {
            pageNextCursor: page.nextCursor,
          });
        }
        if (
          page.events.length === 0 &&
          afterCursor &&
          page.nextCursor !== afterCursor
        ) {
          const error = new Error(
            `RUNTIME_EVENT_PAGE_CURSOR_MISMATCH: empty page moved cursor from ${afterCursor} to ${page.nextCursor}`,
          );
          error.code = "RUNTIME_EVENT_PAGE_CURSOR_MISMATCH";
          return this.markReconciliation(error, state, {
            pageNextCursor: page.nextCursor,
          });
        }

        pages += 1;
        state.acceptedPages += 1;
        state.acceptedEvents += page.events.length;
        state.retention = page.retention ?? null;

        if (!page.hasMore) break;
      }

      if (pages >= this.maxPagesPerSync) {
        this.onEvent("warn", "Runtime event sync reached page budget", {
          maxPagesPerSync: this.maxPagesPerSync,
        });
      }

      state.status = "healthy";
      state.supported = true;
      state.lastSuccessAt = nowIso();
      state.lastErrorCode = null;
      state.lastErrorMessage = null;
      state.reconciliation = null;
      this.writeState(state);

      if (totalAccepted > 0) {
        this.onEvent("info", "Runtime AgentRequest events consumed", {
          accepted: totalAccepted,
          pages,
          cursor: this.consumerPosition().lastCursor,
        });
      }

      return this.snapshot();
    } catch (error) {
      const code = errorCode(error);
      if (isIntegrityError(code)) {
        return this.markReconciliation(error, state);
      }
      if (state.reconciliation) {
        state.status = "needs_attention";
        state.lastErrorCode = code;
        state.lastErrorMessage = errorMessage(error);
        state.reconciliation.lastObservedAt = nowIso();
      } else {
        state.status = "degraded";
        state.lastErrorCode = code;
        state.lastErrorMessage = errorMessage(error);
      }
      this.writeState(state);
      this.onEvent("warn", "Runtime event sync degraded", {
        code,
        message: state.lastErrorMessage,
        reconciliationPreserved: Boolean(state.reconciliation),
      });
      return this.snapshot();
    }
  }

  #schedule() {
    if (!this.running) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(async () => {
      try {
        await this.syncOnce();
      } finally {
        this.#schedule();
      }
    }, this.pollIntervalMs);
    this.timer.unref?.();
  }

  async start() {
    if (this.running) return this.snapshot();
    this.running = true;
    const result = await this.syncOnce();
    this.#schedule();
    return result;
  }

  async retrySavedCursor() {
    return await this.syncOnce({ forceRetry: true });
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
    this.timer = null;

    let state;
    try {
      state = this.readState();
    } catch {
      return this.snapshot();
    }
    if (state.status !== "needs_attention") {
      state.status = "stopped";
      this.writeState(state);
    }
    return this.snapshot();
  }
}

export { AGENT_REQUEST_EVENT_TYPES };
