# Windows acceptance of compiled Native Messaging executable, no Chrome registry touched.
$ErrorActionPreference='Stop'
$root=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$fixture=Join-Path $PSScriptRoot 'native-host-fixture.mjs'
$testRoot=Join-Path $root 'build\win-native-host-isolated'
$broker=Join-Path $root 'build\win-native-host-test-broker.json'
New-Item -ItemType Directory -Path (Split-Path -Parent $broker) -Force | Out-Null
if(-not (Test-Path -LiteralPath $broker)){
  Set-Content -LiteralPath $broker -Value '{}' -Encoding Ascii
}
$id='a'*32
$cmd=Join-Path $PSScriptRoot 'install-chrome-native-host.ps1'
$raw=& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $cmd -ExtensionId $id -NodeExe (Get-Command node.exe).Source -HostScript $fixture -BrokerConfig $broker -InstallRoot $testRoot -SkipRegistration -ReplaceRegistration
if($LASTEXITCODE -ne 0){throw 'WINDOWS_HOST_INSTALL_TEST_FAILED'}
$info=($raw|Where-Object { $_ -match '"ok":true' }|Select-Object -Last 1)|ConvertFrom-Json
if(-not $info.ok -or $info.registered){throw 'INVALID_INSTALL_REPORT'}
$manifest=Get-Content -LiteralPath $info.manifest -Raw|ConvertFrom-Json
if($manifest.allowed_origins.Count -ne 1 -or $manifest.allowed_origins[0] -ne "chrome-extension://$id/"){throw 'INVALID_EXTENSION_ORIGIN_SCOPE'}
if(-not (Test-Path -LiteralPath $info.binary)){throw 'NATIVE_LAUNCHER_MISSING'}
$settings=New-Object System.Diagnostics.ProcessStartInfo
$settings.FileName=$info.binary
$settings.Arguments="chrome-extension://$id/"
$settings.UseShellExecute=$false
$settings.RedirectStandardInput=$true
$settings.RedirectStandardOutput=$true
$settings.RedirectStandardError=$true
$settings.CreateNoWindow=$true
$p=[Diagnostics.Process]::Start($settings)
$bin=New-Object IO.BinaryReader($p.StandardOutput.BaseStream)
$four=$bin.ReadBytes(4)
if($four.Length -ne 4){throw 'NATIVE_FRAME_HEADER_MISSING'}
$len=[BitConverter]::ToUInt32($four,0)
if($len -lt 10 -or $len -gt 100000){throw 'NATIVE_FRAME_LENGTH_INVALID'}
$data=$bin.ReadBytes($len)
if($data.Length -ne $len){throw 'NATIVE_FRAME_TRUNCATED'}
$result=[Text.Encoding]::UTF8.GetString($data)|ConvertFrom-Json
if(-not $result.valid -or -not $result.fixture){throw 'NATIVE_FRAME_PAYLOAD_INVALID'}
$p.StandardInput.Close()
if(-not $p.WaitForExit(7000)){try{$p.Kill()}catch{};throw 'NATIVE_HOST_DID_NOT_TERMINATE'}
$bad=New-Object Diagnostics.ProcessStartInfo
$bad.FileName=$info.binary
$bad.Arguments='chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/'
$bad.UseShellExecute=$false
$bad.CreateNoWindow=$true
$bad.RedirectStandardOutput=$true
$q=[Diagnostics.Process]::Start($bad)
if(-not $q.WaitForExit(7000)){try{$q.Kill()}catch{};throw 'INVALID_ORIGIN_LAUNCH_HUNG'}
if($q.ExitCode -ne 12 -or $q.StandardOutput.BaseStream.ReadByte() -ne -1){throw 'INVALID_ORIGIN_NOT_BLOCKED'}
[pscustomobject]@{
  ok=$true;windowsNativeExe=$true;binaryFrameCorrect=$true;
  rejectsForeignOrigin=$true;didNotTouchChromeRegistry=$true;
  launcherExit=$p.ExitCode
}|ConvertTo-Json -Compress
