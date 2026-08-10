# Lab Inventory Tracker

A real-time, zero-install laboratory storage inventory management system. Track chemicals, plasmids, antibodies, enzymes, and cell stocks across freezers, refrigerators, and room-temperature cabinets — with multi-user synchronization, grid visualizers, drag-and-drop, audit logs, bulk CSV/Excel import, QR code labels, GHS hazard tracking, expiry alerts, low-stock reorder alerts, and daily immutable backups.

Runs as a local web app. No database to install — all data is stored in a JSON file on the server.

---

## Table of Contents

- [Features](#features)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Data Storage](#data-storage)
- [Backup & Recovery](#backup-recovery)
- [Restore / Undo — What You Need to Know](#restore-undo-what-you-need-to-know)
- [Automated Backups + Git (Windows)](#automated-backups-git-windows)
- [Production Deployment](#production-deployment)
- [Testing](#testing)
- [Tech Stack](#tech-stack)
- [Architecture Overview](#architecture-overview)
- [API Reference](#api-reference)

---

## Features

### Inventory Management

- **Hierarchical storage**: Organize samples across storage units (freezer, refrigerator, room-temperature cabinet) → shelves → racks → drawers → boxes → samples.
- **Grid and free-form boxes**: Boxes can be grid-based (e.g., 8×8, 10×10) with row/column coordinates for each sample, or free-form (no grid).
- **Drag-and-drop**: Relocate samples by dragging them between grid cells, shelves, racks, drawers, or boxes. Drag racks, drawers, and boxes to rearrange the storage hierarchy.
- **Add / edit / archive / deplete**: Full CRUD on samples and storage entities. "Deplete" marks a sample as used up (qty = 0). "Archive" soft-deletes an item and its contents (cascading: archiving a shelf archives its racks, drawers, boxes, and samples).
- **Trash bin**: Archived items are not deleted — they go to the Trash bin. Restore any archived item with one click (cascading unarchive: restoring a shelf unarchives everything inside it).

### Search

- **Fuzzy search** (powered by Fuse.js): Search across all entity types — samples, storage units, shelves, racks, drawers, and boxes — simultaneously.
- Sample search covers: chemical name, CAS number, item type, notes, plasmid name, organism, gene, primary depositor, catalog number, and lot number.
- Typo-tolerant (threshold 0.4). Results update live as you type.

### Sorting

- Sort the sample list by chemical name, CAS number, quantity, item type, location, or expiry date. Toggle ascending/descending.

### Bulk Import

- Paste CSV data directly or upload a spreadsheet. The import auto-creates storage units, shelves, racks, drawers, and boxes from the data — no need to pre-create the storage hierarchy.
- Maps standard lab inventory spreadsheet headers (chemical name, CAS #, lab, phase, room, location, plasmid name, organism, gene, vector, concentration, volume/mass, expiry date, catalog #, lot, and more).
- Import summary reports how many samples, storage units, shelves, racks, drawers, and boxes were created.

### Bulk Move

- Select multiple samples or boxes and move them to a new location in a single operation. Choose destination storage unit, shelf, rack, drawer, and box from dropdowns.

### QR Code Labels

- Generate QR codes for all active (non-archived) boxes. Opens a print-friendly label sheet in a new window.
- Scanning a QR code with a phone or tablet opens the app and navigates directly to that box (`?boxId=` URL param) or sample (`?sampleId=` URL param).
- Requires popups to be allowed for the print window.

### Lab Safety

- **GHS hazard codes**: Assign GHS H-codes (e.g., H225, H319) to samples. The app maps codes to standard pictogram categories (flammable, health hazard, environmental hazard, etc.) and displays them.
- **SDS links**: Store a URL to the Safety Data Sheet for each sample.
- **Storage classes**: Assign a storage class — flammable, corrosive, oxidizer, acid, base, light-sensitive, or general.
- **Compatibility checking**: The app warns when incompatible chemicals share the same container (e.g., flammables and oxidizers, acids and bases).

### Expiry Tracking

- Samples with an `expiresOn` date are automatically flagged:
  - **Expired** — past the expiry date
  - **Critical** — expires within 30 days
  - **Warning** — expires within 60 days
  - **Soon** — expires within 90 days
- A dashboard panel at the top of the page shows all expiring items, sorted by urgency. Click an item to jump to it.

### Low-Stock Alerts

- Set a **minimum stock level** and **reorder quantity** for each sample.
- A dashboard panel flags items at or below their minimum stock level.
- Export a **shopping list CSV** of all low-stock items with their suggested reorder quantities.

### Audit Trail

- Every mutation is logged: add, edit, archive, restore, move, deplete, bulk import, bulk move, database restore, user list update.
- Each log entry records: timestamp, user, action type, and a human-readable description.
- View the full history in the Audit Trail modal (filterable by action type and user).
- Export the audit trail as JSON or CSV.

### Undo Last Change

- One-click revert of the most recent action. See [Restore / Undo](#restore-undo-what-you-need-to-know) for limitations.

### Multi-User

- Define a comma-separated list of lab members. Each user selects their name from a dropdown in the top bar.
- All actions are attributed to the selected user in the audit trail.
- **Optimistic concurrency control**: If two users edit simultaneously, the server detects a version mismatch and returns a 409 conflict. The client automatically refreshes and retries once, preventing silent data loss.

### Export & Backup

- **Export JSON backup**: Downloads the full inventory state as a JSON file.
- **Export CSV**: Downloads all active samples plus boxes as a CSV file.
- **Export audit trail**: Download as JSON or CSV from the Audit Trail modal.
- **Import JSON backup**: Restore the entire database from a previously exported JSON file.

---

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 20 or later
- [Git](https://git-scm.com/)

### Install and Run

```bash
git clone https://github.com/leblanm1/Inventory_Tracker.git
cd Inventory_Tracker
npm install
npm run dev
```

Open `http://localhost:3000` in your browser.

> **Windows PowerShell note**: If `npm install` is blocked by script execution policy, run `cmd /c npm install` from the repo root instead.
>
> **Install warnings**: You may see `allow-scripts` warnings during install. These are informational and do not prevent a successful install.

### First Run

On first launch, the app creates demo data: 3 storage units (an ultra-low freezer, a refrigerator, and a room-temperature cabinet), 6 shelves, 3 boxes, and a few sample chemicals. Replace this with your real inventory via **bulk import** or clear it by archiving items.

---

## Configuration

All configuration is via environment variables. Copy `.env.example` to `.env` and uncomment the lines you need.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Port the server listens on. In dev mode, if the port is busy the server auto-finds the next available one. |
| `HMR_PORT` | `24678` | Vite hot-module-replacement port (dev mode only). |
| `LAB_PASSPHRASE` | *(unset)* | If set, the server binds to `0.0.0.0` (all network interfaces) and requires an `Authorization: Bearer <passphrase>` header on all API requests. If unset, the server binds to `127.0.0.1` (localhost only) for maximum security. |
| `INVENTORY_DATA_DIR` | macOS: `~/Library/Application Support/Sousa Lab Inventory` | Directory where `inventory.json` and `audit-snapshots.json` are stored. |
| `INVENTORY_IMMUTABLE_BACKUP_DIR` | `<INVENTORY_DATA_DIR>/immutable-backups` | Directory where daily immutable backup files are written. |
| `NODE_ENV` | *(unset = dev mode)* | Set to `production` for production mode (serves built static assets, no Vite HMR). |

### Security Modes

- **Localhost only** (default): Server binds to `127.0.0.1`. Only accessible from the same machine. No passphrase needed. Best for a single workstation.
- **Network with passphrase**: Set `LAB_PASSPHRASE` in `.env`. Server binds to `0.0.0.0` (accessible from other devices on the LAN). All API requests must include the passphrase as a Bearer token. The passphrase is injected into the served HTML so the web client authenticates automatically; external API callers must provide the header manually.

---

## Data Storage

The app uses file-based JSON storage — no database server required.

| File | Location | Contents |
|---|---|---|
| `inventory.json` | `<INVENTORY_DATA_DIR>/` | Full inventory state: samples, storage hierarchy, users, audit logs, audit snapshots. |
| `audit-snapshots.json` | `<INVENTORY_DATA_DIR>/` | Snapshot archive (metadata-only records). |
| `immutable-backups/` | `<INVENTORY_DATA_DIR>/` | Daily backup files (JSON + Excel). |

### Legacy Data Migration

If you previously ran the app with data in the repo's `data/` directory, the server automatically copies `data/inventory.json` and `data/audit-snapshots.json` to the configured data directory on first run. This is a one-time migration.

### Performance

The server keeps the full inventory state in memory after the first load. Subsequent reads are instant (no disk I/O). Writes update both the in-memory cache and the on-disk file. On server restart, the state is re-read from disk.

---

## Backup & Recovery

### Daily Immutable Backups

The server automatically creates one backup per day (checked on startup and every hour). For each day, two files are created in the `immutable-backups/` directory:

- `inventory-YYYY-MM-DD.json` — full inventory state
- `inventory-YYYY-MM-DD.xlsx` — Excel workbook with separate sheets for Users, StorageUnits, Shelves, Racks, Drawers, Boxes, Samples, AuditLogs, and AuditSnapshots

**Immutability guarantees:**

- Files are written with create-only mode (`wx` flag) — the app cannot overwrite an existing backup.
- Files are marked read-only (`chmod 444`) after creation.
- A `manifest.jsonl` file records each backup's filename, creation timestamp, and SHA-256 hash for tamper-evidence.

### Manual Backup (any OS)

Create today's immutable backup without starting the web server:

```bash
npm run backup:now
```

### Export from the UI

- **Export JSON backup**: Click the "Export JSON backup" button in the toolbar. Downloads the full state as a JSON file.
- **Export CSV**: Click "Export CSV" to download all active samples and boxes as a CSV file.
- **Export audit trail**: Open the Audit Trail modal and click "Export JSON" or "Export CSV".

### Restore from Backup

1. Click **"Import JSON backup"** in the toolbar.
2. Select a previously exported JSON backup file (or a daily immutable backup JSON file from the `immutable-backups/` directory).
3. The server validates the file, adds an audit log entry ("Database fully restored from backup"), resets the version counter, and replaces the entire inventory state.
4. The client refreshes with the restored data.

### Worst-Case Recovery

If something goes catastrophically wrong — corrupted data, accidental mass deletion, a bad mutation:

1. Locate the most recent `inventory-YYYY-MM-DD.json` file in the `immutable-backups/` directory.
2. Use **"Import JSON backup"** to load it.
3. The inventory reverts to that day's state. All samples, boxes, and storage hierarchy are restored. The audit log shows the restore event plus all prior history.

> **Tip**: The daily backup captures the state at the time it was first created that day (typically server startup or the first mutation after midnight). For the most up-to-date recovery point, use **"Export JSON backup"** manually before risky operations.

---

## Restore / Undo — What You Need to Know

The app has two restore features that use internal snapshots:

- **Undo Last Change** — reverts your most recent action.
- **Restore This Point** (in the Audit Trail modal) — rewinds the inventory to the state at a specific audit log entry.

### What Works

- **Undo and restore work for actions performed during your current browser session.** When you make a change, a full snapshot is kept in your browser's memory. Undo and restore use these in-memory snapshots.

### What Doesn't Work

- **After a page refresh**: Snapshots loaded from the server are metadata-only (they record *what* happened but not the full inventory state at that point). After refreshing the page, undo/restore will show an alert message until you make at least 2 new changes in the current session (undo needs the previous snapshot, which requires at least 2 in-session snapshots).
- **For snapshots from previous sessions**: Same limitation — older snapshots are metadata-only on disk.

### What's Always Preserved

- **The audit log is unaffected.** Every action is always recorded with its timestamp, user, action type, and description. You can always see the complete history of what happened in the Audit Trail modal — you just can't auto-rewind to old points after a refresh.

### For Reliable Cross-Session Recovery

Use the JSON backup export/import or the daily immutable backups described in [Backup & Recovery](#backup-recovery). These contain the full inventory data and are not affected by the snapshot limitation.

---

## Automated Backups + Git (Windows)

This repo includes automation scripts for Windows that combine immutable backup creation with Git-based offsite storage.

### Backup + Git Commit + Push

```bash
npm run backup:git
```

This command:

1. Generates today's immutable backups (JSON + Excel).
2. Builds git-safe compressed backup artifacts under `backups/git-archives/`.
3. Pushes to a dedicated backup branch.

**Why compressed archives?** GitHub rejects files larger than 100 MB. The automation compresses backups before committing so they fit within Git limits. Full immutable backups are kept locally; only compressed artifacts go to Git.

Optional environment variables:

| Variable | Default | Description |
|---|---|---|
| `BACKUP_GIT_REMOTE` | `origin` | Git remote to push to. |
| `BACKUP_GIT_BRANCH` | `backup-archives` | Branch to push compressed artifacts to. |
| `INVENTORY_DATA_DIR` | *(app default)* | Override if your app data is in a custom location. |

### Windows Task Scheduler (Daily Automated Backup)

Register a daily scheduled task at 7:00 AM:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/register-daily-backup-task.ps1 -Time 07:00
```

The scheduled task:

1. Runs the immutable backup + git archive push workflow (`npm run backup:git`).
2. Checks whether the inventory server is already running.
3. Starts `npm run dev` only if the server is not detected.
4. A fallback task runs at 7:05 AM in check-only mode to ensure the server is up even if the backup task hangs.

Useful parameters:

| Parameter | Default | Description |
|---|---|---|
| `-TaskName` | `InventoryDailyImmutableBackupGit` | Name of the primary scheduled task. |
| `-Time` | `07:00` | Time to run the backup. |
| `-FallbackTaskName` | `InventoryDailyEnsureRunning` | Name of the fallback task. |
| `-FallbackTime` | `07:05` | Time for the fallback server-check task. |
| `-RepoPath` | *(auto-detected)* | Path to the repo. |

Manual run of the same maintenance flow:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/morning-maintenance.ps1 -RepoPath "C:\Inventory_Tracker" -Port 3000
```

### Secure Branch Strategy (Recommended)

Use a dedicated remote branch (e.g., `backup-archives`) and protect it in your Git host:

1. Disallow force pushes.
2. Disallow branch deletion.
3. Restrict who can push.
4. Enable signed commits if your org requires higher integrity.

> Remote branch protection is configured in GitHub/GitLab/Bitbucket settings and cannot be enforced purely from local code.

---

## Production Deployment

### Build

```bash
npm run build
```

This builds the client (Vite) and bundles the server (esbuild → `dist/server.cjs`).

### Run

```bash
NODE_ENV=production npm start
```

The production server serves static assets from `dist/` and runs the bundled server. Set `LAB_PASSPHRASE` if the server needs to be accessible over the network.

### Quick Reference

| Command | Description |
|---|---|
| `npm run dev` | Start dev server with hot reload (default for local use). |
| `npm run build` | Build client + server for production. |
| `npm start` | Run the production server (`dist/server.cjs`). |
| `npm test` | Run the test suite (Vitest). |
| `npm run lint` | TypeScript type checking (`tsc --noEmit`). |
| `npm run backup:now` | Create today's immutable backup without starting the server. |
| `npm run backup:git` | Create backups + push compressed archives to a Git branch. |

---

## Testing

```bash
npm test        # run all tests
npm run lint    # TypeScript type checking
```

The test suite (64 tests across 2 files) covers:

- **`src/utils.test.ts`** (23 tests): CSV parsing (simple, multi-row, quoted fields, edge cases), CSV cell escaping, CSV export from samples and inventory rows, header-to-field mapping.
- **`src/labUtils.test.ts`** (42 tests): Expiry status calculation, expiry color/badge classes, expiry labels, days-until-expiry, expiring sample filtering, low-stock detection, low-stock sample sorting, shopping list CSV generation, GHS pictogram mapping, storage compatibility matrix, compatibility checking.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Tailwind CSS v4, Vite |
| Search | Fuse.js (fuzzy search) |
| Icons | lucide-react |
| Animations | motion |
| Backend | Express, TypeScript |
| Dev runner | tsx |
| Production bundler | esbuild |
| Data storage | JSON file (no database) |
| QR codes | qrcode |
| Excel export | ExcelJS |
| Testing | Vitest |

---

## Architecture Overview

### Server (`server.ts`)

Express server providing a granular REST API. Key design decisions:

- **In-memory state cache**: The full inventory state is loaded into memory on first access (`cachedState`). Subsequent reads serve from cache (instant, no disk I/O). Writes update both the cache and the on-disk file.
- **Optimistic concurrency control**: Every state change increments a version number. The client sends its current version with each mutation; the server rejects mismatches with HTTP 409. The client auto-refreshes and retries once.
- **`mutateState` engine**: Centralizes the read-modify-write cycle for all granular mutations. Handles version checking, audit log creation, snapshot creation, and disk persistence.
- **Lightweight snapshots**: Snapshots on disk are metadata-only (id, timestamp, user, action, description) to keep the data file small. Full snapshot payloads exist only in the client's React state for in-session undo/restore. See [Restore / Undo](#restore-undo-what-you-need-to-know).
- **Daily immutable backups**: Scheduled on startup and checked hourly. Write-once files with SHA-256 manifest.

### Client (`src/App.tsx`)

Main React component (~6,000+ lines). Key patterns:

- **Optimistic updates**: When a mutation is made, the UI updates instantly with the expected result (no waiting for the server). The server response then merges in the new version number and audit entries. On 409 conflict, the optimistic state is discarded, the full state is re-fetched, and the mutation retries.
- **`apiMutate` helper**: Handles all granular API calls. Accepts an optional `optimisticState` parameter for instant UI updates. Manages 409 conflict retry logic. Augments server-returned metadata-only snapshots with full payload arrays from the current state for in-session undo/restore.
- **`saveStateToServer`**: Full-state save path (used by restore/undo operations). Sends a lightweight snapshot to the server but keeps the full snapshot in React state.

### Supporting Modules

| File | Responsibility |
|---|---|
| `src/types.ts` | TypeScript interfaces for all entities (StorageUnit, Shelf, Rack, Drawer, Box, Sample, AuditLog, AuditSnapshot, InventoryState). `AuditSnapshot` payload fields are optional (metadata-only on disk). |
| `src/labUtils.ts` | Expiry tracking, GHS hazard pictograms, storage compatibility matrix, low-stock detection, shopping list CSV generation. |
| `src/utils.ts` | CSV parsing and export, header-to-field mapping for bulk import. |
| `src/qrUtils.ts` | QR code generation and print-friendly label sheets. |
| `src/auth.ts` | Client-side auth helper — fetches passphrase from server, attaches Bearer header to all API calls. |
| `src/components/AuditTrailModal.tsx` | Full audit history viewer with filtering and export. |
| `src/components/BulkImportPanel.tsx` | CSV paste/upload import with auto-creation of storage hierarchy. |
| `src/components/BulkMoveModal.tsx` | Multi-item move dialog. |
| `src/components/DashboardPanels.tsx` | Expiry alerts and low-stock alerts panels. |
| `src/components/SampleFormModal.tsx` | Add/edit sample form. |
| `src/components/SampleInspector.tsx` | Right sidebar showing sample details, safety info, and recent audit trail. |
| `src/components/StorageFormModal.tsx` | Add/edit storage unit, shelf, rack, drawer, or box. |

---

## API Reference

All endpoints except `/api/auth-config` require the `LAB_PASSPHRASE` Bearer header when passphrase auth is enabled. Mutation endpoints require an `X-Client-Version` header (current state version) and an `X-User` header (selected lab member).

| Method | Path | Description |
|---|---|---|
| GET | `/api/auth-config` | Returns passphrase config (unauthenticated). |
| GET | `/api/inventory` | Get full inventory state. |
| POST | `/api/inventory` | Save full state (version-checked, used by restore/undo). |
| PUT | `/api/samples` | Add or update samples (bulk upsert). |
| PATCH | `/api/samples/bulk` | Bulk update or archive samples. |
| PATCH | `/api/samples/:id` | Update or deplete a single sample. |
| PUT | `/api/storage-units` | Add or update a storage unit. |
| PATCH | `/api/storage-units/:id` | Update or archive a storage unit. |
| PUT | `/api/shelves` | Add or update a shelf. |
| PATCH | `/api/shelves/:id` | Update or archive a shelf. |
| PUT | `/api/racks` | Add or update a rack. |
| PATCH | `/api/racks/:id` | Update or archive a rack. |
| PUT | `/api/drawers` | Add or update a drawer. |
| PATCH | `/api/drawers/:id` | Update or archive a drawer. |
| PUT | `/api/boxes` | Add or update a box. |
| PATCH | `/api/boxes/:id` | Update or archive a box. |
| PATCH | `/api/bulk-move` | Bulk move samples, boxes, drawers, or racks to a new location. |
| PATCH | `/api/restore` | Restore an archived item (cascading unarchive). |
| PATCH | `/api/users` | Update the lab member list. |
| POST | `/api/bulk-import` | Bulk import samples from CSV data. |
| GET | `/api/export` | Download full inventory state as JSON. |
| POST | `/api/import` | Restore database from a JSON backup file. |
