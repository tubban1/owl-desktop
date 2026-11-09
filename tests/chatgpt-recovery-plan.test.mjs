import {describe,it,expect} from "vitest";
import {planChatgptRecovery as plan} from "../mcp/chatgpt-recovery-plan.mjs";
const now=1_800_000_000_000;
const fingerprint="f".repeat(32),account="a".repeat(32);
const diag={taskId:"task1",terminal:true,outcome:"verified_completed",progress:{revision:8}};
const base={goalId:"goal1",taskId:"task1",taskDiagnosis:diag,now,
 conversation:{verified:true,url:"https://chatgpt.com/c/1234-abcd",fingerprint,
 accountFingerprint:account},
 authorization:{approved:true,allowStatusNotice:true,goalId:"goal1",conversationFingerprint:fingerprint,
 expiresAt:now+10000},
 browser:{connected:true,conversationFingerprint:fingerprint,
 accountFingerprint:account,generating:false},
 outbox:{sentKeys:[],uncertainSend:false}};
describe("consented consumer ChatGPT status continuation policy",()=>{
 it("never wakes a still-running Runtime Task to replay its goal",()=>{
  expect(plan({...base,taskDiagnosis:{...diag,terminal:false,outcome:"still_running"}}))
    .toMatchObject({nextAction:"observe_existing_task",originalTaskReplayAllowed:false});
 });
 it("offers at most one status continuation for a confirmed disconnected frontend",()=>{
  const running={...diag,terminal:false,outcome:"still_running",
    transport:{runtime:"observed"},progress:{revision:12}};
  const incident={id:"incident_123456",confirmedFrontendDisconnected:true,
    startedAt:now-65000};
  const candidate=plan({...base,taskDiagnosis:running,incident});
  expect(candidate).toMatchObject({
    nextAction:"queue_one_status_notice",
    noticeKind:"running_after_chat_disconnect",
    originalTaskReplayAllowed:false,automaticExternalActionAllowed:false,
  });
  const later=plan({...base,taskDiagnosis:{...running,progress:{revision:13}},incident});
  expect(later.noticeKey).toBe(candidate.noticeKey);
  expect(plan({...base,taskDiagnosis:running,
    incident:{...incident,startedAt:now-1000}}).nextAction)
    .toBe("observe_existing_task");
  expect(plan({...base,taskDiagnosis:{...running,transport:{runtime:"unobserved"}},incident}).nextAction)
    .toBe("observe_existing_task");
 });
 it("does not infer a ChatGPT session from a Runtime Task alone",()=>{
  expect(plan({...base,conversation:null}).nextAction).toBe("notice_requires_authorization");
 });
 it("fails closed on unauthorized chat account, expired consent or busy generation",()=>{
  expect(plan({...base,authorization:{...base.authorization,approved:false}}).nextAction)
    .toBe("notice_requires_authorization");
  expect(plan({...base,authorization:{...base.authorization,allowStatusNotice:false}}).nextAction)
    .toBe("notice_requires_authorization");
  expect(plan({...base,authorization:{...base.authorization,expiresAt:now-1}}).nextAction)
    .toBe("notice_requires_authorization");
  expect(plan({...base,browser:{...base.browser,accountFingerprint:"other"}}).nextAction)
    .toBe("wait_for_verified_chat_session");
  expect(plan({...base,browser:{...base.browser,generating:true}}).nextAction)
    .toBe("wait_for_verified_chat_session");
 });
 it("requires an exact chat URL rather than a search result or active tab",()=>{
  for(const url of ["https://chatgpt.com","https://evil.example/c/id",
    "http://chatgpt.com/c/1234","https://chatgpt.com/c/1234?prompt=abc"]){
   expect(plan({...base,conversation:{...base.conversation,url}}).nextAction)
    .toBe("notice_requires_authorization");
  }
 });
 it("uses a deterministic key to avoid repeated status turns",()=>{
  const a=plan(base);
  expect(a).toMatchObject({nextAction:"queue_one_status_notice",
    noticeKind:"verified_completion",automaticExternalActionAllowed:false});
  expect(a.noticeKey).toMatch(/^[a-f0-9]{64}$/);
  expect(plan({...base,outbox:{sentKeys:[a.noticeKey]}}).nextAction)
    .toBe("already_notified");
  expect(plan({...base,outbox:{uncertainSend:true}}).nextAction)
    .toBe("reconcile_chat_delivery");
 });
 it("never claims an unverified completion is verified",()=>{
  const a=plan({...base,taskDiagnosis:{...diag,outcome:"reported_completed"}});
  expect(a.noticeKind).toBe("unverified_completion");
  expect(a.originalTaskReplayAllowed).toBe(false);
 });
 it("requires a matching task ID and existing validated revision",()=>{
  expect(plan({...base,taskId:"other"}).nextAction).toBe("reconcile_task");
  expect(plan({...base,goalId:null}).nextAction).toBe("reconcile_task");
  expect(plan({...base,taskDiagnosis:{...diag,progress:{revision:null}}}).nextAction)
    .toBe("reconcile_task");
 });
});
