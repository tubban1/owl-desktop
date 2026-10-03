import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { awaitAbortable } from "../../shared/abortable-await.mjs";

export function classifyTunnelDiagnostic(text) {
  const normalized = String(text ?? "").trim();
  if (!normalized) return "info";
  return /\b(warn(?:ing)?|error|failed?|fatal|panic|timeout|timed out|refused|denied|unavailable)\b/i.test(
    normalized,
  )
    ? "warn"
    : "info";
}
import { randomUUID } from "node:crypto";

function safeUnlink(file) {
  if (!file) return;
  try { fs.rmSync(file, { force: true }); } catch {}
}

const boundedMs = (value, fallback, minimum = 10, maximum = 300_000) => {
  const numeric = Number(value);
  const resolved = Number.isFinite(numeric) ? numeric : fallback;
  return Math.min(Math.max(resolved, minimum), maximum);
};

function parseTimestamp(value) {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export class TunnelSupervisor {
  constructor({
    onEvent = () => {},
    fetchImpl = fetch,
    random = Math.random,
    monotonicNow = () => performance.now(),
    restartBaseDelayMs = 1_000,
    restartMaxDelayMs = 30_000,
    healthCheckIntervalMs = 10_000,
    healthRequestTimeoutMs = 2_500,
    healthStartupGraceMs = 45_000,
    healthStaleAfterMs = 90_000,
  } = {}) {
    this.onEvent = onEvent;
    this.fetchImpl = fetchImpl;
    this.random = random;
    this.monotonicNow = monotonicNow;
    this.child = null;
    this.secretFile = null;
    this.healthUrlFile = null;
    this.healthBaseUrl = null;
    this.startedAt = null;
    this.lastExit = null;
    this.config = null;
    this.apiKey = null;
    this.desiredRunning = false;
    this.restartTimer = null;
    this.restartAt = null;
    this.restartAttempts = 0;
    this.recoveryPromise = null;
    this.healthCheckTimer = null;
    this.generation = 0;
    this.activeGeneration = 0;
    this.lastHealthProbeAt = null;
    this.lastHealthOkAt = null;
    this.lastHealthOkMonotonicAtMs = null;
    this.lastControlPlaneOkAt = null;
    this.lastControlPlaneEvidenceValue = null;
    this.lastControlPlaneEvidenceMonotonicAtMs = null;
    this.startedMonotonicAtMs = null;
    this.lastHealthError = null;
    this.consecutiveHealthFailures = 0;
    this.localReady = false;
    this.controlPlaneHealth = null;
    this.reachabilityState = "stopped";
    this.restartBaseDelayMs = boundedMs(restartBaseDelayMs, 1_000);
    this.restartMaxDelayMs = Math.max(
      boundedMs(restartMaxDelayMs, 30_000),
      this.restartBaseDelayMs,
    );
    this.healthCheckIntervalMs = boundedMs(
      healthCheckIntervalMs,
      10_000,
      100,
    );
    this.healthRequestTimeoutMs = boundedMs(
      healthRequestTimeoutMs,
      2_500,
      50,
      30_000,
    );
    this.healthStartupGraceMs = boundedMs(
      healthStartupGraceMs,
      45_000,
      0,
    );
    this.healthStaleAfterMs = Math.max(
      boundedMs(healthStaleAfterMs, 90_000, 1_000),
      this.healthCheckIntervalMs * 2,
    );
  }

  transitionReachability(nextState, reason, meta = {}) {
    const previousState = this.reachabilityState;
    if (previousState === nextState) return false;

    this.reachabilityState = nextState;
    this.onEvent(
      ["degraded", "stale", "recovering", "unreachable"].includes(nextState)
        ? "warn"
        : "info",
      "Tunnel reachability changed",
      {
        from: previousState,
        to: nextState,
        reason,
        localReady: this.localReady,
        controlPlaneStatus: this.controlPlaneHealth?.status ?? null,
        consecutiveFailures: this.consecutiveHealthFailures,
        lastHealthOkAt: this.lastHealthOkAt,
        lastControlPlaneOkAt: this.lastControlPlaneOkAt,
        ...meta,
      },
    );
    return true;
  }

  status() {
    return {
      state: this.child
        ? "running"
        : this.restartTimer
          ? "restarting"
          : "stopped",
      pid: this.child?.pid ?? null,
      generation: this.activeGeneration || null,
      startedAt: this.startedAt,
      lastExit: this.lastExit,
      restartAt: this.restartAt,
      restartAttempts: this.restartAttempts,
      desiredRunning: this.desiredRunning,
      binaryPath: this.config?.binaryPath ?? null,
      tunnelIdConfigured: Boolean(this.config?.tunnelId),
      mcpUrl: this.config?.mcpUrl ?? null,
      controlPlaneBaseUrl: this.config?.controlPlaneBaseUrl ?? null,
      controlPlanePollTimeoutMs: this.config?.pollTimeoutMs ?? null,
      secretStorage: this.child
        ? "ephemeral-file-0600"
        : this.desiredRunning
          ? "memory-until-restart"
          : "os-encrypted-at-rest",
      reachability: {
        state: this.reachabilityState,
        healthUrl: this.healthBaseUrl,
        localReady: this.localReady,
        controlPlane: this.controlPlaneHealth,
        lastProbeAt: this.lastHealthProbeAt,
        lastHealthOkAt: this.lastHealthOkAt,
        lastControlPlaneOkAt: this.lastControlPlaneOkAt,
        consecutiveFailures: this.consecutiveHealthFailures,
        lastError: this.lastHealthError,
        recovering: Boolean(this.recoveryPromise),
      },
    };
  }

  validateConfig({
    binaryPath,
    tunnelId,
    apiKey,
    mcpUrl,
    controlPlaneBaseUrl,
    pollTimeoutMs,
  }) {
    if (!binaryPath || !fs.existsSync(binaryPath)) {
      throw new Error("OWL Tunnel binary is missing.");
    }
    if (!tunnelId?.trim()) {
      throw new Error("OWL Tunnel ID is missing.");
    }
    if (!apiKey) {
      throw new Error("OWL Tunnel API key is missing.");
    }
    if (!mcpUrl?.startsWith("http://127.0.0.1:")) {
      throw new Error("OWL Tunnel MCP target must be loopback.");
    }
    if (controlPlaneBaseUrl) {
      const parsed = new URL(controlPlaneBaseUrl);
      if (parsed.protocol !== "https:") {
        throw new Error("OWL Tunnel control plane must use HTTPS.");
      }
    }
    if (
      pollTimeoutMs !== undefined &&
      (!Number.isFinite(Number(pollTimeoutMs)) ||
        Number(pollTimeoutMs) < 1_000 ||
        Number(pollTimeoutMs) > 20_000)
    ) {
      throw new Error("OWL Tunnel control-plane poll timeout must be 1–20 seconds.");
    }
  }

  clearRestartTimer() {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    this.restartAt = null;
  }

  scheduleRestart() {
    if (!this.desiredRunning || this.child || this.restartTimer || !this.config || !this.apiKey) {
      return;
    }

    const attempt = this.restartAttempts + 1;
    const baseDelayMs = Math.min(
      this.restartMaxDelayMs,
      this.restartBaseDelayMs * 2 ** Math.min(this.restartAttempts, 6),
    );
    const jitter = 0.5 + Math.max(0, Math.min(1, Number(this.random()) || 0));
    const delayMs = Math.min(
      this.restartMaxDelayMs,
      Math.max(10, Math.round(baseDelayMs * jitter)),
    );
    this.restartAttempts = attempt;
    this.restartAt = new Date(Date.now() + delayMs).toISOString();

    this.onEvent("warn", "Tunnel restart scheduled", {
      attempt,
      delayMs,
      restartAt: this.restartAt,
    });

    this.restartTimer = setTimeout(async () => {
      this.restartTimer = null;
      this.restartAt = null;
      if (!this.desiredRunning) return;
      try {
        await this.spawnConfigured();
      } catch (error) {
        this.onEvent("error", "Tunnel restart failed", {
          attempt,
          message: error instanceof Error ? error.message : String(error),
        });
        this.scheduleRestart();
      }
    }, delayMs);
    this.restartTimer.unref?.();
  }

  clearHealthCheck() {
    if (this.healthCheckTimer) clearTimeout(this.healthCheckTimer);
    this.healthCheckTimer = null;
  }

  cleanupHealthArtifact() {
    safeUnlink(this.healthUrlFile);
    this.healthUrlFile = null;
    this.healthBaseUrl = null;
  }

  resetHealthEvidenceForSpawn() {
    this.clearHealthCheck();
    this.healthBaseUrl = null;
    this.lastHealthProbeAt = null;
    this.lastHealthOkAt = null;
    this.lastHealthOkMonotonicAtMs = null;
    this.lastControlPlaneOkAt = null;
    this.lastControlPlaneEvidenceValue = null;
    this.lastControlPlaneEvidenceMonotonicAtMs = null;
    this.lastHealthError = null;
    this.consecutiveHealthFailures = 0;
    this.localReady = false;
    this.controlPlaneHealth = null;
    this.reachabilityState = "starting";
  }

  scheduleHealthCheck(delayMs = this.healthCheckIntervalMs) {
    this.clearHealthCheck();
    if (!this.desiredRunning || !this.child) return;

    this.healthCheckTimer = setTimeout(async () => {
      this.healthCheckTimer = null;
      try {
        await this.checkHealthNow();
      } catch (error) {
        this.onEvent("warn", "Tunnel health watchdog failed", {
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        if (this.desiredRunning && this.child && !this.recoveryPromise) {
          this.scheduleHealthCheck();
        }
      }
    }, Math.max(10, Number(delayMs) || this.healthCheckIntervalMs));
    this.healthCheckTimer.unref?.();
  }

  resolveHealthBaseUrl() {
    if (this.healthBaseUrl) return this.healthBaseUrl;
    if (!this.healthUrlFile || !fs.existsSync(this.healthUrlFile)) return null;

    const raw = fs.readFileSync(this.healthUrlFile, "utf8").trim();
    if (!raw) return null;

    const parsed = new URL(raw);
    const loopback =
      parsed.protocol === "http:" &&
      ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname);
    if (!loopback) {
      const error = new Error("OWL Tunnel health URL must be loopback.");
      error.code = "TUNNEL_HEALTH_URL_INVALID";
      throw error;
    }

    parsed.pathname = parsed.pathname
      .replace(/\/(?:healthz|readyz)\/?$/, "")
      .replace(/\/$/, "");
    parsed.search = "";
    parsed.hash = "";
    this.healthBaseUrl = parsed.toString().replace(/\/$/, "");
    return this.healthBaseUrl;
  }

  async fetchHealth(pathname, readResponse = (response) => response) {
    const baseUrl = this.resolveHealthBaseUrl();
    if (!baseUrl) {
      const error = new Error("OWL Tunnel health URL is not available yet.");
      error.code = "TUNNEL_HEALTH_URL_PENDING";
      throw error;
    }

    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort(
        new Error(
          `Tunnel health request timed out after ${this.healthRequestTimeoutMs}ms`,
        ),
      );
    }, this.healthRequestTimeoutMs);
    timeout.unref?.();

    try {
      const response = await awaitAbortable(
        this.fetchImpl(baseUrl + pathname, {
          method: "GET",
          signal: controller.signal,
        }),
        controller.signal,
      );
      // Headers alone do not complete a probe. Keep body consumption under the
      // same deadline, even if the response reader ignores AbortSignal.
      return await awaitAbortable(readResponse(response), controller.signal);
    } catch (cause) {
      const error = new Error(
        timedOut
          ? "OWL Tunnel health endpoint timed out."
          : "OWL Tunnel health endpoint is unavailable.",
      );
      error.code = timedOut
        ? "TUNNEL_HEALTH_TIMEOUT"
        : "TUNNEL_HEALTH_UNAVAILABLE";
      error.cause = cause;
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  controlPlaneProjection(component) {
    if (!component || typeof component !== "object") return null;
    const details =
      component.details && typeof component.details === "object"
        ? component.details
        : {};
    return {
      status: component.status ?? "unknown",
      state: component.state ?? "unknown",
      reasonCode: component.reason_code ?? null,
      observedAt: component.observed_at ?? null,
      lastSuccess: details.last_success ?? null,
      lastError: details.last_error ?? null,
      consecutiveFailures: Number(details.consecutive_failures ?? 0),
      nextRetry: details.next_retry ?? null,
      failureCategory: details.failure_category ?? null,
      httpStatus: Number(details.http_status ?? 0) || null,
    };
  }

  isCurrentGeneration(child, generation) {
    return (
      Boolean(child) &&
      this.child === child &&
      this.activeGeneration === generation
    );
  }

  async checkHealthNow() {
    const child = this.child;
    const generation = this.activeGeneration;
    if (!child || generation <= 0) return this.status();

    const now = Date.now();
    const monotonicNow = this.monotonicNow();
    const nowIso = new Date(now).toISOString();
    const startedMonotonicAtMs =
      this.startedMonotonicAtMs ?? monotonicNow;
    this.lastHealthProbeAt = nowIso;

    try {
      const { response: healthResponse, body: health } = await this.fetchHealth(
        "/health?details=true",
        async (response) => ({
          response,
          body: response.ok ? await response.json() : null,
        }),
      );
      if (!healthResponse.ok) {
        const error = new Error(
          `OWL Tunnel health endpoint returned HTTP ${healthResponse.status}.`,
        );
        error.code = "TUNNEL_HEALTH_FAILED";
        throw error;
      }

      if (!this.isCurrentGeneration(child, generation)) return this.status();

      const readyResponse = await this.fetchHealth("/readyz");
      if (!this.isCurrentGeneration(child, generation)) return this.status();

      const controlPlane = this.controlPlaneProjection(
        health?.components?.["control-plane"],
      );

      this.lastHealthOkAt = nowIso;
      this.lastHealthOkMonotonicAtMs = monotonicNow;
      this.consecutiveHealthFailures = 0;
      this.lastHealthError = null;
      this.localReady = readyResponse.ok;
      this.controlPlaneHealth = controlPlane;

      const controlPlaneSuccessMs = parseTimestamp(controlPlane?.lastSuccess);
      if (controlPlaneSuccessMs !== null) {
        const evidenceValue = new Date(controlPlaneSuccessMs).toISOString();
        this.lastControlPlaneOkAt = evidenceValue;
        if (evidenceValue !== this.lastControlPlaneEvidenceValue) {
          this.lastControlPlaneEvidenceValue = evidenceValue;
          this.lastControlPlaneEvidenceMonotonicAtMs = monotonicNow;
        }
      }

      const upstreamEvidenceMonotonicAtMs =
        this.lastControlPlaneEvidenceMonotonicAtMs ??
        startedMonotonicAtMs;
      const upstreamEvidenceAgeMs = Math.max(
        0,
        monotonicNow - upstreamEvidenceMonotonicAtMs,
      );

      if (
        controlPlane?.status === "degraded" &&
        upstreamEvidenceAgeMs >= this.healthStaleAfterMs
      ) {
        this.transitionReachability("stale", "control_plane_stale", {
          evidenceAgeMs: Math.round(upstreamEvidenceAgeMs),
        });
        this.lastHealthError = {
          code: "TUNNEL_CONTROL_PLANE_STALE",
          message:
            controlPlane.failureCategory ||
            controlPlane.reasonCode ||
            "Control-plane health is stale.",
          at: nowIso,
        };
        await this.recoverFromStale("control_plane_stale");
      } else if (controlPlane?.status === "ok" && this.localReady) {
        this.transitionReachability("ready", "health_proven");
        this.restartAttempts = 0;
      } else if (
        monotonicNow - startedMonotonicAtMs < this.healthStartupGraceMs
      ) {
        this.transitionReachability("starting", "startup_grace");
      } else {
        this.transitionReachability("degraded", "readiness_not_proven");
      }

      return this.status();
    } catch (error) {
      if (!this.isCurrentGeneration(child, generation)) return this.status();

      this.consecutiveHealthFailures += 1;
      this.lastHealthError = {
        code: error?.code ?? "TUNNEL_HEALTH_FAILED",
        message: error instanceof Error ? error.message : String(error),
        at: nowIso,
      };
      this.localReady = false;

      const lastProofMonotonicAtMs =
        this.lastHealthOkMonotonicAtMs ?? startedMonotonicAtMs;
      const proofAgeMs = Math.max(
        0,
        monotonicNow - lastProofMonotonicAtMs,
      );
      const pastStartupGrace =
        monotonicNow - startedMonotonicAtMs >= this.healthStartupGraceMs;

      if (pastStartupGrace && proofAgeMs >= this.healthStaleAfterMs) {
        this.transitionReachability("stale", "health_probe_stale", {
          proofAgeMs: Math.round(proofAgeMs),
          errorCode: this.lastHealthError?.code ?? null,
        });
        await this.recoverFromStale("health_probe_stale");
      } else {
        this.transitionReachability(
          pastStartupGrace ? "degraded" : "starting",
          pastStartupGrace ? "health_probe_failed" : "startup_health_pending",
          {
            proofAgeMs: Math.round(proofAgeMs),
            errorCode: this.lastHealthError?.code ?? null,
          },
        );
      }

      return this.status();
    }
  }

  async terminateChildForRecovery() {
    const child = this.child;
    if (!child) return;

    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(forceTimer);
        clearTimeout(giveUpTimer);
        resolve();
      };
      const forceTimer = setTimeout(() => {
        if (this.child === child) child.kill("SIGKILL");
      }, 3_000);
      const giveUpTimer = setTimeout(finish, 5_000);
      forceTimer.unref?.();
      giveUpTimer.unref?.();
      child.once("exit", finish);
      child.kill("SIGTERM");
    });
  }

  recoverFromStale(reason) {
    if (this.recoveryPromise) return this.recoveryPromise;

    this.transitionReachability("recovering", reason);
    this.clearHealthCheck();
    this.onEvent("warn", "Tunnel reachability recovery started", {
      reason,
      pid: this.child?.pid ?? null,
      consecutiveFailures: this.consecutiveHealthFailures,
    });

    const recovery = (async () => {
      await this.terminateChildForRecovery();
      if (this.desiredRunning && !this.child) this.scheduleRestart();
      return this.status();
    })();

    this.recoveryPromise = recovery.finally(() => {
      this.recoveryPromise = null;
      if (this.desiredRunning && this.child) this.scheduleHealthCheck();
    });
    return this.recoveryPromise;
  }

  async spawnConfigured() {
    if (this.child) return this.status();
    if (!this.config || !this.apiKey) {
      throw new Error("OWL Tunnel restart configuration is unavailable.");
    }

    const {
      binaryPath,
      tunnelId,
      mcpUrl,
      controlPlaneBaseUrl,
      pollTimeoutMs,
    } = this.config;
    this.validateConfig({
      binaryPath,
      tunnelId,
      apiKey: this.apiKey,
      mcpUrl,
      controlPlaneBaseUrl,
      pollTimeoutMs,
    });

    const tempDir = path.join(os.tmpdir(), "owl-desktop-tunnel");
    fs.mkdirSync(tempDir, { recursive: true, mode: 0o700 });
    const secretFile = path.join(
      tempDir,
      `api-key-${process.pid}-${randomUUID()}`,
    );
    fs.writeFileSync(secretFile, this.apiKey + "\n", { mode: 0o600 });
    this.secretFile = secretFile;
    safeUnlink(this.healthUrlFile);
    this.healthUrlFile = path.join(
      tempDir,
      `health-url-${process.pid}-${randomUUID()}.txt`,
    );
    this.resetHealthEvidenceForSpawn();

    const args = [
      "run",
      "--control-plane.api-key",
      `file:${secretFile}`,
      "--control-plane.tunnel-id",
      tunnelId,
      ...(controlPlaneBaseUrl
        ? [
            "--control-plane.base-url",
            controlPlaneBaseUrl,
            "--control-plane.poll-timeout",
            `${Math.max(1_000, Math.min(20_000, Number(pollTimeoutMs) || 20_000))}ms`,
            "--control-plane.initial-poll-timeout",
            `${Math.max(1_000, Math.min(20_000, Number(pollTimeoutMs) || 20_000))}ms`,
          ]
        : []),
      "--mcp.server-url",
      `url=${mcpUrl}`,
      "--mcp.startup-wait-timeout",
      "30s",
      "--health.listen-addr",
      "127.0.0.1:0",
      "--health.url-file",
      this.healthUrlFile,
    ];

    const child = spawn(binaryPath, args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });
    const generation = this.generation + 1;
    this.generation = generation;
    this.activeGeneration = generation;
    this.child = child;
    this.startedAt = new Date().toISOString();
    this.startedMonotonicAtMs = this.monotonicNow();
    this.lastExit = null;

    child.stdout.on("data", (chunk) => {
      this.onEvent("info", "Tunnel output", {
        text: chunk.toString().trim().slice(0, 1000),
      });
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString().trim().slice(0, 1000);
      const level = classifyTunnelDiagnostic(text);
      if (level !== "info") {
        this.onEvent(level, "Tunnel diagnostic", { text });
      }
    });
    child.once("error", (error) => {
      this.onEvent("error", "Tunnel failed to start", {
        message: error.message,
      });
    });
    child.once("exit", (code, signal) => {
      this.lastExit = {
        at: new Date().toISOString(),
        code,
        signal,
      };
      if (this.child === child) {
        this.child = null;
        if (this.activeGeneration === generation) this.activeGeneration = 0;
      }
      this.startedAt = null;
      this.startedMonotonicAtMs = null;
      this.clearHealthCheck();
      this.localReady = false;
      this.reachabilityState = this.desiredRunning ? "recovering" : "stopped";
      safeUnlink(this.secretFile);
      this.secretFile = null;
      this.cleanupHealthArtifact();
      this.onEvent(
        code === 0 ? "info" : "warn",
        "Tunnel stopped",
        this.lastExit,
      );
      this.scheduleRestart();
    });

    this.onEvent("info", "Tunnel started", {
      pid: child.pid,
      tunnelId: tunnelId.length > 12
        ? `${tunnelId.slice(0, 8)}…${tunnelId.slice(-4)}`
        : tunnelId,
      mcpUrl,
      restartAttempt: this.restartAttempts,
    });
    this.scheduleHealthCheck(100);
    return this.status();
  }

  async start({
    binaryPath,
    tunnelId,
    apiKey,
    mcpUrl,
    controlPlaneBaseUrl,
    pollTimeoutMs,
  }) {
    if (this.child) return this.status();
    this.validateConfig({
      binaryPath,
      tunnelId,
      apiKey,
      mcpUrl,
      controlPlaneBaseUrl,
      pollTimeoutMs,
    });
    this.clearRestartTimer();
    this.config = {
      binaryPath,
      tunnelId,
      mcpUrl,
      ...(controlPlaneBaseUrl ? { controlPlaneBaseUrl } : {}),
      ...(pollTimeoutMs ? { pollTimeoutMs: Number(pollTimeoutMs) } : {}),
    };
    this.apiKey = apiKey;
    this.desiredRunning = true;
    this.restartAttempts = 0;
    this.reachabilityState = "starting";
    return this.spawnConfigured();
  }

  async stop() {
    this.desiredRunning = false;
    this.clearRestartTimer();
    this.clearHealthCheck();
    const child = this.child;
    if (!child) {
      safeUnlink(this.secretFile);
      this.secretFile = null;
      this.cleanupHealthArtifact();
      this.apiKey = null;
      this.localReady = false;
      this.reachabilityState = "stopped";
      return this.status();
    }

    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (this.child === child) child.kill("SIGKILL");
        resolve();
      }, 5_000);
      child.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
      child.kill("SIGTERM");
    });

    safeUnlink(this.secretFile);
    this.secretFile = null;
    this.cleanupHealthArtifact();
    this.apiKey = null;
    this.restartAttempts = 0;
    this.localReady = false;
    this.reachabilityState = "stopped";
    return this.status();
  }

  async restart(config) {
    await this.stop();
    return this.start(config);
  }
}
