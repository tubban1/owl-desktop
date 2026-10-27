// Narrow provider operations contract. Caller never chooses a credential, URL,
// domain outside the one approved for this migration, or arbitrary HTTP method.
export const GODADDY_DOMAIN = "tbn.cc";
export const GODADDY_ORIGINAL_NS = Object.freeze(["ns29.domaincontrol.com","ns30.domaincontrol.com"]);
export const GODADDY_CLOUDFLARE_NS = Object.freeze(["nova.ns.cloudflare.com","skip.ns.cloudflare.com"]);
export const nsEqual = (a,b) => Array.isArray(a) && a.length===b.length &&
  a.map(x=>String(x).toLowerCase().replace(/\\.$/,"")).sort().join("|")===
  b.map(x=>String(x).toLowerCase().replace(/\\.$/,"")).sort().join("|");
export function assertGoDaddyScope(input) {
  if(input?.domain!==GODADDY_DOMAIN)throw Error("PROVIDER_DOMAIN_NOT_ALLOWED");
  if(input?.operation==="inspect")return {domain:GODADDY_DOMAIN,operation:"inspect"};
  if(input?.operation==="switch_ns" &&
    nsEqual(input?.nameservers,GODADDY_CLOUDFLARE_NS) &&
    nsEqual(input?.expected_current,GODADDY_ORIGINAL_NS))
    return {domain:GODADDY_DOMAIN,operation:"switch_ns"};
  throw Error("PROVIDER_OPERATION_NOT_ALLOWED");
}

// An explicit operation is executed only within the Desktop process, where
// the user already placed the credential in the OS-protected Desktop Vault.
export function createScopedProviderOperations({readCredential, request, audit=()=>{}}) {
  if(typeof readCredential!=="function"||typeof request!=="function")
    throw Error("PROVIDER_NOT_CONFIGURED");
  let switchAttempted=false;
  const inspect=async(input={domain:GODADDY_DOMAIN,operation:"inspect"})=>{
    assertGoDaddyScope({...input,operation:"inspect"});
    const result=await request("inspect",readCredential());
    if(!result||!Array.isArray(result.nameservers))throw Error("PROVIDER_INVALID_REPLY");
    return {
      domain:GODADDY_DOMAIN,
      nameservers:result.nameservers,
      status:result.status??null,
      matchesCloudflare:nsEqual(result.nameservers,GODADDY_CLOUDFLARE_NS),
      matchesOriginal:nsEqual(result.nameservers,GODADDY_ORIGINAL_NS),
    };
  };
  const switchNameservers=async(input)=>{
    assertGoDaddyScope({...input,operation:"switch_ns"});
    if(switchAttempted)throw Error("PROVIDER_UPDATE_ALREADY_ATTEMPTED");
    const current=await inspect();
    if(current.matchesCloudflare)return {state:"already_set",domain:GODADDY_DOMAIN};
    if(!current.matchesOriginal)throw Error("PROVIDER_NAMESERVERS_CHANGED");
    switchAttempted=true;
    try {
      const result=await request("switch_ns",readCredential(),GODADDY_CLOUDFLARE_NS);
      audit({action:"switch_ns",domain:GODADDY_DOMAIN,status:result?.status??null});
      return {state:result?.accepted===true?"accepted":"unconfirmed",domain:GODADDY_DOMAIN};
    } catch {
      audit({action:"switch_ns",domain:GODADDY_DOMAIN,status:"failed"});
      throw Error("PROVIDER_UPDATE_FAILED");
    }
  };
  return {inspect,switchNameservers};
}
