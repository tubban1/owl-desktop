# Compile and stage Windows Helper from the EXACT pinned OWL Runtime source.
# This does not sign or activate the helper. Production release separately
# requires signing, installer validation and Windows interactive-session QA.
[CmdletBinding()]
param([string]$RuntimeRoot='')
$ErrorActionPreference='Stop'
$desktop=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$contract=Get-Content -Raw (Join-Path $desktop 'docs\contracts\OWL_RUNTIME_COMPONENT_V1.json')|ConvertFrom-Json
if(-not $RuntimeRoot){$RuntimeRoot=$env:OWL_RUNTIME_REPO}
if(-not $RuntimeRoot){
  $candidate=Join-Path (Split-Path $desktop -Parent) ('owl-runtime-release-'+$contract.gitSha.Substring(0,7))
  if(Test-Path $candidate){$RuntimeRoot=$candidate}
}
if(-not $RuntimeRoot){throw 'WINDOWS_GUI_PINNED_RUNTIME_REQUIRED'}
$RuntimeRoot=(Resolve-Path $RuntimeRoot).Path
$sha=(& git -C $RuntimeRoot rev-parse HEAD).Trim()
if($LASTEXITCODE -ne 0 -or $sha -cne $contract.gitSha){throw 'WINDOWS_GUI_RUNTIME_PIN_MISMATCH'}
$dirty=@(& git -C $RuntimeRoot status --porcelain)
if($dirty.Count -ne 0){throw 'WINDOWS_GUI_RUNTIME_SOURCE_DIRTY'}
$source=Join-Path $RuntimeRoot 'windows-helper\OWLHelper.cs'
$build=Join-Path $RuntimeRoot 'scripts\windows\build-gui-helper.ps1'
$binary=Join-Path $RuntimeRoot 'windows-helper\bin\OWLHelper.exe'
if(-not(Test-Path $source)-or -not(Test-Path $build)){throw 'WINDOWS_GUI_RUNTIME_SOURCE_MISSING'}
& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $build
if($LASTEXITCODE -ne 0){throw 'WINDOWS_GUI_HELPER_BUILD_FAILED'}
if(-not(Test-Path $binary)){throw 'WINDOWS_GUI_HELPER_BINARY_MISSING'}
$manifest=Join-Path (Split-Path $binary -Parent) 'component.json'
$receipt=(Get-Content -Raw $manifest|ConvertFrom-Json)
$hash=(Get-FileHash $binary -Algorithm SHA256).Hash.ToLowerInvariant()
if($receipt.component -cne 'owl-windows-gui-helper' -or
   $receipt.architecture -cne 'win32-x64' -or $receipt.sha256 -cne $hash){
   throw 'WINDOWS_GUI_HELPER_INTEGRITY_FAILED'
}
$destination=Join-Path $desktop 'vendor\helper\win32-x64'
New-Item -ItemType Directory -Force $destination|Out-Null
Copy-Item -LiteralPath $binary -Destination (Join-Path $destination 'OWLHelper.exe') -Force
Copy-Item -LiteralPath $manifest -Destination (Join-Path $destination 'component.json') -Force
$destHash=(Get-FileHash (Join-Path $destination 'OWLHelper.exe') -Algorithm SHA256).Hash.ToLowerInvariant()
if($destHash -cne $hash){throw 'WINDOWS_GUI_STAGED_HELPER_HASH_MISMATCH'}
[ordered]@{status='verified-staged';runtimeSha=$sha;architecture='win32-x64';helperSha256=$hash;mode='unsigned-development'} | ConvertTo-Json -Compress
