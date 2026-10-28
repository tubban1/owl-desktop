// Prevent old macOS release LaunchAgents from being re-run at next login.
// Only retire an *inactive* prior DEV release CURRENT label. Keep the active
// release, its own watchdog/fallback, and all user worktrees untouched.
import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
const CURRENT=/^fan\.fde\.owl\.dev-release\.(?:qa\.)?[a-f0-9]{8}\.current$/;
function runLaunchctl(args){
 const r=spawnSync("/bin/launchctl",args,{encoding:"utf8",timeout:5000});
 return {ok:r.status===0,stdout:r.stdout||"",stderr:r.stderr||""};
}
export function retireSupersededMacCurrentJobs({
 agents,activeLabel,userId=process.getuid?.(),launchctl=runLaunchctl
}){
 if(process.platform!=="darwin")throw Error("MAC_RELEASE_RETIRE_UNSUPPORTED_OS");
 if(!CURRENT.test(activeLabel)||!Number.isSafeInteger(userId))throw Error("MAC_RELEASE_RETIRE_INVALID_ACTIVE");
 const retired=[],skipped=[];
 for(const file of fs.readdirSync(agents).filter(f=>f.endsWith(".plist")).sort()){
  const label=file.slice(0,-6);
  if(!CURRENT.test(label)||label===activeLabel)continue;
  const location=path.join(agents,file);
  const target=location+".disabled-after-"+activeLabel.split(".").at(-2);
  if(fs.existsSync(target)){skipped.push({label,reason:"already-disabled"});continue;}
  const job=launchctl(["print","gui/"+userId+"/"+label]);
  if(job.ok&&/\bstate = running\b/.test(job.stdout)){
   skipped.push({label,reason:"job-still-running"});
   continue;
  }
  if(job.ok){
   const stopped=launchctl(["bootout","gui/"+userId+"/"+label]);
   if(!stopped.ok){skipped.push({label,reason:"bootout-failed"});continue;}
  }
  fs.renameSync(location,target);
  retired.push(label);
 }
 return {retired,skipped};
}
