#!/usr/bin/env node
// OWL macOS dev release cutover. Always runs as an independent launchd job.
// Never edits checked-out user code. A separate watchdog restores the prior
// healthy supervisor if this controller crashes after it stops the live MCP.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import http from "node:http";
import {spawnSync} from "node:child_process";
import {randomUUID} from "node:crypto";
import {retireSupersededMacCurrentJobs} from "./lib/mac-release-startup.mjs";
import {macDesktopMainPresent,postActivationRecoveryAction} from "./lib/mac-postactivation-health.mjs";

const [mode,oldRoot,newRoot,oldSha,newSha]=process.argv.slice(2);
const sha=/^[a-f0-9]{40}$/;
const user=os.homedir();
const sourceBoundary=path.join(user,"Documents","Me","Project","cursor")+path.sep;
const state=path.join(user,".owl-lab","version-sync","desktop");
const label="fan.fde.owl.dev-release."+newSha.slice(0,8);
const ids={old:label+".fallback",next:label+".current",watch:label+".watchdog"};
const agents=path.join(user,"Library","LaunchAgents");
const txFile=path.join(state,"mac-cutover-transaction.json");
const nodeBin=process.execPath;
const runtimeRoot=path.join(user,"Documents","Me","Project","cursor","owl-runtime");
function run(bin,args,{cwd,timeout=9000,allowError=false}={}){
 const r=spawnSync(bin,args,{cwd,timeout,encoding:"utf8",maxBuffer:128*1024,env:process.env});
 if(r.status!==0&&!allowError)throw Error("MAC_RELEASE_COMMAND_FAILED:"+path.basename(bin)+":"+String(r.error?.code??r.status));
 return r;
}
function verifyDir(dir,shaExpected){
 if(!sha.test(String(shaExpected)))throw Error("INVALID_COMMIT");
 const canonical=fs.realpathSync(dir);
 if(!canonical.startsWith(sourceBoundary))throw Error("RELEASE_ROOT_OUTSIDE_AUTHORIZED_PROJECT");
 const found=run("/usr/bin/git",["-C",canonical,"rev-parse","HEAD"]).stdout.trim();
 if(found!==shaExpected)throw Error("RELEASE_SHA_MISMATCH");
 const dirty=run("/usr/bin/git",["-C",canonical,"status","--porcelain","--untracked-files=normal"]).stdout.trim();
 if(dirty)throw Error("RELEASE_CHECKOUT_DIRTY");
 if(!fs.existsSync(path.join(canonical,"node_modules","electron","dist","Electron.app","Contents","MacOS","Electron")))throw Error("ELECTRON_NOT_INSTALLED");
 if(!fs.existsSync(path.join(canonical,"scripts","dev-full.mjs")))throw Error("SUPERVISOR_NOT_INSTALLED");
 return canonical;
}
function loadOwner(){
 try{return JSON.parse(fs.readFileSync(path.join(user,".owl-lab","dev-full-owner.json"),"utf8"));}catch{return null;}
}
function ownerMatches(dir){
 const record=loadOwner();
 if(!record||record.desktopRoot!==dir||!Number.isSafeInteger(record.pid))return false;
 const got=run("/bin/ps",["-p",String(record.pid),"-o","lstart="],{allowError:true});
 const cmd=run("/bin/ps",["-p",String(record.pid),"-o","command="],{allowError:true});
 return got.status===0&&got.stdout.trim()===record.birth&&cmd.status===0&&cmd.stdout.includes(path.join(dir,"scripts","dev-full.mjs"));
}
function portUp(port){
 return new Promise(resolve=>{
  const s=net.connect({host:"127.0.0.1",port});
  let done=false;
  const finish=v=>{if(done)return;done=true;s.destroy();resolve(v)};
  s.once("connect",()=>finish(true));s.once("error",()=>finish(false));s.setTimeout(750,()=>finish(false));
 });
}
async function health(port){
 try{
  const res=await fetch("http://127.0.0.1:"+port+"/health",{signal:AbortSignal.timeout(3500)});
  if(!res.ok)return false;
  const data=await res.json();
  return data.ok===true;
 }catch{return false}
}
async function tunnelReady(root){
 const proc=run("/usr/bin/pgrep",["-fl","tunnel-client-runtime"],{allowError:true});
 if(proc.status!==0)return false;
 const prefix=path.join(root,"vendor","owl-tunnel");
 for(const line of proc.stdout.split("\n")){
  if(!line.includes(prefix)||!line.includes("tunnel-client-runtime run"))continue;
  const match=line.match(/--health\.url-file\s+(\S+)/);
  if(!match)continue;
  try{
   const url=fs.readFileSync(match[1],"utf8").trim();
   if(!url.startsWith("http://127.0.0.1:"))continue;
   const res=await fetch(url.replace(/\/$/,"")+"/health?details=true",{signal:AbortSignal.timeout(2600)});
   const data=await res.json();
   if(res.ok&&data.ready===true&&data.live===true)return true;
  }catch{}
 }
 return false;
}

