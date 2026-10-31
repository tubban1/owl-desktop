import {describe,expect,it} from "vitest";
import {readFile} from "node:fs/promises";
const file=new URL("../scripts/windows/verified-dev-cutover.ps1",import.meta.url);
describe("Windows autonomous cutover guardian drift recovery",()=>{
  it("accepts only running, verified guardian inside the workspace with no competing Electron main",async()=>{
    const source=await readFile(file,"utf8");
    expect(source).toContain("$preflight.guardianRecoverable=$false");
    expect(source).toContain("$guard.State -eq 'Running'");
    expect(source).toContain(String.raw`Join-Path $guardianRoot 'scripts\windows\dev-guardian.ps1'`);
    expect(source).toContain("-not (MainProcess $guardianRoot)");
    expect(source).toContain("$guardianRoot.StartsWith($workspace+[IO.Path]::DirectorySeparatorChar");
    expect(source).toContain("$preflight.guardianRecoverable)");
    expect(source).toContain("Restore-OldGuardian");
    expect(source).toContain("CUTOVER_PREFLIGHT_BLOCKED");
  });
});
