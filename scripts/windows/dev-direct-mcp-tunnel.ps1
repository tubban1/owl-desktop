# Windows DEV-only, direct ChatGPT-to-OWL MCP via OpenAI Secure MCP Tunnel.
# No Cloud RemoteCommand, no Worker, and no changes to existing tunnels.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^tunnel_[a-f0-9]{32}$')]
  [string]$TunnelId,

  [string]$EncryptedKeyFile = (Join-Path $env:APPDATA 'OWL LAB\dev\openai-tunnel-control-plane-key.dpapi'),

  [string]$TunnelClient = (Join-Path $env:USERPROFILE 'tunnel-client\tunnel-client.exe')
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$owlPort = 8790
$tunnelHealthPort = 18081
if (-not (Test-Path -LiteralPath $TunnelClient -PathType Leaf)) {
  throw 'OWL_WINDOWS_TUNNEL_CLIENT_NOT_INSTALLED'
}
if (-not (Test-Path -LiteralPath $EncryptedKeyFile -PathType Leaf)) {
  throw 'OWL_WINDOWS_TUNNEL_ENCRYPTED_KEY_REQUIRED'
}
$acl = Get-Acl -LiteralPath $EncryptedKeyFile
if (-not $acl.AreAccessRulesProtected) {
  throw 'OWL_WINDOWS_TUNNEL_KEY_FILE_ACL_NOT_PRIVATE'
}
$owlListener = @(Get-NetTCPConnection -LocalPort $owlPort -State Listen -ErrorAction SilentlyContinue)
if ($owlListener.Count -ne 1 -or $owlListener[0].LocalAddress -ne '127.0.0.1') {
  throw 'OWL_WINDOWS_LOCAL_MCP_8790_NOT_LISTENING_ON_LOOPBACK'
}
# Check OWL's local MCP health, never route into old Computer MCP on 8787.
try {
  $response = Invoke-RestMethod -Uri "http://127.0.0.1:$owlPort/health" -TimeoutSec 4
  if (-not $response) { throw 'EMPTY_MCP_HEALTH' }
} catch {
  throw "OWL_WINDOWS_LOCAL_MCP_UNHEALTHY: $($_.Exception.GetType().Name)"
}
if (Get-NetTCPConnection -LocalPort $tunnelHealthPort -State Listen -ErrorAction SilentlyContinue) {
  throw 'OWL_WINDOWS_DIRECT_TUNNEL_HEALTH_PORT_IN_USE'
}
$existing = @(Get-CimInstance Win32_Process -Filter "Name='tunnel-client.exe'" |
  Where-Object { $_.CommandLine -and $_.CommandLine.Contains($TunnelId) })
if ($existing.Count -gt 0) {
  throw 'OWL_WINDOWS_DIRECT_TUNNEL_ALREADY_RUNNING'
}
$clear = [System.Security.Cryptography.ProtectedData]::Unprotect(
  [IO.File]::ReadAllBytes($EncryptedKeyFile),
  $null,
  [System.Security.Cryptography.DataProtectionScope]::CurrentUser
)
try {
  $key = [Text.Encoding]::UTF8.GetString($clear).Trim()
  if ($key.Length -lt 24 -or $key -match '\s') {
    throw 'OWL_WINDOWS_TUNNEL_KEY_FORMAT_INVALID'
  }
  $env:CONTROL_PLANE_API_KEY = $key
  # Public metadata only. The Desktop uses this plus live tunnel health to
  # recognize an independently managed direct MCP connection during DEV setup.
  $metadataFile = Join-Path (Split-Path -Parent $EncryptedKeyFile) 'direct-mcp-tunnel.json'
  $metadata = @{
    tunnelId = $TunnelId
    mcpPort = $owlPort
    mcpUrl = "http://127.0.0.1:$owlPort/mcp"
    healthPort = $tunnelHealthPort
  } | ConvertTo-Json -Compress
  [IO.File]::WriteAllText($metadataFile, $metadata, [Text.UTF8Encoding]::new($false))
  Write-Output "OWL_WINDOWS_DIRECT_MCP_TUNNEL_STARTING tunnel=$TunnelId target=127.0.0.1:8790"
  $clientArgs = @(
    "run", "--control-plane.api-key", "env:CONTROL_PLANE_API_KEY",
    "--control-plane.tunnel-id", $TunnelId,
    "--mcp.server-url", "http://127.0.0.1:$owlPort/mcp",
    "--health.listen-addr", "127.0.0.1:$tunnelHealthPort",
    "--log.level", "info"
  )
  & $TunnelClient @clientArgs
  if ($LASTEXITCODE -ne 0) {
    throw "OWL_WINDOWS_DIRECT_TUNNEL_EXITED code=$LASTEXITCODE"
  }
} finally {
  Remove-Item Env:\CONTROL_PLANE_API_KEY -ErrorAction SilentlyContinue
  [Array]::Clear($clear, 0, $clear.Length)
  $key = $null
}
