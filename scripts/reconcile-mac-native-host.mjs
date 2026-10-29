#!/usr/bin/env node
// Operator-side release reconciliation; no Chrome restart, profile writes or broker secret reads.
// "check" is safe and read-only. "apply" rebinds only a verified immutable release.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {randomUUID} from "node:crypto";
import {inspectNativeHostParity} from "./lib/native-host-parity.mjs";

const arg=name=>{const pos=process.argv.indexOf(name);return pos<0?null:process.argv[pos+1];};
const mode=arg("--mode")??"check";
if(!["check","apply","rollback"].includes(mode)||process.platform!=="darwin")
 throw Error("MAC_NATIVE_HOST_MODE_OR_PLATFORM_INVALID");
const active=fs.realpathSync(arg("--active-root")??".");
const expectedSha=arg("--expected-sha");
if(!/^[a-f0-9]{40}$/.test(expectedSha??""))throw Error("MAC_NATIVE_HOST_COMMIT_REQUIRED");
const parent=path.join(os.homedir(),"Documents/Me/Project/cursor/_releases")+path.sep;
if(!active.startsWith(parent)||!path.basename(active).startsWith("owl-desktop-"))
 throw Error("MAC_NATIVE_HOST_RELEASE_ROOT_INVALID");
const head=execFileSync("git",["-C",active,"rev-parse","HEAD"],{encoding:"utf8",timeout:6000}).trim();
if(head!==expectedSha)throw Error("MAC_NATIVE_HOST_RELEASE_SHA_MISMATCH");
const dirty=execFileSync("git",["-C",active,"status","--porcelain","--untracked-files=normal"],{encoding:"utf8",timeout:6000}).trim();
if(dirty)throw Error("MAC_NATIVE_HOST_RELEASE_DIRTY");
const data=path.join(os.homedir(),"Library/Application Support/OWL LAB/desktop/native-chrome");
const manifestPath=path.join(os.homedir(),"Library/Application Support/Google/Chrome/NativeMessagingHosts/ai.owl.lab.agent.json");
const wrapper=path.join(data,"owl-native-message-host.sh");
const broker=path.join(data,"broker.json");
const receipt=path.join(data,"native-host-last-switch.json");
if(![manifestPath,wrapper,broker].every(p=>fs.existsSync(p)))throw Error("MAC_NATIVE_HOST_NOT_CONFIGURED");
const manifest=JSON.parse(fs.readFileSync(manifestPath,"utf8"));
if(manifest.name!=="ai.owl.lab.agent"||manifest.path!==wrapper||
 !Array.isArray(manifest.allowed_origins)||manifest.allowed_origins.length!==1)throw Error("MAC_NATIVE_HOST_MANIFEST_UNTRUSTED");
const origin=manifest.allowed_origins[0];
const id=origin.match(/^chrome-extension:\/\/([a-p]{32})\/$/)?.[1];
if(!id)throw Error("MAC_NATIVE_HOST_ORIGIN_UNTRUSTED");
const old=fs.readFileSync(wrapper,"utf8");
const originalScript=old.match(/'([^'\n]+[\\/]connection-host[\\/]native-messaging-host\.mjs)'/)?.[1]??null;
const script=path.join(active,"connection-host/native-messaging-host.mjs");
const result=inspectNativeHostParity({expectedRoot:active,sourceRoot:originalScript,
 extensionRoot:active+"/chrome-agent-native",registeredOrigin:origin,allowedOrigins:manifest.allowed_origins});
if(mode==="check"){
 console.log(JSON.stringify({mode,sourceMatches:result.sourceMatches,
  bindingPointsToActiveRelease:result.bindingPointsToActiveRelease,
  requiresRebind:!result.bindingPointsToActiveRelease,codeVersion:expectedSha,
  notes:"Read-only; Chrome's current native process remains unchanged."},null,2));
 process.exit(0);
}
function atomicReplace(target,text){
 const tmp=target+"."+randomUUID()+".tmp";
 try{fs.writeFileSync(tmp,text,{mode:0o700,flag:"wx"});fs.chmodSync(tmp,0o700);fs.renameSync(tmp,target);}
 finally{try{fs.unlinkSync(tmp);}catch{}}
}
if(mode==="rollback"){
 const meta=JSON.parse(fs.readFileSync(receipt,"utf8"));
 if(meta.targetSha!==expectedSha)throw Error("MAC_NATIVE_ROLLBACK_SHA_MISMATCH");
 if(!fs.existsSync(meta.savedWrapper))throw Error("MAC_NATIVE_ROLLBACK_BACKUP_MISSING");
 if(!fs.readFileSync(wrapper,"utf8").includes(script))throw Error("MAC_NATIVE_ROLLBACK_BINDING_CHANGED");
 atomicReplace(wrapper,fs.readFileSync(meta.savedWrapper,"utf8"));
 console.log(JSON.stringify({mode,restored:true,requiresChromeExtensionReload:true}));
 process.exit(0);
}
if(originalScript===script){console.log(JSON.stringify({mode,alreadyCurrent:true}));process.exit(0);}
if(!fs.existsSync(script))throw Error("MAC_NATIVE_HOST_RELEASE_SCRIPT_MISSING");
const node=arg("--node")??process.execPath;
if(!fs.existsSync(node)||[wrapper,script,node,broker].some(p=>p.includes("'")||p.includes("\n")))throw Error("MAC_NATIVE_HOST_PATH_INVALID");
const saved=path.join(data,"native-host-before-"+Date.now()+".sh");
fs.copyFileSync(wrapper,saved);
fs.chmodSync(saved,0o600);
const next="#!/bin/sh\nexec '"+node+"' '"+script+"' --config '"+broker+"' --extension-id '"+id+"' \"$@\"\n";
try{
 atomicReplace(wrapper,next);
 const confirmed=fs.readFileSync(wrapper,"utf8");
 if(confirmed!==next)throw Error("MAC_NATIVE_HOST_REBIND_VERIFY_FAILED");
 const tmp=receipt+"."+randomUUID()+".tmp";
 fs.writeFileSync(tmp,JSON.stringify({targetSha:expectedSha,savedWrapper:saved,at:new Date().toISOString()})+"\n",{mode:0o600,flag:"wx"});
 fs.renameSync(tmp,receipt);
}catch(e){atomicReplace(wrapper,old);throw e;}
console.log(JSON.stringify({mode,rebound:true,sourceCommit:expectedSha,rollbackSaved:true,requiresChromeExtensionReload:true}));
