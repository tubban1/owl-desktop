import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PlannerContinuationStore } from "../electron/services/planner-continuation-store.mjs";
const roots = [];
function store() {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"owl-mission-lock-"));
  roots.push(root);
  return new PlannerContinuationStore({file:path.join(root,"continuation.json")});
}
afterEach(()=>{for(const root of roots.splice(0)) fs.rmSync(root,{recursive:true,force:true});});

describe("Mission contract persistence and immutability",()=>{
  it("pins original goal, preserves forbidden actions and acceptance criteria over repeated checkpoints and restart",()=>{
    const s=store();
    const a=s.openWorkstream({
      goal:"Release ONLY Vibe Monitor 1.0.1",
      workspace:{repo:"vibe-monitor"},
      missionContract:{
        allowedRepositories:["vibe-monitor"],
        prohibitedChanges:["Do not create Beta42","Do not create Free v1"],
        acceptanceCriteria:["Validate existing single client","Verify rollback"],
      },
    });
    const first=s.get(a.ownerId);
    expect(first.workstream.missionContract).toMatchObject({
      provenance:"planner_asserted_unverified",
      originalGoal:"Release ONLY Vibe Monitor 1.0.1",
      allowedRepositories:["vibe-monitor"],
      prohibitedChanges:["Do not create Beta42","Do not create Free v1"],
      acceptanceCriteria:["Validate existing single client","Verify rollback"],
    });
    expect(first.checkpoint.doNotRepeat).toEqual(["Do not create Beta42","Do not create Free v1"]);
    const cp=s.checkpoint(a.ownerId,{goal:"Release ONLY Vibe Monitor 1.0.1",
      phase:"testing",constraints:["No production deploy"],doNotRepeat:["No beta branch"]});
    expect(cp.checkpoint.doNotRepeat).toEqual(["Do not create Beta42","Do not create Free v1","No beta branch"]);
    const persisted=s.checkpoint(a.ownerId,{goal:"Release ONLY Vibe Monitor 1.0.1",
      phase:"resuming",constraints:[],doNotRepeat:[]});
    expect(persisted.checkpoint.constraints).toContain("No production deploy");
    expect(persisted.checkpoint.doNotRepeat).toContain("Do not create Beta42");
    const rev=persisted.checkpoint.revision;
    const goal=persisted.checkpoint.goal;
    let err;
    try {s.checkpoint(a.ownerId,{goal:"Release Beta42",phase:"new product"});} catch (e) {err=e;}
    expect(err?.code).toBe("MISSION_GOAL_IMMUTABLE");
    expect(s.get(a.ownerId).checkpoint.revision).toBe(rev);
    expect(s.get(a.ownerId).checkpoint.goal).toBe(goal);
    const restored=new PlannerContinuationStore({file:s.file});
    expect(restored.resumeWorkstream(a.ownerId,{clientKind:"chatgpt"}).workstream.missionContract.originalGoal).toBe(goal);
    expect(restored.get(a.ownerId).checkpoint.doNotRepeat).toContain("Do not create Free v1");
  });
  it("does not mislabel a planner contract as verified user authorization",()=>{
    const s=store();
    const a=s.openWorkstream({goal:"Audit architecture"});
    expect(a.workstream.missionContract.provenance).toBe("planner_asserted_unverified");
    expect(a.workstream.missionContract.allowedRepositories).toEqual([]);
    expect(a.workstream.missionContract.prohibitedChanges).toEqual([]);
  });
});
