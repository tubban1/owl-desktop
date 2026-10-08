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
  it("renders a legible connected Live Graph and keeps the technical topology collapsed by default", () => {
    const html = renderToStaticMarkup(
      createElement(LiveOperationsGraph, { snapshot: null, activity: [], board }),
    );
    expect(html).toContain("FOCUSED LIVE GRAPH");
    expect(html).toContain("Follow the real request and response");
    expect(html).toContain("Six stage graph with evidence-based directional links");
    expect(html).toContain("Contract only");
    expect(html).toContain("No evidence");
    expect(html).toContain("TECHNICAL TOPOLOGY");
    expect((html.match(/class="live-graph-node /g) ?? []).length).toBe(6);
    expect((html.match(/<foreignObject /g) ?? []).length).toBe(6);
    expect(html).toMatch(/<details class="operations-network-shell operations-network-details">/);
    expect(html).not.toContain('<details open');
    expect(html).toContain("TECHNICAL TOPOLOGY");
  });
});
