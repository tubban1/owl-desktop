import os from "node:os";
import dns from "node:dns/promises";

// The OS-only link check sends no traffic and can run on each local poll.
export function readLocalNetworkLink(interfaces=()=>os.networkInterfaces()){
  try{
    const entries=Object.values(interfaces()||{}).flatMap(x=>Array.isArray(x)?x:[]);
    if(!entries.length)return "unknown";
    return entries.some(x=>x&&!x.internal&&x.address&&
      ["IPv4","IPv6",4,6].includes(x.family))?"present":"missing";
  }catch{return "unknown";}
}
// Only during an active remote-connectivity incident, at most once per minute.
// Diagnostic request goes to independent Cloudflare endpoint; no tokens,
// interface names, IP addresses, body, or network identifiers are stored.
export async function probeLocalNetwork({
  interfaces=()=>os.networkInterfaces(),
  lookup=(name)=>dns.lookup(name),
  fetchImpl=fetch,
  now=()=>Date.now(),
  timeoutMs=2500
}={}){
  const at=new Date(now()).toISOString();
  const result={at,link:"unknown",dns:"skipped",internet:"skipped"};
  result.link=readLocalNetworkLink(interfaces);
  if(result.link==="missing")return result;
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  timer.unref?.();
  try{
    // DNS is separately reported, but reachability uses its own network stack.
    // Neither layer alone proves the customer's router or ISP is at fault.
    const dnsResult=await Promise.race([
      Promise.resolve().then(()=>lookup("www.cloudflare.com")).then(()=>true,()=>false),
      new Promise(resolve=>controller.signal.addEventListener("abort",()=>resolve(false),{once:true}))
    ]);
    result.dns=dnsResult?"ok":"failed";
    if(!dnsResult)return result;
    try{
      const response=await Promise.race([
        fetchImpl("https://www.cloudflare.com/cdn-cgi/trace",{
          method:"GET",redirect:"error",cache:"no-store",signal:controller.signal
        }),
        new Promise((_,reject)=>controller.signal.addEventListener("abort",()=>reject(new Error("PROBE_TIMEOUT")),{once:true}))
      ]);
      result.internet=response&&typeof response.status==="number"?"reachable":"unreachable";
      try{await response?.body?.cancel?.();}catch{}
    }catch{result.internet="unreachable";}
    return result;
  }finally{clearTimeout(timer);}
}
