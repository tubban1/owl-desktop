import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash,generateKeyPairSync,randomUUID,sign} from "node:crypto";
export const otaRoot=path.join(os.homedir(),".owl-lab","version-sync","desktop","ota");
const keyFile=path.join(otaRoot,"device-private.pem"),pubFile=path.join(otaRoot,"device-public.pem"),confFile=path.join(otaRoot,"coordinator.json");
export const platform=process.platform==="darwin"?"mac":process.platform==="win32"?"windows":null;
function atomic(file,data,mode=0o600){
 const temp=file+"."+randomUUID()+".tmp";
 try{fs.writeFileSync(temp,data,{flag:"wx",mode});fs.renameSync(temp,file)}finally{try{fs.unlinkSync(temp)}catch{}}
}
export function initIdentity(){
 if(!platform)throw Error("OTA_UNSUPPORTED_PLATFORM");
 fs.mkdirSync(otaRoot,{recursive:true,mode:0o700});
 if(!fs.existsSync(keyFile)){
  if(fs.existsSync(pubFile))throw Error("OTA_PARTIAL_DEVICE_KEY");
  const k=generateKeyPairSync("ed25519");
  atomic(keyFile,k.privateKey.export({format:"pem",type:"pkcs8"}),0o600);
  atomic(pubFile,k.publicKey.export({format:"pem",type:"spki"}),0o644);
 }
 return {device:platform,publicKey:fs.readFileSync(pubFile,"utf8"),hasPrivateKey:fs.existsSync(keyFile)};
}
export function configure(url){
 const u=new URL(url);
 if(u.protocol!=="https:"||u.username||u.password||u.search||u.hash||!u.hostname.endsWith(".workers.dev"))
  throw Error("OTA_COORDINATOR_URL_INVALID");
 fs.mkdirSync(otaRoot,{recursive:true,mode:0o700});
 atomic(confFile,JSON.stringify({url:u.origin})+"\n");
 return {url:u.origin};
}
function baseUrl(){
 const c=JSON.parse(fs.readFileSync(confFile,"utf8"));
 const u=new URL(c.url);if(u.protocol!=="https:"||!u.hostname.endsWith(".workers.dev"))throw Error("OTA_UNSAFE_COORDINATOR");
 return u.origin;
}
export async function request(action,payload={}){
 if(!platform)throw Error("OTA_UNSUPPORTED_PLATFORM");
 const method=action==="status"?"GET":"POST";
 const pathname="/"+action;
 const body=method==="GET"?"":JSON.stringify(payload);
 const time=String(Date.now()),nonce=randomUUID();
 const digest=createHash("sha256").update(body).digest("hex");
 const message=[method,pathname,time,nonce,digest].join("\n");
 const signature=sign(null,Buffer.from(message),fs.readFileSync(keyFile,"utf8")).toString("base64");
 const res=await fetch(baseUrl()+pathname,{method,headers:{
  "x-owl-device":platform,"x-owl-time":time,"x-owl-nonce":nonce,"x-owl-signature":signature,
  ...(method==="POST"?{"content-type":"application/json"}:{})
 },...(method==="POST"?{body}:{}),signal:AbortSignal.timeout(10000)});
 let data;try{data=await res.json()}catch{throw Error("OTA_COORDINATOR_BAD_RESPONSE")}
 if(!res.ok||data?.ok===false||data?.error)throw Error("OTA_COORDINATOR_"+String(data?.error??res.status));
 return data;
}
export async function heartbeat(sha,healthy,updating=false){
 if(!/^[a-f0-9]{40}$/.test(sha))throw Error("OTA_BAD_SHA");
 return request("heartbeat",{sha,healthy:Boolean(healthy),updating:Boolean(updating)});
}
export async function acquire(target){return request("acquire",{target})}
export async function release(token){return request("release",{token})}
export async function peerState(){
 const result=await request("status");
 return result.peers?.[platform==="mac"?"windows":"mac"]??null;
}
