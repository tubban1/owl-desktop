// Fail-closed macOS Chrome Native Messaging pin and boot-time reconciliation.
// The wrapper contains only a Node executable, script path, broker path and
// extension ID: no credential data is read or exposed here.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";

const HOST="ai.owl.lab.agent";
const ORIGIN=/^chrome-extension:\/\/([a-p]{32})\/$/;
const WRAPPER=/^#!\/bin\/sh\nexec '([^'\n]+)' '([^'\n]+\/connection-host\/native-messaging-host\.mjs)' --config '([^'\n]+)' --extension-id '([a-p]{32})' "\$@"\n?$/;
export function inspectMacNativeHostPin({home=os.homedir(),releasesRoot=path.join(home,"Documents/Me/Project/cursor/_releases")}={}) {
 const data=path.join(home,"Library/Application Support/OWL LAB/desktop/native-chrome");
 const manifestFile=path.join(home,"Library/Application Support/Google/Chrome/NativeMessagingHosts",HOST+".json");
 if(!fs.existsSync(manifestFile))return {configured:false,trusted:true,safeToPrune:true,sourceRoot:null};
 let manifest;
 try{manifest=JSON.parse(fs.readFileSync(manifestFile,"utf8"));}catch{return {configured:true,trusted:false,safeToPrune:false,reason:"NATIVE_MANIFEST_UNREADABLE"};}
 const origin=manifest?.allowed_origins?.length===1?manifest.allowed_origins[0]:null;
 const extensionId=origin?.match(ORIGIN)?.[1];
 const wrapper=path.join(data,"owl-native-message-host.sh");
 if(manifest?.name!==HOST||manifest?.type!=="stdio"||manifest?.path!==wrapper||!extensionId)
  return {configured:true,trusted:false,safeToPrune:false,reason:"NATIVE_MANIFEST_UNTRUSTED"};
 let content;
 try{content=fs.readFileSync(wrapper,"utf8");}catch{
  return {configured:true,trusted:false,safeToPrune:false,reason:"NATIVE_WRAPPER_MISSING"};
 }
 const match=content.match(WRAPPER);
 if(!match||match[3]!==path.join(data,"broker.json")||match[4]!==extensionId)
  return {configured:true,trusted:false,safeToPrune:false,reason:"NATIVE_WRAPPER_UNTRUSTED"};
 const script=path.resolve(match[2]),base=path.resolve(releasesRoot)+path.sep;
 const releaseRoot=path.dirname(path.dirname(script));
 if(!releaseRoot.startsWith(base)||!/^owl-desktop-[0-9a-f]{7}$/.test(path.basename(releaseRoot)))
  return {configured:true,trusted:false,safeToPrune:false,reason:"NATIVE_RELEASE_ROOT_UNTRUSTED"};
 const exists=fs.existsSync(script)&&fs.existsSync(match[1]);
 return {configured:true,trusted:true,safeToPrune:exists,
  reason:exists?null:"NATIVE_HOST_SOURCE_DANGLING",
  sourceRoot:releaseRoot,script,extensionId};
}
export function syncMacNativeHostForLive({activeRoot,expectedSha,home=os.homedir(),execute=execFileSync}={}) {
 if(process.platform!=="darwin")return {status:"unsupported"};
 if(!/^[a-f0-9]{40}$/.test(expectedSha??""))throw Error("NATIVE_RECONCILE_SHA_REQUIRED");
 const pinned=inspectMacNativeHostPin({home});
 if(!pinned.configured)return {status:"not-installed"};
 if(!pinned.trusted)throw Error(pinned.reason);
 const expected=path.join(activeRoot,"connection-host/native-messaging-host.mjs");
 if(pinned.script===expected&&pinned.safeToPrune)return {status:"current"};
 const script=path.join(activeRoot,"scripts/reconcile-mac-native-host.mjs");
 if(!fs.existsSync(script))throw Error("NATIVE_RECONCILE_SCRIPT_MISSING");
 execute(process.execPath,[script,"--mode","apply","--active-root",activeRoot,"--expected-sha",expectedSha],
  {encoding:"utf8",timeout:12000,stdio:"pipe"});
 const updated=inspectMacNativeHostPin({home});
 if(!updated.safeToPrune||updated.script!==expected)throw Error("NATIVE_RECONCILE_POSTCONDITION_FAILED");
 return {status:"rebound"};
}
