#!/usr/bin/env node
// Fail-closed Windows release preflight. An Electron preview is not a deployable
// OWL LAB Windows application without all pinned platform-native components.
import fs from "node:fs";
import {createHash} from "node:crypto";
import path from "node:path";
import {fileURLToPath} from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const requirements=[
  {id:"runtime",rel:"vendor/owl-runtime/component.json"},
  {id:"runtime-node-win-x64",rel:"vendor/runtime-node/win32-x64/bin/node.exe"},
  {id:"runtime-host-win-x64",rel:"vendor/runtime-host/win32-x64/OwlRuntimeHost.exe"},
  {id:"desktop-helper-win-x64",rel:"vendor/helper/win32-x64/OWLHelper.exe"},
  {id:"tunnel-win-x64",rel:"vendor/owl-tunnel/win32-x64/tunnel-client-runtime.exe"}
];
const check=requirements.map(({id,rel})=>{
  const file=path.join(root,rel);
  return {id,relativePath:rel,present:fs.existsSync(file)&&fs.statSync(file).isFile()};
});
const helperFile=path.join(root,"vendor/helper/win32-x64/OWLHelper.exe");
const helperReceipt=path.join(root,"vendor/helper/win32-x64/component.json");
let helperVerified=false;
try{
  const receipt=JSON.parse(fs.readFileSync(helperReceipt,"utf8").replace(/^\uFEFF/,""));
  const sha=createHash("sha256").update(fs.readFileSync(helperFile)).digest("hex");
  helperVerified=receipt.component==="owl-windows-gui-helper"&&
    receipt.architecture==="win32-x64"&&receipt.sha256===sha;
}catch{}
check.push({id:"desktop-helper-win-x64-integrity",relativePath:"vendor/helper/win32-x64/component.json",present:helperVerified});
const missing=check.filter(c=>!c.present).map(c=>c.id);
const allowed=process.platform==="win32";
console.log(JSON.stringify({windowsReleaseReady:allowed&&missing.length===0,
  hostPlatform:process.platform,missing,check,signingStillRequired:true},null,2));
if(!allowed||missing.length)process.exitCode=2;
