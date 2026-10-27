import {describe,it,expect,vi} from "vitest";
import {createScopedProviderOperations,assertGoDaddyScope,
  GODADDY_CLOUDFLARE_NS,GODADDY_ORIGINAL_NS} from "../electron/services/provider-operations.mjs";
import {createGoDaddyRequester} from "../electron/services/godaddy-domains.mjs";
describe("Vault-backed provider operations",()=>{
 const inspectInput={domain:"tbn.cc",operation:"inspect"};
 const cutover={domain:"tbn.cc",operation:"switch_ns",nameservers:GODADDY_CLOUDFLARE_NS,
   expected_current:GODADDY_ORIGINAL_NS};
 it("rejects other domains and arbitrary nameservers",()=>{
   expect(()=>assertGoDaddyScope({...cutover,domain:"fde.fan"})).toThrow("PROVIDER_DOMAIN_NOT_ALLOWED");
   expect(()=>assertGoDaddyScope({...cutover,nameservers:["evil.example","skip.ns.cloudflare.com"]}))
     .toThrow("PROVIDER_OPERATION_NOT_ALLOWED");
   expect(()=>assertGoDaddyScope({...cutover,expected_current:["one.example","two.example"]}))
     .toThrow("PROVIDER_OPERATION_NOT_ALLOWED");
 });
 it("returns only domain metadata, never the credential",async()=>{
   const value="test-sensitive-placeholder";
   const request=vi.fn(async()=>({nameservers:GODADDY_ORIGINAL_NS,status:"ACTIVE",token:value}));
   const p=createScopedProviderOperations({readCredential:()=>value,request});
   const out=await p.inspect(inspectInput);
   expect(out.matchesOriginal).toBe(true);
   expect(JSON.stringify(out)).not.toContain(value);
   expect(request.mock.calls[0][1]).toBe(value);
 });
 it("rejects altered DNS prior to changing nameservers",async()=>{
   const request=vi.fn(async()=>({nameservers:["other.example","another.example"]}));
   const p=createScopedProviderOperations({readCredential:()=> "fake",request});
   await expect(p.switchNameservers(cutover)).rejects.toThrow("PROVIDER_NAMESERVERS_CHANGED");
   expect(request).toHaveBeenCalledTimes(1);
 });
 it("changes only approved pair once and fails closed on replay",async()=>{
   const request=vi.fn(async(op)=>op==="inspect"?
     {nameservers:GODADDY_ORIGINAL_NS}:{accepted:true,status:202});
   const p=createScopedProviderOperations({readCredential:()=> "fake",request});
   expect(await p.switchNameservers(cutover)).toMatchObject({state:"accepted",domain:"tbn.cc"});
   expect(request.mock.calls[1][2]).toEqual(GODADDY_CLOUDFLARE_NS);
   await expect(p.switchNameservers(cutover)).rejects.toThrow("PROVIDER_UPDATE_ALREADY_ATTEMPTED");
 });
 it("does not produce credential in API failures",async()=>{
   const fetchImpl=vi.fn(async()=>({ok:false,status:403}));
   const request=createGoDaddyRequester({fetchImpl});
   await expect(request("inspect","gd_pat_abc123456789abcdef"))
     .rejects.toThrow("GODADDY_HTTP_403");
   const [url,params]=fetchImpl.mock.calls[0];
   expect(url).toBe("https://api.godaddy.com/v3/domains/domain-names/tbn.cc");
   expect(params.method).toBe("GET");
   expect(JSON.stringify({url,error:"GODADDY_HTTP_403"})).not.toContain("gd_pat_");
 });
});
