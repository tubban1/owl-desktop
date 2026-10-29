import fs from "node:fs";
import path from "node:path";

// Stores only counters and opaque interaction IDs. No prompts, payloads or credentials.
const MAX_DEDUPE = 100_000;
const freshDay = () => ({ calls: 0, successes: 0, errors: 0, workstreamOpens: 0, completedWorkstreams: 0, reconnects: 0, sessionOpens: 0, idleReclaimed: 0, capEvictions: 0, unknownReclaimed: 0, ownerSuperseded: 0, errorCodes: {}, durationMs: 0, timedCalls: 0, externalFallbacks: 0, fallbackReasons: {}, tools: {} });
const validDay = (at) => {
  const ms = Date.parse(at ?? "");
  if (!Number.isFinite(ms)) return null;
  const date = new Date(ms);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
};

export class UsageStatisticsStore {
  constructor({ file, schedule = (callback) => setTimeout(callback, 500) }) {
    this.file = file;
    this.schedule = schedule;
    let data = {};
    try { data = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
    this.days = data.version === 1 && data.days && typeof data.days === "object" ? data.days : {};
    this.seen = new Set(Array.isArray(data.seen) ? data.seen.slice(-MAX_DEDUPE) : []);
    this.pending = null;
    this.startedAt = typeof data.startedAt === "string" ? data.startedAt : new Date().toISOString();
  }

  ingest(event) {
    const meta = event?.meta ?? {};
    const day = validDay(event?.at);
    if (!day) return false;
    const interactionId = typeof meta.interactionId === "string" ? meta.interactionId : null;
    const phase = meta.phase;
    const isCall = event.source === "mcp" && meta.eventKind === "mcp_interaction" &&
      interactionId && typeof meta.tool === "string" && (phase === "request" || phase === "response");
    const isSessionOpen = event.source === "mcp" && event.message === "MCP transport session opened";
    const isSessionReclaim = event.source === "mcp" && event.message === "MCP transport session reclaimed";
    const isSupersession = event.source === "mcp" && event.message === "MCP stale owner transports superseded";
    const isExternalFallback = event.source === "mcp" && meta.eventKind === "external_tool_fallback";
    if (!isCall && !isSessionOpen && !isSessionReclaim && !isSupersession && !isExternalFallback) return false;
    const key = isSessionOpen || isSessionReclaim || isSupersession || isExternalFallback
      ? "event:" + event.id : interactionId + ":" + phase;
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    // Bounded replay protection; old events should not be replayed by the host after cursor advance.
    while (this.seen.size > MAX_DEDUPE) this.seen.delete(this.seen.values().next().value);
    const row = this.days[day] ?? (this.days[day] = freshDay());
    // Historical reconnects are legacy (unclassified) reclamations. Never
    // reinterpret them as real reconnects or silently reclassify old records.
    if (isSessionOpen) row.sessionOpens = (row.sessionOpens ?? 0) + 1;
    if (isSupersession) {
      const amount = Number(meta.reclaimedCount);
      if (Number.isSafeInteger(amount) && amount > 0 && amount <= 128)
        row.ownerSuperseded = (row.ownerSuperseded ?? 0) + amount;
    }
    if (isSessionReclaim) {
      const field = meta.reason === "session_cap" ? "capEvictions" :
        meta.reason === "idle_ttl" ? "idleReclaimed" : "unknownReclaimed";
      row[field] = (row[field] ?? 0) + 1;
    }
    if (isExternalFallback) {
      row.externalFallbacks = (row.externalFallbacks ?? 0) + 1;
      const reason = ["OWL_UNAVAILABLE","PROVIDER_UNAVAILABLE","MISSING_TOOL_SCHEMA",
        "OWL_TOOL_FAILED","USER_REQUEST","OTHER"].includes(meta.reasonCode)
        ? meta.reasonCode : "OTHER";
      row.fallbackReasons ??= {};
      row.fallbackReasons[reason] = (row.fallbackReasons[reason] ?? 0) + 1;
    }
    if (isCall) {
      const tool = meta.tool;
      const toolRow = row.tools[tool] ?? (row.tools[tool] = { calls: 0, errors: 0 });
      // Count a call on its request only. A response-only event is not enough to prove a distinct call
      // wasn't already counted in an earlier ingestion window.
      if (phase === "request") {
        row.calls += 1;
        toolRow.calls += 1;
        if (tool === "workstream_open") row.workstreamOpens += 1;
      } else {
        if (meta.status === "error") {
          row.errors += 1;
          toolRow.errors += 1;
          // Only store protocol error CODE identifiers, never error messages,
          // raw arguments, file paths, credentials or free-form telemetry.
          const code = typeof meta.code === "string" &&
            /^[A-Z][A-Z0-9_]{1,63}$/.test(meta.code)
              ? meta.code : "UNCLASSIFIED";
          row.errorCodes ??= {};
          row.errorCodes[code] = (row.errorCodes[code] ?? 0) + 1;
        }
        if (meta.status === "success") {
          row.successes += 1;
          if (tool === "workstream_complete") row.completedWorkstreams += 1;
        }
        if (typeof meta.durationMs === "number" && Number.isFinite(meta.durationMs) && meta.durationMs >= 0) {
          row.durationMs += meta.durationMs;
          row.timedCalls += 1;
        }
      }
    }
    this.persistSoon();
    return true;
  }

  persistSoon() {
    if (this.pending !== null) return;
    this.pending = this.schedule(() => {
      this.pending = null;
      this.flush();
    });
  }

  flush() {
    const data = JSON.stringify({ version: 1, startedAt: this.startedAt, days: this.days, seen: [...this.seen] });
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + ".tmp";
    fs.writeFileSync(tmp, data, { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  snapshot() {
    // Reporting days as recorded, not claiming coverage before first installation.
    return {
      since: this.startedAt,
      days: Object.entries(this.days).sort(([a], [b]) => a.localeCompare(b)).map(([day, row]) => ({
        day, ...row, tools: Object.entries(row.tools).sort(([a], [b]) => a.localeCompare(b)).map(([tool, counts]) => ({ tool, ...counts })),
      })),
    };
  }
}
