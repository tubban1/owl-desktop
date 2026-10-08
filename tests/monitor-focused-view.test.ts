import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LiveOperationsGraph } from "../src/monitor/LiveOperationsGraph";

const board = {
  generatedAt: "2026-10-08T20:00:00Z",
  activeCount: 0,
  connectedSources: 0,
  workingCount: 0,
  waitingCount: 0,
  attentionCount: 0,
  streams: [],
};

describe("Monitor Live Graph readable view", () => {
  it("renders six readable evidence-based stages and keeps the technical graph collapsed by default", () => {
    const html = renderToStaticMarkup(
      createElement(LiveOperationsGraph, { snapshot: null, activity: [], board }),
    );
    expect(html).toContain("FOLLOW ONE REQUEST");
    expect(html).toContain("What happened, step by step");
    expect(html).toContain("Live service status only");
    expect(html).toContain("Not seen");
    expect(html).toContain("TECHNICAL TOPOLOGY");
    expect((html.match(/class="focused-stage /g) ?? []).length).toBe(6);
    expect(html).toMatch(/<details class="operations-network-shell operations-network-details">/);
    expect(html).not.toContain('<details open');
    expect(html).toContain("Open technical topology below");
  });
});
