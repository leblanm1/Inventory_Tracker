# Inventory Tracker

## Run Locally

Prerequisites:
- Node.js 20+
- Git

Commands:
1. Install dependencies: `cmd /c npm install`
2. Start dev server: `cmd /c npm run dev`

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

Create a daily scheduled task:
- `powershell -ExecutionPolicy Bypass -File scripts/register-daily-backup-task.ps1 -Time 23:30`

Useful parameters:
- `-TaskName "InventoryDailyImmutableBackupGit"`
- `-Time "23:30"`
- `-RepoPath "C:\Invetory_Tracker"`

## Secure Branch Strategy (Recommended)

Use a dedicated remote branch (for example `backup-archives`) and protect it in your Git host:
1. Disallow force pushes.
2. Disallow branch deletion.
3. Restrict who can push.
4. Enable signed commits if your org requires higher integrity.

Note:
- Remote branch protection is configured in GitHub/GitLab/Bitbucket settings and cannot be enforced purely from local code.

