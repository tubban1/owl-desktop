import {spawnSync} from "node:child_process";
import {existsSync,readFileSync,lstatSync} from "node:fs";
import path from "node:path";

export const OWL_DESKTOP_REPOSITORY="https://github.com/tubban1/owl-desktop.git";
function git(args,{cwd,timeout=6500}={}){
 const r=spawnSync("git",args,{cwd,timeout,encoding:"utf8",windowsHide:true,maxBuffer:64*1024,
  env:{...process.env,GIT_TERMINAL_PROMPT:"0"}});
 return {ok:r.status===0,stdout:r.status===0?r.stdout.trim():"",error:r.error?.code??(r.status===0?null:"GIT_UNAVAILABLE")};
}
export function versionSnapshot(root,{queryRemote=false,remote=OWL_DESKTOP_REPOSITORY}={}){
 const local=git(["-C",root,"rev-parse","--verify","HEAD"]);
 const head=local.ok&&/^[0-9a-f]{40}$/.test(local.stdout)?local.stdout:null;
 const dirty=head?git(["-C",root,"status","--porcelain","--untracked-files=normal"]):null;
 const result={repository:"tubban1/owl-desktop",platform:process.platform,architecture:process.arch,
   sourceCommit:head,sourceKind:head?"git-checkout":"packaged-or-unknown",
   sourceDirty:dirty?.ok?Boolean(dirty.stdout):null,buildVersion:null,
   remoteCommit:null,updateAvailable:null,remoteStatus:"not-checked"};
 try{result.buildVersion=JSON.parse(readFileSync(path.join(root,"package.json"),"utf8")).version??null;}catch{}
 if(queryRemote){
  const r=git(["ls-remote",remote,"refs/heads/main"],{timeout:8500});
  if(r.ok){
   const m=/^([0-9a-f]{40})\s+refs\/heads\/main$/.exec(r.stdout);
   if(m){result.remoteCommit=m[1];result.remoteStatus="verified";
    result.updateAvailable=head?head!==m[1]:null;}
   else result.remoteStatus="invalid-remote-response";
  }else result.remoteStatus="unavailable";
 }
 return result;
}
export function verifyStagedDirectory(dir,expectedSha){
 if(typeof expectedSha!=="string"||!/^[0-9a-f]{40}$/.test(expectedSha))return false;
 if(!existsSync(dir))return false;
 try{const s=lstatSync(dir);if(!s.isDirectory()||s.isSymbolicLink())return false;}catch{return false;}
 const snapshot=versionSnapshot(dir);
 return snapshot.sourceCommit===expectedSha&&snapshot.sourceDirty===false;
}
export function safeCommand(binary,args,{cwd,timeout=600000}={}){
 const r=spawnSync(binary,args,{cwd,timeout,encoding:"utf8",windowsHide:true,
  maxBuffer:2*1024*1024,env:{...process.env,GIT_TERMINAL_PROMPT:"0",CI:"1"}});
 if(r.status!==0){const e=new Error("SYNC_STEP_FAILED: "+binary+" "+args.slice(0,2).join(" ")+": "+(r.error?.code||r.status));e.code="SYNC_STEP_FAILED";throw e;}
 return r.stdout.trim();
}

/** Resolve npm from the same Node installation, not a login-shell PATH. */
export function resolveBundledNpm(nodeBinary=process.execPath){
 const base=path.dirname(nodeBinary);
 const candidates=[
  path.resolve(base,"..","lib","node_modules","npm","bin","npm-cli.js"),
  path.join(base,"node_modules","npm","bin","npm-cli.js"),
 ];
 return candidates.find(existsSync)??null;
}
