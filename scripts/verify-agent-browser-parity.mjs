#!/usr/bin/env node
// Cross-platform read-only Agent Browser parity doctor.
// Never prints broker tokens, raw Chrome settings or other user tabs.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {auditAgentBrowserInstall} from "./lib/agent-browser-install-audit.mjs";
import {inspectNativeHostParity} from "./lib/native-host-parity.mjs";

function arg(name){const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:null;}
const repoRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const expectedRoot=path.resolve(arg("--active-root")||repoRoot);
const win=process.platform==="win32";
function readRegManifest() {
 if(!win)return path.join(os.homedir(),"Library/Application Support/Google/Chrome/NativeMessagingHosts/ai.owl.lab.agent.json");
 try{
  const out=execFileSync("reg.exe",["query","HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\ai.owl.lab.agent","/ve"],{encoding:"utf8",timeout:3500});
  return out.split(/\r?\n/).find(x=>x.includes("REG_SZ"))?.split("REG_SZ")[1]?.trim()??null;
 }catch{return null;}
}
function hostSourcePath(manifest) {
 if(!manifest?.path)return null;
 if(!win){
  try{
   const wrapper=fs.readFileSync(manifest.path,"utf8");
   const candidate=wrapper.match(/'([^'\n]+[\\/]connection-host[\\/]native-messaging-host\.mjs)'/);
   return candidate?.[1]??null;
  }catch{return null;}
 }
 try{
  const commands=execFileSync("powershell.exe",["-NoProfile","-Command",
   "(Get-CimInstance Win32_Process -Filter \"name='node.exe'\" | Where-Object { $_.CommandLine -match 'connection-host[\\\\/]native-messaging-host\\.mjs' } | ForEach-Object { $_.CommandLine }) -join \"\\n\""],{encoding:"utf8",timeout:8000,windowsHide:true});
  const sources=[...commands.matchAll(/["']?([A-Za-z]:[\\/][^"']+?[\\/]connection-host[\\/]native-messaging-host\.mjs)["']?/g)].map(x=>x[1].trim());
  return [...new Set(sources)].length===1?sources[0]:null;
 }catch{return null;}
}
const manifestPath=readRegManifest();
let manifest=null;
try{manifest=JSON.parse(fs.readFileSync(manifestPath,"utf8"));}catch{}
const origin=manifest?.allowed_origins?.length===1?manifest.allowed_origins[0]:null;
const extensionId=origin?.match(/^chrome-extension:\/\/([a-p]{32})\/$/)?.[1]??null;
const chromeRoot=win
 ?path.join(process.env.LOCALAPPDATA??"", "Google","Chrome","User Data")
 :path.join(os.homedir(),"Library","Application Support","Google","Chrome");
const extension=auditAgentBrowserInstall({
 chromeRoot,expectedRoot:path.join(expectedRoot,"chrome-agent-native"),
 extensionId:extensionId??"invalid-id",
});
const installed=await extension;
const source=hostSourcePath(manifest);
const profiles=installed.profiles??[];
const sources=[...new Set(profiles.map(p=>p.sourcePath).filter(Boolean))];
const parity=inspectNativeHostParity({
 expectedRoot,sourceRoot:source,extensionRoot:sources.length===1?sources[0]:null,
 allowedOrigins:origin?[origin]:[],registeredOrigin:origin
});
const report={
 platform:process.platform,expectedRoot,
 nativeHost:{manifestFound:Boolean(manifest),registeredOriginCount:manifest?.allowed_origins?.length??0,
  sourceMatches:parity.sourceMatches,bindingPointsToActiveRelease:parity.bindingPointsToActiveRelease,
  requiresRebind:parity.requiresRebind},
 extension:{installed:installed.installed,sourceCount:sources.length,
  profiles:profiles.map(p=>({profile:p.profile,extensionVersion:p.extensionVersion,
   matched:p.matched,filesChecked:p.filesChecked,ready:p.ready})),
  filesMatch:installed.ready,versionMatches:parity.extensionVersionMatches,
  expectedVersion:parity.expectedVersion,installedVersion:parity.installedVersion},
 catalog:"Compare runtime_info.mcpToolSurface.catalog.namesSha256 across machines. Client-visible published subsets can differ until connector refresh.",
 verdict:parity.ready&&installed.ready?"source-aligned":"requires-safe-reconciliation",
 note:"Read-only. Does not reload Chrome, modify native registrations, kill helpers, or activate a version. Rebind only through independently validated release cutover/rollback."
};
console.log(JSON.stringify(report,null,2));
if(report.verdict!=="source-aligned")process.exitCode=3;