function exactSupervisor(dir){
 const expected=path.join(dir,"scripts","dev-full.mjs");
 const found=run("/bin/ps",["-axo","pid=,command="],{allowError:true});
 if(found.status!==0)return null;
 const matches=[];
 for(const line of found.stdout.split("\n")){
  const match=line.trim().match(/^(\d+)\s+(\S+)\s+(\S+)$/);
  if(match&&match[3]===expected&&path.basename(match[2])==="node")matches.push(Number(match[1]));
 }
 if(matches.length!==1)return null;
 const pid=matches[0];
 const birth=run("/bin/ps",["-p",String(pid),"-o","lstart="],{allowError:true});
 return birth.status===0&&birth.stdout.trim()?{pid,birth:birth.stdout.trim()}:null;
}
function expectedSupervisorRunning(dir){return Boolean(exactSupervisor(dir))}
function desktopMainRunning(dir){
 const ps=run("/bin/ps",["-axo","pid=,command="],{allowError:true});
 return ps.status===0&&macDesktopMainPresent(dir,ps.stdout);
}
async function healMissingOwner(dir){
 if(ownerMatches(dir))return true;
 const exact=exactSupervisor(dir);
 if(!exact||!(await health(8790))||!(await health(18788)))return false;
 const old=loadOwner();
 if(old?.pid&&old.pid!==exact.pid){
  const oldProc=run("/bin/ps",["-p",String(old.pid),"-o","lstart="],{allowError:true});
  if(oldProc.status===0&&oldProc.stdout.trim()===old.birth)return false;
 }
 const dest=path.join(user,".owl-lab","dev-full-owner.json");
 const candidate={version:1,desktopRoot:dir,pid:exact.pid,birth:exact.birth};
 const tmp=dest+"."+randomUUID()+".tmp";
 try{fs.writeFileSync(tmp,JSON.stringify(candidate)+"\n",{flag:"wx",mode:0o600});fs.renameSync(tmp,dest)}
 finally{try{fs.unlinkSync(tmp)}catch{}}
 return ownerMatches(dir);
}
async function healthy(dir){
 // An external cleanup process may remove the non-authoritative owner receipt.
 // A unique exact PID + birth + immutable root is independently verifiable.
 if(!ownerMatches(dir))await healMissingOwner(dir);
 return Boolean(exactSupervisor(dir))&&desktopMainRunning(dir)&&await health(8790)&&await health(18788)&&await tunnelReady(dir);
}
async function portsFree(){
 for(const port of [8790,8791,18788,5173])if(await portUp(port))return false;
 return true;
}
async function waitFor(test,timeoutMs){
 const deadline=Date.now()+timeoutMs;
 while(Date.now()<deadline){if(await test())return true;await new Promise(resolve=>setTimeout(resolve,1200))}
 return false;
}
function journal(data){
 fs.mkdirSync(state,{recursive:true,mode:0o700});
 const temp=txFile+"."+randomUUID()+".tmp";
 try{fs.writeFileSync(temp,JSON.stringify({...data,updatedAt:new Date().toISOString()})+"\n",{flag:"wx",mode:0o600});fs.renameSync(temp,txFile)}
 finally{try{fs.unlinkSync(temp)}catch{}}
}
function readTx(){try{return JSON.parse(fs.readFileSync(txFile,"utf8"))}catch{return null}}
function ctl(...args){return run("/bin/launchctl",args)}
const domain="gui/"+process.getuid();
function serviceTarget(id){return domain+"/"+id}
function existsJob(id){return run("/bin/launchctl",["print",serviceTarget(id)],{allowError:true}).status===0}
function loadJob(id){
 const filename=path.join(agents,id+".plist");
 if(!existsJob(id))ctl("bootstrap",domain,filename);
}
function kick(id){ctl("kickstart",serviceTarget(id))}
function drop(id){if(existsJob(id))ctl("bootout",serviceTarget(id))}
function xml(s){return s.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;")}
function plist(id,args,working,interval=0){
 const arr=args.map(a=>"<string>"+xml(a)+"</string>").join("");
 const env="<key>EnvironmentVariables</key><dict><key>OWL_RUNTIME_SOURCE_ROOT</key><string>"+xml(runtimeRoot)+"</string></dict>";
 return '<?xml version="1.0" encoding="UTF-8"?>\n'+
 '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'+
 '<plist version="1.0"><dict><key>Label</key><string>'+xml(id)+'</string>'+
 '<key>ProgramArguments</key><array>'+arr+'</array><key>WorkingDirectory</key><string>'+xml(working)+'</string>'+
 env+'<key>RunAtLoad</key><'+(id===ids.next?'true':'false')+'/><key>KeepAlive</key><false/>'+
 (interval?'<key>StartInterval</key><integer>'+interval+'</integer>':'')+
 '<key>StandardOutPath</key><string>'+xml(path.join(state,id+".out.log"))+'</string>'+
 '<key>StandardErrorPath</key><string>'+xml(path.join(state,id+".err.log"))+'</string></dict></plist>\n';
}
function writePlist(id,content){
 fs.mkdirSync(agents,{recursive:true});fs.mkdirSync(state,{recursive:true,mode:0o700});
 const dest=path.join(agents,id+".plist");
 if(fs.existsSync(dest))throw Error("LAUNCH_AGENT_LABEL_ALREADY_EXISTS:"+id);
 fs.writeFileSync(dest,content,{flag:"wx",mode:0o600});
}
function provision(){
 writePlist(ids.old,plist(ids.old,[nodeBin,path.join(oldRoot,"scripts","dev-full.mjs")],oldRoot));
 writePlist(ids.next,plist(ids.next,[nodeBin,path.join(newRoot,"scripts","dev-full.mjs")],newRoot));
 writePlist(ids.watch,plist(ids.watch,[nodeBin,process.argv[1],"watch",oldRoot,newRoot,oldSha,newSha],state,30));
 loadJob(ids.old);loadJob(ids.next);loadJob(ids.watch);
}
async function rollback(reason){
 try{drop(ids.next)}catch{}
 const free=await waitFor(portsFree,30000);
 let recovered=await healthy(oldRoot);
 if(free&&!recovered){
  try{loadJob(ids.old);kick(ids.old)}catch(e){reason+=":kickstart-failed"}
  recovered=await waitFor(()=>healthy(oldRoot),120000);
 }
 journal({phase:recovered?"rolled-back":"rollback-failed",oldRoot,newRoot,oldSha,newSha,reason,recovered});
 return recovered;
}
async function check(){
 verifyDir(oldRoot,oldSha);verifyDir(newRoot,newSha);
 return {oldRoot,newRoot,oldSha,newSha,oldRunning:await healthy(oldRoot),
  nextRunning:await healthy(newRoot),ports:[8790,8791,18788,5173],
  oldOwnerVerified:ownerMatches(oldRoot),watchdogAvailable:true,
  liveServiceChanged:false};
}
if(!["check","apply","watch"].includes(mode))throw Error("Usage: mac-cutover.mjs check|apply|watch OLD NEW SHA SHA");
verifyDir(oldRoot,oldSha);verifyDir(newRoot,newSha);
if(mode==="check"){
 const status=await check();console.log(JSON.stringify(status));process.exit(0);
}
if(mode==="watch"){
 const tx=readTx();
 if(tx?.phase==="started"&&tx.oldSha===oldSha&&tx.newSha===newSha&&
  Date.now()-Date.parse(tx.updatedAt)>210000){
   if(!(await healthy(newRoot))){await rollback("watchdog-activation-timeout")}
   else journal({...tx,phase:"activated",watchdogConfirmed:true});
 }
 if(tx?.phase==="activated"&&tx.oldSha===oldSha&&tx.newSha===newSha){
  const tracker=path.join(state,"mac-watchdog-failures.json");
  // A missing bookkeeping file alone must never roll back a healthy server.
  await healMissingOwner(newRoot);
  const localOK=Boolean(exactSupervisor(newRoot))&&desktopMainRunning(newRoot)&&await health(8790)&&await health(18788);
  if(localOK){
   try{fs.unlinkSync(tracker)}catch{}
  }else{
   let failed=null;try{failed=JSON.parse(fs.readFileSync(tracker,"utf8"))}catch{}
   if(!failed||failed.newSha!==newSha){
    fs.writeFileSync(tracker,JSON.stringify({newSha,firstSeenAt:new Date().toISOString()})+"\n",{mode:0o600});
   }else{
    const action=postActivationRecoveryAction({healthy:localOK,firstSeenAt:failed.firstSeenAt,supervisorPresent:expectedSupervisorRunning(newRoot)});
    if(action==="restart"){try{kick(ids.next)}catch{}}
    if(action==="rollback"){await rollback("watchdog-post-activation-local-health-failed")}
   }
  }
 }
 process.exit(0);
}
if(process.ppid!==1)throw Error("CUTOVER_MUST_RUN_UNDER_INDEPENDENT_LAUNCHD");
if(!await healthy(oldRoot)||await healthy(newRoot))throw Error("CUTOVER_PREFLIGHT_UNHEALTHY");
provision();
journal({phase:"started",oldRoot,newRoot,oldSha,newSha,startedAt:new Date().toISOString()});
try{
 const original=exactSupervisor(oldRoot);
 if(!original||!(await healthy(oldRoot)))throw Error("OLD_SUPERVISOR_IDENTITY_OR_HEALTH_CHANGED");
 process.kill(original.pid,"SIGTERM");
 if(!await waitFor(portsFree,45000))throw Error("OLD_OWNED_PORTS_DID_NOT_RELEASE");
 if(process.env.OWL_QA_FAIL_AFTER_STOP==="1")throw Error("INJECTED_QA_FAILURE_AFTER_STOP");
 kick(ids.next);
 if(!await waitFor(()=>healthy(newRoot),150000))throw Error("NEW_MCP_AND_RUNTIME_NOT_HEALTHY");
 journal({phase:"activated",oldRoot,newRoot,oldSha,newSha,activatedAt:new Date().toISOString()});
 try{
  const retired=retireSupersededMacCurrentJobs({agents,activeLabel:ids.next});
  console.log("MAC_SUPERSEDED_CURRENT_JOBS_RETIRED="+JSON.stringify(retired));
 }catch(error){
  // Login-time retirement is a safety cleanup, not a reason to roll back a healthy release.
  console.warn("MAC_SUPERSEDED_CURRENT_JOBS_RETIRE_PENDING="+String(error.message??error));
 }
 console.log("MAC_CUTOVER_HEALTH_VERIFIED");
}catch(e){
 const recovered=await rollback(String(e.message??e));
 console.error("MAC_CUTOVER_FAILED_RECOVERED="+recovered);
 process.exitCode=4;
}