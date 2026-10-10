import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {describe,it,expect} from "vitest";
import {sendAuthorizedFile} from "../mcp/send-file.mjs";
const digest=d=>createHash("sha256").update(d).digest("hex");
async function fixture(run){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),"owl-send-file-")),p=path.join(dir,"report.pdf");
 await fs.writeFile(p,Buffer.from("%PDF-1.7\nowned test document"));
 try{await run(p)}finally{await fs.rm(dir,{recursive:true,force:true})}
}
async function authorize(p){const st=await fs.stat(p);return {path:await fs.realpath(p),type:"file",size:st.size,modifiedAt:st.mtime.toISOString()};}
const signed="https://s3.eu-central-1.amazonaws.com/object?X-Amz-Signature=example";
describe("outbound send_file safety",()=>{
 it("hashes and uploads exactly one authorized file and returns a short-lived private link",async()=>{
  await fixture(async p=>{
   const src=await fs.readFile(p),calls=[];
   const cloud={grantFileDelivery:async m=>{
    calls.push(["grant",m]);
    return {deliveryId:"one",fileName:m.fileName,size:m.size,sha256:m.sha256,uploadUrl:signed,
      downloadUrl:"https://s3.eu-central-1.amazonaws.com/download",downloadExpiresAt:"2026-10-10T16:30:00Z",uploadHeaders:{"content-type":m.mimeType}};
   }};
   const result=await sendAuthorizedFile(p,authorize,cloud,{fetchImpl:async(u,options)=>{calls.push(["upload",options]);return {ok:true,status:200}}});
   expect(calls.map(x=>x[0])).toEqual(["grant","upload"]);
   expect(calls[0][1].sha256).toBe(digest(src));
   expect(calls[1][1].body).toEqual(src);
   expect(result).toMatchObject({mimeType:"application/pdf",sha256:digest(src),type:"private_time_limited_link",isChatGptAttachment:false});
   expect(JSON.stringify(result)).not.toContain("X-Amz-Signature");
  });
 });
 it("denies protected, unauthorized and oversized paths",async()=>{
  await fixture(async p=>{
   await expect(sendAuthorizedFile(p,async()=>{throw Error("denied")},{})).rejects.toThrow("denied");
   await expect(sendAuthorizedFile("/Users/test/.ssh/id_rsa",authorize,{})).rejects.toMatchObject({code:"FILE_EXPORT_PROTECTED"});
   await expect(sendAuthorizedFile(p,authorize,{}, {maxBytes:8})).rejects.toMatchObject({code:"FILE_TOO_LARGE"});
  });
 });
 it("rejects an attacker-supplied upload URL before transmitting",async()=>{
  await fixture(async p=>{
   const cloud={grantFileDelivery:async m=>({fileName:m.fileName,size:m.size,sha256:m.sha256,
      uploadUrl:"https://attacker.example.com/x?X-Amz-Signature=fake",downloadUrl:"https://s3.eu-central-1.amazonaws.com/x"})};
   let sent=false;
   await expect(sendAuthorizedFile(p,authorize,cloud,{fetchImpl:async()=>{sent=true;return {ok:true}}})).rejects.toMatchObject({code:"FILE_UPLOAD_URL_INVALID"});
   expect(sent).toBe(false);
  });
 });
});
