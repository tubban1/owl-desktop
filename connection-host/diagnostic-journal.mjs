import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

// Whitelist-only evidence. Never persist untrusted payloads, raw errors,
// token strings, commands, URLs, or conversation text.
const SAFE_META_KEYS = new Set([
  "code", "status", "phase", "tool", "workstreamId",
  "taskId", "submissionId", "durationMs", "attempt", "retryCount",
]);
const ID_PATTERN = /^[a-zA-Z0-9:_./-]{1,180}$/;

export function createHostDiagnosticJournal({
  root, maxBytes = 1024 * 1024, maxBackups = 2,
} = {}) {
  if (!root) throw new Error("Diagnostic journal root required.");
  const file = path.join(root, "host-events.jsonl");
  function record(level, source, message, meta = {}) {
    const signal = String(message ?? "");
    const noteworthy =
      ["warn", "warning", "error"].includes(String(level)) ||
      (source === "tunnel" && /connect|disconnect|recover|restart|failed/i.test(signal)) ||
      (source === "mcp" && meta?.status === "progress_required");
    if (!noteworthy) return;
    const safeMeta = {};
    for (const [key, value] of Object.entries(meta ?? {})) {
      if (!SAFE_META_KEYS.has(key)) continue;
      if (typeof value === "number" && Number.isFinite(value)) {
        safeMeta[key] = value;
      } else if (typeof value === "string" && ID_PATTERN.test(value)) {
        safeMeta[key] = value;
      }
    }
    const item = {
      at: new Date().toISOString(),
      level: String(level).slice(0, 16),
      source: String(source).slice(0, 48),
      signal: /unauthoriz|lease.expir/i.test(signal) ? "auth" :
        /timeout|timed out/i.test(signal) ? "timeout" :
        /disconnect/i.test(signal) ? "disconnect" :
        /reconnect|recover/i.test(signal) ? "reconnect" :
        /connect/i.test(signal) ? "connection" : "diagnostic",
      messageSha256: createHash("sha256").update(signal).digest("hex"),
      meta: safeMeta,
    };
    try {
      fs.mkdirSync(root, { recursive: true, mode: 0o700 });
      if (fs.existsSync(file) && fs.statSync(file).size >= maxBytes) {
        for (let i = maxBackups; i >= 1; i--) {
          const previous = i === 1 ? file : file + "." + (i - 1);
          const destination = file + "." + i;
          if (fs.existsSync(previous)) fs.renameSync(previous, destination);
        }
      }
      fs.appendFileSync(file, JSON.stringify(item) + "\n", { mode: 0o600 });
    } catch {
      // Observability must never crash or block the Connection Host.
    }
  }
  return { record, file };
}
