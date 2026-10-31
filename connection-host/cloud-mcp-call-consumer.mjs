import { CloudMcpWakeListener } from "./cloud-mcp-wake-listener.mjs";
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

function mcpToolResultError(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  if (result.isError !== true) return null;
  const content = Array.isArray(result.content) ? result.content : [];
  const text = content
    .filter((item) => item && typeof item === "object" && item.type === "text")
    .map((item) => String(item.text ?? ""))
    .filter(Boolean)
    .join("\n");
  const error = new Error(text || "Local MCP tool returned an error.");
  error.code = "LOCAL_MCP_TOOL_ERROR";
  return error;
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
    timingJournal = null,
    maxConcurrentCalls = 3,
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
    this.timingJournal = timingJournal;
    this.maxConcurrentCalls = bounded(maxConcurrentCalls, 3, 1, 8);
    this.activeCalls = new Set();
    this.runningBatches = 0;
    this.onEvent = onEvent;
    this.wakeListener = new CloudMcpWakeListener({
      cloudClient,
      onWake: () => this.wake(),
      onDisconnected: () => {
        if (this.timer) this.clearTimeoutImpl(this.timer);
        this.timer = null;
        this.schedule();
      },
      onEvent,
    });
    this.wakePending = false;
    this.running = false;
    this.timer = null;
    this.tickPromise = null;
    this.wakeEpoch = 0;
    this.forceExecutorProbeAfterWake = false;
    this.failureCount = 0;
    this.lastPollAt = null;
    this.lastSuccessAt = null;
    this.lastError = null;
    this.activeCallId = null;
    this.processed = 0;
    this.lastExecutorProbeAt = null;
    // Lightweight HTTP liveness stays as frequent as the previous check.
    // A full MCP initialize + tools/list is substantially more expensive:
    // 5s Cloud polling once caused a new local MCP transport every 50s,
    // i.e. ~1,728 extra sessions/day even with no tool calls.
    this.executorProbeIntervalMs = Math.max(
      5_000,
      Math.min(60_000, this.pollIntervalMs * 10),
    );
    this.executorFullProbeIntervalMs = Math.max(
      5 * 60_000, this.executorProbeIntervalMs,
    );
  }

  async start() {
    if (this.running) return this.snapshot();
    this.running = true;
    // A successful durable queue read is the readiness proof.
    await this.tick();
    if (this.running) {
      this.wakeListener.start();
      this.schedule();
    }
    return this.snapshot();
  }

  async stop() {
    this.running = false;
    this.wakeListener.stop();
    if (this.timer) this.clearTimeoutImpl(this.timer);
    this.timer = null;
    await this.tickPromise?.catch(() => undefined);
    return this.snapshot();
  }

  schedule() {
    if (!this.running || this.timer) return;
    const baseline = this.wakeListener.connected
      ? Math.max(60_000, this.pollIntervalMs) : this.pollIntervalMs;
    const base =
      this.failureCount > 0
        ? Math.min(60_000, baseline * 2 ** Math.min(this.failureCount, 6))
        : baseline;
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

  markWakePending() {
    this.wakeEpoch += 1;
    this.lastSuccessAt = null;
    this.forceExecutorProbeAfterWake = true;
    this.failureCount = Math.max(1, this.failureCount);
    this.lastError = {
      at: new Date().toISOString(),
      code: "CLOUD_WAKE_REVALIDATION_REQUIRED",
      message: "Cloud MCP reachability must be re-proven after system resume.",
    };
    return this.snapshot();
  }

  async revalidateAfterWake({ alreadyInvalidated = false } = {}) {
    if (!alreadyInvalidated) this.markWakePending();
    await this.tickPromise?.catch(() => undefined);
    if (!this.running) return this.snapshot();
    return this.tick();
  }

  tick() {
    if (this.tickPromise) return this.tickPromise;
    const run = this.runTick();
    this.tickPromise = run.finally(() => {
      this.tickPromise = null;
      if (this.running && this.wakePending) {
        this.wakePending = false;
        queueMicrotask(() => this.wake());
      }
    });
    return this.tickPromise;
  }

  async runTick() {
    const wakeEpoch = this.wakeEpoch;
    this.lastPollAt = new Date().toISOString();
    try {
      await this.ensureExecutorReady(this.forceExecutorProbeAfterWake);
      const payload = await this.cloudClient.pullMcpCalls(this.batchLimit);
      if (wakeEpoch !== this.wakeEpoch) {
        const error = new Error("Pre-resume Cloud poll cannot prove post-resume readiness.");
        error.code = "CLOUD_WAKE_PROOF_STALE";
        throw error;
      }
      const calls = Array.isArray(payload?.calls) ? payload.calls : [];
      this.forceExecutorProbeAfterWake = false;
      this.failureCount = 0;
      this.lastError = null;
      this.lastSuccessAt = new Date().toISOString();
      await this.processBatches(calls);
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

  async ensureExecutorReady(force = false) {
    if (typeof this.executor.probe !== "function") return;
    const snapshot = this.executor.snapshot?.() ?? null;
    const lastProofMs = snapshot?.lastProofAt ? Date.parse(snapshot.lastProofAt) : NaN;
    const fullProofFresh =
      Number.isFinite(lastProofMs) &&
      Date.now() - lastProofMs < this.executorFullProbeIntervalMs &&
      !snapshot?.lastError;
    if (!fullProofFresh || force) {
      await this.executor.probe();
      this.lastExecutorProbeAt = new Date().toISOString();
      return;
    }
    const lastLightweightMs = snapshot?.lastLivenessProofAt
      ? Date.parse(snapshot.lastLivenessProofAt) : lastProofMs;
    if (Number.isFinite(lastLightweightMs) &&
        Date.now() - lastLightweightMs < this.executorProbeIntervalMs) return;
    if (typeof this.executor.probeLightweight === "function") {
      await this.executor.probeLightweight();
    } else {
      // Older mock/custom executors retain the previous full-proof behavior.
      await this.executor.probe();
    }
    this.lastExecutorProbeAt = new Date().toISOString();
  }

  // Explicit workstream IDs partition independent queues. Missing or invalid
  // identity is conservatively serialized as one legacy stream, so unrelated
  // calls cannot bypass the historical order/authorization contract.
  workstreamKey(call) {
    const value = call?.arguments?.workstream_id ??
      call?.arguments?.workstreamId ?? call?.workstreamId;
    return typeof value === "string" &&
      /^owl-workstream:[a-zA-Z0-9_-]{8,100}$/.test(value)
      ? value : "__legacy_sequential__";
  }

  async processBatches(calls) {
    const groups = new Map();
    for (const call of calls) {
      if (!call?.callId || !call?.toolName) continue;
      const key = this.workstreamKey(call);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(call);
    }
    const queues = [...groups.values()];
    let next = 0;
    const failures = [];
    const workers = Array.from({ length: Math.min(this.maxConcurrentCalls, queues.length) }, async () => {
      while (next < queues.length) {
        const queue = queues[next++];
        for (const call of queue) {
          try { await this.processCall(call); }
          catch (error) {
            failures.push(error);
            this.onEvent("warn", "Cloud MCP workstream call failed", {
              code: String(error?.code || error?.name || "CLOUD_CALL_FAILED").slice(0, 100),
              traceId: call.callId,
            });
            // Do not jump over an unacknowledged call in the same workstream.
            // A later poll will retry it with its original idempotency key.
            break;
          }
        }
      }
    });
    await Promise.all(workers);
    if (failures.length) throw failures[0];
  }

  // An authenticated online notification can wake this consumer without
  // changing its periodic fault-recovery schedule. A missed hint is safe:
  // the next scheduled poll still retrieves the durable queue.
  wake() {
    if (!this.running) return false;
    if (this.tickPromise) {
      this.wakePending = true;
      return true;
    }
    if (this.timer !== null) {
      this.clearTimeoutImpl(this.timer);
      this.timer = null;
    }
    if (!this.tickPromise) {
      void this.tick().catch(() => undefined).finally(() => this.schedule());
    } else {
      this.schedule();
    }
    return true;
  }

  async processCall(call) {
    if (!call?.callId || !call?.toolName) return;
    const traceStarted = performance.now();
    const traceId = call.callId;
    const recordTiming = (phase, extra = {}) => this.timingJournal?.record({
      traceId, phase, tool: call.toolName,
      ...extra,
    });
    let claimDoneAt = traceStarted;
    try {
      const claimReceipt = await this.cloudClient.claimMcpCall(call.callId, {
        claimantId: this.claimantId,
        leaseMs: this.leaseMs,
      });
      claimDoneAt = performance.now();
      recordTiming("cloud_claimed", {
        queueMs: call.createdAt ? Math.max(0, Date.now() - Date.parse(call.createdAt)) : undefined,
        totalMs: Math.round(claimDoneAt - traceStarted),
      });
    } catch (error) {
      if (error?.code === "CONFLICT" || error?.status === 409) return;
      throw error;
    }

    this.activeCallId = call.callId;
    this.activeCalls.add(call.callId);
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
      let localTiming = null;
      const executionStart = performance.now();
      try {
        result = await this.executor.execute({
          callId: call.callId,
          ownerId: call.ownerId,
          toolName: call.toolName,
          arguments: call.arguments ?? {},
          signal: controller.signal,
          traceId,
          onTiming: (timing) => { localTiming = timing; },
        });
        executionError = mcpToolResultError(result);
      } catch (error) {
        executionError = error;
      } finally {
        this.clearIntervalImpl(leaseTimer);
        recordTiming("local_execution_finished", {
          executeMs: performance.now() - executionStart,
        });
      }

      if (controller.signal.aborted && controller.signal.reason?.code === "MCP_CLAIM_LEASE_UNSAFE") {
        throw controller.signal.reason;
      }

      const executionTiming = {
        connectMs: Math.max(0, Math.round(localTiming?.connectMs ??
          performance.now() - executionStart)),
        executeMs: Math.max(0, Math.round(localTiming?.toolMs ??
          performance.now() - executionStart)),
        deviceQueueMs: Math.max(0, Math.round(executionStart - claimDoneAt)),
      };
      // Cloud validates upper bounds and accepts only durations.
      for (const key of Object.keys(executionTiming)) {
        executionTiming[key] = Math.min(600_000, executionTiming[key]);
      }
      const completionPayload = executionError
        ? { error: sanitizedError(executionError), executionTiming }
        : { result, executionTiming };

      const containsNativeImage = !executionError &&
        Array.isArray(result?.content) &&
        result.content.some((block) => block?.type === "image");
      // Image bytes are private user content. Read_image is idempotent,
      // so we can safely retry it rather than persist image Base64 to
      // the local unencrypted Cloud MCP completion journal.
      if (containsNativeImage && call.toolName !== "read_image") {
        const error = new Error("Native image responses from other tools require explicit binary transport support.");
        error.code = "UNSUPPORTED_BINARY_COMPLETION";
        throw error;
      }
      if (!containsNativeImage) {
        await this.completionStore?.put?.(call.callId, {
          requestDigest: call.requestDigest ?? null,
          payload: completionPayload,
        });
      } else {
        this.onEvent("info", "Cloud MCP read-only image forwarded without local binary journal", {
          callId: call.callId,
          toolName: call.toolName,
          imageCount: result.content.filter((block) => block?.type === "image").length,
        });
      }

      try {
        await this.cloudClient.completeMcpCall(call.callId, {
          claimantId: this.claimantId,
          ...completionPayload,
        });
        await this.completionStore?.delete?.(call.callId);
        recordTiming("cloud_completion_acknowledged", {
          totalMs: performance.now() - traceStarted,
        });
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
      this.activeCalls.delete(call.callId);
      this.activeCallId = this.activeCalls.values().next().value ?? null;
    }
  }

  snapshot() {
    const executor = this.executor.snapshot?.() ?? null;
    const executorReady =
      executor === null ||
      (Boolean(executor.lastProofAt) && !executor.lastError);
    const ready =
      this.running &&
      Boolean(this.lastSuccessAt) &&
      this.failureCount === 0 &&
      executorReady;
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
      activeCallIds: [...this.activeCalls],
      maxConcurrentCalls: this.maxConcurrentCalls,
      wakeChannel: this.wakeListener.snapshot(),
      processed: this.processed,
      executorReady,
      lastExecutorProbeAt: this.lastExecutorProbeAt,
      executor,
    };
  }
}
