import {createHash} from "node:crypto";
import {constants} from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
export const MAX_SEND_FILE_BYTES=25*1024*1024;
const M={".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".webp":"image/webp",".gif":"image/gif",".pdf":"application/pdf",".mp4":"video/mp4",".zip":"application/zip",".txt":"text/plain",".md":"text/markdown",".csv":"text/csv",".json":"application/json",".docx":"application/vnd.openxmlformats-officedocument.wordprocessingml.document",".xlsx":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",".pptx":"application/vnd.openxmlformats-officedocument.presentationml.presentation"};
const protectedParts=new Set([".ssh",".aws",".gnupg",".agentos",".owl-runtime-dev",".computer-mcp","Keychains"]);
function reject(message,code){const e=new Error(message);e.code=code;throw e}
function sourceSafe(p) {
 if(typeof p!=="string"||!path.isAbsolute(p))reject("An absolute file path is required","FILE_PATH_INVALID");
 if(p.split(path.sep).some(x=>protectedParts.has(x))||path.basename(p).startsWith(".")||/(\.env|\.pem|\.p12|\.pfx|\.key)$/i.test(p))
   reject("Protected local files cannot be exported","FILE_EXPORT_PROTECTED");
}
export async function sendAuthorizedFile(source,authorize,cloudClient,{fetchImpl=fetch,maxBytes=MAX_SEND_FILE_BYTES}={}){
 sourceSafe(source);
 const m=await authorize(source);
 if(m?.type!=="file"||typeof m.path!=="string"||!Number.isSafeInteger(m.size))reject("Runtime did not authorize a regular file","FILE_NOT_AUTHORIZED");
 if(m.size<1||m.size>maxBytes)reject("File must be 1 byte to 25 MiB","FILE_TOO_LARGE");
 const canonical=await fs.realpath(source);sourceSafe(canonical);
 if(canonical!==m.path)reject("File path changed after Runtime authorization","FILE_PATH_CHANGED");
 const h=await fs.open(canonical,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
 let bytes;
 try {
  const stat=await h.stat();
  if(!stat.isFile()||stat.size!==m.size||stat.mtime.toISOString()!==m.modifiedAt)reject("File changed after authorization","FILE_CHANGED");
  bytes=await h.readFile();
  if(bytes.length!==stat.size||bytes.length>maxBytes)reject("File changed during read","FILE_CHANGED");
  if((await fs.realpath(source))!==canonical)reject("File path changed during read","FILE_PATH_CHANGED");
 }finally{await h.close()}
 const fileName=path.basename(canonical),mimeType=M[path.extname(fileName).toLowerCase()]??"application/octet-stream";
 const sha256=createHash("sha256").update(bytes).digest("hex");
 const grant=await cloudClient.grantFileDelivery({fileName,size:bytes.length,mimeType,sha256});
 const url=new URL(grant.uploadUrl);
 if(url.protocol!=="https:"||!url.hostname.endsWith(".amazonaws.com")||!url.searchParams.has("X-Amz-Signature"))
  reject("Upload URL is not a signed S3 HTTPS URL","FILE_UPLOAD_URL_INVALID");
 if(grant.fileName!==fileName||grant.size!==bytes.length||grant.sha256!==sha256||
    typeof grant.downloadUrl!=="string"||!grant.downloadUrl.startsWith("https://"))
  reject("Cloud delivery grant mismatch","FILE_DELIVERY_GRANT_INVALID");
 let success=false;
 try {
  const response=await fetchImpl(grant.uploadUrl,{
   method:"PUT",body:bytes,headers:grant.uploadHeaders,redirect:"error",signal:AbortSignal.timeout(120000),
  });
  if(!response.ok)reject("Upload failed with HTTP "+response.status,"FILE_UPLOAD_FAILED");
  success=true;
 }finally{
  if(!success)await cloudClient.revokeFileDelivery?.(grant.deliveryId).catch(()=>undefined);
 }
 return {deliveryId:grant.deliveryId,fileName,size:bytes.length,mimeType,sha256,
  downloadUrl:grant.downloadUrl,expiresAt:grant.downloadExpiresAt,
  type:"private_time_limited_link",isChatGptAttachment:false};
}
