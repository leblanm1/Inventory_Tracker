import React, { useState, useEffect } from "react";
import { StorageUnit, Shelf, Box, Rack, Drawer } from "../types.js";
import { X, Move, Server, Layers, Grid, Archive, Inbox } from "lucide-react";

interface BulkMoveModalProps {
  isOpen: boolean;
  onClose: () => void;
  itemType: "sample" | "box" | "drawer" | "rack";
  selectedCount: number;
  storageUnits: StorageUnit[];
  shelves: Shelf[];
  racks: Rack[];
  drawers: Drawer[];
  boxes: Box[];
  defaultStorageId?: string;
  defaultShelfId?: string;
  defaultRackId?: string;
  defaultDrawerId?: string;
  defaultBoxId?: string | null;
  onConfirmMove: (destination: {
    storageId: string;
    shelfId: string;
    rackId: string | null;
    drawerId: string | null;
    boxId: string | null;
    drawerSlot: number | null;
  }) => void;
}

export default function BulkMoveModal({
  isOpen,
  onClose,
  itemType,
  selectedCount,
  storageUnits,
  shelves,
  racks,
  drawers,
  boxes,
  defaultStorageId,
  defaultShelfId,
  defaultRackId,
  defaultDrawerId,
  defaultBoxId,
  onConfirmMove
}: BulkMoveModalProps) {
  const [selectedStorage, setSelectedStorage] = useState("");
  const [selectedShelf, setSelectedShelf] = useState("");
  const [selectedRack, setSelectedRack] = useState("");
  const [selectedDrawer, setSelectedDrawer] = useState("");
  const [selectedBox, setSelectedBox] = useState("");
  const [selectedDrawerSlot, setSelectedDrawerSlot] = useState("");
  const [validationError, setValidationError] = useState("");

  const activeStorageUnits = React.useMemo(() => storageUnits.filter(u => !u.isArchived), [storageUnits]);

  // Initialize selections when modal opens
  useEffect(() => {
    if (isOpen) {
      setValidationError("");
      const storageId = defaultStorageId || activeStorageUnits[0]?.id || "";
      setSelectedStorage(storageId);
      setSelectedShelf(defaultShelfId || "");
      setSelectedRack(defaultRackId || "");
      setSelectedDrawer(defaultDrawerId || "");
      setSelectedBox(defaultBoxId || "");
      setSelectedDrawerSlot("");
    }
  }, [isOpen, defaultStorageId, defaultShelfId, defaultRackId, defaultDrawerId, defaultBoxId, storageUnits]);

  const handleStorageChange = (storageId: string) => {
    setSelectedStorage(storageId);
    setSelectedShelf("");
    setSelectedRack("");
    setSelectedDrawer("");
    setSelectedBox("");
    setSelectedDrawerSlot("");
  };

  const handleShelfChange = (shelfId: string) => {
    setSelectedShelf(shelfId);
    setSelectedRack("");
    setSelectedDrawer("");
    setSelectedBox("");
    setSelectedDrawerSlot("");
  };

  const handleRackChange = (rackId: string) => {
    setSelectedRack(rackId);
    setSelectedDrawer("");
    setSelectedBox("");
    setSelectedDrawerSlot("");
  };

  const handleDrawerChange = (drawerId: string) => {
    setSelectedDrawer(drawerId);
    setSelectedBox("");
    setSelectedDrawerSlot("");
  };

  const handleBoxChange = (boxId: string) => {
    setSelectedBox(boxId);
  };

  if (!isOpen) return null;

  // Filter lists based on hierarchy selection
  const currentShelves = shelves.filter(s => s.storageId === selectedStorage && !s.isArchived);
  const currentRacks = racks
    .filter(r => r.shelfId === selectedShelf && !r.isArchived)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
  const currentDrawers = drawers
    .filter(d => d.rackId === selectedRack && !d.isArchived)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
  const selectedDrawerEntity = currentDrawers.find(d => d.id === selectedDrawer);
  const selectedDrawerCapacity = Math.max(1, Math.min(500, Number(selectedDrawerEntity?.boxCapacity) || 4));
  
  // Boxes can be direct on shelf, inside a rack, or inside a drawer
  const currentBoxes = boxes.filter(b => {
    if (b.isArchived) return false;
    if (b.storageId !== selectedStorage || b.shelfId !== selectedShelf) return false;
    
    if (selectedDrawer) {
      return b.drawerId === selectedDrawer;
    }
    if (selectedRack) {
      // If a rack is selected but drawer is not, show boxes directly in this rack (no drawer) OR in its drawers if drawer is not specified
      return b.rackId === selectedRack && !b.drawerId;
    }
    // If no rack selected, show boxes directly on the shelf
    return !b.rackId && !b.drawerId;
  });

  const handleConfirm = () => {
    if (!selectedStorage) {
      setValidationError("Please select a target Refrigerator/Freezer unit.");
      return;
    }
    if (!selectedShelf) {
      setValidationError("Please select a target Shelf Level.");
      return;
    }
    if (itemType === "drawer" && !selectedRack) {
      setValidationError("Please select a target Rack.");
      return;
    }

    onConfirmMove({
      storageId: selectedStorage,
      shelfId: selectedShelf,
      rackId: selectedRack || null,
      drawerId: selectedDrawer || null,
      boxId: selectedBox || null,
      drawerSlot: selectedDrawerSlot ? Number(selectedDrawerSlot) : null
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="w-full max-w-md bg-white rounded-xl shadow-2xl flex flex-col border border-slate-100 animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-slate-50">
          <div className="flex items-center gap-2">
            <Move className="h-5 w-5 text-indigo-600" />
            <h3 className="text-lg font-semibold text-slate-900">Bulk Relocate Items</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="p-3 bg-indigo-50 border border-indigo-100 rounded-lg text-indigo-800 text-xs font-semibold">
            You are moving <span className="underline font-bold text-sm">{selectedCount}</span> selected {itemType}(s) to a new location. All child coordinates and samples will be updated automatically.
          </div>

          {validationError && (
            <div className="p-3 bg-red-50 text-red-700 text-sm font-medium rounded-lg border border-red-100">
              {validationError}
            </div>
          )}

          {/* 1. Storage Unit */}
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 flex items-center gap-1">
              <Server className="h-3 w-3" /> Refrigerator / Freezer *
            </label>
            <select
              value={selectedStorage}
              onChange={e => handleStorageChange(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 text-xs font-semibold outline-hidden cursor-pointer"
            >
              <option value="">-- Select Storage Unit --</option>
              {activeStorageUnits.map(unit => (
                <option key={unit.id} value={unit.id}>{unit.name}</option>
              ))}
            </select>
          </div>

          {/* 2. Shelf Level */}
          {selectedStorage && (
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 flex items-center gap-1">
                <Layers className="h-3 w-3" /> Shelf Level *
              </label>
              <select
                value={selectedShelf}
                onChange={e => handleShelfChange(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 text-xs font-semibold outline-hidden cursor-pointer"
              >
                <option value="">-- Select Shelf Level --</option>
                {currentShelves.map(shelf => (
                  <option key={shelf.id} value={shelf.id}>{shelf.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* 3. Rack (Only for drawers, boxes, or samples) */}
          {selectedShelf && (itemType === "drawer" || itemType === "box" || itemType === "sample") && (
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 flex items-center gap-1">
                <Grid className="h-3 w-3" /> Rack {itemType === "drawer" ? "*" : "(Optional)"}
              </label>
              <select
                value={selectedRack}
                onChange={e => handleRackChange(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 text-xs font-semibold outline-hidden cursor-pointer"
              >
                <option value="">{itemType === "drawer" ? "-- Select Rack --" : "-- Direct in Shelf (No Rack) --"}</option>
                {currentRacks.map(rack => (
                  <option key={rack.id} value={rack.id}>{rack.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* 4. Drawer (Only for boxes or samples) */}
          {selectedRack && (itemType === "box" || itemType === "sample") && (
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 flex items-center gap-1">
                <Layers className="h-3 w-3" /> Drawer (Optional)
              </label>
              <select
                value={selectedDrawer}
                onChange={e => handleDrawerChange(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 text-xs font-semibold outline-hidden cursor-pointer"
              >
                <option value="">-- Direct in Rack (No Drawer) --</option>
                {currentDrawers.map(drawer => (
                  <option key={drawer.id} value={drawer.id}>{drawer.name}</option>
                ))}
              </select>
            </div>
          )}

          {itemType === "box" && selectedDrawer && (
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 flex items-center gap-1">
                <Grid className="h-3 w-3" /> Drawer Slot (Optional)
              </label>
              <select
                value={selectedDrawerSlot}
                onChange={e => setSelectedDrawerSlot(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 text-xs font-semibold outline-hidden cursor-pointer"
              >
                <option value="">-- Auto-assign slot --</option>
                {Array.from({ length: selectedDrawerCapacity }, (_, idx) => idx + 1).map(slotNum => (
                  <option key={slotNum} value={String(slotNum)}>Slot {slotNum}</option>
                ))}
              </select>
            </div>
          )}

          {/* 5. Box (Only for samples) */}
          {selectedShelf && itemType === "sample" && (
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 flex items-center gap-1">
                <Inbox className="h-3 w-3" /> Box (Optional)
              </label>
              <select
                value={selectedBox}
                onChange={e => handleBoxChange(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 text-xs font-semibold outline-hidden cursor-pointer"
              >
                <option value="">-- Direct on Shelf / Drawer (No Box) --</option>
                {currentBoxes.map(box => (
                  <option key={box.id} value={box.id}>{box.name} ({box.rows && box.cols ? `${box.rows}x${box.cols} grid` : "free-form"})</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-5 border-t border-slate-100 bg-slate-50 rounded-b-xl">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-slate-200 hover:bg-slate-100 text-xs font-bold text-slate-700 rounded-lg cursor-pointer transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-xs font-bold text-white rounded-lg shadow-sm cursor-pointer transition-all flex items-center gap-1"
          >
            Confirm Move
          </button>
        </div>
      </div>
    </div>
  );
}
