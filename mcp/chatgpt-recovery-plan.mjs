// Read-only policy for notifying an already-authorized ChatGPT conversation.
// This module intentionally never opens Chrome or sends a message.
import {createHash} from "node:crypto";
const recoverable = new Set(["verified_completed","reported_completed","task_failed","requires_review"]);
function validConversationUrl(url) {
  if (typeof url!=="string") return false;
  try {
    const u=new URL(url);
    return u.protocol==="https:" && u.hostname==="chatgpt.com" &&
      /^\/c\/[a-zA-Z0-9-]+\/?$/.test(u.pathname) && !u.search && !u.hash;
  }catch{return false;}
}
export function planChatgptRecovery({
  goalId=null,taskId=null,taskDiagnosis=null,conversation=null,
  authorization=null,browser=null,outbox=null,incident=null,now=Date.now(),
}={}) {
  const base={schemaVersion:1,executionAuthority:"owl_runtime",
    chatTurnBehavior:"new_turn_only_never_resume_original_inference",
    originalTaskReplayAllowed:false,automaticExternalActionAllowed:false,
    nextAction:"reconcile_task",noticeKind:null,noticeKey:null};
  if(!goalId||!taskId||taskDiagnosis?.taskId!==taskId)
    return {...base,reason:"missing_verified_goal_task_correlation"};
  const continued = !taskDiagnosis.terminal && taskDiagnosis.outcome==="still_running" &&
    taskDiagnosis.transport?.runtime==="observed" &&
    incident?.confirmedFrontendDisconnected===true &&
    typeof incident.id==="string" && incident.id.length>=8 &&
    Number.isFinite(incident.startedAt) && incident.startedAt<=now-60_000;
  if(!taskDiagnosis.terminal && !continued)
    return {...base,nextAction:taskDiagnosis.outcome==="unknown"?"reconcile_task":"observe_existing_task",
      reason:"task_not_terminal"};
  if(taskDiagnosis.terminal && !recoverable.has(taskDiagnosis.outcome))
    return {...base,nextAction:"inspect_terminal_outcome",reason:"unsupported_terminal_outcome"};
  if(!continued && (!Number.isSafeInteger(taskDiagnosis.progress?.revision)||
                     taskDiagnosis.progress.revision<0))
    return {...base,reason:"task_terminal_revision_unverified"};
  const noticeKind=continued?"running_after_chat_disconnect"
    :taskDiagnosis.outcome==="verified_completed"?"verified_completion"
    :taskDiagnosis.outcome==="reported_completed"?"unverified_completion"
    :taskDiagnosis.outcome==="task_failed"?"failure_review":"human_review";
  // A running-task notice is once per observed connection incident, not
  // once per progress update. Terminal notices use exact final revision.
  const version=continued?incident.id:taskDiagnosis.progress.revision;
  const keyData=[goalId,taskId,version,noticeKind,
    conversation?.fingerprint??""];
  const noticeKey=createHash("sha256").update(JSON.stringify(keyData)).digest("hex");
  const candidate={...base,nextAction:"notice_requires_authorization",
    reason:"no_verified_conversation_authorization",noticeKind,noticeKey};
  if(!conversation?.verified||!validConversationUrl(conversation.url)||
     typeof conversation.fingerprint!=="string"||conversation.fingerprint.length<16||
     typeof conversation.accountFingerprint!=="string"||conversation.accountFingerprint.length<16)
    return candidate;
  if(authorization?.approved!==true||
     authorization.allowStatusNotice!==true ||
     authorization.goalId!==goalId ||
     authorization.conversationFingerprint!==conversation.fingerprint ||
     !Number.isFinite(authorization.expiresAt) || authorization.expiresAt<=now)
    return candidate;
  if(outbox?.sentKeys?.includes(noticeKey))
    return {...candidate,nextAction:"already_notified",reason:"notice_deduplicated"};
  if(outbox?.uncertainSend===true)
    return {...candidate,nextAction:"reconcile_chat_delivery",
      reason:"pending_chat_send_outcome_unknown"};
  if(browser?.connected!==true||browser.accountFingerprint!==conversation.accountFingerprint||
     browser.conversationFingerprint!==conversation.fingerprint||
     browser.generating!==false)
    return {...candidate,nextAction:"wait_for_verified_chat_session",
      reason:"browser_identity_or_idle_state_unverified"};
  return {...candidate,nextAction:"queue_one_status_notice",
    reason:"authorized_verified_notice_candidate",
    // A persisted outbox must atomically reserve noticeKey and keep an
    // uncertain receipt; only then may a separate authorized dispatcher send.
    automaticExternalActionAllowed:false};
}
