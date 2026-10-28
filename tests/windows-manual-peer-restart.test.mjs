import {describe,it,expect,vi} from "vitest";
import {readFile} from "node:fs/promises";
import {createWindowsPeerRecovery} from "../electron/services/windows-peer-recovery.mjs";
const psFile=new URL("../scripts/windows/manual-peer-restart.ps1",import.meta.url);
describe("Windows manual cross-restart",()=>{
  it("does not offer recovery outside Windows",async()=>{
    const ops=createWindowsPeerRecovery({platform:"darwin",run:vi.fn()});
    await expect(ops.restartComputer({component:"Tunnel"})).rejects.toThrow("WINDOWS_ONLY");
  });
  it("inspect sanitizes output and never returns arbitrary process state",async()=>{
    const run=vi.fn(async()=>({stdout:JSON.stringify({
      owlMcp:true,computerMcp:false,computerRuntimeTaskReady:false,
      computerTunnelTaskReady:true,credentials:"private-value"
    })}));
    const status=await createWindowsPeerRecovery({platform:"win32",run}).inspectComputer();
    expect(status.computerMcp).toBe(false);
    expect(status.computerTunnelTaskReady).toBe(true);
    expect(JSON.stringify(status)).not.toContain("private-value");
    expect(run.mock.calls[0][1]).toContain("Computer");
  });
  it("uses fixed peer target and component only",async()=>{
    const run=vi.fn(async()=>({stdout:JSON.stringify({state:"restart_requested",otherMcpHealthy:true})}));
    const ops=createWindowsPeerRecovery({platform:"win32",run,script:"C:/verified/manual-peer-restart.ps1"});
    expect(await ops.restartComputer({component:"Tunnel"})).toMatchObject({state:"restart_requested",target:"computer",component:"tunnel"});
    const args=run.mock.calls[0][1].join(" ");
    expect(args).toContain("-Target Computer -Component Tunnel");
    expect(args).not.toMatch(/-Target Owl\b/);
    expect(run.mock.calls[0][2].timeout).toBe(15000);
    await expect(ops.restartComputer({component:"Other"})).rejects.toThrow("INVALID_SCOPE");
  });
  it("fails closed on process launch failure and unconfirmed restart",async()=>{
    const ops=createWindowsPeerRecovery({platform:"win32",run:async()=>({stdout:"{}"})});
    await expect(ops.restartComputer({component:"Server"})).rejects.toThrow("NOT_CONFIRMED");
    const fail=createWindowsPeerRecovery({platform:"win32",run:async()=>{throw Error("PRIVATE CMDLINE");}});
    await expect(fail.inspectComputer()).rejects.not.toThrow("PRIVATE CMDLINE");
  });
  it("refuses bad ownership, bad tasks and restarting without surviving MCP",async()=>{
    const ps=await readFile(psFile,"utf8");
    for(const key of ["PEER_COMPUTER_MCP_NOT_HEALTHY","PEER_OWL_MCP_NOT_HEALTHY","COMPUTER_RECOVERY_TASK_NOT_RUNNING_REFUSE_BLIND_RESTART","OWL_ELECTRON_OWNER_NOT_VERIFIED"]){
      expect(ps).toContain(key);
    }
    expect(ps).toContain("Stop-ScheduledTask");
    expect(ps).toContain("Stop-Process -Id $pidOwl");
    expect(ps).not.toContain("taskkill");
    expect(ps).not.toMatch(/Stop-Process\s+-Name\s+/i);
  });
});
