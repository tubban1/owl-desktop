import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {constants as flags} from "node:fs";
import {createHash,randomBytes,randomUUID} from "node:crypto";
import {secureUploadStagingRoot} from "./private-upload-staging.mjs";

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_FILES_PER_UPLOAD = 5;
const TTL_MS = 15 * 60_000;
const ALLOWED_SUFFIX = new Set([
  ".png",".jpg",".jpeg",".gif",".webp",".avif",".pdf",".txt",".csv",
  ".json",".md",".zip",".docx",".xlsx",".pptx",".mp4",".mov",".svg"
]);
const SECRET = /(?:^|[\/._-])(?:secret|credential|password|private|keychain|id_rsa|id_ed25519|\.env|\.ssh|\.aws|\.gnupg|\.npmrc|\.git)(?:[\/._-]|$)/i;
const MIME = {".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",
  ".gif":"image/gif",".webp":"image/webp",".avif":"image/avif",
  ".pdf":"application/pdf",".txt":"text/plain",".csv":"text/csv",
  ".json":"application/json",".md":"text/markdown",".zip":"application/zip",
  ".docx":"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx":"application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".mp4":"video/mp4",".mov":"video/quicktime",".svg":"image/svg+xml"};

function originOf(value) {
  try {const u=new URL(value);if(!["https:","http:"].includes(u.protocol))return null;return u.origin;}
  catch{return null;}
}
function inside(root,file) {
  const relative=path.relative(root,file);
  return relative!=="" && relative!==".." && !relative.startsWith(".."+path.sep) && !path.isAbsolute(relative);
}
function sourceAllowed(full) {
  const parts=full.split(path.sep);
  if(parts.some(part=>part.startsWith(".") && part!=="."))return false;
  if(SECRET.test(full))return false;
  return ALLOWED_SUFFIX.has(path.extname(full).toLowerCase());
}

// This service runs on the device where the source file exists, not in OWL Cloud.
// Files cannot be prepared unless the local Host was explicitly configured with
// authorized upload roots. An Agent cannot add new roots through the MCP API.
export function createAgentUploadBroker({
  allowedRoots=process.env.OWL_AGENT_UPLOAD_ROOTS?.split(path.delimiter).filter(Boolean)||[],
  allowedOrigins=process.env.OWL_AGENT_UPLOAD_ORIGINS?.split(/[;,]/).filter(Boolean)||[],
  tempRoot=path.join(os.tmpdir(),"owl-lab-agent-uploads-"+(process.getuid?.()??"user")),
  now=()=>Date.now(),
  ttlMs=TTL_MS
}={}) {
  const tickets=new Map();
  const uploads=new Map();
  const allowedSites=new Set(allowedOrigins.map(originOf).filter(Boolean));
  let stagingReady=false;
  const realRootsPromise=Promise.all(allowedRoots.map(async x=>{
    const root=await fs.realpath(path.resolve(x));
    if(!(await fs.stat(root)).isDirectory())throw Error("UPLOAD_ROOT_INVALID");
    return root;
  }));
  async function remove(ticket) {
    const t=tickets.get(ticket);
    if(!t)return;
    tickets.delete(ticket);
    await fs.rm(t.dir,{recursive:true,force:true}).catch(()=>{});
  }
  async function sweep() {
    for(const [key,value] of tickets) {
      if(value.expiresAt<=now())await remove(key);
    }
    for(const [key,value] of uploads) {
      if(value.expiresAt<=now())uploads.delete(key);
    }
  }
  async function prepare({owner,filePath,origin}) {
    if(typeof owner!=="string"||!owner.trim())throw Error("UPLOAD_OWNER_REQUIRED");
    const site=originOf(origin);
    if(!site)throw Error("UPLOAD_ORIGIN_INVALID");
    if(!allowedSites.has(site))throw Error("UPLOAD_DESTINATION_NOT_APPROVED");
    const roots=await realRootsPromise;
    if(roots.length===0)throw Error("UPLOAD_ROOT_NOT_CONFIGURED");
    if(typeof filePath!=="string"||!path.isAbsolute(filePath))throw Error("UPLOAD_ABSOLUTE_PATH_REQUIRED");
    const requested=path.resolve(filePath);
    // Hidden/secret paths and symlink entries are not authorized even when an
    // allowlisted root would otherwise contain their resolved target.
    if(!sourceAllowed(requested))throw Error("UPLOAD_FILE_TYPE_OR_PATH_NOT_ALLOWED");
    const source=await fs.realpath(requested);
    // macOS maps /var to /private/var: comparing realpath to the spelled path
    // would reject ordinary legitimate files. Reject final symlinks via lstat,
    // and compare resolved source to resolved allowed roots instead.
    if((await fs.lstat(requested)).isSymbolicLink() ||
       !roots.some(root=>inside(root,source)))throw Error("UPLOAD_FILE_OUTSIDE_ALLOWED_ROOTS");
    const ext=path.extname(source).toLowerCase();
    const h=await fs.open(source,flags.O_RDONLY | (flags.O_NOFOLLOW||0));
    let dir;
    try {
      const stat=await h.stat();
      if(!stat.isFile()||stat.size<=0||stat.size>MAX_FILE_BYTES)throw Error("UPLOAD_FILE_SIZE_OR_TYPE_INVALID");
      if(!stagingReady){
        await secureUploadStagingRoot(tempRoot);
        stagingReady=true;
      }
      // Unique private directory retains exact basename for browser file input.
      dir=await fs.mkdtemp(path.join(tempRoot,"file-"));
      await fs.chmod(dir,0o700);
      const basename=path.basename(source);
      const stage=path.join(dir,basename);
      const dest=await fs.open(stage,flags.O_WRONLY|flags.O_CREAT|flags.O_EXCL,0o600);
      const sha=createHash("sha256");
      let count=0;
      const buffer=Buffer.alloc(256*1024);
      try{
        for (;;) {
          const {bytesRead}=await h.read(buffer,0,buffer.length,null);
          if(!bytesRead)break;
          count+=bytesRead;
          if(count>MAX_FILE_BYTES||count>stat.size)throw Error("UPLOAD_SOURCE_CHANGED");
          sha.update(buffer.subarray(0,bytesRead));
          let written=0;
          while(written<bytesRead){
            const out=await dest.write(buffer,written,bytesRead-written);
            if(out.bytesWritten<=0)throw Error("UPLOAD_STAGING_WRITE_FAILED");
            written+=out.bytesWritten;
          }
        }
        if(count!==stat.size)throw Error("UPLOAD_SOURCE_CHANGED");
      }finally{await dest.close();}
      const ticket=randomBytes(24).toString("hex");
      const entry={owner,site,stage,dir,basename,size:stat.size,mime:MIME[ext],
        digest:sha.digest("hex"),expiresAt:now()+ttlMs,consumed:false};
      tickets.set(ticket,entry);
      return {file_ticket:ticket,filename:basename,bytes:stat.size,mime:entry.mime,
        sha256_prefix:entry.digest.slice(0,12),destination_origin:site,
        expires_at:new Date(entry.expiresAt).toISOString()};
    } catch(error) {
      if(dir)await fs.rm(dir,{recursive:true,force:true}).catch(()=>{});
      throw error;
    } finally{await h.close();}
  }
  async function resolve({owner,ticketIds,origin}) {
    await sweep();
    const site=originOf(origin);
    if(!site)throw Error("UPLOAD_ORIGIN_INVALID");
    if(!Array.isArray(ticketIds)||ticketIds.length<1||ticketIds.length>MAX_FILES_PER_UPLOAD ||
       new Set(ticketIds).size!==ticketIds.length)throw Error("UPLOAD_TICKETS_INVALID");
    return ticketIds.map(key=>{
      const t=tickets.get(key);
      if(!t||t.consumed||t.owner!==owner||t.site!==site)throw Error("UPLOAD_TICKET_NOT_AUTHORIZED");
      return {ticket:key,stagedPath:t.stage,filename:t.basename,size:t.size,mime:t.mime};
    });
  }
  async function recordSelection({owner,ticketIds,pageId,inputUid,result,origin}) {
    const files=await resolve({owner,ticketIds,origin});
    if(!result?.selected||result.pageId!==pageId||
       result.selectedCount!==files.length)throw Error("UPLOAD_INPUT_SELECTION_UNCONFIRMED");
    for(const key of ticketIds)tickets.get(key).consumed=true;
    const upload_id=randomUUID();
    const entry={owner,pageId,inputUid,site:origin,files:files.map(f=>({name:f.filename,bytes:f.size})),
      state:"selected",expiresAt:now()+ttlMs};
    uploads.set(upload_id,entry);
    return {upload_id,page_id:pageId,state:"selected",website_upload_verified:false,
      files:entry.files,description:"File(s) attached to browser input; website receipt must be verified separately."};
  }
  async function recordDrop({owner,ticketIds,pageId,targetUid,result,origin}){
    const files=await resolve({owner,ticketIds,origin});
    if(result?.dispatched!==true||result.pageId!==pageId||
       result.transferredCount!==files.length)throw Error("FILE_DROP_DISPATCH_UNCONFIRMED");
    for(const key of ticketIds)tickets.get(key).consumed=true;
    const uploadId=randomUUID();
    const state=result.domObserved?"ui_observed":"dispatched_unconfirmed";
    const entry={owner,pageId,inputUid:targetUid,site:origin,
      files:files.map(f=>({name:f.filename,bytes:f.size})),state,
      expiresAt:now()+ttlMs};
    uploads.set(uploadId,entry);
    return {upload_id:uploadId,page_id:pageId,state,
      website_upload_verified:false,files:entry.files,
      description:"File drag event dispatched; website receipt is not independently verified."};
  }
  async function status({owner,uploadId}) {
    await sweep();
    const r=uploads.get(uploadId);
    if(!r||r.owner!==owner)throw Error("UPLOAD_STATUS_NOT_FOUND");
    return {upload_id:uploadId,page_id:r.pageId,state:r.state,
      website_upload_verified:false,files:r.files};
  }
  async function release({owner,ticketIds=[]}) {
    let released=0;
    for(const key of ticketIds){
      const e=tickets.get(key);
      if(e?.owner===owner){await remove(key);released++;}
    }
    return {released};
  }
  const sweeper=setInterval(()=>{sweep().catch(()=>{});},60_000);
  sweeper.unref?.();
  async function close() {
    clearInterval(sweeper);
    for(const key of [...tickets.keys()])await remove(key);
    uploads.clear();
  }
  return {prepare,resolve,recordSelection,recordDrop,status,release,sweep,close,
    capabilities:()=>({uploadFile:true,rootsConfigured:allowedRoots.length>0,
      destinationsConfigured:allowedSites.size>0,
      supportedExtensions:[...ALLOWED_SUFFIX],maxFileBytes:MAX_FILE_BYTES,maxFilesPerUpload:MAX_FILES_PER_UPLOAD})};
}
