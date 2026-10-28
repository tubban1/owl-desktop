import {createHash} from "node:crypto";
import {describeTool,suggestToolProfiles,TOOL_TAXONOMY_VERSION} from "../shared/tool-taxonomy.mjs";

export const MCP_CATALOG_CONTRACT_VERSION=1;
export function toolRegistrySnapshot(server,{goal="",includeTools=false}={}){
 // Read the SDK's actual registered-tool set; do not build an independent, drifting second list.
 const entries=Object.entries(server?._registeredTools??{}).filter(([,v])=>v.enabled!==false).sort(([a],[b])=>a.localeCompare(b));
 if(!entries.length)throw Error("MCP_CATALOG_REGISTRY_EMPTY");
 const metadata=entries.map(([name,v])=>describeTool(name,v));
 const names=entries.map(([id])=>id);
 const canonical=entries.map(([id,v])=>({
   id,title:v.title??null,description:v.description??null,
   annotations:v.annotations??null
 }));
 const hash=(v)=>createHash("sha256").update(JSON.stringify(v)).digest("hex");
 const profiles={}; const categories={};const coverage={runtimePrimitive:0,adapterNative:0,other:0};
 for(const a of metadata){
  profiles[a.profile]=(profiles[a.profile]??0)+1;
  categories[a.category]=(categories[a.category]??0)+1;
  if(a.executionPath==="runtime-primitive")coverage.runtimePrimitive++;
  else if(a.executionPath==="adapter-native")coverage.adapterNative++;
  else coverage.other++;
 }
 const recommendedProfiles=suggestToolProfiles(goal);
 return {
   version:MCP_CATALOG_CONTRACT_VERSION,taxonomyVersion:TOOL_TAXONOMY_VERSION,
   count:names.length,
   namesSha256:hash(names),presentationSha256:hash(canonical),
   contractSchemaSha256:null, // Full JSON Schemas are independently verified by tools/list in CI, never fabricate this value.
   profileCounts:profiles,categoryCounts:categories,executionCoverage:coverage,
   suggestedProfiles:recommendedProfiles,
   note:"MCP presentation registry; not a Runtime authorization or capability grant. Client-published tool subset can be stale. Full tool schemas verified by independent tools/list fingerprint in CI.",
   ...(includeTools?{tools:metadata.filter(x=>recommendedProfiles.includes(x.profile)||(x.profile==="legacy"&&recommendedProfiles.includes(({Core:"core",Git:"development",Files:"development",Process:"development",Transactions:"development",Browser:"browser",Communication:"communication",Devices:"administration",Administration:"administration"})[x.category])))}:{}),
 };
}
