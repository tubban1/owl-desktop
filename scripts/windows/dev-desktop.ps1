# OWL LAB Windows development launcher, not a signed production installer.
$ErrorActionPreference="Stop"
$project=(Resolve-Path (Join-Path $PSScriptRoot "../..")).ProviderPath
$workspace=(Split-Path -Parent $project)
# A separate test checkout can reside below mcp-workspace, next to pinned Runtime.
$runtime=(Join-Path $workspace "owl-runtime-pin")
$legacyKey=(Join-Path $workspace "owl-cloud-runtime-lease-public.pem")
$standardKey=(Join-Path $env:USERPROFILE ".owl-lab/trust/owl-cloud-dev-runtime-lease-public.pem")
if(-not (Test-Path -LiteralPath (Join-Path $runtime "dist/server.js") -PathType Leaf)) {
  throw "WINDOWS_DEV_RUNTIME_BUILD_REQUIRED"
}
# The selected file is a PUBLIC verifier, never a Cloud signing secret.
# Keep an existing explicit override or an already provisioned legacy file.
# Fresh installs use the normal per-user pinned trust-store location.
if($env:OWL_RUNTIME_LEASE_PUBLIC_KEY_FILE) {
  $key=$env:OWL_RUNTIME_LEASE_PUBLIC_KEY_FILE
} elseif((Test-Path -LiteralPath $standardKey -PathType Leaf) -or
         (-not (Test-Path -LiteralPath $legacyKey -PathType Leaf))) {
  $key=$standardKey
} else {
  $key=$legacyKey
}
$env:OWL_RUNTIME_LEASE_PUBLIC_KEY_FILE=$key
# This calls the exact official HTTPS origin and validates Ed25519 SPKI SHA-256
# against the hard-pinned fingerprint in runtime-lease-trust.mjs. Invalid keys,
# unexpected rotations and first-start network failures stop the launcher.
& node.exe (Join-Path $project "scripts/bootstrap-runtime-lease-trust.mjs")
if($LASTEXITCODE -ne 0) {
  throw "WINDOWS_DEV_RUNTIME_TRUST_BOOTSTRAP_FAILED"
}
if(-not (Test-Path -LiteralPath $key -PathType Leaf)) {
  throw "WINDOWS_DEV_RUNTIME_TRUST_VERIFIER_NOT_INSTALLED"
}
if(-not (Test-Path -LiteralPath (Join-Path $project "node_modules/electron/dist/electron.exe") -PathType Leaf)) {
  throw "WINDOWS_DEV_DESKTOP_DEPENDENCIES_REQUIRED"
}
$env:OWL_LAB_WINDOWS_SMOKE="1"
$env:OWL_WIN_DEV_MANAGE_RUNTIME="true"
# Access to the DEV Git workspace is an explicit Windows-user opt-in.
# DO NOT enable it for production packages or other users automatically.
# See docs/operations/WINDOWS_DEV_DIRECT_MCP.md.
if ($env:OWL_WIN_DEV_WORKSPACE_ACCESS -eq "true") {
  Write-Output "[OWL] Windows DEV workspace Git/write enabled; shell and delete require approval."
}

# Reuse the Mac native browser bridge on Windows DEV; the actual extension
# must connect via the registered host before it can control a Chrome tab.
$env:OWL_WIN_DEV_NATIVE_BROWSER="true"
# Native Windows UI Automation is a separate read-only adapter. This does NOT
# authorize pointer, keyboard, shell or clipboard mutation.
$env:OWL_WIN_DEV_UIA_READ_ONLY="true"
$env:OWL_WIN_DEV_RUNTIME_ROOT=$runtime
$env:OWL_WIN_DEV_RUNTIME_PUBLIC_KEY=$key
Set-Location -LiteralPath $project
& npm.cmd run dev:desktop
exit $LASTEXITCODE
