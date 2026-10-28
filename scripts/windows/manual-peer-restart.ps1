# On-demand Windows peer restart. No watchdog or service changes.
[CmdletBinding()]
param(
 [ValidateSet('Check','Restart')][string]$Mode='Check',
 [ValidateSet('Computer','Owl')][string]$Target='Computer',
 [ValidateSet('Server','Tunnel')][string]$Component='Tunnel'
)
$ErrorActionPreference='Stop'
$project=(Resolve-Path (Join-Path $PSScriptRoot '../..')).ProviderPath
function Health([int]$Port,[string]$Service) {
 try {
  $r=Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 3
  return ($r.ok -eq $true -and $r.service -eq $Service)
 } catch {return $false}
}
function Task([string]$Name,[string]$Pattern) {
 $t=Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
 if(!$t -or $t.State -eq 'Disabled' -or @($t.Actions).Count -ne 1){return $null}
 $a=$t.Actions[0]
 $s="$($a.Execute) $($a.Arguments) $($a.WorkingDirectory)"
 if($s -notmatch $Pattern){return $null}
 return $t
}
$owlOk=Health 8790 'owl-mcp'
$computerOk=Health 8787 'computer-mcp'
$owlGuardian=Task 'OWL LAB DEV Guardian' '(?i)dev-guardian\.ps1.*-Mode Run'
$computerServer=Task 'Computer MCP Runtime' '(?i)computer-mcp'
$computerTunnel=Task 'Computer MCP Tunnel' '(?i)computer-mcp|8787/mcp'
if($Mode -eq 'Check'){
 [pscustomobject]@{owlMcp=$owlOk;computerMcp=$computerOk;owlGuardianReady=[bool]$owlGuardian;computerRuntimeTaskReady=[bool]$computerServer;computerTunnelTaskReady=[bool]$computerTunnel;remoteChatGPTConnection='UNVERIFIED';mode='Check'} | ConvertTo-Json -Compress
 exit 0
}
if($Target -eq 'Owl'){
 if($Component -ne 'Server'){throw 'OWL_TUNNEL_RESTART_NOT_SUPPORTED_BY_PEER_SCRIPT'}
 if(!$computerOk){throw 'PEER_COMPUTER_MCP_NOT_HEALTHY'}
 if(!$owlGuardian){throw 'OWL_GUARDIAN_NOT_FOUND'}
 # Restart only an exact Electron process owning the dedicated OWL listener.
 $listeners=@(Get-NetTCPConnection -State Listen -LocalPort 8790 -ErrorAction SilentlyContinue)
 if($listeners.Count -ne 1 -or $listeners[0].LocalAddress -ne '127.0.0.1'){throw 'OWL_MCP_PORT_OWNERSHIP_UNCLEAR'}
 $pidOwl=[int]$listeners[0].OwningProcess
 $proc=Get-CimInstance Win32_Process -Filter "ProcessId=$pidOwl"
 if(!$proc -or $proc.Name -ne 'electron.exe' -or !$proc.CommandLine -or
   $proc.CommandLine.IndexOf($project,[StringComparison]::OrdinalIgnoreCase) -lt 0){throw 'OWL_ELECTRON_OWNER_NOT_VERIFIED'}
 Stop-Process -Id $pidOwl -ErrorAction Stop
 # Existing OWL Guardian restarts Desktop; Computer MCP and both tunnels stay untouched.
 [pscustomobject]@{state='restart_requested';target='owl';component='server';guardian='existing';otherMcpHealthy=$computerOk} | ConvertTo-Json -Compress
 exit 0
}
if(!$owlOk){throw 'PEER_OWL_MCP_NOT_HEALTHY'}
$t=if($Component -eq 'Server'){$computerServer}else{$computerTunnel}
if(!$t){throw "COMPUTER_$($Component.ToUpperInvariant())_RECOVERY_TASK_NOT_CONFIGURED"}
# Only restart a verified running Windows Scheduled Task. Never kill an unknown port owner.
# A task that spawned a detached child and exited is not a safe recovery owner.
if($t.State -ne 'Running'){throw 'COMPUTER_RECOVERY_TASK_NOT_RUNNING_REFUSE_BLIND_RESTART'}
Stop-ScheduledTask -TaskName $t.TaskName -TaskPath $t.TaskPath -ErrorAction Stop
Start-ScheduledTask -TaskName $t.TaskName -TaskPath $t.TaskPath -ErrorAction Stop
[pscustomobject]@{state='restart_requested';target='computer';component=$Component;otherMcpHealthy=$owlOk;task=$t.TaskName} | ConvertTo-Json -Compress
