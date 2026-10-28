import {describe,it,expect} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {assertStagePath,readCandidate,assessActivation,githubMainCi,requiredReleaseArtifacts} from "../scripts/lib/activation-gate.mjs";

function fixture(fn){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"owl-activation-preflight-"));
 try{
  const repo=path.join(root,"repo");fs.mkdirSync(repo);
  const git=(...args)=>execFileSync("git",["-C",repo,...args],{encoding:"utf8"}).trim();
  git("init","-q");git("config","user.name","OWL test");git("config","user.email","test@example.invalid");
  fs.writeFileSync(path.join(repo,"package.json"),'{"version":"0.1.0"}');
  git("add","package.json");git("commit","-m","test");
  const sha=git("rev-parse","HEAD"),stage=path.join(root,sha);
  fs.renameSync(repo,stage);
  fs.writeFileSync(path.join(root,"last-staged.json"),JSON.stringify({commit:sha,
   localSmokePassed:true,buildPassed:true,requiresPassingGithubCi:true}));
  return fn({root,stage,sha});
 }finally{fs.rmSync(root,{recursive:true,force:true});}
}
describe("safe activation gate",()=>{
 it("requires an exact immutable version directory and valid Git content",()=>fixture(({root,stage,sha})=>{
  expect(assertStagePath(stage,sha,root)).toBe(stage);
  expect(readCandidate(null,root).verified).toBe(true);
  expect(()=>assertStagePath(root,sha,root)).toThrow(/ACTIVATION_STAGE_OUTSIDE/);
  fs.writeFileSync(path.join(stage,"new-user-file"),"user draft");
  expect(readCandidate(null,root).verified).toBe(false);
  expect(fs.readFileSync(path.join(stage,"new-user-file"),"utf8")).toBe("user draft");
 }));
 it("never promotes a source snapshot that lacks release binaries or a guardian",()=>fixture(({root,stage})=>{
  const candidate=readCandidate(null,root),artifacts=requiredReleaseArtifacts(stage,"darwin");
  expect(artifacts.some(item=>!item.exists)).toBe(true);
  const gate=assessActivation({candidate,shadow:{passed:true},ci:{status:"success"},artifacts,
   guardian:{independent:false,rollbackTested:false}});
  expect(gate.activationAllowed).toBe(false);
  expect(gate.liveServiceChanged).toBe(false);
  expect(gate.blockers.some(x=>x.startsWith("RELEASE_COMPONENT_MISSING"))).toBe(true);
  expect(gate.blockers).toContain("INDEPENDENT_ROLLBACK_GUARDIAN_NOT_VERIFIED");
 }));
 it("requires success from every independent gate without mutating live service",()=>{
  const input={candidate:{verified:true,receipt:{localSmokePassed:true,buildPassed:true}},
   shadow:{passed:true},ci:{status:"success"},
   artifacts:[{relative:"electron",exists:true}],guardian:{independent:true,rollbackTested:true}};
  const result=assessActivation(input);
  expect(result.activationAllowed).toBe(true);
  expect(result.liveServiceChanged).toBe(false);
  expect(result.phase).toBe("activation-eligible-but-not-executed");
  expect(assessActivation({...input,ci:{status:"unavailable"}}).activationAllowed).toBe(false);
  expect(assessActivation({...input,shadow:{passed:false}}).activationAllowed).toBe(false);
  expect(assessActivation({...input,candidate:{verified:false}}).activationAllowed).toBe(false);
 });
 it("pins GitHub Main CI by exact SHA and never treats a PR run as production readiness",async()=>{
  const sha="a".repeat(40),other="b".repeat(40);
  const ok=async()=>({ok:true,json:async()=>({workflow_runs:[
   {head_sha:other,name:"OWL Desktop Main CI",head_branch:"main",status:"completed",conclusion:"success"},
   {head_sha:sha,name:"OWL Desktop CI",head_branch:"feat/test",status:"completed",conclusion:"success"},
   {head_sha:sha,name:"OWL Desktop Main CI",head_branch:"main",status:"completed",conclusion:"success",id:42}
  ]})});
  expect((await githubMainCi(sha,{fetchImpl:ok})).status).toBe("success");
  const failure=async()=>({ok:true,json:async()=>({workflow_runs:[{head_sha:sha,name:"OWL Desktop CI",
   head_branch:"feat/test",status:"completed",conclusion:"success"}]})});
  expect((await githubMainCi(sha,{fetchImpl:failure})).status).toBe("pending");
  expect((await githubMainCi("not-sha",{fetchImpl:ok})).status).toBe("invalid-sha");
 });
});
