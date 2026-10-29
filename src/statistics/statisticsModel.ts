export type UsageToolCount = { tool: string; calls: number; errors: number };
export type UsageDay = {
  day: string; calls: number; successes: number; errors: number;
  workstreamOpens: number; completedWorkstreams: number; reconnects: number;
  sessionOpens?: number; idleReclaimed?: number; capEvictions?: number; unknownReclaimed?: number; ownerSuperseded?: number;
  externalFallbacks?: number; fallbackReasons?: Record<string,number>; errorCodes?: Record<string,number>;
  durationMs: number; timedCalls: number; tools: UsageToolCount[];
};
export type UsageStatisticsSnapshot = { since: string; days: UsageDay[] };
export type StatisticsRange = 7 | 30 | 90 | "all";

export function summarizeUsage(snapshot: UsageStatisticsSnapshot | null, range: StatisticsRange, today = new Date()) {
  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (range !== "all") day.setDate(day.getDate() - range + 1);
  const cutoff = [day.getFullYear(), String(day.getMonth() + 1).padStart(2,"0"), String(day.getDate()).padStart(2,"0")].join("-");
  const rows = (snapshot?.days ?? []).filter((d) => range === "all" || d.day >= cutoff).sort((a,b) => a.day.localeCompare(b.day));
  const total = { calls: 0, successes: 0, errors: 0, workstreamOpens: 0, completedWorkstreams: 0, reconnects: 0, sessionOpens: 0, idleReclaimed: 0, capEvictions: 0, unknownReclaimed: 0, ownerSuperseded: 0, externalFallbacks: 0, durationMs: 0, timedCalls: 0 };
  const tools = new Map<string, UsageToolCount>();
  const fallbackReasons = new Map<string,number>();
  const errorCodes = new Map<string,number>();
  for (const d of rows) {
    for(const [code,count] of Object.entries(d.errorCodes ?? {})){
      errorCodes.set(code,(errorCodes.get(code) ?? 0)+count);
    }
    for(const [reason,count] of Object.entries(d.fallbackReasons ?? {})){
      fallbackReasons.set(reason,(fallbackReasons.get(reason) ?? 0)+count);
    }
    for (const key of Object.keys(total) as Array<keyof typeof total>) total[key] += d[key] ?? 0;
    for (const tool of d.tools ?? []) {
      const current = tools.get(tool.tool) ?? { tool: tool.tool, calls: 0, errors: 0 };
      current.calls += tool.calls; current.errors += tool.errors; tools.set(tool.tool, current);
    }
  }
  const ranked = [...tools.values()].sort((a,b) => b.calls - a.calls || a.tool.localeCompare(b.tool));
  return { total, rows, tools: ranked,
    fallbackReasons:[...fallbackReasons].map(([reason,count])=>({reason,count})).sort((a,b)=>b.count-a.count),
    errorCodes:[...errorCodes].map(([code,count])=>({code,count})).sort((a,b)=>b.count-a.count || a.code.localeCompare(b.code)),
    transportStartsPerToolCall:total.calls ? Math.round(total.sessionOpens * 100 / total.calls)/100 : null,
    successRate: total.successes + total.errors ? Math.round(total.successes * 1000/(total.successes+total.errors))/10 : null,
    avgDurationMs: total.timedCalls ? Math.round(total.durationMs / total.timedCalls) : null };
}
