import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

function safeUnlink(file) {
  if (!file) return;
  try { fs.rmSync(file, { force: true }); } catch {}
}

export class TunnelSupervisor {
  constructor({ onEvent = () => {} } = {}) {
    this.onEvent = onEvent;
    this.child = null;
    this.secretFile = null;
    this.startedAt = null;
    this.lastExit = null;
    this.config = null;
  }

  status() {
    return {
      state: this.child ? "running" : "stopped",
      pid: this.child?.pid ?? null,
      startedAt: this.startedAt,
      lastExit: this.lastExit,
      binaryPath: this.config?.binaryPath ?? null,
      tunnelIdConfigured: Boolean(this.config?.tunnelId),
      mcpUrl: this.config?.mcpUrl ?? null,
      secretStorage: this.child ? "ephemeral-file-0600" : "os-encrypted-at-rest",
    };
  }

  async start({ binaryPath, tunnelId, apiKey, mcpUrl }) {
    if (this.child) return this.status();
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

    const tempDir = path.join(os.tmpdir(), "owl-desktop-tunnel");
    fs.mkdirSync(tempDir, { recursive: true, mode: 0o700 });
    const secretFile = path.join(
      tempDir,
      `api-key-${process.pid}-${randomUUID()}`,
    );
    fs.writeFileSync(secretFile, apiKey + "\n", { mode: 0o600 });
    this.secretFile = secretFile;
    this.config = { binaryPath, tunnelId, mcpUrl };

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
      this.onEvent("warn", "Tunnel diagnostic", {
        text: chunk.toString().trim().slice(0, 1000),
      });
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
      this.child = null;
      this.startedAt = null;
      safeUnlink(this.secretFile);
      this.secretFile = null;
      this.onEvent(
        code === 0 ? "info" : "warn",
        "Tunnel stopped",
        this.lastExit,
      );
    });

    this.onEvent("info", "Tunnel started", {
      pid: child.pid,
      tunnelId: tunnelId.length > 12
        ? `${tunnelId.slice(0, 8)}…${tunnelId.slice(-4)}`
        : tunnelId,
      mcpUrl,
    });
    return this.status();
  }

  async stop() {
    const child = this.child;
    if (!child) {
      safeUnlink(this.secretFile);
      this.secretFile = null;
      return this.status();
    }

    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (this.child) this.child.kill("SIGKILL");
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
    return this.status();
  }

  async restart(config) {
    await this.stop();
    return this.start(config);
  }
}
