// Repair a stalled, orphaned *isolated* macOS DEV Runtime only after
// exact process identity, parent death and failed HTTP health are confirmed.
// Never inspect or signal the production Runtime, user tasks or unknown PIDs.
import path from "node:path";
import {spawnSync} from "node:child_process";

function command(bin,args){
 const result=spawnSync(bin,args,{encoding:"utf8",timeout:4500,maxBuffer:65536});
 return result.status===0 ? result.stdout.trim() : null;
}

function readProcess(pid){
 if(!Number.isSafeInteger(pid)||pid<=1)return null;
 const output=command("/bin/ps",["-p",String(pid),"-o","uid=","-o","ppid=","-o","lstart=","-o","command="]);
 // macOS ps emits: UID PPID Day Mon DD HH:MM:SS YYYY COMMAND.
 const m=output?.match(/^\s*(\d+)\s+(\d+)\s+((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\w+\s+\d+\s+\d+:\d+:\d+\s+\d{4})\s+(.+)$/s);
 return m?{pid,uid:Number(m[1]),ppid:Number(m[2]),birth:m[3],command:m[4]}:null;
}

function listeningPids(port){
 const output=command("/usr/sbin/lsof",["-nP","-t","-iTCP:"+port,"-sTCP:LISTEN"]);
 if(output===null)return [];
 const entries=output.split(/\s+/).filter(Boolean);
 if(entries.some(x=>!/^[0-9]+$/.test(x)))return [];
 return [...new Set(entries.map(Number))];
}

export function qualifyOrphanDevRuntime({listener,parent,runtimeRoot,currentUid,supervisorPresent=false,runtimeHealthy=false}){
 if(supervisorPresent)return "SUPERVISOR_PRESENT";
 if(runtimeHealthy)return "RUNTIME_HEALTHY";
 if(!listener||!parent)return "PROCESS_EVIDENCE_MISSING";
 if(listener.uid!==currentUid||parent.uid!==currentUid)return "FOREIGN_USER";
 if(listener.pid===parent.pid||listener.ppid!==parent.pid||parent.ppid!==1)return "NOT_ORPHAN_TREE";
 if(!Number.isSafeInteger(listener.pid)||!Number.isSafeInteger(parent.pid)||listener.pid<=1||parent.pid<=1)return "INVALID_PID";
 if(!listener.birth||!parent.birth)return "MISSING_BIRTH";
 const root=path.resolve(runtimeRoot);
 const cli=path.join(root,"node_modules","tsx","dist","cli.mjs");
 const preload=path.join(root,"node_modules","tsx","dist","preflight.cjs");
 const loader=path.join(root,"node_modules","tsx","dist","loader.mjs");
 // Strictly match the known two-process tsx runtime launched by dev-full.
 if(!parent.command.includes(cli+" src/server.ts"))return "PARENT_NOT_DEV_RUNTIME";
 if(!listener.command.includes(preload)||!listener.command.includes(loader)||
    !listener.command.trimEnd().endsWith(" src/server.ts"))return "LISTENER_NOT_DEV_RUNTIME";
 return "VERIFIED_STALE_DEV_RUNTIME";
}

export async function recoverOrphanedMacDevRuntime({
 runtimeRoot, port=18788, uid=process.getuid?.(), platform=process.platform,
 readListenerPids=listeningPids, readPid=readProcess,
 isRuntimeHealthy=async()=>true, hasSupervisor=()=>true,
 signal=(pid,name)=>process.kill(pid,name)
}={}){
 if(platform!=="darwin"||port!==18788||!Number.isSafeInteger(uid))return {status:"unsupported"};
 if(hasSupervisor())return {status:"supervisor-present"};
 if(await isRuntimeHealthy())return {status:"runtime-healthy"};
 const listeners=readListenerPids(port);
 if(listeners.length!==1)return {status:listeners.length?"ambiguous-listener":"no-listener"};
 const listener=readPid(listeners[0]);
 const parent=listener?readPid(listener.ppid):null;
 const reason=qualifyOrphanDevRuntime({listener,parent,runtimeRoot,currentUid:uid});
 if(reason!=="VERIFIED_STALE_DEV_RUNTIME")return {status:"refused",reason};
 // Close the PID reuse / reparenting race: both records must be identical
 // on a second observation and there must still be exactly one listener.
 if(hasSupervisor()||await isRuntimeHealthy())return {status:"recovered-before-signal"};
 const again=readListenerPids(port);
 const currentChild=readPid(listener.pid),currentParent=readPid(parent.pid);
 if(again.length!==1||again[0]!==listener.pid||
   JSON.stringify(currentChild)!==JSON.stringify(listener)||
   JSON.stringify(currentParent)!==JSON.stringify(parent))return {status:"evidence-changed"};
 // SIGTERM only. No SIGKILL, no process-group kill, no production PID.
 // The next watchdog pass re-probes the port before any additional action.
 try{
  signal(listener.pid,"SIGTERM");
  signal(parent.pid,"SIGTERM");
 }catch(error){
  return {status:"signal-error",reason:String(error?.code||"unknown")};
 }
 return {status:"signalled",listenerPid:listener.pid,parentPid:parent.pid};
}
