import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RuntimeHostSupervisor } from "../electron/services/runtime-host-supervisor.mjs";

const scratch = [];

afterEach(() => {
  for (const dir of scratch.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("RuntimeHostSupervisor", () => {
  it("reads the stable host identity without owning Runtime semantics", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "owl-host-test-"));
    scratch.push(dir);
    const host = path.join(dir, "OwlRuntimeHost");
    fs.writeFileSync(
      host,
      [
        "#!/bin/sh",
        "if [ \"$1\" = \"--status\" ]; then",
        "  echo '{\"ok\":true,\"bundleIdentifier\":\"fan.fde.owl.runtime\",\"version\":\"1.0.0\"}'",
        "  exit 0",
        "fi",
        "exit 64",
        "",
      ].join("\n"),
      { mode: 0o755 },
    );

    const supervisor = new RuntimeHostSupervisor({
      hostBinary: host,
      launchdLabel: "ai.owl.desktop.test-does-not-exist",
      runtimeBaseUrl: "http://127.0.0.1:9",
    });

    const identity = await supervisor.hostIdentity();
    expect(identity).toMatchObject({
      installed: true,
      bundleIdentifier: "fan.fde.owl.runtime",
      version: "1.0.0",
    });

    const service = await supervisor.launchdStatus();
    expect(service.loaded).toBe(false);
  }, 15_000);
});
