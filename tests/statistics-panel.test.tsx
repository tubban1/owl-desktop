import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StatisticsPanel } from "../src/statistics/StatisticsPanel";
import { dailyAvgDurationMs, summarizeUsage, type UsageStatisticsSnapshot } from "../src/statistics/statisticsModel";

const snapshot: UsageStatisticsSnapshot = {
  since: "2026-10-08T00:00:00Z",
  days: [
    {
      day: "2026-10-30", calls: 10, successes: 9, errors: 1,
      workstreamOpens: 3, completedWorkstreams: 2, reconnects: 0,
      sessionOpens: 99, idleReclaimed: 85, capEvictions: 14, ownerSuperseded: 48,
      externalFallbacks: 3, durationMs: 9000, timedCalls: 9,
      tools: [{ tool: "execute_command", calls: 8, errors: 1 },
        { tool: "read_file", calls: 2, errors: 0 }],
    },
    {
      day: "2026-10-31", calls: 20, successes: 19, errors: 1,
      workstreamOpens: 5, completedWorkstreams: 4, reconnects: 0,
      sessionOpens: 104, idleReclaimed: 90, capEvictions: 0,
      durationMs: 4000, timedCalls: 20,
      tools: [{ tool: "execute_command", calls: 15, errors: 0 },
        { tool: "read_file", calls: 5, errors: 1 }],
    },
  ],
};

describe("focused usage statistics dashboard", () => {
  it("shows four primary metrics and leaves transport and error details out of the overview", () => {
    const html = renderToStaticMarkup(createElement(StatisticsPanel, {
      stats: snapshot, deviceLocation: "Mac",
    }));
    const cards = html.split('stats-metrics stats-key-metrics')[1]?.split('stats-charts stats-key-charts')[0] ?? "";
    expect((cards.match(/<strong>/g) ?? []).length).toBe(4);
    for (const label of ["Avg. tool response", "Tool success", "Tool calls",
      "Completed workstreams", "Daily average response time", "Most used tools"]) {
      expect(html).toContain(label);
    }
    for (const hidden of ["Session opens", "Session-cap evictions",
      "Owner rebind cleanups", "External tool fallbacks", "Recorded MCP error codes",
      "Capability categories", "Workstream opens by day"]) {
      expect(html).not.toContain(hidden);
    }
    expect(html).toContain("1.0 s");
    expect(html).toContain("200 ms");
    expect(html).toContain("93.3%");
    expect(html).toContain("Monitor and diagnostic logs");
  });

  it("computes daily and all-period weighted averages without treating missing timing as zero", () => {
    const days = snapshot.days;
    expect(dailyAvgDurationMs(days[0])).toBe(1000);
    expect(dailyAvgDurationMs(days[1])).toBe(200);
    expect(dailyAvgDurationMs({durationMs:0,timedCalls:0})).toBeNull();
    const summary = summarizeUsage(snapshot, "all", new Date("2026-10-31T12:00:00Z"));
    expect(summary.avgDurationMs).toBe(Math.round(13000/29));
    expect(summary.total.calls).toBe(30);
  });
});
