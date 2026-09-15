param(
  [string]$RepoPath = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$DestinationPath = "C:\Users\SousaLab\OneDrive - UCB-O365\MAL OneDrive\UCB-O365\Marcelo Carlos Sousa - Sousa_Lab_Files\Invetory_Tracker"
)

$ErrorActionPreference = "Stop"

$resolvedRepoPath = (Resolve-Path $RepoPath).Path

if (-not (Test-Path $DestinationPath)) {
  New-Item -ItemType Directory -Path $DestinationPath -Force | Out-Null
}

Write-Host "[$(Get-Date -Format s)] Mirroring $resolvedRepoPath -> $DestinationPath"

# Exclude dev/runtime artifacts; the destination is a copy, not a second working repo.
$excludeDirs = @(".git", "node_modules", "dist", ".venv")

$robocopyArgs = @(
  "`"$resolvedRepoPath`"",
  "`"$DestinationPath`"",
  "/MIR",
  "/XD"
) + ($excludeDirs | ForEach-Object { "`"$(Join-Path $resolvedRepoPath $_)`"" }) + @(
  "/R:2",
  "/W:5",
  "/NFL",
  "/NDL",
  "/NP"
)

$process = Start-Process -FilePath "robocopy.exe" -ArgumentList $robocopyArgs -NoNewWindow -Wait -PassThru

# Robocopy exit codes 0-7 indicate success (files copied/skipped); 8+ indicate failure.
if ($process.ExitCode -ge 8) {
  Write-Error "Mirror to OneDrive failed with robocopy exit code $($process.ExitCode)."
  exit 1
}

Write-Host "[$(Get-Date -Format s)] Mirror completed (robocopy exit code $($process.ExitCode))."
exit 0
