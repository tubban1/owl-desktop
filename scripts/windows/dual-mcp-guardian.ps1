# Independent Windows dual-MCP watchdog. Opt-in only; never owns either tunnel.
# No process killing, credentials, admin elevation, or machine-wide settings.
# Can nudge pre-existing, ownership-checked recovery tasks if exactly one
# *locally healthy* independent MCP remains. Local health != tunnel health.
[CmdletBinding()]
param(
  [ValidateSet('Check','Run','Install','Uninstall')]
  [string]$Mode = 'Check',
  [ValidateRange(30,300)]
  [int]$IntervalSeconds = 60,
  [string]$ComputerTaskName = 'Computer MCP Recovery'
)
$ErrorActionPreference = 'Stop'
$watchdogName = 'OWL LAB Dual MCP Watchdog'
$owlTaskName = 'OWL LAB DEV Guardian'
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).ProviderPath
$stateDir = Join-Path $env:LOCALAPPDATA 'OWL LAB\dual-mcp'
$logFile = Join-Path $stateDir 'watchdog.jsonl'
# Prevent command-line quoting tricks in Scheduled Task creation.
if($ComputerTaskName -notmatch '^[A-Za-z0-9][A-Za-z0-9 _.\-]{2,63}$') {
  throw 'INVALID_COMPUTER_RECOVERY_TASK_NAME'
}

function Test-LocalHealth([int]$Port,[string]$Service) {
  # Require the expected HTTP responder on loopback, not just an occupied port.
  try {
    $connections = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop)
    if($connections.Count -ne 1 -or $connections[0].LocalAddress -ne '127.0.0.1') { return $false }
    $result = Invoke-RestMethod -Uri ("http://127.0.0.1:$Port/health") -TimeoutSec 3 -ErrorAction Stop
    return ($result.ok -eq $true -and $result.service -eq $Service)
  } catch { return $false }
}

function Test-PortBusy([int]$Port) {
  return @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue).Count -gt 0
}

function Get-DualState {
  $computer = Test-LocalHealth 8787 'computer-mcp'
  $owl = Test-LocalHealth 8790 'owl-mcp'
  $runtime = Test-LocalHealth 8788 'owl-runtime'
  # Distinct from both MCP services. This check is diagnostic only.
  $tunnel = $false
  try {
    $health = Invoke-RestMethod 'http://127.0.0.1:18081/health?details=true' -TimeoutSec 3
    $tunnel = ($health.ready -eq $true -and $health.live -eq $true)
  } catch {}
  return [pscustomobject]@{
    computerMcp=$computer
    owlMcp=$owl
    owlRuntime=$runtime
    owlTunnel=$tunnel
    computerTunnel='UNKNOWN'
    chatgptConnection='NOT_VERIFIABLE_FROM_LOCAL_HEALTH'
    bothHealthy=($computer -and $owl)
    survivingChannel= $(if($computer -and -not $owl) {'computer'}
      elseif($owl -and -not $computer) {'owl'} elseif($computer -and $owl) {'both'} else {'none'})
    signOutSurvival='NOT_VERIFIED'
  }
}

function Write-DualEvent([string]$Event,[string]$Target,[string]$Result) {
  New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
  $out = @{utc=(Get-Date).ToUniversalTime().ToString('o');event=$Event;target=$Target;result=$Result} |
    ConvertTo-Json -Compress
  Add-Content -LiteralPath $logFile -Value $out -Encoding UTF8
}

function Get-ValidatedTask([string]$Target) {
  $taskName = $(if($Target -eq 'owl') {$owlTaskName} else {$ComputerTaskName})
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if(-not $task) { return $null }
  $actions = @($task.Actions)
  if($actions.Count -ne 1) { return $null }
  $action = $actions[0]
  $signature = "$($action.Execute) $($action.Arguments) $($action.WorkingDirectory)"
  # Verify expected project-specific recovery code, not arbitrary named tasks.
  if($Target -eq 'owl') {
    if($signature -notmatch '(?i)dev-guardian\.ps1' -or
       $signature -notmatch '(?i)owl-desktop' -or
       $signature -notmatch '(?i)-Mode Run') { return $null }
  } else {
    if($signature -notmatch '(?i)computer-mcp' -or
       $signature -match '(?i)owl-desktop') { return $null }
  }
  return $task
}

