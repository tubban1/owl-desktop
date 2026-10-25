import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const hostScript=fileURLToPath(new URL("../connection-host/native-messaging-host.mjs",import.meta.url));
describe("Native Messaging Host Broker lifecycle",()=>{
 it("terminates its child even with Chrome stdin still open when Broker rejects credentials",async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"owl-native-end-"));
  const server=http.createServer((req,res)=>{req.resume();res.writeHead(401);res.end('{}');});
  let child;
  try {
   await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
   const file=path.join(dir,"broker.json");
   await fs.writeFile(file,JSON.stringify({port:server.address().port,token:"a".repeat(64)}),{mode:0o600});
   const id="ieknbkgbgochopbkbkikgccggglpdmde";
   child=spawn(process.execPath,[hostScript,"--config",file,"--extension-id",id,"chrome-extension://"+id+"/"],
     {stdio:["pipe","pipe","pipe"]});
   child.stdout.resume();
   const code=await new Promise((resolve,reject)=>{
     const timer=setTimeout(()=>reject(new Error("STUCK_NATIVE_HOST_AFTER_BROKER_401")),8500);
     child.once("exit",c=>{clearTimeout(timer);resolve(c)});
     child.once("error",e=>{clearTimeout(timer);reject(e)});
   });
   expect(code).toBe(0);
  }finally{
   if(child && child.exitCode===null)child.kill();
   if(child)child.stdin.destroy();
   await new Promise(resolve=>server.close(resolve));
   await fs.rm(dir,{recursive:true,force:true});
  }
 },11500);
});
