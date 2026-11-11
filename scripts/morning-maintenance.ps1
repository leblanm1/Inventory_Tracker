param(
  [string]$RepoPath = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [int]$Port = 3000,
  [switch]$SkipBackup
)

$ErrorActionPreference = "Stop"

function Test-InventoryServerRunning {
  param(
    [int]$LocalPort
  )

  $listenerPorts = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalPort -ge $LocalPort -and $_.LocalPort -lt ($LocalPort + 50) } |
    Select-Object -ExpandProperty LocalPort -Unique
  foreach ($candidatePort in $listenerPorts) {
    try {
      $response = Invoke-WebRequest -Uri "http://127.0.0.1:$candidatePort/" -Method Get -TimeoutSec 3 -UseBasicParsing
      if ($response.Content -match '<title>\s*Lab Inventory Tracker\s*</title>') {
        return $true
      }
    } catch {
      continue
    }
  }
  return $false
}

function Start-InventoryServer {
  param(
    [string]$ResolvedRepoPath,
    [int]$LocalPort
  )

  $startArgs = "/d /s /c cd /d `"$ResolvedRepoPath`" && set PORT=$LocalPort && npm run dev"
  Start-Process -FilePath "cmd.exe" -ArgumentList $startArgs -WorkingDirectory $ResolvedRepoPath -WindowStyle Hidden
}

function Test-InventoryServerProcess {
  param([string]$ResolvedRepoPath)

  $repoPattern = [Regex]::Escape($ResolvedRepoPath)
  return [bool](Get-CimInstance Win32_Process |
    Where-Object {
      ($_.Name -ieq "node.exe" -or $_.Name -ieq "node") -and
      $_.CommandLine -and
      $_.CommandLine -match $repoPattern -and
      $_.CommandLine -match "server\.ts|dist[\\/]server\.cjs"
    } | Select-Object -First 1)
}

try {
  $resolvedRepoPath = (Resolve-Path $RepoPath).Path
  Set-Location $resolvedRepoPath

  if (-not $SkipBackup) {
    Write-Host "[$(Get-Date -Format s)] Running daily backup workflow..."
    & cmd.exe /d /s /c "npm run backup:git"
    if ($LASTEXITCODE -ne 0) {
      Write-Warning "Backup workflow exited with code $LASTEXITCODE. Continuing to server health check."
    }
  } else {
    Write-Host "[$(Get-Date -Format s)] SkipBackup enabled. Running server health check only..."
  }

  if (Test-InventoryServerRunning -LocalPort $Port) {
    Write-Host "[$(Get-Date -Format s)] Inventory server is responding."
    exit 0
  }

  if (Test-InventoryServerProcess -ResolvedRepoPath $resolvedRepoPath) {
    Write-Host "[$(Get-Date -Format s)] Inventory server process exists but is not responding. Waiting for it..."
  } else {
    Write-Host "[$(Get-Date -Format s)] Inventory server not responding. Starting it now..."
    Start-InventoryServer -ResolvedRepoPath $resolvedRepoPath -LocalPort $Port
  }
  $startupDeadline = (Get-Date).AddSeconds(60)

  while ((Get-Date) -lt $startupDeadline) {
    if (Test-InventoryServerRunning -LocalPort $Port) {
      Write-Host "[$(Get-Date -Format s)] Inventory server started successfully."
      exit 0
    }
    Start-Sleep -Seconds 1
  }

  Write-Error "Inventory server did not respond. Please check your Node/npm setup and Task Scheduler history."
  exit 1
} catch {
  Write-Error "Morning maintenance failed: $($_.Exception.Message)"
  exit 1
}