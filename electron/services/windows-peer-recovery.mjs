import path from "node:path";
import {fileURLToPath} from "node:url";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
const runFile=promisify(execFile);
const here=path.dirname(fileURLToPath(import.meta.url));
export const manualPeerScript=path.resolve(here,"../../scripts/windows/manual-peer-restart.ps1");

export function createWindowsPeerRecovery({platform=process.platform,run=runFile,script=manualPeerScript}={}){
  const invoke=async(mode,component="Tunnel")=>{
    if(platform!=="win32")throw Error("WINDOWS_PEER_RECOVERY_WINDOWS_ONLY");
    if(!["Check","Restart"].includes(mode)||!["Tunnel","Server"].includes(component))
      throw Error("WINDOWS_PEER_RECOVERY_INVALID_SCOPE");
    let stdout;
    try{
      ({stdout}=await run("powershell.exe",[
        "-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass",
        "-File",script,"-Mode",mode,"-Target","Computer","-Component",component,
      ],{timeout:15000,windowsHide:true,maxBuffer:4096}));
    }catch(error){
      // Never return PowerShell stdout, stderr, credentials or raw command lines.
      throw Error("WINDOWS_PEER_RECOVERY_FAILED_"+(error?.code==="ETIMEDOUT"?"TIMEOUT":"CHECK_LAUNCHER"));
    }
    let data;
    try{data=JSON.parse(String(stdout).trim());}catch{throw Error("WINDOWS_PEER_RECOVERY_INVALID_REPLY");}
    if(mode==="Restart" && data?.state!=="restart_requested")
      throw Error("WINDOWS_PEER_RECOVERY_RESTART_NOT_CONFIRMED");
    return mode==="Check"?{
      computerMcp:!!data.computerMcp,
      owlMcp:!!data.owlMcp,
      computerRuntimeTaskReady:!!data.computerRuntimeTaskReady,
      computerTunnelTaskReady:!!data.computerTunnelTaskReady,
      remoteChatGPTConnection:"UNVERIFIED",
    }:{
      state:"restart_requested",target:"computer",component:component.toLowerCase(),
      otherMcpHealthy:!!data.otherMcpHealthy,
      note:"Recheck the peer MCP and tunnel from an independent ChatGPT call.",
    };
  };
  return Object.freeze({inspectComputer:()=>invoke("Check"),
    restartComputer:({component="Tunnel"}={})=>invoke("Restart",component)});
}
