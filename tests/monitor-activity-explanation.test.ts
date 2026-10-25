import { describe, expect, it } from "vitest";
import { explainCurrentActivity } from "../src/monitor/activityExplanation";

describe("Monitor current activity in plain language", () => {
  const now = Date.parse("2026-10-08T18:00:00Z");
  it("identifies long-running tool calls without alleging a deadlock", () => {
    const result = explainCurrentActivity({
      stream: null, node: null, now,
      interaction: {tool:"get_process_output",status:"running",startedAt:"2026-10-08T17:58:00Z",completedAt:null}
    });
    expect(result.title).toBe("Checking a running process");
    expect(result.elapsedMs).toBe(120_000);
    expect(result.prolonged).toBe(true);
    expect(result.note).toMatch(/may be a long-running task or a wait/);
  });
  it("never treats the last successful interaction as currently running", () => {
    const result = explainCurrentActivity({
      stream:null, node:null, now,
      interaction: {tool:"read_file",status:"success",startedAt:"2026-10-08T17:57:00Z",completedAt:"2026-10-08T17:57:01Z"}
    });
    expect(result.title).toMatch(/No tool call/);
    expect(result.elapsedMs).toBeNull();
    expect(result.explanation).toMatch(/not proof/);
  });
  it("labels a nonblocking progress reminder as waiting rather than runtime failure", () => {
    const result = explainCurrentActivity({
      stream: {status: "waiting",currentAction: "Legacy progress reminder (non-blocking); continue the workstream",
        updatedAt: "2026-10-08T17:59:55Z",summary: "Previous pending boundary"},node: null,interaction: null,now
    });
    expect(result.attention).toBe(false);
    expect(result.waiting).toBe(true);
    expect(result.title).toContain("not blocked");
    expect(result.explanation).toContain("informational");
  });
  it("explains workstream pause and approval needs independently of graph animation", () => {
    const result = explainCurrentActivity({
      stream:{status:"waiting",currentAction:"pending",updatedAt:"2026-10-08T17:57:59Z",summary:"Waiting for planner"},node:null,interaction:null,now
    });
    expect(result.waiting).toBe(true);
    expect(result.title).toBe("Waiting for the next step");
    expect(result.note).toMatch(/No new workstream update/);
  });
});
