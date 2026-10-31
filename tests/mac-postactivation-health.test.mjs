import { it } from "vitest";
import assert from "node:assert/strict";
import path from "node:path";
import {macDesktopMainPresent,macWatchdogDecision,postActivationRecoveryAction}
  from "../scripts/lib/mac-postactivation-health.mjs";

it("macOS watchdog verifies the exact Electron GUI, not a helper or another checkout", () => {
 const good="/Users/example/_releases/owl-desktop-abcdef0";
 const other="/Users/example/owl-desktop";
 const suffix="node_modules/electron/dist/Electron.app/Contents/MacOS/Electron";
 const txt=["1203 /usr/local/bin/node "+path.join(good,"scripts","dev-full.mjs"),
 "1204 "+path.join(other,suffix)+" .",
 "1205 "+path.join(good,suffix)+" --type=renderer",
 "1206 "+path.join(good,suffix)+" ."].join("\n");
 assert.equal(macDesktopMainPresent(good,txt),true);
 assert.equal(macDesktopMainPresent(good,txt.replace("1206 "+path.join(good,suffix)+" .","")),false);
 assert.equal(macDesktopMainPresent(good,"200 "+path.join(good,suffix)+" ."),true);
});

const now=Date.parse("2026-10-31T09:37:00.000Z");
const mark=(seconds)=>new Date(now-seconds*1000).toISOString();
const ok={supervisorPresent:true,desktopMainPresent:true,ownerVerified:true,
  mcp:{ok:true,elapsedMs:8},runtime:{ok:true,elapsedMs:3}};

it("healthy local services never cause full rollback for UI-only or owner receipt faults",()=>{
 for(const probe of [
  {...ok,desktopMainPresent:false},
  {...ok,ownerVerified:false},
  {...ok,desktopMainPresent:false,ownerVerified:false}
 ]) {
  const decision=macWatchdogDecision({probe,now,
    firstSeenAt:mark(1200),consecutiveFailures:60});
  assert.equal(decision.action,"degraded");
 }
 assert.equal(macWatchdogDecision({probe:ok,now,
   firstSeenAt:mark(1200),consecutiveFailures:60}).action,"clear");
});

it("a transient MCP or Runtime timeout is observed, not treated as an upgrade failure",()=>{
 for(const key of ["mcp","runtime"]){
  const probe={...ok,[key]:{ok:false,reason:"timeout",elapsedMs:3500}};
  assert.equal(macWatchdogDecision({probe,now,firstSeenAt:mark(145),
    consecutiveFailures:5}).action,"wait");
  assert.equal(macWatchdogDecision({probe,now,firstSeenAt:mark(420),
    consecutiveFailures:1}).action,"observe");
  assert.equal(macWatchdogDecision({probe,now,firstSeenAt:mark(420),
    consecutiveFailures:6}).action,"rollback");
 }
});

it("Supervisor missing is restarted first, with delayed rollback for persistent outage",()=>{
 const probe={...ok,supervisorPresent:false,supervisorPid:null,mcp:{ok:false},runtime:{ok:false}};
 assert.equal(macWatchdogDecision({probe,now,
  firstSeenAt:mark(45),consecutiveFailures:2}).action,"wait");
 assert.equal(macWatchdogDecision({probe,now,
  firstSeenAt:mark(70),consecutiveFailures:3}).action,"restart");
 assert.equal(macWatchdogDecision({probe,now,
  firstSeenAt:mark(301),consecutiveFailures:6}).action,"rollback");
});

it("healthy ports with an uncertain supervisor identity never trigger competing restart",()=>{
 const probe={...ok,supervisorPresent:false};
 assert.equal(macWatchdogDecision({probe,now,firstSeenAt:mark(600),
   consecutiveFailures:90}).action,"degraded");
});

it("legacy recovery action uses a five-minute core outage threshold",()=>{
 assert.equal(postActivationRecoveryAction({healthy:true,firstSeenAt:mark(600),now}),"clear");
 assert.equal(postActivationRecoveryAction({healthy:false,firstSeenAt:null,now}),"observe");
 assert.equal(postActivationRecoveryAction({healthy:false,firstSeenAt:mark(45),now,supervisorPresent:false}),"wait");
 assert.equal(postActivationRecoveryAction({healthy:false,firstSeenAt:mark(70),now,supervisorPresent:false}),"restart");
 assert.equal(postActivationRecoveryAction({healthy:false,firstSeenAt:mark(151),now,supervisorPresent:true}),"wait");
 assert.equal(postActivationRecoveryAction({healthy:false,firstSeenAt:mark(301),now,supervisorPresent:true}),"rollback");
});
