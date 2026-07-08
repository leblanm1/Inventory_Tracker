import express from "express";
import os from "node:os";
import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import net from "node:net";
import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { createServer as createViteServer } from "vite";
import { InventoryState, StorageUnit, Shelf, Box, Sample, AuditLog, Rack, Drawer } from "./src/types.js";

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
  timestamp?: string;
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

  return { users: DEFAULT_USERS, storageUnits, shelves, racks, drawers, boxes, samples, auditLogs, auditSnapshots: [] };
}

// Function to load inventory state
async function loadState(): Promise<InventoryState> {
  try {
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
  } catch (err) {
    console.error("Error loading inventory state:", err);
    return getDemoState();
  }
}

// Function to save inventory state
async function saveState(state: InventoryState): Promise<void> {
  try {
    await migrateLegacyDataIfNeeded();
    if (!existsSync(DATA_DIR)) {
      await fs.mkdir(DATA_DIR, { recursive: true });
    }
    await fs.writeFile(DATA_FILE, JSON.stringify(state, null, 2), "utf-8");
    const archivedSnapshots = await loadSnapshotArchive();
    const mergedArchive = mergeSnapshots(
      (state.auditSnapshots || []) as SnapshotRecord[],
      archivedSnapshots,
      1000
    );
    await saveSnapshotArchive(mergedArchive);
  } catch (err) {
    console.error("Error saving inventory state:", err);
    throw err;
  }
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

  // API Routes
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
      await saveState(newState);
      res.json({ success: true, message: "Inventory state saved successfully" });
    } catch (err) {
      res.status(500).json({ error: "Failed to save inventory state" });
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
          host: "0.0.0.0"
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Lab Inventory Tracker server running on http://0.0.0.0:${PORT}`);
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
