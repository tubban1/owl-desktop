import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {fileURLToPath,pathToFileURL} from "node:url";
import http from "node:http";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StreamableHTTPClientTransport} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {versionSnapshot,verifyStagedDirectory} from "./version-sync.mjs";

const SHA=/^[0-9a-f]{40}$/;
export const DEFAULT_STATE_ROOT=path.join(os.homedir(),".owl-lab","version-sync","desktop");
export function assertStagePath(stageRoot,sha,stateRoot=DEFAULT_STATE_ROOT){
 if(!SHA.test(sha))throw Object.assign(new Error("ACTIVATION_INVALID_SHA"),{code:"ACTIVATION_INVALID_SHA"});
 const expected=path.join(path.resolve(stateRoot),sha);
 if(path.resolve(stageRoot)!==expected)throw Object.assign(new Error("ACTIVATION_STAGE_OUTSIDE_VERSION_STORE"),{code:"ACTIVATION_STAGE_OUTSIDE_VERSION_STORE"});
 if(!fs.existsSync(expected)||!verifyStagedDirectory(expected,sha))throw Object.assign(new Error("ACTIVATION_STAGE_NOT_VERIFIED"),{code:"ACTIVATION_STAGE_NOT_VERIFIED"});
 return expected;
}
export function readCandidate(stageRoot,stateRoot=DEFAULT_STATE_ROOT){
 let last=null;
 try{last=JSON.parse(fs.readFileSync(path.join(stateRoot,"last-staged.json"),"utf8"));}catch{}
 const sha=last?.commit;
 if(!sha||!SHA.test(sha))return {sha:null,stage:null,receipt:last,verified:false};
 const stage=path.join(stateRoot,sha);
 let verified=false;
 try{assertStagePath(stage,sha,stateRoot);verified=true;}catch{}
 return {sha,stage,receipt:last,verified};
}
export function requiredReleaseArtifacts(stageRoot,platform=process.platform){
 const required = platform==="darwin"
  ? ["node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
    "vendor/owl-runtime/manifest.json","vendor/owl-tunnel"]
  : platform==="win32"
  ? ["node_modules/electron/dist/electron.exe","vendor/owl-runtime/manifest.json","vendor/owl-tunnel"]
  : ["vendor/owl-runtime/manifest.json","vendor/owl-tunnel"];
 return required.map(relative=>({relative,exists:fs.existsSync(path.join(stageRoot,relative))}));
}
export function assessActivation({candidate,shadow,ci,artifacts,guardian}){
 const reasons=[];
 if(!candidate?.verified)reasons.push("STAGE_NOT_VERIFIED");
 if(candidate?.verified&&(!candidate.receipt?.localSmokePassed||!candidate.receipt?.buildPassed))
  reasons.push("STAGE_RECEIPT_MISSING_GATES");
 if(!shadow?.passed)reasons.push("SHADOW_MCP_NOT_VERIFIED");
 if(ci?.status!=="success")reasons.push("GITHUB_MAIN_CI_NOT_VERIFIED");
 for(const item of artifacts??[])if(!item.exists)reasons.push("RELEASE_COMPONENT_MISSING:"+item.relative);
 if(!guardian?.independent||!guardian?.rollbackTested)reasons.push("INDEPENDENT_ROLLBACK_GUARDIAN_NOT_VERIFIED");
 return {stagedReady:Boolean(candidate?.verified),
  shadowReady:Boolean(shadow?.passed),activationAllowed:reasons.length===0,
  blockers:reasons,
  liveServiceChanged:false,
  phase:reasons.length?"preflight-blocked":"activation-eligible-but-not-executed"};
}
export async function githubMainCi(sha,{fetchImpl=fetch}={}){
 if(!SHA.test(String(sha)))return {status:"invalid-sha"};
 try{
  const url="https://api.github.com/repos/tubban1/owl-desktop/actions/runs?"+
    new URLSearchParams({head_sha:sha,branch:"main",event:"push",per_page:"10"});
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),9000);
  let response;
  try{response=await fetchImpl(url,{headers:{accept:"application/vnd.github+json","user-agent":"owl-version-preflight"},
    signal:controller.signal});}finally{clearTimeout(timer);}
  if(!response.ok)return {status:"unavailable"};
  const runs=(await response.json()).workflow_runs??[];
  const expected=runs.find(r=>r.head_sha===sha&&r.name==="OWL Desktop Main CI"&&r.head_branch==="main");
  return expected?.status==="completed"&&expected?.conclusion==="success"?
    {status:"success",runId:expected.id,headSha:sha}:
    {status:expected?.status==="completed"?"failed":"pending"};
 }catch{return {status:"unavailable"};}
}
/** Boot the candidate MCP via a local synthetic Runtime. No real tokens, ports or Desktop processes are touched. */
export async function probeShadowMcp(stageRoot,{timeoutMs=12000}={}){
 let runtime=null,mcp=null,client=null,transport=null;
 try{
  runtime=http.createServer(async(req,res)=>{
   const bytes=[];
   for await(const chunk of req)bytes.push(chunk);
   const body=JSON.parse(Buffer.concat(bytes).toString("utf8")||"{}");
   res.writeHead(200,{"content-type":"application/json"});
   res.end(JSON.stringify({ok:true,result:body.method==="info"?
    {apiVersion:"0.1",runtimeVersion:"shadow-fixture"}:{}}));
  });
  await new Promise((resolve,reject)=>{runtime.once("error",reject);runtime.listen(0,"127.0.0.1",resolve);});
  const url="http://127.0.0.1:"+runtime.address().port;
  const module=await import(pathToFileURL(path.join(stageRoot,"mcp","http-server.mjs")).href);
  mcp=await module.startOwlMcpHttpServer({port:0,runtimeBaseUrl:url});
  const health=await fetch(mcp.url.replace(/\/mcp$/,"/health"),{signal:AbortSignal.timeout(timeoutMs)});
  const data=await health.json();
  if(!health.ok||data.ok!==true||data.runtime?.runtimeVersion!=="shadow-fixture")
    throw Error("SHADOW_HEALTH_FAILED");
  client=new Client({name:"owl-activation-shadow",version:"1.0"});
  transport=new StreamableHTTPClientTransport(new URL(mcp.url));
  await client.connect(transport);
  const listed=await client.listTools();
  const names=new Set(listed.tools.map(t=>t.name));
  const required=["runtime_info","read_document","device_sync_status","list_directory"];
  const missing=required.filter(n=>!names.has(n));
  if(missing.length)throw Error("SHADOW_MCP_TOOLS_MISSING:"+missing.join(","));
  return {passed:true,toolsListed:names.size,requiredToolsVerified:required,transport:"isolated-loopback",liveProcessesTouched:false};
 }catch(e){return {passed:false,reason:String(e?.message??e).slice(0,180)};}
 finally{
  try{await transport?.close();}catch{}
  try{await mcp?.close();}catch{}
  try{await new Promise(resolve=>runtime?.close(resolve)??resolve());}catch{}
 }
}
