import {describe,it,expect} from "vitest";
import {readFile} from "node:fs/promises";

describe("Windows background-host persistence diagnostics",()=>{
 it("is read-only and inspects independent runtime, MCP, tunnel and service ownership",async()=>{
   const s=await readFile(new URL("../scripts/windows/check-background-persistence.ps1",import.meta.url),"utf8");
   for(const port of ["8788","8790","18081"])expect(s).toContain("ListenerStatus "+port);
   for(const source of ["Get-NetTCPConnection","Get-CimInstance Win32_Process","Get-CimInstance Win32_Service","Get-ScheduledTask"])
     expect(s).toContain(source);
   for(const forbidden of ["Register-ScheduledTask","Start-ScheduledTask","Set-ScheduledTask",
     "Unregister-ScheduledTask","Stop-Process","Start-Process","Restart-Computer",
     "Set-ItemProperty","Set-Content","Remove-Item","Set-Service","New-Service"])
     expect(s).not.toContain(forbidden);
   expect(s).not.toMatch(/\$proc\.CommandLine|\.CommandLine\s*;/);
   expect(s).toContain("persistentAfterSignOut = 'NOT_VERIFIED'");
   expect(s).toContain("$mcp.localAddress -eq '127.0.0.1'");
 });
 it("does not confuse logon task recovery with real logoff/service isolation",async()=>{
   const d=await readFile(new URL("../docs/architecture/WINDOWS_BACKGROUND_HOST.md",import.meta.url),"utf8");
   for(const term of ["sign-out","Windows SCM service","Electron","DPAPI",
       "Runtime/MCP","reboot","sleep","NOT"])expect(d).toContain(term);
 });
});
