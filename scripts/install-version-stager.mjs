#!/usr/bin/env node
// Install a per-user, cross-platform staged-source poller. Does NOT replace
// live MCP/Desktop/Runtime processes and never touches the user's Git tree.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {spawnSync} from "node:child_process";

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const state=path.join(os.homedir(),".owl-lab","version-sync","desktop");
const agent=path.join(state,"agent","scripts");
const script=path.join(agent,"sync-dev-checkouts.mjs");
function guardDir(p){
 fs.mkdirSync(p,{recursive:true,mode:0o700});
 const stat=fs.lstatSync(p);
 if(stat.isSymbolicLink()||!stat.isDirectory())throw Error("SYNC_UNSAFE_AGENT_DIR");
}
function plistEscape(s){return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
function run(command,args){
 const x=spawnSync(command,args,{encoding:"utf8",windowsHide:true,timeout:10000,maxBuffer:8192});
 if(x.status!==0)throw Error("SYNC_SCHEDULER_FAILED: "+(x.error?.code||x.status)+" "+String(x.stderr||"").slice(0,160));
}
guardDir(state);guardDir(path.join(state,"agent"));guardDir(agent);guardDir(path.join(agent,"lib"));
fs.copyFileSync(path.join(project,"scripts","sync-dev-checkouts.mjs"),script);
fs.copyFileSync(path.join(project,"scripts","lib","version-sync.mjs"),path.join(agent,"lib","version-sync.mjs"));
fs.copyFileSync(path.join(project,"scripts","lib","device-version-state.mjs"),path.join(agent,"lib","device-version-state.mjs"));
const source=path.resolve(process.env.OWL_SYNC_SOURCE_ROOT||project);
fs.writeFileSync(path.join(state,"source.json"),JSON.stringify({source})+"\n",{mode:0o600});
if(process.platform==="darwin"){
 const id="fan.fde.owl.version-stager",dest=path.join(os.homedir(),"Library","LaunchAgents",id+".plist");
 guardDir(path.dirname(dest));
 const xml='<?xml version="1.0" encoding="UTF-8"?>\n'+
 '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'+
 '<plist version="1.0"><dict>\n'+
 '<key>Label</key><string>'+id+'</string>\n'+
 '<key>ProgramArguments</key><array><string>'+plistEscape(process.execPath)+'</string><string>'+plistEscape(script)+'</string><string>stage</string></array>\n'+
 '<key>EnvironmentVariables</key><dict><key>OWL_SYNC_SOURCE_ROOT</key><string>'+plistEscape(source)+'</string></dict>\n'+
 '<key>RunAtLoad</key><true/><key>StartInterval</key><integer>1800</integer>\n'+
 '<key>StandardOutPath</key><string>'+plistEscape(path.join(state,"stager.out.log"))+'</string>\n'+
 '<key>StandardErrorPath</key><string>'+plistEscape(path.join(state,"stager.err.log"))+'</string>\n'+
 '</dict></plist>\n';
 // Write atomically so launchd never sees a partial plist.
 const temp=dest+".tmp-"+process.pid;
 try{fs.writeFileSync(temp,xml,{mode:0o600,flag:"wx"});fs.renameSync(temp,dest);}
 finally{try{fs.unlinkSync(temp);}catch{}}
 const domain="gui/"+process.getuid();
 const old=spawnSync("launchctl",["bootout",domain+"/"+id],{stdio:"ignore",timeout:6000});
 run("launchctl",["bootstrap",domain,dest]);
 process.stdout.write(JSON.stringify({installed:true,platform:"mac",frequencyMinutes:30,
  scheduledService:id,source,liveProcessesTouched:false,installation:dest})+"\n");
}else if(process.platform==="win32"){
 const taskName="OWL-LAB-Version-Stager";
 // Install a GUI-subsystem WScript wrapper, not a console node.exe action.
 const wrapper=path.join(agent,"windows","hidden-scheduled-task.vbs");
 fs.mkdirSync(path.dirname(wrapper),{recursive:true});
 fs.copyFileSync(path.join(project,"scripts","windows","hidden-scheduled-task.vbs"),wrapper);
 const host=path.join(process.env.SystemRoot||"C:/Windows","System32","wscript.exe");
 const command='"'+host+'" //B //Nologo "'+wrapper+'" stage';
 run("schtasks.exe",["/Create","/SC","MINUTE","/MO","30","/TN",taskName,
  "/TR",command,"/F"]);
 process.stdout.write(JSON.stringify({installed:true,platform:"windows",frequencyMinutes:30,
  scheduledService:taskName,liveProcessesTouched:false})+"\n");
}else throw Error("SYNC_SCHEDULER_PLATFORM_UNSUPPORTED");
