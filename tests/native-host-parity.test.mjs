import {describe,it,expect} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {inspectNativeHostParity} from "../scripts/lib/native-host-parity.mjs";
describe("Native Host version alignment",()=>{
 it("accepts same source SHA even if paths differ but exposes stale binding risk",()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"owl-parity-"));
  try {
   const a=path.join(root,"release"),b=path.join(root,"old");
   for(const dir of [a,b]){
    fs.mkdirSync(path.join(dir,"connection-host"),{recursive:true});
    fs.mkdirSync(path.join(dir,"chrome-agent-native"));
    fs.writeFileSync(path.join(dir,"connection-host/native-messaging-host.mjs"),"safe host");
    fs.writeFileSync(path.join(dir,"chrome-agent-native/manifest.json"),'{"version":"0.4.6"}');
   }
   const info=inspectNativeHostParity({expectedRoot:a,sourceRoot:path.join(b,"connection-host/native-messaging-host.mjs"),extensionRoot:path.join(b,"chrome-agent-native"),registeredOrigin:"chrome-extension://aaa/",allowedOrigins:["chrome-extension://aaa/"]});
   expect(info.ready).toBe(true);
   expect(info.bindingPointsToActiveRelease).toBe(false);
   fs.writeFileSync(path.join(b,"connection-host/native-messaging-host.mjs"),"old host");
   expect(inspectNativeHostParity({expectedRoot:a,sourceRoot:path.join(b,"connection-host/native-messaging-host.mjs"),extensionRoot:path.join(b,"chrome-agent-native"),registeredOrigin:"chrome-extension://aaa/",allowedOrigins:["chrome-extension://aaa/"]}).requiresRebind).toBe(true);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
 });
 it("rejects wrong origin and stale extension",()=>{
  const report=inspectNativeHostParity({expectedRoot:"/no-such-root",sourceRoot:"/bad",registeredOrigin:"chrome-extension://bad/",allowedOrigins:["chrome-extension://good/"]});
  expect(report.ready).toBe(false);expect(report.originOk).toBe(false);
 });
});
