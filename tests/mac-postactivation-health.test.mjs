import {it} from "vitest";
import assert from "node:assert/strict";
import path from "node:path";
import {macDesktopMainPresent,postActivationRecoveryAction} from "../scripts/lib/mac-postactivation-health.mjs";

it("macOS watchdog verifies the exact Electron GUI, not a helper or another checkout",()=>{
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
it("watchdog waits for transient restart and rolls back persistent Electron failure",()=>{
 const now=Date.parse("2026-10-28T15:30:00.000Z");
 const mark=seconds=>new Date(now-seconds*1000).toISOString();
 assert.equal(postActivationRecoveryAction({healthy:true,firstSeenAt:mark(200),now}),"clear");
 assert.equal(postActivationRecoveryAction({healthy:false,firstSeenAt:null,now}),"observe");
 assert.equal(postActivationRecoveryAction({healthy:false,firstSeenAt:mark(20),now,supervisorPresent:false}),"wait");
 assert.equal(postActivationRecoveryAction({healthy:false,firstSeenAt:mark(45),now,supervisorPresent:false}),"restart");
 assert.equal(postActivationRecoveryAction({healthy:false,firstSeenAt:mark(45),now,supervisorPresent:true}),"wait");
 assert.equal(postActivationRecoveryAction({healthy:false,firstSeenAt:mark(151),now,supervisorPresent:true}),"rollback");
 assert.equal(postActivationRecoveryAction({healthy:false,firstSeenAt:mark(151),now,supervisorPresent:false}),"rollback");
});
