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
    const corrected=s.checkpoint(a.ownerId,{goal:"Release Beta42",phase:"new product"});
    expect(corrected.checkpoint.revision).toBe(rev);
    expect(corrected.checkpoint.goal).toBe(goal);
    expect(corrected.checkpoint.phase).toBe("resuming");
    expect(corrected.checkpoint.taskIds).toEqual([]);
    expect(corrected.workstream.lastMissionDrift).toMatchObject({
      proposedGoal:"Release Beta42",retainedGoal:goal,
      disposition:"discarded_unverified_change",
    });
    expect(corrected.checkpoint.doNotRepeat).toContain("Do not create Beta42");
    const restored=new PlannerContinuationStore({file:s.file});
    expect(restored.resumeWorkstream(a.ownerId,{clientKind:"chatgpt"}).workstream.missionContract.originalGoal).toBe(goal);
    expect(restored.get(a.ownerId).checkpoint.doNotRepeat).toContain("Do not create Free v1");
  });
  it("resumes an old pending boundary without pretending it was acknowledged",()=>{
    const s=store();
    const opened=s.openWorkstream({goal:"Finish only the existing release"});
    const id=opened.ownerId;
    const rev=opened.checkpoint.revision;
    const lastAck=opened.workstream.lastAcknowledgedProgressBoundary ?? null;
    const boundary=s.markProgressBoundary(id,{
      toolStepsSinceProgress:50,silenceMs:700000,retryTool:"execute_command",
      userVisibleProgress:"Unseen historical notice"
    }).workstream.progressBoundary;
    const restored=new PlannerContinuationStore({file:s.file});
    const resumed=restored.resumeWorkstream(id,{clientKind:"chatgpt"});
    expect(resumed.workstream.progressBoundary).toBeNull();
    expect(resumed.workstream.lastReleasedProgressBoundary).toMatchObject({
      boundaryId:boundary.boundaryId,
      acknowledged:false,
      reason:"nonblocking_progress_migration",
    });
    expect(resumed.workstream.lastAcknowledgedProgressBoundary??null).toBe(lastAck);
    expect(resumed.checkpoint.revision).toBe(rev);
    expect(resumed.checkpoint.goal).toBe("Finish only the existing release");
    expect(restored.resumeWorkstream(id).workstream.lastReleasedProgressBoundary.boundaryId)
      .toBe(boundary.boundaryId);
  });

  it("does not mislabel a planner contract as verified user authorization",()=>{
    const s=store();
    const a=s.openWorkstream({goal:"Audit architecture"});
    expect(a.workstream.missionContract.provenance).toBe("planner_asserted_unverified");
    expect(a.workstream.missionContract.allowedRepositories).toEqual([]);
    expect(a.workstream.missionContract.prohibitedChanges).toEqual([]);
  });
});
