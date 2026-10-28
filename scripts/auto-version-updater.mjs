#!/usr/bin/env node
// Independent, fail-closed and staggered dual-device DEV release updater.
// Does not touch dirty user checkouts or share secrets. Runs outside OWL.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {randomUUID} from "node:crypto";
import {fileURLToPath} from "node:url";
import {githubMainCi} from "./lib/ota-ci.mjs";
import {verifyStagedDirectory,resolveBundledNpm} from "./lib/version-sync.mjs";
import {readVerifiedStage} from "./lib/device-version-state.mjs";
import {otaRoot,platform,initIdentity,configure,heartbeat,acquire,release,peerState} from "./lib/ota-client.mjs";
import {isRetryablePeerFailure,shouldBackoffFailedRelease} from "./lib/ota-retry-policy.mjs";

const device=platform,peer=device==="mac"?"windows":"mac";
if(!device)throw Error("ROLL_UNSUPPORTED_OS");
const rollState=otaRoot;
const home=os.homedir(),stageRoot=path.dirname(rollState);
const agent=path.dirname(fileURLToPath(import.meta.url));
const mode=process.argv[2]??"status";
const SHA=/^[0-9a-f]{40}$/;
const delay=ms=>new Promise(ok=>setTimeout(ok,ms));
function run(bin,args,{cwd,timeout=20000,allowError=false}={}){
 const r=spawnSync(bin,args,{cwd,timeout,encoding:"utf8",maxBuffer:1024*1024,
  env:{...process.env,PATH:path.dirname(process.execPath)+path.delimiter+(process.env.PATH??"")}});
 if((r.error||r.status!==0)&&!allowError)
  throw Error("ROLL_COMMAND_FAILED:"+path.basename(bin)+":"+String(r.error?.code??r.status)+":"+(r.stderr??"").slice(-150));
 return r.stdout.trim();
}
function git(root,...args){return run("git",["-C",root,...args]);}
function boundary(){return device==="mac"?path.join(home,"Documents","Me","Project","cursor")+path.sep:
 path.join(home,"mcp-workspace")+path.sep}
function dirFor(sha){if(!SHA.test(sha))throw Error("ROLL_BAD_SHA");
 return device==="mac"?path.join(home,"Documents","Me","Project","cursor","_releases","owl-desktop-"+sha.slice(0,7)):
 path.join(home,"mcp-workspace","owl-desktop-release-"+sha.slice(0,7))}
