import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCallTimingJournal, safeTraceId } from "../mcp/call-timing-journal.mjs";

describe("persistent call timing", () => {
  it("stores opaque trace, status and durations without arbitrary request data", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "owl-call-timing-"));
    try {
      const journal = createCallTimingJournal({ root: dir, maxBytes: 140, backups: 2 });
      journal.record({
        traceId: "mcp_trace_abcdef12", phase: "mcp_response", tool: "runtime_info",
        status: 200, totalMs: 11, secret: "DO_NOT_PERSIST", executeMs: 6,
      });
      await journal.flush();
      const content = fs.readFileSync(journal.file, "utf8");
      expect(content).toContain("mcp_trace_abcdef12");
      expect(content).toContain('"totalMs":11');
      expect(content).not.toContain("DO_NOT_PERSIST");
      for (let i = 0; i < 6; i++) journal.record({
        traceId: "mcp_trace_abcdef12", phase:"mcp_response", totalMs:i,
      });
      await journal.flush();
      expect(fs.existsSync(journal.file+".1")).toBe(true);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it("rejects injected or malformed trace IDs", () => {
    expect(safeTraceId("../../secret")).toBeNull();
    expect(safeTraceId("safeTrace_123")).toBe("safeTrace_123");
  });
});
