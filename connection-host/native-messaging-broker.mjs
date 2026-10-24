import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import {randomBytes, randomUUID, timingSafeEqual} from "node:crypto";

const MAX_QUEUE = 64;
const MAX_BODY = 6_000_000;
function equalToken(a,b) {
  const x=Buffer.from(String(a||"")), y=Buffer.from(String(b||""));
  return x.length===y.length && timingSafeEqual(x,y);
}
function json(res,code,value) {
  res.writeHead(code,{"content-type":"application/json; charset=utf-8","cache-control":"no-store"});
  res.end(JSON.stringify(value));
}
export async function startNativeMessagingBroker({
  port=8795,configPath,token=randomBytes(32).toString("hex"),
  deadlineMs=25_000
}={}) {
  if(!configPath)throw new Error("NATIVE_HOST_CONFIG_PATH_REQUIRED");
  const outstanding=new Map(),queue=[];
  let lastConnectedAt=0, closed=false;
  async function request(owner,op,args={}) {
    if(closed)throw new Error("NATIVE_HOST_SHUTDOWN");
    if(!owner||typeof owner!=="string"||owner.length>240)throw new Error("NATIVE_OWNER_REQUIRED");
    if(queue.length+outstanding.size>=MAX_QUEUE)throw new Error("NATIVE_QUEUE_FULL");
    if(Date.now()-lastConnectedAt>8000)throw new Error("NATIVE_EXTENSION_NOT_CONNECTED: Install/enable OWL LAB Agent Browser extension and native messaging host.");
    const id=randomUUID();
    return await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{
        outstanding.delete(id);
        const n=queue.findIndex(x=>x.id===id);if(n>=0)queue.splice(n,1);
        reject(new Error("NATIVE_EXTENSION_ACTION_TIMEOUT"));
      },deadlineMs);
      timer.unref?.();
      outstanding.set(id,{resolve,reject,timer,owner});
      queue.push({id,owner,op,args});
    });
  }
  const server=http.createServer((req,res)=>{
    if(req.socket.remoteAddress!=="127.0.0.1"&&req.socket.remoteAddress!=="::1"){
      json(res,403,{error:"LOCAL_ONLY"});return;
    }
    if(!equalToken(req.headers.authorization?.replace(/^Bearer /i,""),token)){
      json(res,401,{error:"UNAUTHORIZED"});return;
    }
    if(req.method!=="POST"){json(res,405,{error:"METHOD_NOT_ALLOWED"});return;}
    let bytes=0,chunks=[];
    req.on("data",chunk=>{
      bytes+=chunk.length;
      if(bytes>MAX_BODY){req.destroy();return;}
      chunks.push(chunk);
    });
    req.on("end",()=>{
      let data;
      try{data=JSON.parse(Buffer.concat(chunks).toString("utf8")||"{}");}
      catch{json(res,400,{error:"INVALID_JSON"});return;}
      if(req.url==="/v1/native/poll"){
        lastConnectedAt=Date.now();
        json(res,200,{request:queue.shift()||null});
        return;
      }
      if(req.url==="/v1/native/result"){
        const pending=outstanding.get(data?.id);
        if(!pending){json(res,404,{error:"UNKNOWN_REQUEST"});return;}
        outstanding.delete(data.id);
        clearTimeout(pending.timer);
        if(data.ok===true && data.result && JSON.stringify(data.result).length<=MAX_BODY)
          pending.resolve(data.result);
        else pending.reject(new Error(String(data.error||"NATIVE_EXTENSION_FAILED").slice(0,400)));
        json(res,200,{accepted:true});return;
      }
      json(res,404,{error:"NOT_FOUND"});
    });
    req.on("error",()=>{});
  });
  await new Promise((resolve,reject)=>{
    server.once("error",reject);
    server.listen(port,"127.0.0.1",resolve);
  });
  const address=server.address(),actualPort=address.port;
  fs.mkdirSync(path.dirname(configPath),{recursive:true,mode:0o700});
  const tmp=configPath+".tmp."+process.pid;
  fs.writeFileSync(tmp,JSON.stringify({port:actualPort,token}),{mode:0o600,flag:"wx"});
  fs.chmodSync(tmp,0o600);
  fs.renameSync(tmp,configPath);
  return {
    port:actualPort,configPath,request,
    status(){return {connected:Date.now()-lastConnectedAt<8000,transport:"chrome-native-messaging",waiting:queue.length,host:"127.0.0.1"};},
    async close(){
      closed=true;
      for(const p of outstanding.values()){clearTimeout(p.timer);p.reject(new Error("NATIVE_HOST_SHUTDOWN"));}
      outstanding.clear();queue.length=0;
      await new Promise(resolve=>server.close(()=>resolve()));
      try{fs.unlinkSync(configPath);}catch{}
    }
  };
}
