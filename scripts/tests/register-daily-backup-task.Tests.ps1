$registrationScript = Join-Path $PSScriptRoot "..\register-daily-backup-task.ps1"

Describe "Daily maintenance task registration" {
  $account = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  $credential = New-Object System.Management.Automation.PSCredential($account, (ConvertTo-SecureString "test-password" -AsPlainText -Force))
  Mock Register-ScheduledTask {}

  It "registers all three tasks with the account password for unattended execution" {
    & $registrationScript -Credential $credential

    Assert-MockCalled Register-ScheduledTask -Times 3 -Exactly -ParameterFilter {
      $User -eq $account -and $Password -eq "test-password" -and $Settings.StartWhenAvailable
    }
    Assert-MockCalled Register-ScheduledTask -Times 1 -Exactly -ParameterFilter {
      $TaskName -eq "InventoryDailyEnsureRunning" -and $Action.Arguments -match "-SkipBackup"
    }
  }
}
