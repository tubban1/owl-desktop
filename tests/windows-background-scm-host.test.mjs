import {describe,it,expect} from "vitest";
import {readFile} from "node:fs/promises";
import {validateBackgroundConfig,validateServiceSecrets,processSpecification,
  componentHealthy,REQUIRED_PORTS,runBackgroundHost} from "../scripts/windows/background-host-supervisor.mjs";

const pathRoot="C:\\ProgramData\\OWL LAB\\BackgroundHost";
const config={
 nodeExe:pathRoot+"\\node.exe",
 runtimeEntry:pathRoot+"\\runtime\\dist\\server.js",
 runtimeRoot:pathRoot+"\\runtime",
 mcpEntry:pathRoot+"\\mcp-app\\mcp\\server.mjs",
 mcpRoot:pathRoot+"\\mcp-app",
 tunnelExe:pathRoot+"\\tunnel-client.exe",
 tunnelId:"tunnel_"+"a".repeat(32),
 publicKeyFile:pathRoot+"\\device.pub",
 stateRoot:pathRoot+"\\state",
 allowedDirectories:pathRoot+"\\workspace"
};
const env={
 OWL_BACKGROUND_RUNTIME_TOKEN:"r".repeat(50),
 OWL_BACKGROUND_MCP_TOKEN:"m".repeat(50),
 OWL_BACKGROUND_TUNNEL_KEY:"T".repeat(56),
 SystemRoot:"C:\\Windows",PATH:"C:\\Windows\\System32",
 USERPROFILE:"C:\\Windows\\ServiceProfiles\\LocalService",
 TEMP:"C:\\Windows\\TEMP"
};
const mockStat=(p)=>({
 isFile:()=>["nodeExe","runtimeEntry","mcpEntry","tunnelExe","publicKeyFile"]
   .some(k=>config[k]===p),
 isDirectory:()=>["runtimeRoot","mcpRoot","stateRoot","allowedDirectories"]
   .some(k=>config[k]===p)
});
describe("Windows non-interactive Background Host service contract",()=>{
 it("requires service-staged absolute paths and rejects extra credential fields",()=>{
  expect(validateBackgroundConfig(config,{stat:mockStat})).toMatchObject(config);
  expect(()=>validateBackgroundConfig({...config,tunnelId:"evil"},{stat:mockStat}))
    .toThrow("BACKGROUND_TUNNEL_ID_INVALID");
  expect(()=>validateBackgroundConfig({...config,controlPlaneKey:"secret"},{stat:mockStat}))
    .toThrow("BACKGROUND_CONFIG_UNEXPECTED_FIELD");
  expect(()=>validateBackgroundConfig({...config,stateRoot:"C:\\Users\\i95i\\state"},{stat:mockStat}))
    .toThrow("BACKGROUND_STATE_USER_PROFILE_FORBIDDEN");
  expect(()=>validateBackgroundConfig({...config,allowedDirectories:"C:\\"},{stat:mockStat}))
    .toThrow("BACKGROUND_ALLOWED_DIRECTORIES_USER_PROFILE_FORBIDDEN");
  expect(()=>validateBackgroundConfig({...config,mcpRoot:"relative/path"},{stat:mockStat}))
    .toThrow("BACKGROUND_PATH_INVALID_MCPROOT");
  expect(()=>validateBackgroundConfig(config,{platform:"darwin",stat:mockStat}))
    .toThrow("BACKGROUND_HOST_WINDOWS_ONLY");
 });
 it("requires three distinct service-specific credentials; no existing user DPAPI",()=>{
  expect(()=>validateServiceSecrets(env)).not.toThrow();
  expect(()=>validateServiceSecrets({...env,OWL_BACKGROUND_MCP_TOKEN:env.OWL_BACKGROUND_RUNTIME_TOKEN}))
    .toThrow("BACKGROUND_SERVICE_TOKENS_MUST_DIFFER");
  expect(()=>validateServiceSecrets({...env,OWL_BACKGROUND_TUNNEL_KEY:undefined}))
    .toThrow("BACKGROUND_SERVICE_TUNNEL_KEY_INVALID");
 });
 it("spawns only fixed loopback backend programs with least privilege",()=>{
  expect(REQUIRED_PORTS).toEqual({runtime:8788,mcp:8790,tunnel:18081});
  const runtime=processSpecification("runtime",config,env);
  expect(runtime.args).toEqual([config.runtimeEntry]);
  expect(runtime.env).toMatchObject({PORT:"8788",HOST:"127.0.0.1",
   ALLOW_WRITE:"false",ALLOW_DELETE:"false",ALLOW_SHELL:"false",
   ALLOW_GUI:"false",ALLOW_BROWSER:"false",ALLOW_GIT_PUSH:"false"});
  expect(runtime.env).not.toHaveProperty("CONTROL_PLANE_API_KEY");
  const mcp=processSpecification("mcp",config,env);
  expect(mcp.env).toMatchObject({OWL_RUNTIME_URL:"http://127.0.0.1:8788",
    OWL_MCP_PORT:"8790"});
  expect(mcp.env).not.toHaveProperty("CONTROL_PLANE_API_KEY");
  const tunnel=processSpecification("tunnel",config,env);
  expect(tunnel.args).toContain("http://127.0.0.1:8790/mcp");
  expect(tunnel.args).toContain("--mcp.extra-headers");
  expect(tunnel.args).toContain("--mcp.discovery-extra-headers");
  expect(tunnel.args.filter(v=>v==="Authorization: env:OWL_BACKGROUND_MCP_AUTH_HEADER")).toHaveLength(2);
  expect(tunnel.env.OWL_BACKGROUND_MCP_AUTH_HEADER).toBe("Bearer "+env.OWL_BACKGROUND_MCP_TOKEN);
  expect(tunnel.args.join(" ")).not.toContain(env.OWL_BACKGROUND_MCP_TOKEN);
  expect(tunnel.args.join(" ")).not.toContain(env.OWL_BACKGROUND_TUNNEL_KEY);
  expect(tunnel.env.CONTROL_PLANE_API_KEY).toBe(env.OWL_BACKGROUND_TUNNEL_KEY);
  expect(tunnel.env).not.toHaveProperty("OWL_RUNTIME_API_TOKEN");
 });
 it("verifies actual health, not just port opened",async()=>{
  expect(await componentHealthy("runtime",{fetcher:async()=>({ok:true,json:async()=>({ok:true,service:"owl-runtime"})})})).toBe(true);
  expect(await componentHealthy("mcp",{fetcher:async()=>({ok:true,json:async()=>({ok:true,service:"owl-mcp"})})})).toBe(true);
  expect(await componentHealthy("tunnel",{fetcher:async()=>({ok:true,json:async()=>({ready:true,live:true,components:{"control-plane":{status:"ok"},dispatcher:{status:"ok"}}})})})).toBe(true);
  expect(await componentHealthy("tunnel",{fetcher:async()=>({ok:true,json:async()=>({ready:true,live:true})})})).toBe(false);
 });
 it("refuses port ownership conflicts and never adopts live Desktop services",async()=>{
   let spawned=0;
   await expect(runBackgroundHost(config,{
     serviceEnv:env,
     portInUse:async port=>port===8790,
     spawnProcess:()=>{spawned++;throw Error("not expected")}
   })).rejects.toThrow("BACKGROUND_OWNED_PORT_IN_USE");
   expect(spawned).toBe(0);
 });
 it("brings up Runtime before MCP before Tunnel, then kills only owned children",async()=>{
   const names=[],children=[];
   const controller=new AbortController();
   let ticks=0;
   const original=process.stdout.write;
   const logs=[];
   process.stdout.write=(chunk,...args)=>{logs.push(String(chunk));return true};
   try{
     await runBackgroundHost(config,{
       serviceEnv:env,signal:controller.signal,
       portInUse:async()=>false,
       probe:async()=>true,
       spawnProcess:(exe,args,options)=>{
         const kind=args.includes(config.runtimeEntry)?"runtime":
           args.includes(config.mcpEntry)?"mcp":"tunnel";
         names.push(kind);
         const child={exitCode:null,signalCode:null,
           kill(){this.signalCode="SIGTERM"}};
         children.push(child);
         return child;
       },
       delay:async()=>{
         ticks++;
         if(ticks>=5)controller.abort();
       }
     });
   }finally{process.stdout.write=original;}
   expect(names).toEqual(["runtime","mcp","tunnel"]);
   expect(children.every(x=>x.signalCode==="SIGTERM")).toBe(true);
   const output=logs.join("");
   expect(output).not.toContain(env.OWL_BACKGROUND_TUNNEL_KEY);
   expect(output).not.toContain(env.OWL_BACKGROUND_RUNTIME_TOKEN);
 });
 it("authenticates service MCP health without leaking runtime or tunnel credentials",async()=>{
  const seen=[];
  expect(await componentHealthy("mcp",{serviceEnv:env,fetcher:async(url,opts)=>{
    seen.push({url,headers:opts.headers});
    return {ok:true,json:async()=>({ok:true,service:"owl-mcp"})};
  }})).toBe(true);
  expect(seen).toEqual([{url:"http://127.0.0.1:8790/health",
    headers:{Authorization:"Bearer "+env.OWL_BACKGROUND_MCP_TOKEN}}]);
  expect(seen[0].headers.Authorization).not.toContain(env.OWL_BACKGROUND_RUNTIME_TOKEN);
  expect(seen[0].headers.Authorization).not.toContain(env.OWL_BACKGROUND_TUNNEL_KEY);
  const noAuth=await componentHealthy("runtime",{serviceEnv:env,fetcher:async(url,opts)=>{
    expect(opts.headers).toEqual({});
    return {ok:true,json:async()=>({ok:true,service:"owl-runtime"})};
  }});
  expect(noAuth).toBe(true);
 });
 it("prepares an offline protected snapshot without touching running DEV or secrets",async()=>{
  const installer=await readFile(new URL("../scripts/windows/install-background-host.ps1",import.meta.url),"utf8");
  for(const term of ["'Prepare'","BACKGROUND_PREPARED_OFFLINE_NO_SERVICE_CHANGE",
    "BACKGROUND_PREPARE_DEST_ALREADY_EXISTS_","BACKGROUND_DEV_GIT_NOT_CLEAN",
    "BACKGROUND_DEV_NOT_ON_REMOTE_MAIN","git -C $dev ls-files --cached",
    "BACKGROUND_PREPARE_REPARSE_SOURCE_REFUSED",
    "BACKGROUND_PREPARE_REPARSE_TRACKED_FILE_REFUSED",
    "Remove-Item -LiteralPath $createdPath -Recurse -Force",
    "BACKGROUND_PREPARE_SOURCE_INSIDE_DEST","BACKGROUND_STATE_ACL_FAILED"])
    expect(installer).toContain(term);
  const start=installer.indexOf("if($Mode -eq 'Prepare'){");
  const end=installer.indexOf("if($Mode -eq 'Stage'){");
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  const prepare=installer.slice(start,end);
  expect(prepare).not.toMatch(/\\bStart-Service\\b|\\bStop-Service\\b|\\bStop-ScheduledTask\\b|\\bStart-ScheduledTask\\b|\\bsc\\.exe\\b/);
  expect(prepare).not.toContain("credentials.dpapi");
 });
 it("keeps non-admin service inspection safe behind protected ACLs",async()=>{
  const installer=await readFile(new URL("../scripts/windows/install-background-host.ps1",import.meta.url),"utf8");
  expect(installer).toContain("function FileAccess([string]$file)");
  expect(installer).toContain("Test-Path -LiteralPath $file -PathType Leaf -ErrorAction Stop");
  expect(installer).toContain("return 'Restricted'");
  expect(installer).toContain("Assert-Admin");
 });
 it("passes the protected non-secret config path into the scoped Node validation environment",async()=>{
  const installer=await readFile(new URL("../scripts/windows/install-background-host.ps1",import.meta.url),"utf8");
  const validation=installer.slice(
    installer.indexOf("function Assert-Staged {"),
    installer.indexOf("function Restrict-Folder {"));
  expect(validation).toContain("[Environment]::SetEnvironmentVariable('OWL_BACKGROUND_CONFIG_PATH',$cfg,'Process')");
  expect(validation).toContain("[Environment]::GetEnvironmentVariable('OWL_BACKGROUND_CONFIG_PATH','Process')");
  expect(validation).toContain("[Environment]::SetEnvironmentVariable('OWL_BACKGROUND_CONFIG_PATH',$previousConfigPath,'Process')");
  expect(validation).toContain("--check-config");
  expect(validation).toContain("finally {");
  expect(validation).toContain("$validationExit=$LASTEXITCODE");
  expect(validation).not.toContain("Start-Service");
  const supervisor=await readFile(new URL("../scripts/windows/background-host-supervisor.mjs",import.meta.url),"utf8");
  expect(supervisor).toContain("process.env.OWL_BACKGROUND_CONFIG_PATH");
  expect(supervisor).toContain("BACKGROUND_CONFIG_PATH_REQUIRED");
  expect(supervisor).toContain('log("startup_failed",diagnostic)');
 });
 it("supports local operator Cloud credential enrollment without remotely unlocking DPAPI",async()=>{
  const installer=await readFile(new URL("../scripts/windows/install-background-host.ps1",import.meta.url),"utf8");
  expect(installer).toContain("'ProvisionCloudApproved'");
  const action=installer.slice(installer.indexOf("if($Mode -eq 'ProvisionCloudApproved'){"),
    installer.indexOf("if($Mode -eq 'Install'){"));
  for(const term of ["Assert-Staged","Secure-Prompt","RandomNumberGenerator",
    "GetBytes($randomA)","GetBytes($randomB)","DataProtectionScope]::LocalMachine",
    "BACKGROUND_PROVISION_CREDENTIAL_ALREADY_PRESENT","BACKGROUND_PROVISION_TUNNEL_IDENTITY_INVALID",
    "icacls.exe $tmp","Move-Item -LiteralPath $tmp -Destination $secrets",
    "BACKGROUND_SERVICE_CREDENTIALS_PROVISIONED_BY_LOCAL_OPERATOR",
    "BACKGROUND_EXISTING_DEV_TUNNEL_UNCHANGED"])
      expect(action).toContain(term);
  for(const forbidden of ["ProtectedData]::Unprotect","DataProtectionScope]::CurrentUser",
    "ReadAllBytes($legacyKey)","Start-Service","Stop-Service","sc.exe create",
    "Stop-ScheduledTask","Remove-Item -LiteralPath $legacyKey"])
      expect(action).not.toContain(forbidden);
  expect(action).not.toContain("Console.WriteLine($tunnelKey)");
  expect(action).not.toContain("Write-Output $tunnelKey");
  expect(action).toContain("if(-not $completed -and (Test-Path -LiteralPath $tmp -PathType Leaf))");
 });
 it("requires administrator provisioning and hardcoded Windows SCM isolation",async()=>{
  const csharp=await readFile(new URL("../scripts/windows/OwlBackgroundHostService.cs",import.meta.url),"utf8");
  const script=await readFile(new URL("../scripts/windows/install-background-host.ps1",import.meta.url),"utf8");
  for(const term of ["DataProtectionScope.LocalMachine","WindowsBuiltInRole.Administrator",
   "JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE","ServiceBase","--provision","--validate"])
    expect(csharp).toContain(term);
  for(const term of ["Assert-Admin","BACKGROUND_PORT_IN_USE","LocalService",
     "OWL LAB DEV Guardian","NT AUTHORITY\\LocalService","sc.exe create",
     "Check","Build","Stage","Provision","Install","Uninstall"])
    expect(script).toContain(term);
  expect(script).not.toContain("Stop-Process");
  expect(script).not.toContain("tunnel_6ab6d73d77f88191b193e49e1fb5ba75");
 });
});
