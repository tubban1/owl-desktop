# Windows DEV self-healing guardian. Phase 1: interactive-user logon persistence.
# Not a Windows Service. Does not claim to survive Windows sign-out.
# Maintains existing OWL DEV (Electron-owned 8788/8790) and its independent
# official direct tunnel (18081) without touching legacy Computer MCP (8787).
[CmdletBinding()]
param(
  [ValidateSet('Check','Run','Install','Uninstall')]
  [string]$Mode = 'Check',
  [ValidateRange(10,300)]
  [int]$IntervalSeconds = 20
)
$ErrorActionPreference = 'Stop'
$taskName = 'OWL LAB DEV Guardian'
$project = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).ProviderPath
$devScript = Join-Path $project 'scripts\windows\dev-desktop.ps1'
$tunnelScript = Join-Path $project 'scripts\windows\dev-direct-mcp-tunnel.ps1'
$tunnelMarker = Join-Path $env:APPDATA 'OWL LAB\dev\direct-mcp-tunnel.json'
$logDir = Join-Path $env:LOCALAPPDATA 'OWL LAB\guardian'
$lastDesktopLaunch = [datetime]::MinValue
$lastTunnelLaunch = [datetime]::MinValue
$lastState = ''

function Get-LoopbackPort {
  param([int]$Port)
  $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
  if($listeners.Count -ne 1) { return $false }
  return $listeners[0].LocalAddress -eq '127.0.0.1'
}

function Test-PortOccupied {
  param([int]$Port)
  return @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue).Count -gt 0
}

function Test-OwlHealth {
  param([string]$Url, [string]$ExpectedService)
  try {
    $data = Invoke-RestMethod -Uri $Url -TimeoutSec 3
    return $data.ok -eq $true -and $data.service -eq $ExpectedService
  } catch { return $false }
}

function Read-TunnelId {
  if(-not (Test-Path -LiteralPath $tunnelMarker -PathType Leaf)) { return $null }
  try {
    $marker = Get-Content -LiteralPath $tunnelMarker -Raw | ConvertFrom-Json
    if($marker.tunnelId -notmatch '^tunnel_[a-f0-9]{32}$') { return $null }
    if($marker.mcpPort -ne 8790 -or $marker.healthPort -ne 18081 -or
       $marker.mcpUrl -ne 'http://127.0.0.1:8790/mcp') { return $null }
    return [string]$marker.tunnelId
  } catch { return $null }
}

function Test-OwlTunnel {
  if(-not (Get-LoopbackPort 18081)) { return $false }
  try {
    $data = Invoke-RestMethod -Uri 'http://127.0.0.1:18081/health?details=true' -TimeoutSec 3
    return $data.ready -eq $true -and $data.live -eq $true -and
      $data.components.'control-plane'.status -eq 'ok' -and
      $data.components.dispatcher.status -eq 'ok'
  } catch { return $false }
}

