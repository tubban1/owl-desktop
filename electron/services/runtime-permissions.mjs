import fs from "node:fs";

export const RUNTIME_PERMISSION_DEFINITIONS=Object.freeze({
 gitPush:{env:"ALLOW_GIT_PUSH",label:"Git Push",actions:["git.push"]},
 shell:{env:"ALLOW_SHELL",label:"Shell commands",actions:["shell.exec","shell.start","shell.input","shell.kill"]},
 delete:{env:"ALLOW_DELETE",label:"Delete files",actions:["fs.delete"]},
 rollback:{env:"ALLOW_ROLLBACK",label:"Rollback transactions",actions:["tx.rollback"]},
});
export const EXACT_APPROVAL_ACTIONS=Object.freeze([
 "fs.delete","tx.rollback","shell.exec","shell.start","shell.input","shell.kill"]);
// Migration only: resolve legacy inherit from actual Runtime flags, never expose it.
export function normalizeRuntimePermissionModes(value,legacyEnv=new Map()){
 const raw=value&&typeof value==="object"&&!Array.isArray(value)?value:{};
 // Older Runtime defaults to reviewing fs.delete and tx.rollback if the
 // actions variable is absent/empty. Preserve that stricter effective policy.
 const approved=new Set((legacyEnv.get("OWL_APPROVAL_ACTIONS")||
  "fs.delete,tx.rollback").split(",").map(x=>x.trim()));
 return Object.fromEntries(Object.entries(RUNTIME_PERMISSION_DEFINITIONS).map(([key,spec])=>{
  if(["enabled","blocked","review"].includes(raw[key]))return [key,raw[key]];
  const flag=legacyEnv.get(spec.env);
  const active=flag===undefined?key==="gitPush":flag==="true";
  const ask=active&&legacyEnv.get("OWL_APPROVAL_MODE")==="enforce"&&
   spec.actions.every(action=>approved.has(action));
  return [key,ask?"review":active?"enabled":"blocked"];
 }));
}
export function runtimePermissionChangeCopy(mode){
 const choices={
  enabled:{button:"打开 · On",
   message:"Turn on this capability without approval for every action?",
   detail:"This allows the capability after the managed Runtime applies the setting. Other device, folder and workspace restrictions still apply. No pending action is approved by saving."},
  blocked:{button:"关闭 · Off",
   message:"Turn off this capability in the managed Runtime?",
   detail:"The connected Runtime must apply this setting. Blocking does not authorize any operation."},
  review:{button:"询问 · Ask each action",
   message:"Require your explicit approval for each action of this capability?",
   detail:"Every operation will require an exact signed Runtime approval before execution. The connected Runtime must support and activate Review. Saving is not an action approval."}
 };
 if(!Object.hasOwn(choices,mode))throw Error("INVALID_RUNTIME_PERMISSION_CHANGE");
 return choices[mode];
}
export function validateRuntimePermissionChange(key,mode){
 if(!Object.hasOwn(RUNTIME_PERMISSION_DEFINITIONS,key)||
  !["blocked","review","enabled"].includes(mode))
  throw new Error("INVALID_RUNTIME_PERMISSION_CHANGE");
 return {key,mode};
}
export function assertSafePermissionCombination(modes){
 // Arbitrary shell scripts can delete even when fs.delete is reviewed.
 // Keep the UI's three-state semantics honest; never silently downgrade Ask.
 if(modes?.delete==="review"&&modes?.shell==="enabled")
  throw new Error("DELETE_ASK_REQUIRES_SHELL_ASK_OR_OFF: Set Shell to Ask or Off before enabling Delete Ask.");
 return modes;
}
export function applyRuntimePermissionModes(env,settings,{
 humanApprovalPublicKey=null,runtimeSignedApprovalSupported=false,
}={}){
 const modes=assertSafePermissionCombination(normalizeRuntimePermissionModes(settings?.runtimePermissionModes,env));
 // On = allow, Off = deny, Ask = signed action approval for every capability.
 for(const [key,spec] of Object.entries(RUNTIME_PERMISSION_DEFINITIONS)){
  // Review leaves the underlying sensitive capability OFF. Only a signed,
  // exact, one-use scoped grant can temporarily pass the Runtime flag.
  // git.push uses the exact approval policy instead of scoped capability.
  env.set(spec.env,modes[key]==="enabled"||
    (key==="gitPush"&&modes[key]==="review")?"true":"false");
 }
 if(Object.values(modes).includes("review")){
  if(!runtimeSignedApprovalSupported)throw new Error("RUNTIME_M6_SIGNED_APPROVAL_CAPABILITY_UNAVAILABLE");
  if(!humanApprovalPublicKey)throw new Error("HUMAN_SIGNER_REQUIRED_FOR_REVIEW_CAPABILITY");
  env.set("OWL_HUMAN_APPROVAL_PUBLIC_KEY_B64",humanApprovalPublicKey);
  env.set("OWL_HUMAN_APPROVAL_ENFORCE","1");
  env.set("OWL_SCOPED_CAPABILITIES","1");
  const allowed=Object.entries(RUNTIME_PERMISSION_DEFINITIONS)
    .filter(([key])=>key!=="gitPush"&&modes[key]==="review")
    .flatMap(([,spec])=>spec.actions);
  env.set("OWL_SCOPED_ACTION_ALLOWLIST",[...new Set(allowed)].join(","));
 }else{
  env.set("OWL_SCOPED_CAPABILITIES","0");
  env.set("OWL_SCOPED_ACTION_ALLOWLIST","");
  env.set("OWL_HUMAN_APPROVAL_ENFORCE","0");
 }
 const controlled=new Set(Object.values(RUNTIME_PERMISSION_DEFINITIONS).flatMap(spec=>spec.actions));
 const extras=(env.get("OWL_APPROVAL_ACTIONS")||"").split(",").map(x=>x.trim())
  .filter(x=>x&&!controlled.has(x)&&x!=="__none__");
 const selected=Object.entries(RUNTIME_PERMISSION_DEFINITIONS)
  .filter(([key])=>modes[key]==="review").flatMap(([,spec])=>spec.actions);
 // Nonempty sentinel disables legacy default review for explicitly On actions.
 env.set("OWL_APPROVAL_ACTIONS",[...new Set([...extras,...selected])].join(",")||"__none__");
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
export function installedRuntimeSupportsSignedReview(componentFile){
 if(!componentFile)return null;
 try{
  const installed=JSON.parse(fs.readFileSync(componentFile,"utf8"));
  return installed?.capabilities?.humanApprovalSignatureV1===true&&
    installed?.capabilities?.scopedCapabilityV1===true;
 }catch{return false;}
}
export function runtimePermissionProjection(settings,envFile,{
 packaged=false,componentFile=null,envOverride=null,reviewSupportOverride=null,
 signedKeyConfiguredOverride=null,liveVerified=false
}={}){
 const installedReviewSupport=reviewSupportOverride===null?
  installedRuntimeSupportsSignedReview(componentFile):reviewSupportOverride;
 const env=envOverride instanceof Map?envOverride:readRuntimeEnvFlags(envFile);
 const modes=normalizeRuntimePermissionModes(settings?.runtimePermissionModes,env);
 const activeActionApprovals=new Set((env.get("OWL_APPROVAL_ACTIONS")||"").split(",").map(x=>x.trim()).filter(Boolean));
 const scopedActions=new Set((env.get("OWL_SCOPED_ACTION_ALLOWLIST")||"").split(",").map(x=>x.trim()).filter(Boolean));
 const policyEnforced=env.get("OWL_APPROVAL_MODE")==="enforce";
 const signedReviewConfigured=policyEnforced&&env.get("OWL_HUMAN_APPROVAL_ENFORCE")==="1"&&
  env.get("OWL_SCOPED_CAPABILITIES")==="1"&&
  (signedKeyConfiguredOverride===true||Boolean(env.get("OWL_HUMAN_APPROVAL_PUBLIC_KEY_B64")));
 const items=Object.entries(RUNTIME_PERMISSION_DEFINITIONS).map(([key,spec])=>{
  const raw=env.get(spec.env),mode=modes[key],configured=raw===undefined&&key==="gitPush"?true:raw==="true";
  const reviewConfigured=mode==="review"&&installedReviewSupport!==false&&signedReviewConfigured&&
   spec.actions.every(action=>activeActionApprovals.has(action))&&
   (key==="gitPush"||spec.actions.every(action=>scopedActions.has(action)));
  const flagMatches=configured===(mode==="enabled"||(key==="gitPush"&&mode==="review"));
  const actionPolicyMatches=mode==="review"?
   spec.actions.every(action=>activeActionApprovals.has(action)):
   spec.actions.every(action=>!activeActionApprovals.has(action)&&!scopedActions.has(action));
  return {key,label:spec.label,envName:spec.env,mode,configured,
   configuredSource:raw===undefined?"Runtime default":"Desktop runtime.env",
   reviewConfigured,
   pendingApply:!flagMatches||!actionPolicyMatches||(mode==="review"&&!reviewConfigured),
   requiresExactRuntimeApproval:mode==="review",
   liveEffective:liveVerified?"verified":"unverified"};
 });
 const approvalPolicyPending=!policyEnforced||items.some(item=>item.pendingApply);
 const restartRequired=approvalPolicyPending||items.some(item=>item.pendingApply);
 return {version:1,packaged,items,restartRequired,installedRuntimeSupportsReview:installedReviewSupport,
  approvalPolicyPending,liveRuntimeEffective:liveVerified?"verified":"unverified",approvalModeConfigured:policyEnforced,
  message:installedReviewSupport===false&&Object.values(modes).includes("review")?
   "REVIEW UNAVAILABLE: installed OWL Runtime does not advertise signed/scoped one-action approval support. Upgrade the managed Runtime before enabling Review; do not set ALLOW_DELETE=true as a workaround.":restartRequired?
   "Saved settings are NOT active. Review requires the selected Runtime to load the signed, scoped policy; apply to the managed Runtime and verify the live connection before performing a protected action.":
   "Saved runtime.env matches requested policy. Connected process remains unverified until the Runtime is restarted and its effective policy is checked."};
}
