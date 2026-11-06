$registrationScript = Join-Path $PSScriptRoot "..\register-server-monitor-task.ps1"

Describe "Server monitor task registration" {
  Mock Test-Path { $true } -ParameterFilter { $LiteralPath -like "*healthchecks-ping-url.dpapi" }
  Mock Register-ScheduledTask {}

  It "registers an 8 AM local-time trigger without a fixed time-zone offset" {
    & $registrationScript -Time "08:00"

    Assert-MockCalled Register-ScheduledTask -Times 1 -Exactly -ParameterFilter {
      $Trigger.StartBoundary -match '^\d{4}-\d{2}-\d{2}T08:00:00$'
    }
  }

  It "preserves a custom local time without a fixed time-zone offset" {
    & $registrationScript -Time "06:30"

    Assert-MockCalled Register-ScheduledTask -Times 1 -Exactly -ParameterFilter {
      $Trigger.StartBoundary -match '^\d{4}-\d{2}-\d{2}T06:30:00$'
    }
  }
}
