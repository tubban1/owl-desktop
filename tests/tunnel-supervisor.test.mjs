import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  TunnelSupervisor,
  classifyTunnelDiagnostic,
} from "../electron/services/tunnel-supervisor.mjs";

const scratch = [];
const supervisors = [];

afterEach(async () => {
  for (const supervisor of supervisors.splice(0)) {
    await supervisor.stop().catch(() => undefined);
  }
  for (const dir of scratch.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("TunnelSupervisor", () => {
  it("does not treat every stderr diagnostic as a warning", () => {
    expect(classifyTunnelDiagnostic("connected to control plane")).toBe("info");
    expect(classifyTunnelDiagnostic("starting MCP transport")).toBe("info");
    expect(classifyTunnelDiagnostic("reconnecting websocket")).toBe("info");
    expect(classifyTunnelDiagnostic("warning: transient transport issue")).toBe("warn");
    expect(classifyTunnelDiagnostic("connection refused")).toBe("warn");
    expect(classifyTunnelDiagnostic("startup timeout")).toBe("warn");
  });
  it("spawns a loopback-only tunnel and removes the ephemeral secret on stop", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "owl-tunnel-test-"));
    scratch.push(dir);
    const binary = path.join(dir, "fake-tunnel");
    fs.writeFileSync(
      binary,
      [
        "#!/bin/sh",
        "trap 'exit 0' TERM INT",
        "while true; do sleep 1; done",
        "",
      ].join("\n"),
      { mode: 0o755 },
    );

    const supervisor = new TunnelSupervisor();
    supervisors.push(supervisor);
    const status = await supervisor.start({
      binaryPath: binary,
      tunnelId: "tunnel_test_123456",
      apiKey: "not-a-real-secret",
      mcpUrl: "http://127.0.0.1:8790/mcp",
    });

    expect(status.state).toBe("running");
    expect(status.pid).toBeTypeOf("number");
    expect(status.secretStorage).toBe("ephemeral-file-0600");
    expect(supervisor.secretFile).toBeTruthy();
    expect(fs.statSync(supervisor.secretFile).mode & 0o777).toBe(0o600);

    const secretPath = supervisor.secretFile;
    await supervisor.stop();
    expect(supervisor.status().state).toBe("stopped");
    expect(fs.existsSync(secretPath)).toBe(false);
  });


  it("automatically restarts after an unexpected tunnel exit", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "owl-tunnel-restart-test-"));
    scratch.push(dir);
    const binary = path.join(dir, "fake-tunnel");
    const counter = path.join(dir, "count");
    fs.writeFileSync(
      binary,
      [
        "#!/bin/sh",
        `COUNT_FILE=${JSON.stringify(counter)}`,
        "COUNT=0",
        "if [ -f \"$COUNT_FILE\" ]; then COUNT=$(cat \"$COUNT_FILE\"); fi",
        "COUNT=$((COUNT + 1))",
        "printf '%s' \"$COUNT\" > \"$COUNT_FILE\"",
        "if [ \"$COUNT\" -eq 1 ]; then exit 17; fi",
        "trap 'exit 0' TERM INT",
        "while true; do sleep 1; done",
        "",
      ].join("\n"),
      { mode: 0o755 },
    );

    const events = [];
    const supervisor = new TunnelSupervisor({
      restartBaseDelayMs: 20,
      restartMaxDelayMs: 40,
      onEvent(level, message, meta) {
        events.push({ level, message, meta });
      },
    });
    supervisors.push(supervisor);

    await supervisor.start({
      binaryPath: binary,
      tunnelId: "tunnel_restart_123456",
      apiKey: "not-a-real-secret",
      mcpUrl: "http://127.0.0.1:8790/mcp",
    });

    const deadline = Date.now() + 8_000;
    let observedCount = 0;
    while (Date.now() < deadline) {
      observedCount = fs.existsSync(counter)
        ? Number(fs.readFileSync(counter, "utf8"))
        : 0;
      if (observedCount >= 2 && supervisor.status().state === "running") break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    expect(observedCount).toBeGreaterThanOrEqual(2);
    expect(supervisor.status()).toMatchObject({
      state: "running",
      desiredRunning: true,
    });
    expect(
      events.some((event) => event.message === "Tunnel restart scheduled"),
    ).toBe(true);
  }, 15_000);

  it("refuses a non-loopback MCP target", async () => {
    const supervisor = new TunnelSupervisor();
    supervisors.push(supervisor);
    await expect(supervisor.start({
      binaryPath: process.execPath,
      tunnelId: "tunnel_test_123456",
      apiKey: "not-a-real-secret",
      mcpUrl: "https://example.com/mcp",
    })).rejects.toThrow("must be loopback");
  });
});
