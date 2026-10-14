import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createPublicKey,verify} from "node:crypto";
import {describe,it,expect} from "vitest";
import {createHumanApprovalSigner,approvalHumanMessage} from "../electron/services/human-approval-signer.mjs";
const secureStorage={
 isEncryptionAvailable:()=>true,
 encryptString:(s)=>Buffer.from("mock-encrypted:"+s),
 decryptString:(b)=>b.toString().replace(/^mock-encrypted:/,""),
};
const approval=()=>({
 id:"approval_demo_0123",fingerprint:"a".repeat(64),subjectType:"action",
 subject:"publish.mock_effect",ownerSessionId:"session",ownerTaskId:"task",
 ownerStepId:"step",expiresAt:new Date(Date.now()+300000).toISOString(),
 state:"pending",review:{complete:true,fields:{brandId:"island",visibility:"private"},redactedFields:[]},
});
describe("OS-backed human proof bridge",()=>{
 it("provisions encrypted key and binds signature to immutable approval fields",()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"owl-m6-signer-"));
  try{
   const signer=createHumanApprovalSigner({root,secureStorage});
   const key=signer.provision();
   expect(signer.provision()).toBe(key);
   const rec=approval(),sig=signer.signApproval(rec);
   const publicKey=createPublicKey({key:Buffer.from(key,"base64"),type:"spki",format:"der"});
   expect(verify(null,Buffer.from(approvalHumanMessage(rec)),publicKey,Buffer.from(sig,"base64"))).toBe(true);
   expect(verify(null,Buffer.from(approvalHumanMessage({...rec,ownerStepId:"wrong"})),publicKey,
     Buffer.from(sig,"base64"))).toBe(false);
   const raw=fs.readFileSync(path.join(root,"human-approval-signer.json"),"utf8");
   expect(raw).not.toContain("PRIVATE KEY");
   expect(raw).not.toContain("MC4CAQAwBQYDK2VwBCIE");
  }finally{fs.rmSync(root,{recursive:true,force:true});}
 });
 it("rejects missing OS encryption and incomplete or expired action preview",()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"owl-m6-signer-"));
  try{
   expect(()=>createHumanApprovalSigner({root,secureStorage:{...secureStorage,isEncryptionAvailable:()=>false}}).provision())
     .toThrow(/OS_ENCRYPTION_REQUIRED/);
   const signer=createHumanApprovalSigner({root,secureStorage});
   signer.provision();
   expect(()=>signer.signApproval({...approval(),review:{complete:false}})).toThrow(/EXACT_ARGUMENTS/);
   expect(()=>signer.signApproval({...approval(),state:"consumed"})).toThrow(/EXPIRED_APPROVAL/);
   expect(()=>signer.signApproval({...approval(),expiresAt:"2000-01-01T00:00:00Z"})).toThrow(/EXPIRED_APPROVAL/);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
 });
});
