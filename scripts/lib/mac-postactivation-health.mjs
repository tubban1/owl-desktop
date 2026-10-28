import path from "node:path";

// DEV releases run exactly one Electron main process with 'electron .'.
// Electron helper / recovery-only child processes do not count as a desktop.
export function macDesktopMainPresent(releaseRoot, psOutput){
 const executable=path.join(releaseRoot,"node_modules","electron","dist","Electron.app","Contents","MacOS","Electron");
 return String(psOutput).split("\n").some(line=>{
  const match=line.trim().match(/^(\d+)\s+(.+)$/);
  if(!match)return false;
  const command=match[2].trim();
  return command===executable+" ." || command.startsWith(executable+" . ");
 });
}

export function postActivationRecoveryAction({healthy,firstSeenAt,now=Date.now(),supervisorPresent=true}){
 if(healthy)return "clear";
 if(!firstSeenAt||!Number.isFinite(Date.parse(firstSeenAt)))return "observe";
 const age=now-Date.parse(firstSeenAt);
 if(age<0)return "observe";
 if(age>=150000)return "rollback";
 if(age>30000&&!supervisorPresent)return "restart";
 return "wait";
}
