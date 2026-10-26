// OWL LAB Windows Background Host: noninteractive Runtime/MCP/Tunnel supervisor.
// This is the process launched by the Windows SCM ServiceBase wrapper.
// It never controls Chrome, the clipboard, windows, or another user's session.
// Service credentials arrive only from the service's protected DPAPI store.
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import {spawn} from "node:child_process";
import {fileURLToPath} from "node:url";

export const REQUIRED_PORTS = Object.freeze({runtime:8788,mcp:8790,tunnel:18081});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const schemaKeys=["nodeExe","runtimeEntry","runtimeRoot","mcpEntry","mcpRoot",
  "tunnelExe","tunnelId","publicKeyFile","stateRoot","allowedDirectories"];

export function validateBackgroundConfig(c,{platform="win32",stat=fs.statSync}={}){
  if(platform!=="win32")throw Error("WINDOWS_BACKGROUND_HOST_WINDOWS_ONLY");
  if(!c||typeof c!=="object"||Array.isArray(c))throw Error("BACKGROUND_CONFIG_INVALID");
  for(const k of Object.keys(c))
    if(!schemaKeys.includes(k))throw Error("BACKGROUND_CONFIG_UNEXPECTED_FIELD");
  for(const k of schemaKeys)if(typeof c[k]!=="string"||!c[k].trim())
    throw Error("BACKGROUND_CONFIG_MISSING_"+k.toUpperCase());
  if(!/^tunnel_[a-f0-9]{32}$/.test(c.tunnelId))
    throw Error("BACKGROUND_TUNNEL_ID_INVALID");
  for(const k of schemaKeys.filter(k=>k!=="tunnelId")){
    const v=c[k];
    if(!path.win32.isAbsolute(v)||v.includes("\0")||
       !/^[a-zA-Z]:\\/.test(v)||v.startsWith("\\\\"))
      throw Error("BACKGROUND_PATH_INVALID_"+k.toUpperCase());
  }
  if(!c.nodeExe.toLowerCase().endsWith("\\node.exe")||
     !c.runtimeEntry.toLowerCase().endsWith("\\dist\\server.js")||
     !c.mcpEntry.toLowerCase().endsWith("\\mcp\\server.mjs")||
     !c.tunnelExe.toLowerCase().endsWith("\\tunnel-client.exe"))
    throw Error("BACKGROUND_COMPONENT_TYPE_INVALID");
  if(c.allowedDirectories.toLowerCase()==="c:\\" ||
     c.allowedDirectories.toLowerCase()==="c:\\users" ||
     c.allowedDirectories.toLowerCase().startsWith("c:\\users\\"))
    throw Error("BACKGROUND_ALLOWED_DIRECTORIES_USER_PROFILE_FORBIDDEN");
  if(c.stateRoot.toLowerCase().startsWith("c:\\users\\"))
    throw Error("BACKGROUND_STATE_USER_PROFILE_FORBIDDEN");
  // Service DLL and all executable/data roots must be in its protected,
  // machine-owned staging tree. Never run code from a user's DEV checkout.
  const protectedRoot=path.win32.dirname(c.nodeExe).toLowerCase();
  for(const k of ["runtimeEntry","runtimeRoot","mcpEntry","mcpRoot",
      "tunnelExe","publicKeyFile","stateRoot","allowedDirectories"]){
    const child=path.win32.normalize(c[k]).toLowerCase();
    if(!child.startsWith(protectedRoot+"\\"))
      throw Error("BACKGROUND_PATH_OUTSIDE_SERVICE_STAGE_"+k.toUpperCase());
  }
  for(const k of ["nodeExe","runtimeEntry","mcpEntry","tunnelExe","publicKeyFile"]){
    try{if(!stat(c[k]).isFile())throw Error("not file");}
    catch{throw Error("BACKGROUND_COMPONENT_NOT_FOUND_"+k.toUpperCase());}
  }
  for(const k of ["runtimeRoot","mcpRoot","stateRoot","allowedDirectories"]){
    try{if(!stat(c[k]).isDirectory())throw Error("not directory");}
    catch{throw Error("BACKGROUND_DIRECTORY_NOT_FOUND_"+k.toUpperCase());}
  }
  return Object.freeze({...c});
}

