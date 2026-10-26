import {describe,it,expect} from "vitest";
import {readFile} from "node:fs/promises";
const source=new URL("../scripts/windows/dev-guardian.ps1",import.meta.url);
describe("Windows DEV self-healing guardian",()=>{
 it("defaults to read-only checking and never claims true sign-out persistence",async()=>{
  const body=await readFile(source,"utf8");
  expect(body).toContain("[string]$Mode = 'Check'");
  expect(body).toContain("signOutPersistence = 'NOT_SUPPORTED'");
  expect(body).toContain("-LogonType Interactive");
  expect(body).toContain("Local\\OWL-LAB-DEV-GUARDIAN-V1");
  expect(body).not.toContain("-LogonType Password");
  expect(body).not.toContain("-UserId 'SYSTEM'");
  expect(body).not.toContain("LocalSystem");
 });
 it("only manages the dedicated official tunnel, never the legacy Computer MCP",async()=>{
  const body=await readFile(source,"utf8");
  expect(body).toContain("Read-TunnelId");
  expect(body).toContain("'http://127.0.0.1:8790/mcp'");
  expect(body).toContain("'http://127.0.0.1:8790/health'");
  expect(body).not.toContain("http://127.0.0.1:8787/mcp");
  expect(body).not.toContain("tunnel_6ab6d73d77f88191b193e49e1fb5ba75");
 });
 it("checks for duplicate ports/processes and leaves running tunnel untouched",async()=>{
  const body=await readFile(source,"utf8");
  for(const word of ["Test-PortOccupied 8788","Test-PortOccupied 8790","Test-PortOccupied 5173",
      "Test-PortOccupied 18081","Get-ProcessForTunnel","Write-GuardianEvent","guardian.jsonl",
      "Register-ScheduledTask","Unregister-ScheduledTask"])
    expect(body).toContain(word);
  expect(body).not.toMatch(/\bStop-Process\b|\btaskkill\b|\bStop-Service\b|\bRemove-Service\b/);
  expect(body).toContain("Get-OwlState");
 });
});
