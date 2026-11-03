import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import fs from "node:fs";
import {fileURLToPath} from "node:url";
import path from "node:path";
import http from "node:http";
import {app} from "../demo/server.mjs";
const require = createRequire(import.meta.url);
const {capture, authorizeDraft}=require("../lib/context-guard.cjs");
const good={patientId:"DEMO-PAT-001",visitId:"DEMO-VIS-001",clinicianId:"DEMO-CLN-001"};
const note="[SYNTHETIC DEMO] Nonclinical fake example for review only.";

test("accepts valid synthetic identities",()=>{
 const snap=capture(good);assert.equal(snap.ok,true);assert.equal(snap.context.patientId,good.patientId);
});
test("rejects unknown and non-demo patient IDs",()=>{
 assert.equal(capture({...good,patientId:"REAL-PATIENT-123"}).reason,"INVALID_DEMO_PATIENT");
 assert.equal(capture({...good,clinicianId:""}).reason,"INVALID_DEMO_CLINICIAN");
});
test("requires identity to remain unchanged before write",()=>{
 const snap=capture(good);
 assert.equal(authorizeDraft(snap,{...good,patientId:"DEMO-PAT-002"},note,"",true).reason,"CONTEXT_CHANGED");
 assert.equal(authorizeDraft(snap,{...good,visitId:"DEMO-VIS-002"},note,"",true).reason,"CONTEXT_CHANGED");
 assert.equal(authorizeDraft(snap,{...good,clinicianId:"DEMO-CLN-002"},note,"",true).reason,"CONTEXT_CHANGED");
});
test("refuses overwrite, disabled field, and non-synthetic draft",()=>{
 const snap=capture(good);
 assert.equal(authorizeDraft(snap,good,note,"Existing record",true).reason,"REFUSE_OVERWRITE");
 assert.equal(authorizeDraft(snap,good,note,"",false).reason,"NOTE_FIELD_UNAVAILABLE");
 assert.equal(authorizeDraft(snap,good,"Real clinician text","",true).reason,"DRAFT_NOT_SYNTHETIC");
 assert.equal(authorizeDraft(null,good,note,"",true).reason,"NO_CAPTURED_CONTEXT");
});
test("permits an explicitly reviewed synthetic proposal",()=>{
 assert.deepEqual(authorizeDraft(capture(good),good,note,"",true),{ok:true,reason:"REVIEW_BEFORE_SAVE"});
});
test("Chrome extension cannot run on real sites or request browser credentials",()=>{
 const m=JSON.parse(fs.readFileSync(new URL("../manifest.json",import.meta.url),"utf8"));
 assert.deepEqual(m.host_permissions,["http://127.0.0.1:8765/*"]);
 assert.deepEqual(m.content_scripts[0].matches,["http://127.0.0.1:8765/*"]);
 assert.equal(m.permissions,undefined);
 assert.equal(m.background,undefined);
 const script=fs.readFileSync(new URL("../extension/content.js",import.meta.url),"utf8");
 assert.equal(script.includes(".submit("),false);
 assert.equal(script.includes("fetch("),false);
});
test("mock server requires synthetic IDs and explicit POST for persistence",async()=>{
 const server=http.createServer(app);await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 const port=server.address().port;
 try{
  const post=async (data,origin="http://127.0.0.1:"+port)=>{
   const result=await fetch("http://127.0.0.1:"+port+"/notes",{method:"POST",
    headers:{"content-type":"application/json",origin},body:JSON.stringify(data)});
   return {status:result.status,payload:await result.json()};
  };
  assert.equal((await post({...good,note})).status,200);
  assert.equal((await post({...good,patientId:"12345",note})).status,422);
  assert.equal((await post({...good,note:"real clinical data"})).status,422);
  assert.equal((await post({...good,note},"http://untrusted.example")).status,403);
  const page=await fetch("http://127.0.0.1:"+port+"/");
  assert.equal(page.status,200);
  assert.match(page.headers.get("content-security-policy"),/script-src 'self';/);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
