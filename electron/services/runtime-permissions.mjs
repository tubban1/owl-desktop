import fs from "node:fs";

export const RUNTIME_PERMISSION_DEFINITIONS=Object.freeze({
 gitPush:{env:"ALLOW_GIT_PUSH",label:"Git Push",actions:["git.push"]},
 shell:{env:"ALLOW_SHELL",label:"Shell commands",actions:["shell.exec","shell.start","shell.input","shell.kill"]},
 delete:{env:"ALLOW_DELETE",label:"Delete files",actions:["fs.delete"]},
 rollback:{env:"ALLOW_ROLLBACK",label:"Rollback transactions",actions:["tx.rollback"]},
});
export const EXACT_APPROVAL_ACTIONS=Object.freeze([
 "fs.delete","git.push","tx.rollback","shell.exec","shell.start","shell.input","shell.kill"]);
export function normalizeRuntimePermissionModes(value){
 const raw=value&&typeof value==="object"&&!Array.isArray(value)?value:{};
 return Object.fromEntries(Object.keys(RUNTIME_PERMISSION_DEFINITIONS).map(key=>
  [key,["inherit","blocked","review"].includes(raw[key])?raw[key]:"inherit"]));
}
export function validateRuntimePermissionChange(key,mode){
 if(!Object.hasOwn(RUNTIME_PERMISSION_DEFINITIONS,key)||!["blocked","review"].includes(mode))
  throw new Error("INVALID_RUNTIME_PERMISSION_CHANGE");
 return {key,mode};
}
export function applyRuntimePermissionModes(env,settings){
 const modes=normalizeRuntimePermissionModes(settings?.runtimePermissionModes);
 for(const [key,spec] of Object.entries(RUNTIME_PERMISSION_DEFINITIONS)){
  if(modes[key]==="inherit")continue;
  env.set(spec.env,modes[key]==="review"?"true":"false");
 }
 const previous=(env.get("OWL_APPROVAL_ACTIONS")||"").split(",").map(s=>s.trim()).filter(Boolean);
 env.set("OWL_APPROVAL_ACTIONS",[...new Set([...previous,...EXACT_APPROVAL_ACTIONS])].join(","));
 env.set("OWL_APPROVAL_MODE","enforce");
 return modes;
}
export function readRuntimeEnvFlags(file){
 let source="";
 try{source=fs.readFileSync(file,"utf8");}
 catch(e){if(e.code!=="ENOENT")throw e;}
 const env=new Map();
 for(const line of source.split(/\r?\n/)){
  const m=/^\s*(?:export\s+)?([A-Z_][A-Z_0-9]*)\s*=(.*)$/.exec(line);
  if(m)env.set(m[1],m[2].trim().replace(/^['"]|['"]$/g,""));
 }
 return env;
}
export function runtimePermissionProjection(settings,envFile,{packaged=false}={}){
 const env=readRuntimeEnvFlags(envFile);
 const modes=normalizeRuntimePermissionModes(settings?.runtimePermissionModes);
 const items=Object.entries(RUNTIME_PERMISSION_DEFINITIONS).map(([key,spec])=>{
  const raw=env.get(spec.env),mode=modes[key],configured=raw==="true";
  return {key,label:spec.label,envName:spec.env,mode,configured,
   configuredSource:raw===undefined?"Runtime default":"Desktop runtime.env",
   pendingApply:mode!=="inherit"&&(mode==="review")!==configured,
   requiresExactRuntimeApproval:true,liveEffective:"unverified"};
 });
 const activeActionApprovals=new Set((env.get("OWL_APPROVAL_ACTIONS")||"").split(",").map(x=>x.trim()).filter(Boolean));
 const approvalPolicyPending=env.get("OWL_APPROVAL_MODE")!=="enforce" ||
  EXACT_APPROVAL_ACTIONS.some(action=>!activeActionApprovals.has(action));
 return {version:1,packaged,items,restartRequired:approvalPolicyPending || items.some(x=>x.pendingApply),
  approvalPolicyPending,liveRuntimeEffective:"unverified",approvalModeConfigured:env.get("OWL_APPROVAL_MODE")==="enforce",
  message:"Saved policies are not live until the owning Runtime restarts. Every consequential action still needs Runtime approval."};
}
