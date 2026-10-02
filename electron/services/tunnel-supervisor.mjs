import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

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

export class TunnelSupervisor {
  constructor({
    onEvent = () => {},
    restartBaseDelayMs = 1_000,
    restartMaxDelayMs = 30_000,
  } = {}) {
    this.onEvent = onEvent;
    this.child = null;
    this.secretFile = null;
    this.startedAt = null;
    this.lastExit = null;
    this.config = null;
    this.apiKey = null;
    this.desiredRunning = false;
    this.restartTimer = null;
    this.restartAt = null;
    this.restartAttempts = 0;
    this.restartBaseDelayMs = Math.max(Number(restartBaseDelayMs) || 1_000, 10);
    this.restartMaxDelayMs = Math.max(
      Number(restartMaxDelayMs) || 30_000,
      this.restartBaseDelayMs,
    );
  }

  status() {
    return {
      state: this.child
        ? "running"
        : this.restartTimer
          ? "restarting"
          : "stopped",
      pid: this.child?.pid ?? null,
      startedAt: this.startedAt,
      lastExit: this.lastExit,
      restartAt: this.restartAt,
      restartAttempts: this.restartAttempts,
      desiredRunning: this.desiredRunning,
      binaryPath: this.config?.binaryPath ?? null,
      tunnelIdConfigured: Boolean(this.config?.tunnelId),
      mcpUrl: this.config?.mcpUrl ?? null,
      secretStorage: this.child
        ? "ephemeral-file-0600"
        : this.desiredRunning
          ? "memory-until-restart"
          : "os-encrypted-at-rest",
    };
  }

  validateConfig({ binaryPath, tunnelId, apiKey, mcpUrl }) {
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
    const delayMs = Math.min(
      this.restartMaxDelayMs,
      this.restartBaseDelayMs * 2 ** Math.min(this.restartAttempts, 6),
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

  async spawnConfigured() {
    if (this.child) return this.status();
    if (!this.config || !this.apiKey) {
      throw new Error("OWL Tunnel restart configuration is unavailable.");
    }

    const { binaryPath, tunnelId, mcpUrl } = this.config;
    this.validateConfig({
      binaryPath,
      tunnelId,
      apiKey: this.apiKey,
      mcpUrl,
    });

    const tempDir = path.join(os.tmpdir(), "owl-desktop-tunnel");
    fs.mkdirSync(tempDir, { recursive: true, mode: 0o700 });
    const secretFile = path.join(
      tempDir,
      `api-key-${process.pid}-${randomUUID()}`,
    );
    fs.writeFileSync(secretFile, this.apiKey + "\n", { mode: 0o600 });
    this.secretFile = secretFile;

    const args = [
      "run",
      "--control-plane.api-key",
      `file:${secretFile}`,
      "--control-plane.tunnel-id",
      tunnelId,
      "--mcp.server-url",
      `url=${mcpUrl}`,
      "--mcp.startup-wait-timeout",
      "30s",
      "--health.listen-addr",
      "127.0.0.1:0",
    ];

    const child = spawn(binaryPath, args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });
    this.child = child;
    this.startedAt = new Date().toISOString();
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
      if (this.child === child) this.child = null;
      this.startedAt = null;
      safeUnlink(this.secretFile);
      this.secretFile = null;
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
    return this.status();
  }

  async start({ binaryPath, tunnelId, apiKey, mcpUrl }) {
    if (this.child) return this.status();
    this.validateConfig({ binaryPath, tunnelId, apiKey, mcpUrl });
    this.clearRestartTimer();
    this.config = { binaryPath, tunnelId, mcpUrl };
    this.apiKey = apiKey;
    this.desiredRunning = true;
    this.restartAttempts = 0;
    return this.spawnConfigured();
  }

  async stop() {
    this.desiredRunning = false;
    this.clearRestartTimer();
    const child = this.child;
    if (!child) {
      safeUnlink(this.secretFile);
      this.secretFile = null;
      this.apiKey = null;
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
    this.apiKey = null;
    this.restartAttempts = 0;
    return this.status();
  }

  async restart(config) {
    await this.stop();
    return this.start(config);
  }
}
