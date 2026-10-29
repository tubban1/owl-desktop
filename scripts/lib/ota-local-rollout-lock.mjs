import fs from "node:fs";
import path from "node:path";

/**
 * Keep only one OTA transition active on a computer. An existing lock is
 * treated as "defer" (never as a failed release or reason to restart).
 * Fail closed on stale locks; owner inspection is required before removal.
 */
export function tryAcquireLocalRolloutLock(root, {
  filesystem=fs, pid=process.pid, now=Date.now
}={}) {
  filesystem.mkdirSync(root,{recursive:true,mode:0o700});
  const file=path.join(root,"rollout.lock");
  let fd;
  try {
    fd=filesystem.openSync(file,"wx",0o600);
  } catch(error) {
    if(error?.code==="EEXIST")return null;
    throw error;
  }
  try {
    filesystem.writeSync(fd,JSON.stringify({pid,at:now()}));
  }catch(error){
    try{filesystem.closeSync(fd)}catch{}
    try{filesystem.unlinkSync(file)}catch{}
    throw error;
  }
  let released=false;
  return ()=>{
    if(released)return;
    released=true;
    try{filesystem.closeSync(fd)}finally{
      try{filesystem.unlinkSync(file)}catch(error){if(error?.code!=="ENOENT")throw error}
    }
  };
}
