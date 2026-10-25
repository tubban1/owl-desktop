/** OS-protected Desktop approval signer. Private key never enters Runtime/env/MCP. */
import fs from "node:fs";
import path from "node:path";
import {generateKeyPairSync,createPrivateKey,sign} from "node:crypto";
import { missionApprovalMessage } from "./mission-approval.mjs";

export function approvalHumanMessage(r){
 return JSON.stringify({domain:"OWL_HUMAN_APPROVAL_V1",id:r.id,
  fingerprint:r.fingerprint,subjectType:r.subjectType,subject:r.subject,
  session:r.ownerSessionId,task:r.ownerTaskId??null,
  step:r.ownerStepId??null,expiresAt:r.expiresAt});
}
export function createHumanApprovalSigner({root,secureStorage}){
 const file=path.join(root,"human-approval-signer.json");
 const read=()=>{
  try{return JSON.parse(fs.readFileSync(file,"utf8"));}
  catch(e){if(e.code==="ENOENT")return null;throw new Error("HUMAN_SIGNER_RECORD_INVALID");}
 };
 const publicKey=()=>{
  const row=read();
  return typeof row?.publicKeyB64==="string"?row.publicKeyB64:null;
 };
 const provision=()=>{
  const stored=read();
  if(stored){if(!publicKey())throw new Error("HUMAN_SIGNER_RECORD_INVALID");return stored.publicKeyB64;}
  if(!secureStorage.isEncryptionAvailable())throw new Error("HUMAN_SIGNER_OS_ENCRYPTION_REQUIRED");
  const {privateKey,publicKey:generatedPublicKey}=generateKeyPairSync("ed25519");
  const privateB64=privateKey.export({format:"der",type:"pkcs8"}).toString("base64");
  const publicKeyB64=generatedPublicKey.export({format:"der",type:"spki"}).toString("base64");
  const encrypted=secureStorage.encryptString(privateB64).toString("base64");
  fs.mkdirSync(root,{recursive:true,mode:0o700});
  const staged=file+"."+process.pid+".tmp";
  fs.writeFileSync(staged,JSON.stringify({version:1,publicKeyB64,encrypted})+"\n",{mode:0o600,flag:"wx"});
  try{fs.renameSync(staged,file);}finally{if(fs.existsSync(staged))fs.rmSync(staged);}
  return publicKeyB64;
 };
 const signApproval=(approval)=>{
  if(!secureStorage.isEncryptionAvailable())throw new Error("HUMAN_SIGNER_OS_ENCRYPTION_REQUIRED");
  if(!approval||approval.state!=="pending"||!/^approval_[a-zA-Z0-9_-]+$/.test(approval.id)||
     !/^[a-f0-9]{64}$/.test(approval.fingerprint)||Date.parse(approval.expiresAt)<=Date.now())
    throw new Error("HUMAN_SIGNER_INVALID_OR_EXPIRED_APPROVAL");
  if(approval.review?.complete!==true)throw new Error("HUMAN_REVIEW_EXACT_ARGUMENTS_REQUIRED");
  const row=read();if(!row)throw new Error("HUMAN_SIGNER_NOT_PROVISIONED");
  const privateB64=secureStorage.decryptString(Buffer.from(row.encrypted,"base64"));
  const key=createPrivateKey({key:Buffer.from(privateB64,"base64"),format:"der",type:"pkcs8"});
  return sign(null,Buffer.from(approvalHumanMessage(approval),"utf8"),key).toString("base64");
 };
 const signMission=(scope)=>{
  if(!secureStorage.isEncryptionAvailable())throw new Error("MISSION_SIGNER_OS_ENCRYPTION_REQUIRED");
  if(scope?.domain!=="OWL_MISSION_APPROVAL_V1" ||
     !scope?.workstreamId?.startsWith("owl-workstream:") ||
     !scope?.workspaceRoot || !scope.allowedRepositories?.length)
    throw new Error("MISSION_SCOPE_INCOMPLETE");
  const row=read();
  if(!row)throw new Error("HUMAN_SIGNER_NOT_PROVISIONED");
  const privateB64=secureStorage.decryptString(Buffer.from(row.encrypted,"base64"));
  const key=createPrivateKey({key:Buffer.from(privateB64,"base64"),format:"der",type:"pkcs8"});
  return sign(null,Buffer.from(missionApprovalMessage(scope),"utf8"),key).toString("base64");
 };
 return {publicKey,provision,signApproval,signMission};
}
