# A one-device, out-of-process DEV cutover. Run from a separately scheduled
# PowerShell, NEVER as a child owned by the OWL Electron process being replaced.
# Keeps original root untouched. Fail closed and try rolling back old launcher.
[CmdletBinding()]
param(
 [ValidateSet('Check','Cutover')][string]$Mode='Check',
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
  computerBackupPortListening=[bool](PortBusy 8787)}
 $tmp=Join-Path $state ('cutover-'+[guid]::NewGuid().ToString('N')+'.tmp')
 $final=Join-Path $state 'cutover-last.json'
 try{$receipt|ConvertTo-Json -Depth 4|Set-Content -LiteralPath $tmp -Encoding UTF8
  Move-Item -LiteralPath $tmp -Destination $final -Force}
 finally{Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue}
 return $receipt
}
$OldRoot=Assert-Root $OldRoot $ExpectedOldSha
$NewRoot=Assert-Root $NewRoot $ExpectedNewSha
if($OldRoot -eq $NewRoot){throw 'CUTOVER_SAME_ROOT'}
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
$journal=Write-Receipt 'started' 'guarded-cutover-begun'
$hadGuardian=$false
$oldClosed=$false
$newLaunched=$false
$guardianChanged=$false
try{
 Stop-ScheduledTask -TaskName $taskName -ErrorAction Stop
 $hadGuardian=$true
 $oldProc=Get-Process -Id $original.ProcessId -ErrorAction Stop
 if(-not $oldProc.CloseMainWindow()){throw 'CUTOVER_GUI_CLOSE_REFUSED'}
 $oldClosed=$true
 if(-not (Wait-PortsReleased 35)){throw 'CUTOVER_OLD_PORTS_NOT_RELEASED'}
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
 exit 0
}catch{
 $reason=[string]$_.Exception.Message
 # Stop only the new version's identified Electron process, never unrelated apps.
 if($newLaunched){
  $np=MainProcess $NewRoot
  if($np){try{(Get-Process -Id $np.ProcessId).CloseMainWindow()|Out-Null}catch{}}
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
 exit 4
}
