// Windows-only native-host roundtrip verification: no Chrome profile or registry changes.
import assert from "node:assert/strict";
import {spawn,execFileSync} from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {startNativeMessagingBroker} from "../../connection-host/native-messaging-broker.mjs";
import {frame,decoder} from "../../connection-host/native-messaging-host.mjs";

if(process.platform!=="win32"){console.log(JSON.stringify({skipped:true,reason:"Windows-only"}));process.exit(0);}
const repo=fileURLToPath(new URL("../../",import.meta.url));
const dir=await fs.mkdtemp(path.join(os.tmpdir(),"owl-native-roundtrip-"));
const brokerPath=path.join(dir,"broker.json");
const id="ieknbkgbgochopbkbkikgccggglpdmde";
let broker,child,receivedReady=false,receivedCommand=false;
try{
 broker=await startNativeMessagingBroker({port:0,configPath:brokerPath,deadlineMs:10000});
 const install=fileURLToPath(new URL("./install-chrome-native-host.ps1",import.meta.url));
 const host=fileURLToPath(new URL("../../connection-host/native-messaging-host.mjs",import.meta.url));
 execFileSync("powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File",install,
  "-ExtensionId",id,"-NodeExe",process.execPath,"-HostScript",host,
  "-BrokerConfig",brokerPath,"-InstallRoot",dir,"-SkipRegistration","-ReplaceRegistration"],
  {cwd:repo,timeout:30000,windowsHide:true,stdio:"pipe"});
 const binary=path.join(dir,"owl-native-message-host.exe");
 const direct=process.argv.includes('--direct');
 child=direct
   ? spawn(process.execPath,[host,'--config',brokerPath,'--extension-id',id,'chrome-extension://'+id+'/'],
       {cwd:repo,windowsHide:true,stdio:['pipe','pipe','pipe']})
   : spawn(binary,["chrome-extension://"+id+"/","--parent-window=0"],
       {cwd:repo,windowsHide:true,stdio:["pipe","pipe","pipe"]});
 let resolveReady,rejectReady;
 const ready=new Promise((res,rej)=>{resolveReady=res;rejectReady=rej});
 let rejectProcess;
 child.on("error",e=>{rejectReady(e);rejectProcess?.(e)});
 const feed=decoder(msg=>{
  if(msg?.type==="ready"){receivedReady=true;resolveReady();return;}
  if(msg?.type==="command"&&msg.id){
   receivedCommand=true;
   child.stdin.write(frame({type:"command_received",id:msg.id}));
   child.stdin.write(frame({type:"result",id:msg.id,ok:true,result:{tabs:[],transportVerified:true}}));
  }
 });
 child.stdout.on("data",data=>{try{feed(data)}catch(e){rejectReady(e);rejectProcess?.(e)}});
 const stdErr=[];child.stderr.on("data",b=>{if(stdErr.length<3)stdErr.push(b.toString("utf8").slice(0,180))});
 await Promise.race([ready,new Promise((_,rej)=>setTimeout(()=>rej(Error("NO_READY_FRAME")),6500))]);
 for(let i=0;i<70&&!broker.status().connected;i++)await new Promise(r=>setTimeout(r,100));
 assert.equal(broker.status().connected,true,"NATIVE_HOST_DID_NOT_POLL");
 const result=await broker.request("owl-isolated-test","tabs",{});
 assert.deepEqual(result,{tabs:[],transportVerified:true});
 let status;
 for(let attempt=0;attempt<15;attempt++){
  status=broker.status();if(status.diagnostics.acknowledged>=1)break;
  await new Promise(r=>setTimeout(r,100));
 }
 assert.equal(receivedReady,true);
 assert.equal(receivedCommand,true);
 assert.equal(status.diagnostics.acknowledged,1);
 assert.equal(status.diagnostics.accepted,1);
 console.log(JSON.stringify({ok:true,compiledWindowsLauncher:true,binaryFrames:true,
  commandReceived:true,acknowledged:1,accepted:1,chromeUnmodified:true}));
}catch(e){
 console.log(JSON.stringify({ok:false,error:String(e.message||e).slice(0,240),receivedReady,receivedCommand,brokerStatus:broker?.status(),childExitCode:child?.exitCode}));
 process.exitCode=1;
}finally{
 try{child?.stdin.end()}catch{}
 if(child&&!child.killed){await Promise.race([new Promise(r=>child.once("exit",r)),new Promise(r=>setTimeout(r,1600))]);if(child.exitCode===null)child.kill();}
 await broker?.close().catch(()=>{});
 await fs.rm(dir,{recursive:true,force:true,maxRetries:3,retryDelay:250}).catch(()=>{});
}
