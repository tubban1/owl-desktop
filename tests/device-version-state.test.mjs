import {describe,it,expect} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {deviceVersionState,readVerifiedStage} from "../scripts/lib/device-version-state.mjs";

function fixture(work){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"owl-sync-state-"));
 try{
  const dir=path.join(root,"repo");fs.mkdirSync(dir);
  const git=(...a)=>execFileSync("git",["-C",dir,...a],{encoding:"utf8"}).trim();
  git("init","-q");git("config","user.name","OWL Tester");git("config","user.email","test@example.invalid");
  fs.writeFileSync(path.join(dir,"package.json"),'{"version":"0.1"}');
  git("add","package.json");git("commit","-m","initial");
  const sha=git("rev-parse","HEAD");fs.renameSync(dir,path.join(root,sha));
  return work({root,sha});
 }finally{fs.rmSync(root,{recursive:true,force:true});}
}
describe("source/staged/running state separation",()=>{
 it("does not treat a legacy reused-only receipt as tested",()=>fixture(({root,sha})=>{
  fs.writeFileSync(path.join(root,"last-staged.json"),JSON.stringify({commit:sha,reused:true}));
  expect(readVerifiedStage(root)).toMatchObject({commit:sha,verified:true,gatesPassed:false});
 }),30000);
 it("preserves last verified receipt identity across repeated checks",()=>fixture(({root,sha})=>{
  fs.writeFileSync(path.join(root,"last-staged.json"),JSON.stringify({commit:sha,verifiedAt:"2026-10-28T00:00:00Z",localSmokePassed:true,buildPassed:true}));
  const state=readVerifiedStage(root);
  expect(state.gatesPassed).toBe(true);expect(state.verifiedAt).toBe("2026-10-28T00:00:00Z");
  expect(state.commit).toBe(sha);
 }),30000);
 it("reports running MCP old when source checkout and staging are current",()=>{
  const desired="a".repeat(40),running="b".repeat(40);
  const state=deviceVersionState({source:{platform:"win32",architecture:"x64",sourceCommit:desired,
    sourceDirty:false,remoteStatus:"verified",remoteCommit:desired},
    live:{sourceCommit:running,sourceDirty:false},
    stage:{commit:desired,verified:true,gatesPassed:true,verifiedAt:"x"}});
  expect(state.runningMcpStatus).toBe("behind-or-diverged");
  expect(state.sourceCheckoutStatus).toBe("current");
  expect(state.stagingStatus).toBe("current");
  expect(state.activationNeeded).toBe(true);
  expect(state.sourceStageReadyForPreflight).toBe(true);
  expect(state.liveActivationAllowed).toBeNull();
  expect(state.liveCodeRevisionVerified).toBe(false);
 });
 it("does not infer live activation when no MCP startup evidence exists",()=>{
  const sha="f".repeat(40),source={sourceCommit:sha,remoteStatus:"verified",remoteCommit:sha};
  const state=deviceVersionState({source,stage:{commit:sha,verified:true,gatesPassed:true}});
  expect(state.runningMcpCommit).toBeNull();expect(state.activationNeeded).toBeNull();
  expect(state.runningMcpStatus).toBe("unknown");
 });
 it("classifies stale staged commit independently of a current running MCP",()=>{
  const sha="a".repeat(40);
  const state=deviceVersionState({source:{sourceCommit:sha,remoteCommit:sha,remoteStatus:"verified"},
   live:{sourceCommit:sha,sourceDirty:false},
   stage:{commit:"b".repeat(40),verified:true,gatesPassed:true}});
  expect(state.runningMcpStatus).toBe("current");
  expect(state.stagingStatus).toBe("behind-or-diverged");
  expect(state.activationNeeded).toBe(false);
 });
});