export function validateServiceSecrets(env){
  const tokenRe=/^[A-Za-z0-9_-]{40,80}$/;
  if(!tokenRe.test(env.OWL_BACKGROUND_RUNTIME_TOKEN??"")||
     !tokenRe.test(env.OWL_BACKGROUND_MCP_TOKEN??""))
    throw Error("BACKGROUND_SERVICE_TOKEN_INVALID");
  if(typeof env.OWL_BACKGROUND_TUNNEL_KEY!=="string"||
     env.OWL_BACKGROUND_TUNNEL_KEY.length<24||
     /\s/.test(env.OWL_BACKGROUND_TUNNEL_KEY))
    throw Error("BACKGROUND_SERVICE_TUNNEL_KEY_INVALID");
  if(env.OWL_BACKGROUND_RUNTIME_TOKEN===env.OWL_BACKGROUND_MCP_TOKEN)
    throw Error("BACKGROUND_SERVICE_TOKENS_MUST_DIFFER");
}

export function processSpecification(component,config,serviceEnv){
  // Do not propagate privileged desktop env, user-specific DPAPI paths or
  // service-owned tunnel secrets to unrelated children.
  const base={SystemRoot:serviceEnv.SystemRoot,windir:serviceEnv.windir,
    PATH:serviceEnv.PATH,USERPROFILE:serviceEnv.USERPROFILE,
    TEMP:serviceEnv.TEMP,TMP:serviceEnv.TMP};
  if(component==="runtime")return {
    exe:config.nodeExe,args:[config.runtimeEntry],cwd:config.runtimeRoot,
    env:{...base,PORT:"8788",HOST:"127.0.0.1",
      OWL_RUNTIME_API_TOKEN:serviceEnv.OWL_BACKGROUND_RUNTIME_TOKEN,
      OWL_RUNTIME_LEASE_PUBLIC_KEY_FILE:config.publicKeyFile,
      OWL_RUNTIME_ACCESS_MODE:"enforced",OWL_RUNTIME_MODE:"production",
      OWL_STATE_ROOT:config.stateRoot,ALLOWED_DIRECTORIES:config.allowedDirectories,
      ALLOW_WRITE:"false",ALLOW_SHELL:"false",ALLOW_DELETE:"false",
      ALLOW_GIT_PUSH:"false",ALLOW_GUI:"false",ALLOW_BROWSER:"false",
      ALLOW_ROLLBACK:"false"}
  };
  if(component==="mcp")return {
    exe:config.nodeExe,args:[config.mcpEntry],cwd:config.mcpRoot,
    env:{...base,OWL_RUNTIME_URL:"http://127.0.0.1:8788",
      OWL_RUNTIME_API_TOKEN:serviceEnv.OWL_BACKGROUND_RUNTIME_TOKEN,
      OWL_MCP_API_TOKEN:serviceEnv.OWL_BACKGROUND_MCP_TOKEN,
      OWL_MCP_PORT:"8790"}
  };
  if(component==="tunnel")return {
    exe:config.tunnelExe,
    args:["run","--control-plane.api-key","env:CONTROL_PLANE_API_KEY",
      "--control-plane.tunnel-id",config.tunnelId,
      "--mcp.server-url","http://127.0.0.1:8790/mcp",
      // MCP requires a service-specific Bearer token. The official Tunnel
      // supports env:-backed per-origin headers; never put the token on argv.
      // Discovery needs the same authorization because /health and OAuth
      // metadata endpoints may enforce OWL_MCP_API_TOKEN.
      "--mcp.extra-headers","Authorization: env:OWL_BACKGROUND_MCP_AUTH_HEADER",
      "--mcp.discovery-extra-headers","Authorization: env:OWL_BACKGROUND_MCP_AUTH_HEADER",
      "--health.listen-addr","127.0.0.1:18081","--log.level","warn"],
    cwd:path.win32.dirname(config.tunnelExe),
    env:{...base,CONTROL_PLANE_API_KEY:serviceEnv.OWL_BACKGROUND_TUNNEL_KEY,
      OWL_BACKGROUND_MCP_AUTH_HEADER:"Bearer "+serviceEnv.OWL_BACKGROUND_MCP_TOKEN}
  };
  throw Error("BACKGROUND_COMPONENT_UNKNOWN");
}

export async function isLocalPortInUse(port){
  return new Promise(resolve=>{
    const sock=net.connect({host:"127.0.0.1",port});
    const finish=ok=>{sock.destroy();resolve(ok)};
    sock.once("connect",()=>finish(true));
    sock.once("error",()=>finish(false));
    sock.setTimeout(1000,()=>finish(false));
  });
}

export async function componentHealthy(name,{fetcher=fetch,serviceEnv={}}={}){
  const url=name==="runtime"?"http://127.0.0.1:8788/health":
    name==="mcp"?"http://127.0.0.1:8790/health":
    name==="tunnel"?"http://127.0.0.1:18081/health?details=true":null;
  if(!url)throw Error("BACKGROUND_COMPONENT_UNKNOWN");
  try{
    const headers=name==="mcp"
      ?{Authorization:"Bearer "+serviceEnv.OWL_BACKGROUND_MCP_TOKEN}:{};
    const r=await fetcher(url,{headers,signal:AbortSignal.timeout(2000)});
    if(!r.ok)return false;
    const data=await r.json();
    if(name==="runtime")return data.ok===true&&data.service==="owl-runtime";
    if(name==="mcp")return data.ok===true&&data.service==="owl-mcp";
    return data.ready===true&&data.live===true&&
      data.components?.["control-plane"]?.status==="ok"&&
      data.components?.dispatcher?.status==="ok";
  }catch{return false}
}

