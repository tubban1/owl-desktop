Option Explicit
' Headless Windows Task Scheduler launcher. No console and returns child exit status.
' Usage: wscript.exe //B //Nologo hidden-scheduled-task.vbs <mode> [cutover arguments]
Dim shell, args, base, quote, command, result, cmdNode, cmdPS
Set shell = CreateObject("WScript.Shell")
Set args = WScript.Arguments
If args.Count < 1 Then WScript.Quit 87
quote = Chr(34)
base = shell.ExpandEnvironmentStrings("%USERPROFILE%") & "\.owl-lab\version-sync\desktop\agent\scripts\"
cmdNode = quote & "C:\Program Files\nodejs\node.exe" & quote
cmdPS = quote & shell.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\WindowsPowerShell\v1.0\powershell.exe" & quote
Select Case LCase(CStr(args.Item(0)))
  Case "heartbeat"
    If args.Count <> 1 Then WScript.Quit 87
    command = cmdNode & " " & quote & base & "auto-version-updater.mjs" & quote & " heartbeat"
  Case "promote"
    If args.Count <> 1 Then WScript.Quit 87
    command = cmdNode & " " & quote & base & "auto-version-updater.mjs" & quote & " tick"
  Case "stage"
    If args.Count <> 1 Then WScript.Quit 87
    command = cmdNode & " " & quote & base & "sync-dev-checkouts.mjs" & quote & " stage"
  Case "watch"
    If args.Count <> 1 Then WScript.Quit 87
    command = cmdPS & " -NoProfile -NonInteractive -ExecutionPolicy Bypass -File " & quote & base & "windows\ota-post-activation-watch.ps1" & quote
  Case "cutover"
    If args.Count <> 5 Then WScript.Quit 87
    If Not IsReleaseRoot(CStr(args.Item(1))) Then WScript.Quit 87
    If Not IsReleaseRoot(CStr(args.Item(2))) Then WScript.Quit 87
    If Not IsSha(CStr(args.Item(3))) Then WScript.Quit 87
    If Not IsSha(CStr(args.Item(4))) Then WScript.Quit 87
    command = cmdPS & " -NoProfile -NonInteractive -ExecutionPolicy Bypass -File " & quote & base & "windows\verified-dev-cutover.ps1" & quote & " -Mode Cutover -OldRoot " & quote & args.Item(1) & quote & " -NewRoot " & quote & args.Item(2) & quote & " -ExpectedOldSha " & args.Item(3) & " -ExpectedNewSha " & args.Item(4)
  Case Else
    WScript.Quit 87
End Select
' Window style 0 hides the entire console descendant tree. Wait so Task
' Scheduler retains actual child exit codes and IgnoreNew/timeout semantics.
On Error Resume Next
result = shell.Run(command, 0, True)
If Err.Number <> 0 Then WScript.Quit 74
On Error GoTo 0
WScript.Quit result

Function IsSha(ByVal value)
  Dim re
  Set re = New RegExp
  re.Pattern = "^[0-9a-fA-F]{40}$"
  IsSha = re.Test(value)
End Function

Function IsReleaseRoot(ByVal value)
  Dim prefix, suffix, re
  prefix = shell.ExpandEnvironmentStrings("%USERPROFILE%") & "\mcp-workspace\owl-desktop-release-"
  If LCase(Left(value, Len(prefix))) <> LCase(prefix) Then
    IsReleaseRoot = False
    Exit Function
  End If
  suffix = Mid(value, Len(prefix) + 1)
  Set re = New RegExp
  re.Pattern = "^[0-9a-fA-F]{7,40}$"
  IsReleaseRoot = re.Test(suffix)
End Function
