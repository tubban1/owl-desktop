// Official GoDaddy Domains v3 API client, constrained to one domain and
// two read/write operations. Called only by OWL Desktop's scoped provider.
import {randomUUID} from "node:crypto";
const endpoint="https://api.godaddy.com/v3/domains/domain-names/tbn.cc";
export function createGoDaddyRequester({fetchImpl=fetch}={}){
  return async function request(action,pat,nameservers){
    if(!["inspect","switch_ns"].includes(action))throw Error("GODADDY_ACTION_NOT_ALLOWED");
    if(typeof pat!=="string"||!/^gd_pat_[A-Za-z0-9_.-]{10,}$/.test(pat.trim()))
      throw Error("GODADDY_PAT_MISSING");
    const modifying=action==="switch_ns";
    const route=modifying?endpoint+"/nameservers":endpoint;
    const response=await fetchImpl(route,{
      method:modifying?"PUT":"GET",
      headers:{
        Authorization:"Bearer "+pat.trim(),
        Accept:"application/json",
        ...(modifying?{"Content-Type":"application/json","Idempotency-Key":randomUUID()}:{}),
      },
      ...(modifying?{body:JSON.stringify(nameservers)}:{}),
      redirect:"error",
      signal:AbortSignal.timeout(16000),
    }).catch(()=>{throw Error("GODADDY_NETWORK_ERROR")});
    if(!response.ok)throw Error("GODADDY_HTTP_"+response.status);
    if(modifying)return {accepted:response.status===202,status:response.status};
    const data=await response.json().catch(()=>{throw Error("GODADDY_BAD_REPLY")});
    const ns=data.nameservers??data.nameServers??data.name_servers;
    if(!Array.isArray(ns)||ns.some(x=>typeof x!=="string"))
      throw Error("GODADDY_BAD_NAMESERVERS");
    return {nameservers:ns,status:typeof data.status==="string"?data.status:null};
  }
}
