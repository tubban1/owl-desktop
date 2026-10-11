import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { createHostDiagnosticJournal } from "../connection-host/diagnostic-journal.mjs";

const roots = [];
afterEach(() => { for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

it("records only redacted, bounded host diagnosis", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owl-host-journal-"));
  roots.push(root);
  const log = createHostDiagnosticJournal({ root, maxBytes: 350, maxBackups: 2 });
  log.record("info", "mcp", "ordinary RPC with SECRET", { secret: "SECRET" });
  expect(fs.existsSync(log.file)).toBe(false);
  log.record("error", "tunnel", "UNAUTHORIZED Bearer SUPER_SECRET", {
    code: "UNAUTHORIZED", token: "SUPER_SECRET", tool: "runtime_info",
  });
  let content = fs.readFileSync(log.file, "utf8");
  expect(content).toContain("UNAUTHORIZED");
  expect(content).not.toContain("SUPER_SECRET");
  expect(content).not.toContain("Bearer");
  expect(JSON.parse(content).signal).toBe("auth");
  for (let n = 0; n < 10; n++) log.record("error", "mcp", "timeout", { attempt: n });
  expect(fs.existsSync(log.file + ".1")).toBe(true);
  expect(fs.existsSync(log.file + ".3")).toBe(false);
  content = fs.readFileSync(log.file, "utf8");
  expect(content).not.toContain("SUPER_SECRET");
});
