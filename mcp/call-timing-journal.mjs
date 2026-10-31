import fs from "node:fs";
import path from "node:path";

// Payload-free, bounded, append-only evidence. Trace IDs are opaque and
// propagated across ingress and local execution, never based on user text.
const TRACE_PATTERN = /^[A-Za-z0-9_-]{8,100}$/;
export function safeTraceId(value) {
  return typeof value === "string" && TRACE_PATTERN.test(value) ? value : null;
}
export function createCallTimingJournal({ root, maxBytes = 4 * 1024 * 1024, backups = 4 } = {}) {
  if (!root) throw new Error("Call timing journal root is required");
  const file = path.join(root, "mcp-call-timings.jsonl");
  let pending = Promise.resolve();
  function record(row) {
    const item = {
      traceId: safeTraceId(row.traceId),
      phase: String(row.phase ?? "").slice(0, 40),
      at: new Date().toISOString(),
      ...(typeof row.method === "string" ? { method: row.method.slice(0, 80) } : {}),
      ...(typeof row.tool === "string" ? { tool: row.tool.slice(0, 100) } : {}),
      ...(typeof row.status === "string" || typeof row.status === "number"
        ? { status: row.status } : {}),
      ...Object.fromEntries(
        ["totalMs", "preflightMs", "queueMs", "connectMs", "executeMs", "completeMs", "waitingMs"]
          .filter((key) => Number.isFinite(row[key]) && row[key] >= 0)
          .map((key) => [key, Math.round(row[key])]),
      ),
    };
    pending = pending.catch(() => undefined).then(async () => {
      await fs.promises.mkdir(root, { recursive: true, mode: 0o700 });
      let size = 0;
      try { size = (await fs.promises.stat(file)).size; } catch {}
      if (size >= maxBytes) {
        for (let i = backups; i >= 1; i--) {
          const from = i === 1 ? file : file + "." + (i - 1);
          try { await fs.promises.rename(from, file + "." + i); } catch (error) {
            if (error?.code !== "ENOENT") throw error;
          }
        }
      }
      await fs.promises.appendFile(file, JSON.stringify(item) + "\n", { mode: 0o600 });
    }).catch(() => undefined);
  }
  return { record, file, flush: () => pending };
}
