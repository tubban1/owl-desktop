import {describe,it,expect} from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
const here=path.dirname(fileURLToPath(import.meta.url));
describe("Chrome native host opt-in installer",()=>{
 it.skipIf(process.platform!=="darwin"&&process.platform!=="linux")("registers only the approved exact extension ID under an isolated fake HOME",async()=>{
  const fake=await fs.mkdtemp(path.join(os.tmpdir(),"owl-host-install-"));
  try{
   const id="a".repeat(32),script=path.resolve(here,"../scripts/install-chrome-native-host.mjs");
   const p=execFileSync(process.execPath,[script,"--extension-id",id,"--user-data-dir",path.join(fake,"owl")],{
     encoding:"utf8",env:{...process.env,HOME:fake}});
   expect(JSON.parse(p).installed).toBe(true);
   const manifest=path.join(fake,process.platform==="darwin"?"Library/Application Support/Google/Chrome/NativeMessagingHosts/ai.owl.lab.agent.json":".config/google-chrome/NativeMessagingHosts/ai.owl.lab.agent.json");
   const decoded=JSON.parse(await fs.readFile(manifest,"utf8"));
   expect(decoded.allowed_origins).toEqual(["chrome-extension://"+id+"/"]);
   expect(decoded.path).toContain("owl-native-message-host.sh");
   expect((await fs.stat(decoded.path)).mode&0o111).not.toBe(0);
   expect((await fs.stat(manifest)).mode&0o077).toBe(0);
   expect(await fs.readFile(decoded.path,"utf8")).not.toContain("9222");
   expect((await fs.readFile(decoded.path,"utf8"))).toContain("--extension-id");
  }finally{await fs.rm(fake,{recursive:true,force:true});}
 });
});
