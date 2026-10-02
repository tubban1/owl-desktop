import { randomUUID } from "node:crypto";

function bounded(value, fallback, minimum, maximum) {
  const numeric = Number(value);
  const resolved = Number.isFinite(numeric) ? numeric : fallback;
  return Math.min(Math.max(resolved, minimum), maximum);
}

function sanitizedError(error) {
  return {
    code: String(error?.code || error?.name || "LOCAL_MCP_FAILED").slice(0, 120),
    message: String(error instanceof Error ? error.message : error).slice(0, 2000),
  };
}

export class CloudMcpCallConsumer {
  constructor({
    cloudClient,
    executor,
    claimantId = `connectivity-host:${randomUUID()}`,
    pollIntervalMs = 1_500,
    leaseMs = 60_000,
    batchLimit = 25,
    random = Math.random,
    setTimeoutImpl = setTimeout,
    clearTimeoutImpl = clearTimeout,
    setIntervalImpl = setInterval,
    clearIntervalImpl = clearInterval,
    completionStore = null,
    onEvent = () => {},
  } = {}) {
    if (!cloudClient) throw new Error("CloudMcpCallConsumer requires cloudClient.");
    if (!executor) throw new Error("CloudMcpCallConsumer requires executor.");
    this.cloudClient = cloudClient;
    this.executor = executor;
    this.claimantId = claimantId;
    this.pollIntervalMs = bounded(pollIntervalMs, 1_500, 100, 60_000);
    this.leaseMs = bounded(leaseMs, 60_000, 5_000, 300_000);
    this.batchLimit = bounded(batchLimit, 25, 1, 100);
    this.random = random;
    this.setTimeoutImpl = setTimeoutImpl;
    this.clearTimeoutImpl = clearTimeoutImpl;
    this.setIntervalImpl = setIntervalImpl;
    this.clearIntervalImpl = clearIntervalImpl;
    this.completionStore = completionStore;
    this.onEvent = onEvent;
    this.running = false;
    this.timer = null;
    this.tickPromise = null;
    this.failureCount = 0;
    this.lastPollAt = null;
    this.lastSuccessAt = null;
    this.lastError = null;
    this.activeCallId = null;
    this.processed = 0;
  }

  async start() {
    if (this.running) return this.snapshot();
    this.running = true;
    // A successful durable queue read is the readiness proof.
    await this.tick();
    if (this.running) this.schedule();
    return this.snapshot();
  }

  async stop() {
    this.running = false;
    if (this.timer) this.clearTimeoutImpl(this.timer);
    this.timer = null;
    await this.tickPromise?.catch(() => undefined);
    return this.snapshot();
  }

  schedule() {
    if (!this.running || this.timer) return;
    const base =
      this.failureCount > 0
        ? Math.min(60_000, this.pollIntervalMs * 2 ** Math.min(this.failureCount, 6))
        : this.pollIntervalMs;
    const jitter = this.failureCount > 0
      ? 0.75 + Math.max(0, Math.min(1, Number(this.random()) || 0)) * 0.5
      : 1;
    const delay = Math.max(50, Math.round(base * jitter));
    this.timer = this.setTimeoutImpl(async () => {
      this.timer = null;
      if (!this.running) return;
      try {
        await this.tick();
      } finally {
        this.schedule();
      }
    }, delay);
    this.timer.unref?.();
  }

  tick() {
    if (this.tickPromise) return this.tickPromise;
    const run = this.runTick();
    this.tickPromise = run.finally(() => {
      this.tickPromise = null;
    });
    return this.tickPromise;
  }

  async runTick() {
    this.lastPollAt = new Date().toISOString();
    try {
      const payload = await this.cloudClient.pullMcpCalls(this.batchLimit);
      const calls = Array.isArray(payload?.calls) ? payload.calls : [];
      this.failureCount = 0;
      this.lastError = null;
      this.lastSuccessAt = new Date().toISOString();
      for (const call of calls) {
        if (!this.running && this.timer !== null) break;
        await this.processCall(call);
      }
      return this.snapshot();
    } catch (error) {
      this.failureCount += 1;
      this.lastError = {
        at: new Date().toISOString(),
        code: String(error?.code || error?.name || "CLOUD_POLL_FAILED").slice(0, 120),
        message: String(error instanceof Error ? error.message : error).slice(0, 500),
      };
      this.onEvent("warn", "Cloud MCP durable poll failed", {
        failureCount: this.failureCount,
        code: this.lastError.code,
      });
      if (!this.running) throw error;
      return this.snapshot();
    }
  }

