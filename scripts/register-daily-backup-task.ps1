param(
  [string]$TaskName = "InventoryDailyImmutableBackupGit",
  [string]$Time = "07:00",
  [string]$FallbackTaskName = "InventoryDailyEnsureRunning",
  [string]$FallbackTime = "07:05",
  [string]$RepoPath = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
)

$ErrorActionPreference = "Stop"

try {
  $resolvedRepoPath = (Resolve-Path $RepoPath).Path
} catch {
  Write-Error "RepoPath does not exist: $RepoPath"
  exit 1
}

$maintenanceScriptPath = Join-Path $resolvedRepoPath "scripts\morning-maintenance.ps1"
if (-not (Test-Path $maintenanceScriptPath)) {
  Write-Error "Required script not found: $maintenanceScriptPath"
  exit 1
}

$taskArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$maintenanceScriptPath`" -RepoPath `"$resolvedRepoPath`""
$fallbackTaskArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$maintenanceScriptPath`" -RepoPath `"$resolvedRepoPath`" -SkipBackup"

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $taskArgs -WorkingDirectory $resolvedRepoPath
$fallbackAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $fallbackTaskArgs -WorkingDirectory $resolvedRepoPath
$trigger = New-ScheduledTaskTrigger -Daily -At $Time
$fallbackTrigger = New-ScheduledTaskTrigger -Daily -At $FallbackTime
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

try {
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force -ErrorAction Stop
  Register-ScheduledTask -TaskName $FallbackTaskName -Action $fallbackAction -Trigger $fallbackTrigger -Principal $principal -Settings $settings -Force -ErrorAction Stop
  Write-Host "Resolved repo path: $resolvedRepoPath"
  Write-Host "Scheduled task '$TaskName' created. Runs daily at $Time."
  Write-Host "Scheduled fallback task '$FallbackTaskName' created. Runs daily at $FallbackTime."
} catch {
  Write-Error "Failed to create scheduled tasks: $($_.Exception.Message)"
  exit 1
}
