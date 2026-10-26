# Windows SCM Background Host: explicit admin staging and protected service credentials.
# This script never installs/restarts anything in Check or Build mode.
[CmdletBinding()]
param(
 [ValidateSet('Check','Build','Stage','Provision','Install','Uninstall')]
 [string]$Mode='Check',
 [string]$RuntimeRoot,[string]$McpRoot,[string]$TunnelExe,
 [string]$PublicKeyFile,[string]$AllowedDirectories,[string]$StateRoot,
 [string]$TunnelId,[switch]$Rotate,[switch]$PurgeCredentials
)
$ErrorActionPreference='Stop'
$name='OwlLabBackgroundHost'
$root=Join-Path $env:ProgramData 'OWL LAB\BackgroundHost'
$exe=Join-Path $root 'OwlBackgroundHostService.exe'
$cfg=Join-Path $root 'service-config.json'
$secrets=Join-Path $root 'credentials.dpapi'
$worker=Join-Path $root 'background-host-supervisor.mjs'

function Assert-Admin {
 $id=[Security.Principal.WindowsIdentity]::GetCurrent()
 if(-not ([Security.Principal.WindowsPrincipal]$id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){
   throw 'BACKGROUND_ADMIN_REQUIRED'
 }
}
function Assert-Staged {
 foreach($p in @($exe,$cfg,$worker,(Join-Path $root 'node.exe'))){
   if(-not(Test-Path -LiteralPath $p -PathType Leaf)){throw 'BACKGROUND_COMPONENT_NOT_STAGED'}
 }
 & (Join-Path $root 'node.exe') $worker --check-config
 if($LASTEXITCODE -ne 0){throw 'BACKGROUND_CONFIG_INVALID'}
}
function Restrict-Folder {
 & icacls.exe $root '/inheritance:r' '/grant:r' '*S-1-5-19:(OI)(CI)RX' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-18:(OI)(CI)F' | Out-Null
 if($LASTEXITCODE -ne 0){throw 'BACKGROUND_FOLDER_ACL_FAILED'}
}
function Secure-Prompt([string]$message) {
 $s=Read-Host -Prompt $message -AsSecureString
 $ptr=[IntPtr]::Zero
 try{
   $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
   return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
 }finally{
   if($ptr -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}
   $s.Dispose()
 }
}
if($Mode -eq 'Check'){
 $svc=Get-CimInstance Win32_Service -Filter "Name='$name'" -ErrorAction SilentlyContinue
 [pscustomobject]@{
   service=if($svc){$svc.State}else{'NotInstalled'}
   staged=[bool](Test-Path -LiteralPath $exe)
   credentialsPresent=[bool](Test-Path -LiteralPath $secrets)
   signOutSurvival='NOT_VERIFIED'
 }|ConvertTo-Json -Compress
 exit 0
}
Assert-Admin
if($Mode -eq 'Build'){
 $source=Join-Path $PSScriptRoot 'OwlBackgroundHostService.cs'
 $csc='C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
 if(-not(Test-Path $source) -or -not(Test-Path $csc)){throw 'BACKGROUND_COMPILER_MISSING'}
 New-Item -ItemType Directory -Force -Path $root | Out-Null
 Restrict-Folder
 & $csc /nologo /target:exe /platform:anycpu "/out:$exe" /r:System.ServiceProcess.dll /r:System.Security.dll $source
 if($LASTEXITCODE -ne 0){throw 'BACKGROUND_COMPILE_FAILED'}
 Write-Output 'BACKGROUND_SERVICE_BINARY_BUILT'
 exit 0
}
if($Mode -eq 'Stage'){
 if(-not(Test-Path $exe)){throw 'BACKGROUND_BUILD_FIRST'}
 foreach($k in @('RuntimeRoot','McpRoot','TunnelExe','PublicKeyFile','AllowedDirectories','StateRoot','TunnelId')){
   if(-not(Get-Variable $k -ValueOnly -ErrorAction SilentlyContinue)){throw ('BACKGROUND_STAGE_MISSING_'+$k)}
 }
 if($TunnelId -notmatch '^tunnel_[a-f0-9]{32}$'){throw 'BACKGROUND_TUNNEL_ID_INVALID'}
 $usersRoot=Join-Path (Split-Path $env:USERPROFILE -Parent) ''
 foreach($p in @($RuntimeRoot,$McpRoot,$TunnelExe,$PublicKeyFile,$AllowedDirectories,$StateRoot)){
   if(-not [IO.Path]::IsPathRooted($p) -or $p.StartsWith($usersRoot,[StringComparison]::OrdinalIgnoreCase)){
     throw 'BACKGROUND_USER_PROFILE_PATH_REFUSED'
   }
 }
 foreach($p in @($RuntimeRoot,$McpRoot,$TunnelExe,$PublicKeyFile,$AllowedDirectories,$StateRoot)){
   if(-not $p.StartsWith(($root+[IO.Path]::DirectorySeparatorChar),[StringComparison]::OrdinalIgnoreCase)){
     throw 'BACKGROUND_OUTSIDE_PROTECTED_STAGE'
   }
 }
 foreach($p in @($RuntimeRoot,$McpRoot,$AllowedDirectories,$StateRoot)){
   if(-not(Test-Path -LiteralPath $p -PathType Container)){throw 'BACKGROUND_DIRECTORY_MISSING'}
 }
 foreach($p in @($TunnelExe,$PublicKeyFile)){
   if(-not(Test-Path -LiteralPath $p -PathType Leaf)){throw 'BACKGROUND_FILE_MISSING'}
 }
 if(Get-Service -Name $name -ErrorAction SilentlyContinue){throw 'BACKGROUND_SERVICE_ALREADY_REGISTERED'}
 $node=(Get-Command node.exe -ErrorAction Stop).Source
 Copy-Item -LiteralPath $node -Destination (Join-Path $root 'node.exe') -Force
 Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'background-host-supervisor.mjs') -Destination $worker -Force
 $c=[ordered]@{
   nodeExe=(Join-Path $root 'node.exe')
   runtimeEntry=(Join-Path $RuntimeRoot 'dist\server.js')
   runtimeRoot=$RuntimeRoot
   mcpEntry=(Join-Path $McpRoot 'mcp\server.mjs')
   mcpRoot=$McpRoot
   tunnelExe=$TunnelExe
   tunnelId=$TunnelId
   publicKeyFile=$PublicKeyFile
   stateRoot=$StateRoot
   allowedDirectories=$AllowedDirectories
 }
 [IO.File]::WriteAllText($cfg,($c|ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false))
 Restrict-Folder
 & icacls.exe $StateRoot '/grant:r' '*S-1-5-19:(OI)(CI)M' | Out-Null
 if($LASTEXITCODE -ne 0){throw 'BACKGROUND_STATE_ACL_FAILED'}
 Assert-Staged
 Write-Output 'BACKGROUND_STAGED_NOT_INSTALLED'
 exit 0
}
if($Mode -eq 'Provision'){
 Assert-Staged
 if((Test-Path $secrets) -and -not $Rotate){throw 'BACKGROUND_CREDENTIAL_ALREADY_EXISTS'}
 $a=Secure-Prompt 'New independent service Runtime token'
 $b=Secure-Prompt 'New independent service MCP token'
 $c=Secure-Prompt 'New independent service Tunnel control-plane key'
 try{
   $info=New-Object Diagnostics.ProcessStartInfo
   $info.FileName=$exe
   $info.Arguments=if($Rotate){'--provision --rotate'}else{'--provision'}
   $info.UseShellExecute=$false
   $info.RedirectStandardInput=$true
   $info.RedirectStandardOutput=$true
   $info.CreateNoWindow=$true
   $proc=[Diagnostics.Process]::Start($info)
   try{
     $proc.StandardInput.WriteLine($a)
     $proc.StandardInput.WriteLine($b)
     $proc.StandardInput.WriteLine($c)
     $proc.StandardInput.Close()
     if(-not $proc.WaitForExit(15000)){$proc.Kill();throw 'BACKGROUND_PROVISION_TIMEOUT'}
     if($proc.ExitCode -ne 0){throw 'BACKGROUND_PROVISION_FAILED'}
   }finally{$proc.Dispose()}
 }finally{$a=$null;$b=$null;$c=$null}
 & icacls.exe $secrets '/inheritance:r' '/grant:r' '*S-1-5-19:R' '*S-1-5-32-544:F' '*S-1-5-18:F' | Out-Null
 if($LASTEXITCODE -ne 0){throw 'BACKGROUND_SECRET_ACL_FAILED'}
 Write-Output 'BACKGROUND_SERVICE_CREDENTIALS_PROVISIONED'
 exit 0
}
if($Mode -eq 'Install'){
 Assert-Staged
 if(-not(Test-Path $secrets -PathType Leaf)){throw 'BACKGROUND_SERVICE_CREDENTIAL_REQUIRED'}
 if(Get-Service -Name $name -ErrorAction SilentlyContinue){throw 'BACKGROUND_ALREADY_REGISTERED'}
 foreach($port in @(8788,8790,18081)){
   if(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue){
     throw ('BACKGROUND_PORT_IN_USE_'+$port)
   }
 }
 $guardian=Get-ScheduledTask -TaskName 'OWL LAB DEV Guardian' -ErrorAction SilentlyContinue
 if($guardian -and [string]$guardian.State -eq 'Running'){throw 'BACKGROUND_STOP_DEV_GUARDIAN_BEFORE_CUTOVER'}
 $binaryPath='binPath= "'+$exe+'"'
 & sc.exe create $name $binaryPath 'start= auto' 'obj= NT AUTHORITY\LocalService' 'DisplayName= OWL LAB Background Host'
 if($LASTEXITCODE -ne 0){throw 'BACKGROUND_SCM_CREATE_FAILED'}
 & sc.exe sidtype $name unrestricted | Out-Null
 & sc.exe failure $name 'reset= 86400' 'actions= restart/5000/restart/30000/restart/60000' | Out-Null
 Write-Output 'BACKGROUND_SERVICE_REGISTERED_NOT_STARTED'
 exit 0
}
if($Mode -eq 'Uninstall'){
 $svc=Get-Service -Name $name -ErrorAction SilentlyContinue
 if($svc){
   if($svc.Status -ne 'Stopped'){Stop-Service -Name $name -ErrorAction Stop}
   & sc.exe delete $name
   if($LASTEXITCODE -ne 0){throw 'BACKGROUND_SCM_DELETE_FAILED'}
 }
 if($PurgeCredentials -and (Test-Path $secrets)){Remove-Item -LiteralPath $secrets -Force}
 Write-Output 'BACKGROUND_SERVICE_UNREGISTERED'
 exit 0
}
throw 'BACKGROUND_INSTALL_MODE_INVALID'
