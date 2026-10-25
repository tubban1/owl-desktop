#!/usr/bin/env node
// Chrome Native Messaging stdio transport. stdout MUST contain only framed JSON.
import fs from "node:fs";
import {setTimeout as sleep} from "node:timers/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";

export function frame(message){
  const bytes=Buffer.from(JSON.stringify(message),"utf8");
  if(bytes.length>1_000_000)throw new Error("NATIVE_FRAME_TOO_LARGE");
  const header=Buffer.allocUnsafe(4);header.writeUInt32LE(bytes.length,0);
  return Buffer.concat([header,bytes]);
}
export function decoder(onMessage){
  let input=Buffer.alloc(0);
  return data=>{
    input=Buffer.concat([input,data]);
    while(input.length>=4){
      const length=input.readUInt32LE(0);
      if(length>8_000_000||length===0)throw new Error("NATIVE_INPUT_SIZE_INVALID");
      if(input.length<4+length)break;
      const message=JSON.parse(input.subarray(4,4+length).toString("utf8"));
      input=input.subarray(4+length);onMessage(message);
    }
  };
}
function configArg(name){const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:null;}
async function main(){
  const configFile=configArg("--config");
  const extensionId=configArg("--extension-id");
  const origin=process.argv.find(x=>/^chrome-extension:\/\/[a-p]{32}\/?$/.test(x));
  if(!configFile||!extensionId||!new RegExp("^[a-p]{32}$").test(extensionId)||
     origin!==`chrome-extension://${extensionId}/`)throw Error("NATIVE_EXTENSION_ID_MISMATCH");
  const file=fs.realpathSync(configFile);
  const stat=fs.statSync(file);
  if(process.platform!=="win32"&&(stat.mode&0o077)!==0)throw Error("NATIVE_HOST_CONFIG_NOT_PRIVATE");
  function loadBrokerConfig(){
    const next=JSON.parse(fs.readFileSync(file,"utf8"));
    if(!Number.isInteger(next.port)||next.port<=0||next.port>65535||
       !/^[a-f0-9]{64}$/.test(next.token))throw Error("NATIVE_CONFIG_INVALID");
    return next;
  }
  let {port,token}=loadBrokerConfig();
  const messages=new Map();
  let alive=true;
  const send=msg=>process.stdout.write(frame(msg));
  process.stdin.on("data",decoder(msg=>{
    if(msg?.type==="result"&&typeof msg.id==="string"){
      const pending=messages.get(msg.id);
      if(pending){messages.delete(msg.id);pending(msg);}
    }
  }));
  process.stdin.once("end",()=>{alive=false;});
  process.stdin.once("error",()=>{alive=false;});
  async function req(endpoint,data){
    const reply=await fetch("http://127.0.0.1:"+port+endpoint,{method:"POST",headers:{
      authorization:"Bearer "+token,"content-type":"application/json"
    },body:JSON.stringify(data),signal:AbortSignal.timeout(4500)});
    if(!reply.ok)throw Error("NATIVE_BROKER_HTTP_"+reply.status);
    return reply.json();
  }
  send({type:"ready"});
  let denied=0;
  while(alive){
    try{
      const answer=await req("/v1/native/poll",{});
      denied=0;
      const task=answer.request;
      if(task){
        send({type:"command",...task});
        let response=await Promise.race([
          new Promise(resolve=>messages.set(task.id,resolve)),
          sleep(22000).then(()=>({id:task.id,ok:false,error:"NATIVE_EXTENSION_TIMEOUT"})),
        ]);
        messages.delete(task.id);
        await req("/v1/native/result",response);
      }
    }catch(e){
      if(/NATIVE_BROKER_HTTP_401/.test(String(e.message))){
        // Retry only when the trusted private Broker config has rotated.
        try {
          const updated=loadBrokerConfig();
          if(updated.port!==port || updated.token!==token){
            ({port,token}=updated);
            denied=0;
            continue;
          }
        }catch{}
        if(++denied>=3)break;
      }
      process.stderr.write("OWL native host reconnect: "+String(e.message).slice(0,100)+"\n");
    }
    await sleep(450);
  }
  // A rejected/revoked Broker token must close Chrome's native transport.
  // Keeping stdin in flowing mode leaves the child process alive forever,
  // falsely connected but unable to deliver any further browser commands.
  process.stdin.pause();
  process.stdin.removeAllListeners("data");
  process.stdin.removeAllListeners("end");
  process.stdin.removeAllListeners("error");
  process.stdin.destroy();
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(e=>{process.stderr.write("OWL native host: "+e.message+"\n");process.exitCode=1;});
}
