import React, { useMemo, useState } from "react";
import { StorageUnit, Shelf, Rack, Drawer, Box, Sample } from "../types.js";
import { parseCSV } from "../utils.js";
import { Upload, FileSpreadsheet, Check, AlertCircle, Play, PencilLine } from "lucide-react";

type RenameEntityType = "storage" | "shelf" | "rack" | "drawer" | "box" | "sample";

type RenameOperation = {
  entityType: RenameEntityType;
  id: string;
  oldName: string;
  newName: string;
};

type PlannedRow = {
  row: number;
  status: "ready" | "error";
  message: string;
  operation?: RenameOperation;
};

type RenamePlan = {
  operations: RenameOperation[];
  rows: PlannedRow[];
  readyCount: number;
  errorCount: number;
};

interface BulkRenamePanelProps {
  storageUnits: StorageUnit[];
  shelves: Shelf[];
  racks: Rack[];
  drawers: Drawer[];
  boxes: Box[];
  samples: Sample[];
  onRenameComplete: (plan: RenamePlan) => Promise<boolean>;
}

export default function BulkRenamePanel({
  storageUnits,
  shelves,
  racks,
  drawers,
  boxes,
  samples,
  onRenameComplete
}: BulkRenamePanelProps) {
  const [inputText, setInputText] = useState("");
  const [previewRows, setPreviewRows] = useState<Record<string, string>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [fileName, setFileName] = useState("");
  const [statusMsg, setStatusMsg] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);
  const [pendingPlan, setPendingPlan] = useState<RenamePlan | null>(null);

  const normalizedHeaderMap = useMemo(() => {
    const map = new Map<string, string>();
    headers.forEach((header) => {
      map.set(normalize(header), header);
    });
    return map;
  }, [headers]);

  function normalize(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function readCellByAlias(row: Record<string, string>, aliases: string[]): string {
    for (const alias of aliases) {
      const sourceHeader = normalizedHeaderMap.get(normalize(alias));
      if (!sourceHeader) continue;
      const value = String(row[sourceHeader] || "").trim();
      if (value) return value;
    }
    return "";
  }

  function parseEntityType(raw: string): RenameEntityType | null {
    const key = normalize(raw);
    if (["storage", "storageunit", "unit", "freezer", "refrigerator"].includes(key)) return "storage";
    if (["shelf", "shelvel", "level"].includes(key)) return "shelf";
    if (["rack"].includes(key)) return "rack";
    if (["drawer"].includes(key)) return "drawer";
    if (["box"].includes(key)) return "box";
    if (["sample", "chemical", "chemicalname", "item"].includes(key)) return "sample";
    return null;
  }

  function namesEqual(a: string, b: string): boolean {
    return a.trim().toLowerCase() === b.trim().toLowerCase();
  }

  function resolveOperation(row: Record<string, string>, rowNum: number): PlannedRow {
    const typeRaw = readCellByAlias(row, ["Type", "Entity", "ItemType"]);
    const currentName = readCellByAlias(row, ["Current Name", "Old Name", "Name", "CurrentName", "OldName"]);
    const newName = readCellByAlias(row, ["New Name", "Rename To", "Rename", "To", "NewName"]);
    const idHint = readCellByAlias(row, ["ID", "Id", "Item ID", "ItemId"]);

    if (!typeRaw || !newName || (!currentName && !idHint)) {
      return {
        row: rowNum,
        status: "error",
        message: "Missing required fields. Need Type, New Name, and Current Name (or ID)."
      };
    }

    const entityType = parseEntityType(typeRaw);
    if (!entityType) {
      return {
        row: rowNum,
        status: "error",
        message: `Unsupported Type '${typeRaw}'.`
      };
    }

    const storageHint = readCellByAlias(row, ["Storage", "Freezer", "Storage Unit", "StorageUnit"]);
    const shelfHint = readCellByAlias(row, ["Shelf", "Shelf Name", "ShelfName"]);
    const rackHint = readCellByAlias(row, ["Rack", "Rack Name", "RackName"]);
    const drawerHint = readCellByAlias(row, ["Drawer", "Drawer Name", "DrawerName"]);
    const boxHint = readCellByAlias(row, ["Box", "Box Name", "BoxName"]);

    const activeStorage = storageUnits.filter(item => !item.isArchived);
    const activeShelves = shelves.filter(item => !item.isArchived);
    const activeRacks = racks.filter(item => !item.isArchived);
    const activeDrawers = drawers.filter(item => !item.isArchived);
    const activeBoxes = boxes.filter(item => !item.isArchived);
    const activeSamples = samples.filter(item => !item.isArchived);

    if (entityType === "storage") {
      const matches = activeStorage.filter(item =>
        (idHint ? item.id === idHint : namesEqual(item.name, currentName))
      );
      return finalizeMatch(matches, entityType, newName, rowNum, item => item.name);
    }

    if (entityType === "shelf") {
      const matches = activeShelves.filter(item => {
        if (idHint && item.id !== idHint) return false;
        if (!idHint && !namesEqual(item.name, currentName)) return false;
        if (storageHint) {
          const parent = activeStorage.find(s => s.id === item.storageId);
          if (!parent || !namesEqual(parent.name, storageHint)) return false;
        }
        return true;
      });
      return finalizeMatch(matches, entityType, newName, rowNum, item => item.name);
    }

    if (entityType === "rack") {
      const matches = activeRacks.filter(item => {
        if (idHint && item.id !== idHint) return false;
        if (!idHint && !namesEqual(item.name, currentName)) return false;

        if (shelfHint) {
          const parentShelf = activeShelves.find(s => s.id === item.shelfId);
          if (!parentShelf || !namesEqual(parentShelf.name, shelfHint)) return false;
        }
        if (storageHint) {
          const parentStorage = activeStorage.find(s => s.id === item.storageId);
          if (!parentStorage || !namesEqual(parentStorage.name, storageHint)) return false;
        }
        return true;
      });
      return finalizeMatch(matches, entityType, newName, rowNum, item => item.name);
    }

    if (entityType === "drawer") {
      const matches = activeDrawers.filter(item => {
        if (idHint && item.id !== idHint) return false;
        if (!idHint && !namesEqual(item.name, currentName)) return false;

        if (rackHint) {
          const parentRack = activeRacks.find(r => r.id === item.rackId);
          if (!parentRack || !namesEqual(parentRack.name, rackHint)) return false;
        }
        if (shelfHint) {
          const parentShelf = activeShelves.find(s => s.id === item.shelfId);
          if (!parentShelf || !namesEqual(parentShelf.name, shelfHint)) return false;
        }
        if (storageHint) {
          const parentStorage = activeStorage.find(s => s.id === item.storageId);
          if (!parentStorage || !namesEqual(parentStorage.name, storageHint)) return false;
        }
        return true;
      });
      return finalizeMatch(matches, entityType, newName, rowNum, item => item.name);
    }

    if (entityType === "box") {
      const matches = activeBoxes.filter(item => {
        if (idHint && item.id !== idHint) return false;
        if (!idHint && !namesEqual(item.name, currentName)) return false;

        if (drawerHint) {
          const parentDrawer = item.drawerId ? activeDrawers.find(d => d.id === item.drawerId) : null;
          if (!parentDrawer || !namesEqual(parentDrawer.name, drawerHint)) return false;
        }
        if (rackHint) {
          const parentRack = item.rackId ? activeRacks.find(r => r.id === item.rackId) : null;
          if (!parentRack || !namesEqual(parentRack.name, rackHint)) return false;
        }
        if (shelfHint) {
          const parentShelf = activeShelves.find(s => s.id === item.shelfId);
          if (!parentShelf || !namesEqual(parentShelf.name, shelfHint)) return false;
        }
        if (storageHint) {
          const parentStorage = activeStorage.find(s => s.id === item.storageId);
          if (!parentStorage || !namesEqual(parentStorage.name, storageHint)) return false;
        }
        return true;
      });
      return finalizeMatch(matches, entityType, newName, rowNum, item => item.name);
    }

    const matches = activeSamples.filter(item => {
      if (idHint && item.id !== idHint) return false;
      if (!idHint && !namesEqual(item.chemicalName, currentName)) return false;

      if (boxHint) {
        const parentBox = item.boxId ? activeBoxes.find(b => b.id === item.boxId) : null;
        if (!parentBox || !namesEqual(parentBox.name, boxHint)) return false;
      }
      if (drawerHint) {
        const parentDrawer = item.drawerId ? activeDrawers.find(d => d.id === item.drawerId) : null;
        if (!parentDrawer || !namesEqual(parentDrawer.name, drawerHint)) return false;
      }
      if (rackHint) {
        const parentRack = item.rackId ? activeRacks.find(r => r.id === item.rackId) : null;
        if (!parentRack || !namesEqual(parentRack.name, rackHint)) return false;
      }
      if (shelfHint) {
        const parentShelf = activeShelves.find(s => s.id === item.shelfId);
        if (!parentShelf || !namesEqual(parentShelf.name, shelfHint)) return false;
      }
      if (storageHint) {
        const parentStorage = activeStorage.find(s => s.id === item.storageId);
        if (!parentStorage || !namesEqual(parentStorage.name, storageHint)) return false;
      }
      return true;
    });

    return finalizeMatch(matches, entityType, newName, rowNum, item => item.chemicalName);
  }

  function finalizeMatch<T extends { id: string }>(
    matches: T[],
    entityType: RenameEntityType,
    newName: string,
    rowNum: number,
    oldNameReader: (item: T) => string
  ): PlannedRow {
    if (matches.length === 0) {
      return {
        row: rowNum,
        status: "error",
        message: "No matching record found. Add more context columns to disambiguate."
      };
    }

    if (matches.length > 1) {
      return {
        row: rowNum,
        status: "error",
        message: `Ambiguous match (${matches.length} found). Add context columns or ID.`
      };
    }

    const match = matches[0];
    const oldName = oldNameReader(match);
    if (namesEqual(oldName, newName)) {
      return {
        row: rowNum,
        status: "error",
        message: "New name is the same as current name."
      };
    }

    return {
      row: rowNum,
      status: "ready",
      message: "Ready",
      operation: {
        entityType,
        id: match.id,
        oldName,
        newName
      }
    };
  }

  function buildPlan(): RenamePlan | null {
    if (previewRows.length === 0) {
      setStatusMsg({ type: "error", text: "Nothing to rename. Parse data first." });
      return null;
    }

    const rows = previewRows.map((row, idx) => resolveOperation(row, idx + 1));
    const operations = rows.filter(r => r.status === "ready" && r.operation).map(r => r.operation as RenameOperation);
    const readyCount = operations.length;
    const errorCount = rows.length - readyCount;

    return { operations, rows, readyCount, errorCount };
  }

  const handleParse = (rawText: string) => {
    if (!rawText.trim()) {
      setStatusMsg({ type: "error", text: "Please paste some data or upload a file first." });
      return;
    }

    try {
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

      const parsedHeaders = lines[0].map(h => h.trim());
      const parsedRows = lines.slice(1).map((cells, index) => {
        const row: Record<string, string> = { _rowId: String(index + 1) };
        parsedHeaders.forEach((header, colIndex) => {
          row[header] = cells[colIndex] !== undefined ? String(cells[colIndex]).trim() : "";
        });
        return row;
      });

      setHeaders(parsedHeaders);
      setPreviewRows(parsedRows);
      setPendingPlan(null);
      setStatusMsg({ type: "success", text: `Parsed ${parsedRows.length} rows. Review and build rename plan.` });
    } catch (err) {
      console.error(err);
      setStatusMsg({ type: "error", text: "Failed to parse rename data. Make sure it's valid CSV or tab-delimited." });
    }
  };

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

  const handleBuildPlan = () => {
    const plan = buildPlan();
    if (!plan) return;

    setPendingPlan(plan);
    if (plan.errorCount > 0) {
      setStatusMsg({
        type: "error",
        text: `Plan built with ${plan.readyCount} ready and ${plan.errorCount} blocked row(s). Fix blocked rows before confirming.`
      });
      return;
    }

    setStatusMsg({
      type: "info",
      text: `Plan ready: ${plan.readyCount} rename operation(s). Click 'Confirm Rename' to apply.`
    });
  };

  const handleConfirmRename = async () => {
    if (!pendingPlan) {
      setStatusMsg({ type: "error", text: "No rename plan found. Build the plan first." });
      return;
    }

    if (pendingPlan.errorCount > 0) {
      setStatusMsg({ type: "error", text: "Cannot commit while blocked rows exist." });
      return;
    }

    const didCommit = await onRenameComplete(pendingPlan);
    if (!didCommit) {
      setStatusMsg({ type: "error", text: "Rename commit failed on the server. Nothing was finalized." });
      return;
    }

    setInputText("");
    setPreviewRows([]);
    setHeaders([]);
    setFileName("");
    setPendingPlan(null);
    setStatusMsg({ type: "success", text: `Rename complete. Applied ${pendingPlan.readyCount} rename operation(s).` });
  };

  return (
    <div className="bg-white rounded-xl shadow-xs border border-slate-100 p-6 space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-amber-50 text-amber-600 rounded-lg">
          <PencilLine className="h-6 w-6" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-slate-900">Bulk Rename</h3>
          <p className="text-sm text-slate-500">
            Paste a table to rename existing records without creating new ones.
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
            <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
          )}
          <div>{statusMsg.text}</div>
        </div>
      )}

      <div className="space-y-3">
        <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">
          Step 1: Paste rename table or upload file
        </label>
        <textarea
          rows={6}
          value={inputText}
          onChange={e => setInputText(e.target.value)}
          placeholder={"Required columns: Type, Current Name, New Name. Optional: ID, Storage, Shelf, Rack, Drawer, Box."}
          className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-amber-500 font-mono text-xs outline-hidden bg-slate-50"
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
            <Play className="h-3.5 w-3.5" /> Parse Rename Table
          </button>
        </div>
      </div>

      {previewRows.length > 0 && (
        <div className="space-y-4 pt-4 border-t border-slate-100">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              Step 2: Build Rename Plan ({previewRows.length} rows)
            </h4>
            <button
              onClick={handleBuildPlan}
              className="px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-semibold shadow-md hover:shadow-lg transition-all flex items-center gap-1.5"
            >
              <FileSpreadsheet className="h-4 w-4" /> Build Rename Plan
            </button>
          </div>

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
                {previewRows.slice(0, 8).map((row, rowIndex) => (
                  <tr key={rowIndex} className="hover:bg-slate-50/50">
                    <td className="p-3 font-mono text-slate-400">{row._rowId}</td>
                    {headers.map((h, hIndex) => (
                      <td key={hIndex} className="p-3 max-w-[240px] truncate" title={row[h] || ""}>
                        {row[h] || ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {previewRows.length > 8 && (
            <p className="text-xs text-slate-400 italic text-center">
              Showing preview of first 8 rows of {previewRows.length} total rows.
            </p>
          )}

          {pendingPlan && (
            <div className="p-4 bg-amber-50 border border-amber-100 rounded-xl space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold text-amber-800 uppercase tracking-wider">Rename Plan Review</p>
                  <p className="text-[11px] text-amber-700">
                    Ready: {pendingPlan.readyCount} | Blocked: {pendingPlan.errorCount}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setPendingPlan(null);
                      setStatusMsg({ type: "info", text: "Rename plan cleared." });
                    }}
                    className="px-3 py-1.5 text-[11px] font-bold border border-amber-200 text-amber-700 rounded-lg hover:bg-amber-100"
                  >
                    Cancel Plan
                  </button>
                  <button
                    onClick={handleConfirmRename}
                    disabled={pendingPlan.errorCount > 0 || pendingPlan.readyCount === 0}
                    className="px-3 py-1.5 text-[11px] font-bold bg-amber-700 text-white rounded-lg hover:bg-amber-800 disabled:opacity-50"
                  >
                    Confirm Rename
                  </button>
                </div>
              </div>

              <div className="max-h-52 overflow-y-auto rounded-lg bg-white border border-amber-100 divide-y divide-amber-50">
                {pendingPlan.rows.map((plannedRow) => (
                  <div key={plannedRow.row} className="px-2 py-1.5 text-[11px]">
                    {plannedRow.status === "ready" && plannedRow.operation ? (
                      <span className="text-slate-700">
                        Row {plannedRow.row}: <span className="font-semibold">{plannedRow.operation.entityType}</span>{" "}
                        "{plannedRow.operation.oldName}" {"->"} "{plannedRow.operation.newName}"
                      </span>
                    ) : (
                      <span className="text-red-700">
                        Row {plannedRow.row}: {plannedRow.message}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
