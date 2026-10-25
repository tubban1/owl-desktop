# OWL LAB Windows development launcher, not a signed production installer.
$ErrorActionPreference="Stop"
$project=(Resolve-Path (Join-Path $PSScriptRoot "../..")).ProviderPath
$workspace=(Split-Path -Parent $project)
# A separate test checkout can reside below mcp-workspace, next to pinned Runtime.
$runtime=(Join-Path $workspace "owl-runtime-pin")
$key=(Join-Path $workspace "owl-cloud-runtime-lease-public.pem")
if(-not (Test-Path -LiteralPath (Join-Path $runtime "dist/server.js") -PathType Leaf)) {
  throw "WINDOWS_DEV_RUNTIME_BUILD_REQUIRED"
}
if(-not (Test-Path -LiteralPath $key -PathType Leaf)) {
  throw "WINDOWS_DEV_RUNTIME_TRUST_PUBLIC_KEY_REQUIRED"
}
if(-not (Test-Path -LiteralPath (Join-Path $project "node_modules/electron/dist/electron.exe") -PathType Leaf)) {
  throw "WINDOWS_DEV_DESKTOP_DEPENDENCIES_REQUIRED"
}
$env:OWL_LAB_WINDOWS_SMOKE="1"
$env:OWL_WIN_DEV_MANAGE_RUNTIME="true"
$env:OWL_WIN_DEV_RUNTIME_ROOT=$runtime
$env:OWL_WIN_DEV_RUNTIME_PUBLIC_KEY=$key
Set-Location -LiteralPath $project
& npm.cmd run dev:desktop
exit $LASTEXITCODE
