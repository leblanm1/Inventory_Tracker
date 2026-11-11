$maintenanceScript = Join-Path $PSScriptRoot "..\morning-maintenance.ps1"
$repoPath = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path

Describe "Morning maintenance health check" {
  Mock Get-NetTCPConnection { [pscustomobject]@{ LocalPort = 3000 } }
  Mock Get-CimInstance {}
  Mock Start-Process {}
  Mock Start-Sleep {}

  It "does not start another server when the tracker responds" {
    Mock Invoke-WebRequest { [pscustomobject]@{ Content = "<title>Lab Inventory Tracker</title>" } }

    & $maintenanceScript -SkipBackup

    Assert-MockCalled Start-Process -Times 0 -Exactly -Scope It
  }

  It "does not mistake another application for the tracker and starts the server headlessly" {
    $script:requestCount = 0
    Mock Invoke-WebRequest {
      $script:requestCount++
      if ($script:requestCount -eq 1) {
        return [pscustomobject]@{ Content = "<title>Other application</title>" }
      }
      return [pscustomobject]@{ Content = "<title>Lab Inventory Tracker</title>" }
    }

    & $maintenanceScript -SkipBackup

    Assert-MockCalled Start-Process -Times 1 -Exactly -Scope It -ParameterFilter {
      $FilePath -eq "cmd.exe" -and $ArgumentList -match "npm run dev" -and
      $ArgumentList -notmatch "inventory-tray" -and $WindowStyle -eq "Hidden"
    }
  }

  It "waits for an existing server process instead of starting a duplicate" {
    $script:requestCount = 0
    Mock Invoke-WebRequest {
      $script:requestCount++
      if ($script:requestCount -eq 1) {
        return [pscustomobject]@{ Content = "<title>Other application</title>" }
      }
      return [pscustomobject]@{ Content = "<title>Lab Inventory Tracker</title>" }
    }
    Mock Get-CimInstance {
      [pscustomobject]@{ Name = "node.exe"; CommandLine = "node $repoPath\server.ts" }
    }

    & $maintenanceScript -SkipBackup

    Assert-MockCalled Start-Process -Times 0 -Exactly -Scope It
    Assert-MockCalled Invoke-WebRequest -Times 2 -Exactly -Scope It
  }
}
