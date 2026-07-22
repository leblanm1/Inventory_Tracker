param(
  [string]$TaskName = "InventoryDailyImmutableBackupGit",
  [string]$Time = "07:00",
  [string]$FallbackTaskName = "InventoryDailyEnsureRunning",
  [string]$FallbackTime = "07:05",
  [string]$RepoPath = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
)

$maintenanceScriptPath = Join-Path $RepoPath "scripts\morning-maintenance.ps1"
$taskArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$maintenanceScriptPath`" -RepoPath `"$RepoPath`""
$fallbackTaskArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$maintenanceScriptPath`" -RepoPath `"$RepoPath`" -SkipBackup"

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $taskArgs
$fallbackAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $fallbackTaskArgs
$trigger = New-ScheduledTaskTrigger -Daily -At $Time
$fallbackTrigger = New-ScheduledTaskTrigger -Daily -At $FallbackTime
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

try {
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force -ErrorAction Stop
  Register-ScheduledTask -TaskName $FallbackTaskName -Action $fallbackAction -Trigger $fallbackTrigger -Principal $principal -Settings $settings -Force -ErrorAction Stop
  Write-Host "Scheduled task '$TaskName' created. Runs daily at $Time."
  Write-Host "Scheduled fallback task '$FallbackTaskName' created. Runs daily at $FallbackTime."
} catch {
  Write-Error "Failed to create scheduled tasks: $($_.Exception.Message)"
  exit 1
}
