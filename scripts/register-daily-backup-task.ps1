param(
  [string]$TaskName = "InventoryDailyImmutableBackupGit",
  [string]$Time = "23:30",
  [string]$RepoPath = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
)

$taskArgs = "/c cd /d `"$RepoPath`" && npm run backup:git"

$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument $taskArgs
$trigger = New-ScheduledTaskTrigger -Daily -At $Time
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

try {
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force -ErrorAction Stop
  Write-Host "Scheduled task '$TaskName' created. Runs daily at $Time."
} catch {
  Write-Error "Failed to create scheduled task '$TaskName': $($_.Exception.Message)"
  exit 1
}
