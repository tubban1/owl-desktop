import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pruneDeadHostTunnelArtifacts } from "../electron/services/tunnel-supervisor.mjs";
describe("Tunnel temporary artifact lifecycle", () => {
  it("removes only dead-Host private files and preserves live/unknown files", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "owl-tunnel-prune-test-"));
    const dead = 99999999;
    const files = [`api-key-${dead}-${randomUUID()}`, `health-url-${dead}-${randomUUID()}.txt`, `api-key-${process.pid}-${randomUUID()}`, `unknown-${dead}-${randomUUID()}`];
    try {
      for (const name of files) fs.writeFileSync(path.join(dir, name), "fixture", { mode: 0o600 });
      expect(pruneDeadHostTunnelArtifacts(dir)).toBe(2);
      expect(fs.existsSync(path.join(dir, files[0]))).toBe(false);
      expect(fs.existsSync(path.join(dir, files[1]))).toBe(false);
      expect(fs.existsSync(path.join(dir, files[2]))).toBe(true);
      expect(fs.existsSync(path.join(dir, files[3]))).toBe(true);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
