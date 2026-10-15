param(
  [int]$Port = 3000
)

$ErrorActionPreference = "Stop"

$monitorDirectory = Join-Path $env:LOCALAPPDATA "SousaLabInventoryTracker"
$pingUrlPath = Join-Path $monitorDirectory "healthchecks-ping-url.dpapi"
$logPath = Join-Path $monitorDirectory "server-heartbeat.log"

function Write-HeartbeatLog {
  param([string]$Message)

  Add-Content -LiteralPath $logPath -Value "[$(Get-Date -Format s)] $Message"
}

try {
  New-Item -ItemType Directory -Path $monitorDirectory -Force | Out-Null

  if (-not (Test-Path -LiteralPath $pingUrlPath)) {
    throw "Healthchecks.io ping URL is not configured. Run register-server-monitor-task.ps1 first."
  }

  $encryptedPingUrl = (Get-Content -LiteralPath $pingUrlPath -Raw).Trim()
  $securePingUrl = ConvertTo-SecureString -String $encryptedPingUrl
  $pingUrl = [System.Net.NetworkCredential]::new("", $securePingUrl).Password
  $pingUri = [Uri]$pingUrl
  if (-not $pingUri.IsAbsoluteUri -or $pingUri.Scheme -ne "https") {
    throw "The configured Healthchecks.io ping URL must use HTTPS."
  }

  $trackerPort = $null
  $listenerPorts = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalPort -ge $Port -and $_.LocalPort -lt ($Port + 50) } |
    Select-Object -ExpandProperty LocalPort -Unique

  foreach ($candidatePort in $listenerPorts) {
    try {
      $response = Invoke-WebRequest -Uri "http://127.0.0.1:$candidatePort/" -Method Get -TimeoutSec 3 -UseBasicParsing
      if ($response.Content -match '<title>\s*Lab Inventory Tracker\s*</title>') {
        $trackerPort = $candidatePort
        break
      }
    } catch {
      continue
    }
  }

  if (-not $trackerPort) {
    throw "The Lab Inventory Tracker did not respond on ports $Port through $($Port + 49)."
  }

  Invoke-WebRequest -Uri $pingUri -Method Get -TimeoutSec 15 -UseBasicParsing | Out-Null
  Write-HeartbeatLog "Tracker is responding on port $trackerPort; heartbeat sent."
  exit 0
} catch {
  try {
    New-Item -ItemType Directory -Path $monitorDirectory -Force | Out-Null
    Write-HeartbeatLog "Heartbeat not sent. Check tracker status, monitoring configuration, and network connectivity."
  } catch {
    Write-Error "Heartbeat failed, and the local status could not be logged."
    exit 1
  }

  Write-Error "Heartbeat not sent. Check that the tracker is running and the monitoring configuration is valid."
  exit 1
}