import type { ActivityEntry } from "../types";

export type McpInteraction = {
  id: string;
  tool: string;
  clientKind: string | null;
  clientLabel: string;
  transportSessionId: string | null;
  runtimeSessionId: string | null;
  workstreamId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  status: "running" | "success" | "error";
  durationMs: number | null;
  requestPreview: string | null;
  responsePreview: string | null;
  errorCode: string | null;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function clientLabel(kind: string | null, explicit: string | null): string {
  if (explicit?.trim()) return explicit.trim();
  switch (kind) {
    case "chatgpt":
      return "ChatGPT";
    case "worker":
      return "Worker";
    case "cloud":
      return "OWL Cloud";
    case "agent":
      return "Agent";
    case "desktop":
    case "mcp":
    default:
      return "MCP client";
  }
}

export function buildMcpInteractionFeed(
  activity: ActivityEntry[],
  limit = 30,
): McpInteraction[] {
  const byId = new Map<string, McpInteraction>();

  for (const entry of activity) {
    if (entry.source !== "mcp") continue;
    const meta = entry.meta ?? {};
    if (meta.eventKind !== "mcp_interaction") continue;
    const id = text(meta.interactionId);
    const tool = text(meta.tool);
    const phase = text(meta.phase);
    if (!id || !tool || (phase !== "request" && phase !== "response")) continue;

    const existing =
      byId.get(id) ??
      ({
        id,
        tool,
        clientKind: text(meta.clientKind),
        clientLabel: clientLabel(text(meta.clientKind), text(meta.clientLabel)),
        transportSessionId: text(meta.transportSessionId),
        runtimeSessionId: text(meta.runtimeSessionId),
        workstreamId: text(meta.workstreamId),
        startedAt: null,
        completedAt: null,
        status: "running",
        durationMs: null,
        requestPreview: null,
        responsePreview: null,
        errorCode: null,
      } satisfies McpInteraction);

    existing.clientKind = text(meta.clientKind) ?? existing.clientKind;
    existing.clientLabel = clientLabel(
      existing.clientKind,
      text(meta.clientLabel) ?? existing.clientLabel,
    );
    existing.transportSessionId =
      text(meta.transportSessionId) ?? existing.transportSessionId;
    existing.runtimeSessionId =
      text(meta.runtimeSessionId) ?? existing.runtimeSessionId;
    existing.workstreamId = text(meta.workstreamId) ?? existing.workstreamId;

    if (phase === "request") {
      existing.startedAt = entry.at;
      existing.requestPreview = text(meta.payload);
    } else {
      existing.completedAt = entry.at;
      existing.responsePreview = text(meta.payload);
      existing.durationMs =
        typeof meta.durationMs === "number" ? meta.durationMs : null;
      existing.status = meta.status === "error" ? "error" : "success";
      existing.errorCode = text(meta.code);
    }
    byId.set(id, existing);
  }

  return [...byId.values()]
    .sort((a, b) => {
      const at = Date.parse(a.completedAt ?? a.startedAt ?? "") || 0;
      const bt = Date.parse(b.completedAt ?? b.startedAt ?? "") || 0;
      return bt - at;
    })
    .slice(0, Math.max(1, limit));
}
