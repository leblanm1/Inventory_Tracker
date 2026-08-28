@echo off
setlocal
cd /d "%~dp0"

set "PowerShellPath=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PowerShellPath%" (
    echo Windows PowerShell was not found.
    pause
    exit /b 1
)

where powershell.exe >nul 2>nul
if errorlevel 1 (
    echo Windows PowerShell was not found in PATH.
    pause
    exit /b 1
)

start "" "%PowerShellPath%" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0scripts\inventory-tray.ps1" -RepoPath "%~dp0"
start "" "http://localhost:3000"
