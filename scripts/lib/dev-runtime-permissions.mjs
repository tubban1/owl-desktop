import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {applyRuntimePermissionModes,normalizeRuntimePermissionModes,RUNTIME_PERMISSION_DEFINITIONS} from "../../electron/services/runtime-permissions.mjs";

export const DEV_PERMISSION_FLAG_NAMES=Object.freeze([
 "ALLOW_WRITE","ALLOW_DELETE","ALLOW_SHELL","ALLOW_ROLLBACK","ALLOW_GIT_PUSH",
 "OWL_APPROVAL_MODE","OWL_APPROVAL_ACTIONS","OWL_SCOPED_CAPABILITIES",
 "OWL_SCOPED_ACTION_ALLOWLIST","OWL_HUMAN_APPROVAL_ENFORCE",
 "OWL_HUMAN_APPROVAL_PUBLIC_KEY_B64"
]);
export const devPermissionStatusFile=root=>path.join(root,"dev-permission-status.json");

export function readPublicApprovalSigner(userDataRoot){
 try{
  const p=path.join(userDataRoot,"human-approval-signer.json");
  const stat=fs.lstatSync(p);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.mode&0o077)return null;
  const row=JSON.parse(fs.readFileSync(p,"utf8"));
  return typeof row.publicKeyB64==="string"&&row.publicKeyB64.length<1024
   ?row.publicKeyB64:null;
 }catch{return null;}
}

export function buildDevRuntimePermissionPolicy({settingsFile,userDataRoot}){
 const raw=JSON.parse(fs.readFileSync(settingsFile,"utf8"));
 const permissionModes=normalizeRuntimePermissionModes(raw.runtimePermissionModes);
 const publicKey=readPublicApprovalSigner(userDataRoot);
 const env=new Map();
 // Only explicitly selected states influence the dev Runtime. Never inherit
 // flags from production ~/.owl/runtime.env.
 try{
  applyRuntimePermissionModes(env,{runtimePermissionModes:permissionModes},{
   humanApprovalPublicKey:publicKey,runtimeSignedApprovalSupported:true
  });
 }catch(error){
  // Fail closed. Missing signing keys must never enable unreviewed deletion.
  for(const [key,spec] of Object.entries(RUNTIME_PERMISSION_DEFINITIONS))
   env.set(spec.env,permissionModes[key]==="enabled"&&
      !(key==="shell"&&permissionModes.delete==="review")?"true":"false");
  env.set("OWL_APPROVAL_MODE","enforce");
  env.set("OWL_APPROVAL_ACTIONS","__none__");
  env.set("OWL_SCOPED_CAPABILITIES","0");
  env.set("OWL_HUMAN_APPROVAL_ENFORCE","0");
  env.set("OWL_SCOPED_ACTION_ALLOWLIST","");
  return {env:Object.fromEntries(env),modes:permissionModes,reviewReady:false,
   reason:/SIGNER/.test(String(error))?"SIGNER_REQUIRED":"REVIEW_POLICY_UNAVAILABLE",
   digest:createHash("sha256").update(JSON.stringify(permissionModes)).digest("hex")};
 }
 return {env:Object.fromEntries(env),modes:permissionModes,reviewReady:true,
  reason:null,digest:createHash("sha256").update(JSON.stringify(permissionModes)).digest("hex")};
}

export function writeDevRuntimePermissionStatus(file,state){
 fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
 const target=file+"."+process.pid+".tmp";
 const {env={},...rest}=state;
 // Status is informational; never persist public-key material or secrets.
 const flags=Object.fromEntries(Object.entries(env).filter(([key])=>
  DEV_PERMISSION_FLAG_NAMES.includes(key)&&key!=="OWL_HUMAN_APPROVAL_PUBLIC_KEY_B64"));
 fs.writeFileSync(target,JSON.stringify({...rest,flags})+"\n",{mode:0o600});
 fs.renameSync(target,file);
}
export function readDevRuntimePermissionStatus(file){
 try{
  const s=fs.lstatSync(file);
  if(!s.isFile()||s.isSymbolicLink()||s.mode&0o077)return null;
  const row=JSON.parse(fs.readFileSync(file,"utf8"));
  if(row?.version!==1||!Number.isSafeInteger(row?.ownerPid)||
    !row.flags||typeof row.flags!=="object"||Array.isArray(row.flags))return null;
  return row;
 }catch{return null;}
}
