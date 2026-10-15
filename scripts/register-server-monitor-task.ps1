param(
  [string]$TaskName = "InventoryDailyServerHeartbeat",
  [string]$Time = "08:00",
  [int]$Port = 3000,
  [string]$RepoPath = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
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
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

try {
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force -ErrorAction Stop | Out-Null
  Write-Host "Scheduled task '$TaskName' created. Runs daily at $Time and checks port $Port."
  Write-Host "Healthchecks.io will alert if a heartbeat is missed. Configure its email notification and daily schedule in your Healthchecks.io account."
} catch {
  Write-Error "Failed to create scheduled task: $($_.Exception.Message)"
  exit 1
}