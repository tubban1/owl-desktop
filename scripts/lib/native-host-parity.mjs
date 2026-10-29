// Read-only, cross-platform Native Messaging release alignment preflight.
// Do NOT read or print broker credentials, nor modify Chrome/registry/files.
import {createHash} from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const sha=p=>{
 try{return createHash("sha256").update(fs.readFileSync(p)).digest("hex");}
 catch{return null;}
};
export function inspectNativeHostParity({expectedRoot,sourceRoot,extensionRoot,allowedOrigins=[],registeredOrigin,hostName="ai.owl.lab.agent"}={}) {
 const target=path.resolve(expectedRoot??".");
 const expected=path.join(target,"connection-host","native-messaging-host.mjs");
 const live=sourceRoot?path.resolve(sourceRoot):null;
 const expectedHash=sha(expected),liveHash=live?sha(live):null;
 const extensionExpected=path.join(target,"chrome-agent-native","manifest.json");
 const extensionLive=extensionRoot?path.join(path.resolve(extensionRoot),"manifest.json"):null;
 let expectedVersion=null,installedVersion=null;
 try{expectedVersion=JSON.parse(fs.readFileSync(extensionExpected,"utf8")).version;}catch{}
 try{if(extensionLive)installedVersion=JSON.parse(fs.readFileSync(extensionLive,"utf8")).version;}catch{}
 const originOk=typeof registeredOrigin==="string"&&allowedOrigins.includes(registeredOrigin);
 const sourceMatches=Boolean(expectedHash&&expectedHash===liveHash);
 const extensionVersionMatches=Boolean(expectedVersion&&installedVersion===expectedVersion);
 return {
  hostName, expectedVersion,installedVersion,
  activeRoot:target,sourcePath:live,sourceMatches,
  bindingPointsToActiveRelease:live===expected,
  extensionVersionMatches,extensionSourcePath:extensionRoot??null,
  originOk,
  ready:originOk&&sourceMatches&&extensionVersionMatches,
  requiresRebind:Boolean(!sourceMatches||!originOk),
  requiresReload:!extensionVersionMatches,
  note:"A connected Native Messaging process does not prove it follows the active release. Check live worker version after controlled reload; do not replace an in-use host without rollback."
 };
}
