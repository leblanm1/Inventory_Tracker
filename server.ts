import express from "express";
import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import { createServer as createViteServer } from "vite";
import { InventoryState, StorageUnit, Shelf, Box, Sample, AuditLog, Rack, Drawer } from "./src/types.js";

// Helper to get directory path
const __dirname = path.resolve();
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "inventory.json");

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

  return { storageUnits, shelves, racks, drawers, boxes, samples, auditLogs };
}

// Function to load inventory state
async function loadState(): Promise<InventoryState> {
  try {
    if (!existsSync(DATA_DIR)) {
      await fs.mkdir(DATA_DIR, { recursive: true });
    }
    if (!existsSync(DATA_FILE)) {
      const demo = getDemoState();
      await fs.writeFile(DATA_FILE, JSON.stringify(demo, null, 2), "utf-8");
      return demo;
    }
    const content = await fs.readFile(DATA_FILE, "utf-8");
    return JSON.parse(content);
  } catch (err) {
    console.error("Error loading inventory state:", err);
    return getDemoState();
  }
}

// Function to save inventory state
async function saveState(state: InventoryState): Promise<void> {
  try {
    if (!existsSync(DATA_DIR)) {
      await fs.mkdir(DATA_DIR, { recursive: true });
    }
    await fs.writeFile(DATA_FILE, JSON.stringify(state, null, 2), "utf-8");
  } catch (err) {
    console.error("Error saving inventory state:", err);
    throw err;
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

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
      await saveState(newState);
      res.json({ success: true, message: "Inventory state saved successfully" });
    } catch (err) {
      res.status(500).json({ error: "Failed to save inventory state" });
    }
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
      server: { middlewareMode: true },
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

startServer();
