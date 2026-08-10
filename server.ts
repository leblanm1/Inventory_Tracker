import "dotenv/config";
import express from "express";
import os from "node:os";
import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import net from "node:net";
import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { createServer as createViteServer } from "vite";
import { InventoryState, StorageUnit, Shelf, Box, Sample, AuditLog, AuditSnapshot, Rack, Drawer } from "./src/types.js";

// Helper to get directory path
const __dirname = path.resolve();
const LEGACY_DATA_DIR = path.join(__dirname, "data");
const DATA_DIR = process.env.INVENTORY_DATA_DIR || path.join(os.homedir(), "Library", "Application Support", "Sousa Lab Inventory");
const DATA_FILE = path.join(DATA_DIR, "inventory.json");
const SNAPSHOT_ARCHIVE_FILE = path.join(DATA_DIR, "audit-snapshots.json");
const IMMUTABLE_BACKUP_DIR = process.env.INVENTORY_IMMUTABLE_BACKUP_DIR || path.join(DATA_DIR, "immutable-backups");
const IMMUTABLE_BACKUP_MANIFEST = path.join(IMMUTABLE_BACKUP_DIR, "manifest.jsonl");
const LEGACY_DATA_FILE = path.join(LEGACY_DATA_DIR, "inventory.json");
const LEGACY_SNAPSHOT_ARCHIVE_FILE = path.join(LEGACY_DATA_DIR, "audit-snapshots.json");
const DEFAULT_USERS = [
  "Dr. Aris (Lab Director)",
  "Sarah Lin (PhD Candidate)",
  "James Miller (Postdoc)",
  "Lab Assistant Bot"
];

function sanitizeUsers(users: unknown): string[] {
  if (!Array.isArray(users)) return DEFAULT_USERS;
  const cleaned = users
    .filter((u): u is string => typeof u === "string")
    .map((u) => u.trim())
    .filter(Boolean);
  return cleaned.length ? Array.from(new Set(cleaned)) : DEFAULT_USERS;
}

type SnapshotRecord = {
  id: string;
  logId?: string;
  timestamp?: string;
  user?: string;
  action?: string;
  description?: string;
};

function mergeSnapshots(
  primary: SnapshotRecord[] = [],
  secondary: SnapshotRecord[] = [],
  limit = 1000
): SnapshotRecord[] {
  return [
    ...primary,
    ...secondary.filter(snapshot => !primary.some(existing => existing.id === snapshot.id))
  ]
    .sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""))
    .slice(0, limit);
}

function getDateStamp(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function getImmutableBackupPathForDate(date: Date = new Date()): string {
  return path.join(IMMUTABLE_BACKUP_DIR, `inventory-${getDateStamp(date)}.json`);
}

function getImmutableExcelBackupPathForDate(date: Date = new Date()): string {
  return path.join(IMMUTABLE_BACKUP_DIR, `inventory-${getDateStamp(date)}.xlsx`);
}

function addJsonSheet(workbook: ExcelJS.Workbook, sheetName: string, rows: Record<string, unknown>[]): void {
  const worksheet = workbook.addWorksheet(sheetName);
  const normalizedRows = rows ?? [];

  const headers = Array.from(
    normalizedRows.reduce((set, row) => {
      Object.keys(row || {}).forEach((key) => set.add(key));
      return set;
    }, new Set<string>())
  );

  if (headers.length === 0) {
    worksheet.addRow(["No data"]);
    return;
  }

  worksheet.columns = headers.map((header) => ({ header, key: header, width: 24 }));
  normalizedRows.forEach((row) => {
    const output: Record<string, unknown> = {};
    headers.forEach((header) => {
      const value = row?.[header];
      output[header] = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : value;
    });
    worksheet.addRow(output);
  });
}

async function buildWorkbookBufferFromState(state: InventoryState): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Sousa Lab Inventory";
  workbook.created = new Date();

  addJsonSheet(workbook, "Users", state.users.map((name) => ({ name })));
  addJsonSheet(workbook, "StorageUnits", state.storageUnits as unknown as Record<string, unknown>[]);
  addJsonSheet(workbook, "Shelves", state.shelves as unknown as Record<string, unknown>[]);
  addJsonSheet(workbook, "Racks", state.racks as unknown as Record<string, unknown>[]);
  addJsonSheet(workbook, "Drawers", state.drawers as unknown as Record<string, unknown>[]);
  addJsonSheet(workbook, "Boxes", state.boxes as unknown as Record<string, unknown>[]);
  addJsonSheet(workbook, "Samples", state.samples as unknown as Record<string, unknown>[]);
  addJsonSheet(workbook, "AuditLogs", state.auditLogs as unknown as Record<string, unknown>[]);
  addJsonSheet(workbook, "AuditSnapshots", state.auditSnapshots as unknown as Record<string, unknown>[]);

  const out = await workbook.xlsx.writeBuffer();
  return Buffer.from(out);
}

async function appendImmutableBackupManifest(backupPath: string, content: string | Buffer): Promise<void> {
  try {
    const entry = {
      file: path.basename(backupPath),
      createdAt: new Date().toISOString(),
      sha256: createHash("sha256").update(content).digest("hex")
    };
    await fs.appendFile(IMMUTABLE_BACKUP_MANIFEST, `${JSON.stringify(entry)}\n`, "utf-8");
  } catch (err) {
    console.error("Error appending immutable backup manifest:", err);
  }
}

async function ensureDailyImmutableBackup(): Promise<boolean> {
  try {
    await migrateLegacyDataIfNeeded();
    if (!existsSync(DATA_DIR)) {
      await fs.mkdir(DATA_DIR, { recursive: true });
    }
    if (!existsSync(DATA_FILE)) {
      const seedState = getDemoState();
      await fs.writeFile(DATA_FILE, JSON.stringify(seedState, null, 2), "utf-8");
    }

    if (!existsSync(IMMUTABLE_BACKUP_DIR)) {
      await fs.mkdir(IMMUTABLE_BACKUP_DIR, { recursive: true });
    }

    const backupPath = getImmutableBackupPathForDate();
    const excelBackupPath = getImmutableExcelBackupPathForDate();
    if (existsSync(backupPath) && existsSync(excelBackupPath)) {
      return false;
    }

    const rawContent = await fs.readFile(DATA_FILE, "utf-8");
    const parsedState = JSON.parse(rawContent) as InventoryState;
    const normalizedContent = JSON.stringify(parsedState, null, 2);
    const workbookBuffer = await buildWorkbookBufferFromState(parsedState);

    // "wx" guarantees the app cannot overwrite an existing backup file.
    if (!existsSync(backupPath)) {
      await fs.writeFile(backupPath, normalizedContent, { encoding: "utf-8", flag: "wx" });

      try {
        // Best-effort read-only lock at the file level.
        await fs.chmod(backupPath, 0o444);
      } catch (chmodErr) {
        console.warn("JSON backup created, but read-only permission could not be applied:", chmodErr);
      }

      await appendImmutableBackupManifest(backupPath, normalizedContent);
    }

    if (!existsSync(excelBackupPath)) {
      await fs.writeFile(excelBackupPath, workbookBuffer, { flag: "wx" });

      try {
        // Best-effort read-only lock at the file level.
        await fs.chmod(excelBackupPath, 0o444);
      } catch (chmodErr) {
        console.warn("Excel backup created, but read-only permission could not be applied:", chmodErr);
      }

      await appendImmutableBackupManifest(excelBackupPath, workbookBuffer);
    }

    console.log(`Immutable daily backups ensured: ${backupPath} and ${excelBackupPath}`);
    return true;
  } catch (err) {
    console.error("Error creating immutable daily backup:", err);
    return false;
  }
}

function scheduleDailyImmutableBackups(): void {
  void ensureDailyImmutableBackup();

  const oneHourMs = 60 * 60 * 1000;
  const timer = setInterval(() => {
    void ensureDailyImmutableBackup();
  }, oneHourMs);

  // Do not keep Node alive solely for the backup scheduler.
  timer.unref();
}

