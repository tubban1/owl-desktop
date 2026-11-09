// A short-lived MCP admission fence for the last stage of an OTA handoff.
// This deliberately cannot guarantee Runtime-wide atomic checkpoint/drain:
// direct Runtime users and external side effects have independent authorities.
import {randomUUID} from "node:crypto";

export function createOtaAdmissionFence({now=()=>Date.now(),maxTtlMs=45_000}={}) {
  let fence=null;
  function active() {
    if(fence && now()>=fence.expiresAt) fence=null;
    return fence;
  }
  return {
    isBlockingTools() {return active()!==null;},
    snapshot() {
      const x=active();
      return x?{armed:true,expiresAt:new Date(x.expiresAt).toISOString()}:{armed:false};
    },
    arm({ttlMs=30_000}={}) {
      const ttl=Number(ttlMs);
      if(!Number.isSafeInteger(ttl)||ttl<1_000||ttl>maxTtlMs)
        throw new Error("OTA_FENCE_TTL_INVALID");
      if(active()) throw new Error("OTA_FENCE_ALREADY_ARMED");
      const nonce=randomUUID();
      fence={nonce,expiresAt:now()+ttl};
      return {nonce,...this.snapshot()};
    },
    release(nonce) {
      const x=active();
      if(!x)return false;
      if(typeof nonce!=="string"||nonce!==x.nonce)return false;
      fence=null;
      return true;
    },
  };
}
