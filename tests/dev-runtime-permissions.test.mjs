import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {generateKeyPairSync} from "node:crypto";
import {describe,it,expect} from "vitest";
import {buildDevRuntimePermissionPolicy,writeDevRuntimePermissionStatus,
 readDevRuntimePermissionStatus,devPermissionStatusFile} from "../scripts/lib/dev-runtime-permissions.mjs";
import {runtimePermissionProjection} from "../electron/services/runtime-permissions.mjs";

function fixture(withSigner=true){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"owl-dev-policy-"));
 const data=path.join(root,"desktop");fs.mkdirSync(data,{recursive:true,mode:0o700});
 const settings=path.join(data,"settings.json");
 const modes={gitPush:"enabled",shell:"blocked",delete:"review",rollback:"blocked"};
 fs.writeFileSync(settings,JSON.stringify({runtimePermissionModes:modes}),{mode:0o600});
 if(withSigner){
  const {publicKey}=generateKeyPairSync("ed25519");
  fs.writeFileSync(path.join(data,"human-approval-signer.json"),JSON.stringify({
   publicKeyB64:publicKey.export({format:"der",type:"spki"}).toString("base64"),
   encrypted:"never-exposed"
  }),{mode:0o600});
 }
 return {root,data,settings,modes};
}
describe("DEV Runtime permissions are target-scoped and fail closed",()=>{
 it("projects exact signed Delete Ask with underlying ALLOW_DELETE OFF",()=>{
  const f=fixture();
  try{
   const result=buildDevRuntimePermissionPolicy({settingsFile:f.settings,userDataRoot:f.data});
   expect(result.reviewReady).toBe(true);
   expect(result.env.ALLOW_DELETE).toBe("false");
   expect(result.env.ALLOW_SHELL).toBe("false");
   expect(result.env.ALLOW_GIT_PUSH).toBe("true");
   expect(result.env.OWL_APPROVAL_ACTIONS).toBe("fs.delete");
   expect(result.env.OWL_SCOPED_ACTION_ALLOWLIST).toBe("fs.delete");
   const file=devPermissionStatusFile(f.root);
   writeDevRuntimePermissionStatus(file,{version:1,ownerPid:123,runtimePid:456,
    digest:result.digest,modes:result.modes,reviewReady:true,healthy:true,env:result.env});
   const status=readDevRuntimePermissionStatus(file);
   expect(JSON.stringify(status)).not.toContain("never-exposed");
   expect(JSON.stringify(status)).not.toContain(result.env.OWL_HUMAN_APPROVAL_PUBLIC_KEY_B64);
   const projected=runtimePermissionProjection({runtimePermissionModes:f.modes},"",{
    envOverride:new Map(Object.entries(status.flags)),reviewSupportOverride:true,
    signedKeyConfiguredOverride:true,liveVerified:true
   });
   expect(projected.restartRequired).toBe(false);
   expect(projected.liveRuntimeEffective).toBe("verified");
   const deletion=projected.items.find(x=>x.key==="delete");
   expect(deletion.mode).toBe("review");
   expect(deletion.configured).toBe(false);
   expect(deletion.reviewConfigured).toBe(true);
   expect(deletion.pendingApply).toBe(false);
   const mismatch=runtimePermissionProjection({runtimePermissionModes:{...f.modes,shell:"enabled"}},"",{
    envOverride:new Map(Object.entries(status.flags)),reviewSupportOverride:true,
    signedKeyConfiguredOverride:true
   });
   expect(mismatch.items.find(x=>x.key==="shell").pendingApply).toBe(true);
  }finally{fs.rmSync(f.root,{recursive:true,force:true});}
 });
 it("refuses unsigned Ask and leaves Delete disabled",()=>{
  const f=fixture(false);
  try{
   const policy=buildDevRuntimePermissionPolicy({settingsFile:f.settings,userDataRoot:f.data});
   expect(policy.reviewReady).toBe(false);
   expect(policy.reason).toBe("SIGNER_REQUIRED");
   expect(policy.env.ALLOW_DELETE).toBe("false");
   expect(policy.env.OWL_SCOPED_CAPABILITIES).toBe("0");
   expect(policy.env.OWL_APPROVAL_ACTIONS).toBe("__none__");
  }finally{fs.rmSync(f.root,{recursive:true,force:true});}
 });
 it("does not write keys to status and rejects insecure files",()=>{
  const f=fixture();
  try{
   const file=devPermissionStatusFile(f.root);
   writeDevRuntimePermissionStatus(file,{version:1,ownerPid:1,env:{
    ALLOW_DELETE:"false",OWL_HUMAN_APPROVAL_PUBLIC_KEY_B64:"PUBLIC_KEY_ONLY",OTHER_SECRET:"nope"
   }});
   expect(fs.statSync(file).mode&0o077).toBe(0);
   expect(readDevRuntimePermissionStatus(file).flags).toEqual({ALLOW_DELETE:"false"});
   fs.chmodSync(file,0o644);
   expect(readDevRuntimePermissionStatus(file)).toBeNull();
  }finally{fs.rmSync(f.root,{recursive:true,force:true});}
 });
});
