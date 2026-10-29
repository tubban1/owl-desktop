# Safe side-by-side Chrome Native Messaging binding reconciliation for a verified Windows release.
# Default Check is read-only. Apply never closes Chrome/Host or overwrites a running EXE.
[CmdletBinding()]
param(
 [ValidateSet('Check','Apply','Rollback')][string]$Mode='Check',
 [Parameter(Mandatory=$true)][string]$ActiveRoot,
 [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{40}$')][string]$ExpectedSha
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$root=(Resolve-Path -LiteralPath $ActiveRoot -ErrorAction Stop).ProviderPath
$workspace=Join-Path $env:USERPROFILE 'mcp-workspace'
if(-not $root.StartsWith($workspace+'\',[StringComparison]::OrdinalIgnoreCase)){
 throw 'NATIVE_HOST_ACTIVE_RELEASE_OUTSIDE_WORKSPACE'
}
$head=(& git -C $root rev-parse HEAD)
if($LASTEXITCODE -ne 0 -or $head.Trim() -ne $ExpectedSha){throw 'NATIVE_HOST_RELEASE_SHA_MISMATCH'}
if(@(& git -C $root status --porcelain --untracked-files=normal).Count -ne 0){throw 'NATIVE_HOST_RELEASE_NOT_CLEAN'}
$script=Join-Path $root 'connection-host\native-messaging-host.mjs'
$installer=Join-Path $root 'scripts\windows\install-chrome-native-host.ps1'
if(-not (Test-Path -LiteralPath $script -PathType Leaf) -or
   -not (Test-Path -LiteralPath $installer -PathType Leaf)){throw 'NATIVE_HOST_RELEASE_COMPONENTS_MISSING'}
$key='HKCU:\Software\Google\Chrome\NativeMessagingHosts\ai.owl.lab.agent'
if(-not (Test-Path $key)){throw 'NATIVE_HOST_NOT_REGISTERED'}
$manifestPath=[string](Get-Item $key).GetValue('')
if(-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)){throw 'NATIVE_HOST_MANIFEST_MISSING'}
$old=Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if($old.name -ne 'ai.owl.lab.agent' -or @($old.allowed_origins).Count -ne 1){throw 'NATIVE_HOST_MANIFEST_ORIGIN_AMBIGUOUS'}
$origin=[string]$old.allowed_origins[0]
if($origin -notmatch '^chrome-extension://([a-p]{32})/$'){throw 'NATIVE_HOST_ORIGIN_INVALID'}
$extensionId=$Matches[1]
$installBase=Join-Path $env:LOCALAPPDATA 'OWL LAB\NativeMessaging'
$dest=Join-Path $installBase ('release-'+$ExpectedSha.Substring(0,12))
$newManifest=Join-Path $dest 'ai.owl.lab.agent.json'
$receiptRoot=Join-Path $env:LOCALAPPDATA 'OWL LAB\NativeMessaging\receipts'
$receiptFile=Join-Path $receiptRoot 'last-switch.json'
$node=Join-Path $env:ProgramFiles 'nodejs\node.exe'
$broker=Join-Path $env:APPDATA 'OWL LAB\desktop\native-chrome\broker.json'
if(-not (Test-Path -LiteralPath $node -PathType Leaf)){throw 'NATIVE_HOST_NODE_NOT_FOUND'}
if(-not (Test-Path -LiteralPath $broker -PathType Leaf)){throw 'NATIVE_HOST_BROKER_NOT_AVAILABLE'}
if($Mode -eq 'Check'){
 [pscustomobject]@{ok=$true;mode='Check';expectedCommit=$ExpectedSha;
  boundToExpectedRelease=($manifestPath -eq $newManifest);
  currentRegistrationManifest=$manifestPath;candidateManifest=$newManifest;
  extensionId=$extensionId;requiresChromeReload=($manifestPath -ne $newManifest)
 }|ConvertTo-Json -Compress
 return
}
if($Mode -eq 'Rollback'){
 if(-not (Test-Path -LiteralPath $receiptFile -PathType Leaf)){throw 'NATIVE_HOST_ROLLBACK_RECEIPT_MISSING'}
 $receipt=Get-Content -LiteralPath $receiptFile -Raw -Encoding UTF8|ConvertFrom-Json
 if($receipt.newManifest -ne $manifestPath -or $receipt.targetCommit -ne $ExpectedSha){throw 'NATIVE_HOST_ROLLBACK_TARGET_MISMATCH'}
 $prior=[string]$receipt.previousManifest
 if(-not (Test-Path -LiteralPath $prior -PathType Leaf)){throw 'NATIVE_HOST_ROLLBACK_MANIFEST_MISSING'}
 $priorInfo=Get-Content -LiteralPath $prior -Raw -Encoding UTF8|ConvertFrom-Json
 if($priorInfo.name -ne 'ai.owl.lab.agent' -or @($priorInfo.allowed_origins).Count -ne 1 -or
     [string]$priorInfo.allowed_origins[0] -ne $origin -or
     -not (Test-Path -LiteralPath ([string]$priorInfo.path) -PathType Leaf)){throw 'NATIVE_HOST_ROLLBACK_UNTRUSTED'}
 Set-Item -Path $key -Value $prior
 [pscustomobject]@{ok=$true;mode='Rollback';restoredRegistration=$prior;requiresChromeReload=$true}|ConvertTo-Json -Compress
 return
}
if($manifestPath -eq $newManifest){
 [pscustomobject]@{ok=$true;mode='Apply';alreadyCurrent=$true;requiresChromeReload=$false}|ConvertTo-Json -Compress
 return
}
if(Test-Path -LiteralPath $dest){throw 'NATIVE_HOST_STAGING_TARGET_ALREADY_EXISTS'}
New-Item -ItemType Directory -Path $receiptRoot -Force|Out-Null
try{
 & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer -ExtensionId $extensionId -NodeExe $node -HostScript $script -BrokerConfig $broker -InstallRoot $dest -ReplaceRegistration | Out-Null
 if($LASTEXITCODE -ne 0){throw 'NATIVE_HOST_INSTALL_FAILED'}
 if([string](Get-Item $key).GetValue('') -ne $newManifest){throw 'NATIVE_HOST_REGISTRY_VERIFY_FAILED'}
 $next=Get-Content -LiteralPath $newManifest -Raw -Encoding UTF8 |ConvertFrom-Json
 if($next.name -ne 'ai.owl.lab.agent' -or @($next.allowed_origins).Count -ne 1 -or
   [string]$next.allowed_origins[0] -ne $origin -or
   -not(Test-Path -LiteralPath ([string]$next.path) -PathType Leaf)){throw 'NATIVE_HOST_POST_INSTALL_INVALID'}
 $receipt=[ordered]@{previousManifest=$manifestPath;newManifest=$newManifest;targetCommit=$ExpectedSha;at=(Get-Date).ToUniversalTime().ToString('o')}
 $temp=Join-Path $receiptRoot ([guid]::NewGuid().ToString('N')+'.tmp')
 $receipt|ConvertTo-Json -Depth 4 |Set-Content -LiteralPath $temp -Encoding UTF8
 Move-Item -LiteralPath $temp -Destination $receiptFile -Force
 [pscustomobject]@{ok=$true;mode='Apply';release=$ExpectedSha;requiresChromeReload=$true;backupSaved=$true}|ConvertTo-Json -Compress
}catch{
 if((Get-Item $key).GetValue('') -ne $manifestPath){Set-Item -Path $key -Value $manifestPath}
 throw
}
