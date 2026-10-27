# Windows SCM Background Host: explicit admin staging and protected service credentials.
# This script never installs/restarts anything in Check or Build mode.
[CmdletBinding()]
param(
 [ValidateSet('Check','Build','Prepare','Stage','Provision','ProvisionCloudApproved','Install','Uninstall')]
 [string]$Mode='Check',
 [string]$RuntimeRoot,[string]$McpRoot,[string]$TunnelExe,
 [string]$PublicKeyFile,[string]$AllowedDirectories,[string]$StateRoot,
 [string]$TunnelId,[string]$DevRepo,[string]$RuntimeRepo,[string]$TunnelDirectory,[string]$PublicKeySource,[switch]$Rotate,[switch]$PurgeCredentials
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
 # Supervisor reads the non-secret JSON path from its process environment.
 # Keep this scoped to this check; do not permanently mutate the admin shell
 # or inherit credentials from the interactive Desktop.
 $previousConfigPath=[Environment]::GetEnvironmentVariable('OWL_BACKGROUND_CONFIG_PATH','Process')
 try {
   [Environment]::SetEnvironmentVariable('OWL_BACKGROUND_CONFIG_PATH',$cfg,'Process')
   & (Join-Path $root 'node.exe') $worker --check-config
   $validationExit=$LASTEXITCODE
 } finally {
   [Environment]::SetEnvironmentVariable('OWL_BACKGROUND_CONFIG_PATH',$previousConfigPath,'Process')
 }
 if($validationExit -ne 0){throw 'BACKGROUND_CONFIG_INVALID'}
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
 # Users are intentionally denied traversal of the protected ProgramData
 # directory. Check remains read-only and returns 'Restricted' rather than
 # throwing a misleading access-denied error on non-admin MCP connections.
 function FileAccess([string]$file){
   try { return [bool](Test-Path -LiteralPath $file -PathType Leaf -ErrorAction Stop) }
   catch [System.UnauthorizedAccessException] { return 'Restricted' }
   catch { return 'Restricted' }
 }
 [pscustomobject]@{
   service=if($svc){$svc.State}else{'NotInstalled'}
   staged=(FileAccess $exe)
   credentialsPresent=(FileAccess $secrets)
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
if($Mode -eq 'Prepare'){
 # Source-tree snapshot only. Explicit administrator action; NEVER registers,
 # starts or stops a service or accesses Electron CurrentUser credentials.
 # The source repo must be a clean main checkout, matching the remote ref.
 if(-not(Test-Path -LiteralPath $exe -PathType Leaf)){throw 'BACKGROUND_BUILD_FIRST'}
 foreach($k in @('DevRepo','RuntimeRepo','TunnelDirectory','PublicKeySource')){
   if(-not(Get-Variable $k -ValueOnly -ErrorAction SilentlyContinue)){throw ('BACKGROUND_PREPARE_MISSING_'+$k)}
 }
 $dev=(Resolve-Path -LiteralPath $DevRepo -ErrorAction Stop).ProviderPath
 $runtime=(Resolve-Path -LiteralPath $RuntimeRepo -ErrorAction Stop).ProviderPath
 $tunnel=(Resolve-Path -LiteralPath $TunnelDirectory -ErrorAction Stop).ProviderPath
 $public=(Resolve-Path -LiteralPath $PublicKeySource -ErrorAction Stop).ProviderPath
 foreach($p in @($dev,$runtime,$tunnel,$public)){
   if($p.StartsWith(($root+[IO.Path]::DirectorySeparatorChar),[StringComparison]::OrdinalIgnoreCase)){
     throw 'BACKGROUND_PREPARE_SOURCE_INSIDE_DEST'
   }
 }
 $head=(& git -C $dev rev-parse HEAD).Trim()
 if($LASTEXITCODE -ne 0 -or $head -notmatch '^[a-f0-9]{40}$'){throw 'BACKGROUND_DEV_GIT_HEAD_INVALID'}
 $main=(& git -C $dev rev-parse origin/main).Trim()
 if($LASTEXITCODE -ne 0 -or $head -ne $main){throw 'BACKGROUND_DEV_NOT_ON_REMOTE_MAIN'}
 $dirty=@(& git -C $dev status --porcelain=v1 --untracked-files=normal)
 if($LASTEXITCODE -ne 0 -or $dirty.Count -gt 0){throw 'BACKGROUND_DEV_GIT_NOT_CLEAN'}
 if(-not(Test-Path -LiteralPath (Join-Path $runtime 'dist\server.js') -PathType Leaf) -or
    -not(Test-Path -LiteralPath (Join-Path $runtime 'node_modules') -PathType Container)){
   throw 'BACKGROUND_RUNTIME_BUILD_OR_DEPENDENCIES_MISSING'
 }
 if(-not(Test-Path -LiteralPath (Join-Path $dev 'node_modules') -PathType Container)){
   throw 'BACKGROUND_MCP_DEPENDENCIES_MISSING'
 }
 foreach($p in @((Join-Path $tunnel 'tunnel-client.exe'),(Join-Path $tunnel 'cloudflared.exe'),$public)){
   if(-not(Test-Path -LiteralPath $p -PathType Leaf)){throw 'BACKGROUND_TUNNEL_OR_TRUST_MISSING'}
 }
 # Block junctions and symlinks in untrusted source dependency trees:
 # a recursive copy must never follow a reparse point out of the checkout.
 foreach($srcRoot in @((Join-Path $dev 'node_modules'),(Join-Path $runtime 'node_modules'),(Join-Path $runtime 'dist'))){
   $links=@(Get-ChildItem -LiteralPath $srcRoot -Recurse -Force -Attributes ReparsePoint -ErrorAction Stop | Select-Object -First 1)
   if($links.Count){throw 'BACKGROUND_PREPARE_REPARSE_SOURCE_REFUSED'}
 }
 $paths=@{
   mcp=(Join-Path $root 'mcp-app'); runtime=(Join-Path $root 'runtime')
   tunnel=(Join-Path $root 'tunnel'); trust=(Join-Path $root 'trust')
   state=(Join-Path $root 'state'); workspace=(Join-Path $root 'workspace')
 }
 foreach($key in $paths.Keys){
   if(Test-Path -LiteralPath $paths[$key]){throw ('BACKGROUND_PREPARE_DEST_ALREADY_EXISTS_'+$key)}
 }
 $created=@()
 try {
 foreach($key in $paths.Keys){
   New-Item -ItemType Directory -Path $paths[$key] -ErrorAction Stop|Out-Null
   $created+=($paths[$key])
 }
 # Only Git-tracked files are copied from the DEV repo. Untracked secrets,
 # .env, personal Chrome profiles, temp files and .git metadata are omitted.
 $tracked=@(& git -C $dev ls-files --cached --full-name)
 if($LASTEXITCODE -ne 0 -or $tracked.Count -lt 40){throw 'BACKGROUND_GIT_FILE_LIST_INVALID'}
 foreach($rel in $tracked){
   if($rel -match '(^|/)\.\.(?:/|$)' -or [IO.Path]::IsPathRooted($rel)){throw 'BACKGROUND_UNSAFE_TRACKED_PATH'}
   $file=Join-Path $dev ($rel.Replace('/',[IO.Path]::DirectorySeparatorChar))
   if(-not(Test-Path -LiteralPath $file -PathType Leaf)){throw 'BACKGROUND_GIT_TRACKED_FILE_MISSING'}
   if((Get-Item -LiteralPath $file -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){
     throw 'BACKGROUND_PREPARE_REPARSE_TRACKED_FILE_REFUSED'
   }
   $target=Join-Path $paths.mcp ($rel.Replace('/',[IO.Path]::DirectorySeparatorChar))
   $dir=Split-Path -Parent $target
   if(-not(Test-Path -LiteralPath $dir)){New-Item -ItemType Directory -Force -Path $dir|Out-Null}
   Copy-Item -LiteralPath $file -Destination $target -ErrorAction Stop
 }
 Copy-Item -LiteralPath (Join-Path $dev 'node_modules') -Destination (Join-Path $paths.mcp 'node_modules') -Recurse -Force
 Copy-Item -LiteralPath (Join-Path $runtime 'dist') -Destination (Join-Path $paths.runtime 'dist') -Recurse -Force
 Copy-Item -LiteralPath (Join-Path $runtime 'node_modules') -Destination (Join-Path $paths.runtime 'node_modules') -Recurse -Force
 foreach($f in @('package.json','package-lock.json')){
   $source=Join-Path $runtime $f
   if(Test-Path -LiteralPath $source -PathType Leaf){Copy-Item -LiteralPath $source -Destination (Join-Path $paths.runtime $f)}
 }
 foreach($f in @('tunnel-client.exe','cloudflared.exe','cloudflared-manifest.json')){
   $source=Join-Path $tunnel $f
   if(Test-Path -LiteralPath $source -PathType Leaf){Copy-Item -LiteralPath $source -Destination (Join-Path $paths.tunnel $f)}
 }
 Copy-Item -LiteralPath $public -Destination (Join-Path $paths.trust 'runtime-lease-public.pem')
 Restrict-Folder
 # Service may mutate ONLY its private state subtree, not source, config,
 # binaries or other user workspaces.
 & icacls.exe $paths.state '/inheritance:r' '/grant:r' '*S-1-5-19:(OI)(CI)M' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-18:(OI)(CI)F'|Out-Null
 if($LASTEXITCODE -ne 0){throw 'BACKGROUND_STATE_ACL_FAILED'}
 $marker=[ordered]@{gitSha=$head;preparedAt=(Get-Date).ToUniversalTime().ToString('o');scope='protected-offline-stage';serviceInstalled=$false}
 [IO.File]::WriteAllText((Join-Path $root 'prepare-marker.json'),($marker|ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false))
 Write-Output 'BACKGROUND_PREPARED_OFFLINE_NO_SERVICE_CHANGE'
 }catch{
   # Roll back ONLY the six directories created in this invocation.
   # Never delete the preexisting service binary, credentials or DEV files.
   foreach($createdPath in $created){
     if($createdPath.StartsWith(($root+[IO.Path]::DirectorySeparatorChar),[StringComparison]::OrdinalIgnoreCase)){
       Remove-Item -LiteralPath $createdPath -Recurse -Force -ErrorAction SilentlyContinue
     }
   }
   throw
 }
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
 Copy-Item -LiteralPath (Join-Path $root 'mcp-app\scripts\windows\background-host-supervisor.mjs') -Destination $worker -Force
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

if($Mode -eq 'ProvisionCloudApproved'){
 # Explicit administrator action. No legacy DPAPI decryption, no reading
 # user vaults. Operator enters an ALREADY Cloud-authorized tunnel key through
 # the local secure prompt; Runtime/MCP tokens are generated locally.
 Assert-Staged
 if(Get-Service -Name $name -ErrorAction SilentlyContinue){
   throw 'BACKGROUND_PROVISION_SERVICE_ALREADY_REGISTERED'
 }
 if(Test-Path -LiteralPath $secrets -PathType Leaf){
   throw 'BACKGROUND_PROVISION_CREDENTIAL_ALREADY_PRESENT'
 }
 Add-Type -AssemblyName System.Security
 $serviceConfig=Get-Content -LiteralPath $cfg -Raw | ConvertFrom-Json
 if($serviceConfig.tunnelId -notmatch '^tunnel_[a-f0-9]{32}$'){
   throw 'BACKGROUND_PROVISION_TUNNEL_IDENTITY_INVALID'
 }
 $tunnelKey=Secure-Prompt ('Cloud-authorized key for '+$serviceConfig.tunnelId+' (local secure input)')
 $randomA=$null
 $randomB=$null
 $clearBlob=$null
 $cipher=$null
 $tmp=Join-Path $root ('credentials.'+[Guid]::NewGuid().ToString('N')+'.tmp')
 $completed=$false
 try{
   if($tunnelKey.Length -lt 24 -or $tunnelKey -match '\s' -or $tunnelKey.Length -gt 4096){
     throw 'BACKGROUND_PROVISION_TUNNEL_KEY_INVALID'
   }
   $randomA=New-Object byte[] 48
   $randomB=New-Object byte[] 48
   $rng=[Security.Cryptography.RandomNumberGenerator]::Create()
   try{$rng.GetBytes($randomA);$rng.GetBytes($randomB)}finally{$rng.Dispose()}
   $runtimeToken=[Convert]::ToBase64String($randomA).TrimEnd('=').Replace('+','-').Replace('/','_')
   $mcpToken=[Convert]::ToBase64String($randomB).TrimEnd('=').Replace('+','-').Replace('/','_')
   if($runtimeToken -eq $mcpToken){throw 'BACKGROUND_PROVISION_TOKEN_COLLISION'}
   $clearBlob=[Text.Encoding]::UTF8.GetBytes($runtimeToken+[char]10+$mcpToken+[char]10+$tunnelKey)
   $cipher=[Security.Cryptography.ProtectedData]::Protect(
     $clearBlob,$null,[Security.Cryptography.DataProtectionScope]::LocalMachine)
   [IO.File]::WriteAllBytes($tmp,$cipher)
   & icacls.exe $tmp '/inheritance:r' '/grant:r' '*S-1-5-19:R' '*S-1-5-32-544:F' '*S-1-5-18:F' | Out-Null
   if($LASTEXITCODE -ne 0){throw 'BACKGROUND_PROVISION_SECRET_ACL_FAILED'}
   if(Test-Path -LiteralPath $secrets -PathType Leaf){throw 'BACKGROUND_PROVISION_RACE_CREDENTIAL_EXISTS'}
   Move-Item -LiteralPath $tmp -Destination $secrets -ErrorAction Stop
   $completed=$true
 } finally {
   if($randomA){[Array]::Clear($randomA,0,$randomA.Length)}
   if($randomB){[Array]::Clear($randomB,0,$randomB.Length)}
   if($clearBlob){[Array]::Clear($clearBlob,0,$clearBlob.Length)}
   if($cipher){[Array]::Clear($cipher,0,$cipher.Length)}
   $tunnelKey=$null;$runtimeToken=$null;$mcpToken=$null
   if(-not $completed -and (Test-Path -LiteralPath $tmp -PathType Leaf)){
     Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
   }
 }
 if(-not $completed){throw 'BACKGROUND_PROVISION_ABORTED'}
 Write-Output 'BACKGROUND_SERVICE_CREDENTIALS_PROVISIONED_BY_LOCAL_OPERATOR'
 Write-Output 'BACKGROUND_EXISTING_DEV_TUNNEL_UNCHANGED'
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
