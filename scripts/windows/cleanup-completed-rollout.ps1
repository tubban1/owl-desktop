param(
 [Parameter(Mandatory=$true)][string]$Sha,
 [switch]$DryRun
)
$ErrorActionPreference='Stop'
if($Sha -cnotmatch '^[a-f0-9]{40}$'){throw 'ROLL_CLEAN_INVALID_SHA'}
$name='OWL-LAB-Rollout-'+$Sha.Substring(0,12)
$task=Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
if(-not $task){'status=absent';exit 0}
$info=Get-ScheduledTaskInfo -TaskName $name -ErrorAction Stop
if($task.State -eq 'Running'){'status=deferred-running';exit 0}
if($task.State -notin @('Ready','Disabled')){throw 'ROLL_CLEAN_UNKNOWN_TASK_STATE'}
if($info.NextRunTime -gt (Get-Date)){'status=deferred-future-run';exit 0}
if($info.LastTaskResult -ne 0){'status=deferred-nonzero-result';exit 0}
if(-not $info.LastRunTime -or $info.LastRunTime.Year -lt 2026){
 'status=deferred-never-executed';exit 0
}
$argsText=[string]$task.Actions[0].Arguments
if(-not $argsText.Contains($Sha) -or
 $argsText -notmatch '(?i)hidden-scheduled-task[.]vbs'){throw 'ROLL_CLEAN_TASK_ACTION_UNEXPECTED'}
$root=Join-Path $HOME '.owl-lab\version-sync\desktop'
$receipt=Join-Path $root 'cutover-last.json'
if(-not (Test-Path -LiteralPath $receipt)){throw 'ROLL_CLEAN_RECEIPT_NOT_FOUND'}
$r=Get-Content -LiteralPath $receipt -Raw|ConvertFrom-Json
if($r.phase -ne 'activated' -or $r.toSha -cne $Sha){throw 'ROLL_CLEAN_NOT_ACTIVATED'}
if($DryRun){'status=eligible';exit 0}
$archive=Join-Path $root ('ota\archived-rollout-tasks-'+(Get-Date -Format 'yyyyMMdd'))
New-Item -ItemType Directory -Path $archive -Force -ErrorAction Stop|Out-Null
$backup=Join-Path $archive ($name+'.xml')
if(Test-Path -LiteralPath $backup){throw 'ROLL_CLEAN_ARCHIVE_ALREADY_EXISTS'}
$xml=Export-ScheduledTask -TaskName $name -ErrorAction Stop
[IO.File]::WriteAllText($backup,$xml,[Text.UTF8Encoding]::new($false))
if(-not (Test-Path -LiteralPath $backup)){throw 'ROLL_CLEAN_ARCHIVE_NOT_WRITTEN'}
Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction Stop
'status=archived-and-removed'
