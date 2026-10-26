import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

// Per-device, explicit local opt-in. Source code alone must never grant remote
// developers shell or filesystem access. The launcher inherits this setting
// from the Windows user's environment; packaged releases do not use this bridge.
export function windowsDevWorkspacePermissions(env=process.env){
  const enabled=env.OWL_WIN_DEV_WORKSPACE_ACCESS==="true";
  return {
    ALLOW_WRITE:enabled?"true":"false",
    // Raw MCP shell tools cannot enforce a "Delete=Ask" rule. Route shell
    // through OWL's signed, one-use Action approval/Scoped Capability path.
    ALLOW_SHELL:"false",
    ALLOW_GIT_PUSH:enabled?"true":"false",
    ALLOW_DELETE:"false",
    ALLOW_ROLLBACK:"false",
    ...(enabled ? {
      OWL_APPROVAL_MODE:"enforce",
      OWL_HUMAN_APPROVAL_ENFORCE:"1",
      OWL_SCOPED_CAPABILITIES:"1",
      OWL_SCOPED_ACTION_ALLOWLIST:"shell.exec,shell.start,shell.input,shell.kill,fs.delete,tx.rollback",
      OWL_APPROVAL_ACTIONS:"fs.delete,tx.rollback,shell.exec,shell.start,shell.input,shell.kill",
    } : {})
  };
}

// Opt-in Windows *development* Runtime bridge. Production must use the signed
// Runtime Host supervisor; this bridge never grants computer permissions.
let ownedChild=null;
export async function startWindowsDevRuntime({store,baseUrl}={}){
  if(process.platform!=="win32"||
     process.env.OWL_WIN_DEV_MANAGE_RUNTIME!=="true")
    return {managed:false};
  if(baseUrl!=="http://127.0.0.1:8788")
    throw Error("WINDOWS_DEV_RUNTIME_URL_NOT_LOOPBACK");
  if(ownedChild)throw Error("WINDOWS_DEV_RUNTIME_ALREADY_OWNED");
  const root=process.env.OWL_WIN_DEV_RUNTIME_ROOT;
  const publicKey=process.env.OWL_WIN_DEV_RUNTIME_PUBLIC_KEY;
  if(!root||!publicKey)throw Error("WINDOWS_DEV_RUNTIME_PATHS_REQUIRED");
  const canonicalRoot=fs.realpathSync(root);
  const canonicalPublicKey=fs.realpathSync(publicKey);
  const entry=path.join(canonicalRoot,"dist","server.js");
  if(!fs.statSync(entry).isFile()||!fs.statSync(canonicalPublicKey).isFile())
    throw Error("WINDOWS_DEV_RUNTIME_COMPONENT_MISSING");
  const pem=fs.readFileSync(canonicalPublicKey,"utf8");
  if(!pem.startsWith("-----BEGIN PUBLIC KEY-----")||
     !pem.includes("-----END PUBLIC KEY-----"))
    throw Error("WINDOWS_DEV_RUNTIME_PUBLIC_KEY_INVALID");
  const token=store.readSecret("OWL_RUNTIME_API_TOKEN","owl-runtime");
  if(typeof token!=="string"||!(/^[A-Za-z0-9_-]{40,80}$/.test(token)))
    throw Error("WINDOWS_DEV_RUNTIME_ENCRYPTED_TOKEN_UNAVAILABLE");
  try {
    const existing=await fetch("http://127.0.0.1:8788/health",
      {signal:AbortSignal.timeout(1300)});
    if(existing.ok)throw Error("WINDOWS_DEV_RUNTIME_PORT_IN_USE");
  }catch(error) {
    if(error?.message==="WINDOWS_DEV_RUNTIME_PORT_IN_USE")throw error;
  }
  // DEV-only UI Automation read access. Existing Windows provider deliberately
  // refuses ALL native click/key/clipboard/screenshot actions until a reviewed
  // Windows Helper is installed. Never turn on shell/delete as a side effect.
  const readOnlyUi = process.env.OWL_WIN_DEV_UIA_READ_ONLY === "true";
  const uiHelper = path.join(canonicalRoot, "scripts", "windows", "desktop-readonly.ps1");
  if (readOnlyUi) {
    if (!fs.existsSync(uiHelper) ||
        !fs.readFileSync(uiHelper, "utf8").includes("UIAutomationClient") ||
        !fs.readFileSync(path.join(canonicalRoot,"dist","providers","desktopProvider.js"),"utf8").includes("WindowsDesktopProvider")) {
      throw Error("WINDOWS_UIA_READONLY_ADAPTER_MISSING");
    }
  }
  const env={
    ...process.env,
    OWL_RUNTIME_API_TOKEN:token,
    OWL_RUNTIME_LEASE_PUBLIC_KEY_FILE:canonicalPublicKey,
    OWL_RUNTIME_ACCESS_MODE:"enforced",
    OWL_RUNTIME_MODE:"production",
    PORT:"8788",
    OWL_STATE_ROOT:path.join(path.dirname(canonicalRoot),"owl-runtime-win-state"),
    ALLOWED_DIRECTORIES:path.dirname(canonicalRoot),
    ...windowsDevWorkspacePermissions(),
    ALLOW_GUI:readOnlyUi ? "true" : "false",
    ALLOW_BROWSER:"false"
  };
  const child=spawn("node.exe",[entry],{
    cwd:canonicalRoot,env,windowsHide:true,shell:false,
    stdio:["ignore","pipe","pipe"]
  });
  ownedChild=child;
  child.stdout?.on("data",()=>{});
  child.stderr?.on("data",()=>{});
  child.on("exit",()=>{if(ownedChild===child)ownedChild=null;});
  for(let n=0;n<55;n++){
    if(child.exitCode!==null)throw Error("WINDOWS_DEV_RUNTIME_EXITED_DURING_START");
    try {
      const response=await fetch("http://127.0.0.1:8788/health",
        {signal:AbortSignal.timeout(1000)});
      if(response.ok){
        console.log("OWL_WIN_MANAGED_DEV_RUNTIME_READY",{pid:child.pid,leaseVerification:true});
        return {managed:true,pid:child.pid};
      }
    }catch{}
    await new Promise(resolve=>setTimeout(resolve,330));
  }
  child.kill();
  throw Error("WINDOWS_DEV_RUNTIME_STARTUP_TIMEOUT");
}
export function stopWindowsDevRuntime(){
  if(ownedChild?.exitCode===null){try{ownedChild.kill();}catch{}}
  ownedChild=null;
}