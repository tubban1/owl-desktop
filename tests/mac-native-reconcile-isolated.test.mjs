import {describe,it,expect} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync,spawnSync} from "node:child_process";

const cli=new URL("../scripts/reconcile-mac-native-host.mjs",import.meta.url).pathname;
const originId="dolpahioegolmcedoebnmebbgfpoiace";

describe("Standalone native host reconciler never touches the real Chrome profile in QA",()=>{
 it.skipIf(process.platform!=="darwin")("rejects an invalid test release before changing any host binding, then accepts SHA7",()=>{
  const home=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"owl-native-reconcile-isolated-")));
  try {
   const releaseDir=path.join(home,"Documents/Me/Project/cursor/_releases");
   const state=path.join(home,"Library/Application Support/OWL LAB/desktop/native-chrome");
   const registry=path.join(home,"Library/Application Support/Google/Chrome/NativeMessagingHosts");
   for(const dir of [releaseDir,state,registry])fs.mkdirSync(dir,{recursive:true});
   const oldRoot=path.join(releaseDir,"owl-desktop-1a67f22");
   const source=path.join(releaseDir,"owl-desktop-gate-candidate-20261117");
   for(const dir of [oldRoot,source]){
    fs.mkdirSync(path.join(dir,"connection-host"),{recursive:true});
    fs.writeFileSync(path.join(dir,"connection-host/native-messaging-host.mjs"),"// synthetic");
   }
   execFileSync("git",["init","-q",source]);
   execFileSync("git",["-C",source,"add","."]);
   execFileSync("git",["-C",source,"-c","user.name=OWL QA","-c","user.email=owl-qa@example.invalid","commit","-qm","isolated test commit"]);
   const sha=execFileSync("git",["-C",source,"rev-parse","HEAD"],{encoding:"utf8"}).trim();
   const manifest=path.join(registry,"ai.owl.lab.agent.json");
   const wrapper=path.join(state,"owl-native-message-host.sh");
   const broker=path.join(state,"broker.json");
   fs.writeFileSync(broker,"{}");
   fs.writeFileSync(manifest,JSON.stringify({
    name:"ai.owl.lab.agent",type:"stdio",path:wrapper,
    allowed_origins:["chrome-extension://"+originId+"/"],
   }));
   const wrap=root=>`#!/bin/sh\nexec '${process.execPath}' '${path.join(root,"connection-host/native-messaging-host.mjs")}' --config '${broker}' --extension-id '${originId}' "$@"\n`;
   fs.writeFileSync(wrapper,wrap(oldRoot),{mode:0o700});
   const before=fs.readFileSync(wrapper,"utf8");
   const invoke=root=>spawnSync(process.execPath,[cli,"--mode","apply","--active-root",root,"--expected-sha",sha],{
    env:{...process.env,HOME:home},encoding:"utf8",timeout:8000,
   });
   const invalid=invoke(source);
   expect(invalid.status).not.toBe(0);
   expect(invalid.stderr).toContain("MAC_NATIVE_HOST_RELEASE_ROOT_INVALID");
   expect(fs.readFileSync(wrapper,"utf8")).toBe(before);
   expect(fs.existsSync(path.join(state,"native-host-last-switch.json"))).toBe(false);
   const validRoot=path.join(releaseDir,"owl-desktop-"+sha.slice(0,7));
   fs.renameSync(source,validRoot);
   const valid=invoke(validRoot);
   expect(valid.status,valid.stderr).toBe(0);
   expect(fs.readFileSync(wrapper,"utf8")).toBe(wrap(validRoot));
   const receipt=JSON.parse(fs.readFileSync(path.join(state,"native-host-last-switch.json"),"utf8"));
   expect(receipt.targetSha).toBe(sha);
  } finally {
   fs.rmSync(home,{recursive:true,force:true});
  }
 },20000);
});
