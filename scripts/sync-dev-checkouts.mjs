#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {randomUUID} from "node:crypto";
import {fileURLToPath} from "node:url";
import {OWL_DESKTOP_REPOSITORY,versionSnapshot,verifyStagedDirectory,safeCommand,resolveBundledNpm} from "./lib/version-sync.mjs";

const stateRoot=path.join(os.homedir(),".owl-lab","version-sync","desktop");
let savedSource=null;
try{savedSource=JSON.parse(fs.readFileSync(path.join(stateRoot,"source.json"),"utf8")).source;}catch{}
const thisRoot=path.resolve(process.env.OWL_SYNC_SOURCE_ROOT||savedSource||path.resolve(path.dirname(fileURLToPath(import.meta.url)),".."));
const remote=OWL_DESKTOP_REPOSITORY;
const mode=process.argv[2]??"status";
const prefix="[owl-version-sync]";
function output(v){process.stdout.write(JSON.stringify(v,null,2)+"\n");}
function assertSafeRoot(){
 fs.mkdirSync(stateRoot,{recursive:true,mode:0o700});
 const s=fs.lstatSync(stateRoot);
 if(!s.isDirectory()||s.isSymbolicLink())throw Error("SYNC_ROOT_NOT_DIRECTORY");
}
function status(){
 const source=versionSnapshot(thisRoot,{queryRemote:true});
 const desiredFile=path.join(stateRoot,"last-staged.json");
 let last=null;try{last=JSON.parse(fs.readFileSync(desiredFile,"utf8"));}catch{}
 const staged=last?.commit&&/^[0-9a-f]{40}$/.test(last.commit)&&
  verifyStagedDirectory(path.join(stateRoot,last.commit),last.commit)?last.commit:null;
 output({...source,stagedCommit:staged,
  sameSourceAsRemote:source.remoteCommit?source.remoteCommit===source.sourceCommit:null,
  stagedUpToDate:source.remoteCommit?staged===source.remoteCommit:null,
  deploymentStatus:"running-process-not-restarted",
  note:"Staging is NOT activation. Never replace a live, dirty checkout or disconnect the sole MCP tunnel."});
 return {source,staged};
}
function atomicJson(file,value){
 const temp=file+"."+randomUUID()+".tmp";
 try{fs.writeFileSync(temp,JSON.stringify(value,null,2)+"\n",{flag:"wx",mode:0o600});
 fs.renameSync(temp,file);}finally{try{fs.unlinkSync(temp);}catch{}}
}
function stage(){
 assertSafeRoot();
 const lock=path.join(stateRoot,"stage.lock");
 let held=false,temporary=null;
 try{
  fs.mkdirSync(lock,{mode:0o700});held=true;
  const source=versionSnapshot(thisRoot,{queryRemote:true});
  const commit=source.remoteCommit;
  if(source.remoteStatus!=="verified"||!commit)throw Error("SYNC_REMOTE_UNAVAILABLE_KEEP_EXISTING");
  const target=path.join(stateRoot,commit);
  if(verifyStagedDirectory(target,commit)){
   atomicJson(path.join(stateRoot,"last-staged.json"),{commit,verifiedAt:new Date().toISOString(),reused:true});
   output({status:"already-tested",commit,stagingRoot:target,liveProcessChanged:false});return;
  }
  if(fs.existsSync(target))throw Error("SYNC_EXISTING_STAGE_TAMPERED_MANUAL_INSPECTION");
  temporary=path.join(stateRoot,"pending-"+randomUUID());
  // Authoritative repo only; no LAN-based trust or branch/worktree overwrite.
  safeCommand("git",["clone","--depth","1","--single-branch","--branch","main","--no-checkout",remote,temporary],{timeout:150000});
  const fetched=safeCommand("git",["-C",temporary,"rev-parse","refs/remotes/origin/main"]);
  if(fetched!==commit)throw Error("SYNC_REMOTE_MOVED_RETRY_SAFELY");
  safeCommand("git",["-C",temporary,"checkout","--detach",commit]);
  // Never execute this code as a live server until all gates pass.
  const npmCli=resolveBundledNpm();
  if(!npmCli)throw Error("SYNC_NPM_CLI_NOT_FOUND");
  safeCommand(process.execPath,[npmCli,"ci","--ignore-scripts"],{cwd:temporary,timeout:360000});
  safeCommand(process.execPath,[npmCli,"test"],{cwd:temporary,timeout:360000});
  safeCommand(process.execPath,[npmCli,"run","build"],{cwd:temporary,timeout:240000});
  if(!verifyStagedDirectory(temporary,commit))throw Error("SYNC_STAGE_MODIFIED_DURING_VERIFICATION");
  fs.renameSync(temporary,target);temporary=null;
  atomicJson(path.join(stateRoot,"last-staged.json"),{commit,verifiedAt:new Date().toISOString(),testsPassed:true});
  output({status:"verified-staged",commit,stagingRoot:target,liveProcessChanged:false,
   next:"Activate through the separately supervised owner/runtime handoff only after health gates."});
 }finally{
  if(temporary&&fs.existsSync(temporary))fs.rmSync(temporary,{recursive:true,force:true});
  if(held)fs.rmSync(lock,{recursive:true,force:true});
 }
}
if(mode==="status")status();
else if(mode==="stage")stage();
else if(mode==="watch"){
 const ms=Number(process.env.OWL_SYNC_POLL_MS||1800000);
 if(!Number.isSafeInteger(ms)||ms<300000)throw Error("SYNC_INTERVAL_TOO_SHORT");
 const poll=()=>{
  try{const {source,staged}=status();
   if(source.remoteStatus==="verified"&&source.remoteCommit!==staged)stage();
  }catch(e){console.error(prefix,e.code??e.message);}
 };
 poll();setInterval(poll,ms);
}else{console.error("Usage: node scripts/sync-dev-checkouts.mjs status|stage|watch");process.exitCode=2;}
