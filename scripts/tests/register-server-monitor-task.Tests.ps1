$registrationScript = Join-Path $PSScriptRoot "..\register-server-monitor-task.ps1"

Describe "Server monitor task registration" {
  $account = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  $credential = New-Object System.Management.Automation.PSCredential($account, (ConvertTo-SecureString "test-password" -AsPlainText -Force))
  Mock Test-Path { $true } -ParameterFilter { $LiteralPath -like "*healthchecks-ping-url.dpapi" }
  Mock Register-ScheduledTask {}

  It "registers an 8 AM local-time trigger without a fixed time-zone offset" {
    & $registrationScript -Time "08:00" -Credential $credential

    Assert-MockCalled Register-ScheduledTask -Times 1 -Exactly -ParameterFilter {
      $Trigger.StartBoundary -match '^\d{4}-\d{2}-\d{2}T08:00:00$' -and
      $User -eq $account -and $Password -eq "test-password"
    }
  }

  It "preserves a custom local time without a fixed time-zone offset" {
    & $registrationScript -Time "06:30" -Credential $credential

    Assert-MockCalled Register-ScheduledTask -Times 1 -Exactly -ParameterFilter {
      $Trigger.StartBoundary -match '^\d{4}-\d{2}-\d{2}T06:30:00$'
    }
  }
}
