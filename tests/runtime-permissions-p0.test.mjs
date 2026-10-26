import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {describe,expect,it} from "vitest";
import {
 normalizeRuntimePermissionModes,validateRuntimePermissionChange,
 applyRuntimePermissionModes,runtimePermissionProjection,installedRuntimeSupportsSignedReview,EXACT_APPROVAL_ACTIONS,runtimePermissionChangeCopy
} from "../electron/services/runtime-permissions.mjs";

describe("P0 Runtime permission policy",()=>{
 it("exposes ALLOW_WRITE through Settings without faking signed per-write Ask",()=>{
  expect(validateRuntimePermissionChange("write","enabled")).toEqual({key:"write",mode:"enabled"});
  expect(validateRuntimePermissionChange("write","blocked")).toEqual({key:"write",mode:"blocked"});
  expect(()=>validateRuntimePermissionChange("write","review")).toThrow("INVALID_RUNTIME_PERMISSION_CHANGE");
  expect(normalizeRuntimePermissionModes({write:"review"}).write).toBe("blocked");
  const blocked=new Map([["ALLOW_WRITE","true"]]);
  applyRuntimePermissionModes(blocked,{runtimePermissionModes:{write:"blocked"}});
  expect(blocked.get("ALLOW_WRITE")).toBe("false");
  const enabled=new Map([["ALLOW_WRITE","false"]]);
  applyRuntimePermissionModes(enabled,{runtimePermissionModes:{write:"enabled"}});
  expect(enabled.get("ALLOW_WRITE")).toBe("true");
 });
 it("does not claim write permission active until managed Runtime has applied the flag",()=>{
  const projection=runtimePermissionProjection({runtimePermissionModes:{write:"enabled"}},"",
    {envOverride:new Map([["ALLOW_WRITE","false"],["OWL_APPROVAL_MODE","enforce"]])});
  const write=projection.items.find(item=>item.key==="write");
  expect(write?.supportsReview).toBe(false);
  expect(write?.pendingApply).toBe(true);
  expect(projection.restartRequired).toBe(true);
  expect(projection.liveRuntimeEffective).toBe("unverified");
 });

 it("resolves legacy inherit without elevating disabled permissions",()=>{
  expect(normalizeRuntimePermissionModes(null)).toEqual({
   write:"enabled",gitPush:"enabled",shell:"blocked",delete:"blocked",rollback:"blocked"});
  const env=new Map([["ALLOW_GIT_PUSH","false"],["ALLOW_DELETE","false"]]);
  applyRuntimePermissionModes(env,{});
  expect(env.get("ALLOW_GIT_PUSH")).toBe("false");
  expect(env.get("ALLOW_DELETE")).toBe("false");
  expect(env.get("OWL_APPROVAL_ACTIONS")).toBe("__none__");
  expect(env.get("OWL_APPROVAL_MODE")).toBe("enforce");
 });
 it("does not permit Shell On to bypass Delete Ask",()=>{
  const env=new Map();
  expect(()=>applyRuntimePermissionModes(env,{
    runtimePermissionModes:{delete:"review",shell:"enabled"}
  },{humanApprovalPublicKey:"TEST_KEY",runtimeSignedApprovalSupported:true}))
   .toThrow("DELETE_ASK_REQUIRES_SHELL_ASK_OR_OFF");
  expect(env.has("ALLOW_SHELL")).toBe(false);
  const good=new Map();
  applyRuntimePermissionModes(good,{runtimePermissionModes:{
    delete:"review",shell:"review"
  }},{humanApprovalPublicKey:"TEST_KEY",runtimeSignedApprovalSupported:true});
  expect(good.get("ALLOW_DELETE")).toBe("false");
  expect(good.get("ALLOW_SHELL")).toBe("false");
  expect(good.get("OWL_APPROVAL_ACTIONS")).toContain("shell.exec");
  expect(good.get("OWL_APPROVAL_ACTIONS")).toContain("fs.delete");
 });
 it("rejects invalid or unconditional capability requests",()=>{
  expect(()=>validateRuntimePermissionChange("__proto__","review")).toThrow();
  expect(validateRuntimePermissionChange("gitPush","enabled")).toEqual({key:"gitPush",mode:"enabled"});
  expect(validateRuntimePermissionChange("gitPush","review")).toEqual({key:"gitPush",mode:"review"});
  expect(()=>validateRuntimePermissionChange("gitPush","always")).toThrow();
  expect(()=>validateRuntimePermissionChange("gitPush",true)).toThrow();
 });
 it("configures only selected capabilities and enforces exact Runtime action review",()=>{
  const env=new Map([["ALLOW_SHELL","false"],["ALLOW_DELETE","true"]]);
  applyRuntimePermissionModes(env,{runtimePermissionModes:{
   gitPush:"enabled",shell:"review",delete:"blocked",rollback:"blocked"}},
   {humanApprovalPublicKey:"TEST_PUBLIC_KEY",runtimeSignedApprovalSupported:true});
  expect(env.get("ALLOW_GIT_PUSH")).toBe("true");
  expect(env.get("ALLOW_SHELL")).toBe("false");
  expect(env.get("ALLOW_DELETE")).toBe("false");
  expect(env.get("ALLOW_ROLLBACK")).toBe("false");
  expect(env.get("OWL_SCOPED_ACTION_ALLOWLIST")).toContain("shell.exec");
  expect(env.get("OWL_SCOPED_ACTION_ALLOWLIST")).not.toContain("git.push");
  const covered=env.get("OWL_APPROVAL_ACTIONS").split(",");
  for(const action of ["shell.exec","shell.start","shell.input","shell.kill"])
   expect(covered).toContain(action);
  for(const action of ["fs.delete","tx.rollback","git.push"])
   expect(covered).not.toContain(action);
 });
 it("refuses Review without signed Runtime 1.x support",()=>{
  expect(()=>applyRuntimePermissionModes(new Map(),{runtimePermissionModes:{delete:"review"}},
   {humanApprovalPublicKey:"TEST_PUBLIC_KEY"})).toThrow(/RUNTIME_M6_SIGNED_APPROVAL/);
 });
 it("explicit Blocked disables Push, review remains review",()=>{
  expect(normalizeRuntimePermissionModes({gitPush:"review"}).gitPush).toBe("review");
  const env=new Map([["ALLOW_GIT_PUSH","true"],["OWL_APPROVAL_ACTIONS","git.push,custom.action"]]);
  applyRuntimePermissionModes(env,{runtimePermissionModes:{gitPush:"blocked"}});
  expect(env.get("ALLOW_GIT_PUSH")).toBe("false");
  expect(env.get("OWL_APPROVAL_ACTIONS").split(",")).not.toContain("git.push");
  expect(env.get("OWL_APPROVAL_ACTIONS")).toContain("custom.action");
 });
 it("Git Push Review requires a signed one-use approval rather than silently enabling push",()=>{
  const env=new Map([["OWL_APPROVAL_ACTIONS","custom.action"],["ALLOW_GIT_PUSH","false"]]);
  applyRuntimePermissionModes(env,{runtimePermissionModes:{gitPush:"review"}},
   {humanApprovalPublicKey:"TEST_PUBLIC_KEY",runtimeSignedApprovalSupported:true});
  expect(env.get("ALLOW_GIT_PUSH")).toBe("true");
  expect(env.get("OWL_APPROVAL_ACTIONS").split(",")).toContain("git.push");
  expect(env.get("OWL_HUMAN_APPROVAL_ENFORCE")).toBe("1");
  expect(env.get("OWL_SCOPED_ACTION_ALLOWLIST")).not.toContain("git.push");
 });
 it("detects review not active when flags, signature or action policy are missing",()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"owl-review-state-"));
  try{
   const envPath=path.join(root,"runtime.env");
   fs.writeFileSync(envPath,"ALLOW_DELETE=false\nOWL_APPROVAL_MODE=enforce\n");
   const result=runtimePermissionProjection({runtimePermissionModes:{delete:"review"}},envPath);
   const del=result.items.find(item=>item.key==="delete");
   expect(del.pendingApply).toBe(true);
   expect(del.reviewConfigured).toBe(false);
   expect(result.restartRequired).toBe(true);
   fs.writeFileSync(envPath,"ALLOW_DELETE=true\nOWL_APPROVAL_MODE=enforce\nOWL_APPROVAL_ACTIONS=fs.delete,tx.rollback,shell.exec,shell.start,shell.input,shell.kill\n");
   const incomplete=runtimePermissionProjection({runtimePermissionModes:{delete:"review"}},envPath);
   expect(incomplete.items.find(item=>item.key==="delete").pendingApply).toBe(true);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
 });
 it("retains unrelated approval actions but prompts only for selected Ask capabilities",()=>{
  const env=new Map([["OWL_APPROVAL_ACTIONS","custom.action"]]);
  applyRuntimePermissionModes(env,{runtimePermissionModes:{shell:"review"}},
   {humanApprovalPublicKey:"TEST_PUBLIC_KEY",runtimeSignedApprovalSupported:true});
  expect(env.get("OWL_APPROVAL_ACTIONS").split(",")).toContain("custom.action");
  expect(env.get("OWL_APPROVAL_ACTIONS").split(",")).toContain("shell.exec");
 });
 it("detects unsupported installed rc4 rather than falsely reporting Review ready",()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"owl-runtime-compat-"));
  try{
   const envFile=path.join(root,"runtime.env"),componentFile=path.join(root,"component.json");
   const env=new Map();
   applyRuntimePermissionModes(env,{runtimePermissionModes:{delete:"review"}},
     {humanApprovalPublicKey:"TEST_KEY",runtimeSignedApprovalSupported:true});
   fs.writeFileSync(envFile,[...env].map(([k,v])=>k+"="+v).join("\n"));
   fs.writeFileSync(componentFile,JSON.stringify({version:"1.0.0-rc.4",capabilities:{}}));
   expect(installedRuntimeSupportsSignedReview(componentFile)).toBe(false);
   const p=runtimePermissionProjection({runtimePermissionModes:{delete:"review"}},envFile,
     {componentFile});
   expect(p.items.find(x=>x.key==="delete").pendingApply).toBe(true);
   expect(p.installedRuntimeSupportsReview).toBe(false);
   expect(p.message).toContain("REVIEW UNAVAILABLE");
   fs.writeFileSync(componentFile,JSON.stringify({capabilities:{
      humanApprovalSignatureV1:true,scopedCapabilityV1:true}}));
   expect(runtimePermissionProjection({runtimePermissionModes:{delete:"review"}},envFile,
     {componentFile}).items.find(x=>x.key==="delete").pendingApply).toBe(false);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
 });
 it("offers On, Off and Ask consistently for all four permissions",()=>{
  const defs={gitPush:["ALLOW_GIT_PUSH",["git.push"]],
   shell:["ALLOW_SHELL",["shell.exec","shell.start","shell.input","shell.kill"]],
   delete:["ALLOW_DELETE",["fs.delete"]],rollback:["ALLOW_ROLLBACK",["tx.rollback"]]};
  for(const [key,[flag,actions]] of Object.entries(defs)){
   for(const mode of ["enabled","blocked","review"]){
    expect(validateRuntimePermissionChange(key,mode)).toEqual({key,mode});
    const env=new Map();
    applyRuntimePermissionModes(env,{runtimePermissionModes:{[key]:mode}},
     {humanApprovalPublicKey:"TEST_KEY",runtimeSignedApprovalSupported:true});
    expect(env.get(flag)).toBe(mode==="enabled"||(key==="gitPush"&&mode==="review")?"true":"false");
    const approved=env.get("OWL_APPROVAL_ACTIONS").split(",");
    for(const action of actions)expect(approved.includes(action)).toBe(mode==="review");
    expect(env.get("OWL_HUMAN_APPROVAL_ENFORCE")).toBe(mode==="review"?"1":"0");
   }
  }
 });
 it("uses matching confirmation text for each permission mode",()=>{
  for(const mode of ["enabled","blocked","review"]){
   const copy=runtimePermissionChangeCopy(mode);
   expect(copy.button).toBeTruthy();
   expect(copy.message).toBeTruthy();
   expect(copy.detail).toBeTruthy();
  }
  expect(runtimePermissionChangeCopy("enabled").button).toContain("打开");
  expect(runtimePermissionChangeCopy("blocked").button).toContain("关闭");
  expect(runtimePermissionChangeCopy("review").button).toContain("询问");
  expect(runtimePermissionChangeCopy("enabled").message).not.toMatch(/turn off|block/i);
  expect(runtimePermissionChangeCopy("review").message).toMatch(/approval/i);
  expect(()=>runtimePermissionChangeCopy("inherit")).toThrow();
 });
 it("migrates old inherit values from active environment instead of exposing inherit",()=>{
  const flags=new Map([
   ["ALLOW_GIT_PUSH","false"],["ALLOW_SHELL","true"],["ALLOW_DELETE","false"],
   ["ALLOW_ROLLBACK","true"],["OWL_APPROVAL_MODE","enforce"],
   ["OWL_APPROVAL_ACTIONS","shell.exec,shell.start,shell.input,shell.kill,tx.rollback"]]);
  expect(normalizeRuntimePermissionModes({gitPush:"inherit",delete:"inherit"},flags)).toEqual({
   write:"enabled",gitPush:"blocked",shell:"review",delete:"blocked",rollback:"review"});
  expect(normalizeRuntimePermissionModes({delete:"review"},flags).delete).toBe("review");
  const legacyDefault=new Map([["ALLOW_DELETE","true"],["ALLOW_ROLLBACK","true"],
   ["OWL_APPROVAL_MODE","enforce"]]);
  expect(normalizeRuntimePermissionModes({},legacyDefault).delete).toBe("review");
  expect(normalizeRuntimePermissionModes({},legacyDefault).rollback).toBe("review");
 });
 it("allows other On actions without a prompt when Shell is Ask",()=>{
  const env=new Map();
  applyRuntimePermissionModes(env,{runtimePermissionModes:{
   gitPush:"enabled",shell:"review",delete:"enabled",rollback:"blocked"}},
   {humanApprovalPublicKey:"TEST_KEY",runtimeSignedApprovalSupported:true});
  const approvals=env.get("OWL_APPROVAL_ACTIONS").split(",");
  expect(approvals).toContain("shell.exec");
  expect(approvals).not.toContain("fs.delete");
  expect(approvals).not.toContain("git.push");
  expect(env.get("ALLOW_DELETE")).toBe("true");
  expect(env.get("OWL_SCOPED_ACTION_ALLOWLIST")).not.toContain("fs.delete");
 });
 it("never treats saved flags as connected process effective privileges",()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"owl-permissions-"));
  try{
   const envPath=path.join(root,"runtime.env");
   fs.writeFileSync(envPath,"OWL_RUNTIME_API_TOKEN=CONFIDENTIAL\nALLOW_GIT_PUSH=false\nALLOW_SHELL=true\n");
   const result=runtimePermissionProjection({runtimePermissionModes:{gitPush:"enabled",shell:"blocked"}},envPath,{packaged:true});
   expect(result.restartRequired).toBe(true);
   expect(result.approvalPolicyPending).toBe(true);
   expect(result.liveRuntimeEffective).toBe("unverified");
   expect(JSON.stringify(result)).not.toContain("CONFIDENTIAL");
  }finally{fs.rmSync(root,{recursive:true,force:true});}
 });
});
