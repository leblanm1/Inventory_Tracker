param(
  [string]$TaskName = "InventoryDailyServerHeartbeat",
  [string]$Time = "08:00",
  [int]$Port = 3000,
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

$monitorDirectory = Join-Path $env:LOCALAPPDATA "SousaLabInventoryTracker"
$pingUrlPath = Join-Path $monitorDirectory "healthchecks-ping-url.dpapi"
$heartbeatScriptPath = Join-Path $resolvedRepoPath "scripts\server-heartbeat.ps1"

if (-not (Test-Path -LiteralPath $heartbeatScriptPath)) {
  Write-Error "Required script not found: $heartbeatScriptPath"
  exit 1
}

if (-not (Test-Path -LiteralPath $pingUrlPath)) {
  $securePingUrl = Read-Host "Paste your Healthchecks.io HTTPS ping URL" -AsSecureString
  if ($securePingUrl.Length -eq 0) {
    Write-Error "A Healthchecks.io ping URL is required."
    exit 1
  }

  $plainPingUrl = [System.Net.NetworkCredential]::new("", $securePingUrl).Password
  $pingUri = $null
  if (-not [Uri]::TryCreate($plainPingUrl, [UriKind]::Absolute, [ref]$pingUri) -or $pingUri.Scheme -ne "https") {
    Write-Error "The Healthchecks.io ping URL must be an absolute HTTPS URL."
    exit 1
  }

  New-Item -ItemType Directory -Path $monitorDirectory -Force | Out-Null
  ConvertFrom-SecureString -SecureString $securePingUrl |
    Set-Content -LiteralPath $pingUrlPath -Encoding ASCII -NoNewline
}

$taskArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$heartbeatScriptPath`" -Port $Port"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $taskArgs -WorkingDirectory $resolvedRepoPath
$trigger = New-ScheduledTaskTrigger -Daily -At $Time
# An offset-free boundary keeps the task at the same local time across DST changes.
$trigger.StartBoundary = ([DateTimeOffset]::Parse($trigger.StartBoundary)).LocalDateTime.ToString("s")
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

try {
  if (-not $Credential) {
    $Credential = Get-Credential -UserName ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -Message "Enter the Windows account password for the unattended heartbeat task."
  }
  if (-not $Credential -or $Credential.GetNetworkCredential().Password.Length -eq 0) {
    throw "A Windows account and password are required for the unattended heartbeat task."
  }
  if ((New-Object System.Security.Principal.NTAccount($Credential.UserName)).Translate([System.Security.Principal.SecurityIdentifier]) -ne [System.Security.Principal.WindowsIdentity]::GetCurrent().User) {
    throw "Use the current Windows account: the heartbeat URL is encrypted for that account."
  }
  $password = $Credential.GetNetworkCredential().Password
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -User $Credential.UserName -Password $password -Settings $settings -Force -ErrorAction Stop | Out-Null
  Write-Host "Scheduled task '$TaskName' created. Runs daily at $Time and checks port $Port."
  Write-Host "Healthchecks.io will alert if a heartbeat is missed. Configure its email notification and daily schedule in your Healthchecks.io account."
} catch {
  Write-Error "Failed to create scheduled task: $($_.Exception.Message)"
  exit 1
} finally {
  $password = $null
}