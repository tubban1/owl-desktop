# A one-device, out-of-process DEV cutover. Run from a separately scheduled
# PowerShell, NEVER as a child owned by the OWL Electron process being replaced.
# Keeps original root untouched. Fail closed and try rolling back old launcher.
[CmdletBinding()]
param(
 [ValidateSet('Check','Cutover','Watchdog','Monitor')][string]$Mode='Check',
 [Parameter(Mandatory=$true)][string]$OldRoot,
 [Parameter(Mandatory=$true)][string]$NewRoot,
 [Parameter(Mandatory=$true)][string]$ExpectedOldSha,
 [Parameter(Mandatory=$true)][string]$ExpectedNewSha,
 [ValidateRange(30,180)][int]$TimeoutSeconds=90
)
$ErrorActionPreference='Stop'
$workspace=Join-Path $env:USERPROFILE 'mcp-workspace'
$state=Join-Path $env:USERPROFILE '.owl-lab\version-sync\desktop'
$taskName='OWL LAB DEV Guardian'
$watchdogTaskName='OWL-LAB-Cutover-Watchdog'
function Get-GitSha([string]$Root){
 $result=(& git -C $Root rev-parse HEAD 2>$null)
 if($LASTEXITCODE -ne 0){throw 'CUTOVER_NOT_GIT_REPOSITORY'}
 return [string]$result.Trim()
}
function Assert-Root([string]$Root,[string]$Sha){
 if($Sha -notmatch '^[0-9a-f]{40}$'){throw 'CUTOVER_SHA_INVALID'}
 if(-not (Test-Path -LiteralPath $Root -PathType Container)){throw 'CUTOVER_ROOT_MISSING'}
 $normalized=(Resolve-Path -LiteralPath $Root).ProviderPath
 if(-not $normalized.StartsWith($workspace+'\',[StringComparison]::OrdinalIgnoreCase)){
  throw 'CUTOVER_ROOT_OUTSIDE_WORKSPACE'
 }
 $actual=Get-GitSha $normalized
 if($actual -ne $Sha){throw 'CUTOVER_SHA_MISMATCH'}
 $dirty=@(& git -C $normalized status --porcelain --untracked-files=normal)
 if($dirty.Count -ne 0){throw 'CUTOVER_DIRTY_REPOSITORY'}
 if(-not (Test-Path -LiteralPath (Join-Path $normalized 'scripts\windows\dev-desktop.ps1') -PathType Leaf)){
  throw 'CUTOVER_LAUNCHER_MISSING'
 }
 if(-not (Test-Path -LiteralPath (Join-Path $normalized 'node_modules\electron\dist\electron.exe') -PathType Leaf)){
  throw 'CUTOVER_ELECTRON_BINARY_MISSING'
 }
 return $normalized
}
function MainProcess([string]$Root){
 $exe=Join-Path $Root 'node_modules\electron\dist\electron.exe'
 $items=@(Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object {
  $_.ExecutablePath -eq $exe -and $_.CommandLine -notmatch '--type='
 })
 if($items.Count -gt 1){throw 'CUTOVER_MULTIPLE_MAIN_PROCESSES'}
 return $(if($items.Count -eq 1){$items[0]}else{$null})
}
function PortBusy([int]$Port){return @((Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)).Count -gt 0}
function Test-Tunnel {
 try{
  $t=Invoke-RestMethod -Uri "http://127.0.0.1:18081/health?details=true" -TimeoutSec 3
  return [bool]($t.ready -eq $true -and $t.live -eq $true)
 }catch{return $false}
}
function Test-Health {
 try{
  $r=Invoke-RestMethod -Uri 'http://127.0.0.1:8788/health' -TimeoutSec 3
  $m=Invoke-RestMethod -Uri 'http://127.0.0.1:8790/health' -TimeoutSec 3
  return [bool]($r.ok -eq $true -and $r.service -eq 'owl-runtime' -and
    $m.ok -eq $true -and $m.service -eq 'owl-mcp')
 }catch{return $false}
}
function Wait-Healthy([string]$Root,[int]$Seconds){
 $until=(Get-Date).AddSeconds($Seconds)
 while((Get-Date) -lt $until){
  if((MainProcess $Root) -and (Test-Health) -and (Test-Tunnel)){return $true}
  Start-Sleep -Milliseconds 900
 }
 return $false
}
function Wait-PortsReleased([int]$Seconds){
 $until=(Get-Date).AddSeconds($Seconds)
 while((Get-Date) -lt $until){
  if(-not (PortBusy 8788) -and -not (PortBusy 8790) -and -not (PortBusy 5173)){return $true}
  Start-Sleep -Milliseconds 750
 }
 return $false
}
# Port ownership is captured before stopping the old app. Kill only those exact
# known process identities; never claim an arbitrary port is safe to terminate.
function OwnedPortSnapshot([string]$Root,[int]$MainPid){
 $table=@{}
 foreach($port in @(8788,8790,5173)){
  $listener=@(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
  if($listener.Count -ne 1){throw ('CUTOVER_PORT_OWNER_MISSING_OR_AMBIGUOUS:'+ $port)}
  $process=Get-CimInstance Win32_Process -Filter ("ProcessId="+$listener[0].OwningProcess)
  if(-not $process){throw 'CUTOVER_PORT_PROCESS_MISSING'}
  $allowed=switch($port){
   8790 { $process.ProcessId -eq $MainPid -and
     $process.ExecutablePath -eq (Join-Path $Root 'node_modules\electron\dist\electron.exe') }
   8788 { $process.ParentProcessId -eq $MainPid -and
     $process.CommandLine -match '(?i)owl-runtime-pin[\\/]dist[\\/]server\.js' }
   5173 { [string]$process.CommandLine -like ('*'+$Root+'*') -and
     [string]$process.CommandLine -match '(?i)vite' }
  }
  if(-not $allowed){throw ('CUTOVER_FOREIGN_PORT_OWNER:'+ $port)}
  $table[$port]=[int]$process.ProcessId
 }
 return $table
}
function StopVerifiedResidualPorts([hashtable]$Snapshot){
 foreach($port in @(8788,8790,5173)){
  $listener=@(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
  if($listener.Count -eq 0){continue}
  if($listener.Count -ne 1 -or $listener[0].OwningProcess -ne $Snapshot[$port]){
   throw ('CUTOVER_PORT_OWNER_CHANGED:'+ $port)
  }
  Stop-Process -Id ([int]$Snapshot[$port]) -Force -ErrorAction Stop
 }
}
function CleanupCandidatePorts([string]$Root,[int]$OldRuntimePid){
 foreach($port in @(8788,8790,5173)){
  $listener=@(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
  if($listener.Count -eq 0){continue}
  if($listener.Count -ne 1){throw ('ROLLBACK_AMBIGUOUS_PORT:'+ $port)}
  $process=Get-CimInstance Win32_Process -Filter ("ProcessId="+$listener[0].OwningProcess)
  if(-not $process){continue}
  $allowed=switch($port){
   8790 { $process.ExecutablePath -eq (Join-Path $Root 'node_modules\electron\dist\electron.exe') }
   8788 { $process.ProcessId -ne $OldRuntimePid -and
      $process.CommandLine -match '(?i)owl-runtime-pin[\\/]dist[\\/]server\.js' }
   5173 { [string]$process.CommandLine -like ('*'+$Root+'*') -and
      $process.CommandLine -match '(?i)vite' }
  }
  if(-not $allowed){throw ('ROLLBACK_FOREIGN_PORT_OWNER:'+ $port)}
  Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
 }
}
function Launch([string]$Root){
 $launcher=Join-Path $Root 'scripts\windows\dev-desktop.ps1'
 $args='-NoProfile -ExecutionPolicy Bypass -File "'+$launcher+'"'
 return Start-Process -FilePath 'powershell.exe' -ArgumentList $args -WorkingDirectory $Root -WindowStyle Hidden -PassThru
}
function Write-Receipt([string]$Phase,[string]$Reason,[bool]$Restored=$false){
 New-Item -ItemType Directory -Force -Path $state | Out-Null
 $receipt=[ordered]@{version=1;at=(Get-Date).ToUniversalTime().ToString('o');
  phase=$Phase;reason=$Reason;from=$OldRoot;to=$NewRoot;
  fromSha=$ExpectedOldSha;toSha=$ExpectedNewSha;rollbackHealthy=$Restored;
  computerBackupPortListening=[bool](PortBusy 8787);
  oldRuntimePid=if($script:oldPortSnapshot){[int]$script:oldPortSnapshot[8788]}else{0}}
 $tmp=Join-Path $state ('cutover-'+[guid]::NewGuid().ToString('N')+'.tmp')
 $final=Join-Path $state 'cutover-last.json'
 try{$receipt|ConvertTo-Json -Depth 4|Set-Content -LiteralPath $tmp -Encoding UTF8
  Move-Item -LiteralPath $tmp -Destination $final -Force}
 finally{Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue}
 return $receipt
}
function Remove-Watchdog {
 try{
  $item=Get-ScheduledTask -TaskName $watchdogTaskName -ErrorAction SilentlyContinue
  if($item){Unregister-ScheduledTask -TaskName $watchdogTaskName -Confirm:$false -ErrorAction Stop}
 }catch{}
}
function Install-Watchdog {
 if(Get-ScheduledTask -TaskName $watchdogTaskName -ErrorAction SilentlyContinue){
  throw 'CUTOVER_WATCHDOG_ALREADY_EXISTS'
 }
 $identity=[Security.Principal.WindowsIdentity]::GetCurrent().Name
 $line='-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "'+$PSCommandPath+
  '" -Mode Watchdog -OldRoot "'+$OldRoot+'" -NewRoot "'+$NewRoot+
  '" -ExpectedOldSha '+$ExpectedOldSha+' -ExpectedNewSha '+$ExpectedNewSha
 $action=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $line -WorkingDirectory $workspace
 $trigger=New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(4)
 $principal=New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
 $settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 8)
 Register-ScheduledTask -TaskName $watchdogTaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -ErrorAction Stop | Out-Null
 if(-not (Get-ScheduledTask -TaskName $watchdogTaskName -ErrorAction Stop)){
  throw 'CUTOVER_WATCHDOG_NOT_ARMED'
 }
}
function Restore-OldGuardian {
 $current=Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
 if($current -and [string]$current.Actions[0].WorkingDirectory -ne $OldRoot){
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction Stop
  $current=$null
 }
 if(-not $current){
  $guardian=Join-Path $OldRoot 'scripts\windows\dev-guardian.ps1'
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $guardian -Mode Install | Out-Null
  if($LASTEXITCODE -ne 0){throw 'ROLLBACK_OLD_GUARDIAN_REINSTALL_FAILED'}
 }else{
  Start-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
 }
}
function Run-Watchdog {
 $receiptPath=Join-Path $state 'cutover-last.json'
 if(-not (Test-Path -LiteralPath $receiptPath)){Remove-Watchdog;return}
 $receipt=Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
 if($receipt.phase -ne 'started'){Remove-Watchdog;return}
 $current=Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
 if((MainProcess $NewRoot) -and (Test-Health) -and (Test-Tunnel) -and
    $current -and [string]$current.Actions[0].WorkingDirectory -eq $NewRoot){
  $null=Write-Receipt 'activated' 'watchdog-confirmed-new-healthy'
  Remove-Watchdog
  return
 }
 $reason='watchdog-activation-timeout'
 $new=MainProcess $NewRoot
 if($new){try{(Get-Process -Id $new.ProcessId).CloseMainWindow()|Out-Null}catch{}}
 Start-Sleep -Seconds 4
 try{CleanupCandidatePorts $NewRoot ([int]$receipt.oldRuntimePid)}
 catch{$reason+=':'+([string]$_.Exception.Message)}
 $restored=$false
 if((MainProcess $OldRoot) -and (Test-Health) -and (Test-Tunnel)){$restored=$true}
 elseif(Wait-PortsReleased 18){
  try{$null=Launch $OldRoot;$restored=Wait-Healthy $OldRoot 90}catch{$reason+=':restore-failed'}
 }
 try{Restore-OldGuardian}catch{$reason+=':guardian-restore-failed'}
 $null=Write-Receipt 'watchdog-rollback' $reason $restored
 Remove-Watchdog
}
# Independent post-activation health monitor. The new DEV Guardian is NOT
# authoritative for rollback because it may auto-restart its own broken release.
# Runs from a separate Task Scheduler job; never relies on the MCP it protects.
function Run-Monitor {
 $receiptPath=Join-Path $state 'cutover-last.json'
 if(-not (Test-Path -LiteralPath $receiptPath -PathType Leaf)){return}
 $receipt=Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
 if($receipt.phase -ne 'activated' -or $receipt.fromSha -ne $ExpectedOldSha -or
    $receipt.toSha -ne $ExpectedNewSha -or $receipt.from -ne $OldRoot -or $receipt.to -ne $NewRoot){return}
 $tracker=Join-Path $state 'post-activation-failure.json'
 $main=MainProcess $NewRoot
 $healthy=[bool]($main -and (Test-Health))
 if($healthy){
  Remove-Item -LiteralPath $tracker -Force -ErrorAction SilentlyContinue
  return
 }
 $first=$null
 try{
  $f=Get-Content -LiteralPath $tracker -Raw -ErrorAction Stop | ConvertFrom-Json
  if($f.toSha -eq $ExpectedNewSha){$first=[datetime]::Parse($f.firstSeenUtc)}
 }catch{}
 if(-not $first){
  @{toSha=$ExpectedNewSha;firstSeenUtc=(Get-Date).ToUniversalTime().ToString('o')}|
   ConvertTo-Json | Set-Content -LiteralPath $tracker -Encoding UTF8
  return
 }
 if(((Get-Date).ToUniversalTime()-$first.ToUniversalTime()).TotalSeconds -lt 150){return}
 $reason='monitor-post-activation-local-health-failed'
 if($main){try{(Get-Process -Id $main.ProcessId).CloseMainWindow()|Out-Null}catch{}}
 Start-Sleep -Seconds 4
 try{CleanupCandidatePorts $NewRoot ([int]$receipt.oldRuntimePid)}
 catch {
  # Foreign ownership means human intervention is needed; never kill unknown PIDs.
  Write-Output ('OTA_MONITOR_BLOCKED_FOREIGN_PROCESS:'+([string]$_.Exception.Message))
  return
 }
 if(-not (Wait-PortsReleased 18)){Write-Output 'OTA_MONITOR_PORTS_BLOCKED';return}
 $restored=$false
 try{$null=Launch $OldRoot;$restored=Wait-Healthy $OldRoot 90}catch{}
 if($restored){try{Restore-OldGuardian}catch{$restored=$false;$reason+=':guardian-restore-failed'}}
 $journal=Write-Receipt $(if($restored){'post-activation-rolled-back'}else{'post-activation-rollback-failed'}) $reason $restored
 Add-Content -LiteralPath (Join-Path $state 'post-activation-history.jsonl') -Value ($journal|ConvertTo-Json -Compress) -Encoding UTF8
 if($restored){Remove-Item -LiteralPath $tracker -Force -ErrorAction SilentlyContinue}
}

$OldRoot=Assert-Root $OldRoot $ExpectedOldSha
$NewRoot=Assert-Root $NewRoot $ExpectedNewSha
if($OldRoot -eq $NewRoot){throw 'CUTOVER_SAME_ROOT'}
if($Mode -eq 'Watchdog'){Run-Watchdog;exit 0}
if($Mode -eq 'Monitor'){Run-Monitor;exit 0}
$original=MainProcess $OldRoot
$preflight=[ordered]@{mode=$Mode;oldRoot=$OldRoot;newRoot=$NewRoot;
 oldMainPresent=[bool]$original;newMainPresent=[bool](MainProcess $NewRoot);
 computerMcpBackup=[bool](PortBusy 8787);runtimeHealthy=[bool](Test-Health);
 tunnelHealthy=[bool](Test-Tunnel);
 guardianRoot=$null;ready=$false}
$guard=Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if($guard){$preflight.guardianRoot=[string]$guard.Actions[0].WorkingDirectory}
$preflight.ready=[bool]($original -and -not $preflight.newMainPresent -and
 $preflight.computerMcpBackup -and $preflight.runtimeHealthy -and $preflight.tunnelHealthy -and
 $preflight.guardianRoot -eq $OldRoot)
if($Mode -eq 'Check'){$preflight|ConvertTo-Json -Depth 4;exit 0}
if(-not $preflight.ready){throw 'CUTOVER_PREFLIGHT_BLOCKED'}
# Windows Computer MCP is the local independent fallback. A remote caller must
# also verify Mac is online before submitting this one-device transition.
$script:oldPortSnapshot=OwnedPortSnapshot $OldRoot $original.ProcessId
Install-Watchdog
$journal=Write-Receipt 'started' 'guarded-cutover-begun'
$hadGuardian=$false
$oldClosed=$false
$newLaunched=$false
$guardianChanged=$false
try{
 Stop-ScheduledTask -TaskName $taskName -ErrorAction Stop
 $hadGuardian=$true
 $stopUntil=(Get-Date).AddSeconds(10)
 while((Get-Date) -lt $stopUntil -and (Get-ScheduledTask -TaskName $taskName).State -eq 'Running'){
  Start-Sleep -Milliseconds 400
 }
 if((Get-ScheduledTask -TaskName $taskName).State -eq 'Running'){throw 'CUTOVER_OLD_GUARDIAN_STILL_RUNNING'}
 $oldProc=Get-Process -Id $original.ProcessId -ErrorAction Stop
 if(-not $oldProc.CloseMainWindow()){throw 'CUTOVER_GUI_CLOSE_REFUSED'}
 $oldClosed=$true
 if(-not (Wait-PortsReleased 12)){
  StopVerifiedResidualPorts $oldPortSnapshot
  if(-not (Wait-PortsReleased 23)){throw 'CUTOVER_OLD_PORTS_NOT_RELEASED'}
 }
 $null=Launch $NewRoot;$newLaunched=$true
 if(-not (Wait-Healthy $NewRoot $TimeoutSeconds)){throw 'CUTOVER_NEW_HEALTH_FAILED'}
 # Switch guardian only once new version is live and healthy.
 Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction Stop
 $guardianChanged=$true
 $g=Join-Path $NewRoot 'scripts\windows\dev-guardian.ps1'
 & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $g -Mode Install
 if($LASTEXITCODE -ne 0){throw 'CUTOVER_NEW_GUARDIAN_FAILED'}
 $check=Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
 if($check.Actions[0].WorkingDirectory -ne $NewRoot){throw 'CUTOVER_NEW_GUARDIAN_NOT_PINNED'}
 (Write-Receipt 'activated' 'new-version-healthy-and-guardian-pinned')|ConvertTo-Json -Compress
 Remove-Watchdog
 exit 0
}catch{
 $reason=[string]$_.Exception.Message
 # Stop only the new version's identified Electron process, never unrelated apps.
 if($newLaunched){
  $np=MainProcess $NewRoot
  if($np){try{(Get-Process -Id $np.ProcessId).CloseMainWindow()|Out-Null}catch{}}
  Start-Sleep -Seconds 3
  try{CleanupCandidatePorts $NewRoot $oldPortSnapshot[8788]}
  catch{$reason+=":"+[string]$_.Exception.Message}
 }
 $restored=$false
 if((MainProcess $OldRoot) -and (Test-Health)){$restored=$true}
 elseif(Wait-PortsReleased 25){
  try{$null=Launch $OldRoot;$restored=Wait-Healthy $OldRoot 90}catch{}
 }
 if($guardianChanged){
  try{
   $g=Join-Path $OldRoot 'scripts\windows\dev-guardian.ps1'
   & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $g -Mode Install | Out-Null
  }catch{}
 }elseif($hadGuardian){
  try{Start-ScheduledTask -TaskName $taskName -ErrorAction Stop}catch{}
 }
 (Write-Receipt 'rolled-back-or-blocked' $reason $restored)|ConvertTo-Json -Compress
 if($restored){Remove-Watchdog}
 exit 4
}