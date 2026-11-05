// Keep launch-at-login selection consistent with the *verified* release.
// Updating the on-disk plist does not start/stop an already running LaunchAgent.
import fs from "node:fs";
import path from "node:path";
import {randomUUID} from "node:crypto";

const releaseId=/^fan\.fde\.owl\.dev-release\.[a-f0-9]{8}\.(?:current|fallback)$/;
function updatedRunAtLoad(xml,label,enabled){
 if(!xml.includes("<string>"+label+"</string>"))throw Error("MAC_RELEASE_PLIST_IDENTITY_MISMATCH");
 const pattern=/(<key>RunAtLoad<\/key>\s*)<(true|false)\s*\/>/g;
 const matches=[...xml.matchAll(pattern)];
 if(matches.length!==1)throw Error("MAC_RELEASE_RUN_AT_LOAD_AMBIGUOUS");
 return xml.replace(pattern,(_,prefix)=>prefix+"<"+(enabled?"true":"false")+"/>");
}
function atomicWrite(file,bytes){
 const temp=file+"."+randomUUID()+".owl-tmp";
 try{
  fs.writeFileSync(temp,bytes,{flag:"wx",mode:0o600});
  fs.chmodSync(temp,fs.statSync(file).mode&0o777);
  fs.renameSync(temp,file);
 }finally{try{fs.unlinkSync(temp)}catch{}}
}
export function selectMacReleaseOnNextLogin({agents,currentLabel,fallbackLabel,selected}){
 if(selected!=="current"&&selected!=="fallback")throw Error("INVALID_STARTUP_SELECTION");
 if(!releaseId.test(currentLabel)||!releaseId.test(fallbackLabel)||
   !currentLabel.endsWith(".current")||!fallbackLabel.endsWith(".fallback")||
   currentLabel.split(".").at(-2)!==fallbackLabel.split(".").at(-2))
   throw Error("MAC_RELEASE_STARTUP_LABEL_MISMATCH");
 const pairs=[
  {file:path.join(agents,currentLabel+".plist"),label:currentLabel,enable:selected==="current"},
  {file:path.join(agents,fallbackLabel+".plist"),label:fallbackLabel,enable:selected==="fallback"}
 ];
 // Validate both before changing either. No secret/environment expansion.
 const plan=pairs.map(p=>{
  const original=fs.readFileSync(p.file,"utf8");
  return {...p,original,next:updatedRunAtLoad(original,p.label,p.enable)};
 });
 const changed=[];
 try{
  for(const p of plan){
   if(p.original===p.next)continue;
   atomicWrite(p.file,p.next);
   changed.push(p);
  }
 }catch(error){
  for(const p of changed.reverse())try{atomicWrite(p.file,p.original)}catch{}
  throw error;
 }
 return {selected,changed:changed.map(x=>x.label)};
}