  async processCall(call) {
    if (!call?.callId || !call?.toolName) return;
    try {
      await this.cloudClient.claimMcpCall(call.callId, {
        claimantId: this.claimantId,
        leaseMs: this.leaseMs,
      });
    } catch (error) {
      if (error?.code === "CONFLICT" || error?.status === 409) return;
      throw error;
    }

    this.activeCallId = call.callId;
    try {
      const replay = await this.completionStore?.get?.(call.callId);
      if (replay?.payload) {
        if (
          replay.requestDigest &&
          call.requestDigest &&
          replay.requestDigest !== call.requestDigest
        ) {
          const error = new Error("Stored MCP completion digest does not match call.");
          error.code = "MCP_COMPLETION_DIGEST_MISMATCH";
          throw error;
        }
        await this.cloudClient.completeMcpCall(call.callId, {
          claimantId: this.claimantId,
          ...replay.payload,
        });
        await this.completionStore?.delete?.(call.callId);
        this.onEvent("info", "Cloud MCP completion replayed without re-execution", {
          callId: call.callId,
          toolName: call.toolName,
        });
        return;
      }

      const controller = new AbortController();
      let lastLeaseProofAt = Date.now();
      let refreshing = false;
      const refreshEveryMs = Math.max(1_000, Math.floor(this.leaseMs / 3));
      const leaseTimer = this.setIntervalImpl(async () => {
        if (refreshing || controller.signal.aborted) return;
        refreshing = true;
        try {
          await this.cloudClient.claimMcpCall(call.callId, {
            claimantId: this.claimantId,
            leaseMs: this.leaseMs,
          });
          lastLeaseProofAt = Date.now();
        } catch (error) {
          this.onEvent("warn", "Cloud MCP claim lease refresh failed", {
            callId: call.callId,
            code: error?.code ?? error?.name ?? "ERROR",
          });
          if (Date.now() - lastLeaseProofAt >= Math.floor(this.leaseMs * 0.7)) {
            const leaseError = new Error("Cloud MCP execution lease could not be renewed safely.");
            leaseError.code = "MCP_CLAIM_LEASE_UNSAFE";
            controller.abort(leaseError);
          }
        } finally {
          refreshing = false;
        }
      }, refreshEveryMs);
      leaseTimer.unref?.();

      let result;
      let executionError = null;
      try {
        result = await this.executor.execute({
          callId: call.callId,
          ownerId: call.ownerId,
          toolName: call.toolName,
          arguments: call.arguments ?? {},
          signal: controller.signal,
        });
      } catch (error) {
        executionError = error;
      } finally {
        this.clearIntervalImpl(leaseTimer);
      }

      if (controller.signal.aborted && controller.signal.reason?.code === "MCP_CLAIM_LEASE_UNSAFE") {
        throw controller.signal.reason;
      }

      const completionPayload = executionError
        ? { error: sanitizedError(executionError) }
        : { result };

      await this.completionStore?.put?.(call.callId, {
        requestDigest: call.requestDigest ?? null,
        payload: completionPayload,
      });

      try {
        await this.cloudClient.completeMcpCall(call.callId, {
          claimantId: this.claimantId,
          ...completionPayload,
        });
        await this.completionStore?.delete?.(call.callId);
        if (!executionError) {
          this.processed += 1;
          this.onEvent("info", "Cloud MCP durable call completed", {
            callId: call.callId,
            toolName: call.toolName,
          });
        }
      } catch (completionError) {
        this.onEvent("warn", "Cloud MCP completion persistence failed", {
          callId: call.callId,
          code: completionError?.code ?? completionError?.name ?? "ERROR",
        });
        throw completionError;
      }
    } finally {
      this.activeCallId = null;
    }
  }

  snapshot() {
    const ready =
      this.running &&
      Boolean(this.lastSuccessAt) &&
      this.failureCount === 0;
    return {
      state: !this.running
        ? "stopped"
        : ready
          ? "ready"
          : this.failureCount > 0
            ? "degraded"
            : "starting",
      ready,
      claimantId: this.claimantId,
      lastPollAt: this.lastPollAt,
      lastSuccessAt: this.lastSuccessAt,
      lastError: this.lastError,
      failureCount: this.failureCount,
      activeCallId: this.activeCallId,
      processed: this.processed,
      executor: this.executor.snapshot?.() ?? null,
    };
  }
}
