// Cloudflare Durable Object coordinates macOS/Windows OWL DEV release promotion.
// All operations require a device-owned Ed25519 signature; server stores public keys only.
const json=(obj,status=200)=>new Response(JSON.stringify(obj),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
const validDevice=x=>x==="mac"||x==="windows";
const sha=x=>typeof x==="string"&&/^[0-9a-f]{40}$/.test(x);
const keyFromPem=s=>Uint8Array.from(atob(s.replace(/-----[^-]+-----|\s+/g,"")),c=>c.charCodeAt(0));
async function authorized(req,env){
 const device=req.headers.get("x-owl-device");
 const time=Number(req.headers.get("x-owl-time"));
 const nonce=req.headers.get("x-owl-nonce");
 const signature=req.headers.get("x-owl-signature");
 if(!validDevice(device)||!Number.isSafeInteger(time)||Math.abs(Date.now()-time)>120000||
   !nonce||!/^[a-f0-9-]{20,60}$/.test(nonce)||!signature)return null;
 let keys;try{keys=JSON.parse(env.DEVICE_PUBLIC_KEYS_JSON||"{}")}catch{return null}
 if(!keys[device])return null;
 const body=req.method==="GET"?"":await req.clone().text();
 if(body.length>3000)return null;
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(body))),b=>b.toString(16).padStart(2,"0")).join("");
 const message=[req.method,new URL(req.url).pathname,time,nonce,digest].join("\n");
 try{
  const key=await crypto.subtle.importKey("spki",keyFromPem(keys[device]),{name:"Ed25519"},false,["verify"]);
  if(!await crypto.subtle.verify({name:"Ed25519"},key,Uint8Array.from(atob(signature),c=>c.charCodeAt(0)),new TextEncoder().encode(message)))return null;
 }catch{return null}
 let payload={};if(body){try{payload=JSON.parse(body)}catch{return null}}
 return {device,nonce,time,payload};
}
export class UpgradeGate {
 constructor(ctx,env){this.ctx=ctx;this.env=env}
 async fetch(req){
  const {device,nonce,time,payload,action}=await req.json();
  if(!validDevice(device))return json({error:"device"},400);
  const now=Date.now();
  return this.ctx.storage.transaction(async tx=>{
   const s=await tx.get("state")||{peers:{},lease:null,nonces:{}};
   s.nonces[device]=(s.nonces[device]||[]).filter(n=>now-n.time<150000);
   if(s.nonces[device].some(n=>n.value===nonce))return json({error:"replayed"},409);
   s.nonces[device].push({value:nonce,time});
   if(s.lease?.expiresAt<=now)s.lease=null;
   const peer=device==="mac"?"windows":"mac";
   let response,status=200;
   if(action==="heartbeat"){
    if(!sha(payload.sha)||typeof payload.healthy!=="boolean"||typeof payload.updating!=="boolean"){
     response={error:"heartbeat-invalid"};status=400
    }else{
     s.peers[device]={sha:payload.sha,healthy:payload.healthy,updating:payload.updating,at:now};
     response={ok:true,peer:s.peers[peer]||null,lease:s.lease?{device:s.lease.device,expiresAt:s.lease.expiresAt}:null};
    }
   }else if(action==="status"){
    response={ok:true,peers:s.peers,lease:s.lease?{device:s.lease.device,expiresAt:s.lease.expiresAt}:null};
   }else if(action==="acquire"){
    const p=s.peers[peer];
    if(!sha(payload.target)||!s.peers[device]?.healthy||now-s.peers[device].at>90000){response={error:"local-not-ready"};status=409}
    else if(!p?.healthy||p.updating||now-p.at>90000){response={error:"peer-unhealthy-or-stale"};status=409}
    else if(s.lease){response={error:"rollout-in-progress",device:s.lease.device};status=409}
    else {
     s.lease={device,target:payload.target,token:crypto.randomUUID(),expiresAt:now+600000};
     response={ok:true,token:s.lease.token,expiresAt:s.lease.expiresAt};
    }
   }else if(action==="release"){
    if(!s.lease||s.lease.device!==device||s.lease.token!==payload.token){
     response={error:"lease-mismatch"};status=409
    }else{s.lease=null;response={ok:true}}
   }else{response={error:"unsupported"};status=400}
   await tx.put("state",s);
   return json(response,status);
  });
 }
}
export default {
 async fetch(req,env){
  if(!["GET","POST"].includes(req.method))return json({error:"method"},405);
  const pathname=new URL(req.url).pathname;
  if(pathname==="/health")return json({ok:true,service:"owl-ota-coordinator"});
  if(!["/heartbeat","/status","/acquire","/release"].includes(pathname))return json({error:"not-found"},404);
  const verified=await authorized(req,env);
  if(!verified)return json({error:"unauthorized"},401);
  const stub=env.UPGRADE_GATE.get(env.UPGRADE_GATE.idFromName("owl-desktop-dual-device-v1"));
  return stub.fetch("https://do.internal/",{method:"POST",body:JSON.stringify({...verified,action:pathname.slice(1)})});
 }
};