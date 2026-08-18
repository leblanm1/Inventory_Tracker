@echo off
setlocal
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
    echo Node.js and npm were not found in PATH.
    echo Please install Node.js 20 or later and reopen this shortcut.
    pause
    exit /b 1
)

if not exist node_modules (
    echo Installing dependencies for the laboratory tracker...
    call cmd /c npm install
    if errorlevel 1 (
        echo Dependency install failed.
        pause
        exit /b 1
    )
)

echo Starting the Laboratory Tracker...
start "" http://localhost:3000
call cmd /c npm run dev

if errorlevel 1 (
    echo The tracker stopped unexpectedly.
    pause
)
