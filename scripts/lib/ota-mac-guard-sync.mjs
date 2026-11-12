import fs from "node:fs";
import path from "node:path";
import {createHash, randomUUID} from "node:crypto";

// Synchronized immediately before installing a new independent watchdog job.
// The caller MUST first verify the candidate release's pinned SHA and clean Git
// tree, and MUST own the OTA local rollout lock. This has no process side effects.
export const MAC_GUARD_FILES=Object.freeze([
  "mac-safe-cutover.mjs",
  "lib/mac-postactivation-health.mjs",
]);

const hash=(bytes)=>createHash("sha256").update(bytes).digest("hex");

export function syncMacGuardFromVerifiedRelease({releaseRoot,agentRoot}) {
  if(!path.isAbsolute(releaseRoot)||!path.isAbsolute(agentRoot))
    throw Error("MAC_GUARD_ROOT_INVALID");
  const items=MAC_GUARD_FILES.map(relative=>{
    const source=path.join(releaseRoot,"scripts",relative);
    const target=path.join(agentRoot,relative);
    const info=fs.lstatSync(source);
    if(!info.isFile()||info.isSymbolicLink()||info.size>256*1024)
      throw Error("MAC_GUARD_SOURCE_INVALID:"+relative);
    const bytes=fs.readFileSync(source);
    if(fs.existsSync(target)&&fs.lstatSync(target).isSymbolicLink())
      throw Error("MAC_GUARD_TARGET_SYMLINK:"+relative);
    const existing=fs.existsSync(target)?fs.readFileSync(target):null;
    return {relative,target,bytes,existing,expected:hash(bytes),
      changed:!existing||!existing.equals(bytes)};
  });
  const updated=[];
  try{
    for(const item of items.filter(item=>item.changed)){
      fs.mkdirSync(path.dirname(item.target),{recursive:true,mode:0o700});
      const temp=item.target+".ota-sync-"+randomUUID()+".tmp";
      try{
        fs.writeFileSync(temp,item.bytes,{flag:"wx",mode:0o600});
        fs.renameSync(temp,item.target);
      }finally{try{fs.unlinkSync(temp)}catch{}}
      updated.push(item);
    }
    for(const item of items) {
      if(hash(fs.readFileSync(item.target))!==item.expected)
        throw Error("MAC_GUARD_INSTALL_HASH_MISMATCH:"+item.relative);
    }
  }catch(error){
    // Restore only files touched in this transaction, without touching the
    // current running Desktop or changing launchd jobs.
    for(const item of updated.reverse()){
      if(!item.existing){try{fs.unlinkSync(item.target)}catch{};continue;}
      const temp=item.target+".ota-restore-"+randomUUID()+".tmp";
      try{fs.writeFileSync(temp,item.existing,{flag:"wx",mode:0o600});
        fs.renameSync(temp,item.target);}finally{try{fs.unlinkSync(temp)}catch{}}
    }
    throw error;
  }
  return {verified:true,changed:updated.map(item=>item.relative),
    checksums:Object.fromEntries(items.map(item=>[item.relative,item.expected]))};
}
