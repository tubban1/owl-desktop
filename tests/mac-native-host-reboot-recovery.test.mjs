import {describe,it,expect} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {inspectMacNativeHostPin,syncMacNativeHostForLive} from "../scripts/lib/mac-native-host-protection.mjs";
const ID="dolpahioegolmcedoebnmebbgfpoiace";
function fixture(fn){
 const home=fs.mkdtempSync(path.join(os.tmpdir(),"owl-native-boot-"));
 const releases=path.join(home,"Documents/Me/Project/cursor/_releases");
 const base=path.join(home,"Library/Application Support/OWL LAB/desktop/native-chrome");
 const reg=path.join(home,"Library/Application Support/Google/Chrome/NativeMessagingHosts");
 for(const dir of [base,reg,releases])fs.mkdirSync(dir,{recursive:true});
 const old=path.join(releases,"owl-desktop-1a67f22");
 const live=path.join(releases,"owl-desktop-0776eca");
 for(const dir of [old,live]){
  fs.mkdirSync(path.join(dir,"connection-host"),{recursive:true});
  fs.mkdirSync(path.join(dir,"scripts"),{recursive:true});
  fs.writeFileSync(path.join(dir,"connection-host/native-messaging-host.mjs"),"// native host");
  fs.writeFileSync(path.join(dir,"scripts/reconcile-mac-native-host.mjs"),"// reconciler");
 }
 const manifest=path.join(reg,"ai.owl.lab.agent.json");
 const wrapper=path.join(base,"owl-native-message-host.sh");
 const makeWrapper=root=>"#!/bin/sh\nexec '"+process.execPath+"' '"+path.join(root,"connection-host/native-messaging-host.mjs")+"' --config '"+path.join(base,"broker.json")+"' --extension-id '"+ID+"' \"$@\"\n";
 fs.writeFileSync(manifest,JSON.stringify({name:"ai.owl.lab.agent",type:"stdio",path:wrapper,allowed_origins:["chrome-extension://"+ID+"/"]}));
 fs.writeFileSync(wrapper,makeWrapper(old));
 try{return fn({home,old,live,wrapper,manifest,makeWrapper});}
 finally{fs.rmSync(home,{recursive:true,force:true});}
}
describe("Native Host reboot/release-prune protection",()=>{
 it("treats a missing installation as non-blocking",()=>fixture(({home,manifest})=>{
  fs.rmSync(manifest);
  expect(inspectMacNativeHostPin({home})).toMatchObject({configured:false,safeToPrune:true});
 }));
 it("pins a valid inactive release even when no Chrome native process is running",()=>fixture(({home,old})=>{
  expect(inspectMacNativeHostPin({home})).toMatchObject({trusted:true,safeToPrune:true,sourceRoot:old});
 }));
 it("blocks deletion when the wrapper points to a deleted release",()=>fixture(({home,old})=>{
  fs.rmSync(old,{recursive:true});
  expect(inspectMacNativeHostPin({home})).toMatchObject({trusted:true,safeToPrune:false,reason:"NATIVE_HOST_SOURCE_DANGLING"});
 }));
 it("fails closed on untrusted origin and wrapper",()=>fixture(({home,wrapper,manifest})=>{
  const m=JSON.parse(fs.readFileSync(manifest));m.allowed_origins=["chrome-extension://invalid/"];fs.writeFileSync(manifest,JSON.stringify(m));
  expect(inspectMacNativeHostPin({home})).toMatchObject({trusted:false,safeToPrune:false,reason:"NATIVE_MANIFEST_UNTRUSTED"});
  m.allowed_origins=["chrome-extension://"+ID+"/"];fs.writeFileSync(manifest,JSON.stringify(m));
  fs.writeFileSync(wrapper,"#!/bin/sh\nexec /bin/true \"$@\"\n");
  expect(inspectMacNativeHostPin({home})).toMatchObject({trusted:false,safeToPrune:false,reason:"NATIVE_WRAPPER_UNTRUSTED"});
 }));
 it.skipIf(process.platform!=="darwin")("self-heals dangling host after reboot through verified release reconciler",()=>fixture(({home,old,live,wrapper,makeWrapper})=>{
  fs.rmSync(old,{recursive:true});
  const calls=[];
  const result=syncMacNativeHostForLive({home,activeRoot:live,expectedSha:"0".repeat(40),
   execute:(bin,args)=>{calls.push({bin,args});fs.writeFileSync(wrapper,makeWrapper(live));}});
  expect(result.status).toBe("rebound");
  expect(calls).toHaveLength(1);
  expect(calls[0].args).toContain("--active-root");
  expect(inspectMacNativeHostPin({home})).toMatchObject({safeToPrune:true,sourceRoot:live});
  expect(syncMacNativeHostForLive({home,activeRoot:live,expectedSha:"0".repeat(40)}).status).toBe("current");
 }));
 it.skipIf(process.platform!=="darwin")("refuses unexpected host configurations rather than overwriting",()=>fixture(({home,live,wrapper})=>{
  fs.writeFileSync(wrapper,"modified by unknown program");
  expect(()=>syncMacNativeHostForLive({home,activeRoot:live,expectedSha:"0".repeat(40)})).toThrow("NATIVE_WRAPPER_UNTRUSTED");
 }));
});