function Invoke-SafeRecover([string]$Target,[object]$State) {
  if($Target -notin @('owl','computer')) { throw 'INVALID_TARGET' }
  $survivor = $(if($Target -eq 'owl') {$State.computerMcp} else {$State.owlMcp})
  $targetHealthy = $(if($Target -eq 'owl') {$State.owlMcp} else {$State.computerMcp})
  if(-not $survivor) { return 'REFUSED_NO_HEALTHY_ALTERNATIVE' }
  if($targetHealthy) { return 'ALREADY_HEALTHY' }
  $ports = $(if($Target -eq 'owl') {@(8788,8790)} else {@(8787)})
  foreach($port in $ports) { if(Test-PortBusy $port) { return 'REFUSED_PORT_OWNED_OR_HUNG' } }
  $task = Get-ValidatedTask $Target
  if(-not $task) { return 'REFUSED_NO_VERIFIED_RECOVERY_TASK' }
  # Start an existing independently provisioned launcher. Never terminate either service.
  Start-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath
  Write-DualEvent 'restart_requested' $Target 'SCHEDULED_TASK_STARTED'
  return 'RESTART_REQUESTED'
}

if($Mode -eq 'Check') {
  $state = Get-DualState
  $state | Add-Member -NotePropertyName owlRecoveryTaskVerified -NotePropertyValue ([bool](Get-ValidatedTask 'owl'))
  $state | Add-Member -NotePropertyName computerRecoveryTaskVerified -NotePropertyValue ([bool](Get-ValidatedTask 'computer'))
  $state | Add-Member -NotePropertyName watchdogInstalled -NotePropertyValue ([bool](Get-ScheduledTask -TaskName $watchdogName -ErrorAction SilentlyContinue))
  $state | ConvertTo-Json -Compress
  exit 0
}
if($Mode -eq 'Install') {
  if(-not (Get-ValidatedTask 'owl') -or -not (Get-ValidatedTask 'computer')) {
    throw 'DUAL_MCP_BOTH_TRUSTED_RECOVERY_TASKS_REQUIRED'
  }
  $state=Get-DualState
  if(-not $state.bothHealthy) { throw 'DUAL_MCP_INSTALL_REQUIRES_BOTH_MCP_HEALTHY' }
  if(Get-ScheduledTask -TaskName $watchdogName -ErrorAction SilentlyContinue) {
    throw 'DUAL_MCP_ALREADY_INSTALLED'
  }
  $user=[Security.Principal.WindowsIdentity]::GetCurrent().Name
  $args='-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "'+$PSCommandPath+'" -Mode Run -IntervalSeconds '+$IntervalSeconds+' -ComputerTaskName "'+$ComputerTaskName+'"'
  $action=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $args -WorkingDirectory $root
  $trigger=New-ScheduledTaskTrigger -AtLogOn -User $user
  $principal=New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
  $settings=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)
  Register-ScheduledTask -TaskName $watchdogName -Action $action -Trigger $trigger -Principal $principal -Settings $settings | Out-Null
  Start-ScheduledTask -TaskName $watchdogName
  Write-DualEvent 'installed' 'both' 'INTERACTIVE_LOGON_ONLY'
  exit 0
}
if($Mode -eq 'Uninstall') {
  if(Get-ScheduledTask -TaskName $watchdogName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $watchdogName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $watchdogName -Confirm:$false
  }
  Write-DualEvent 'uninstalled' 'both' 'OPT_OUT'
  exit 0
}
if($Mode -ne 'Run') { throw 'INVALID_MODE' }
$created=$false
$mutex=New-Object System.Threading.Mutex($true,'Local\OWL-LAB-DUAL-MCP-WATCHDOG-V1',[ref]$created)
if(-not $created) { exit 0 }
$unhealthyComputer=0
$unhealthyOwl=0
$lastActionComputer=[datetime]::MinValue
$lastActionOwl=[datetime]::MinValue
try {
  while($true) {
    try {
      $state=Get-DualState
      $unhealthyComputer=$(if($state.owlMcp -and -not $state.computerMcp) {$unhealthyComputer+1} else {0})
      $unhealthyOwl=$(if($state.computerMcp -and -not $state.owlMcp) {$unhealthyOwl+1} else {0})
      # Require three consecutive failed probes, then a cooldown of 10 minutes.
      if($unhealthyComputer -ge 3 -and ((Get-Date)-$lastActionComputer).TotalMinutes -ge 10) {
        $lastActionComputer=Get-Date
        $result=Invoke-SafeRecover 'computer' $state
        Write-DualEvent 'recover_attempt' 'computer' $result
      }
      if($unhealthyOwl -ge 3 -and ((Get-Date)-$lastActionOwl).TotalMinutes -ge 10) {
        $lastActionOwl=Get-Date
        $result=Invoke-SafeRecover 'owl' $state
        Write-DualEvent 'recover_attempt' 'owl' $result
      }
    } catch { Write-DualEvent 'check_error' 'none' $_.Exception.GetType().Name }
    Start-Sleep -Seconds $IntervalSeconds
  }
} finally {
  if($created) {$mutex.ReleaseMutex()}
  $mutex.Dispose()
}
