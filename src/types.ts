/**
 * Types and Interfaces for Lab Inventory Tracker
 */

export type StorageType = 'freezer' | 'refrigerator' | 'room_temp';

export interface StorageUnit {
  id: string;
  name: string;
  type: StorageType;
  isArchived?: boolean;
}

export interface Shelf {
  id: string;
  storageId: string;
  name: string;
  cols?: number | null; // number of slots/racks across the shelf
  isArchived?: boolean;
}

export interface Rack {
  id: string;
  shelfId: string;
  storageId: string;
  name: string;
  rows?: number | null; // rows/grid layout dimension for box slots
  cols?: number | null; // columns/grid layout dimension for box slots
  shelfCol?: number | null; // column slot position on the shelf
  isArchived?: boolean;
}

export interface Drawer {
  id: string;
  rackId: string;
  shelfId: string;
  storageId: string;
  name: string;
  isArchived?: boolean;
}

export interface Box {
  id: string;
  shelfId: string;
  storageId: string;
  rackId?: string | null;   // optional link to a rack inside the shelf
  drawerId?: string | null; // optional link to a drawer inside the rack
  name: string;
  rows: number | null; // null if free-form box (not grid)
  cols: number | null; // null if free-form box (not grid)
  shelfCol?: number | null; // column slot position on the shelf (if direct)
  isArchived?: boolean;
}

export interface Sample {
  id: string;
  storageId: string;
  shelfId: string;
  rackId?: string | null;   // optional link to a rack
  drawerId?: string | null; // optional link to a drawer
  boxId: string | null; // null if stored directly on a shelf or inside a drawer/rack without box
  row: number | null;    // 1-indexed, null if not grid
  col: number | null;    // 1-indexed, null if not grid
  qty: number;
  units: string;
  isArchived?: boolean;

  // Key visual/search fields
  chemicalName: string;
  casNumber: string;
  itemType: string;
  notes: string;

  // Standard Lab Inventory Spreadsheet Headers (Mapping all user headers)
  chemicalId: string;
  lab: string;
  phase: string;
  room: string;
  location: string;
  subLocation: string;
  status: string;
  plasmidName: string;
  primaryBox: string;
  secondaryBox: string;
  primaryTube: string;
  secondaryTube: string;
  primaryDateDeposited: string;
  secondaryDateDeposited: string;
  primaryDepositedBy: string;
  secondaryDepositedBy: string;
  primaryPrep: string; // Primary Preparation/Concentration
  secondaryPrep: string; // Secondary Preparation/Concentration
  primaryRef: string; // Primary Reference
  secondaryRef: string; // Secondary Reference
  system: string;
  organism: string;
  gene: string;
  fragmentSize: string;
  mutations: string;
  vector: string;
  markers: string;
  hosts: string;
  notebookRef: string;
  source: string;
  file: string;
  freezerIdStr: string;
  freezerNameStr: string;
  shelfIdStr: string;
  shelfNameStr: string;
  rackIdStr: string;
  rackName: string;
  drawerIdStr: string;
  drawerNameStr: string;
  categoryId: string;
  categoryName: string;
  boxIdStr: string;
  boxNameStr: string;
  itemGroupId: string;
  itemGroupName: string;
  itemId: string;
  itemName: string;
  concentration: string;
  volumeMass: string;
  expiresOn: string;
  createdOn: string;
  catalogNum: string; // Catalog #
  packaging: string;
  price: string;
  lot: string;
}

export interface AuditLog {
  id: string;
  timestamp: string; // ISO 8601 string
  user: string;
  action: string;
  description: string;
}

export interface AuditSnapshot {
  id: string;
  logId: string;
  timestamp: string;
  user: string;
  action: string;
  description: string;
  users: string[];
  storageUnits: StorageUnit[];
  shelves: Shelf[];
  racks: Rack[];
  drawers: Drawer[];
  boxes: Box[];
  samples: Sample[];
}

export interface InventoryState {
  users: string[];
  storageUnits: StorageUnit[];
  shelves: Shelf[];
  racks: Rack[];
  drawers: Drawer[];
  boxes: Box[];
  samples: Sample[];
  auditLogs: AuditLog[];
  auditSnapshots: AuditSnapshot[];
}
