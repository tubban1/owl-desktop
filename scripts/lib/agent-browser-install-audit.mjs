// Safe read-only validation of installed Chrome unpacked Agent Browser source.
// Never modifies Chrome profile files or reloads a running extension.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {fileURLToPath} from "node:url";

export const EXTENSION_ID="dolpahioegolmcedoebnmebbgfpoiace";
const ASSETS=[
  "manifest.json","service-worker.mjs","agent-executor.mjs",
  "download-workflow.mjs","p2-capabilities.mjs","p2-interactions.mjs",
  "file-inputs.mjs","file-drop-zone.mjs","rich-editor.mjs","virtual-cursor.mjs",
  "form-controls.mjs","trusted-text-field.mjs","popup.html","popup.mjs",
  "icons/icon16.png","icons/icon32.png","icons/icon48.png","icons/icon128.png"
];
const read=async p=>fs.readFile(p).catch(()=>null);

export async function auditAgentBrowserInstall({
  chromeRoot=path.join(os.homedir(),"Library/Application Support/Google/Chrome"),
  expectedRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../chrome-agent-native"),
  extensionId=EXTENSION_ID
}={}){
  const profiles=[];
  let dirs=[];
  try{dirs=await fs.readdir(chromeRoot,{withFileTypes:true});}
  catch{return {installed:false,ready:false,reason:"CHROME_PROFILE_NOT_FOUND",profiles:[],reloadVerified:false};}
  for(const entry of dirs){
    if(!entry.isDirectory()||!(/^(Default|Profile \d+)$/.test(entry.name)))continue;
    let setting=null;
    for(const file of ["Secure Preferences","Preferences"]){
      const data=await read(path.join(chromeRoot,entry.name,file));
      if(!data)continue;
      try{const json=JSON.parse(data.toString("utf8"));setting=json?.extensions?.settings?.[extensionId]??null;}
      catch{/* Chrome may atomically rewrite profile settings while read. */}
      if(setting)break;
    }
    if(!setting)continue;
    const installedPath=setting.path;
    if(typeof installedPath!=="string"||!path.isAbsolute(installedPath)){
      profiles.push({profile:entry.name,ready:false,reason:"EXTENSION_SOURCE_NOT_ABSOLUTE",matched:0,filesChecked:ASSETS.length});
      continue;
    }
    let matched=0;
    const mismatched=[];
    for(const asset of ASSETS){
      const [a,b]=await Promise.all([read(path.join(expectedRoot,asset)),read(path.join(installedPath,asset))]);
      if(a&&b&&a.equals(b))matched++;
      else mismatched.push(asset);
    }
    profiles.push({
      profile:entry.name,sourcePath:installedPath,location:setting.location??null,
      extensionVersion:setting.manifest?.version??null,
      filesChecked:ASSETS.length,matched,mismatched,
      ready:mismatched.length===0,reason:mismatched.length===0?"DISK_FILES_MATCH":"EXTENSION_SOURCE_STALE"
    });
  }
  if(!profiles.length)return {installed:false,ready:false,reason:"AGENT_BROWSER_NOT_INSTALLED",profiles:[],reloadVerified:false};
  return {installed:true,ready:profiles.every(x=>x.ready),profiles,reloadVerified:false,
    // Hash matching a source directory does not prove Chrome reloaded the service worker.
    nextCheck:"Confirm live Chrome MV3 worker and Native Messaging handshake after a controlled reload."};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const report=await auditAgentBrowserInstall();
  console.log(JSON.stringify(report,null,2));
  if(!report.ready)process.exitCode=2;
}