const log=(event,component="host")=>{
  // No raw exception messages, tokens, paths, args, keys or process command lines.
  process.stdout.write(JSON.stringify({at:new Date().toISOString(),event,component})+"\n");
};

export async function runBackgroundHost(config,{serviceEnv=process.env,
  spawnProcess=spawn,probe=componentHealthy,portInUse=isLocalPortInUse,
  delay=sleep,signal}={}){
  validateServiceSecrets(serviceEnv);
  // A running DEV Desktop or legacy host must never be adopted or killed.
  for(const port of Object.values(REQUIRED_PORTS))
    if(await portInUse(port))throw Error("BACKGROUND_OWNED_PORT_IN_USE");
  const children=new Map(), failures=new Map(), nextAttempt=new Map(), unhealthy=new Map();
  const stopped=()=>signal?.aborted===true;
  const launch=name=>{
    const spec=processSpecification(name,config,serviceEnv);
    const child=spawnProcess(spec.exe,spec.args,{cwd:spec.cwd,env:spec.env,
      windowsHide:true,shell:false,stdio:["ignore","ignore","ignore"]});
    children.set(name,child);
    failures.set(name,(failures.get(name)||0)+1);
    nextAttempt.set(name,Date.now()+Math.min(30000,1000*Math.pow(2,Math.min(failures.get(name),5))));
    unhealthy.set(name,0);
    log("launched",name);
  };
  const terminate=name=>{
    const child=children.get(name);
    if(!child)return;
    children.delete(name);
    if(child.exitCode===null&&child.signalCode===null)try{child.kill()}catch{}
    log("restarting",name);
  };
  const state={};
  try{
    while(!stopped()){
      for(const name of ["runtime","mcp","tunnel"]){
        if(stopped())break;
        const predecessor=name==="mcp"?"runtime":name==="tunnel"?"mcp":null;
        if(predecessor&&state[predecessor]!==true){state[name]=false;continue;}
        const child=children.get(name);
        if(child&&(child.exitCode!==null||child.signalCode!==null)){
          children.delete(name);state[name]=false;log("child_exited",name);
        }
        if(children.has(name)){
          const healthy=await probe(name,{serviceEnv});
          state[name]=healthy;
          unhealthy.set(name,healthy?0:(unhealthy.get(name)||0)+1);
          if(healthy)failures.set(name,0);
          // After repeated failures restart ONLY our own process. The SCM
          // job object handles grandchildren on full Host termination.
          if(unhealthy.get(name)>=8){terminate(name);state[name]=false}
        }else if(Date.now()>=(nextAttempt.get(name)||0)){
          if(await portInUse(REQUIRED_PORTS[name])){
            log("foreign_port_conflict",name);
            state[name]=false;
            // Never adopt a foreign owner or terminate its process.
            nextAttempt.set(name,Date.now()+15000);
          }else{launch(name);state[name]=false;}
        }
      }
      await delay(2000);
    }
  }finally{
    for(const name of ["tunnel","mcp","runtime"])terminate(name);
    log("stopped");
  }
}

const direct=process.argv[1]&&
  path.resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(direct){
  const controller=new AbortController();
  process.on("SIGINT",()=>controller.abort());
  process.on("SIGTERM",()=>controller.abort());
  try{
    const configPath=process.env.OWL_BACKGROUND_CONFIG_PATH;
    if(!configPath||!path.win32.isAbsolute(configPath))
      throw Error("BACKGROUND_CONFIG_PATH_REQUIRED");
    const c=validateBackgroundConfig(JSON.parse(fs.readFileSync(configPath,"utf8")));
    if(process.argv.includes("--check-config")){
      process.stdout.write("BACKGROUND_CONFIG_VALID\n");
    }else await runBackgroundHost(c,{signal:controller.signal});
  }catch(error){
    // --check-config is a non-secret diagnostic. Expose only known internal
    // config failure codes, never a raw OS/JSON exception, path or credential.
    const diagnostic=process.argv.includes("--check-config")&&
      /^BACKGROUND_[A-Z0-9_]+$/.test(error?.message||"")
      ?error.message:"host";
    log("startup_failed",diagnostic);
    process.exitCode=1;
  }
}
