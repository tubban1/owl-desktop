import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildFocusedLiveTrace } from "../src/monitor/focusedLiveGraphModel";
import { FocusedLiveGraph } from "../src/monitor/FocusedLiveGraph";
import type { OperationsGraphModel, OperationsGraphEdge, OperationsGraphNode } from "../src/monitor/operationsGraphModel";
import type { McpInteraction } from "../src/monitor/interactionModel";

const NOW = Date.parse("2026-10-08T20:10:00.000Z");
const owner = "owl-workstream:test";
const node = (id: string, groupId: string): OperationsGraphNode => ({
  id, groupId, kind: "tool", label: id, detail: "Test detail", state: "healthy",
  current: false, observedAt: new Date(NOW).toISOString(), workstreamId: groupId === "execution" || groupId === "results" ? owner : null, evidence: [id],
});
const edge = (from: string, to: string, observed: boolean, relation: OperationsGraphEdge["relation"] = "execute"): OperationsGraphEdge => ({
  id: from+"=>"+to, from, to, observed, relation, state: "healthy", label: null, workstreamId: owner,
});
const model = (edges: OperationsGraphEdge[]): OperationsGraphModel => ({
  generatedAt: new Date(NOW).toISOString(),
  nodes: [
    node("source:one","sources"), node("transport:mcp","ingress"),
    node("gate:lease","authorization"), node("runtime:local","runtime"),
    node("tool:call1","execution"), node("result:call1","results"),
    node("tool:old","execution"), node("result:old","results"),
  ],
  edges, groups:[], loopPaths:[], summaries:[], assurances:[],
  interactions:[],currentWorkstreams:[],nextActions:[],latestInteraction:null,runningInteractions:[],
});
const interaction = (status: McpInteraction["status"] = "success"): McpInteraction => ({
  id:"call1", tool:"execute_command",clientKind:"chatgpt",clientLabel:"ChatGPT",
  transportSessionId:"transport",runtimeSessionId:owner,workstreamId:owner,
  startedAt:new Date(NOW-70_000).toISOString(),
  completedAt: status === "running" ? null : new Date(NOW-2000).toISOString(),
  status,durationMs:status === "running"?null:68_000,
  requestPreview:null,responsePreview:null,errorCode:null,
});

describe("Focused animated live graph", () => {
  it("traces only one exact interaction and keeps observed vs contract edges distinct", () => {
    const m = model([
      edge("source:one","transport:mcp",true,"request"),
      edge("transport:mcp","gate:lease",false,"authorize"),
      edge("gate:lease","runtime:local",false),
      edge("runtime:local","tool:call1",false),
      edge("tool:call1","result:call1",true,"result"),
      edge("result:call1","source:one",true,"return"),
      edge("tool:old","result:old",true,"result"),
    ]);
    const trace = buildFocusedLiveTrace(m,interaction(),NOW);
    expect(trace.links.map(l=>[l.from,l.to,l.observed])).toEqual([
      [0,1,true],[1,2,false],[2,3,false],[3,4,false],[4,5,true],
    ]);
    expect(trace.returned).toBe(true);
    expect(trace.responseRecent).toBe(true);
    expect(trace.links.some(l=>l.id.includes("old"))).toBe(false);
  });

  it("skips auth and Runtime when the actual host-local path bypasses them", () => {
    const m = model([
      edge("source:one","transport:mcp",true,"request"),
      edge("transport:mcp","tool:call1",true,"execute"),
      edge("tool:call1","result:call1",true,"result"),
    ]);
    const trace=buildFocusedLiveTrace(m,interaction(),NOW);
    expect(trace.links.map(l=>[l.from,l.to])).toEqual([[0,1],[1,4],[4,5]]);
    expect(trace.traversed).toEqual([0,1,4,5]);
    expect(trace.returned).toBe(false);
  });

  it("keeps coordination evidence when the path passes extra nodes inside ingress", () => {
    const m = model([
      edge("source:one","transport:mcp",true,"request"),
      edge("transport:mcp","transport:desktop",false,"coordination"),
      edge("transport:desktop","tool:call1",true,"coordination"),
      edge("tool:call1","result:call1",true,"result"),
    ]);
    m.nodes.push(node("transport:desktop","ingress"));
    const trace = buildFocusedLiveTrace(m, interaction(), NOW);
    expect(trace.links.map(l=>[l.from,l.to,l.observed])).toEqual([
      [0,1,true],[1,4,false],[4,5,true],
    ]);
    expect(trace.links[1]?.via).toContain("transport:desktop");
  });

  it("does not draw a result return or animate a packet without an observed response", () => {
    const m = model([
      edge("source:one","transport:mcp",true,"request"),
      edge("transport:mcp","tool:call1",false),
      edge("tool:call1","result:call1",false,"result"),
      edge("result:call1","source:one",false,"return"),
    ]);
    const live=interaction("running");
    const trace=buildFocusedLiveTrace(m,live,NOW);
    expect(trace.returned).toBe(false);
    expect(trace.responseRecent).toBe(false);
    expect(trace.requestRecent).toBe(false);
    const html=renderToStaticMarkup(createElement(FocusedLiveGraph,{model:m,workstreamId:owner,interaction:live,now:NOW}));
    expect(html).toContain("Tool call in progress");
    expect(html).toContain("1m 10s");
    expect(html).not.toContain("OBSERVED RESPONSE BACK TO SOURCE");
    expect(html).not.toContain("<animateMotion");
  });

  it("distinguishes stale unconfirmed tool calls from active execution", () => {
    const m=model([edge("transport:mcp","tool:call1",true),edge("tool:call1","result:call1",false,"result")]);
    const html=renderToStaticMarkup(createElement(FocusedLiveGraph,{
      model:m, workstreamId:owner, interaction:interaction("interrupted"), now:NOW,
    }));
    expect(html).toContain("No response observed for");
    expect(html).toContain("Unconfirmed 1m 10s");
    expect(html).not.toContain("Tool call in progress");
    expect(html).not.toContain("<animateMotion");
  });

  it("shows no invented edges when there is no selected interaction", () => {
    const m=model([edge("source:one","transport:mcp",true)]);
    const trace=buildFocusedLiveTrace(m,null,NOW);
    expect(trace.links).toEqual([]);
    const html=renderToStaticMarkup(createElement(FocusedLiveGraph,{model:m,workstreamId:owner,interaction:null,now:NOW}));
    expect(html).toContain("Waiting for activity");
    expect(html).not.toContain("live-graph-link-path");
  });
});
