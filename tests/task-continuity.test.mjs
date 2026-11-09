import {describe,it,expect} from "vitest";
import {diagnoseTaskContinuity as diagnose} from "../shared/task-continuity.mjs";
const task = (status, counts = {total:4,succeeded:2,running:1,failed:0}) => ({
  id:"task_demo", status, counts,
  updatedAt:"2026-11-09T12:00:00.000Z",
  progress:{revision:13,lastMeaningfulAt:"2026-11-09T12:00:00.000Z"},
  verificationCounts:{required:1,verified:0,missing:1,uncertain:0,failed:0},
});
describe("canonical task continuity / transport evidence",()=>{
  it("keeps Runtime work active even if the frontend connection was lost",()=>{
    const v=diagnose({task:task("running"),plannerConnected:false,mcpConnected:false,now:Date.parse("2026-11-09T12:01:00Z")});
    expect(v).toMatchObject({outcome:"still_running",terminal:false,interruption:"transport_observed_disconnected_task_not_proven_failed",safeToAutomaticallyReplay:false});
    expect(v.progress).toMatchObject({revision:13,stepSuccessPercent:50});
    expect(v.chatResponseOutcome).toBe("not_observable_from_runtime");
  });
  it("never infers root cause from a stale event",()=>{
    const v=diagnose({task:task("running"),now:Date.parse("2026-11-09T12:20:00Z")});
    expect(v.interruption).toBe("no_recent_progress_event");
    expect(v.outcome).toBe("still_running");
    expect(v.causeAttribution).toBe("unconfirmed");
  });
  it("distinguishes Runtime reported completion from verified completion",()=>{
    const v=diagnose({task:task("completed",{total:2,succeeded:2,failed:0})});
    expect(v.outcome).toBe("reported_completed");
    expect(v.progress.stepSuccessPercent).toBe(100);
    expect(v.verification.complete).toBe(false);
  });
  it("declares verified completion only when required evidence is verified",()=>{
    const t=task("completed",{total:2,succeeded:2,failed:0});
    t.verificationCounts={required:2,verified:2,missing:0,uncertain:0,failed:0};
    expect(diagnose({task:t}).outcome).toBe("verified_completed");
  });
  it("respects canonical blocked terminal receipts without automatic retry",()=>{
    const t=task("blocked");t.progress.terminal=true;
    const v=diagnose({task:t,plannerConnected:false});
    expect(v).toMatchObject({terminal:true,outcome:"requires_review",interruption:"none_terminal",safeToAutomaticallyReplay:false});
    const review=task("needs_review");review.progress.terminal=true;
    expect(diagnose({task:review}).terminal).toBe(true);
  });
  it("never counts a conflicted completed Task as verified",()=>{
    const t=task("completed",{total:2,succeeded:2,failed:0});
    t.verificationCounts={required:1,verified:0,missing:0,uncertain:1,failed:0};
    expect(diagnose({task:t}).outcome).toBe("completion_evidence_conflict");
  });
  it("separates task failed from disconnected transport",()=>{
    const v=diagnose({task:task("failed"),plannerConnected:false});
    expect(v).toMatchObject({outcome:"task_failed",interruption:"none_terminal",nextAction:"inspect_failure_before_retry"});
  });
  it("blocks replay for approvals, manual reviews and cancelled work",()=>{
    for(const [status,outcome] of [["waiting_approval","waiting_for_authorization"],["needs_review","requires_review"],["blocked","requires_review"],["cancelled","task_cancelled"],["paused","paused"]]){
      const v=diagnose({task:task(status)});
      expect(v.outcome).toBe(outcome);
      expect(v.safeToAutomaticallyReplay).toBe(false);
      expect(v.safeToAutomaticallySendChatTurn).toBe(false);
    }
  });
  it("does not fabricate a task from missing evidence",()=>{
    const v=diagnose({task:null,runtimeObserved:false,mcpConnected:false});
    expect(v).toMatchObject({outcome:"unknown",interruption:"task_unobserved",progress:{stepSuccessPercent:null},causeAttribution:"unconfirmed"});
  });
  it("does not treat a cached running Task as proof it is still executing while Runtime is offline",()=>{
    const v=diagnose({task:task("running"),runtimeObserved:false,mcpConnected:false});
    expect(v).toMatchObject({outcome:"previously_observed_nonterminal",interruption:"runtime_not_currently_observable",nextAction:"reconcile_runtime_before_decision"});
  });
  it("unknown transport state is not silently treated as online or disconnected",()=>{
    const v=diagnose({task:task("pending")});
    expect(v.transport.planner).toBe("unknown");
    expect(v.transport.mcp).toBe("unknown");
    expect(v.outcome).toBe("queued");
  });
});
