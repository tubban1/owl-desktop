import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PlannerContinuationStore } from "../electron/services/planner-continuation-store.mjs";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owl-planner-fastpath-"));
  roots.push(root);
  const file = path.join(root, "continuation.json");
  const store = new PlannerContinuationStore({ file });
  const ownerId = store.openWorkstream({ goal: "Keep original goal and all telemetry" }).ownerId;
  return { store, file, ownerId };
}
function traffic(requestDigest = "rq1", responseDigest = "rs1") {
  return { tool: "execute_command", requestChars: 300, responseChars: 500, requestDigest, responseDigest };
}

describe("Planner Continuation single atomic tool observation", () => {
  it("persists the execution step and continuity meter together in one snapshot", () => {
    const { store, file, ownerId } = fixture();
    let writes = 0;
    const actualWrite = store.write.bind(store);
    store.write = (...args) => { writes++; return actualWrite(...args); };
    const before = fs.statSync(file).ino;
    const result = store.recordToolObservation(ownerId, {
      step: { tool: "execute_command", outcome: "success", durationMs: 123 },
      traffic: traffic(),
    });
    expect(writes).toBe(1);
    expect(fs.statSync(file).ino).not.toBe(before);
    expect(result.owner.workstream.totalToolSteps).toBe(1);
    expect(result.continuity.observedChars).toBe(800);
    expect(result.continuity.toolCallCount).toBe(1);
    const revived = new PlannerContinuationStore({ file });
    expect(revived.get(ownerId).workstream.recentTools[0]).toMatchObject({
      tool: "execute_command", durationMs: 123, outcome: "success",
    });
    expect(revived.continuityStatus(ownerId).observedChars).toBe(800);
    expect(fs.readdirSync(path.dirname(file)).sort()).toEqual(["continuation.json"]);
  });

  it("keeps the hot state coherent across separate stores and out-of-process atomic rewrites", () => {
    const { store, file, ownerId } = fixture();
    const second = new PlannerContinuationStore({ file });
    store.recordToolObservation(ownerId, {
      step: { tool: "read_file", outcome: "success", durationMs: 10 },
      traffic: traffic("r1","s1"),
    });
    second.recordToolObservation(ownerId, {
      step: { tool: "write_file", outcome: "success", durationMs: 20 },
      traffic: traffic("r2","s2"),
    });
    store.recordToolObservation(ownerId, {
      step: { tool: "edit_file", outcome: "error", durationMs: 40 },
      traffic: traffic("r3","s3"),
    });
    const revived = new PlannerContinuationStore({ file });
    expect(revived.get(ownerId).workstream.totalToolSteps).toBe(3);
    expect(revived.continuityStatus(ownerId).observedChars).toBe(2400);
    expect(revived.get(ownerId).workstream.recentTools.map(x => x.tool))
      .toEqual(["read_file","write_file","edit_file"]);
  });

  it("preserves existing legacy methods and skips steps for metadata-only calls", () => {
    const { store, file, ownerId } = fixture();
    expect(store.recordWorkstreamToolStep(ownerId, {
      tool:"read_file", outcome:"success", durationMs:7,
    }).workstream.totalToolSteps).toBe(1);
    expect(store.recordConversationTraffic(ownerId, traffic()).observedChars).toBe(800);
    const result = store.recordToolObservation(ownerId, { traffic: traffic() });
    expect(result.continuity.observedChars).toBe(1600);
    expect(result.continuity.duplicateChars).toBe(800);
    expect(new PlannerContinuationStore({file}).get(ownerId).workstream.totalToolSteps).toBe(1);
    expect(store.recordToolObservation("no-owner", {traffic:traffic()})).toBeNull();
  });

  it("caches the parsed snapshot without skipping external file identity changes", () => {
    const { store, file, ownerId } = fixture();
    let reads = 0;
    const originalRead = store.read.bind(store);
    store.read = (...args) => { reads++; return originalRead(...args); };
    for (let n = 0; n < 5; n++) {
      store.recordToolObservation(ownerId, {
        step: { tool: "execute_command", outcome:"success", durationMs:n },
        traffic:traffic("rq"+n,"rs"+n),
      });
    }
    // The immediately preceding openWorkstream already seeded the hot cache.
    expect(reads).toBe(0);
    const other = new PlannerContinuationStore({file});
    other.checkpoint(ownerId, {goal:"Keep original goal and all telemetry",phase:"external"});
    store.recordToolObservation(ownerId, {
      step:{tool:"execute_command",outcome:"success",durationMs:100},
      traffic:traffic("external-request","external-response"),
    });
    expect(reads).toBe(1);
    const revived = new PlannerContinuationStore({file});
    expect(revived.get(ownerId).checkpoint.phase).toBe("external");
    expect(revived.get(ownerId).workstream.totalToolSteps).toBe(6);
  });
});
