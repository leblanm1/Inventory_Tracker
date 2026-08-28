param(
  [string]$RepoPath = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [int]$Port = 3000
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$resolvedRepoPath = (Resolve-Path $RepoPath).Path
$mutex = [System.Threading.Mutex]::new($false, "SousaLabInventoryTrackerTray")
$ownsMutex = $false

try {
  $ownsMutex = $mutex.WaitOne(0, $false)
} catch [System.Threading.AbandonedMutexException] {
  $ownsMutex = $true
}

if (-not $ownsMutex) {
  Start-Process "http://localhost:$Port"
  exit 0
}

function Get-TrackerProcesses {
  $repoPattern = [Regex]::Escape($resolvedRepoPath)
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
      ($_.Name -ieq "node.exe" -or $_.Name -ieq "node") -and
      $_.CommandLine -and
      $_.CommandLine -match $repoPattern -and
      $_.CommandLine -match "server\.ts|dist[\\/]server\.cjs"
    }
}

function Test-TrackerRunning {
  if (Get-TrackerProcesses | Select-Object -First 1) { return $true }
  return [bool](Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1)
}

function Start-Tracker {
  if (Test-TrackerRunning) { return }
  $startArgs = "/d /s /c cd /d `"$resolvedRepoPath`" && npm run dev"
  Start-Process -FilePath "cmd.exe" -ArgumentList $startArgs -WorkingDirectory $resolvedRepoPath -WindowStyle Hidden | Out-Null
}

function Stop-Tracker {
  Get-TrackerProcesses | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
}

function Update-TrayStatus {
  if (Test-TrackerRunning) {
    $notifyIcon.Text = "Lab Inventory Tracker - Running"
    $statusItem.Text = "Status: Running"
    $statusItem.ForeColor = [System.Drawing.Color]::DarkGreen
  } else {
    $notifyIcon.Text = "Lab Inventory Tracker - Stopped"
    $statusItem.Text = "Status: Stopped"
    $statusItem.ForeColor = [System.Drawing.Color]::DarkRed
  }
}

try {
  Start-Tracker

  $menu = New-Object System.Windows.Forms.ContextMenuStrip
  $statusItem = New-Object System.Windows.Forms.ToolStripMenuItem
  $statusItem.Text = "Status: Starting..."
  [void]$menu.Items.Add($statusItem)
  $statusItem.Enabled = $false
  [void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
  $openItem = New-Object System.Windows.Forms.ToolStripMenuItem
  $openItem.Text = "Open Tracker"
  $restartItem = New-Object System.Windows.Forms.ToolStripMenuItem
  $restartItem.Text = "Restart Server"
  $stopItem = New-Object System.Windows.Forms.ToolStripMenuItem
  $stopItem.Text = "Stop Server"
  [void]$menu.Items.Add($openItem)
  [void]$menu.Items.Add($restartItem)
  [void]$menu.Items.Add($stopItem)
  [void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
  $exitItem = New-Object System.Windows.Forms.ToolStripMenuItem
  $exitItem.Text = "Exit Tray"
  [void]$menu.Items.Add($exitItem)

  $notifyIcon = New-Object System.Windows.Forms.NotifyIcon
  $notifyIcon.Icon = [System.Drawing.SystemIcons]::Application
  $notifyIcon.Visible = $true
  $notifyIcon.ContextMenuStrip = $menu
  $notifyIcon.Text = "Lab Inventory Tracker"
  $notifyIcon.add_DoubleClick({ Start-Process "http://localhost:$Port" })
  $openItem.add_Click({ Start-Process "http://localhost:$Port" })
  $restartItem.add_Click({ Stop-Tracker; Start-Tracker; Update-TrayStatus })
  $stopItem.add_Click({ Stop-Tracker; Update-TrayStatus })
  $exitItem.add_Click({ $notifyIcon.Visible = $false; [System.Windows.Forms.Application]::ExitThread() })

  $timer = New-Object System.Windows.Forms.Timer
  $timer.Interval = 5000
  $timer.add_Tick({ Update-TrayStatus })
  $timer.Start()
  Update-TrayStatus
  [System.Windows.Forms.Application]::Run()
} finally {
  if ($timer) { $timer.Stop(); $timer.Dispose() }
  if ($notifyIcon) { $notifyIcon.Visible = $false; $notifyIcon.Dispose() }
  if ($menu) { $menu.Dispose() }
  if ($ownsMutex) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}