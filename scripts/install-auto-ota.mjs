#!/usr/bin/env node
// Installs the independent OTA runner without restarting running OWL services.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {otaRoot} from "./lib/ota-client.mjs";
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const stable=path.join(os.homedir(),".owl-lab","version-sync","desktop","agent","scripts");
const task=path.join(stable,"auto-version-updater.mjs");
if(!fs.existsSync(path.join(otaRoot,"device-private.pem"))||
   !fs.existsSync(path.join(otaRoot,"coordinator.json")))
 throw Error("OTA_NOT_CONFIGURED_FAIL_CLOSED");
const copies=[
 ["scripts/auto-version-updater.mjs","auto-version-updater.mjs"],
 ["scripts/lib/ota-client.mjs","lib/ota-client.mjs"],
 ["scripts/lib/ota-ci.mjs","lib/ota-ci.mjs"],
 ["scripts/lib/ota-retry-policy.mjs","lib/ota-retry-policy.mjs"],
 ["scripts/lib/ota-receipt.mjs","lib/ota-receipt.mjs"],
 ["scripts/lib/mac-release-startup.mjs","lib/mac-release-startup.mjs"],
 ["scripts/lib/mac-postactivation-health.mjs","lib/mac-postactivation-health.mjs"],
 ["scripts/lib/version-sync.mjs","lib/version-sync.mjs"],
 ["scripts/lib/device-version-state.mjs","lib/device-version-state.mjs"],
 ...(process.platform==="darwin"?[["scripts/mac-safe-cutover.mjs","mac-safe-cutover.mjs"]]:
 [["scripts/windows/verified-dev-cutover.ps1","windows/verified-dev-cutover.ps1"],
  ["scripts/windows/ota-post-activation-watch.ps1","windows/ota-post-activation-watch.ps1"]])
];
for(const [source,dest] of copies){
 const target=path.join(stable,dest);
 fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});
 fs.copyFileSync(path.join(project,source),target);
}
function run(bin,args,{ignore=false}={}){
 const r=spawnSync(bin,args,{timeout:15000,windowsHide:true,encoding:"utf8"});
 if(r.status!==0&&!ignore)throw Error("OTA_INSTALL_COMMAND_FAILED:"+bin+":"+String(r.error?.code??r.status)+":"+String(r.stderr||"").slice(-250));
}
function xml(s){return s.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll('"',"&quot;")}
if(process.platform==="darwin"){
 const agents=path.join(os.homedir(),"Library","LaunchAgents");
 fs.mkdirSync(agents,{recursive:true});
 for(const [label,mode,seconds] of [["fan.fde.owl.ota-heartbeat","heartbeat",30],["fan.fde.owl.ota-promote","tick",600]]){
  const target=path.join(agents,label+".plist");
  const body='<?xml version="1.0" encoding="UTF-8"?>\n'+
   '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'+
   '<plist version="1.0"><dict><key>Label</key><string>'+label+'</string>'+
   '<key>ProgramArguments</key><array><string>'+xml(process.execPath)+'</string><string>'+
     xml(task)+'</string><string>'+mode+'</string></array>'+
   '<key>StartInterval</key><integer>'+seconds+'</integer>'+
   '<key>RunAtLoad</key><true/>'+
   '<key>StandardOutPath</key><string>'+xml(path.join(otaRoot,mode+".out.log"))+'</string>'+
   '<key>StandardErrorPath</key><string>'+xml(path.join(otaRoot,mode+".err.log"))+'</string>'+
   '</dict></plist>';
  const temp=target+"."+process.pid+".tmp";
  try{fs.writeFileSync(temp,body,{mode:0o600,flag:"wx"});fs.renameSync(temp,target)}finally{try{fs.unlinkSync(temp)}catch{}}
  const domain="gui/"+process.getuid();
  run("/bin/launchctl",["bootout",domain+"/"+label],{ignore:true});
  run("/bin/launchctl",["bootstrap",domain,target]);
 }
}else if(process.platform==="win32"){
 const node=process.execPath.replaceAll('"',"");
 for(const [name,mode,minutes,script] of [
  ["OWL-LAB-OTA-Heartbeat","heartbeat",1,task],
  ["OWL-LAB-OTA-Promote","tick",10,task],
  ["OWL-LAB-OTA-PostActivation-Watch","",1,path.join(stable,"windows","ota-post-activation-watch.ps1")]]){
  const action=mode?'"'+node+'" "'+script.replaceAll('"',"")+'" '+mode:
   'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "'+script.replaceAll('"',"")+'"';
  run("schtasks.exe",["/Create","/SC","MINUTE","/MO",String(minutes),"/TN",name,"/TR",action,"/F"]);
 }
}else throw Error("OTA_INSTALL_UNSUPPORTED_PLATFORM");
console.log(JSON.stringify({installed:true,platform:process.platform,heartbeatSeconds:60,
 activationSchedule:"when-online-with-peer-health-and-cloud-lease",
 crossDeviceLeaseRequired:true,sourceCheckoutChanged:false,liveServiceRestarted:false}));