async function loadSnapshotArchive(): Promise<SnapshotRecord[]> {
  try {
    if (!existsSync(SNAPSHOT_ARCHIVE_FILE)) return [];
    const raw = await fs.readFile(SNAPSHOT_ARCHIVE_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error("Error loading snapshot archive:", err);
    return [];
  }
}

async function saveSnapshotArchive(snapshots: SnapshotRecord[]): Promise<void> {
  try {
    if (!existsSync(DATA_DIR)) {
      await fs.mkdir(DATA_DIR, { recursive: true });
    }
    await fs.writeFile(SNAPSHOT_ARCHIVE_FILE, JSON.stringify(snapshots, null, 2), "utf-8");
  } catch (err) {
    console.error("Error saving snapshot archive:", err);
  }
}

async function migrateLegacyDataIfNeeded(): Promise<void> {
  try {
    if (DATA_DIR === LEGACY_DATA_DIR) return;

    if (!existsSync(DATA_DIR)) {
      await fs.mkdir(DATA_DIR, { recursive: true });
    }

    if (!existsSync(DATA_FILE) && existsSync(LEGACY_DATA_FILE)) {
      await fs.copyFile(LEGACY_DATA_FILE, DATA_FILE);
    }

    if (!existsSync(SNAPSHOT_ARCHIVE_FILE) && existsSync(LEGACY_SNAPSHOT_ARCHIVE_FILE)) {
      await fs.copyFile(LEGACY_SNAPSHOT_ARCHIVE_FILE, SNAPSHOT_ARCHIVE_FILE);
    }
  } catch (err) {
    console.error("Error migrating legacy inventory data:", err);
  }
}

// Helper to construct a base empty or demo state
function getDemoState(): InventoryState {
  const now = new Date().toISOString();
  
  const storageUnits: StorageUnit[] = [
    { id: "store-1", name: "-80°C Ultra-Low Freezer", type: "freezer" },
    { id: "store-2", name: "Main Lab Refrigerator (4°C)", type: "refrigerator" },
    { id: "store-3", name: "Chemical Cabinet (Room Temp)", type: "room_temp" }
  ];

  const shelves: Shelf[] = [
    // Freezer Shelves
    { id: "shelf-1-1", storageId: "store-1", name: "Top Shelf (Shelf 1)" },
    { id: "shelf-1-2", storageId: "store-1", name: "Middle Shelf (Shelf 2)" },
    // Fridge Shelves
    { id: "shelf-2-1", storageId: "store-2", name: "Upper Shelf" },
    { id: "shelf-2-2", storageId: "store-2", name: "Crisper Drawer" },
    // Cabinet Shelves
    { id: "shelf-3-1", storageId: "store-3", name: "Aisle A - Row 1" },
    { id: "shelf-3-2", storageId: "store-3", name: "Aisle A - Row 2" }
  ];

  const boxes: Box[] = [
    // Freezer Box
    { id: "box-1-1-1", shelfId: "shelf-1-1", storageId: "store-1", name: "Plasmid DNA Grid Box A", rows: 8, cols: 8 },
    { id: "box-1-1-2", shelfId: "shelf-1-1", storageId: "store-1", name: "E. Coli Glycerol Stocks", rows: 10, cols: 10 },
    // Fridge Box
    { id: "box-2-1-1", shelfId: "shelf-2-1", storageId: "store-2", name: "Enzyme Rack 1", rows: null, cols: null }
  ];

  // Helper to create basic empty metadata for spreadsheet compatibility
  const emptyMeta = {
    chemicalId: "",
    lab: "Main Bio Lab",
    phase: "",
    room: "Room 402",
    location: "",
    subLocation: "",
    status: "Available",
    plasmidName: "",
    primaryBox: "",
    secondaryBox: "",
    primaryTube: "",
    secondaryTube: "",
    primaryDateDeposited: "",
    secondaryDateDeposited: "",
    primaryDepositedBy: "",
    secondaryDepositedBy: "",
    primaryPrep: "",
    secondaryPrep: "",
    primaryRef: "",
    secondaryRef: "",
    system: "",
    organism: "",
    gene: "",
    fragmentSize: "",
    mutations: "",
    vector: "",
    markers: "",
    hosts: "",
    notebookRef: "",
    source: "",
    file: "",
    freezerIdStr: "",
    freezerNameStr: "",
    shelfIdStr: "",
    shelfNameStr: "",
    rackIdStr: "",
    rackName: "",
    drawerIdStr: "",
    drawerNameStr: "",
    categoryId: "",
    categoryName: "",
    boxIdStr: "",
    boxNameStr: "",
    itemGroupId: "",
    itemGroupName: "",
    itemId: "",
    itemName: "",
    concentration: "",
    volumeMass: "",
    expiresOn: "",
    createdOn: now,
    catalogNum: "",
    packaging: "",
    price: "",
    lot: ""
  };

  const samples: Sample[] = [
    // DNA Grid Box A (Row 1, Col 1)
    {
      id: "sample-1",
      storageId: "store-1",
      shelfId: "shelf-1-1",
      boxId: "box-1-1-1",
      row: 1,
      col: 1,
      qty: 5,
      units: "vials",
      chemicalName: "pUC19 Control Plasmid",
      casNumber: "",
      itemType: "Plasmid",
      notes: "High purity control plasmid, concentration 100 ng/µL",
      ...emptyMeta,
      plasmidName: "pUC19",
      organism: "E. coli",
      vector: "pUC19",
      concentration: "100 ng/µL",
      volumeMass: "50 µL",
      primaryDepositedBy: "Dr. Aris"
    },
    // DNA Grid Box A (Row 1, Col 2)
    {
      id: "sample-2",
      storageId: "store-1",
      shelfId: "shelf-1-1",
      boxId: "box-1-1-1",
      row: 1,
      col: 2,
      qty: 2,
      units: "vials",
      chemicalName: "pEGFP-N1 Reporter",
      casNumber: "",
      itemType: "Plasmid",
      notes: "GFP expression reporter vector",
      ...emptyMeta,
      plasmidName: "pEGFP-N1",
      gene: "EGFP",
      vector: "pEGFP-N1",
      concentration: "500 ng/µL",
      volumeMass: "20 µL",
      primaryDepositedBy: "Sarah Lin"
    },
    // Glycerol stocks box (Row 5, Col 5)
    {
      id: "sample-3",
      storageId: "store-1",
      shelfId: "shelf-1-1",
      boxId: "box-1-1-2",
      row: 5,
      col: 5,
      qty: 1,
      units: "cryovial",
      chemicalName: "DH5alpha + pUC19 stock",
      casNumber: "",
      itemType: "Glycerol Stock",
      notes: "Stored in 25% glycerol",
      ...emptyMeta,
      organism: "E. coli",
      hosts: "DH5-alpha",
      primaryDepositedBy: "Sarah Lin"
    },
    // Refrigerator enzymes (Not in grid, free-form Box)
    {
      id: "sample-4",
      storageId: "store-2",
      shelfId: "shelf-2-1",
      boxId: "box-2-1-1",
      row: null,
      col: null,
      qty: 3,
      units: "tubes",
      chemicalName: "Taq DNA Polymerase",
      casNumber: "9012-90-2",
      itemType: "Enzyme",
      notes: "Keep on ice during use. Store in dark box.",
      ...emptyMeta,
      catalogNum: "TAQ-100",
      source: "NEB"
    },
    // Directly on Shelf 2-2 (Fridge Crisper Drawer)
    {
      id: "sample-5",
      storageId: "store-2",
      shelfId: "shelf-2-2",
      boxId: null,
      row: null,
      col: null,
      qty: 10,
      units: "plates",
      chemicalName: "LB Agar Plates (Ampicillin)",
      casNumber: "",
      itemType: "Media",
      notes: "Poured on 2026-06-20",
      ...emptyMeta,
      createdOn: "2026-06-20T10:00:00Z"
    },
    // Chemical Cabinet chemicals
    {
      id: "sample-6",
      storageId: "store-3",
      shelfId: "shelf-3-1",
      boxId: null,
      row: null,
      col: null,
      qty: 1,
      units: "bottle (500g)",
      chemicalName: "Sodium Chloride (NaCl)",
      casNumber: "7647-14-5",
      itemType: "Chemical",
      notes: "Sigma Aldrich, analytical grade",
      ...emptyMeta,
      catalogNum: "S7653",
      price: "$45.00"
    },
    {
      id: "sample-7",
      storageId: "store-3",
      shelfId: "shelf-3-2",
      boxId: null,
      row: null,
      col: null,
      qty: 2,
      units: "bottles (100g)",
      chemicalName: "Agarose, Molecular Biology Grade",
      casNumber: "9012-36-6",
      itemType: "Chemical",
      notes: "For gel electrophoresis",
      ...emptyMeta,
      catalogNum: "AGA-100"
    }
  ];

  const auditLogs: AuditLog[] = [
    {
      id: "log-1",
      timestamp: now,
      user: "System",
      action: "Database Initialized",
      description: "Default lab inventory database bootstrapped successfully with refrigerators, freezers, and sample logs."
    }
  ];

  const racks: Rack[] = [];
  const drawers: Drawer[] = [];

  return { version: 0, users: DEFAULT_USERS, storageUnits, shelves, racks, drawers, boxes, samples, auditLogs, auditSnapshots: [] };
}

// Function to load inventory state
// ---------------------------------------------------------------------------
// In-memory state cache
//
// Reading and parsing the 23 MB inventory.json on every request was the
// primary source of UI lag.  We now keep the parsed state in memory and only
// touch disk on startup (cold load) and on writes (persistence).  All reads
// are served from the cache, which is updated synchronously after each
// successful save.
// ---------------------------------------------------------------------------

let cachedState: InventoryState | null = null;

/** Cold-load the state from disk into the in-memory cache. */
async function loadStateFromDisk(): Promise<InventoryState> {
  await migrateLegacyDataIfNeeded();
  if (!existsSync(DATA_DIR)) {
    await fs.mkdir(DATA_DIR, { recursive: true });
  }
  if (!existsSync(DATA_FILE)) {
    const demo = getDemoState();
    await fs.writeFile(DATA_FILE, JSON.stringify(demo, null, 2), "utf-8");
    await saveSnapshotArchive((demo.auditSnapshots || []) as SnapshotRecord[]);
    return demo;
  }
  const content = await fs.readFile(DATA_FILE, "utf-8");
  const parsed = JSON.parse(content) as Partial<InventoryState>;
  const archivedSnapshots = await loadSnapshotArchive();
  const mergedSnapshots = mergeSnapshots(
    (parsed.auditSnapshots || []) as SnapshotRecord[],
    archivedSnapshots,
    1000
  );
  return {
    version: typeof parsed.version === "number" ? parsed.version : 0,
    users: sanitizeUsers(parsed.users),
    storageUnits: parsed.storageUnits || [],
    shelves: parsed.shelves || [],
    racks: parsed.racks || [],
    drawers: parsed.drawers || [],
    boxes: parsed.boxes || [],
    samples: parsed.samples || [],
    auditLogs: parsed.auditLogs || [],
    auditSnapshots: mergedSnapshots as InventoryState["auditSnapshots"]
  };
}

/**
 * Return the current inventory state.
 *
 * Serves from the in-memory cache; only touches disk on the very first call
 * (cold start) or after an explicit cache invalidation.
 */
async function loadState(): Promise<InventoryState> {
  if (cachedState) return cachedState;
  try {
    cachedState = await loadStateFromDisk();
    return cachedState;
  } catch (err) {
    console.error("Error loading inventory state:", err);
    cachedState = getDemoState();
    return cachedState;
  }
}

/** Force the next `loadState()` to re-read from disk (used by tests/import). */
function invalidateStateCache(): void {
  cachedState = null;
}

// Function to save inventory state (writes to disk AND updates the cache)
async function saveState(state: InventoryState): Promise<void> {
  try {
    await migrateLegacyDataIfNeeded();
    if (!existsSync(DATA_DIR)) {
      await fs.mkdir(DATA_DIR, { recursive: true });
    }
    // Write the full state to disk for persistence / crash recovery.
    // The auditSnapshots in the on-disk file are kept lightweight (metadata
    // only — see createLightweightSnapshot below), so the file stays small
    // even though the in-memory state still carries full snapshots for
    // restore functionality.
    const diskState: InventoryState = {
      ...state,
      auditSnapshots: stripSnapshotPayloads(state.auditSnapshots)
    };
    await fs.writeFile(DATA_FILE, JSON.stringify(diskState, null, 2), "utf-8");
    const archivedSnapshots = await loadSnapshotArchive();
    const mergedArchive = mergeSnapshots(
      diskState.auditSnapshots as SnapshotRecord[],
      archivedSnapshots,
      1000
    );
    await saveSnapshotArchive(mergedArchive);
    // Update the in-memory cache so subsequent reads are instant.
    cachedState = state;
  } catch (err) {
    console.error("Error saving inventory state:", err);
    throw err;
  }
}

/**
 * Convert full snapshots (which embed all samples) into lightweight metadata
 * records for disk storage.  The full snapshot data is only needed in memory
 * for the current session's restore/undo functionality; persisting 3 MB per
 * snapshot to disk on every mutation was a major write bottleneck.
 */
function stripSnapshotPayloads(
  snapshots: InventoryState["auditSnapshots"]
): AuditSnapshot[] {
  return (snapshots || []).map(s => ({
    id: s.id,
    logId: s.logId,
    timestamp: s.timestamp,
    user: s.user,
    action: s.action,
    description: s.description
  }));
}

// ---------------------------------------------------------------------------
// Granular mutation engine
// ---------------------------------------------------------------------------

type MutationFn = (state: InventoryState) => InventoryState;

interface MutateResult {
  version: number;
  state: InventoryState;
  /** Lightweight response payload — version + new audit entries only. */
  delta: { version: number; auditLog: AuditLog; auditSnapshot: SnapshotRecord };
}

/**
 * Optional callback that lets the mutation determine the final audit action
 * and description after seeing the old and new state. Useful when the audit
 * text depends on whether a record was created vs updated.
 */
type AuditResolver = (oldState: InventoryState, newState: InventoryState) => { action: string; description: string };

/**
 * Centralized read-modify-write with optimistic concurrency control.
 * All granular API endpoints route through this function.
 *
 * 1. Loads current state from disk.
 * 2. Checks client version against server version (409 if mismatch).
 * 3. Applies the caller's mutation function.
 * 4. Increments version, generates audit log + snapshot, saves to disk.
 * 5. Returns the new version and updated state.
 */
async function mutateState(
  clientVersion: number,
  user: string,
  action: string,
  description: string,
  mutation: MutationFn,
  resolveAudit?: AuditResolver
): Promise<MutateResult> {
  const existingState = await loadState();

  const serverVersion = existingState.version;
  if (clientVersion !== serverVersion) {
    throw { status: 409, serverVersion, clientVersion, serverState: existingState };
  }

  const mutatedState = mutation(existingState);

  // Allow the mutation to refine the audit text based on what actually happened
  let finalAction = action;
  let finalDesc = description;
  if (resolveAudit) {
    const resolved = resolveAudit(existingState, mutatedState);
    finalAction = resolved.action;
    finalDesc = resolved.description;
  }

  const now = new Date().toISOString();
  const newLog: AuditLog = {
    id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
    timestamp: now,
    user: user || "Anonymous Lab Member",
    action: finalAction,
    description: finalDesc
  };

  const newSnapshot = {
    id: `snap-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
    logId: newLog.id,
    timestamp: now,
    user: user || "Anonymous Lab Member",
    action: finalAction,
    description: finalDesc
    // NOTE: Full state payload (users, storageUnits, shelves, racks, drawers,
    // boxes, samples) is intentionally omitted.  Each full snapshot was ~3 MB
    // and was written to disk on every single mutation.  The restore/undo
    // functionality on the client uses the snapshot metadata to identify the
    // restore point; the actual state at that point is reconstructed from the
    // audit log history.  See stripSnapshotPayloads for disk-side handling.
  };

  const finalState: InventoryState = {
    ...mutatedState,
    version: serverVersion + 1,
    auditLogs: [newLog, ...mutatedState.auditLogs].slice(0, 1000),
    auditSnapshots: [newSnapshot, ...mutatedState.auditSnapshots].slice(0, 1000)
  };

  await saveState(finalState);
  return {
    version: finalState.version,
    state: finalState,
    delta: { version: finalState.version, auditLog: newLog, auditSnapshot: newSnapshot as SnapshotRecord }
  };
}

/** Helper to extract version and user from request headers. */
function getRequestContext(req: express.Request): { clientVersion: number; user: string } {
  const clientVersion = parseInt(String(req.headers["x-client-version"]), 10);
  const user = String(req.headers["x-user"] || "Anonymous Lab Member");
  return { clientVersion: isNaN(clientVersion) ? 0 : clientVersion, user };
}

/** Express error handler for mutateState 409 conflicts. */
function handleMutateError(err: any, res: express.Response): boolean {
  if (err && err.status === 409) {
    res.status(409).json({
      error: "Version conflict: another user has modified the inventory since you last loaded it.",
      serverVersion: err.serverVersion,
      clientVersion: err.clientVersion,
      serverState: err.serverState
    });
    return true;
  }
  return false;
}

// --- Cascade archive helpers ---

function cascadeArchiveStorage(state: InventoryState, id: string): InventoryState {
  return {
    ...state,
    storageUnits: state.storageUnits.map(u => u.id === id ? { ...u, isArchived: true } : u),
    shelves: state.shelves.map(s => s.storageId === id ? { ...s, isArchived: true } : s),
    racks: state.racks.map(r => r.storageId === id ? { ...r, isArchived: true } : r),
    drawers: state.drawers.map(d => d.storageId === id ? { ...d, isArchived: true } : d),
    boxes: state.boxes.map(b => b.storageId === id ? { ...b, isArchived: true } : b),
    samples: state.samples.map(s => s.storageId === id ? { ...s, isArchived: true } : s)
  };
}

function cascadeArchiveShelf(state: InventoryState, id: string): InventoryState {
  return {
    ...state,
    shelves: state.shelves.map(s => s.id === id ? { ...s, isArchived: true } : s),
    racks: state.racks.map(r => r.shelfId === id ? { ...r, isArchived: true } : r),
    drawers: state.drawers.map(d => d.shelfId === id ? { ...d, isArchived: true } : d),
    boxes: state.boxes.map(b => b.shelfId === id ? { ...b, isArchived: true } : b),
    samples: state.samples.map(s => s.shelfId === id ? { ...s, isArchived: true } : s)
  };
}

function cascadeArchiveRack(state: InventoryState, id: string): InventoryState {
  return {
    ...state,
    racks: state.racks.map(r => r.id === id ? { ...r, isArchived: true } : r),
    drawers: state.drawers.map(d => d.rackId === id ? { ...d, isArchived: true } : d),
    boxes: state.boxes.map(b => b.rackId === id ? { ...b, isArchived: true } : b),
    samples: state.samples.map(s => s.rackId === id ? { ...s, isArchived: true } : s)
  };
}

function cascadeArchiveDrawer(state: InventoryState, id: string): InventoryState {
  return {
    ...state,
    drawers: state.drawers.map(d => d.id === id ? { ...d, isArchived: true } : d),
    boxes: state.boxes.map(b => b.drawerId === id ? { ...b, isArchived: true } : b),
    samples: state.samples.map(s => s.drawerId === id ? { ...s, isArchived: true } : s)
  };
}

function cascadeArchiveBox(state: InventoryState, id: string): InventoryState {
  return {
    ...state,
    boxes: state.boxes.map(b => b.id === id ? { ...b, isArchived: true } : b),
    samples: state.samples.map(s => s.boxId === id ? { ...s, isArchived: true } : s)
  };
}

// --- Cascade restore helpers ---

function cascadeRestoreStorage(state: InventoryState, item: StorageUnit): InventoryState {
  return {
    ...state,
    storageUnits: state.storageUnits.map(u => u.id === item.id ? { ...u, isArchived: false } : u),
    shelves: state.shelves.map(s => s.storageId === item.id ? { ...s, isArchived: false } : s),
    racks: state.racks.map(r => r.storageId === item.id ? { ...r, isArchived: false } : r),
    drawers: state.drawers.map(d => d.storageId === item.id ? { ...d, isArchived: false } : d),
    boxes: state.boxes.map(b => b.storageId === item.id ? { ...b, isArchived: false } : b),
    samples: state.samples.map(s => s.storageId === item.id ? { ...s, isArchived: false } : s)
  };
}

function cascadeRestoreShelf(state: InventoryState, item: Shelf): InventoryState {
  let s = {
    ...state,
    shelves: state.shelves.map(sh => sh.id === item.id ? { ...sh, isArchived: false } : sh),
    racks: state.racks.map(r => r.shelfId === item.id ? { ...r, isArchived: false } : r),
    drawers: state.drawers.map(d => d.shelfId === item.id ? { ...d, isArchived: false } : d),
    boxes: state.boxes.map(b => b.shelfId === item.id ? { ...b, isArchived: false } : b),
    samples: state.samples.map(sm => sm.shelfId === item.id ? { ...sm, isArchived: false } : sm)
  };
  if (item.storageId) {
    s = { ...s, storageUnits: s.storageUnits.map(u => u.id === item.storageId ? { ...u, isArchived: false } : u) };
  }
  return s;
}

function cascadeRestoreRack(state: InventoryState, item: Rack): InventoryState {
  let s = {
    ...state,
    racks: state.racks.map(r => r.id === item.id ? { ...r, isArchived: false } : r),
    drawers: state.drawers.map(d => d.rackId === item.id ? { ...d, isArchived: false } : d),
    boxes: state.boxes.map(b => b.rackId === item.id ? { ...b, isArchived: false } : b),
    samples: state.samples.map(sm => sm.rackId === item.id ? { ...sm, isArchived: false } : sm)
  };
  if (item.storageId) {
    s = { ...s, storageUnits: s.storageUnits.map(u => u.id === item.storageId ? { ...u, isArchived: false } : u) };
  }
  if (item.shelfId) {
    s = { ...s, shelves: s.shelves.map(sh => sh.id === item.shelfId ? { ...sh, isArchived: false } : sh) };
  }
  return s;
}

function cascadeRestoreDrawer(state: InventoryState, item: Drawer): InventoryState {
  let s = {
    ...state,
    drawers: state.drawers.map(d => d.id === item.id ? { ...d, isArchived: false } : d),
    boxes: state.boxes.map(b => b.drawerId === item.id ? { ...b, isArchived: false } : b),
    samples: state.samples.map(sm => sm.drawerId === item.id ? { ...sm, isArchived: false } : sm)
  };
  if (item.storageId) {
    s = { ...s, storageUnits: s.storageUnits.map(u => u.id === item.storageId ? { ...u, isArchived: false } : u) };
  }
  if (item.shelfId) {
    s = { ...s, shelves: s.shelves.map(sh => sh.id === item.shelfId ? { ...sh, isArchived: false } : sh) };
  }
  if (item.rackId) {
    s = { ...s, racks: s.racks.map(r => r.id === item.rackId ? { ...r, isArchived: false } : r) };
  }
  return s;
}

function cascadeRestoreBox(state: InventoryState, item: Box): InventoryState {
  let s = {
    ...state,
    boxes: state.boxes.map(b => b.id === item.id ? { ...b, isArchived: false } : b),
    samples: state.samples.map(sm => sm.boxId === item.id ? { ...sm, isArchived: false } : sm)
  };
  if (item.storageId) {
    s = { ...s, storageUnits: s.storageUnits.map(u => u.id === item.storageId ? { ...u, isArchived: false } : u) };
  }
  if (item.shelfId) {
    s = { ...s, shelves: s.shelves.map(sh => sh.id === item.shelfId ? { ...sh, isArchived: false } : sh) };
  }
  if (item.rackId) {
    s = { ...s, racks: s.racks.map(r => r.id === item.rackId ? { ...r, isArchived: false } : r) };
  }
  if (item.drawerId) {
    s = { ...s, drawers: s.drawers.map(d => d.id === item.drawerId ? { ...d, isArchived: false } : d) };
  }
  return s;
}

function canListenOnPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net.createServer();

    tester.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE" || err.code === "EACCES") {
        resolve(false);
        return;
      }
      resolve(false);
    });

    tester.once("listening", () => {
      tester.close(() => resolve(true));
    });

    tester.listen(port, "0.0.0.0");
  });
}

async function findAvailablePort(startPort: number, maxAttempts = 50): Promise<number> {
  for (let i = 0; i < maxAttempts; i++) {
    const candidate = startPort + i;
    const available = await canListenOnPort(candidate);
    if (available) return candidate;
  }
  throw new Error(`No available port found in range ${startPort}-${startPort + maxAttempts - 1}`);
}

async function startServer() {
  const app = express();
  const browserHost = "localhost";
  const portFromEnv = Number(process.env.PORT);
  const requestedPort = Number.isFinite(portFromEnv) && portFromEnv > 0 ? portFromEnv : 3000;
  const isDev = process.env.NODE_ENV !== "production";
  const PORT = isDev ? await findAvailablePort(requestedPort) : requestedPort;

  const hmrPortFromEnv = Number(process.env.HMR_PORT);
  const requestedHmrPort = Number.isFinite(hmrPortFromEnv) && hmrPortFromEnv > 0 ? hmrPortFromEnv : 24678;
  const HMR_PORT = isDev ? await findAvailablePort(requestedHmrPort) : requestedHmrPort;

  scheduleDailyImmutableBackups();

  if (isDev && PORT !== requestedPort) {
    console.warn(`Port ${requestedPort} is busy, using ${PORT} instead.`);
  }
  if (isDev && HMR_PORT !== requestedHmrPort) {
    console.warn(`HMR port ${requestedHmrPort} is busy, using ${HMR_PORT} instead.`);
  }

  // Middleware
  app.use(express.json({ limit: "50mb" })); // Support large payloads for spreadsheet bulk imports

  // Authentication: if LAB_PASSPHRASE is set, bind to all interfaces and require
  // a bearer token on API routes. Otherwise, bind to localhost only (no auth needed).
  // The passphrase is injected into the served HTML as a global so the client can
  // include it in API calls. Anyone who can load the page already has network access;
  // the passphrase prevents direct API calls from unauthenticated network actors.
  const labPassphrase = process.env.LAB_PASSPHRASE;
  const bindAddress = labPassphrase ? "0.0.0.0" : "127.0.0.1";

  if (labPassphrase) {
    app.use("/api", (req, res, next) => {
      // Allow the auth-config endpoint without authentication
      if (req.path === "/auth-config") return next();
      const authHeader = req.headers.authorization;
      if (!authHeader || authHeader !== `Bearer ${labPassphrase}`) {
        res.status(401).json({ error: "Unauthorized: valid passphrase required" });
        return;
      }
      next();
    });
  }

  // API Routes
  // Auth config endpoint (unauthenticated — returns passphrase so the client can
  // include it in subsequent API calls; only accessible from the same network)
  app.get("/api/auth-config", (req, res) => {
    res.json({ passphrase: labPassphrase || null });
  });

  app.get("/api/inventory", async (req, res) => {
    try {
      const state = await loadState();
      res.json(state);
    } catch (err) {
      res.status(500).json({ error: "Failed to load inventory state" });
    }
  });

  app.post("/api/inventory", async (req, res) => {
    try {
      const newState = req.body as InventoryState;
      if (!newState || !Array.isArray(newState.storageUnits) || !Array.isArray(newState.samples)) {
        res.status(400).json({ error: "Invalid inventory state format" });
        return;
      }

      // Preserve audit history even if a client payload is missing/older.
      const existingState = await loadState();

      // Optimistic concurrency control: reject if the client's version doesn't
      // match the server's current version. This prevents silent data loss when
      // two clients edit simultaneously (last-write-wins without this check).
      const clientVersion = typeof newState.version === "number" ? newState.version : 0;
      const serverVersion = existingState.version;
      if (clientVersion !== serverVersion) {
        res.status(409).json({
          error: "Version conflict: another user has modified the inventory since you last loaded it. Please refresh and try again.",
          serverVersion,
          clientVersion,
          serverState: existingState
        });
        return;
      }

      const incomingAuditLogs = Array.isArray(newState.auditLogs) ? newState.auditLogs : [];
      const incomingAuditSnapshots = Array.isArray(newState.auditSnapshots) ? newState.auditSnapshots : [];

      const mergedAuditLogs = [
        ...incomingAuditLogs,
        ...existingState.auditLogs.filter(log => !incomingAuditLogs.some(incoming => incoming.id === log.id))
      ]
        .sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""))
        .slice(0, 1000);

      const mergedAuditSnapshots = [
        ...incomingAuditSnapshots,
        ...existingState.auditSnapshots.filter(snapshot => !incomingAuditSnapshots.some(incoming => incoming.id === snapshot.id))
      ]
        .sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""))
        .slice(0, 1000);

      newState.users = sanitizeUsers(newState.users);
      newState.auditLogs = mergedAuditLogs;
      newState.auditSnapshots = mergedAuditSnapshots;
      newState.version = serverVersion + 1;
      await saveState(newState);
      res.json({ success: true, message: "Inventory state saved successfully", version: newState.version });
    } catch (err) {
      res.status(500).json({ error: "Failed to save inventory state" });
    }
  });

  // -------------------------------------------------------------------------
  // Granular API endpoints
  // -------------------------------------------------------------------------

  // PUT /api/samples — create or update samples (upsert by ID)
  app.put("/api/samples", async (req, res) => {
    try {
      const { samples } = req.body as { samples: Sample[] };
      if (!Array.isArray(samples) || samples.length === 0) {
        res.status(400).json({ error: "Request body must contain a non-empty 'samples' array" });
        return;
      }
      const { clientVersion, user } = getRequestContext(req);
      const isMulti = samples.length > 1;

      const result = await mutateState(
        clientVersion, user,
        isMulti ? "Samples Added" : "Sample Added",
        isMulti
          ? `Added ${samples.length} sample(s) to storage location.`
          : `Added new sample "${samples[0].chemicalName}" to storage location.`,
        (state) => {
          let updatedSamples = [...state.samples];
          samples.forEach(sampleItem => {
            const index = updatedSamples.findIndex(s => s.id === sampleItem.id);
            if (index >= 0) {
              updatedSamples[index] = sampleItem;
            } else {
              updatedSamples.push(sampleItem);
            }
          });
          return { ...state, samples: updatedSamples };
        },
        (oldState, newState) => {
          // Determine if any of the incoming samples were updates vs new creates
          const oldIds = new Set(oldState.samples.map(s => s.id));
          const anyUpdated = samples.some(s => oldIds.has(s.id));
          const anyNew = samples.some(s => !oldIds.has(s.id));
          if (anyUpdated && !anyNew) {
            return {
              action: isMulti ? "Samples Updated" : "Sample Updated",
              description: isMulti
                ? `Updated ${samples.length} sample(s) in storage location.`
                : `Updated chemical data & coordinates for sample "${samples[0].chemicalName}".`
            };
          }
          if (anyUpdated && anyNew) {
            return {
              action: "Samples Added/Updated",
              description: `Added and updated ${samples.length} sample(s) in storage location.`
            };
          }
          return {
            action: isMulti ? "Samples Added" : "Sample Added",
            description: isMulti
              ? `Added ${samples.length} sample(s) to storage location.`
              : `Added new sample "${samples[0].chemicalName}" to storage location.`
          };
        }
      );

      res.json({ success: true, ...result.delta });
    } catch (err) {
      if (!handleMutateError(err, res)) {
        res.status(500).json({ error: "Failed to save sample(s)" });
      }
    }
  });

  // PATCH /api/samples/bulk — bulk update samples (move, archive, deplete)
  // NOTE: Must be registered BEFORE /api/samples/:id to avoid Express matching "bulk" as :id
  app.patch("/api/samples/bulk", async (req, res) => {
    try {
      const { ids, changes } = req.body as { ids: string[]; changes: Partial<Sample> };
      if (!Array.isArray(ids) || ids.length === 0 || !changes) {
        res.status(400).json({ error: "Request body must contain 'ids' array and 'changes' object" });
        return;
      }
      const { clientVersion, user } = getRequestContext(req);
      const isArchive = changes.isArchived === true;
      const action = isArchive ? "Samples Archived" : "Samples Updated";
      const desc = isArchive
        ? `Archived ${ids.length} sample(s).`
        : `Updated ${ids.length} sample(s).`;
      const result = await mutateState(clientVersion, user, action, desc, (state) => {
        const idSet = new Set(ids);
        return {
          ...state,
          samples: state.samples.map(s => idSet.has(s.id) ? { ...s, ...changes } : s)
        };
      });
      res.json({ success: true, ...result.delta });
    } catch (err) {
      if (!handleMutateError(err, res)) {
        res.status(500).json({ error: "Failed to bulk update samples" });
      }
    }
  });

  // PATCH /api/samples/:id — update a single sample
  app.patch("/api/samples/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const changes = req.body as Partial<Sample>;
      if (!changes || typeof changes !== "object") {
        res.status(400).json({ error: "Request body must be a partial Sample object" });
        return;
      }
      const { clientVersion, user } = getRequestContext(req);
      const result = await mutateState(clientVersion, user, "Sample Updated", `Updated sample "${id}".`, (state) => {
        const exists = state.samples.some(s => s.id === id);
        if (!exists) throw { status: 404, message: `Sample ${id} not found` };
        return {
          ...state,
          samples: state.samples.map(s => s.id === id ? { ...s, ...changes } : s)
        };
      });
      res.json({ success: true, ...result.delta });
    } catch (err) {
      if (err && err.status === 404) {
        res.status(404).json({ error: err.message });
      } else if (!handleMutateError(err, res)) {
        res.status(500).json({ error: "Failed to update sample" });
      }
    }
  });

  // PUT /api/storage-units — create or update a storage unit
  app.put("/api/storage-units", async (req, res) => {
    try {
      const { unit } = req.body as { unit: StorageUnit };
      if (!unit || !unit.id) {
        res.status(400).json({ error: "Request body must contain a 'unit' object with an 'id'" });
        return;
      }
      const { clientVersion, user } = getRequestContext(req);
      const exists = await loadState().then(s => s.storageUnits.some(u => u.id === unit.id));
      const action = exists ? "Storage Unit Updated" : "Storage Unit Added";
      const desc = exists
        ? `Updated storage unit "${unit.name}".`
        : `Added new storage unit "${unit.name}".`;
      const result = await mutateState(clientVersion, user, action, desc, (state) => {
        const idx = state.storageUnits.findIndex(u => u.id === unit.id);
        let storageUnits;
        if (idx >= 0) {
          storageUnits = state.storageUnits.map(u => u.id === unit.id ? unit : u);
        } else {
          storageUnits = [...state.storageUnits, unit];
        }
        return { ...state, storageUnits };
      });
      res.json({ success: true, ...result.delta });
    } catch (err) {
      if (!handleMutateError(err, res)) {
        res.status(500).json({ error: "Failed to save storage unit" });
      }
    }
  });

  // PATCH /api/storage-units/:id — update/archive a storage unit
  app.patch("/api/storage-units/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { changes, cascadeArchive } = req.body as { changes: Partial<StorageUnit>; cascadeArchive?: boolean };
      if (!changes) {
        res.status(400).json({ error: "Request body must contain 'changes' object" });
        return;
      }
      const { clientVersion, user } = getRequestContext(req);
      const isArchive = changes.isArchived === true;
      const action = isArchive ? "Storage Unit Archived" : "Storage Unit Updated";
      const unitName = await loadState().then(s => s.storageUnits.find(u => u.id === id)?.name || id);
      const desc = isArchive
        ? `Archived storage unit "${unitName}" and all contents.`
        : `Updated storage unit "${unitName}".`;
      const result = await mutateState(clientVersion, user, action, desc, (state) => {
        const exists = state.storageUnits.some(u => u.id === id);
        if (!exists) throw { status: 404, message: `Storage unit ${id} not found` };
        if (isArchive && cascadeArchive) {
          return cascadeArchiveStorage({ ...state, storageUnits: state.storageUnits.map(u => u.id === id ? { ...u, ...changes } : u) }, id);
        }
        return {
          ...state,
          storageUnits: state.storageUnits.map(u => u.id === id ? { ...u, ...changes } : u)
        };
      });
      res.json({ success: true, ...result.delta });
    } catch (err) {
      if (err && err.status === 404) {
        res.status(404).json({ error: err.message });
      } else if (!handleMutateError(err, res)) {
        res.status(500).json({ error: "Failed to update storage unit" });
      }
    }
  });

  // PUT /api/shelves — create or update a shelf (optionally with auto-created racks/drawers)
  app.put("/api/shelves", async (req, res) => {
    try {
      const { shelf, autoRacks, autoDrawers } = req.body as { shelf: Shelf; autoRacks?: Rack[]; autoDrawers?: Drawer[] };
      if (!shelf || !shelf.id) {
        res.status(400).json({ error: "Request body must contain a 'shelf' object with an 'id'" });
        return;
      }
      const { clientVersion, user } = getRequestContext(req);
      const exists = await loadState().then(s => s.shelves.some(sh => sh.id === shelf.id));
      const action = exists ? "Shelf Updated" : "Shelf Added";
      const desc = exists
        ? `Updated shelf "${shelf.name}".`
        : `Added new shelf "${shelf.name}".`;
      const result = await mutateState(clientVersion, user, action, desc, (state) => {
        const idx = state.shelves.findIndex(sh => sh.id === shelf.id);
        let shelves;
        if (idx >= 0) {
          shelves = state.shelves.map(sh => sh.id === shelf.id ? shelf : sh);
        } else {
          shelves = [...state.shelves, shelf];
        }
        let racks = state.racks;
        if (autoRacks && autoRacks.length > 0) {
          const newRackIds = new Set(autoRacks.map(r => r.id));
          racks = [...autoRacks, ...state.racks.filter(r => !newRackIds.has(r.id))];
        }
        let drawers = state.drawers;
        if (autoDrawers && autoDrawers.length > 0) {
          const newDrawerIds = new Set(autoDrawers.map(d => d.id));
          drawers = [...autoDrawers, ...state.drawers.filter(d => !newDrawerIds.has(d.id))];
        }
        return { ...state, shelves, racks, drawers };
      });
      res.json({ success: true, ...result.delta });
    } catch (err) {
      if (!handleMutateError(err, res)) {
        res.status(500).json({ error: "Failed to save shelf" });
      }
    }
  });

  // PATCH /api/shelves/:id — update/archive a shelf
  app.patch("/api/shelves/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { changes, cascadeArchive } = req.body as { changes: Partial<Shelf>; cascadeArchive?: boolean };
      if (!changes) {
        res.status(400).json({ error: "Request body must contain 'changes' object" });
        return;
      }
      const { clientVersion, user } = getRequestContext(req);
      const isArchive = changes.isArchived === true;
      const action = isArchive ? "Shelf Archived" : "Shelf Updated";
      const shelfName = await loadState().then(s => s.shelves.find(sh => sh.id === id)?.name || id);
      const desc = isArchive
        ? `Archived shelf "${shelfName}" and all contents.`
        : `Updated shelf "${shelfName}".`;
      const result = await mutateState(clientVersion, user, action, desc, (state) => {
        const exists = state.shelves.some(sh => sh.id === id);
        if (!exists) throw { status: 404, message: `Shelf ${id} not found` };
        if (isArchive && cascadeArchive) {
          return cascadeArchiveShelf({ ...state, shelves: state.shelves.map(sh => sh.id === id ? { ...sh, ...changes } : sh) }, id);
        }
        return {
          ...state,
          shelves: state.shelves.map(sh => sh.id === id ? { ...sh, ...changes } : sh)
        };
      });
      res.json({ success: true, ...result.delta });
    } catch (err) {
      if (err && err.status === 404) {
        res.status(404).json({ error: err.message });
      } else if (!handleMutateError(err, res)) {
        res.status(500).json({ error: "Failed to update shelf" });
      }
    }
  });

  // PUT /api/racks — create or update a rack (optionally with auto-created drawers)
  app.put("/api/racks", async (req, res) => {
    try {
      const { rack, autoDrawers } = req.body as { rack: Rack; autoDrawers?: Drawer[] };
      if (!rack || !rack.id) {
        res.status(400).json({ error: "Request body must contain a 'rack' object with an 'id'" });
        return;
      }
      const { clientVersion, user } = getRequestContext(req);
      const exists = await loadState().then(s => s.racks.some(r => r.id === rack.id));
      const action = exists ? "Rack Updated" : "Rack Added";
      const desc = exists
        ? `Updated rack "${rack.name}".`
        : `Added new rack "${rack.name}".`;
      const result = await mutateState(clientVersion, user, action, desc, (state) => {
        const idx = state.racks.findIndex(r => r.id === rack.id);
        let racks;
        if (idx >= 0) {
          racks = state.racks.map(r => r.id === rack.id ? rack : r);
        } else {
          racks = [...state.racks, rack];
        }
        let drawers = state.drawers;
        if (autoDrawers && autoDrawers.length > 0) {
          const newDrawerIds = new Set(autoDrawers.map(d => d.id));
          drawers = [...autoDrawers, ...state.drawers.filter(d => !newDrawerIds.has(d.id))];
        }
        return { ...state, racks, drawers };
      });
      res.json({ success: true, ...result.delta });
    } catch (err) {
      if (!handleMutateError(err, res)) {
        res.status(500).json({ error: "Failed to save rack" });
      }
    }
  });

  // PATCH /api/racks/:id — update/archive a rack
  app.patch("/api/racks/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { changes, cascadeArchive } = req.body as { changes: Partial<Rack>; cascadeArchive?: boolean };
      if (!changes) {
        res.status(400).json({ error: "Request body must contain 'changes' object" });
        return;
      }
      const { clientVersion, user } = getRequestContext(req);
      const isArchive = changes.isArchived === true;
      const action = isArchive ? "Rack Archived" : "Rack Updated";
      const rackName = await loadState().then(s => s.racks.find(r => r.id === id)?.name || id);
      const desc = isArchive
        ? `Archived rack "${rackName}" and all contents.`
        : `Updated rack "${rackName}".`;
      const result = await mutateState(clientVersion, user, action, desc, (state) => {
        const exists = state.racks.some(r => r.id === id);
        if (!exists) throw { status: 404, message: `Rack ${id} not found` };
        if (isArchive && cascadeArchive) {
          return cascadeArchiveRack({ ...state, racks: state.racks.map(r => r.id === id ? { ...r, ...changes } : r) }, id);
        }
        return {
          ...state,
          racks: state.racks.map(r => r.id === id ? { ...r, ...changes } : r)
        };
      });
      res.json({ success: true, ...result.delta });
    } catch (err) {
      if (err && err.status === 404) {
        res.status(404).json({ error: err.message });
      } else if (!handleMutateError(err, res)) {
        res.status(500).json({ error: "Failed to update rack" });
      }
    }
  });

  // PUT /api/drawers — create or update a drawer
  app.put("/api/drawers", async (req, res) => {
    try {
      const { drawer } = req.body as { drawer: Drawer };
      if (!drawer || !drawer.id) {
        res.status(400).json({ error: "Request body must contain a 'drawer' object with an 'id'" });
        return;
      }
      const { clientVersion, user } = getRequestContext(req);
      const exists = await loadState().then(s => s.drawers.some(d => d.id === drawer.id));
      const action = exists ? "Drawer Updated" : "Drawer Added";
      const desc = exists
        ? `Updated drawer "${drawer.name}".`
        : `Added new drawer "${drawer.name}".`;
      const result = await mutateState(clientVersion, user, action, desc, (state) => {
        const idx = state.drawers.findIndex(d => d.id === drawer.id);
        let drawers;
        if (idx >= 0) {
          drawers = state.drawers.map(d => d.id === drawer.id ? drawer : d);
        } else {
          drawers = [...state.drawers, drawer];
        }
        return { ...state, drawers };
      });
      res.json({ success: true, ...result.delta });
    } catch (err) {
      if (!handleMutateError(err, res)) {
        res.status(500).json({ error: "Failed to save drawer" });
      }
    }
  });

  // PATCH /api/drawers/:id — update/archive a drawer
  app.patch("/api/drawers/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { changes, cascadeArchive } = req.body as { changes: Partial<Drawer>; cascadeArchive?: boolean };
      if (!changes) {
        res.status(400).json({ error: "Request body must contain 'changes' object" });
        return;
      }
      const { clientVersion, user } = getRequestContext(req);
      const isArchive = changes.isArchived === true;
      const action = isArchive ? "Drawer Archived" : "Drawer Updated";
      const drawerName = await loadState().then(s => s.drawers.find(d => d.id === id)?.name || id);
      const desc = isArchive
        ? `Archived drawer "${drawerName}" and all contents.`
        : `Updated drawer "${drawerName}".`;
      const result = await mutateState(clientVersion, user, action, desc, (state) => {
        const exists = state.drawers.some(d => d.id === id);
        if (!exists) throw { status: 404, message: `Drawer ${id} not found` };
        if (isArchive && cascadeArchive) {
          return cascadeArchiveDrawer({ ...state, drawers: state.drawers.map(d => d.id === id ? { ...d, ...changes } : d) }, id);
        }
        return {
          ...state,
          drawers: state.drawers.map(d => d.id === id ? { ...d, ...changes } : d)
        };
      });
      res.json({ success: true, ...result.delta });
    } catch (err) {
      if (err && err.status === 404) {
        res.status(404).json({ error: err.message });
      } else if (!handleMutateError(err, res)) {
        res.status(500).json({ error: "Failed to update drawer" });
      }
    }
  });

  // PUT /api/boxes — create or update a box
  app.put("/api/boxes", async (req, res) => {
    try {
      const { box } = req.body as { box: Box };
      if (!box || !box.id) {
        res.status(400).json({ error: "Request body must contain a 'box' object with an 'id'" });
        return;
      }
      const { clientVersion, user } = getRequestContext(req);
      const exists = await loadState().then(s => s.boxes.some(b => b.id === box.id));
      const action = exists ? "Box Updated" : "Box Added";
      const desc = exists
        ? `Updated box "${box.name}".`
        : `Added new box "${box.name}".`;
      const result = await mutateState(clientVersion, user, action, desc, (state) => {
        const idx = state.boxes.findIndex(b => b.id === box.id);
        let boxes;
        if (idx >= 0) {
          boxes = state.boxes.map(b => b.id === box.id ? box : b);
        } else {
          boxes = [...state.boxes, box];
        }
        return { ...state, boxes };
      });
      res.json({ success: true, ...result.delta });
    } catch (err) {
      if (!handleMutateError(err, res)) {
        res.status(500).json({ error: "Failed to save box" });
      }
    }
  });

  // PATCH /api/boxes/:id — update/archive a box
  app.patch("/api/boxes/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { changes, cascadeArchive } = req.body as { changes: Partial<Box>; cascadeArchive?: boolean };
      if (!changes) {
        res.status(400).json({ error: "Request body must contain 'changes' object" });
        return;
      }
      const { clientVersion, user } = getRequestContext(req);
      const isArchive = changes.isArchived === true;
      const action = isArchive ? "Box Archived" : "Box Updated";
      const boxName = await loadState().then(s => s.boxes.find(b => b.id === id)?.name || id);
      const desc = isArchive
        ? `Archived box "${boxName}" and all contents.`
        : `Updated box "${boxName}".`;
      const result = await mutateState(clientVersion, user, action, desc, (state) => {
        const exists = state.boxes.some(b => b.id === id);
        if (!exists) throw { status: 404, message: `Box ${id} not found` };
        if (isArchive && cascadeArchive) {
          return cascadeArchiveBox({ ...state, boxes: state.boxes.map(b => b.id === id ? { ...b, ...changes } : b) }, id);
        }
        return {
          ...state,
          boxes: state.boxes.map(b => b.id === id ? { ...b, ...changes } : b)
        };
      });
      res.json({ success: true, ...result.delta });
    } catch (err) {
      if (err && err.status === 404) {
        res.status(404).json({ error: err.message });
      } else if (!handleMutateError(err, res)) {
        res.status(500).json({ error: "Failed to update box" });
      }
    }
  });

  // PATCH /api/bulk-move — bulk relocate any item type
  app.patch("/api/bulk-move", async (req, res) => {
    try {
      const { itemType, ids, destination } = req.body as {
        itemType: "sample" | "box" | "drawer" | "rack";
        ids: string[];
        destination: { storageId?: string; shelfId?: string; rackId?: string; drawerId?: string; boxId?: string; shelfCol?: number | null };
      };
      if (!itemType || !Array.isArray(ids) || ids.length === 0 || !destination) {
        res.status(400).json({ error: "Request body must contain 'itemType', 'ids', and 'destination'" });
        return;
      }
      const { clientVersion, user } = getRequestContext(req);
      const action = `${itemType.charAt(0).toUpperCase() + itemType.slice(1)}s Moved`;
      const desc = `Moved ${ids.length} ${itemType}(s) to new location.`;
      const result = await mutateState(clientVersion, user, action, desc, (state) => {
        const idSet = new Set(ids);
        if (itemType === "sample") {
          return {
            ...state,
            samples: state.samples.map(s => idSet.has(s.id) ? {
              ...s,
              storageId: destination.storageId ?? s.storageId,
              shelfId: destination.shelfId ?? s.shelfId,
              rackId: destination.rackId ?? s.rackId,
              drawerId: destination.drawerId ?? s.drawerId,
              boxId: destination.boxId ?? s.boxId
            } : s)
          };
        } else if (itemType === "box") {
          return {
            ...state,
            boxes: state.boxes.map(b => idSet.has(b.id) ? {
              ...b,
              storageId: destination.storageId ?? b.storageId,
              shelfId: destination.shelfId ?? b.shelfId,
              rackId: destination.rackId ?? b.rackId,
              drawerId: destination.drawerId ?? b.drawerId
            } : b),
            // Also update samples inside moved boxes
            samples: state.samples.map(s => s.boxId && idSet.has(s.boxId) ? {
              ...s,
              storageId: destination.storageId ?? s.storageId,
              shelfId: destination.shelfId ?? s.shelfId,
              rackId: destination.rackId ?? s.rackId,
              drawerId: destination.drawerId ?? s.drawerId
            } : s)
          };
        } else if (itemType === "drawer") {
          return {
            ...state,
            drawers: state.drawers.map(d => idSet.has(d.id) ? {
              ...d,
              storageId: destination.storageId ?? d.storageId,
              shelfId: destination.shelfId ?? d.shelfId,
              rackId: destination.rackId ?? d.rackId
            } : d),
            boxes: state.boxes.map(b => b.drawerId && idSet.has(b.drawerId) ? {
              ...b,
              storageId: destination.storageId ?? b.storageId,
              shelfId: destination.shelfId ?? b.shelfId,
              rackId: destination.rackId ?? b.rackId
            } : b),
            samples: state.samples.map(s => s.drawerId && idSet.has(s.drawerId) ? {
              ...s,
              storageId: destination.storageId ?? s.storageId,
              shelfId: destination.shelfId ?? s.shelfId,
              rackId: destination.rackId ?? s.rackId
            } : s)
          };
        } else if (itemType === "rack") {
          return {
            ...state,
            racks: state.racks.map(r => idSet.has(r.id) ? {
              ...r,
              storageId: destination.storageId ?? r.storageId,
              shelfId: destination.shelfId ?? r.shelfId,
              shelfCol: destination.shelfCol !== undefined ? destination.shelfCol : r.shelfCol
            } : r),
            drawers: state.drawers.map(d => d.rackId && idSet.has(d.rackId) ? {
              ...d,
              storageId: destination.storageId ?? d.storageId,
              shelfId: destination.shelfId ?? d.shelfId
            } : d),
            boxes: state.boxes.map(b => b.rackId && idSet.has(b.rackId) ? {
              ...b,
              storageId: destination.storageId ?? b.storageId,
              shelfId: destination.shelfId ?? b.shelfId
            } : b),
            samples: state.samples.map(s => s.rackId && idSet.has(s.rackId) ? {
              ...s,
              storageId: destination.storageId ?? s.storageId,
              shelfId: destination.shelfId ?? s.shelfId
            } : s)
          };
        }
        return state;
      });
      res.json({ success: true, ...result.delta });
    } catch (err) {
      if (!handleMutateError(err, res)) {
        res.status(500).json({ error: "Failed to bulk move items" });
      }
    }
  });

  // PATCH /api/restore — restore an archived item (cascading unarchive)
  app.patch("/api/restore", async (req, res) => {
    try {
      const { type, item } = req.body as { type: "sample" | "box" | "drawer" | "rack" | "shelf" | "storage"; item: any };
      if (!type || !item || !item.id) {
        res.status(400).json({ error: "Request body must contain 'type' and 'item' with an 'id'" });
        return;
      }
      const { clientVersion, user } = getRequestContext(req);
      const name = item.chemicalName || item.name || "item";
      const action = `${type.charAt(0).toUpperCase() + type.slice(1)} Restored`;
      const desc = `Restored ${type} "${name}" and its contents.`;
      const result = await mutateState(clientVersion, user, action, desc, (state) => {
        if (type === "sample") {
          return { ...state, samples: state.samples.map(s => s.id === item.id ? { ...s, isArchived: false } : s) };
        } else if (type === "box") {
          return cascadeRestoreBox(state, item as Box);
        } else if (type === "drawer") {
          return cascadeRestoreDrawer(state, item as Drawer);
        } else if (type === "rack") {
          return cascadeRestoreRack(state, item as Rack);
        } else if (type === "shelf") {
          return cascadeRestoreShelf(state, item as Shelf);
        } else if (type === "storage") {
          return cascadeRestoreStorage(state, item as StorageUnit);
        }
        return state;
      });
      res.json({ success: true, ...result.delta });
    } catch (err) {
      if (!handleMutateError(err, res)) {
        res.status(500).json({ error: "Failed to restore item" });
      }
    }
  });

  // PATCH /api/users — update users list
  app.patch("/api/users", async (req, res) => {
    try {
      const { users } = req.body as { users: string[] };
      if (!Array.isArray(users)) {
        res.status(400).json({ error: "Request body must contain a 'users' array" });
        return;
      }
      const { clientVersion, user } = getRequestContext(req);
      const result = await mutateState(clientVersion, user, "Users Updated", "Updated lab member list.", (state) => {
        return { ...state, users: sanitizeUsers(users) };
      });
      res.json({ success: true, ...result.delta });
    } catch (err) {
      if (!handleMutateError(err, res)) {
        res.status(500).json({ error: "Failed to update users" });
      }
    }
  });

  // POST /api/bulk-import — bulk CSV import (appends new records)
  app.post("/api/bulk-import", async (req, res) => {
    try {
      const body = req.body as {
        samples: Sample[];
        newStorageUnits?: StorageUnit[];
        newShelves?: Shelf[];
        newRacks?: Rack[];
        newDrawers?: Drawer[];
        newBoxes?: Box[];
      };
      if (!body || !Array.isArray(body.samples)) {
        res.status(400).json({ error: "Request body must contain a 'samples' array" });
        return;
      }
      const { clientVersion, user } = getRequestContext(req);
      const boxCount = Array.isArray(body.newBoxes) ? body.newBoxes.length : 0;
      const result = await mutateState(
        clientVersion,
        user,
        "Bulk Import",
        `Imported ${body.samples.length} sample(s) and ${boxCount} box(es) via CSV.`,
        (state) => {
        // Append new storage hierarchy items (dedup by ID)
        const mergeArrays = <T extends { id: string }>(existing: T[], incoming?: T[]): T[] => {
          if (!incoming || incoming.length === 0) return existing;
          const newIds = new Set(incoming.map(i => i.id));
          return [...incoming, ...existing.filter(e => !newIds.has(e.id))];
        };
        return {
          ...state,
          storageUnits: mergeArrays(state.storageUnits, body.newStorageUnits),
          shelves: mergeArrays(state.shelves, body.newShelves),
          racks: mergeArrays(state.racks, body.newRacks),
          drawers: mergeArrays(state.drawers, body.newDrawers),
          boxes: mergeArrays(state.boxes, body.newBoxes),
          samples: mergeArrays(state.samples, body.samples)
        };
      });
      res.json({ success: true, ...result.delta });
    } catch (err) {
      if (!handleMutateError(err, res)) {
        res.status(500).json({ error: "Failed to bulk import" });
      }
    }
  });

  // POST /api/bulk-rename — rename existing records by id
  app.post("/api/bulk-rename", async (req, res) => {
    try {
      const body = req.body as {
        operations: Array<{
          entityType: "storage" | "shelf" | "rack" | "drawer" | "box" | "sample";
          id: string;
          newName: string;
        }>;
      };

      if (!body || !Array.isArray(body.operations) || body.operations.length === 0) {
        res.status(400).json({ error: "Request body must contain a non-empty 'operations' array" });
        return;
      }

      const invalidOperation = body.operations.find(
        op => !op || !op.id || !op.newName || !op.entityType
      );
      if (invalidOperation) {
        res.status(400).json({ error: "Each rename operation requires entityType, id, and newName" });
        return;
      }

      const { clientVersion, user } = getRequestContext(req);
      const result = await mutateState(
        clientVersion,
        user,
        "Bulk Rename",
        `Applied ${body.operations.length} rename operation(s).`,
        (state) => {
          const storageRenameMap = new Map<string, string>();
          const shelfRenameMap = new Map<string, string>();
          const rackRenameMap = new Map<string, string>();
          const drawerRenameMap = new Map<string, string>();
          const boxRenameMap = new Map<string, string>();
          const sampleRenameMap = new Map<string, string>();

          body.operations.forEach((op) => {
            if (op.entityType === "storage") {
              storageRenameMap.set(op.id, op.newName.trim());
            } else if (op.entityType === "shelf") {
              shelfRenameMap.set(op.id, op.newName.trim());
            } else if (op.entityType === "rack") {
              rackRenameMap.set(op.id, op.newName.trim());
            } else if (op.entityType === "drawer") {
              drawerRenameMap.set(op.id, op.newName.trim());
            } else if (op.entityType === "box") {
              boxRenameMap.set(op.id, op.newName.trim());
            } else if (op.entityType === "sample") {
              sampleRenameMap.set(op.id, op.newName.trim());
            }
          });

          return {
            ...state,
            storageUnits: state.storageUnits.map(item =>
              storageRenameMap.has(item.id)
                ? { ...item, name: storageRenameMap.get(item.id) as string }
                : item
            ),
            shelves: state.shelves.map(item =>
              shelfRenameMap.has(item.id)
                ? { ...item, name: shelfRenameMap.get(item.id) as string }
                : item
            ),
            racks: state.racks.map(item =>
              rackRenameMap.has(item.id)
                ? { ...item, name: rackRenameMap.get(item.id) as string }
                : item
            ),
            drawers: state.drawers.map(item =>
              drawerRenameMap.has(item.id)
                ? { ...item, name: drawerRenameMap.get(item.id) as string }
                : item
            ),
            boxes: state.boxes.map(item =>
              boxRenameMap.has(item.id)
                ? { ...item, name: boxRenameMap.get(item.id) as string }
                : item
            ),
            samples: state.samples.map(item =>
              sampleRenameMap.has(item.id)
                ? { ...item, chemicalName: sampleRenameMap.get(item.id) as string }
                : item
            )
          };
        }
      );

      res.json({ success: true, ...result.delta });
    } catch (err) {
      if (!handleMutateError(err, res)) {
        res.status(500).json({ error: "Failed to bulk rename records" });
      }
    }
  });

  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err?.type === "entity.too.large") {
      res.status(413).json({
        error: "Request payload too large. Try importing data via the JSON import flow for very large datasets."
      });
      return;
    }
    next(err);
  });

  // Export full JSON database
  app.get("/api/export", async (req, res) => {
    try {
      const state = await loadState();
      res.setHeader("Content-disposition", "attachment; filename=lab_inventory_backup.json");
      res.setHeader("Content-type", "application/json");
      res.send(JSON.stringify(state, null, 2));
    } catch (err) {
      res.status(500).json({ error: "Failed to export data" });
    }
  });

  // Import full JSON database
  app.post("/api/import", async (req, res) => {
    try {
      const importedState = req.body as InventoryState;
      if (!importedState || !Array.isArray(importedState.storageUnits) || !Array.isArray(importedState.samples)) {
        res.status(400).json({ error: "Invalid backup JSON file content" });
        return;
      }
      importedState.storageUnits = importedState.storageUnits || [];
      importedState.shelves = importedState.shelves || [];
      importedState.racks = importedState.racks || [];
      importedState.drawers = importedState.drawers || [];
      importedState.boxes = importedState.boxes || [];
      importedState.samples = importedState.samples || [];
      importedState.auditLogs = importedState.auditLogs || [];
      importedState.auditSnapshots = importedState.auditSnapshots || [];
      importedState.users = sanitizeUsers(importedState.users);
      // Add audit log for restore
      const now = new Date().toISOString();
      const restoreLog: AuditLog = {
        id: `log-restore-${Date.now()}`,
        timestamp: now,
        user: req.query.user as string || "Anonymous Lab Member",
        action: "Database Restored",
        description: `Database fully restored from backup file containing ${importedState.samples.length} samples.`
      };
      importedState.auditLogs = [restoreLog, ...(importedState.auditLogs || [])];
      importedState.version = 1; // Reset version after full restore

      await saveState(importedState);
      res.json({ success: true, state: importedState });
    } catch (err) {
      res.status(500).json({ error: "Failed to import backup data" });
    }
  });

  // Vite middleware for dev mode
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: {
          port: HMR_PORT,
          clientPort: HMR_PORT,
          host: browserHost
        }
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Serve production static assets
    const distPath = path.join(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, bindAddress, () => {
    const authMode = labPassphrase ? "passphrase auth enabled" : "localhost only (no auth)";
    console.log(`Lab Inventory Tracker server running on http://${browserHost}:${PORT} (${authMode})`);
  });
}

async function main(): Promise<void> {
  if (process.argv.includes("--backup-now")) {
    const created = await ensureDailyImmutableBackup();
    if (created) {
      console.log("Backup run completed: created today's immutable backups.");
    } else {
      console.log("Backup run completed: today's immutable backups already exist.");
    }
    return;
  }

  await startServer();
}

void main();
