import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {describe,expect,it} from "vitest";
import {
 normalizeRuntimePermissionModes,validateRuntimePermissionChange,
 applyRuntimePermissionModes,runtimePermissionProjection,EXACT_APPROVAL_ACTIONS
} from "../electron/services/runtime-permissions.mjs";

describe("P0 Runtime permission policy",()=>{
 it("inherits legacy flags, never silently enables privileges",()=>{
  expect(normalizeRuntimePermissionModes(null)).toEqual({
   gitPush:"inherit",shell:"inherit",delete:"inherit",rollback:"inherit"});
  const env=new Map([["ALLOW_GIT_PUSH","false"]]);
  applyRuntimePermissionModes(env,{});
  expect(env.get("ALLOW_GIT_PUSH")).toBe("false");
  expect(env.get("OWL_APPROVAL_MODE")).toBe("enforce");
 });
 it("rejects invalid or unconditional capability requests",()=>{
  expect(()=>validateRuntimePermissionChange("__proto__","review")).toThrow();
  expect(()=>validateRuntimePermissionChange("gitPush","always")).toThrow();
  expect(()=>validateRuntimePermissionChange("gitPush",true)).toThrow();
 });
 it("configures only selected capabilities and enforces exact Runtime action review",()=>{
  const env=new Map([["ALLOW_SHELL","false"],["ALLOW_DELETE","true"]]);
  applyRuntimePermissionModes(env,{runtimePermissionModes:{
   gitPush:"review",shell:"blocked",delete:"blocked",rollback:"blocked"}},
   {humanApprovalPublicKey:"TEST_PUBLIC_KEY",runtimeSignedApprovalSupported:true});
  expect(env.get("ALLOW_GIT_PUSH")).toBe("true");
  expect(env.get("ALLOW_SHELL")).toBe("false");
  expect(env.get("ALLOW_DELETE")).toBe("false");
  expect(env.get("ALLOW_ROLLBACK")).toBe("false");
  expect(env.get("OWL_SCOPED_ACTION_ALLOWLIST")).toBe("git.push");
  const covered=env.get("OWL_APPROVAL_ACTIONS").split(",");
  for(const action of EXACT_APPROVAL_ACTIONS)expect(covered).toContain(action);
 });
 it("refuses Review without signed Runtime 1.x support",()=>{
  expect(()=>applyRuntimePermissionModes(new Map(),{runtimePermissionModes:{gitPush:"review"}},
   {humanApprovalPublicKey:"TEST_PUBLIC_KEY"})).toThrow(/RUNTIME_M6_SIGNED_APPROVAL/);
 });
 it("preserves extra approval actions, without removing mandatory ones",()=>{
  const env=new Map([["OWL_APPROVAL_ACTIONS","custom.action"]]);
  applyRuntimePermissionModes(env,{runtimePermissionModes:{shell:"review"}},
   {humanApprovalPublicKey:"TEST_PUBLIC_KEY",runtimeSignedApprovalSupported:true});
  expect(env.get("OWL_APPROVAL_ACTIONS").split(",")).toContain("custom.action");
  expect(env.get("OWL_APPROVAL_ACTIONS").split(",")).toContain("shell.exec");
 });
 it("never treats saved flags as connected process effective privileges",()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"owl-permissions-"));
  try{
   const envPath=path.join(root,"runtime.env");
   fs.writeFileSync(envPath,"OWL_RUNTIME_API_TOKEN=CONFIDENTIAL\nALLOW_GIT_PUSH=false\nALLOW_SHELL=true\n");
   const result=runtimePermissionProjection({runtimePermissionModes:{gitPush:"review",shell:"blocked"}},envPath,{packaged:true});
   expect(result.restartRequired).toBe(true);
   expect(result.approvalPolicyPending).toBe(true);
   expect(result.liveRuntimeEffective).toBe("unverified");
   expect(JSON.stringify(result)).not.toContain("CONFIDENTIAL");
  }finally{fs.rmSync(root,{recursive:true,force:true});}
 });
});
