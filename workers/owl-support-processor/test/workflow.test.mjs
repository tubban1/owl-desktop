import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import worker,{deliverPending} from "../src/index.mjs";
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const base={SUPPORT_CASES_TOKEN:"internal-case-token"};
const req=(path,method="GET",body={},token="internal-case-token")=>new Request("https://owl-support.internal"+path,{method,headers:{"authorization":"Bearer "+token,"content-type":"application/json"},...(method==="POST"?{body:JSON.stringify(body)}:{})});
test("private API rejects missing/invalid tokens",async()=>{
  const response=await worker.fetch(req("/v1/cases","GET",{}, "bad-token"),base);
  assert.equal(response.status,401);
});
test("health is not exposing ticket data",async()=>{
 const r=await worker.fetch(new Request("https://owl-support.internal/health"),{...base,SUPPORT_DB:{},MAILER:{},MAILER_CALL_TOKEN:"abc"});
 assert.equal(r.status,200);
 assert.deepEqual(Object.keys(await r.json()),["service","version","ready"]);
});
test("ticket list state must be whitelisted",async()=>{
 const r=await worker.fetch(req("/v1/cases?state=deleted"),base);
 assert.equal(r.status,400);
});
test("outbox dispatch rejects recipient mismatch and never calls Brevo",async()=>{
 let attempts=0, updates=[];
 const row={id:"out-1",case_id:"case-1",recipient:"stranger@example.org",sender:"customer@example.org",case_state:"in_progress",assigned_to:"chatgpt",actor:"chatgpt",body_text:"Hi",subject:"Re: case",body_sha256:"x",status:"prepared"};
 const database={prepare(sql){const stub={bind(...args){this.args=args;return this;},async all(){return {results:[row]}},async first(){return {id:row.id}},async run(){updates.push({sql,args:this.args});return {meta:{changes:1}}}};if(sql.includes("SELECT o.*"))return Object.assign(stub,{async all(){return {results:[row]}}});return stub;}};
 const count=await deliverPending({SUPPORT_DB:database,MAILER:{async fetch(){attempts++;return new Response("{}")}},MAILER_CALL_TOKEN:"test"});
 assert.equal(count.rejected,1);
 assert.equal(attempts,0);
 assert.ok(updates.some(x=>x.args?.includes("rejected")));
});
test("outbox sends one authenticated message and marks sent",async()=>{
 const text="Hello customer";
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text)))).map(x=>x.toString(16).padStart(2,"0")).join("");
 const row={id:"out-2",case_id:"case-2",recipient:"customer@example.org",sender:"customer@example.org",case_state:"in_progress",assigned_to:"chatgpt",actor:"chatgpt",body_text:text,subject:"Re: case",body_sha256:hash,status:"prepared"};
 let n=0;const updates=[];
 const database={prepare(sql){return {bind(...args){this.args=args;return this;},async all(){return {results:sql.includes("SELECT o.*")?[row]:[]}},async first(){return {id:row.id}},async run(){updates.push(this.args);return {meta:{changes:1}}}}}};
 const mailer={async fetch(url,init){n++;assert.equal(url,"https://owl-mailer.internal/v1/send");assert.equal(init.headers.authorization,"Bearer internal-token");assert.equal(JSON.parse(init.body).to[0],row.recipient);return new Response('{"accepted":true,"messageId":"message-test-001"}',{status:202})}};
 const r=await deliverPending({SUPPORT_DB:database,MAILER:mailer,MAILER_CALL_TOKEN:"internal-token"});
 assert.equal(r.sent,1);assert.equal(n,1);
 assert.ok(updates.some(args=>args?.includes("sent")));
});
test("unknown upstream transport is never retried automatically",async()=>{
 const text="Hello customer";
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text)))).map(x=>x.toString(16).padStart(2,"0")).join("");
 const row={id:"out-3",case_id:"case-3",recipient:"customer@example.org",sender:"customer@example.org",case_state:"in_progress",assigned_to:"chatgpt",actor:"chatgpt",body_text:text,subject:"Re: case",body_sha256:hash};
 const updates=[];
 const db={prepare(sql){return {bind(...args){this.args=args;return this;},async all(){return {results:sql.includes("SELECT o.*")?[row]:[]}},async first(){return {id:row.id}},async run(){updates.push(this.args);return {meta:{changes:1}}}}}};
 const result=await deliverPending({SUPPORT_DB:db,MAILER:{async fetch(){throw Error("timeout")}},MAILER_CALL_TOKEN:"internal-token"});
 assert.equal(result.uncertain,1);
 assert.ok(updates.some(args=>args?.includes("uncertain")));
});
test("claim writes owner/state and explicit actor event",async()=>{
 const seen=[];
 const c={id:"case-1",state:"received",version:0,assigned_to:null};
 const db={prepare(sql){return {bind(...args){this.args=args;return this;},async first(){return sql.includes("SELECT * FROM support_cases")?c:null},async run(){seen.push({sql,args:this.args});return {meta:{changes:1}}}}}};
 const r=await worker.fetch(req("/v1/cases/case-1/claim","POST",{actor:"chatgpt",requestId:"req-claim-001"}),{...base,SUPPORT_DB:db});
 assert.equal(r.status,200);
 assert.equal((await r.json()).state,"in_progress");
 assert.ok(seen.some(x=>x.sql.includes("UPDATE support_cases")));
 assert.ok(seen.some(x=>x.sql.includes("support_case_events")&&x.args?.includes("chatgpt")));
});
test("refuses closing a case without verification",async()=>{
 const c={id:"case-1",state:"resolved",version:3,assigned_to:"chatgpt",resolution_summary:"Solved"};
 const db={prepare(sql){return {bind(){return this},async first(){return sql.includes("SELECT * FROM support_cases")?c:null}}}};
 const r=await worker.fetch(req("/v1/cases/case-1/transition","POST",{actor:"chatgpt",requestId:"close-001",to:"closed"}),{...base,SUPPORT_DB:db});
 assert.equal(r.status,400);
 assert.equal((await r.json()).error,"verification_required");
});
test("reply endpoint queues once without sending immediately",async()=>{
 let inserted=0;
 const c={id:"case-2",state:"in_progress",version:1,assigned_to:"chatgpt",sender:"owner@example.org"};
 const db={prepare(sql){return {bind(...args){this.args=args;return this;},async first(){return sql.includes("SELECT * FROM support_cases")?c:null},async run(){if(sql.includes("INSERT INTO support_case_outbox"))inserted++;return {meta:{changes:1}}}}}};
 const response=await worker.fetch(req("/v1/cases/case-2/reply","POST",{actor:"chatgpt",requestId:"reply-001",subject:"Reply",text:"A valid customer reply"}),{...base,SUPPORT_DB:db});
 assert.equal(response.status,202);
 assert.equal((await response.json()).status,"prepared");
 assert.equal(inserted,1);
});
test("reply cannot be queued by a different actor",async()=>{
 const c={id:"case-3",state:"in_progress",version:1,assigned_to:"human",sender:"owner@example.org"};
 const db={prepare(sql){return {bind(){return this},async first(){return sql.includes("SELECT * FROM support_cases")?c:null}}}};
 const r=await worker.fetch(req("/v1/cases/case-3/reply","POST",{actor:"chatgpt",requestId:"reply-other",subject:"Reply",text:"Hello"}),{...base,SUPPORT_DB:db});
 assert.equal(r.status,409);
});
