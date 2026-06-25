import React, { useState, useEffect } from "react";
import { Sample, StorageUnit, Shelf, Box, Rack, Drawer } from "../types.js";
import { ALL_CSV_HEADERS, HEADER_TO_FIELD_MAP, getFieldLabel } from "../utils.js";
import { X, Save, Layers } from "lucide-react";

interface SampleFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (sample: Sample) => void;
  sample: Sample | null; // Null means create new
  storageUnits: StorageUnit[];
  shelves: Shelf[];
  racks: Rack[];
  drawers: Drawer[];
  boxes: Box[];
  allSamples: Sample[];
  defaultStorageId?: string;
  defaultShelfId?: string;
  defaultRackId?: string | null;
  defaultDrawerId?: string | null;
  defaultBoxId?: string | null;
  defaultRow?: number | null;
  defaultCol?: number | null;
}

export default function SampleFormModal({
  isOpen,
  onClose,
  onSave,
  sample,
  storageUnits,
  shelves,
  racks,
  drawers,
  boxes,
  allSamples,
  defaultStorageId,
  defaultShelfId,
  defaultRackId,
  defaultDrawerId,
  defaultBoxId,
  defaultRow,
  defaultCol
}: SampleFormModalProps) {
  const [activeTab, setActiveTab] = useState<"basic" | "metadata">("basic");
  const [formData, setFormData] = useState<Partial<Sample>>({});
  const [selectedStorage, setSelectedStorage] = useState<string>("");
  const [selectedShelf, setSelectedShelf] = useState<string>("");
  const [selectedRack, setSelectedRack] = useState<string>("");
  const [selectedDrawer, setSelectedDrawer] = useState<string>("");
  const [selectedBox, setSelectedBox] = useState<string>("");
  const [validationError, setValidationError] = useState<string>("");

  // Initialize form
  useEffect(() => {
    if (sample) {
      setFormData({ ...sample });
      setSelectedStorage(sample.storageId || "");
      setSelectedShelf(sample.shelfId || "");
      setSelectedRack(sample.rackId || "");
      setSelectedDrawer(sample.drawerId || "");
      setSelectedBox(sample.boxId || "direct");
    } else {
      const now = new Date().toISOString();
      const initial: Partial<Sample> = {
        qty: 1,
        units: "vials",
        chemicalName: "",
        casNumber: "",
        itemType: "Sample",
        notes: "",
        chemicalId: "",
        lab: "Lab Main",
        phase: "",
        room: "",
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
        rackId: "",
        rackName: "",
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
      
      // Apply defaults from context
      if (defaultStorageId) initial.storageId = defaultStorageId;
      if (defaultShelfId) initial.shelfId = defaultShelfId;
      if (defaultRackId) initial.rackId = defaultRackId;
      if (defaultDrawerId) initial.drawerId = defaultDrawerId;
      initial.boxId = defaultBoxId === undefined ? null : defaultBoxId;
      if (defaultRow) initial.row = defaultRow;
      if (defaultCol) initial.col = defaultCol;

      setFormData(initial);
      setSelectedStorage(defaultStorageId || (storageUnits[0]?.id || ""));
      setSelectedShelf(defaultShelfId || "");
      setSelectedRack(defaultRackId || "");
      setSelectedDrawer(defaultDrawerId || "");
      setSelectedBox(defaultBoxId || "direct");
    }
    setValidationError("");
  }, [sample, isOpen, defaultStorageId, defaultShelfId, defaultRackId, defaultDrawerId, defaultBoxId, defaultRow, defaultCol]);

  // Handle storage selection changes
  useEffect(() => {
    if (!sample && selectedStorage) {
      // Auto select first shelf of this storage
      const validShelves = shelves.filter(s => s.storageId === selectedStorage && !s.isArchived);
      if (validShelves.length > 0 && (!selectedShelf || !validShelves.some(vs => vs.id === selectedShelf))) {
        setSelectedShelf(validShelves[0].id);
        setSelectedRack("");
        setSelectedDrawer("");
        setSelectedBox("direct");
      }
    }
  }, [selectedStorage, shelves, sample]);

  // Handle shelf selection changes
  useEffect(() => {
    if (!sample && selectedShelf) {
      const validRacks = racks.filter(r => r.shelfId === selectedShelf && !r.isArchived);
      if (validRacks.length > 0 && (!selectedRack || !validRacks.some(vr => vr.id === selectedRack))) {
        // We can leave selectedRack empty if they want no rack, or auto select if preferred.
        // Let's keep it optional, so we don't force select.
      } else if (validRacks.length === 0) {
        setSelectedRack("");
      }
    }
  }, [selectedShelf, racks, sample]);

  // Handle rack selection changes
  useEffect(() => {
    if (!sample && selectedRack) {
      const validDrawers = drawers.filter(d => d.rackId === selectedRack && !d.isArchived);
      if (validDrawers.length > 0 && (!selectedDrawer || !validDrawers.some(vd => vd.id === selectedDrawer))) {
        // Optional drawer
      } else if (validDrawers.length === 0) {
        setSelectedDrawer("");
      }
    } else if (!selectedRack) {
      setSelectedDrawer("");
    }
  }, [selectedRack, drawers, sample]);

  if (!isOpen) return null;

  const currentShelves = shelves.filter(s => s.storageId === selectedStorage && !s.isArchived);
  const currentRacks = racks.filter(r => r.shelfId === selectedShelf && !r.isArchived);
  const currentDrawers = drawers.filter(d => d.rackId === selectedRack && !d.isArchived);

  // Filter boxes strictly matching the selection hierarchy:
  // - If Drawer is selected: boxes inside that Drawer
  // - If Rack is selected (and no Drawer): boxes inside that Rack with no drawer
  // - If Shelf is selected (no Rack): boxes directly on Shelf with no rack
  const currentBoxes = boxes.filter(b => {
    if (b.isArchived) return false;
    if (b.shelfId !== selectedShelf) return false;
    
    if (selectedRack) {
      if (b.rackId !== selectedRack) return false;
      if (selectedDrawer) {
        return b.drawerId === selectedDrawer;
      } else {
        return !b.drawerId;
      }
    } else {
      return !b.rackId;
    }
  });

  const currentBoxDetail = boxes.find(b => b.id === selectedBox);

  // Field change handler
  const handleFieldChange = (field: keyof Sample, val: any) => {
    setFormData(prev => ({ ...prev, [field]: val }));
  };

  const handleSave = () => {
    if (!formData.chemicalName?.trim()) {
      setValidationError("Chemical Name is required.");
      return;
    }
    if (!selectedStorage) {
      setValidationError("Please select a Storage unit (freezer, fridge, or room temp shelf).");
      return;
    }
    if (!selectedShelf) {
      setValidationError("Please select a Shelf.");
      return;
    }

    const finalBoxId = selectedBox === "direct" ? null : selectedBox;
    const finalBox = boxes.find(b => b.id === finalBoxId);
    
    let rowVal: number | null = null;
    let colVal: number | null = null;

    if (finalBox && finalBox.rows && finalBox.cols) {
      rowVal = Number(formData.row);
      colVal = Number(formData.col);

      if (isNaN(rowVal) || rowVal < 1 || rowVal > finalBox.rows) {
        setValidationError(`Row must be a number between 1 and ${finalBox.rows} for grid container.`);
        return;
      }
      if (isNaN(colVal) || colVal < 1 || colVal > finalBox.cols) {
        setValidationError(`Column must be a number between 1 and ${finalBox.cols} for grid container.`);
        return;
      }

      // Check collision with existing samples
      const collision = allSamples.find(s => 
        !s.isArchived &&
        s.id !== sample?.id &&
        s.boxId === finalBoxId &&
        s.row === rowVal &&
        s.col === colVal
      );

      if (collision) {
        setValidationError(`Position Row ${rowVal}, Col ${colVal} is already occupied by "${collision.chemicalName}".`);
        return;
      }
    }

    const savedSample: Sample = {
      ...(formData as Sample),
      id: sample?.id || `sample-${Date.now()}`,
      storageId: selectedStorage,
      shelfId: selectedShelf,
      rackId: selectedRack || null,
      drawerId: selectedDrawer || null,
      boxId: finalBoxId,
      row: rowVal,
      col: colVal,
      qty: Number(formData.qty) || 1,
      chemicalName: formData.chemicalName.trim(),
      casNumber: formData.casNumber?.trim() || "",
      itemType: formData.itemType?.trim() || "Sample"
    };

    onSave(savedSample);
  };

  // Get advanced fields (excluding keys already editable in the basic panel)
  const basicFields: (keyof Sample)[] = [
    "chemicalName", "casNumber", "qty", "units", "itemType", "notes", "row", "col"
  ];
  const advancedFields = ALL_CSV_HEADERS
    .map(h => HEADER_TO_FIELD_MAP[h.toLowerCase().replace(/[^a-z0-9]/g, "")] as keyof Sample)
    .filter(field => field && !basicFields.includes(field));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div id="sample-modal" className="w-full max-w-3xl bg-white rounded-xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden border border-slate-100 animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-slate-50">
          <div className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-indigo-600" />
            <h3 className="text-lg font-semibold text-slate-900">
              {sample ? "Edit Sample Info" : "Add New Sample/Item"}
            </h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tab Selection */}
        <div className="flex border-b border-slate-100 bg-slate-50/50 px-5">
          <button
            onClick={() => setActiveTab("basic")}
            className={`py-3 px-4 text-sm font-medium border-b-2 transition-all ${
              activeTab === "basic"
                ? "border-indigo-600 text-indigo-600"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            Essential Details
          </button>
          <button
            onClick={() => setActiveTab("metadata")}
            className={`py-3 px-4 text-sm font-medium border-b-2 transition-all ${
              activeTab === "metadata"
                ? "border-indigo-600 text-indigo-600"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            All Spreadsheet Metadata
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {validationError && (
            <div className="p-3.5 bg-red-50 text-red-700 text-sm font-medium rounded-lg border border-red-100">
              {validationError}
            </div>
          )}

          {activeTab === "basic" ? (
            <div className="space-y-5">
              {/* Core Information */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Chemical / Sample Name *
                  </label>
                  <input
                    type="text"
                    value={formData.chemicalName || ""}
                    onChange={e => handleFieldChange("chemicalName", e.target.value)}
                    placeholder="e.g. Sodium Bicarbonate, pUC19 stock"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm outline-hidden bg-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    CAS Number
                  </label>
                  <input
                    type="text"
                    value={formData.casNumber || ""}
                    onChange={e => handleFieldChange("casNumber", e.target.value)}
                    placeholder="e.g. 144-55-8"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm outline-hidden bg-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Item / Sample Type
                  </label>
                  <input
                    type="text"
                    value={formData.itemType || ""}
                    onChange={e => handleFieldChange("itemType", e.target.value)}
                    placeholder="e.g. Chemical, Plasmid, Primer, Tissue"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm outline-hidden bg-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Quantity
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={formData.qty ?? 1}
                    onChange={e => handleFieldChange("qty", e.target.value === "" ? "" : Number(e.target.value))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm outline-hidden bg-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Units
                  </label>
                  <input
                    type="text"
                    value={formData.units || ""}
                    onChange={e => handleFieldChange("units", e.target.value)}
                    placeholder="e.g. vials, bottles, mg, mL"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm outline-hidden bg-white"
                  />
                </div>
              </div>

              <hr className="border-slate-100" />

              {/* Physical Locations */}
              <div className="space-y-4">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                  Storage Location
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      Refrigerator / Freezer *
                    </label>
                    <select
                      value={selectedStorage}
                      onChange={e => {
                        setSelectedStorage(e.target.value);
                        setSelectedShelf("");
                        setSelectedRack("");
                        setSelectedDrawer("");
                        setSelectedBox("direct");
                      }}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white text-sm focus:ring-2 focus:ring-indigo-500 outline-hidden"
                    >
                      <option value="">-- Select Unit --</option>
                      {storageUnits.filter(u => !u.isArchived).map(unit => (
                        <option key={unit.id} value={unit.id}>
                          {unit.name} ({unit.type === 'freezer' ? '-80°C / -20°C' : unit.type === 'refrigerator' ? '4°C' : 'Room Temp'})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      Shelf / Level *
                    </label>
                    <select
                      value={selectedShelf}
                      onChange={e => {
                        setSelectedShelf(e.target.value);
                        setSelectedRack("");
                        setSelectedDrawer("");
                        setSelectedBox("direct");
                      }}
                      disabled={!selectedStorage}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white text-sm focus:ring-2 focus:ring-indigo-500 outline-hidden disabled:opacity-60"
                    >
                      <option value="">-- Select Shelf --</option>
                      {currentShelves.map(s => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      Rack (Optional)
                    </label>
                    <select
                      value={selectedRack}
                      onChange={e => {
                        setSelectedRack(e.target.value);
                        setSelectedDrawer("");
                        setSelectedBox("direct");
                      }}
                      disabled={!selectedShelf}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white text-sm focus:ring-2 focus:ring-indigo-500 outline-hidden disabled:opacity-60"
                    >
                      <option value="">No Rack / Direct on Shelf</option>
                      {currentRacks.map(r => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      Drawer (Optional)
                    </label>
                    <select
                      value={selectedDrawer}
                      onChange={e => {
                        setSelectedDrawer(e.target.value);
                        setSelectedBox("direct");
                      }}
                      disabled={!selectedRack}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white text-sm focus:ring-2 focus:ring-indigo-500 outline-hidden disabled:opacity-60"
                    >
                      <option value="">No Drawer / Direct in Rack</option>
                      {currentDrawers.map(d => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      Box / Container
                    </label>
                    <select
                      value={selectedBox}
                      onChange={e => setSelectedBox(e.target.value)}
                      disabled={!selectedShelf}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white text-sm focus:ring-2 focus:ring-indigo-500 outline-hidden disabled:opacity-60"
                    >
                      <option value="direct">Directly in container (No Box)</option>
                      {currentBoxes.map(b => (
                        <option key={b.id} value={b.id}>
                          {b.name} {b.rows ? `(${b.rows}x${b.cols} grid)` : "(free-form)"}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Grid Location coordinates */}
              {currentBoxDetail && currentBoxDetail.rows && currentBoxDetail.cols && (
                <div className="p-4 bg-indigo-50/50 rounded-lg border border-indigo-100/50">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="h-2 w-2 rounded-full bg-indigo-600 animate-pulse"></span>
                    <h5 className="text-xs font-bold text-indigo-900 uppercase tracking-wider">
                      Grid Coordinate Mapping ({currentBoxDetail.name})
                    </h5>
                  </div>
                  <p className="text-xs text-indigo-700/80 mb-3">
                    This box is organized as a {currentBoxDetail.rows} rows by {currentBoxDetail.cols} columns coordinate layout.
                  </p>
                  <div className="grid grid-cols-2 gap-4 max-w-md">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Row (1 to {currentBoxDetail.rows}) *
                      </label>
                      <input
                        type="number"
                        min="1"
                        max={currentBoxDetail.rows}
                        value={formData.row || ""}
                        onChange={e => handleFieldChange("row", e.target.value === "" ? "" : Number(e.target.value))}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-500 outline-hidden"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Column (1 to {currentBoxDetail.cols}) *
                      </label>
                      <input
                        type="number"
                        min="1"
                        max={currentBoxDetail.cols}
                        value={formData.col || ""}
                        onChange={e => handleFieldChange("col", e.target.value === "" ? "" : Number(e.target.value))}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-500 outline-hidden"
                      />
                    </div>
                  </div>
                </div>
              )}

              <hr className="border-slate-100" />

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  General Notes
                </label>
                <textarea
                  rows={3}
                  value={formData.notes || ""}
                  onChange={e => handleFieldChange("notes", e.target.value)}
                  placeholder="Additional observations, prep notes, safety details..."
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm outline-hidden bg-white"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-xs text-slate-500 italic bg-slate-50 p-3 rounded-lg border border-slate-100">
                These advanced metadata fields capture data imported from or exported to inventory spreadsheets. They can be freely updated here.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {advancedFields.map((field) => {
                  const label = getFieldLabel(field);
                  return (
                    <div key={field}>
                      <label className="block text-xs font-semibold text-slate-600 mb-1 truncate title-label">
                        {label}
                      </label>
                      <input
                        type="text"
                        value={String(formData[field] || "")}
                        onChange={e => handleFieldChange(field, e.target.value)}
                        placeholder={`Optional ${label}`}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm outline-hidden bg-white"
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-100 hover:border-slate-300 transition-colors bg-white"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 rounded-lg text-sm font-medium text-white shadow-md hover:shadow-lg transition-all flex items-center gap-1.5"
          >
            <Save className="h-4 w-4" />
            Save Sample
          </button>
        </div>
      </div>
    </div>
  );
}
