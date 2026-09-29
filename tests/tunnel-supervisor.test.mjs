import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TunnelSupervisor } from "../electron/services/tunnel-supervisor.mjs";

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
