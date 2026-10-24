#!/usr/bin/env node
// Explicit opt-in installation; does not enable Chrome remote debugging.
// Usage: node scripts/install-chrome-native-host.mjs --extension-id <32 letters a-p>
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {fileURLToPath} from "node:url";
const idFlag=process.argv.indexOf("--extension-id");
const extensionId=idFlag>=0?process.argv[idFlag+1]:"";
if(!/^[a-p]{32}$/.test(extensionId||"")){
  console.error("Supply the 32-letter ID shown in chrome://extensions using --extension-id.");
  process.exit(2);
}
if(!["darwin","linux"].includes(process.platform)){
  console.error("Native Messaging installer currently supports macOS/Linux. Windows requires a separate signed host installer.");
  process.exit(2);
}
function arg(name){const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:null;}
const repoRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const script=path.resolve(arg("--host-script")||(fs.existsSync(path.join(repoRoot,"connection-host/native-messaging-host.mjs"))?path.join(repoRoot,"connection-host/native-messaging-host.mjs"):path.join(repoRoot,"native-messaging/native-messaging-host.mjs")));
const bundledNode=path.join(repoRoot,"runtime-node","bin","node");
const node=path.resolve(arg("--node")||(fs.existsSync(bundledNode)?bundledNode:process.execPath));
const dataRoot=path.resolve(arg("--user-data-dir")||(process.platform==="darwin"?path.join(os.homedir(),"Library","Application Support","OWL LAB","desktop"):path.join(os.homedir(),".local","share","owl-lab","desktop")));
if(!fs.existsSync(script)||!fs.existsSync(node))throw Error("Native host script or Node binary not found");
const name="ai.owl.lab.agent";
const dir=process.platform==="darwin"
  ?path.join(os.homedir(),"Library","Application Support","Google","Chrome","NativeMessagingHosts")
  :path.join(os.homedir(),".config","google-chrome","NativeMessagingHosts");
const install=path.join(dataRoot,"native-chrome");
const wrapper=path.join(install,"owl-native-message-host.sh");
const config=path.join(install,"broker.json");
if([wrapper,script,node,config].some(s=>s.includes("\n")||s.includes("'")))throw Error("Path contains unsupported shell characters");
const manifest=path.join(dir,name+".json");
const scriptText="#!/bin/sh\nexec '"+node+"' '"+script+"' --config '"+config+"' --extension-id '"+extensionId+"' \"$@\"\n";
const configJSON={name,description:"OWL LAB Agent Browser local Native Messaging host",path:wrapper,type:"stdio",allowed_origins:["chrome-extension://"+extensionId+"/"]};
fs.mkdirSync(dir,{recursive:true,mode:0o700});
fs.mkdirSync(install,{recursive:true,mode:0o700});
fs.writeFileSync(wrapper,scriptText,{mode:0o700});
fs.chmodSync(wrapper,0o700);
fs.writeFileSync(manifest,JSON.stringify(configJSON,null,2)+"\n",{mode:0o600});
fs.chmodSync(manifest,0o600);
console.log(JSON.stringify({installed:true,manifest,hostName:name,extensionId,
  note:"Reload the OWL LAB Agent Browser extension. OWL Connection Host must be running; Chrome remote debugging can be turned off."}));