function Get-ProcessForTunnel {
  param([string]$TunnelId)
  # Compare only the exact official tunnel ID. Never touch legacy Computer MCP.
  if(-not $TunnelId) { return @() }
  return @(Get-CimInstance Win32_Process -Filter "Name='tunnel-client.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine.Contains($TunnelId) })
}

function Get-OwlState {
  $runtime = (Get-LoopbackPort 8788) -and
    (Test-OwlHealth 'http://127.0.0.1:8788/health' 'owl-runtime')
  $mcp = (Get-LoopbackPort 8790) -and
    (Test-OwlHealth 'http://127.0.0.1:8790/health' 'owl-mcp')
  $tunnelId = Read-TunnelId
  $tunnel = $mcp -and (Test-OwlTunnel)
  # Only count listening endpoints; "up" never implies sign-out persistence.
  return [pscustomobject]@{
    runtime = [bool]$runtime
    mcp = [bool]$mcp
    tunnel = [bool]$tunnel
    configuredTunnel = [bool]$tunnelId
    tunnelId = $tunnelId
    # Do not expose secrets, tokens, raw process command lines or endpoints.
    scope = 'interactive-user-logon'
    signOutPersistence = 'NOT_SUPPORTED'
  }
}

function Write-GuardianEvent {
  param([string]$EventName, [string]$Reason = '')
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
  $file = Join-Path $logDir 'guardian.jsonl'
  if((Test-Path -LiteralPath $file) -and (Get-Item -LiteralPath $file).Length -gt 4MB) {
    Move-Item -LiteralPath $file -Destination (Join-Path $logDir 'guardian.previous.jsonl') -Force
  }
  $line = @{at=(Get-Date).ToUniversalTime().ToString('o');event=$EventName;
      reason=([string]$Reason).Substring(0,[Math]::Min(160,([string]$Reason).Length))} |
      ConvertTo-Json -Compress
  Add-Content -LiteralPath $file -Value $line -Encoding UTF8
}

function Invoke-GuardianCheck {
  $state = Get-OwlState
  if(-not $state.runtime -or -not $state.mcp) {
    $running = @(Get-CimInstance Win32_Process |
      Where-Object {
        $_.Name -eq 'electron.exe' -and
        $_.CommandLine -and $_.CommandLine.StartsWith($project,[StringComparison]::OrdinalIgnoreCase)
      })
    $portUsed = (Test-PortOccupied 8788) -or (Test-PortOccupied 8790) -or (Test-PortOccupied 5173)
    # If Electron is present or a port is taken, do not start a duplicate or
    # kill another owner's process; operator diagnosis is required.
    if($running.Count -eq 0 -and -not $portUsed -and
       ((Get-Date) - $lastDesktopLaunch).TotalSeconds -ge 90) {
      $lastDesktopLaunch = Get-Date
      Write-GuardianEvent 'desktop_restart_requested' 'runtime_or_mcp_down'
      $args = @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"' + $devScript + '"'))
      Start-Process -FilePath 'powershell.exe' -WorkingDirectory $project -WindowStyle Hidden -ArgumentList $args | Out-Null
    }
  }
  if($state.mcp -and -not $state.tunnel -and $state.configuredTunnel) {
    $processes = @(Get-ProcessForTunnel $state.tunnelId)
    # Let official client reconnect itself if its process exists. Never
    # terminate a tunnel just because a transient health probe failed.
    if($processes.Count -eq 0 -and -not (Test-PortOccupied 18081) -and
       ((Get-Date) - $lastTunnelLaunch).TotalSeconds -ge 90) {
      $lastTunnelLaunch = Get-Date
      Write-GuardianEvent 'tunnel_restart_requested' 'official_tunnel_absent'
      $args = @('-NoProfile','-ExecutionPolicy','Bypass','-File',
        ('"' + $tunnelScript + '"'),'-TunnelId',$state.tunnelId)
      Start-Process -FilePath 'powershell.exe' -WorkingDirectory $project -WindowStyle Hidden -ArgumentList $args | Out-Null
    }
  }
  $tag = "runtime=$($state.runtime),mcp=$($state.mcp),tunnel=$($state.tunnel)"
  if($tag -ne $lastState) {
    Write-GuardianEvent 'observed_state' $tag
    $script:lastState = $tag
  }
  return $state
}

if($Mode -eq 'Check') {
  $state = Get-OwlState
  [pscustomobject]@{
    mode='Check'
    time=(Get-Date).ToUniversalTime().ToString('o')
    root=$project
    runtime=$state.runtime
    mcp=$state.mcp
    tunnel=$state.tunnel
    tunnelConfigured=$state.configuredTunnel
    scope=$state.scope
    signOutPersistence=$state.signOutPersistence
    taskPresent=[bool](Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue)
  } | ConvertTo-Json -Compress
  exit 0
}

if($Mode -eq 'Install') {
  if(-not (Test-Path -LiteralPath $devScript) -or -not (Test-Path -LiteralPath $tunnelScript)) {
    throw 'OWL_GUARDIAN_DEV_COMPONENTS_MISSING'
  }
  if(-not (Read-TunnelId)) { throw 'OWL_GUARDIAN_OFFICIAL_TUNNEL_CONFIGURATION_MISSING' }
  if(Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    throw 'OWL_GUARDIAN_TASK_ALREADY_INSTALLED'
  }
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  $args = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' +
    $PSCommandPath + '" -Mode Run -IntervalSeconds ' + $IntervalSeconds
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $args -WorkingDirectory $project
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
  $principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -ErrorAction Stop | Out-Null
  Write-GuardianEvent 'installed' 'logon_user_session_only'
  # Start now instead of waiting for the next interactive sign-in.
  Start-ScheduledTask -TaskName $taskName
  Write-Output 'OWL_GUARDIAN_LOGON_TASK_INSTALLED_NOT_SIGNOUT_PERSISTENT'
  exit 0
}

if($Mode -eq 'Uninstall') {
  if(Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  }
  Write-GuardianEvent 'uninstalled' 'user_opt_out'
  Write-Output 'OWL_GUARDIAN_TASK_REMOVED'
  exit 0
}

if($Mode -ne 'Run') { throw 'OWL_GUARDIAN_MODE_INVALID' }
$created = $false
$mutex = New-Object System.Threading.Mutex($true, 'Local\OWL-LAB-DEV-GUARDIAN-V1', [ref]$created)
if(-not $created) { Write-GuardianEvent 'duplicate_refused'; exit 0 }
Write-GuardianEvent 'guardian_started' 'interactive_user_only'
try {
  while($true) {
    try { $null = Invoke-GuardianCheck }
    catch { Write-GuardianEvent 'check_error' $_.Exception.GetType().Name }
    Start-Sleep -Seconds $IntervalSeconds
  }
} finally {
  if($created) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
