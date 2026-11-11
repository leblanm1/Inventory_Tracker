param(
  [string]$TaskName = "InventoryDailyImmutableBackupGit",
  [string]$Time = "07:00",
  [string]$FallbackTaskName = "InventoryDailyEnsureRunning",
  [string]$FallbackTime = "07:05",
  [string]$MirrorTaskName = "InventoryDailyOneDriveMirror",
  [string]$MirrorTime = "07:10",
  [string]$OneDriveDestinationPath = "C:\Users\SousaLab\OneDrive - UCB-O365\MAL OneDrive\UCB-O365\Marcelo Carlos Sousa - Sousa_Lab_Files\Inventory_Tracker",
  [string]$RepoPath = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [System.Management.Automation.PSCredential]$Credential
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

$mirrorScriptPath = Join-Path $resolvedRepoPath "scripts\mirror-to-onedrive.ps1"
if (-not (Test-Path $mirrorScriptPath)) {
  Write-Error "Required script not found: $mirrorScriptPath"
  exit 1
}

$taskArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$maintenanceScriptPath`" -RepoPath `"$resolvedRepoPath`""
$fallbackTaskArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$maintenanceScriptPath`" -RepoPath `"$resolvedRepoPath`" -SkipBackup"
$mirrorTaskArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$mirrorScriptPath`" -RepoPath `"$resolvedRepoPath`" -DestinationPath `"$OneDriveDestinationPath`""

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $taskArgs -WorkingDirectory $resolvedRepoPath
$fallbackAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $fallbackTaskArgs -WorkingDirectory $resolvedRepoPath
$mirrorAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $mirrorTaskArgs -WorkingDirectory $resolvedRepoPath
$trigger = New-ScheduledTaskTrigger -Daily -At $Time
$fallbackTrigger = New-ScheduledTaskTrigger -Daily -At $FallbackTime
$mirrorTrigger = New-ScheduledTaskTrigger -Daily -At $MirrorTime
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

try {
  if (-not $Credential) {
    $Credential = Get-Credential -UserName ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -Message "Enter the Windows account password for unattended inventory tasks."
  }
  if (-not $Credential -or $Credential.GetNetworkCredential().Password.Length -eq 0) {
    throw "A Windows account and password are required for unattended tasks."
  }
  if ((New-Object System.Security.Principal.NTAccount($Credential.UserName)).Translate([System.Security.Principal.SecurityIdentifier]) -ne [System.Security.Principal.WindowsIdentity]::GetCurrent().User) {
    throw "Use the current Windows account so the tasks use the same inventory data and credentials."
  }
  $password = $Credential.GetNetworkCredential().Password
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -User $Credential.UserName -Password $password -Settings $settings -Force -ErrorAction Stop | Out-Null
  Register-ScheduledTask -TaskName $FallbackTaskName -Action $fallbackAction -Trigger $fallbackTrigger -User $Credential.UserName -Password $password -Settings $settings -Force -ErrorAction Stop | Out-Null
  Register-ScheduledTask -TaskName $MirrorTaskName -Action $mirrorAction -Trigger $mirrorTrigger -User $Credential.UserName -Password $password -Settings $settings -Force -ErrorAction Stop | Out-Null
  Write-Host "Resolved repo path: $resolvedRepoPath"
  Write-Host "Scheduled task '$TaskName' created. Runs daily at $Time."
  Write-Host "Scheduled fallback task '$FallbackTaskName' created. Runs daily at $FallbackTime."
  Write-Host "Scheduled mirror task '$MirrorTaskName' created. Runs daily at $MirrorTime. Destination: $OneDriveDestinationPath"
} catch {
  Write-Error "Failed to create scheduled tasks: $($_.Exception.Message)"
  exit 1
} finally {
  $password = $null
}