function cleanRoot(root,sha,{built=false}={}){
 if(!root||!SHA.test(sha)||!fs.existsSync(root))return false;
 const real=fs.realpathSync(root);
 if(!real.startsWith(boundary())||git(real,"rev-parse","HEAD")!==sha||git(real,"status","--porcelain","--untracked-files=normal"))return false;
 if(built){
  const electron=device==="mac"?"node_modules/electron/dist/Electron.app/Contents/MacOS/Electron":"node_modules/electron/dist/electron.exe";
  if(!fs.existsSync(path.join(root,electron))||!fs.existsSync(path.join(root,"dist","index.html")))return false;
 }
 return true;
}
function actualRoot(){
 if(device==="mac"){
  // Authoritative supervisor owner receipt wins over unrelated development checkouts.
  // Verify PID birth identity and exact script before trusting the receipt.
  try{
   const o=JSON.parse(fs.readFileSync(path.join(home,".owl-lab","dev-full-owner.json"),"utf8"));
   if(Number.isSafeInteger(o.pid)&&typeof o.desktopRoot==="string"&&o.desktopRoot.startsWith(boundary())&&typeof o.birth==="string"){
    const birth=run("/bin/ps",["-p",String(o.pid),"-o","lstart="],{allowError:true}).trim();
    const command=run("/bin/ps",["-p",String(o.pid),"-o","command="],{allowError:true}).trim();
    if(birth===o.birth&&command.endsWith(path.join(o.desktopRoot,"scripts","dev-full.mjs")))
     return o.desktopRoot;
   }
  }catch{}
  const matches=[];
  for(const line of run("/bin/ps",["-axo","pid=,command="]).split("\n")){
   const m=line.trim().match(/^(\d+)\s+(\S+)\s+(\S+)$/);
   if(m&&path.basename(m[2])==="node"&&m[3].endsWith("/scripts/dev-full.mjs")){
    const root=path.dirname(path.dirname(m[3]));
    if(root.startsWith(boundary()))matches.push(root);
   }
  }
  if(matches.length===1)return matches[0];
  try{const owner=JSON.parse(fs.readFileSync(path.join(home,'.owl-lab','dev-full-owner.json'),'utf8'));
   return matches.includes(owner.desktopRoot)?owner.desktopRoot:null;
  }catch{return null}
 }
 const script="$list=@(Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\" | Where-Object {$_.CommandLine -notmatch '--type='} | Select-Object -ExpandProperty ExecutablePath);$list|ConvertTo-Json -Compress";
 let paths;try{paths=JSON.parse(run("powershell.exe",["-NoProfile","-NonInteractive","-Command",script]));}catch{return null}
 const list=Array.isArray(paths)?paths:[paths];
 const suffix="\\node_modules\\electron\\dist\\electron.exe";
 const roots=list.filter(p=>typeof p==="string"&&p.toLowerCase().endsWith(suffix))
  .map(p=>p.slice(0,-suffix.length)).filter(p=>p.startsWith(boundary()));
 return roots.length===1?roots[0]:null;
}
async function http(url){
 try{const res=await fetch(url,{signal:AbortSignal.timeout(3000)});
  return res.ok?await res.json():null;}catch{return null}
}
async function tunnelReady(root){
 if(device==="windows"){
  const h=await http("http://127.0.0.1:18081/health?details=true");
  return h?.ready===true&&h?.live===true;
 }
 const lines=run("/usr/bin/pgrep",["-fl","tunnel-client-runtime"],{allowError:true}).split("\n");
 for(const line of lines){
  if(!line.includes(path.join(root,"vendor","owl-tunnel")))continue;
  const m=line.match(/--health\.url-file\s+(\S+)/);if(!m)continue;
  try{
   const url=fs.readFileSync(m[1],"utf8").trim();if(!url.startsWith("http://127.0.0.1:"))continue;
   const data=await http(url.replace(/\/$/,"")+"/health?details=true");
   if(data?.ready===true&&data?.live===true)return true;
  }catch{}
 }
 return false;
}
async function liveStatus(){
 const root=actualRoot();if(!root)return {healthy:false,root:null,sha:null};
 const sha=git(root,"rev-parse","HEAD");
 const m=await http("http://127.0.0.1:8790/health");
 const rt=await http("http://127.0.0.1:"+(device==="mac"?18788:8788)+"/health");
 const checked=cleanRoot(root,sha,{built:true});
 const tunnel=await tunnelReady(root);
 return {root,sha,healthy:checked&&m?.service==="owl-mcp"&&m?.ok===true&&rt?.service==="owl-runtime"&&rt?.ok===true&&tunnel};
}
async function publish(local,updating=false){
 if(!local.sha)return {status:"blocked",reason:"no-live-sha"};
 return heartbeat(local.sha,local.healthy,updating);
}
async function remoteHealth(){
 try{
  const peer=await peerState();
  if(peer?.healthy!==true||peer.updating===true||!peer.at||Date.now()-peer.at>90000)
   return {ok:false,reason:"peer-not-recent-healthy"};
  return {ok:true,sha:peer.sha,at:peer.at};
 }catch(e){return {ok:false,reason:String(e.message??e)}}
}
async function waitForHealthyPeer(timeoutMs=90000){
 const deadline=Date.now()+timeoutMs;
 let result=await remoteHealth();
 while(!result.ok&&Date.now()<deadline){
  await delay(Math.min(10000,Math.max(1,deadline-Date.now())));
  result=await remoteHealth();
 }
 return result;
}
// Remote lease + fresh peer proof serialize updates any time both devices are online.
// Do not require powered-on computers during a fixed overnight maintenance window.
function inWindow(){return true;}
function npmCommand(args,cwd,timeout=180000){
 const cli=resolveBundledNpm();if(!cli)throw Error("ROLL_NPM_UNAVAILABLE");
 return run(process.execPath,[cli,...args],{cwd,timeout});
}
function candidate(sha){
 const dest=dirFor(sha);if(cleanRoot(dest,sha,{built:true}))return dest;
 if(fs.existsSync(dest)){
  if(!cleanRoot(dest,sha))throw Error("ROLL_EXISTING_CANDIDATE_DIRTY_OR_WRONG_REVISION");
 }else{
  const stage=path.join(stageRoot,sha);
  if(!verifyStagedDirectory(stage,sha))throw Error("ROLL_IMMUTABLE_STAGE_INVALID");
  fs.mkdirSync(path.dirname(dest),{recursive:true});
  run("git",["clone","--no-hardlinks",stage,dest],{timeout:130000});
  run("git",["-C",dest,"checkout","--detach",sha]);
 }
 npmCommand(["ci","--include=optional"],dest,450000);
 if(device==="mac"&&process.arch==="arm64"&&!fs.existsSync(path.join(dest,"node_modules","@rollup","rollup-darwin-arm64"))){
  const version=JSON.parse(fs.readFileSync(path.join(dest,"node_modules","rollup","package.json"))).version;
  npmCommand(["install","--no-save","--package-lock=false","@rollup/rollup-darwin-arm64@"+version],dest,180000);
 }
 npmCommand(["run","build"],dest,240000);
 run(process.execPath,["node_modules/vitest/vitest.mjs","run","tests/version-sync.test.mjs",
  "tests/device-version-state.test.mjs","tests/mcp-tool-surface.test.mjs","tests/activation-gate.test.mjs",
  "--maxWorkers=1","--testTimeout=30000"],{cwd:dest,timeout:180000});
 if(!cleanRoot(dest,sha,{built:true}))throw Error("ROLL_PLATFORM_RELEASE_NOT_VERIFIED");
 return dest;
}
function applyMac(oldRoot,newRoot,oldSha,newSha){
 const script=path.join(agent,"mac-safe-cutover.mjs");if(!fs.existsSync(script))throw Error("ROLL_MAC_GUARD_NOT_INSTALLED");
 const name="fan.fde.owl.rollout."+newSha.slice(0,12);
 const file=path.join(home,"Library","LaunchAgents",name+".plist");
 if(fs.existsSync(file))throw Error("ROLL_APPLY_JOB_ALREADY_EXISTS");
 const esc=s=>s.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll('"',"&quot;");
 const args=[process.execPath,script,"apply",oldRoot,newRoot,oldSha,newSha];
 const plist='<?xml version="1.0" encoding="UTF-8"?>\n'+
  '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'+
  '<plist version="1.0"><dict><key>Label</key><string>'+name+'</string><key>ProgramArguments</key><array>'+
  args.map(x=>'<string>'+esc(x)+'</string>').join("")+'</array><key>RunAtLoad</key><false/><key>KeepAlive</key><false/></dict></plist>';
 fs.writeFileSync(file,plist,{flag:"wx",mode:0o600});
 const domain="gui/"+process.getuid();
 run("/bin/launchctl",["bootstrap",domain,file]);
 run("/bin/launchctl",["kickstart",domain+"/"+name]);
}
function applyWindows(oldRoot,newRoot,oldSha,newSha){
 const script=path.join(agent,"windows","verified-dev-cutover.ps1");
 if(!fs.existsSync(script))throw Error("ROLL_WIN_GUARD_NOT_INSTALLED");
 const name="OWL-LAB-Rollout-"+newSha.slice(0,12);
 const q=s=>"'"+s.replaceAll("'","''")+"'";
 const line=`-NoProfile -ExecutionPolicy Bypass -File "${script}" -Mode Cutover -OldRoot "${oldRoot}" -NewRoot "${newRoot}" -ExpectedOldSha ${oldSha} -ExpectedNewSha ${newSha}`;
 const ps='$ErrorActionPreference="Stop";$n='+q(name)+
  ';if(Get-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue){throw "TASK_EXISTS"};'+
  '$a=New-ScheduledTaskAction -Execute "powershell.exe" -Argument '+q(line)+
  ' -WorkingDirectory '+q(path.dirname(script))+';'+
  '$t=New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(9);'+
  '$p=New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited;'+
  '$s=New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::FromMinutes(7));'+
  'Register-ScheduledTask -TaskName $n -Action $a -Trigger $t -Principal $p -Settings $s|Out-Null;Start-ScheduledTask -TaskName $n;';
 run("powershell.exe",["-NoProfile","-NonInteractive","-EncodedCommand",
  Buffer.from(ps,"utf16le").toString("base64")],{timeout:25000});
}
async function waitForActivation(sha){
 const file=path.join(stageRoot,device==="mac"?"mac-cutover-transaction.json":"cutover-last.json");
 const deadline=Date.now()+270000;
 while(Date.now()<deadline){
  let r;try{r=JSON.parse(fs.readFileSync(file,"utf8"))}catch{}
  if(r&&(r.newSha===sha||r.toSha===sha)){
   if(["rolled-back","rolled-back-or-blocked","rollback-failed"].includes(r.phase))
    throw Error("ROLL_CUTOVER_ROLLED_BACK:"+String(r.reason??"unknown"));
   if(r.phase==="activated"){const l=await liveStatus();if(l.healthy&&l.sha===sha)return l;}
  }
  await delay(1200);
 }
 throw Error("ROLL_CUTOVER_TIMEOUT");
}
function lock(){
 fs.mkdirSync(rollState,{recursive:true,mode:0o700});
 const f=path.join(rollState,"rollout.lock");
 const fd=fs.openSync(f,"wx",0o600);fs.writeSync(fd,JSON.stringify({pid:process.pid,at:Date.now()}));
 return ()=>{fs.closeSync(fd);try{fs.unlinkSync(f)}catch{}};
}
function store(result){
 const dest=path.join(rollState,"last-attempt.json"),tmp=dest+"."+randomUUID()+".tmp";
 try{fs.writeFileSync(tmp,JSON.stringify({...result,at:Date.now()})+"\n",{flag:"wx",mode:0o600});fs.renameSync(tmp,dest)}
 finally{try{fs.unlinkSync(tmp)}catch{}}
}
function githubMainSha(){
 const raw=run("git",["ls-remote","https://github.com/tubban1/owl-desktop.git","refs/heads/main"],{timeout:12000});
 const [commit,ref]=raw.split(String.fromCharCode(9));
 if(!SHA.test(commit)||ref!=="refs/heads/main")throw Error("ROLL_MAIN_SHA_NOT_VERIFIED");
 return commit;
}
async function prepare(){
 const stage=readVerifiedStage(stageRoot);
 if(!stage.gatesPassed||!stage.commit)return {status:"blocked",reason:"stage-unverified"};
 if(stage.commit!==githubMainSha())return {status:"blocked",reason:"stage-not-latest-main"};
 const ci=await githubMainCi(stage.commit);
 if(ci.status!=="success")return {status:"blocked",reason:"main-push-ci",ci:ci.status};
 const dest=candidate(stage.commit);
 return {status:"ready",sha:stage.commit,root:dest,ciRunId:ci.runId};
}
async function tick(){
 const live=await liveStatus();await publish(live,fs.existsSync(path.join(rollState,"rollout.lock")));
 if(!live.healthy)return {status:"blocked",reason:"local-unhealthy"};
 if(!inWindow())return {status:"blocked",reason:"utc-window",live:live.sha};
 const staged=readVerifiedStage(stageRoot);
 if(!staged.gatesPassed||!staged.commit)return {status:"blocked",reason:"stage-unverified"};
 if(live.sha===staged.commit)return {status:"current",sha:live.sha};
 if(staged.commit!==githubMainSha())return {status:"blocked",reason:"stage-not-latest-main"};
 let last;try{last=JSON.parse(fs.readFileSync(path.join(rollState,"last-attempt.json")))}catch{}
 if(shouldBackoffFailedRelease(last,staged.commit))
  return {status:"blocked",reason:"failure-backoff"};
 const ci=await githubMainCi(staged.commit);
 if(ci.status!=="success")return {status:"blocked",reason:"main-push-ci",ci:ci.status};
 const p=await waitForHealthyPeer(90000);if(!p.ok)return {status:"blocked",reason:"peer",detail:p.reason};
 const unlock=lock();
 let lease=null;
 try{
  const dest=candidate(staged.commit);
  const before=await liveStatus();
  if(staged.commit!==githubMainSha())throw Error("ROLL_MAIN_MOVED_AFTER_BUILD");
  if(!before.healthy||before.sha!==live.sha)throw Error("ROLL_LOCAL_CHANGED_AFTER_BUILD");
  if(!(await waitForHealthyPeer(90000)).ok)throw Error("ROLL_PEER_NOT_READY_AFTER_BUILD");
  await publish(before);
  const locked=await acquire(staged.commit);lease=locked.token;
  await publish(before,true);
  await delay(18000);
  if(!(await waitForHealthyPeer(30000)).ok)throw Error("ROLL_PEER_CHANGED_AFTER_INTENT");
  if(device==="mac")applyMac(before.root,dest,before.sha,staged.commit);
  else applyWindows(before.root,dest,before.sha,staged.commit);
  const after=await waitForActivation(staged.commit);
  store({status:"activated",from:before.sha,target:after.sha,ciRunId:ci.runId});
  await release(lease);lease=null;
  await publish(after);
  return {status:"activated",sha:after.sha};
 }catch(e){
  const reason=String(e.message??e);
  if(isRetryablePeerFailure(reason)){
   store({status:"deferred",target:staged.commit,reason});
   await publish(await liveStatus());
   return {status:"deferred",reason};
  }
  store({status:"failed",target:staged.commit,error:reason});
  await publish(await liveStatus());
  throw e;
 }finally{if(lease){try{await release(lease)}catch{}}unlock();}
}
if(mode==="init"){const identity=initIdentity();console.log(JSON.stringify(identity));}
else if(mode==="configure"){console.log(JSON.stringify(configure(process.argv[3])));}
else if(mode==="heartbeat"){
 const l=await liveStatus();await publish(l,fs.existsSync(path.join(rollState,"rollout.lock")));console.log(JSON.stringify({device,sha:l.sha,healthy:l.healthy}));
}else if(mode==="status"){
 console.log(JSON.stringify({device,live:await liveStatus(),peer:await remoteHealth(),
  stage:readVerifiedStage(stageRoot),onlineActivationWithCloudLease:true,requiresMainPushCi:true}));
}else if(mode==="prepare"){console.log(JSON.stringify(await prepare()));}
else if(mode==="tick"){console.log(JSON.stringify(await tick()));}
else throw Error("Usage: auto-version-updater.mjs init|configure URL|heartbeat|status|prepare|tick");