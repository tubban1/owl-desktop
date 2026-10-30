import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PlannerContinuationStore } from "../electron/services/planner-continuation-store.mjs";

const tempDirs = [];
afterEach(() => { while (tempDirs.length) fs.rmSync(tempDirs.pop(), { recursive: true, force: true }); });
function fresh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "owl-planner-health-"));
  tempDirs.push(dir);
  const file = path.join(dir, "planner.json");
  return { store: new PlannerContinuationStore({ file }), file };
}

describe("Planner high-frequency health read cache", () => {
  it("does not reparse unchanged checkpoint history on repeated health reads", () => {
    const { store } = fresh();
    store.checkpoint("first", { goal: "Goal A", phase: "running" });
    let reads = 0;
    const original = store.garbageCollect.bind(store);
    store.garbageCollect = (...args) => { reads += 1; return original(...args); };

    const first = store.healthSummary();
    for (let i = 0; i < 100; i += 1) {
      expect(store.healthSummary()).toEqual(first);
    }
    expect(reads).toBe(1);
    const untrustedView = store.healthSummary();
    untrustedView.progressPolicy.recommendedUpdateIntervalMs = 999;
    expect(store.healthSummary().progressPolicy.recommendedUpdateIntervalMs).toBe(10_000);
  });

  it("notices external process writes immediately and retains all checkpoint history", () => {
    const { store, file } = fresh();
    const other = new PlannerContinuationStore({ file });
    store.checkpoint("first", { goal: "Goal A", phase: "running" });
    expect(store.healthSummary().activeCheckpointCount).toBe(1);

    other.checkpoint("second", { goal: "Goal B", phase: "running" });
    expect(store.healthSummary().activeCheckpointCount).toBe(2);
    expect(store.get("first").checkpoint.goal).toBe("Goal A");
    expect(store.get("second").checkpoint.goal).toBe("Goal B");

    store.complete("first", "done");
    expect(store.healthSummary().activeCheckpointCount).toBe(1);
  });

  it("refreshes the projection after its short TTL without deleting durable checkpoints", () => {
    const { store } = fresh();
    store.checkpoint("durable", { goal: "Keep recovery", phase: "running" });
    let calls = 0;
    const original = store.garbageCollect.bind(store);
    store.garbageCollect = (...args) => { calls += 1; return original(...args); };
    const realNow = Date.now;
    const start = realNow();
    try {
      Date.now = () => start;
      store.healthSummary();
      store.healthSummary();
      expect(calls).toBe(1);
      Date.now = () => start + 5_001;
      store.healthSummary();
      expect(calls).toBe(2);
      expect(store.get("durable").checkpoint.phase).toBe("running");
    } finally {
      Date.now = realNow;
    }
  });
});
