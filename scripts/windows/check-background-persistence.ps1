# Read-only Windows OWL MCP availability and persistence audit.
# Compatible with Windows PowerShell 5.1. No secret values, process arguments,
# registry mutations, service creation, or interactive session controls.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'

function ListenerStatus([int]$Port) {
  $tcp = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
  if ($tcp.Count -ne 1) {
    return [pscustomobject]@{ port=$Port; listening=($tcp.Count -gt 0);
      singleton=($tcp.Count -eq 1); pid=$null; localAddress=$null; session=$null;
      ownerKind='not_proven'; knownService=$false }
  }
  $processId = [int]$tcp[0].OwningProcess
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$processId" -ErrorAction SilentlyContinue
  if (-not $proc) {
    return [pscustomobject]@{ port=$Port; listening=$true; singleton=$true;
      pid=$processId; localAddress=[string]$tcp[0].LocalAddress; session=$null; ownerKind='not_proven'; knownService=$false }
  }
  $app = Get-Process -Id $processId -ErrorAction SilentlyContinue
  $svc = @(Get-CimInstance Win32_Service -Filter "ProcessId=$processId" -ErrorAction SilentlyContinue)
  $seen = @{}
  $current = $proc
  $ancestors = @()
  for ($i=0; $i -lt 12 -and $null -ne $current; $i++) {
    $id = [int]$current.ProcessId
    if ($seen.ContainsKey($id)) {break}
    $seen[$id] = $true
    $ancestors += [string]$current.Name
    $parent = [int]$current.ParentProcessId
    if ($parent -le 0) {break}
    $current = Get-CimInstance Win32_Process -Filter "ProcessId=$parent" -ErrorAction SilentlyContinue
  }
  $interactive = @($ancestors | Where-Object {$_ -match '^(electron\.exe|chrome\.exe)$'}).Count -gt 0
  $kind = if($svc.Count -gt 0) {'windows_service'}
          elseif ($interactive) {'interactive_child'}
          else {'not_proven'}
  return [pscustomobject]@{
    port=$Port; listening=$true; singleton=$true; pid=$processId;
    localAddress=[string]$tcp[0].LocalAddress;
    session=if($app){$app.SessionId}else{$null};
    ownerKind=$kind; knownService=($svc.Count -gt 0)
  }
}

$runtime = ListenerStatus 8788
$mcp = ListenerStatus 8790
$tunnel = ListenerStatus 18081
$tasks = @()
try {
  $tasks = @(Get-ScheduledTask -ErrorAction Stop |
    Where-Object {$_.TaskName -like 'OWL LAB*' -or $_.TaskPath -like '*OWL LAB*'} |
    ForEach-Object {
      [pscustomobject]@{name=$_.TaskName;state=[string]$_.State;
        logonType=[string]$_.Principal.LogonType}
    })
} catch { $tasks = @() }

$service = @()
try {
  $service = @(Get-CimInstance Win32_Service -ErrorAction Stop |
    Where-Object {$_.Name -like 'OWL*' -or $_.DisplayName -like 'OWL LAB*'} |
    ForEach-Object {
      [pscustomobject]@{ name=$_.Name;status=$_.State;
        startMode=$_.StartMode;pid=[int]$_.ProcessId }
    })
} catch { $service = @() }

$hasActiveService = @($service | Where-Object {$_.status -eq 'Running' -and $_.startMode -eq 'Auto'}).Count -gt 0
# A running service alone does not prove the actual Runtime/MCP/Tunnel
# survives sign-out, especially with credentials from the interactive user.
$pass = $runtime.listening -and $mcp.listening -and $tunnel.listening -and
  $runtime.singleton -and $mcp.singleton -and $tunnel.singleton -and
  $runtime.localAddress -eq '127.0.0.1' -and
  $mcp.localAddress -eq '127.0.0.1' -and
  $tunnel.localAddress -eq '127.0.0.1'
$reply = [ordered]@{
  version = 1
  checkedAt = (Get-Date).ToUniversalTime().ToString('o')
  coreOnline = [bool]$pass
  persistentAfterSignOut = 'NOT_VERIFIED'
  runtime = $runtime
  mcp = $mcp
  tunnel = $tunnel
  registeredServices = @($service)
  registeredTasks = @($tasks)
  runningAutoService = [bool]$hasActiveService
  nextStep = if ($pass) {
    'Sign-out/reboot tests and protected service credential validation required'
  } else {
    'Runtime/MCP/Tunnel must run independently of the Desktop user session'
  }
}
$reply | ConvertTo-Json -Depth 7 -Compress
