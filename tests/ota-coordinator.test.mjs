import test from "node:test";
import assert from "node:assert/strict";
import {createHash,generateKeyPairSync,randomUUID,sign,webcrypto} from "node:crypto";
import worker,{UpgradeGate} from "../workers/owl-ota-coordinator/src/index.mjs";
if(!globalThis.crypto)globalThis.crypto=webcrypto;
function keys(){
 const pair=generateKeyPairSync("ed25519");
 return {privateKey:pair.privateKey,publicKey:pair.publicKey.export({format:"pem",type:"spki"})};
}
const k={mac:keys(),windows:keys()};
let stored=null;
const storage={transaction:async fn=>fn({
 get:async()=>stored?structuredClone(stored):null,
 put:async(_name,value)=>{stored=structuredClone(value)}
})};
const doInstance=new UpgradeGate({storage},{});
const env={DEVICE_PUBLIC_KEYS_JSON:JSON.stringify({mac:k.mac.publicKey,windows:k.windows.publicKey}),
 UPGRADE_GATE:{idFromName:name=>name,get:()=>({fetch:(url,opts)=>doInstance.fetch(new Request(url,opts))})}};
function signed(device,action,payload={}){
 const method=action==="status"?"GET":"POST",body=method==="GET"?"":JSON.stringify(payload);
 const time=String(Date.now()),nonce=randomUUID(),pathname="/"+action;
 const digest=createHash("sha256").update(body).digest("hex");
 const msg=[method,pathname,time,nonce,digest].join("\n");
 const signature=sign(null,Buffer.from(msg),k[device].privateKey).toString("base64");
 return new Request("https://coord.example"+pathname,{method,
  headers:{"x-owl-device":device,"x-owl-time":time,"x-owl-nonce":nonce,"x-owl-signature":signature},
  ...(body?{body}:{})});
}
const SHA="a".repeat(40),SHA2="b".repeat(40);
test("coordinator rejects unsigned, replays and serializes two devices",async()=>{
 assert.equal((await worker.fetch(new Request("https://coord.example/acquire",{method:"POST"}),env)).status,401);
 const hb=()=>({sha:SHA,healthy:true,updating:false});
 const a=await worker.fetch(signed("mac","heartbeat",hb()),env);assert.equal(a.status,200);
 const failed=await worker.fetch(signed("mac","acquire",{target:SHA2}),env);
 assert.equal(failed.status,409);assert.equal((await failed.json()).error,"peer-unhealthy-or-stale");
 const b=await worker.fetch(signed("windows","heartbeat",hb()),env);assert.equal(b.status,200);
 const req=signed("mac","acquire",{target:SHA2});
 const got=await worker.fetch(req,env);assert.equal(got.status,200);
 const {token}=await got.json();assert.ok(token);
 assert.equal((await worker.fetch(req,env)).status,409);
 const denied=await worker.fetch(signed("windows","acquire",{target:SHA2}),env);assert.equal(denied.status,409);
 assert.equal((await worker.fetch(signed("mac","release",{token}),env)).status,200);
 assert.equal((await worker.fetch(signed("windows","acquire",{target:SHA2}),env)).status,200);
});
test("coordinator denies signature with tampered body",async()=>{
 const original=signed("windows","heartbeat",{sha:SHA,healthy:true,updating:false});
 const headers=new Headers(original.headers);
 const bad=new Request(original.url,{method:"POST",headers,body:JSON.stringify({sha:SHA,healthy:false,updating:false})});
 assert.equal((await worker.fetch(bad,env)).status,401);
});
