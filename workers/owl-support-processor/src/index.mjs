// OWL Support: private ticket API and unattended transactional outbox.
// No public route. ChatGPT can also operate through Cloudflare's authenticated D1 connector.
const STATES=new Set(["received","human_review","in_progress","awaiting_customer","resolved","closed","reopened"]);
const NEXT={received:["in_progress","human_review"],human_review:["in_progress"],in_progress:["awaiting_customer","resolved","human_review"],awaiting_customer:["in_progress","resolved","human_review"],resolved:["closed","reopened"],closed:["reopened"],reopened:["in_progress","human_review"]};
const EVENTS=new Set(["diagnosis","investigation","tool_action","human_note","customer_feedback","verification","escalation"]);
const EMAIL=/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const respond=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"}});
const err=(code,status)=>respond({error:code},status);
const txt=(v,max=4000)=>typeof v==="string"&&v.trim()&&v.length<=max&&!/[\u0000-\u0008]/.test(v);
const uuid=()=>crypto.randomUUID();
const q=(env,sql,...args)=>env.SUPPORT_DB.prepare(sql).bind(...args);
const trimActor=v=>txt(v,120)?v.trim():null;
const sha256=async s=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s)))).map(n=>n.toString(16).padStart(2,"0")).join("");
async function outboxState(env,row,state,error=null,messageId=null) {
  await q(env,"UPDATE support_case_outbox SET status=?2,last_error=?3,provider_message_id=?4,updated_at=datetime('now') WHERE id=?1 AND status='sending'",row.id,state,error,messageId).run();
}
export async function deliverPending(env,limit=10) {
  const rows=(await q(env,"SELECT o.*,c.sender,c.state AS case_state,c.assigned_to FROM support_case_outbox o JOIN support_cases c ON c.id=o.case_id WHERE o.status='prepared' ORDER BY o.created_at,o.id LIMIT ?1",limit).all()).results||[];
  const outcome={examined:rows.length,sent:0,rejected:0,uncertain:0};
  for(const row of rows) {
    const got=await q(env,"UPDATE support_case_outbox SET status='sending',updated_at=datetime('now') WHERE id=?1 AND status='prepared' RETURNING id",row.id).first();
    if(!got)continue; // Another invocation has claimed this delivery.
    const deny=!EMAIL.test(row.recipient)||row.recipient.toLowerCase()!==row.sender.toLowerCase()
      ||!["in_progress","awaiting_customer","resolved"].includes(row.case_state)
      ||!txt(row.body_text,50000)||!txt(row.subject,220)||/[\r\n]/.test(row.subject)
      ||row.actor!==row.assigned_to||!env.MAILER||!env.MAILER_CALL_TOKEN;
    if(deny) {await outboxState(env,row,"rejected","validation_failed");outcome.rejected++;continue;}
    if((await sha256(row.body_text))!==row.body_sha256){await outboxState(env,row,"rejected","body_integrity_failed");outcome.rejected++;continue;}
    try {
      const response=await env.MAILER.fetch("https://owl-mailer.internal/v1/send",{
        method:"POST",headers:{"authorization":"Bearer "+env.MAILER_CALL_TOKEN,"content-type":"application/json"},
        body:JSON.stringify({from:"agent@tbn.cc",to:[row.recipient],subject:row.subject,text:row.body_text,replyTo:"agent@tbn.cc"})
      });
      const body=await response.json().catch(()=>({}));
      if(response.status===202&&body.accepted===true) {
        await outboxState(env,row,"sent",null,typeof body.messageId==="string"?body.messageId.slice(0,200):null);
        outcome.sent++;
      } else {
        // 502 from mailer can mean uncertain delivery; never auto-retry.
        const state=response.status===502?"uncertain":"rejected";
        await outboxState(env,row,state,"mailer_http_"+response.status);
        outcome[state]++;
      }
    }catch {
      await outboxState(env,row,"uncertain","transport_uncertain");
      outcome.uncertain++;
    }
  }
  // No blind retries: in-flight sends may already have reached Brevo when execution stops.
  await q(env,"UPDATE support_case_outbox SET status='uncertain',last_error='stale_inflight',updated_at=datetime('now') WHERE status='sending' AND updated_at < datetime('now','-15 minutes')").run();
  return outcome;
}
async function handleApi(request,env) {
  if(!env.SUPPORT_CASES_TOKEN)return err("api_not_configured",503);
  if(request.headers.get("authorization")!=="Bearer "+env.SUPPORT_CASES_TOKEN)return err("unauthorized",401);
  const url=new URL(request.url),parts=url.pathname.split("/").filter(Boolean);
  if(parts[0]!=="v1"||parts[1]!=="cases")return err("not_found",404);
  if(parts.length===2&&request.method==="GET") {
    const limit=Math.min(50,Math.max(1,Number(url.searchParams.get("limit")||20)||20));
    const state=url.searchParams.get("state");
    if(state&&!STATES.has(state))return err("invalid_state",400);
    const sql=state?
      "SELECT id,sender,recipient,subject,category,state,priority,assigned_to,version,created_at,updated_at,closed_at,ack_status FROM support_cases WHERE state=?1 ORDER BY created_at DESC LIMIT ?2":
      "SELECT id,sender,recipient,subject,category,state,priority,assigned_to,version,created_at,updated_at,closed_at,ack_status FROM support_cases ORDER BY created_at DESC LIMIT ?1";
    return respond({cases:(await (state?q(env,sql,state,limit):q(env,sql,limit)).all()).results||[]});
  }
  const id=parts[2];
  if(!id||id.length>150)return err("invalid_case_id",400);
  const c=await q(env,"SELECT * FROM support_cases WHERE id=?1",id).first();
  if(!c)return err("case_not_found",404);
  if(parts.length===3&&request.method==="GET") {
    const events=(await q(env,"SELECT id,event_type,actor,detail,from_state,to_state,created_at FROM support_case_events WHERE case_id=?1 ORDER BY created_at,id LIMIT 250",id).all()).results||[];
    const outbox=(await q(env,"SELECT id,status,actor,recipient,subject,body_sha256,provider_message_id,created_at,updated_at,last_error FROM support_case_outbox WHERE case_id=?1 ORDER BY created_at,id",id).all()).results||[];
    return respond({case:c,events,outbox}); // Full email body only via Gmail or an authorized D1 query.
  }
  if(parts.length!==4||request.method!=="POST")return err("not_found",404);
  if(Number(request.headers.get("content-length")||0)>65000)return err("payload_too_large",413);
  let data;try{const raw=await request.text();if(raw.length>65000)return err("payload_too_large",413);data=JSON.parse(raw)}catch{return err("invalid_json",400)}
  if(!data||typeof data!=="object")return err("invalid_payload",400);
  const actor=trimActor(data.actor);
  if(!actor||!txt(data.requestId,120))return err("actor_and_requestId_required",400);
  const requestId="api:"+data.requestId;
  const operation=parts[3];
  const existing=await q(env,"SELECT id,event_type,case_id FROM support_case_events WHERE request_id=?1",requestId).first();
  if(existing&&existing.case_id!==id)return err("idempotency_conflict",409);
  if(existing&&operation!=="reply")return respond({idempotent:true,eventId:existing.id,state:c.state});
  if(operation==="claim") {
    if(!["received","human_review","reopened","in_progress"].includes(c.state))return err("invalid_transition",409);
    if(c.assigned_to&&c.assigned_to!==actor)return err("already_assigned",409);
    const result=await q(env,"UPDATE support_cases SET assigned_to=?2,state='in_progress',version=version+1,last_action_at=datetime('now'),updated_at=datetime('now') WHERE id=?1 AND version=?3 AND (assigned_to IS NULL OR assigned_to=?2)",id,actor,c.version).run();
    if(result.meta?.changes!==1)return err("concurrent_change",409);
    await q(env,"INSERT OR IGNORE INTO support_case_events(id,case_id,event_type,actor,detail,request_id) VALUES (?1,?2,'claimed',?3,'Work accepted',?4)",uuid(),id,actor,requestId).run();
    return respond({success:true,state:"in_progress",actor});
  }
  if(operation==="events") {
    if(!EVENTS.has(data.type)||!txt(data.detail,4000))return err("invalid_event",400);
    if(c.assigned_to&&c.assigned_to!==actor)return err("assigned_to_other_actor",409);
    const eventId=uuid();
    await q(env,"INSERT OR IGNORE INTO support_case_events(id,case_id,event_type,actor,detail,request_id) VALUES (?1,?2,?3,?4,?5,?6)",eventId,id,data.type,actor,data.detail,requestId).run();
    await q(env,"UPDATE support_cases SET last_action_at=datetime('now'),updated_at=datetime('now') WHERE id=?1",id).run();
    return respond({success:true,eventId});
  }
  if(operation==="transition") {
    if(!STATES.has(data.to)||!NEXT[c.state]?.includes(data.to))return err("invalid_transition",409);
    if(c.assigned_to&&c.assigned_to!==actor)return err("assigned_to_other_actor",409);
    if(["resolved","closed"].includes(data.to)&&!txt(data.summary,2000)&&!txt(c.resolution_summary,2000))return err("resolution_required",400);
    if(data.to==="closed"&&data.verified!==true)return err("verification_required",400);
    const summary=txt(data.summary,2000)?data.summary:c.resolution_summary;
    const result=await q(env,"UPDATE support_cases SET state=?2,version=version+1,resolution_summary=?3,closed_at=CASE WHEN ?2='closed' THEN datetime('now') ELSE NULL END,last_action_at=datetime('now'),updated_at=datetime('now') WHERE id=?1 AND version=?4",id,data.to,summary,c.version).run();
    if(result.meta?.changes!==1)return err("concurrent_change",409);
    await q(env,"INSERT OR IGNORE INTO support_case_events(id,case_id,event_type,actor,detail,from_state,to_state,request_id) VALUES (?1,?2,'transition',?3,?4,?5,?6,?7)",uuid(),id,actor,txt(data.detail,4000)?data.detail:summary||"",c.state,data.to,requestId).run();
    return respond({success:true,from:c.state,to:data.to});
  }
  if(operation==="reply") {
    if(c.assigned_to!==actor||!["in_progress","awaiting_customer","resolved"].includes(c.state))return err("case_not_owned_or_not_active",409);
    if(!EMAIL.test(c.sender)||!txt(data.subject,220)||/[\r\n]/.test(data.subject)||!txt(data.text,50000))return err("invalid_reply",400);
    const hash=await sha256(data.text);
    const prior=await q(env,"SELECT id,status,body_sha256,case_id,actor FROM support_case_outbox WHERE idempotency_key=?1",requestId).first();
    if(prior)return prior.body_sha256===hash&&prior.case_id===id&&prior.actor===actor?respond({idempotent:true,outboxId:prior.id,status:prior.status}):err("idempotency_conflict",409);
    const idOut=uuid();
    await q(env,"INSERT INTO support_case_outbox(id,case_id,idempotency_key,recipient,subject,body_sha256,status,actor,body_text,reply_to) VALUES (?1,?2,?3,?4,?5,?6,'prepared',?7,?8,'agent@tbn.cc')",idOut,id,requestId,c.sender,data.subject,hash,actor,data.text).run();
    return respond({queued:true,outboxId:idOut,status:"prepared"},202);
  }
  return err("not_found",404);
}
export default {
  async fetch(request,env) {
    try {
      if(new URL(request.url).pathname==="/health")return respond({service:"owl-support-processor",version:1,ready:!!env.SUPPORT_DB&&!!env.MAILER&&!!env.MAILER_CALL_TOKEN});
      return await handleApi(request,env);
    }catch {return err("internal_error",500)}
  },
  async scheduled(controller,env,ctx) {
    ctx.waitUntil(deliverPending(env,10));
  }
};