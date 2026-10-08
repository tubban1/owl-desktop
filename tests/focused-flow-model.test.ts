import { describe, expect, it } from "vitest";
import { buildFocusedFlow } from "../src/monitor/focusedFlowModel";
import type { OperationsGraphEdge, OperationsGraphModel, OperationsGraphNode } from "../src/monitor/operationsGraphModel";
import type { McpInteraction } from "../src/monitor/interactionModel";

const groups = ["sources", "ingress", "authorization", "runtime", "execution", "results"]
  .map((id, order) => ({ id, label: id, order, nodeIds: [] as string[] }));
const node = (id: string, groupId: string, workstreamId: string | null, overrides: Partial<OperationsGraphNode> = {}): OperationsGraphNode => ({
  id, groupId, kind: "tool", label: id, detail: "Observed detail", state: "healthy",
  current: false, observedAt: "2026-10-08T18:00:00Z", workstreamId,
  evidence: [id], ...overrides,
});
const edge = (id: string, from: string, to: string, workstreamId: string, observed: boolean): OperationsGraphEdge => ({
  id, from, to, workstreamId, observed, state: "healthy", relation: "execute", label: null,
});
const interaction = (id: string, workstreamId: string, status: McpInteraction["status"] = "success"): McpInteraction => ({
  id, tool: "execute_command", clientKind: "chatgpt", clientLabel: "ChatGPT",
  transportSessionId: "t", runtimeSessionId: workstreamId, workstreamId,
  startedAt: "2026-10-08T18:00:00Z", completedAt: status === "running" ? null : "2026-10-08T18:00:09Z",
  status, durationMs: status === "running" ? null : 9000,
  requestPreview: null, responsePreview: null, errorCode: null,
});

function model(): OperationsGraphModel {
  const nodes = [
    node("source:a", "sources", "a", { label: "Chat A" }),
    node("transport:mcp", "ingress", null, { label: "OWL MCP" }),
    node("gate:runtime", "authorization", null, { label: "Cloud signed lease" }),
    node("runtime:local", "runtime", null, { label: "OWL Runtime" }),
    node("tool:i1", "execution", "a", { label: "execute_command" }),
    node("result:i1", "results", "a", { label: "Success" }),
    node("source:b", "sources", "b", { label: "Chat B" }),
    node("tool:i2", "execution", "b", { label: "edit_file" }),
    node("result:i2", "results", "b", { label: "Error" }),
    ...Array.from({length:30}, (_,i) => node("historical:"+i, "execution", i%2 ? "a" : "b", {label:"Another historical call " + i})),
  ];
  const edges = [
    edge("a1","source:a","transport:mcp","a",true),
    edge("a2","transport:mcp","gate:runtime","a",false),
    edge("a3","gate:runtime","runtime:local","a",false),
    edge("a4","runtime:local","tool:i1","a",false),
    edge("a5","tool:i1","result:i1","a",true),
    edge("b1","source:b","transport:mcp","b",true),
    edge("b2","transport:mcp","tool:i2","b",true),
    edge("b3","tool:i2","result:i2","b",true),
    ...Array.from({length:40}, (_,i) => edge("historic:"+i,"historical:"+(i%30),"source:a",i%2?"a":"b",i%3===0)),
  ];
  return {generatedAt:"2026-10-08T18:00:00Z",groups,nodes,edges,
    interactions:[],currentWorkstreams:[],summaries:[],assurances:[],loopPaths:[],nextActions:[],latestInteraction:null,runningInteractions:[]};
}

describe("focused path projection", () => {
  it("projects six ordered readable stages even with 39 nodes and 48 edges", () => {
    const result = buildFocusedFlow(model(), "a", interaction("i1","a"));
    expect(result.map(x=>x.id)).toEqual(["sources","ingress","authorization","runtime","execution","results"]);
    expect(result[0]?.title).toBe("ChatGPT");
    expect(result[2]?.evidence).toBe("contract");
    expect(result[4]).toMatchObject({title:"execute_command",state:"done",evidence:"observed"});
    expect(result[5]).toMatchObject({title:"Response received",state:"done",evidence:"observed"});
    expect(result[4]?.hiddenCount).toBeGreaterThan(20);
  });

  it("does not turn a running request's unobserved response into success", () => {
    const result = buildFocusedFlow(model(), "a", interaction("i1","a","running"));
    expect(result[4]).toMatchObject({state:"running",title:"execute_command"});
    expect(result[5]).toMatchObject({state:"waiting",title:"Awaiting response",evidence:"contract"});
  });

  it("focuses the selected workstream instead of leaking an unrelated tool's result", () => {
    const result = buildFocusedFlow(model(), "b", interaction("i2","b","error"));
    expect(result[4]).toMatchObject({state:"attention",title:"execute_command"});
    expect(result[5]).toMatchObject({title:"Error response",state:"attention"});
    expect(result[2]?.evidence).toBe("status");
    expect(result[2]?.note).toMatch(/No authorization hop identified/);
  });

  it("does not claim traversed hops without interaction edges", () => {
    const result = buildFocusedFlow(model(), null, null);
    expect(result[2]?.evidence).toBe("status");
    expect(result[4]?.evidence).toBe("none");
    expect(result[4]?.state).toBe("neutral");
    expect(result[5]?.evidence).toBe("none");
  });

  it("leaves every step unobserved in empty data instead of inventing a path", () => {
    const result = buildFocusedFlow({...model(),nodes:[],edges:[]}, "missing", null);
    expect(result).toHaveLength(6);
    expect(result.every(x=>x.evidence==="none")).toBe(true);
    expect(result.every(x=>x.state==="neutral")).toBe(true);
  });
});
