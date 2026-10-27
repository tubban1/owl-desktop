import {describe,it,expect} from "vitest";
import {readFile} from "node:fs/promises";
const src = new URL("../scripts/windows/dual-mcp-guardian.ps1", import.meta.url);
describe("Windows independent dual-MCP watchdog safety contract",()=>{
 it("has read-only default and does not pretend to verify ChatGPT tunnel or sign-out",async()=>{
   const code=await readFile(src,"utf8");
   expect(code).toContain("[string]$Mode = 'Check'");
   expect(code).toContain("NOT_VERIFIABLE_FROM_LOCAL_HEALTH");
   expect(code).toContain("signOutSurvival='NOT_VERIFIED'");
   expect(code).toContain("computerTunnel='UNKNOWN'");
 });
 it("checks both independent MCP services, does not confuse one with the other",async()=>{
   const code=await readFile(src,"utf8");
   expect(code).toContain("Test-LocalHealth 8787 'computer-mcp'");
   expect(code).toContain("Test-LocalHealth 8790 'owl-mcp'");
   expect(code).toContain("Test-LocalHealth 8788 'owl-runtime'");
   expect(code).toContain("127.0.0.1:$Port/health");
 });
 it("refuses recovery without live alternative, when port occupied or task not verified",async()=>{
   const code=await readFile(src,"utf8");
   for(const error of ["REFUSED_NO_HEALTHY_ALTERNATIVE","REFUSED_PORT_OWNED_OR_HUNG","REFUSED_NO_VERIFIED_RECOVERY_TASK","DUAL_MCP_BOTH_TRUSTED_RECOVERY_TASKS_REQUIRED","DUAL_MCP_INSTALL_REQUIRES_BOTH_MCP_HEALTHY"]){
     expect(code).toContain(error);
   }
   expect(code).toContain("Get-ValidatedTask");
   expect(code).toContain("Start-ScheduledTask");
 });
 it("requires a delay, checks ownership and starts no aggressive process replacements",async()=>{
   const code=await readFile(src,"utf8");
   expect(code).toContain("$unhealthyComputer -ge 3");
   expect(code).toContain("$unhealthyOwl -ge 3");
   expect(code).toContain(".TotalMinutes -ge 10");
   expect(code).toContain("owl-desktop");
   expect(code).toContain("computer-mcp");
   expect(code).not.toMatch(/\bStop-Process\b|\btaskkill\b|\bStop-Service\b|\bRemove-Service\b/);
 });
 it("installs opt-in user logon task only, with rollback mode",async()=>{
   const code=await readFile(src,"utf8");
   expect(code).toContain("-LogonType Interactive");
   expect(code).toContain("-RunLevel Limited");
   expect(code).toContain("if($Mode -eq 'Uninstall')");
   expect(code).not.toContain("-UserId 'SYSTEM'");
   expect(code).not.toContain("LocalSystem");
 });
});
