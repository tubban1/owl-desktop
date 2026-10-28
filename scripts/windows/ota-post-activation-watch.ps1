# Runs independently from OWL DEV; reads only verified release receipts.
# Scheduled once per minute while the Windows user session is logged on.
$ErrorActionPreference='Stop'
$state=Join-Path $env:USERPROFILE '.owl-lab\version-sync\desktop'
$receiptFile=Join-Path $state 'cutover-last.json'
if(-not (Test-Path -LiteralPath $receiptFile -PathType Leaf)){exit 0}
$r=Get-Content -LiteralPath $receiptFile -Raw | ConvertFrom-Json
if($r.phase -ne 'activated'){exit 0}
$repo=Join-Path $env:USERPROFILE 'mcp-workspace'
foreach($root in @($r.from,$r.to)){
 if(-not $root -or -not (Test-Path -LiteralPath $root -PathType Container)){exit 2}
 $actual=(Resolve-Path -LiteralPath $root).ProviderPath
 if(-not $actual.StartsWith($repo+'\',[StringComparison]::OrdinalIgnoreCase)){exit 3}
}
if($r.fromSha -notmatch '^[a-f0-9]{40}$' -or $r.toSha -notmatch '^[a-f0-9]{40}$'){exit 4}
$script=Join-Path $PSScriptRoot 'verified-dev-cutover.ps1'
& $script -Mode Monitor -OldRoot $r.from -NewRoot $r.to -ExpectedOldSha $r.fromSha -ExpectedNewSha $r.toSha
exit $LASTEXITCODE
