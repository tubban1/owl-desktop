import {describe,it,expect} from "vitest";
import fs from "node:fs";
const mac=fs.readFileSync(new URL("../scripts/mac-safe-cutover.mjs",import.meta.url),"utf8");
const win=fs.readFileSync(new URL("../scripts/windows/verified-dev-cutover.ps1",import.meta.url),"utf8");

describe("Guarded rollout diagnostic-only evidence",()=>{
  it("preserves Mac gate timeouts, old health conditions, watchdog rollback and explicit tunnel success",()=>{
    expect(mac).toContain('await waitFor(candidateHealthy,150000)');
    expect(mac).toContain('throw Error("NEW_MCP_AND_RUNTIME_NOT_HEALTHY")');
    expect(mac).toContain('const supervisor=Boolean(exactSupervisor(dir))');
    expect(mac).toContain('const desktop=supervisor&&desktopMainRunning(dir)');
    expect(mac).toContain('const mcp=desktop&&await health(8790)');
    expect(mac).toContain('const runtime=mcp&&await health(18788)');
    expect(mac).toContain('const tunnel=runtime&&await tunnelReady(dir,tunnelEvidence)');
    expect(mac).toContain('return data.ready===true&&data.live===true');
    expect(mac).toContain('await rollback(String(e.message??e))');
    expect(mac).toContain('event:"activation-gate-final-failure"');
    expect(mac).toContain('event:"activation-gate-poll"');
    expect(mac).not.toContain('controlPlaneToken');
  });
  it("preserves Windows exact AND gate and timeout, captures only health booleans",()=>{
    expect(win).toContain('if((MainProcess $Root) -and (Test-Health) -and (Test-Tunnel)){return $true}');
    expect(win).toContain("Write-GateObservation $Root 'poll'");
    expect(win).toContain("Write-GateObservation $Root 'final-failure'");
    expect(win).toContain("throw 'CUTOVER_NEW_HEALTH_FAILED'");
    expect(win).toContain('Start-Sleep -Milliseconds 900');
    expect(win).toContain("lastGate=if($script:lastGateSnapshot)");
    expect(win).toContain("$probe.tunnel=@{reachable=$true;ready=[bool]($t.ready -eq $true);");
    expect(win).not.toContain("Add-Content -LiteralPath $log -Value $t");
    expect(win).toContain("Disable-ScheduledTask -TaskName $taskName");
    expect(win).toContain("Restore-OldGuardian");
  });
});
