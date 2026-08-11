/**
 * Lab inventory utility functions for expiry tracking, low-stock alerts,
 * GHS hazard pictograms, and storage compatibility checks.
 * (Review items 3, 4, 5)
 */
import { Sample } from "./types.js";

// ---------------------------------------------------------------------------
// Expiry tracking (Item 3)
// ---------------------------------------------------------------------------

export type ExpiryStatus = "expired" | "critical" | "warning" | "soon" | "ok" | "none";

function parseInventoryDate(value: string): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const dateOnlyMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnlyMatch) {
    const year = Number(dateOnlyMatch[1]);
    const month = Number(dateOnlyMatch[2]);
    const day = Number(dateOnlyMatch[3]);
    const localDate = new Date(year, month - 1, day);
    return Number.isNaN(localDate.getTime()) ? null : localDate;
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Returns the expiry status for a sample based on its expiresOn date.
 * - expired: past the expiry date
 * - critical: expires within 30 days
 * - warning: expires within 60 days
 * - soon: expires within 90 days
 * - ok: expires beyond 90 days
 * - none: no expiry date set
 */
export function getExpiryStatus(sample: Sample): ExpiryStatus {
  if (!sample.expiresOn) return "none";
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const expiry = parseInventoryDate(sample.expiresOn);
  if (!expiry) return "none";
  expiry.setHours(0, 0, 0, 0);

  const diffMs = expiry.getTime() - now.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return "expired";
  if (diffDays <= 30) return "critical";
  if (diffDays <= 60) return "warning";
  if (diffDays <= 90) return "soon";
  return "ok";
}

export function getExpiryColorClass(status: ExpiryStatus): string {
  switch (status) {
    case "expired": return "bg-red-500";
    case "critical": return "bg-red-400";
    case "warning": return "bg-amber-400";
    case "soon": return "bg-yellow-300";
    case "ok": return "bg-emerald-400";
    default: return "bg-slate-300";
  }
}

export function getExpiryBadgeClass(status: ExpiryStatus): string {
  switch (status) {
    case "expired": return "bg-red-100 text-red-700 border-red-200";
    case "critical": return "bg-red-50 text-red-600 border-red-200";
    case "warning": return "bg-amber-50 text-amber-700 border-amber-200";
    case "soon": return "bg-yellow-50 text-yellow-700 border-yellow-200";
    case "ok": return "bg-emerald-50 text-emerald-700 border-emerald-200";
    default: return "bg-slate-50 text-slate-400 border-slate-200";
  }
}

export function getExpiryLabel(status: ExpiryStatus): string {
  switch (status) {
    case "expired": return "Expired";
    case "critical": return "< 30 days";
    case "warning": return "< 60 days";
    case "soon": return "< 90 days";
    case "ok": return "OK";
    default: return "No expiry";
  }
}

export function getDaysUntilExpiry(sample: Sample): number | null {
  if (!sample.expiresOn) return null;
  const expiry = parseInventoryDate(sample.expiresOn);
  if (!expiry) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  expiry.setHours(0, 0, 0, 0);
  return Math.floor((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Returns all non-archived samples that are expired or expiring within 90 days,
 * sorted by expiry date ascending.
 */
export function getExpiringSamples(samples: Sample[]): Sample[] {
  return samples
    .filter(s => !s.isArchived && s.expiresOn)
    .filter(s => {
      const status = getExpiryStatus(s);
      return status === "expired" || status === "critical" || status === "warning" || status === "soon";
    })
    .sort((a, b) => {
      const da = new Date(a.expiresOn).getTime();
      const db = new Date(b.expiresOn).getTime();
      return da - db;
    });
}

// ---------------------------------------------------------------------------
// Low-stock alerts (Item 5)
// ---------------------------------------------------------------------------

/**
 * Returns true if the sample is at or below its minimum stock level.
 * Excludes archived samples and depleted (qty=0) samples that have no minStockLevel.
 */
export function isLowStock(sample: Sample): boolean {
  if (sample.isArchived) return false;
  if (sample.minStockLevel === undefined || sample.minStockLevel === null) return false;
  return sample.qty <= sample.minStockLevel;
}

/**
 * Returns all low-stock samples, sorted by urgency (lowest qty relative to min).
 */
export function getLowStockSamples(samples: Sample[]): Sample[] {
  return samples
    .filter(s => isLowStock(s))
    .sort((a, b) => {
      const ratioA = a.minStockLevel ? a.qty / a.minStockLevel : 1;
      const ratioB = b.minStockLevel ? b.qty / b.minStockLevel : 1;
      return ratioA - ratioB;
    });
}

/**
 * Generates a shopping list CSV for all low-stock items.
 */
export function generateShoppingListCSV(samples: Sample[]): string {
  const lowStock = getLowStockSamples(samples);
  const headers = ["Chemical Name", "Catalog #", "Source/Vendor", "Current Qty", "Units", "Min Stock Level", "Reorder Qty"];
  const lines = [headers.join(",")];

  for (const s of lowStock) {
    const row = [
      escapeCSV(s.chemicalName),
      escapeCSV(s.catalogNum),
      escapeCSV(s.source),
      String(s.qty),
      escapeCSV(s.units),
      String(s.minStockLevel ?? ""),
      String(s.reorderQty ?? "")
    ];
    lines.push(row.join(","));
  }

  return lines.join("\n");
}

function escapeCSV(value: string): string {
  if (!value) return "";
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// ---------------------------------------------------------------------------
// GHS Hazard pictograms (Item 4)
// ---------------------------------------------------------------------------

/**
 * GHS hazard code categories and their pictogram names.
 * Maps GHS H-codes to the standard pictogram categories.
 */
export const GHS_PICTOGRAM_MAP: Record<string, string> = {
  // Flammable (H220-H229)
  "H220": "flammable", "H221": "flammable", "H222": "flammable", "H223": "flammable",
  "H224": "flammable", "H225": "flammable", "H226": "flammable", "H227": "flammable",
  "H228": "flammable", "H229": "flammable",
  // Oxidizer (H270-H272)
  "H270": "oxidizer", "H271": "oxidizer", "H272": "oxidizer",
  // Gas under pressure (H280-H282)
  "H280": "gas-pressure", "H281": "gas-pressure", "H282": "gas-pressure",
  // Explosive (H200-H206)
  "H200": "explosive", "H201": "explosive", "H202": "explosive", "H203": "explosive",
  "H204": "explosive", "H205": "explosive", "H206": "explosive", "H207": "explosive", "H208": "explosive",
  // Corrosive (H314, H318, H290)
  "H290": "corrosive", "H314": "corrosive", "H318": "corrosive",
  // Acute toxicity (H300-H302, H310-H312, H330-H332)
  "H300": "toxic", "H301": "toxic", "H302": "toxic",
  "H310": "toxic", "H311": "toxic", "H312": "toxic",
  "H330": "toxic", "H331": "toxic", "H332": "toxic",
  // Health hazard (H340-H350, H360-H373)
  "H340": "health-hazard", "H341": "health-hazard", "H350": "health-hazard",
  "H351": "health-hazard", "H360": "health-hazard", "H361": "health-hazard",
  "H370": "health-hazard", "H371": "health-hazard", "H372": "health-hazard", "H373": "health-hazard",
  // Irritant (H315-H320, H335-H336)
  "H315": "irritant", "H316": "irritant", "H317": "irritant",
  "H319": "irritant", "H320": "irritant", "H335": "irritant", "H336": "irritant",
  // Environmental hazard (H400-H412)
  "H400": "environment", "H401": "environment", "H402": "environment",
  "H410": "environment", "H411": "environment", "H412": "environment", "H413": "environment",
};

export const GHS_PICTOGRAM_LABELS: Record<string, string> = {
  "flammable": "Flammable",
  "oxidizer": "Oxidizer",
  "gas-pressure": "Gas Under Pressure",
  "explosive": "Explosive",
  "corrosive": "Corrosive",
  "toxic": "Toxic",
  "health-hazard": "Health Hazard",
  "irritant": "Irritant",
  "environment": "Environmental Hazard",
};

/**
 * Returns the set of unique pictogram categories for a sample's GHS codes.
 */
export function getGHSPictograms(codes?: string[]): string[] {
  if (!codes || !Array.isArray(codes)) return [];
  const pictograms = new Set<string>();
  for (const code of codes) {
    const upper = code.toUpperCase().trim();
    const pictogram = GHS_PICTOGRAM_MAP[upper];
    if (pictogram) pictograms.add(pictogram);
  }
  return Array.from(pictograms);
}

/**
 * Returns a short emoji/symbol for each GHS pictogram for compact display.
 */
export const GHS_PICTOGRAM_SYMBOLS: Record<string, string> = {
  "flammable": "🔥",
  "oxidizer": "◯",
  "gas-pressure": "⛽",
  "explosive": "💥",
  "corrosive": "🧪",
  "toxic": "☠",
  "health-hazard": "⚠",
  "irritant": "!",
  "environment": "🌱",
};

// ---------------------------------------------------------------------------
// Storage compatibility (Item 4)
// ---------------------------------------------------------------------------

/**
 * Storage compatibility matrix.
 * Defines which storage classes are incompatible with each other.
 */
const COMPATIBILITY_MATRIX: Record<string, string[]> = {
  "flammable": ["oxidizer", "explosive"],
  "oxidizer": ["flammable", "acid", "base", "explosive"],
  "acid": ["base", "oxidizer"],
  "base": ["acid", "oxidizer"],
  "light-sensitive": [],
  "general": [],
  "explosive": ["flammable", "oxidizer"],
};

/**
 * Returns true if two storage classes are incompatible.
 */
export function isIncompatible(classA?: string, classB?: string): boolean {
  if (!classA || !classB) return false;
  const incompatible = COMPATIBILITY_MATRIX[classA];
  if (!incompatible) return false;
  return incompatible.includes(classB);
}

/**
 * Checks if a sample is compatible with the other samples in the same container.
 * Returns a list of incompatible sample names.
 */
export function checkCompatibility(
  sample: Sample,
  containerSamples: Sample[]
): string[] {
  if (!sample.storageClass) return [];
  const incompatible: string[] = [];
  for (const other of containerSamples) {
    if (other.id === sample.id || other.isArchived) continue;
    if (isIncompatible(sample.storageClass, other.storageClass)) {
      incompatible.push(`${other.chemicalName} (${other.storageClass})`);
    }
  }
  return incompatible;
}
