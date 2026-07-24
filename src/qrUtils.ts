/**
 * QR code generation utilities for box labels (review item 10).
 * Uses the `qrcode` npm package to generate QR code data URLs encoding
 * a URL that navigates directly to a box's grid view.
 */
import QRCode from "qrcode";
import { Box, Shelf, StorageUnit, Rack, Drawer } from "./types.js";

/**
 * Builds the URL that a QR code for a given box should encode.
 * The URL uses a `?boxId=<id>` query parameter so the app can
 * navigate directly to the box grid view on load.
 */
export function buildBoxUrl(boxId: string): string {
  const base = typeof window !== "undefined" ? `${window.location.origin}${window.location.pathname}` : "";
  return `${base}?boxId=${encodeURIComponent(boxId)}`;
}

/**
 * Generates a QR code data URL (PNG) for a single box.
 */
export async function generateBoxQR(boxId: string): Promise<string> {
  const url = buildBoxUrl(boxId);
  return QRCode.toDataURL(url, {
    width: 200,
    margin: 2,
    errorCorrectionLevel: "M",
  });
}

/**
 * Metadata for a single QR label entry.
 */
export interface QRLabelEntry {
  boxId: string;
  boxName: string;
  locationPath: string;
  dataUrl: string;
}

/**
 * Generates QR code labels for all non-archived boxes.
 * Returns an array of label entries with QR data URLs and location metadata.
 */
export async function generateAllBoxQRLabels(
  boxes: Box[],
  shelves: Shelf[],
  racks: Rack[],
  drawers: Drawer[],
  storageUnits: StorageUnit[]
): Promise<QRLabelEntry[]> {
  const labels: QRLabelEntry[] = [];

  for (const box of boxes) {
    if (box.isArchived) continue;

    // Build a human-readable location path
    const shelf = shelves.find(s => s.id === box.shelfId);
    const storage = storageUnits.find(u => u.id === box.storageId);
    const rack = box.rackId ? racks.find(r => r.id === box.rackId) : undefined;
    const drawer = box.drawerId ? drawers.find(d => d.id === box.drawerId) : undefined;

    const parts: string[] = [];
    if (storage) parts.push(storage.name);
    if (shelf) parts.push(shelf.name);
    if (rack) parts.push(rack.name);
    if (drawer) parts.push(drawer.name);
    parts.push(box.name);

    const dataUrl = await generateBoxQR(box.id);
    labels.push({
      boxId: box.id,
      boxName: box.name,
      locationPath: parts.join(" > "),
      dataUrl,
    });
  }

  return labels;
}

/**
 * Opens a print-friendly window with all QR labels laid out for printing.
 * Each label shows the QR code, box name, and location path.
 */
export function printQRLabels(labels: QRLabelEntry[]): void {
  const win = window.open("", "_blank", "width=800,height=600");
  if (!win) {
    alert("Please allow popups to print QR labels.");
    return;
  }

  const labelHtml = labels.map(label => `
    <div class="label">
      <img src="${label.dataUrl}" alt="QR code for ${label.boxName}" />
      <div class="label-name">${escapeHtml(label.boxName)}</div>
      <div class="label-path">${escapeHtml(label.locationPath)}</div>
    </div>
  `).join("");

  win.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>QR Labels — Lab Inventory</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, sans-serif; padding: 20px; }
    h1 { font-size: 16px; margin-bottom: 16px; color: #333; }
    .labels { display: flex; flex-wrap: wrap; gap: 12px; }
    .label {
      width: 180px;
      border: 1px solid #ccc;
      border-radius: 8px;
      padding: 10px;
      text-align: center;
      page-break-inside: avoid;
    }
    .label img { width: 160px; height: 160px; }
    .label-name { font-size: 12px; font-weight: bold; margin-top: 6px; color: #1e293b; }
    .label-path { font-size: 9px; color: #64748b; margin-top: 2px; }
    @media print { .labels { gap: 8px; } body { padding: 10px; } }
  </style>
</head>
<body>
  <h1>Lab Inventory — Box QR Labels (${labels.length} boxes)</h1>
  <div class="labels">${labelHtml}</div>
</body>
</html>`);
  win.document.close();

  // Give the images time to load before printing
  setTimeout(() => {
    win.focus();
    win.print();
  }, 500);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
