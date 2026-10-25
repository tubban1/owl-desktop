# OWL LAB native Chrome host installer (Windows 10+, per-user HKCU).
# Dry-run/isolated acceptance: use -SkipRegistration -InstallRoot <allowlisted-test-dir>.
# Real installation requires a running OWL Connection Host-generated broker config.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-p]{32}$')][string]$ExtensionId,
  [Parameter(Mandatory=$true)][string]$NodeExe,
  [Parameter(Mandatory=$true)][string]$HostScript,
  [Parameter(Mandatory=$true)][string]$BrokerConfig,
  [string]$InstallRoot = '',
  [switch]$SkipRegistration,
  [switch]$ReplaceRegistration
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if([IntPtr]::Size -lt 8){ throw 'WINDOWS_64BIT_REQUIRED' }
if($env:OS -ne 'Windows_NT') {
  throw 'WINDOWS_INSTALLER_ONLY'
}
$source=Join-Path $PSScriptRoot 'native-host-launcher.cs'
if(-not (Test-Path -LiteralPath $source -PathType Leaf)){throw 'MISSING_NATIVE_LAUNCHER_SOURCE'}
$node=(Resolve-Path -LiteralPath $NodeExe -ErrorAction Stop).ProviderPath
$script=(Resolve-Path -LiteralPath $HostScript -ErrorAction Stop).ProviderPath
$broker=(Resolve-Path -LiteralPath $BrokerConfig -ErrorAction Stop).ProviderPath
foreach($p in @($node,$script,$broker)) {
  if(-not (Test-Path -LiteralPath $p -PathType Leaf)){throw 'NATIVE_HOST_DEPENDENCY_NOT_FILE'}
}
# Do not register a host pointing to an unusable or malformed broker config.
# No credentials are echoed, written to the EXE or included in logs.
if(-not $SkipRegistration){
  $info=(Get-Content -LiteralPath $broker -Raw -Encoding UTF8 | ConvertFrom-Json)
  if($info.port -lt 1 -or $info.port -gt 65535 -or $info.token -notmatch '^[a-f0-9]{64}$') {
    throw 'WINDOWS_BROKER_CONFIG_INVALID'
  }
}
if($InstallRoot){
  $dir=[IO.Path]::GetFullPath($InstallRoot)
}else{
  $dir=Join-Path $env:LOCALAPPDATA 'OWL LAB\NativeMessaging'
}
if(-not (Test-Path -LiteralPath $dir)){New-Item -ItemType Directory -Path $dir -Force | Out-Null}
$dir=(Resolve-Path -LiteralPath $dir).ProviderPath
if((Get-Item -LiteralPath $dir).Attributes -band [IO.FileAttributes]::ReparsePoint){
  throw 'NATIVE_INSTALL_DIR_REPARSE_POINT'
}
# Restrict stored launcher/manifest to current user, SYSTEM, Administrators.
$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$allowed=@($sid,'S-1-5-18','S-1-5-32-544')
$grants=@($allowed|ForEach-Object { "*${_}:(OI)(CI)F" })
& icacls.exe $dir /inheritance:r /grant:r $grants | Out-Null
if($LASTEXITCODE -ne 0){throw 'NATIVE_INSTALL_DACL_FAILED'}
$acl=Get-Acl -LiteralPath $dir
if(-not $acl.AreAccessRulesProtected){throw 'NATIVE_INSTALL_DACL_UNPROTECTED'}
foreach($ace in $acl.Access){
  $x=$ace.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
  if($x -notin $allowed){throw 'NATIVE_INSTALL_DACL_UNEXPECTED_ACE'}
}
$bytes=[Text.Encoding]::UTF8
function Encode([string]$value){[Convert]::ToBase64String($bytes.GetBytes($value))}
$code=[IO.File]::ReadAllText($source)
$code=$code.Replace('__OWL_EXTENSION_ID__',$ExtensionId)
$code=$code.Replace('__OWL_NODE_B64__',(Encode $node))
$code=$code.Replace('__OWL_SCRIPT_B64__',(Encode $script))
$code=$code.Replace('__OWL_BROKER_B64__',(Encode $broker))
$launcher=Join-Path $dir 'owl-native-message-host.exe'
$temporary=Join-Path $dir 'owl-native-message-host-stage.exe'
if(Test-Path -LiteralPath $temporary){Remove-Item -LiteralPath $temporary -Force}
Add-Type -TypeDefinition $code -OutputAssembly $temporary -OutputType ConsoleApplication -ErrorAction Stop
if(-not (Test-Path -LiteralPath $temporary)){throw 'NATIVE_HOST_COMPILE_FAILED'}
# Validate a bad origin fails closed before registering the host.
$invalid=Start-Process -FilePath $temporary -ArgumentList 'chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/' -NoNewWindow -PassThru -Wait
if($invalid.ExitCode -ne 12){throw 'NATIVE_HOST_INVALID_ORIGIN_NOT_REJECTED'}
$manifest=Join-Path $dir 'ai.owl.lab.agent.json'
$json=@{
 name='ai.owl.lab.agent';
 description='OWL LAB Agent Browser local Native Messaging host';
 path=$launcher;
 type='stdio';
 allowed_origins=@("chrome-extension://$ExtensionId/")
}|ConvertTo-Json -Depth 5
# Manifest first, then launcher. Existing registered path remains intact on failure.
if((Test-Path $launcher) -and -not $ReplaceRegistration){
  throw 'NATIVE_HOST_ALREADY_EXISTS_USE_REPLACE_REGISTRATION'
}
[IO.File]::WriteAllText($manifest,$json+"`n",[Text.UTF8Encoding]::new($false))
Move-Item -LiteralPath $temporary -Destination $launcher -Force
if(-not $SkipRegistration){
 $key='HKCU:\Software\Google\Chrome\NativeMessagingHosts\ai.owl.lab.agent'
 if(Test-Path $key){
   if(-not $ReplaceRegistration){throw 'NATIVE_HOST_REGISTRATION_EXISTS'}
 }else{New-Item -Path $key -Force | Out-Null}
 Set-Item -Path $key -Value $manifest -ErrorAction Stop
}
[pscustomobject]@{
  ok=$true;registered=(-not $SkipRegistration);
  binary=$launcher;manifest=$manifest;extensionId=$ExtensionId;
  note='No Chrome restart or account state changes. Extension must be loaded to connect.'
}|ConvertTo-Json -Compress
