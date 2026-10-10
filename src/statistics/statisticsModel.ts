export type UsageToolCount = { tool: string; calls: number; errors: number };
export type UsageDay = {
  day: string; calls: number; successes: number; errors: number;
  workstreamOpens: number; completedWorkstreams: number; reconnects: number;
  sessionOpens?: number; idleReclaimed?: number; capEvictions?: number; unknownReclaimed?: number; ownerSuperseded?: number;
  durationMs: number; timedCalls: number; tools: UsageToolCount[];
};
export type UsageStatisticsSnapshot = { since: string; days: UsageDay[] };
export type StatisticsRange = 7 | 30 | 90 | "all";

export function summarizeUsage(snapshot: UsageStatisticsSnapshot | null, range: StatisticsRange, today = new Date()) {
  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (range !== "all") day.setDate(day.getDate() - range + 1);
  const cutoff = [day.getFullYear(), String(day.getMonth() + 1).padStart(2,"0"), String(day.getDate()).padStart(2,"0")].join("-");
  const rows = (snapshot?.days ?? []).filter((d) => range === "all" || d.day >= cutoff).sort((a,b) => a.day.localeCompare(b.day));
  const total = { calls: 0, successes: 0, errors: 0, workstreamOpens: 0, completedWorkstreams: 0, reconnects: 0, sessionOpens: 0, idleReclaimed: 0, capEvictions: 0, unknownReclaimed: 0, ownerSuperseded: 0, durationMs: 0, timedCalls: 0 };
  const tools = new Map<string, UsageToolCount>();
  for (const d of rows) {
    for (const key of Object.keys(total) as Array<keyof typeof total>) total[key] += d[key] ?? 0;
    for (const tool of d.tools ?? []) {
      const current = tools.get(tool.tool) ?? { tool: tool.tool, calls: 0, errors: 0 };
      current.calls += tool.calls; current.errors += tool.errors; tools.set(tool.tool, current);
    }
  }
  const ranked = [...tools.values()].sort((a,b) => b.calls - a.calls || a.tool.localeCompare(b.tool));
  return { total, rows, tools: ranked,
    successRate: total.successes + total.errors ? Math.round(total.successes * 1000/(total.successes+total.errors))/10 : null,
    avgDurationMs: total.timedCalls ? Math.round(total.durationMs / total.timedCalls) : null };
}
