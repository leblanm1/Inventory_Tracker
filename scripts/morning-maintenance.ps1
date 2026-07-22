param(
  [string]$RepoPath = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [int]$Port = 3000,
  [switch]$SkipBackup
)

$ErrorActionPreference = "Stop"

function Test-InventoryServerRunning {
  param(
    [string]$ResolvedRepoPath,
    [int]$LocalPort
  )

  $repoPattern = [Regex]::Escape($ResolvedRepoPath)

  $matchingProcess = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
      ($_.Name -ieq "node.exe" -or $_.Name -ieq "node") -and
      $_.CommandLine -and
      $_.CommandLine -match $repoPattern -and
      $_.CommandLine -match "server\.ts|dist[\\/]server\.cjs"
    } |
    Select-Object -First 1

  if ($matchingProcess) {
    return $true
  }

  $portListener = Get-NetTCPConnection -State Listen -LocalPort $LocalPort -ErrorAction SilentlyContinue |
    Select-Object -First 1

  return [bool]$portListener
}

function Start-InventoryServer {
  param(
    [string]$ResolvedRepoPath
  )

  $startArgs = "/c cd /d `"$ResolvedRepoPath`" && npm run dev"
  Start-Process -FilePath "cmd.exe" -ArgumentList $startArgs -WorkingDirectory $ResolvedRepoPath -WindowStyle Minimized
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

  if (Test-InventoryServerRunning -ResolvedRepoPath $resolvedRepoPath -LocalPort $Port) {
    Write-Host "[$(Get-Date -Format s)] Inventory server is already running."
    exit 0
  }

  Write-Host "[$(Get-Date -Format s)] Inventory server not detected. Starting it now..."
  Start-InventoryServer -ResolvedRepoPath $resolvedRepoPath
  Start-Sleep -Seconds 2

  if (Test-InventoryServerRunning -ResolvedRepoPath $resolvedRepoPath -LocalPort $Port) {
    Write-Host "[$(Get-Date -Format s)] Inventory server started successfully."
    exit 0
  }

  Write-Error "Inventory server did not appear to start. Please check your Node/npm setup and Task Scheduler history."
  exit 1
} catch {
  Write-Error "Morning maintenance failed: $($_.Exception.Message)"
  exit 1
}