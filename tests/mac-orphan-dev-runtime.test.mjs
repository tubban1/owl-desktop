import {it} from "vitest";
import assert from "node:assert/strict";
import path from "node:path";
import {qualifyOrphanDevRuntime,recoverOrphanedMacDevRuntime} from "../scripts/lib/mac-orphan-dev-runtime.mjs";
const root="/Users/example/Projects/owl-runtime";
const listener={pid:102,uid:501,ppid:101,birth:"Wed Nov  4 10:33:22 2026",
 command:"/usr/bin/node --require "+path.join(root,"node_modules/tsx/dist/preflight.cjs")+
 " --import file://"+path.join(root,"node_modules/tsx/dist/loader.mjs")+" src/server.ts"};
const parent={pid:101,uid:501,ppid:1,birth:"Wed Nov  4 10:33:20 2026",
 command:"/usr/bin/node "+path.join(root,"node_modules/tsx/dist/cli.mjs")+" src/server.ts"};
const valid={listener,parent,runtimeRoot:root,currentUid:501};

it("identifies only the exact orphaned isolated DEV Runtime process tree",()=>{
 assert.equal(qualifyOrphanDevRuntime(valid),"VERIFIED_STALE_DEV_RUNTIME");
 for(const changed of [
  {parent:{...parent,ppid:10}},
  {parent:{...parent,uid:0}},
  {listener:{...listener,uid:0}},
  {listener:{...listener,command:"/usr/bin/node /Users/example/other/src/server.ts"}},
  {parent:{...parent,command:"/usr/bin/node /Users/example/other/node_modules/tsx/dist/cli.mjs src/server.ts"}},
  {listener:{...listener,ppid:301}},
  {parent:{...parent,birth:""}},
  {supervisorPresent:true},
  {runtimeHealthy:true}
 ]) assert.notEqual(qualifyOrphanDevRuntime({...valid,...changed}),"VERIFIED_STALE_DEV_RUNTIME");
});
function options(overrides={}){
 let signals=[],read=0,healthCalls=0;
 const o={platform:"darwin",port:18788,runtimeRoot:root,uid:501,
  readListenerPids:()=>[102],
  readPid:pid=>(pid===102?listener:pid===101?parent:null),
  isRuntimeHealthy:async()=>{healthCalls++;return false},
  hasSupervisor:()=>false,
  signal:(pid,type)=>signals.push([pid,type]),...overrides};
 return {o,signals,read,healthCalls:()=>healthCalls};
}
it("signals only the two positively identified orphan PIDs after two observations",async()=>{
 const c=options();
 assert.deepEqual(await recoverOrphanedMacDevRuntime(c.o),
  {status:"signalled",listenerPid:102,parentPid:101});
 assert.deepEqual(c.signals,[[102,"SIGTERM"],[101,"SIGTERM"]]);
 assert.equal(c.healthCalls(),2);
});
it("refuses healthy services, active supervisors, ambiguous or unrelated listeners",async()=>{
 for(const override of [
  {isRuntimeHealthy:async()=>true},
  {hasSupervisor:()=>true},
  {readListenerPids:()=>[102,103]},
  {readListenerPids:()=>[]},
  {readPid:pid=>pid===102?{...listener,ppid:300}:parent},
  {port:8788},{platform:"win32"}
 ]){
  const c=options(override);
  const result=await recoverOrphanedMacDevRuntime(c.o);
  assert.notEqual(result.status,"signalled");
  assert.deepEqual(c.signals,[]);
 }
});
it("rechecks the birth identity before signalling and rejects PID reuse",async()=>{
 let reads=0;
 const c=options({readPid:pid=>{
  if(pid===102&&++reads===2)return {...listener,birth:"Thu Nov  5 10:33:20 2026"};
  return pid===102?listener:parent;
 }});
 assert.equal((await recoverOrphanedMacDevRuntime(c.o)).status,"evidence-changed");
 assert.deepEqual(c.signals,[]);
});
it("fails closed when a supervisor returns after the first probe",async()=>{
 let count=0;
 const c=options({hasSupervisor:()=>++count>1});
 assert.equal((await recoverOrphanedMacDevRuntime(c.o)).status,"recovered-before-signal");
 assert.deepEqual(c.signals,[]);
});
