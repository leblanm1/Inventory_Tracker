import React, { useState } from "react";
import { Sample, StorageUnit, Shelf, Box, Rack, Drawer } from "../types.js";
import { parseCSV, HEADER_TO_FIELD_MAP, getFieldLabel } from "../utils.js";
import { Upload, FileSpreadsheet, Check, AlertCircle, Play, Sparkles } from "lucide-react";

interface BulkImportPanelProps {
  storageUnits: StorageUnit[];
  shelves: Shelf[];
  racks: Rack[];
  drawers: Drawer[];
  boxes: Box[];
  onImportComplete: (data: {
    samples: Sample[];
    newStorageUnits: StorageUnit[];
    newShelves: Shelf[];
    newRacks: Rack[];
    newDrawers: Drawer[];
    newBoxes: Box[];
  }) => void;
}

export default function BulkImportPanel({
  storageUnits,
  shelves,
  racks,
  drawers,
  boxes,
  onImportComplete
}: BulkImportPanelProps) {
  const [inputText, setInputText] = useState("");
  const [previewRows, setPreviewRows] = useState<any[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [fileName, setFileName] = useState("");
  const [statusMsg, setStatusMsg] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);

  // Default target if none specified in spreadsheet
  const [defaultStorageId, setDefaultStorageId] = useState("");
  const [defaultShelfId, setDefaultShelfId] = useState("");

  const handleParse = (rawText: string) => {
    if (!rawText.trim()) {
      setStatusMsg({ type: "error", text: "Please paste some data or upload a file first." });
      return;
    }

    try {
      // Determine separator: Tab-delimited (Excel/Google Sheets paste) or Comma-delimited
      let lines: string[][] = [];
      if (rawText.includes("\t")) {
        lines = rawText.split(/\r?\n/).filter(line => line.trim() !== "").map(line => line.split("\t"));
      } else {
        lines = parseCSV(rawText);
      }

      if (lines.length < 2) {
        setStatusMsg({ type: "error", text: "The input must contain at least a header row and one data row." });
        return;
      }

      const csvHeaders = lines[0].map(h => h.trim());
      setHeaders(csvHeaders);

      const parsedRows = lines.slice(1).map((row, index) => {
        const item: Record<string, any> = { _rowId: index + 1 };
        csvHeaders.forEach((header, colIndex) => {
          item[header] = row[colIndex] !== undefined ? row[colIndex].trim() : "";
        });
        return item;
      });

      setPreviewRows(parsedRows);
      setStatusMsg({
        type: "success",
        text: `Successfully parsed ${parsedRows.length} rows! Verify the mapping below and click 'Commit Import'.`
      });
    } catch (err) {
      console.error(err);
      setStatusMsg({ type: "error", text: "Failed to parse spreadsheet data. Make sure it's valid CSV or tab-delimited." });
    }
  };

  // Drag and drop or manual file select
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setInputText(text);
      handleParse(text);
    };
    reader.readAsText(file);
  };

  const handleCommit = () => {
    if (previewRows.length === 0) return;

    // Create tracking maps for dynamic storage creation
    const dynamicUnits: StorageUnit[] = [];
    const dynamicShelves: Shelf[] = [];
    const dynamicRacks: Rack[] = [];
    const dynamicDrawers: Drawer[] = [];
    const dynamicBoxes: Box[] = [];

    // Map rows to samples
    const now = new Date().toISOString();
    const importedSamples: Sample[] = previewRows.map((row, index) => {
      // Create empty metadata
      const sampleMeta: Record<string, any> = {};
      
      // Initialize all metadata keys with empty string
      Object.values(HEADER_TO_FIELD_MAP).forEach(val => {
        sampleMeta[val] = "";
      });

      // Map spreadsheet values based on normalized headers
      headers.forEach(h => {
        const norm = h.toLowerCase().replace(/[^a-z0-9]/g, "");
        const field = HEADER_TO_FIELD_MAP[norm];
        if (field) {
          sampleMeta[field] = row[h];
        }
      });

      // Extract details
      const chemicalName = sampleMeta.chemicalName || sampleMeta.itemName || `Row #${index + 1} item`;
      const casNumber = sampleMeta.casNumber || "";
      let qty = parseFloat(sampleMeta.qty);
      if (isNaN(qty)) qty = 1;
      const units = sampleMeta.units || "vials";
      const notes = sampleMeta.notes || "";
      const itemType = sampleMeta.itemType || "Sample";

      // Dynamically enrich notes with other spreadsheet columns that are not directly mapped
      let enrichedNotes = notes;
      const extraDetails: string[] = [];
      headers.forEach(h => {
        const norm = h.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (["formula", "purity", "physicalstate", "molecularweight", "lifespan", "dateopened", "bottlereference", "alternatename", "technicaldetails", "locationdetails", "mintostock", "maxtostock", "url"].includes(norm)) {
          if (row[h]) {
            extraDetails.push(`${h}: ${row[h]}`);
          }
        }
      });
      if (extraDetails.length > 0) {
        enrichedNotes = (enrichedNotes ? enrichedNotes + " | " : "") + extraDetails.join(" | ");
      }

      // 1. Storage unit resolution
      let targetStorageId = defaultStorageId;
      let sheetStorageName = sampleMeta.freezerNameStr || sampleMeta.freezerIdStr;
      
      // Fallback to "Location" column
      if (!sheetStorageName && sampleMeta.location) {
        sheetStorageName = sampleMeta.location;
      }
      
      if (sheetStorageName) {
        // Try finding matching storage unit
        let matched = storageUnits.find(u => u.name.toLowerCase() === sheetStorageName.toLowerCase() && !u.isArchived)
          || dynamicUnits.find(u => u.name.toLowerCase() === sheetStorageName.toLowerCase());
        
        if (!matched) {
          matched = {
            id: `dyn-store-${Date.now()}-${index}`,
            name: sheetStorageName,
            type: "freezer" // Default to freezer, can be customized later
          };
          dynamicUnits.push(matched);
        }
        targetStorageId = matched.id;
      }

      // 2. Shelf level resolution
      let targetShelfId = defaultShelfId;
      let sheetShelfName = sampleMeta.shelfNameStr || sampleMeta.shelfIdStr;
      
      // Intelligent sub-location mapping for spreadsheets without explicit Freezer/Shelf/Rack/Drawer columns
      let resolvedRackName = sampleMeta.rackName || "";
      let resolvedDrawerName = sampleMeta.drawerNameStr || sampleMeta.drawerIdStr || "";
      let resolvedBoxName = sampleMeta.boxNameStr || sampleMeta.boxIdStr || "";

      if (!sheetShelfName && sampleMeta.subLocation) {
        const subLocLower = sampleMeta.subLocation.toLowerCase();
        if (subLocLower.includes("shelf") || subLocLower.includes("level")) {
          sheetShelfName = sampleMeta.subLocation;
        } else if (subLocLower.includes("rack")) {
          sheetShelfName = "Shelf 1";
          resolvedRackName = sampleMeta.subLocation;
        } else if (subLocLower.includes("drawer")) {
          sheetShelfName = "Shelf 1";
          resolvedDrawerName = sampleMeta.subLocation;
        } else {
          // Default to Shelf 1 and place the item in a box/tray named after subLocation
          sheetShelfName = "Shelf 1";
          resolvedBoxName = sampleMeta.subLocation;
        }
      } else {
        if (!sheetShelfName) {
          sheetShelfName = "Shelf 1";
        }
      }
      
      if (targetStorageId && sheetShelfName) {
        let matched = shelves.find(s => 
          s.storageId === targetStorageId && 
          s.name.toLowerCase() === sheetShelfName.toLowerCase() && 
          !s.isArchived
        ) || dynamicShelves.find(s => 
          s.storageId === targetStorageId && 
          s.name.toLowerCase() === sheetShelfName.toLowerCase()
        );

        if (!matched) {
          matched = {
            id: `dyn-shelf-${Date.now()}-${index}`,
            storageId: targetStorageId,
            name: sheetShelfName
          };
          dynamicShelves.push(matched);
        }
        targetShelfId = matched.id;
      }

      // 3. Rack resolution
      let targetRackId = "";
      const sheetRackName = resolvedRackName || sampleMeta.rackName || sampleMeta.rackId;
      if (targetShelfId && sheetRackName) {
        let matched = racks.find(r => 
          r.shelfId === targetShelfId && 
          r.name.toLowerCase() === sheetRackName.toLowerCase() && 
          !r.isArchived
        ) || dynamicRacks.find(r => 
          r.shelfId === targetShelfId && 
          r.name.toLowerCase() === sheetRackName.toLowerCase()
        );

        if (!matched) {
          matched = {
            id: `dyn-rack-${Date.now()}-${index}`,
            shelfId: targetShelfId,
            storageId: targetStorageId,
            name: sheetRackName
          };
          dynamicRacks.push(matched);
        }
        targetRackId = matched.id;
      }

      // 4. Drawer resolution
      let targetDrawerId = "";
      const sheetDrawerName = resolvedDrawerName || sampleMeta.drawerNameStr || sampleMeta.drawerIdStr;
      if (targetRackId && sheetDrawerName) {
        let matched = drawers.find(d => 
          d.rackId === targetRackId && 
          d.name.toLowerCase() === sheetDrawerName.toLowerCase() && 
          !d.isArchived
        ) || dynamicDrawers.find(d => 
          d.rackId === targetRackId && 
          d.name.toLowerCase() === sheetDrawerName.toLowerCase()
        );

        if (!matched) {
          matched = {
            id: `dyn-drawer-${Date.now()}-${index}`,
            rackId: targetRackId,
            shelfId: targetShelfId,
            storageId: targetStorageId,
            name: sheetDrawerName
          };
          dynamicDrawers.push(matched);
        }
        targetDrawerId = matched.id;
      }

      // 5. Box container resolution
      let targetBoxId: string | null = null;
      const sheetBoxName = resolvedBoxName || sampleMeta.boxNameStr || sampleMeta.boxIdStr;

      if (targetShelfId && sheetBoxName) {
        let matched = boxes.find(b => 
          b.shelfId === targetShelfId && 
          b.name.toLowerCase() === sheetBoxName.toLowerCase() && 
          b.rackId === (targetRackId || null) &&
          b.drawerId === (targetDrawerId || null) &&
          !b.isArchived
        ) || dynamicBoxes.find(b => 
          b.shelfId === targetShelfId && 
          b.name.toLowerCase() === sheetBoxName.toLowerCase() &&
          b.rackId === (targetRackId || null) &&
          b.drawerId === (targetDrawerId || null)
        );

        if (!matched) {
          // Check if coordinates exist in sheet
          const sRow = parseInt(sampleMeta.row);
          const sCol = parseInt(sampleMeta.col);
          const isGrid = !isNaN(sRow) && !isNaN(sCol);

          matched = {
            id: `dyn-box-${Date.now()}-${index}`,
            shelfId: targetShelfId,
            storageId: targetStorageId,
            rackId: targetRackId || null,
            drawerId: targetDrawerId || null,
            name: sheetBoxName,
            rows: isGrid ? 9 : null, // Default 9x9 if grid coordinates are present
            cols: isGrid ? 9 : null
          };
          dynamicBoxes.push(matched);
        }
        targetBoxId = matched.id;
      }

      // Determine grid row & col
      let finalRow = parseInt(sampleMeta.row);
      let finalCol = parseInt(sampleMeta.col);
      if (isNaN(finalRow)) finalRow = null as any;
      if (isNaN(finalCol)) finalCol = null as any;

      const mappedSample: Sample = {
        id: `sample-import-${Date.now()}-${index}`,
        storageId: targetStorageId || (storageUnits[0]?.id || ""),
        shelfId: targetShelfId || "",
        rackId: targetRackId || "",
        drawerId: targetDrawerId || "",
        boxId: targetBoxId,
        row: finalRow,
        col: finalCol,
        qty,
        units,
        chemicalName,
        casNumber,
        itemType,
        notes: enrichedNotes || notes,
        // Include everything else
        chemicalId: sampleMeta.chemicalId || "",
        lab: sampleMeta.lab || "Main Lab",
        phase: sampleMeta.phase || "",
        room: sampleMeta.room || "",
        location: sampleMeta.location || "",
        subLocation: sampleMeta.subLocation || "",
        status: sampleMeta.status || "Available",
        plasmidName: sampleMeta.plasmidName || "",
        primaryBox: sampleMeta.primaryBox || "",
        secondaryBox: sampleMeta.secondaryBox || "",
        primaryTube: sampleMeta.primaryTube || "",
        secondaryTube: sampleMeta.secondaryTube || "",
        primaryDateDeposited: sampleMeta.primaryDateDeposited || "",
        secondaryDateDeposited: sampleMeta.secondaryDateDeposited || "",
        primaryDepositedBy: sampleMeta.primaryDepositedBy || "",
        secondaryDepositedBy: sampleMeta.secondaryDepositedBy || "",
        primaryPrep: sampleMeta.primaryPrep || "",
        secondaryPrep: sampleMeta.secondaryPrep || "",
        primaryRef: sampleMeta.primaryRef || "",
        secondaryRef: sampleMeta.secondaryRef || "",
        system: sampleMeta.system || "",
        organism: sampleMeta.organism || "",
        gene: sampleMeta.gene || "",
        fragmentSize: sampleMeta.fragmentSize || "",
        mutations: sampleMeta.mutations || "",
        vector: sampleMeta.vector || "",
        markers: sampleMeta.markers || "",
        hosts: sampleMeta.hosts || "",
        notebookRef: sampleMeta.notebookRef || "",
        source: sampleMeta.source || "",
        file: sampleMeta.file || "",
        freezerIdStr: sampleMeta.freezerIdStr || "",
        freezerNameStr: sampleMeta.freezerNameStr || "",
        shelfIdStr: sampleMeta.shelfIdStr || "",
        shelfNameStr: sampleMeta.shelfNameStr || "",
        rackIdStr: targetRackId || sampleMeta.rackId || "",
        rackName: sheetRackName || sampleMeta.rackName || "",
        drawerIdStr: targetDrawerId || sampleMeta.drawerIdStr || "",
        drawerNameStr: sheetDrawerName || sampleMeta.drawerNameStr || "",
        categoryId: sampleMeta.categoryId || "",
        categoryName: sampleMeta.categoryName || "",
        boxIdStr: sampleMeta.boxIdStr || "",
        boxNameStr: sampleMeta.boxNameStr || "",
        itemGroupId: sampleMeta.itemGroupId || "",
        itemGroupName: sampleMeta.itemGroupName || "",
        itemId: sampleMeta.itemId || "",
        itemName: sampleMeta.itemName || "",
        concentration: sampleMeta.concentration || "",
        volumeMass: sampleMeta.volumeMass || "",
        expiresOn: sampleMeta.expiresOn || "",
        createdOn: sampleMeta.createdOn || now,
        catalogNum: sampleMeta.catalogNum || "",
        packaging: sampleMeta.packaging || "",
        price: sampleMeta.price || "",
        lot: sampleMeta.lot || ""
      };

      return mappedSample;
    });

    onImportComplete({
      samples: importedSamples,
      newStorageUnits: dynamicUnits,
      newShelves: dynamicShelves,
      newRacks: dynamicRacks,
      newDrawers: dynamicDrawers,
      newBoxes: dynamicBoxes
    });

    // Reset
    setInputText("");
    setPreviewRows([]);
    setHeaders([]);
    setFileName("");
    setStatusMsg({
      type: "success",
      text: `Import complete! Successfully imported ${importedSamples.length} samples. Created ${dynamicUnits.length} storage units, ${dynamicShelves.length} shelf layers, ${dynamicRacks.length} racks, ${dynamicDrawers.length} drawers, and ${dynamicBoxes.length} box containers.`
    });
  };

  // Helper to map headers dynamically
  const getMappedFieldForHeader = (h: string) => {
    const norm = h.toLowerCase().replace(/[^a-z0-9]/g, "");
    const field = HEADER_TO_FIELD_MAP[norm];
    if (!field) return <span className="text-slate-400 font-mono text-[10px]">Unmapped metadata</span>;
    return <span className="text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded font-mono text-[10px] border border-emerald-100 font-bold">{getFieldLabel(field)}</span>;
  };

  const activeShelves = shelves.filter(s => s.storageId === defaultStorageId && !s.isArchived);

  return (
    <div className="bg-white rounded-xl shadow-xs border border-slate-100 p-6 space-y-6">
      {/* Title */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
          <FileSpreadsheet className="h-6 w-6" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-slate-900">Bulk Import Spreadsheet</h3>
          <p className="text-sm text-slate-500">
            Upload a CSV file or paste columns straight from Microsoft Excel or Google Sheets.
          </p>
        </div>
      </div>

      {statusMsg && (
        <div className={`p-4 rounded-lg flex items-start gap-3 border text-sm font-medium ${
          statusMsg.type === "success" 
            ? "bg-emerald-50 border-emerald-100 text-emerald-800" 
            : statusMsg.type === "error"
            ? "bg-red-50 border-red-100 text-red-800"
            : "bg-blue-50 border-blue-100 text-blue-800"
        }`}>
          {statusMsg.type === "success" ? (
            <Check className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
          )}
          <div>{statusMsg.text}</div>
        </div>
      )}

      {/* Inputs Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Step 1: Upload or Paste */}
        <div className="md:col-span-2 space-y-3">
          <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">
            Step 1: Paste spreadsheet data or select file
          </label>
          <textarea
            rows={6}
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            placeholder="Paste your Excel/Google sheets columns here (including header row)...&#10;Or click 'Select File' below to upload a .csv file."
            className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 font-mono text-xs outline-hidden bg-slate-50"
          />
          <div className="flex gap-3">
            <label className="flex items-center justify-center gap-1.5 px-4 py-2 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 cursor-pointer bg-white hover:bg-slate-50 hover:border-slate-300 shadow-sm transition-all">
              <Upload className="h-4 w-4 text-slate-500" />
              <span>Select CSV File</span>
              <input type="file" accept=".csv" onChange={handleFileUpload} className="hidden" />
            </label>
            {fileName && <span className="text-xs text-slate-500 self-center font-mono italic">Loaded: {fileName}</span>}
            
            <button
              onClick={() => handleParse(inputText)}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-semibold shadow-sm transition-all ml-auto flex items-center gap-1"
            >
              <Play className="h-3.5 w-3.5" /> Parse Columns
            </button>
          </div>
        </div>

        {/* Step 2: Fallback Location settings */}
        <div className="space-y-4 p-4 bg-slate-50 rounded-xl border border-slate-100">
          <div>
            <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-1 flex items-center gap-1">
              <Sparkles className="h-3.5 w-3.5 text-indigo-500" /> Dynamic Matching
            </h4>
            <p className="text-[11px] text-slate-500 leading-relaxed mb-3">
              If your sheet contains columns like <b>Freezer Name</b> or <b>Shelf Name</b>, they will be matched or created automatically.
            </p>
          </div>
          <hr className="border-slate-200" />
          <div className="space-y-3">
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">
              Import Fallback Location
            </label>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              If rows do not list any storage location, place them in:
            </p>
            <div>
              <label className="block text-[10px] font-bold text-slate-600 mb-0.5">Storage Unit</label>
              <select
                value={defaultStorageId}
                onChange={e => {
                  setDefaultStorageId(e.target.value);
                  setDefaultShelfId("");
                }}
                className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg bg-white text-xs outline-hidden"
              >
                <option value="">-- Choose Unit --</option>
                {storageUnits.filter(u => !u.isArchived).map(u => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-600 mb-0.5">Shelf Level</label>
              <select
                value={defaultShelfId}
                onChange={e => setDefaultShelfId(e.target.value)}
                disabled={!defaultStorageId}
                className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg bg-white text-xs outline-hidden disabled:opacity-60"
              >
                <option value="">-- Choose Shelf --</option>
                {activeShelves.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Preview Section */}
      {previewRows.length > 0 && (
        <div className="space-y-4 pt-4 border-t border-slate-100">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              Step 2: Preview & Column Mapping ({previewRows.length} rows)
            </h4>
            <button
              onClick={handleCommit}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-semibold shadow-md hover:shadow-lg transition-all flex items-center gap-1.5"
            >
              <Check className="h-4 w-4" /> Commit Import
            </button>
          </div>

          {/* Mapping visualization */}
          <div className="p-4 bg-slate-50 border border-slate-100 rounded-xl space-y-2">
            <div className="text-xs font-bold text-slate-600">Header Detections & Field Mappings:</div>
            <div className="flex flex-wrap gap-2">
              {headers.map((h, i) => (
                <div key={i} className="flex flex-col p-2 bg-white rounded-lg border border-slate-100 shadow-3xs max-w-xs">
                  <span className="text-xs font-semibold text-slate-800 font-mono truncate">{h}</span>
                  <div className="mt-1">{getMappedFieldForHeader(h)}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Data preview table */}
          <div className="overflow-x-auto border border-slate-200 rounded-xl max-h-72">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-slate-50 text-slate-700 font-bold sticky top-0 border-b border-slate-200">
                <tr>
                  <th className="p-3 bg-slate-50 text-slate-500 w-10">Row</th>
                  {headers.map((h, i) => (
                    <th key={i} className="p-3 bg-slate-50">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {previewRows.slice(0, 5).map((row, rIdx) => (
                  <tr key={rIdx} className="hover:bg-slate-50/50">
                    <td className="p-3 font-mono text-slate-400">{row._rowId}</td>
                    {headers.map((h, hIdx) => (
                      <td key={hIdx} className="p-3 max-w-[200px] truncate" title={row[h]}>
                        {row[h]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {previewRows.length > 5 && (
            <p className="text-xs text-slate-400 italic text-center">
              Showing preview of first 5 rows of {previewRows.length} total rows.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
