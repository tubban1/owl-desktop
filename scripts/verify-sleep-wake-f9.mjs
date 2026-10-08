#!/usr/bin/env node
import {spawn, execFile} from "node:child_process";
import {promisify} from "node:util";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {CloudHttpClient} from "../electron/services/cloud-http-client.mjs";
import {CloudMcpCallConsumer} from "../connection-host/cloud-mcp-call-consumer.mjs";
import {recheckConnectivityAfterWake} from "../connection-host/recheck-after-wake.mjs";
const exec=promisify(execFile);
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const check=(v,m)=>{if(!v)throw new Error(m);};
async function pids(){
 const result={};
 for(const port of [8788,8790,8791]){
   try {const {stdout}=await exec("/usr/sbin/lsof",["-nP","-tiTCP:"+port,"-sTCP:LISTEN"],{timeout:2000});
     result[port]=stdout.trim().split(/\s+/)[0]||null;
   } catch {result[port]=null;}
 }
 return result;
}
const before=await pids();
const script='const s=require("node:http").createServer((q,r)=>{r.writeHead(200,{"content-type":"application/json"});r.end(JSON.stringify({calls:[]}));});s.listen(0,"127.0.0.1",()=>console.log("PORT="+s.address().port));';
const child=spawn(process.execPath,["-e",script],{stdio:["ignore","pipe","pipe"]});
let paused=false,consumer=null;
try{
 const port=await Promise.race([
  new Promise((resolve,reject)=>{
   let output="";
   child.once("error",reject);
   child.once("exit",c=>reject(new Error("Test Cloud exited: "+c)));
   child.stdout.on("data",d=>{output+=String(d);const m=output.match(/PORT=(\d+)/);if(m)resolve(Number(m[1]));});
  }),
  sleep(5000).then(()=>{throw new Error("Test Cloud did not listen");})
 ]);
 let probes=0;
 consumer=new CloudMcpCallConsumer({
   cloudClient:new CloudHttpClient({baseUrl:"http://127.0.0.1:"+port,
     deviceCredential:"fixture-not-real",timeoutMs:300}),
   executor:{execute:()=>{throw new Error("Unexpected side effect");},
     snapshot:()=>({lastProofAt:new Date().toISOString()}),
     probe:async()=>{probes++;}},
   pollIntervalMs:60000
 });
 check((await consumer.start()).ready===true,"Initial Cloud was not Ready");
 const tunnel={
   status:()=>({desiredRunning:true}),
   markWakePending:()=>{},
   checkHealthNow:async()=>({reachability:{state:"ready"}})
 };
 process.kill(child.pid,"SIGSTOP");paused=true;
 const started=Date.now();
 const stopped=await recheckConnectivityAfterWake({tunnelSupervisor:tunnel,cloudMcpConsumer:consumer});
 const timeoutMs=Date.now()-started;
 check(timeoutMs<3000,"Cloud hang was not bounded");
 check(stopped.tunnel?.ready===true,"Tunnel fixture did not remain healthy");
 check(stopped.cloudMcp?.ready===false,"Cloud falsely Ready while stopped");
 check(stopped.cloudMcp?.errorCode==="CLOUD_TIMEOUT","Cloud timeout code missing");
 process.kill(child.pid,"SIGCONT");paused=false;
 const resumed=await recheckConnectivityAfterWake({tunnelSupervisor:tunnel,cloudMcpConsumer:consumer});
 check(resumed.cloudMcp?.ready===true,"Cloud did not recover");
 check(probes>=2,"Fresh local executor probe not proven");
 const after=await pids();
 check(JSON.stringify(before)===JSON.stringify(after),"Production listener PID changed");
 const evidence={ok:true,gate:"F9 isolated process-level sleep/wake equivalent",
  fault:"SIGSTOP/SIGCONT on separate loopback Cloud child",pid:child.pid,port,
  frozen:{cloudReady:stopped.cloudMcp.ready,error:stopped.cloudMcp.errorCode,
    tunnelReady:stopped.tunnel.ready,timeoutMs},
  recovered:{cloudReady:resumed.cloudMcp.ready,executorProbes:probes},
  productionBefore:before,productionAfter:after,
  productionTunnelTouched:false,actualMacSleepTested:false,
  duplicateSideEffects:0,falseReady:0,at:new Date().toISOString()};
 const dest=path.resolve(path.dirname(fileURLToPath(import.meta.url)),
   "../release/acceptance/sleep-wake-f9/sleep-wake-f9.json");
 fs.mkdirSync(path.dirname(dest),{recursive:true});
 fs.writeFileSync(dest,JSON.stringify(evidence,null,2)+"\n");
 console.log(JSON.stringify(evidence,null,2));
}finally{
 await consumer?.stop().catch(()=>undefined);
 if(paused){try{process.kill(child.pid,"SIGCONT");}catch{}}
 try{process.kill(child.pid,"SIGTERM");}catch{}
}
