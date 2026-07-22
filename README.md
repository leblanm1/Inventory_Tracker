# Inventory Tracker

## Run Locally

Prerequisites:
- Node.js 20+
- Git

Commands:
1. Install dependencies: `cmd /c npm install`
2. Start dev server: `cmd /c npm run dev`

Note:
- In Windows PowerShell, running bare `npm install` can be blocked by script execution policy. Use `cmd /c npm install` from the repo root.
- You may see `allow-scripts` warnings during install; in this repo they are informational and do not stop a successful install.

## Immutable Daily Backups

The server creates daily immutable backups (JSON + Excel).

Files created each day:
- `inventory-YYYY-MM-DD.json`
- `inventory-YYYY-MM-DD.xlsx`
- `manifest.jsonl` (SHA-256 hashes)

Immutability behavior:
- New backup files are written with create-only mode (`wx`) so they cannot be overwritten by app logic.
- Files are marked read-only after creation.
- Manifest hashes provide tamper-evidence.

## One-Shot Backup Command

Run a backup immediately without starting the web server:
- `cmd /c npm run backup:now`

Optional environment variables:
- `INVENTORY_DATA_DIR`: where `inventory.json` lives.
- `INVENTORY_IMMUTABLE_BACKUP_DIR`: where immutable backup files are written.

## Daily Backup + Git Commit + Push

This repo includes an automation command that:
1. Generates today's immutable backups.
2. Builds git-safe compressed backup artifacts under `backups/git-archives`.
3. Pushes to a dedicated backup branch.

Run manually:
- `cmd /c npm run backup:git`

Optional environment variables:
- `BACKUP_GIT_REMOTE` (default `origin`)
- `BACKUP_GIT_BRANCH` (default `backup-archives`)
- `INVENTORY_DATA_DIR` (if your app data is in a custom location)

Why compressed git archives:
- GitHub rejects files larger than 100 MB.
- The automation keeps full immutable backups locally and commits compressed archive artifacts to Git.

## Windows Task Scheduler (Daily)

Create a daily scheduled task at 7:00 AM:
- `powershell -ExecutionPolicy Bypass -File scripts/register-daily-backup-task.ps1 -Time 07:00`

What the scheduled task now does:
1. Runs the immutable backup + git archive push workflow (`npm run backup:git`).
2. Checks whether the inventory server is already running.
3. Starts `npm run dev` only if the server is not detected.
4. A fallback task runs at 7:05 AM in check-only mode to ensure the server is up even if the backup task hangs.

Useful parameters:
- `-TaskName "InventoryDailyImmutableBackupGit"`
- `-Time "07:00"`
- `-FallbackTaskName "InventoryDailyEnsureRunning"`
- `-FallbackTime "07:05"`
- `-RepoPath "C:\Invetory_Tracker"`

Optional manual run of the same maintenance flow:
- `powershell -ExecutionPolicy Bypass -File scripts/morning-maintenance.ps1 -RepoPath "C:\Invetory_Tracker" -Port 3000`

## Secure Branch Strategy (Recommended)

Use a dedicated remote branch (for example `backup-archives`) and protect it in your Git host:
1. Disallow force pushes.
2. Disallow branch deletion.
3. Restrict who can push.
4. Enable signed commits if your org requires higher integrity.

Note:
- Remote branch protection is configured in GitHub/GitLab/Bitbucket settings and cannot be enforced purely from local code.

