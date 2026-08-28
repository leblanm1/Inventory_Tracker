import React, { useState, useEffect, useMemo, useRef } from "react";
import { 
  Plus, 
  Search, 
  FileSpreadsheet, 
  Download, 
  Upload, 
  Database, 
  Trash2, 
  RefreshCw, 
  Edit2, 
  MapPin, 
  Layers, 
  Box as BoxIcon, 
  ArrowRight, 
  User, 
  Check, 
  X, 
  Server, 
  Grid, 
  Archive, 
  Inbox, 
  HelpCircle,
  FileText,
  Move,
  ChevronDown,
  ChevronRight,
  QrCode,
  ScanLine,
  Menu,
  PanelRightClose,
  PanelRightOpen
} from "lucide-react";
import { StorageUnit, Shelf, Box, Sample, AuditLog, InventoryState, Rack, Drawer, AuditSnapshot } from "./types.js";
import { convertInventoryToCSV, syncSamplesToBoxLocation } from "./utils.js";
import { initAuth, authFetch } from "./auth.js";
import { getExpiryStatus, getExpiryColorClass, getExpiryBadgeClass, getExpiryLabel, getDaysUntilExpiry, isLowStock, getGHSPictograms, GHS_PICTOGRAM_SYMBOLS, GHS_PICTOGRAM_LABELS, checkCompatibility, isIncompatible } from "./labUtils.js";
import Fuse from "fuse.js";
import SampleFormModal from "./components/SampleFormModal.jsx";
import StorageFormModal from "./components/StorageFormModal.jsx";
import BulkImportPanel from "./components/BulkImportPanel.jsx";
import BulkRenamePanel from "./components/BulkRenamePanel.jsx";
import BulkMoveModal from "./components/BulkMoveModal.jsx";
import DashboardPanels from "./components/DashboardPanels.jsx";
import SampleInspector from "./components/SampleInspector.jsx";
import AuditTrailModal from "./components/AuditTrailModal.jsx";
import { generateAllBoxQRLabels, printQRLabels } from "./qrUtils.js";

const DEFAULT_USERS = [
  "Dr. Aris (Lab Director)",
  "Sarah Lin (PhD Candidate)",
  "James Miller (Postdoc)",
  "Lab Assistant Bot"
];

const CURRENT_USER_STORAGE_KEY = "inventory-current-user";
const NAV_PATH_STORAGE_KEY = "inventory-nav-path";

type StoredNavPath = {
  storageId: string;
  shelfId: string;
  rackId: string;
  drawerId: string;
  boxId: string | null;
};

function readStoredNavPath(): StoredNavPath {
  if (typeof window === "undefined") {
    return { storageId: "", shelfId: "", rackId: "", drawerId: "", boxId: null };
  }

  try {
    const raw = window.localStorage.getItem(NAV_PATH_STORAGE_KEY);
    if (!raw) {
      return { storageId: "", shelfId: "", rackId: "", drawerId: "", boxId: null };
    }

    const parsed = JSON.parse(raw) as Partial<StoredNavPath>;
    return {
      storageId: typeof parsed.storageId === "string" ? parsed.storageId : "",
      shelfId: typeof parsed.shelfId === "string" ? parsed.shelfId : "",
      rackId: typeof parsed.rackId === "string" ? parsed.rackId : "",
      drawerId: typeof parsed.drawerId === "string" ? parsed.drawerId : "",
      boxId: typeof parsed.boxId === "string" ? parsed.boxId : null,
    };
  } catch {
    return { storageId: "", shelfId: "", rackId: "", drawerId: "", boxId: null };
  }
}

export default function App() {
  const initialNavPath = readStoredNavPath();
  const storageTypeOrder: Record<StorageUnit["type"], number> = {
    freezer: 0,
    refrigerator: 1,
    room_temp: 2,
  };

  // State from server
  const [state, setState] = useState<InventoryState>({
    version: 0,
    users: DEFAULT_USERS,
    storageUnits: [],
    shelves: [],
    racks: [],
    drawers: [],
    boxes: [],
    samples: [],
    auditLogs: [],
    auditSnapshots: []
  });

  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchPanelOpen, setSearchPanelOpen] = useState(false);
  const [searchDetailOpen, setSearchDetailOpen] = useState(false);
  const [searchKindFilters, setSearchKindFilters] = useState<Array<SearchResult["kind"]>>([
    "sample",
    "storage",
    "shelf",
    "rack",
    "drawer",
    "box"
  ]);
  const [searchDateFrom, setSearchDateFrom] = useState("");
  const [searchDateTo, setSearchDateTo] = useState("");
  const [searchSortMode, setSearchSortMode] = useState<"relevance" | "newest" | "oldest">("relevance");
  const [currentUser, setCurrentUser] = useState(() => {
    if (typeof window === "undefined") return DEFAULT_USERS[0];
    return window.localStorage.getItem(CURRENT_USER_STORAGE_KEY) || DEFAULT_USERS[0];
  });

  // Active navigation/selection paths
  const [selectedStorageId, setSelectedStorageId] = useState<string>(initialNavPath.storageId);
  const [selectedShelfId, setSelectedShelfId] = useState<string>(initialNavPath.shelfId);
  const [selectedRackId, setSelectedRackId] = useState<string>(initialNavPath.rackId);
  const [selectedDrawerId, setSelectedDrawerId] = useState<string>(initialNavPath.drawerId);
  const [selectedBoxId, setSelectedBoxId] = useState<string | null>(initialNavPath.boxId);

  // Inspector and modal triggers
  const [selectedSampleId, setSelectedSampleId] = useState<string | null>(null);
  const [selectedGridSampleIds, setSelectedGridSampleIds] = useState<string[]>([]);
  const [gridSelectionAnchorId, setGridSelectionAnchorId] = useState<string | null>(null);
  const [showTrash, setShowTrash] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [showBulkRename, setShowBulkRename] = useState(false);
  const [showAuditTrailModal, setShowAuditTrailModal] = useState(false);
  const [scanInput, setScanInput] = useState("");
  const [isGeneratingQR, setIsGeneratingQR] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.innerWidth >= 1280;
  });
  const [auditSearch, setAuditSearch] = useState("");
  const backupRestoreInputRef = useRef<HTMLInputElement | null>(null);

  // Bulk selection/actions
  const [bulkSelectOpen, setBulkSelectOpen] = useState(false);
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  const [bulkItemType, setBulkItemType] = useState<"sample" | "box" | "drawer" | "rack">("sample");
  const [bulkSelectedIds, setBulkSelectedIds] = useState<string[]>([]);

  // Form Modals
  const [sampleModalOpen, setSampleModalOpen] = useState(false);
  const [editingSample, setEditingSample] = useState<Sample | null>(null);
  const [sampleDefaultRow, setSampleDefaultRow] = useState<number | null>(null);
  const [sampleDefaultCol, setSampleDefaultCol] = useState<number | null>(null);

  const [storageModalOpen, setStorageModalOpen] = useState(false);
  const [storageModalMode, setStorageModalMode] = useState<"storage" | "shelf" | "rack" | "drawer" | "box">("storage");
  const [editingStorageItem, setEditingStorageItem] = useState<StorageUnit | Shelf | Rack | Drawer | Box | null>(null);
  const [boxDefaultDrawerSlot, setBoxDefaultDrawerSlot] = useState<number | null>(null);

  // Drag and drop visual cues
  const [draggedSampleId, setDraggedSampleId] = useState<string | null>(null);
  const [dragOverCell, setDragOverCell] = useState<{ row: number; col: number } | null>(null);
  const [dragOverShelfId, setDragOverShelfId] = useState<string | null>(null);
  const [dragOverRackId, setDragOverRackId] = useState<string | null>(null);
  const [dragOverDrawerId, setDragOverDrawerId] = useState<string | null>(null);
  const [draggedBoxId, setDraggedBoxId] = useState<string | null>(null);
  const [dragOverBoxId, setDragOverBoxId] = useState<string | null>(null);
  const [dragOverDrawerSlot, setDragOverDrawerSlot] = useState<number | null>(null);
  const [draggingHierarchyItem, setDraggingHierarchyItem] = useState<{
    type: "shelf" | "rack" | "drawer";
    id: string;
    parentId: string;
  } | null>(null);
  const [dragOverHierarchyItem, setDragOverHierarchyItem] = useState<{
    type: "shelf" | "rack" | "drawer";
    id: string;
    parentId: string;
  } | null>(null);

  // View Modes & Collapse States for Loose / Direct Items
  const [structureMinimized, setStructureMinimized] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [listFilter, setListFilter] = useState<"all" | "loose">("all");
  const [expiryFilter, setExpiryFilter] = useState<"none" | "expired" | "expiring" | "lowstock">("none");
  const [sortField, setSortField] = useState<"chemicalName" | "casNumber" | "qty" | "itemType" | "location" | "expiresOn">("chemicalName");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [collapsedStorageTypes, setCollapsedStorageTypes] = useState<Record<StorageUnit["type"], boolean>>({
    freezer: false,
    refrigerator: false,
    room_temp: false,
  });

  const sortedActiveStorageUnits = useMemo(() => {
    return state.storageUnits
      .filter(unit => !unit.isArchived)
      .sort((a, b) => {
        const typeDiff = storageTypeOrder[a.type] - storageTypeOrder[b.type];
        if (typeDiff !== 0) return typeDiff;
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
      });
  }, [state.storageUnits]);

  const groupedSidebarStorageUnits = useMemo(() => {
    const sectionDefs: { type: StorageUnit["type"]; label: string }[] = [
      { type: "freezer", label: "Freezers" },
      { type: "refrigerator", label: "Refrigerators" },
      { type: "room_temp", label: "Room Temperature" },
    ];

    return sectionDefs
      .map(section => ({
        ...section,
        units: sortedActiveStorageUnits.filter(unit => unit.type === section.type),
      }))
      .filter(section => section.units.length > 0);
  }, [sortedActiveStorageUnits]);

  // Format full physical storage location string for a sample
  const getSampleLocationPath = (sample: Sample) => {
    const parts: string[] = [];
    if (sample.storageId) {
      const storage = state.storageUnits.find(s => s.id === sample.storageId);
      if (storage) parts.push(storage.name);
    }
    if (sample.shelfId) {
      const shelf = state.shelves.find(s => s.id === sample.shelfId);
      if (shelf) parts.push(shelf.name);
    }
    if (sample.rackId) {
      const rack = state.racks.find(r => r.id === sample.rackId);
      if (rack) parts.push(`Rack: ${rack.name}`);
    }
    if (sample.drawerId) {
      const drawer = state.drawers.find(d => d.id === sample.drawerId);
      if (drawer) parts.push(`Drawer: ${drawer.name}`);
    }
    if (sample.boxId) {
      const box = state.boxes.find(b => b.id === sample.boxId);
      if (box) {
        let boxStr = `Box: ${box.name}`;
        if (sample.row !== null && sample.col !== null) {
          const rowLetter = String.fromCharCode(65 + sample.row);
          const colNum = sample.col + 1;
          boxStr += ` (${rowLetter}${colNum})`;
        }
        parts.push(boxStr);
      }
    }
    return parts.join(" > ") || "Unassigned / Loose";
  };

  const getSampleConcentrationLabel = (sample: Sample) => {
    return sample.concentration?.trim() ? `Conc: ${sample.concentration}` : "Conc: -";
  };

  const getSampleVolumeLabel = (sample: Sample) => {
    return sample.volumeMass?.trim() ? `Vol: ${sample.volumeMass}` : "Vol: -";
  };



  // Quick Assignment of a sample to a target box or drawer
  const handleQuickAssignSample = (sampleId: string, destType: "box" | "drawer", destId: string) => {
    const sample = state.samples.find(s => s.id === sampleId);
    if (!sample) return;

    let updatedSample = { ...sample };

    if (destType === "drawer") {
      const drawer = state.drawers.find(d => d.id === destId);
      if (drawer) {
        const rack = state.racks.find(r => r.id === drawer.rackId);
        updatedSample.drawerId = drawer.id;
        updatedSample.rackId = drawer.rackId;
        updatedSample.shelfId = rack?.shelfId || sample.shelfId;
        updatedSample.storageId = rack?.storageId || sample.storageId;
        updatedSample.boxId = null;
        updatedSample.row = null;
        updatedSample.col = null;
      }
    } else if (destType === "box") {
      const box = state.boxes.find(b => b.id === destId);
      if (box) {
        updatedSample.boxId = box.id;
        updatedSample.drawerId = box.drawerId || null;
        updatedSample.rackId = box.rackId || null;
        updatedSample.shelfId = box.shelfId || sample.shelfId;
        updatedSample.storageId = box.storageId || sample.storageId;
        
        // Find first empty coordinate if grid-based box
        if (box.rows && box.cols) {
          const occupied = state.samples
            .filter(s => s.boxId === box.id && !s.isArchived)
            .reduce((acc, s) => {
              if (s.row !== null && s.col !== null) {
                acc[`${s.row}-${s.col}`] = true;
              }
              return acc;
            }, {} as Record<string, boolean>);
          
          let found = false;
          for (let r = 0; r < box.rows; r++) {
            for (let c = 0; c < box.cols; c++) {
              if (!occupied[`${r}-${c}`]) {
                updatedSample.row = r;
                updatedSample.col = c;
                found = true;
                break;
              }
            }
            if (found) break;
          }
          if (!found) {
            alert(`The box "${box.name}" is full!`);
            return;
          }
        } else {
          updatedSample.row = null;
          updatedSample.col = null;
        }
      }
    }

    const destName = destType === "box"
      ? state.boxes.find(b => b.id === destId)?.name || "box"
      : state.drawers.find(d => d.id === destId)?.name || "drawer";

    apiMutate(
      `/api/samples/${sampleId}`,
      "PATCH",
      {
        drawerId: updatedSample.drawerId,
        rackId: updatedSample.rackId,
        shelfId: updatedSample.shelfId,
        storageId: updatedSample.storageId,
        boxId: updatedSample.boxId,
        row: updatedSample.row,
        col: updatedSample.col
      },
      "Sample Relocated",
      `Assigned sample "${sample.chemicalName}" to ${destType} "${destName}" via quick assignment.`,
      { ...state, samples: state.samples.map(s => s.id === sampleId ? updatedSample : s) }
    );
  };

  // Auto-minimize structures when navigation changes to a level with loose samples
  useEffect(() => {
    if (selectedShelfId) {
      const hasLoose = state.samples.some(
        s => s.shelfId === selectedShelfId && !s.rackId && !s.drawerId && !s.boxId && !s.isArchived
      );
      setStructureMinimized(hasLoose);
    } else if (selectedStorageId) {
      const hasLoose = state.samples.some(
        s => s.storageId === selectedStorageId && !s.shelfId && !s.rackId && !s.drawerId && !s.boxId && !s.isArchived
      );
      setStructureMinimized(hasLoose);
    } else {
      setStructureMinimized(false);
    }
  }, [selectedShelfId, selectedStorageId, state.samples]);

  // Helper functions to get sample counts at different levels of the storage hierarchy
  const getStorageSamplesCount = (storageId: string) => {
    return state.samples.filter(s => s.storageId === storageId && !s.isArchived).length;
  };
  const getShelfSamplesCount = (shelfId: string) => {
    return state.samples.filter(s => s.shelfId === shelfId && !s.isArchived).length;
  };
  const getRackSamplesCount = (rackId: string) => {
    return state.samples.filter(s => s.rackId === rackId && !s.isArchived).length;
  };
  const getDrawerSamplesCount = (drawerId: string) => {
    return state.samples.filter(s => s.drawerId === drawerId && !s.isArchived).length;
  };
  const getDrawerCapacity = (drawer?: Drawer | null) => {
    return Math.max(1, Math.min(500, Number(drawer?.boxCapacity) || 4));
  };
  const getBoxSamplesCount = (boxId: string) => {
    return state.samples.filter(s => s.boxId === boxId && !s.isArchived).length;
  };

  const readDragPayload = (e: React.DragEvent): { type: "rack" | "drawer" | "box" | "sample"; id: string } | null => {
    const dragDataStr = e.dataTransfer.getData("text/plain");
    if (!dragDataStr) return null;

    try {
      return JSON.parse(dragDataStr);
    } catch {
      return dragDataStr.length > 0 ? { type: "sample", id: dragDataStr } : null;
    }
  };

  const clearBoxDragState = () => {
    setDraggedBoxId(null);
    setDragOverBoxId(null);
    setDragOverDrawerSlot(null);
  };

  const getDrawerBoxesSortedBySlot = (drawerId: string) => {
    return state.boxes
      .filter(b => b.drawerId === drawerId && !b.isArchived)
      .sort((a, b) => {
        const aSlot = typeof a.drawerSlot === "number" ? a.drawerSlot : Number.MAX_SAFE_INTEGER;
        const bSlot = typeof b.drawerSlot === "number" ? b.drawerSlot : Number.MAX_SAFE_INTEGER;
        if (aSlot !== bSlot) return aSlot - bSlot;
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
      });
  };

  const handleDropReorderBoxesInDrawer = async (targetBoxId: string, drawerId: string) => {
    if (!draggedBoxId || draggedBoxId === targetBoxId) {
      clearBoxDragState();
      return;
    }

    const drawer = state.drawers.find(d => d.id === drawerId && !d.isArchived);
    if (!drawer) {
      clearBoxDragState();
      return;
    }

    const orderedBoxes = getDrawerBoxesSortedBySlot(drawerId);
    const fromIndex = orderedBoxes.findIndex(b => b.id === draggedBoxId);
    const toIndex = orderedBoxes.findIndex(b => b.id === targetBoxId);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
      clearBoxDragState();
      return;
    }

    const reordered = [...orderedBoxes];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);

    const slotById = new Map<string, number>();
    reordered.forEach((box, index) => {
      slotById.set(box.id, index + 1);
    });

    const updatedBoxes = state.boxes.map(box => {
      const newSlot = slotById.get(box.id);
      if (box.drawerId === drawerId && newSlot) {
        return { ...box, drawerSlot: newSlot };
      }
      return box;
    });

    clearBoxDragState();

    await saveStateToServer(
      { ...state, boxes: updatedBoxes },
      "Drawer Boxes Reordered",
      `Reordered boxes in drawer "${drawer.name}".`
    );
  };

  const handleDropBoxOnDrawerSlot = async (e: React.DragEvent, drawerId: string, slotNum: number) => {
    e.preventDefault();
    e.stopPropagation();

    const dragPayload = readDragPayload(e);
    const incomingBoxId = dragPayload?.type === "box" ? dragPayload.id : draggedBoxId;
    if (!incomingBoxId) {
      clearBoxDragState();
      return;
    }

    const draggedBox = state.boxes.find(b => b.id === incomingBoxId && !b.isArchived);
    const targetDrawer = state.drawers.find(d => d.id === drawerId && !d.isArchived);
    if (!draggedBox || !targetDrawer) {
      clearBoxDragState();
      return;
    }

    const existingInSlot = state.boxes.find(
      b =>
        !b.isArchived &&
        b.drawerId === drawerId &&
        typeof b.drawerSlot === "number" &&
        b.drawerSlot === slotNum
    );

    if (existingInSlot?.id === draggedBox.id) {
      clearBoxDragState();
      return;
    }

    const drawerCapacity = getDrawerCapacity(targetDrawer);
    const boxesInDrawer = state.boxes.filter(b => !b.isArchived && b.drawerId === drawerId);
    const movingIntoDrawer = draggedBox.drawerId !== drawerId;

    if (movingIntoDrawer && !existingInSlot && boxesInDrawer.length >= drawerCapacity) {
      alert(`Drawer "${targetDrawer.name}" is full (${drawerCapacity} slots).`);
      clearBoxDragState();
      return;
    }

    if (movingIntoDrawer && existingInSlot) {
      alert("Target slot is occupied. Choose an empty slot or reorder boxes within the same drawer.");
      clearBoxDragState();
      return;
    }

    const draggedOldSlot = typeof draggedBox.drawerSlot === "number" ? draggedBox.drawerSlot : null;

    const updatedBoxes = state.boxes.map(box => {
      if (box.id === draggedBox.id) {
        return {
          ...box,
          drawerId: targetDrawer.id,
          rackId: targetDrawer.rackId,
          shelfId: targetDrawer.shelfId,
          storageId: targetDrawer.storageId,
          drawerSlot: slotNum,
          shelfCol: null
        };
      }

      if (existingInSlot && box.id === existingInSlot.id && draggedBox.drawerId === drawerId) {
        return {
          ...box,
          drawerSlot: draggedOldSlot
        };
      }

      return box;
    });

    const updatedSamples = state.samples.map(sample => {
      if (sample.boxId !== draggedBox.id) return sample;
      return {
        ...sample,
        drawerId: targetDrawer.id,
        rackId: targetDrawer.rackId,
        shelfId: targetDrawer.shelfId,
        storageId: targetDrawer.storageId
      };
    });

    clearBoxDragState();

    const actionName = movingIntoDrawer ? "Box Moved to Drawer Slot" : "Drawer Slot Updated";
    const actionDesc = movingIntoDrawer
      ? `Moved box "${draggedBox.name}" into drawer "${targetDrawer.name}" slot ${slotNum}.`
      : existingInSlot
      ? `Swapped box "${draggedBox.name}" with "${existingInSlot.name}" in drawer "${targetDrawer.name}".`
      : `Moved box "${draggedBox.name}" to slot ${slotNum} in drawer "${targetDrawer.name}".`;

    await saveStateToServer(
      { ...state, boxes: updatedBoxes, samples: updatedSamples },
      actionName,
      actionDesc
    );
  };

  const handleUnassignBoxFromSlot = async (boxId: string) => {
    const box = state.boxes.find(b => b.id === boxId && !b.isArchived);
    if (!box || !box.drawerId) return;

    const drawer = state.drawers.find(d => d.id === box.drawerId && !d.isArchived);
    const updatedBoxes = state.boxes.map(b => b.id === boxId ? { ...b, drawerSlot: null } : b);

    await saveStateToServer(
      { ...state, boxes: updatedBoxes },
      "Drawer Slot Cleared",
      `Removed box "${box.name}" from its assigned slot in drawer "${drawer?.name || "Unknown Drawer"}".`
    );
  };

  function reorderActiveItemsWithinParent<T extends { id: string; isArchived?: boolean }>(
    items: T[],
    parentPredicate: (item: T) => boolean,
    draggedId: string,
    targetId: string
  ): T[] {
    if (!draggedId || !targetId || draggedId === targetId) {
      return items;
    }

    const activeGroupIndexes: number[] = [];
    const activeGroupItems: T[] = [];

    items.forEach((item, index) => {
      if (parentPredicate(item) && !item.isArchived) {
        activeGroupIndexes.push(index);
        activeGroupItems.push(item);
      }
    });

    const fromIndex = activeGroupItems.findIndex(item => item.id === draggedId);
    const toIndex = activeGroupItems.findIndex(item => item.id === targetId);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
      return items;
    }

    const reordered = [...activeGroupItems];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);

    const nextItems = [...items];
    activeGroupIndexes.forEach((itemIndex, groupIndex) => {
      nextItems[itemIndex] = reordered[groupIndex];
    });

    return nextItems;
  }

  const clearHierarchyDragState = () => {
    setDraggingHierarchyItem(null);
    setDragOverHierarchyItem(null);
  };

  const isHierarchyDropAllowed = (
    type: "shelf" | "rack" | "drawer",
    id: string,
    parentId: string
  ) => {
    return Boolean(
      draggingHierarchyItem &&
      draggingHierarchyItem.type === type &&
      draggingHierarchyItem.parentId === parentId &&
      draggingHierarchyItem.id !== id
    );
  };

  const handleDropReorderShelf = async (targetShelfId: string, storageId: string) => {
    if (!isHierarchyDropAllowed("shelf", targetShelfId, storageId) || !draggingHierarchyItem) {
      clearHierarchyDragState();
      return;
    }

    const updatedShelves = reorderActiveItemsWithinParent<Shelf>(
      state.shelves,
      shelf => shelf.storageId === storageId,
      draggingHierarchyItem.id,
      targetShelfId
    );

    clearHierarchyDragState();

    if (updatedShelves === state.shelves) return;

    const storageName = state.storageUnits.find(unit => unit.id === storageId)?.name || "storage unit";
    await saveStateToServer(
      { ...state, shelves: updatedShelves },
      "Shelves Reordered",
      `Reordered shelves within ${storageName}.`
    );
  };

  const handleDropReorderRack = async (targetRackId: string, shelfId: string) => {
    if (!isHierarchyDropAllowed("rack", targetRackId, shelfId) || !draggingHierarchyItem) {
      clearHierarchyDragState();
      return;
    }

    const updatedRacks = reorderActiveItemsWithinParent<Rack>(
      state.racks,
      rack => rack.shelfId === shelfId,
      draggingHierarchyItem.id,
      targetRackId
    );

    clearHierarchyDragState();

    if (updatedRacks === state.racks) return;

    const shelfName = state.shelves.find(shelf => shelf.id === shelfId)?.name || "shelf";
    await saveStateToServer(
      { ...state, racks: updatedRacks },
      "Racks Reordered",
      `Reordered racks within ${shelfName}.`
    );
  };

  const handleDropReorderDrawer = async (targetDrawerId: string, rackId: string) => {
    if (!isHierarchyDropAllowed("drawer", targetDrawerId, rackId) || !draggingHierarchyItem) {
      clearHierarchyDragState();
      return;
    }

    const updatedDrawers = reorderActiveItemsWithinParent<Drawer>(
      state.drawers,
      drawer => drawer.rackId === rackId,
      draggingHierarchyItem.id,
      targetDrawerId
    );

    clearHierarchyDragState();

    if (updatedDrawers === state.drawers) return;

    const rackName = state.racks.find(rack => rack.id === rackId)?.name || "rack";
    await saveStateToServer(
      { ...state, drawers: updatedDrawers },
      "Drawers Reordered",
      `Reordered drawers within ${rackName}.`
    );
  };

  // Fetch initial state
  const fetchState = async () => {
    try {
      setSyncing(true);
      const res = await authFetch("/api/inventory");
      if (res.ok) {
        const data = await res.json();
        const normalized = {
          version: typeof data.version === "number" ? data.version : 0,
          users: Array.isArray(data.users) && data.users.length > 0
            ? data.users.filter((u: unknown) => typeof u === "string" && u.trim().length > 0)
            : DEFAULT_USERS,
          storageUnits: data.storageUnits || [],
          shelves: data.shelves || [],
          racks: data.racks || [],
          drawers: data.drawers || [],
          boxes: data.boxes || [],
          samples: data.samples || [],
          auditLogs: data.auditLogs || [],
          auditSnapshots: data.auditSnapshots || []
        };
        setState(normalized);

        // Restore stored navigation path when valid; otherwise fallback gracefully.
        const activeStorages = normalized.storageUnits.filter((u: any) => !u.isArchived);
        let nextStorageId = selectedStorageId;
        let nextShelfId = selectedShelfId;
        let nextRackId = selectedRackId;
        let nextDrawerId = selectedDrawerId;
        let nextBoxId = selectedBoxId;

        const activeBox = nextBoxId
          ? normalized.boxes.find((b: any) => b.id === nextBoxId && !b.isArchived)
          : null;
        if (activeBox) {
          nextStorageId = activeBox.storageId;
          nextShelfId = activeBox.shelfId;
          nextRackId = activeBox.rackId || "";
          nextDrawerId = activeBox.drawerId || "";
        } else {
          nextBoxId = null;

          const activeDrawer = nextDrawerId
            ? normalized.drawers.find((d: any) => d.id === nextDrawerId && !d.isArchived)
            : null;
          if (activeDrawer) {
            nextStorageId = activeDrawer.storageId;
            nextShelfId = activeDrawer.shelfId;
            nextRackId = activeDrawer.rackId;
          } else {
            nextDrawerId = "";

            const activeRack = nextRackId
              ? normalized.racks.find((r: any) => r.id === nextRackId && !r.isArchived)
              : null;
            if (activeRack) {
              nextStorageId = activeRack.storageId;
              nextShelfId = activeRack.shelfId;
            } else {
              nextRackId = "";

              const activeShelf = nextShelfId
                ? normalized.shelves.find((s: any) => s.id === nextShelfId && !s.isArchived)
                : null;
              if (activeShelf) {
                nextStorageId = activeShelf.storageId;
              } else {
                nextShelfId = "";
              }
            }
          }
        }

        if (!nextStorageId || !activeStorages.some((u: any) => u.id === nextStorageId)) {
          const firstStorage = activeStorages[0];
          nextStorageId = firstStorage ? firstStorage.id : "";
          nextShelfId = "";
          nextRackId = "";
          nextDrawerId = "";
          nextBoxId = null;
        }

        if (nextStorageId !== selectedStorageId) setSelectedStorageId(nextStorageId);
        if (nextShelfId !== selectedShelfId) setSelectedShelfId(nextShelfId);
        if (nextRackId !== selectedRackId) setSelectedRackId(nextRackId);
        if (nextDrawerId !== selectedDrawerId) setSelectedDrawerId(nextDrawerId);
        if (nextBoxId !== selectedBoxId) setSelectedBoxId(nextBoxId);
      }
    } catch (err) {
      console.error("Failed to load inventory:", err);
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  };

  useEffect(() => {
    initAuth().then(() => fetchState());
  }, []);

  useEffect(() => {
    if (!state.users.length) return;
    if (!state.users.includes(currentUser)) {
      const storedUser = typeof window === "undefined"
        ? ""
        : window.localStorage.getItem(CURRENT_USER_STORAGE_KEY) || "";
      setCurrentUser(storedUser && state.users.includes(storedUser) ? storedUser : state.users[0]);
    }
  }, [state.users, currentUser]);

  useEffect(() => {
    if (typeof window !== "undefined" && currentUser) {
      window.localStorage.setItem(CURRENT_USER_STORAGE_KEY, currentUser);
    }
  }, [currentUser]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    window.localStorage.setItem(
      NAV_PATH_STORAGE_KEY,
      JSON.stringify({
        storageId: selectedStorageId,
        shelfId: selectedShelfId,
        rackId: selectedRackId,
        drawerId: selectedDrawerId,
        boxId: selectedBoxId,
      })
    );
  }, [selectedStorageId, selectedShelfId, selectedRackId, selectedDrawerId, selectedBoxId]);

  // QR code URL param navigation: on initial load, check for ?boxId= or ?sampleId=
  // and navigate directly to the matching box grid view or sample inspector.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const boxIdParam = params.get("boxId");
    const sampleIdParam = params.get("sampleId");

    if (boxIdParam && state.boxes.length > 0) {
      const box = state.boxes.find(b => b.id === boxIdParam && !b.isArchived);
      if (box) {
        setSelectedStorageId(box.storageId);
        setSelectedShelfId(box.shelfId);
        if (box.rackId) setSelectedRackId(box.rackId);
        if (box.drawerId) setSelectedDrawerId(box.drawerId);
        setSelectedBoxId(box.id);
        // Clean the URL so it doesn't re-trigger on refresh
        window.history.replaceState({}, "", window.location.pathname);
      }
    } else if (sampleIdParam && state.samples.length > 0) {
      const sample = state.samples.find(s => s.id === sampleIdParam);
      if (sample) {
        setSelectedStorageId(sample.storageId);
        setSelectedShelfId(sample.shelfId);
        if (sample.rackId) setSelectedRackId(sample.rackId);
        if (sample.drawerId) setSelectedDrawerId(sample.drawerId);
        if (sample.boxId) setSelectedBoxId(sample.boxId);
        setSelectedSampleId(sample.id);
        window.history.replaceState({}, "", window.location.pathname);
      }
    }
  }, [state.boxes, state.samples]); // Run once when data is loaded

  // Close mobile sidebar when navigation path changes
  useEffect(() => {
    setSidebarOpen(false);
  }, [selectedStorageId, selectedShelfId, selectedRackId, selectedDrawerId, selectedBoxId]);

  // Save changes to backend server with optimistic concurrency control.
  // The server tracks a version number; if another user saved since we last
  // loaded, the server returns 409 and we re-fetch + retry once before
  // alerting the user to manually refresh.
  const saveStateToServer = async (updatedState: InventoryState, logAction: string, logDesc: string) => {
    try {
      setSyncing(true);

      const buildPayload = (baseState: InventoryState, currentVersion: number) => {
        const now = new Date().toISOString();
        const newLog: AuditLog = {
          id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
          timestamp: now,
          user: currentUser,
          action: logAction,
          description: logDesc
        };

        const newSnapshot: AuditSnapshot = {
          id: `snap-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
          logId: newLog.id,
          timestamp: now,
          user: currentUser,
          action: logAction,
          description: logDesc,
          users: Array.from(new Set([...(baseState.users || []), currentUser])).filter(Boolean),
          storageUnits: baseState.storageUnits || [],
          shelves: baseState.shelves || [],
          racks: baseState.racks || [],
          drawers: baseState.drawers || [],
          boxes: baseState.boxes || [],
          samples: baseState.samples || []
        };

        const finalState = {
          ...baseState,
          version: currentVersion,
          users: Array.from(new Set([...(baseState.users || []), currentUser])).filter(Boolean),
          auditLogs: [newLog, ...(baseState.auditLogs || [])].slice(0, 1000),
          auditSnapshots: [newSnapshot, ...(baseState.auditSnapshots || [])].slice(0, 1000)
        };

        // Send only incremental audit entries to keep request bodies small.
        // The snapshot payload is stripped to metadata-only for the server
        // trip — the full snapshot is retained in finalState (client-side)
        // for restore/undo functionality.  This avoids sending a 3 MB
        // snapshot over the network on every save.
        const lightweightSnapshot: AuditSnapshot = {
          ...newSnapshot,
          users: [],
          storageUnits: [],
          shelves: [],
          racks: [],
          drawers: [],
          boxes: [],
          samples: []
        };
        const payloadForServer: InventoryState = {
          ...finalState,
          auditLogs: [newLog],
          auditSnapshots: [lightweightSnapshot]
        };

        return { finalState, payloadForServer };
      };

      const attemptSave = async (baseState: InventoryState, currentVersion: number): Promise<boolean> => {
        const { finalState, payloadForServer } = buildPayload(baseState, currentVersion);

        const res = await authFetch("/api/inventory", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payloadForServer)
        });

        if (res.ok) {
          const data = await res.json();
          const newVersion = typeof data.version === "number" ? data.version : currentVersion + 1;
          setState({ ...finalState, version: newVersion });
          return true;
        }

        if (res.status === 409) {
          // Version conflict — another user saved since we last loaded.
          const conflictData = await res.json().catch(() => null);
          const serverVersion = typeof conflictData?.serverVersion === "number"
            ? conflictData.serverVersion
            : currentVersion;

          // Re-fetch the latest server state to get a clean baseline.
          const freshRes = await authFetch("/api/inventory");
          if (!freshRes.ok) {
            console.error("Version conflict and failed to re-fetch server state.");
            return false;
          }
          const freshData = await freshRes.json();
          const freshState: InventoryState = {
            version: typeof freshData.version === "number" ? freshData.version : serverVersion,
            users: Array.isArray(freshData.users) && freshData.users.length > 0
              ? freshData.users.filter((u: unknown) => typeof u === "string" && u.trim().length > 0)
              : DEFAULT_USERS,
            storageUnits: freshData.storageUnits || [],
            shelves: freshData.shelves || [],
            racks: freshData.racks || [],
            drawers: freshData.drawers || [],
            boxes: freshData.boxes || [],
            samples: freshData.samples || [],
            auditLogs: freshData.auditLogs || [],
            auditSnapshots: freshData.auditSnapshots || []
          };

          // Update local state to the server's current version so the user
          // sees the latest data, then retry the save once with the new version.
          setState(freshState);

          // Re-apply the user's intended change on top of the fresh state.
          // We reuse updatedState (the caller's intended mutation) but stamp
          // the fresh version so the retry can succeed.
          const retryResult = await attemptSave(updatedState, freshState.version);
          if (!retryResult) {
            alert(
              "Another lab member modified the inventory while you were editing. " +
              "Your change could not be saved automatically. Please review the updated " +
              "inventory and try your action again."
            );
          }
          return retryResult;
        }

        console.error("Server rejected the state sync with status:", res.status);
        return false;
      };

      await attemptSave(updatedState, state.version);
    } catch (err) {
      console.error("Failed to sync inventory changes to cloud container:", err);
    } finally {
      setSyncing(false);
    }
  };

  /**
   * Granular API mutation helper. Sends only the changed records to a specific
   * endpoint, along with the client's current version and user via headers.
   * The server applies the mutation, increments the version, generates the
   * audit log + snapshot, and returns the new version + full state.
   *
   * On 409 (version conflict), re-fetches the full state and retries once.
   */
  const apiMutate = async (
    endpoint: string,
    method: "PUT" | "PATCH" | "POST",
    body: object,
    _action: string,
    _description: string,
    /** Optional optimistic state update to apply immediately. When provided,
     *  the client applies this state locally and only uses the server response
     *  for the version number and audit entries — avoiding a full state
     *  replacement and re-render on every mutation. */
    optimisticState?: InventoryState
  ): Promise<InventoryState | null> => {
    try {
      setSyncing(true);

      // Apply optimistic update immediately if provided.  This makes the UI
      // feel instant — the user sees their change without waiting for the
      // network round-trip.
      if (optimisticState) {
        setState(optimisticState);
      }

      // `useOptimistic` is false on retry after a 409 conflict, because the
      // optimistic state was computed against the stale pre-conflict state.
      const attempt = async (version: number, useOptimistic: boolean): Promise<InventoryState | null> => {
        const res = await authFetch(endpoint, {
          method,
          headers: {
            "Content-Type": "application/json",
            "X-Client-Version": String(version),
            "X-User": currentUser
          },
          body: JSON.stringify(body)
        });

        if (res.ok) {
          const data = await res.json();
          const newVersion = typeof data.version === "number" ? data.version : version + 1;

          if (useOptimistic && optimisticState) {
            // Optimistic path: the local state is already correct.  Just
            // bump the version and merge in the new audit entries from the
            // server.  No full state replacement, no full re-render.
            //
            // The server returns a metadata-only auditSnapshot (no payload
            // arrays) to keep the response small.  We augment it with the
            // full state payload from the optimistic state so that
            // restore/undo functionality works within the current session.
            const fullSnapshot: AuditSnapshot | null = data.auditSnapshot
              ? {
                  ...data.auditSnapshot,
                  users: [...(optimisticState.users || [])],
                  storageUnits: [...(optimisticState.storageUnits || [])],
                  shelves: [...(optimisticState.shelves || [])],
                  racks: [...(optimisticState.racks || [])],
                  drawers: [...(optimisticState.drawers || [])],
                  boxes: [...(optimisticState.boxes || [])],
                  samples: [...(optimisticState.samples || [])]
                }
              : null;
            const updatedOptimistic: InventoryState = {
              ...optimisticState,
              version: newVersion,
              auditLogs: data.auditLog
                ? [data.auditLog, ...(optimisticState.auditLogs || [])].slice(0, 1000)
                : optimisticState.auditLogs,
              auditSnapshots: fullSnapshot
                ? [fullSnapshot, ...(optimisticState.auditSnapshots || [])].slice(0, 1000)
                : optimisticState.auditSnapshots
            };
            setState(updatedOptimistic);
            return updatedOptimistic;
          }

          // Non-optimistic path: the server no longer returns the full
          // state (it returns only version + audit delta).  We keep the
          // current state and bump the version, merging in the new audit
          // entries from the server response.
          //
          // Same augmentation as the optimistic path: fill in the payload
          // arrays from the current state so restore/undo works.
          const base = state;
          const fullSnapshotNonOpt: AuditSnapshot | null = data.auditSnapshot
            ? {
                ...data.auditSnapshot,
                users: [...(base.users || [])],
                storageUnits: [...(base.storageUnits || [])],
                shelves: [...(base.shelves || [])],
                racks: [...(base.racks || [])],
                drawers: [...(base.drawers || [])],
                boxes: [...(base.boxes || [])],
                samples: [...(base.samples || [])]
              }
            : null;
          const newState: InventoryState = data.state
            ? { ...data.state, version: newVersion }
            : {
                ...base,
                version: newVersion,
                auditLogs: data.auditLog
                  ? [data.auditLog, ...(base.auditLogs || [])].slice(0, 1000)
                  : base.auditLogs,
                auditSnapshots: fullSnapshotNonOpt
                  ? [fullSnapshotNonOpt, ...(base.auditSnapshots || [])].slice(0, 1000)
                  : base.auditSnapshots
              };
          setState(newState);
          return newState;
        }

        if (res.status === 409) {
          // Version conflict — re-fetch full state and retry once.
          const conflictData = await res.json().catch(() => null);
          const serverVersion = typeof conflictData?.serverVersion === "number"
            ? conflictData.serverVersion
            : version;

          const freshRes = await authFetch("/api/inventory");
          if (!freshRes.ok) {
            console.error("Version conflict and failed to re-fetch server state.");
            return null;
          }
          const freshData = await freshRes.json();
          const freshState: InventoryState = {
            version: typeof freshData.version === "number" ? freshData.version : serverVersion,
            users: Array.isArray(freshData.users) && freshData.users.length > 0
              ? freshData.users.filter((u: unknown) => typeof u === "string" && u.trim().length > 0)
              : DEFAULT_USERS,
            storageUnits: freshData.storageUnits || [],
            shelves: freshData.shelves || [],
            racks: freshData.racks || [],
            drawers: freshData.drawers || [],
            boxes: freshData.boxes || [],
            samples: freshData.samples || [],
            auditLogs: freshData.auditLogs || [],
            auditSnapshots: freshData.auditSnapshots || []
          };
          setState(freshState);

          // Retry with the fresh server version, discarding the optimistic
          // state (it was computed against the stale pre-conflict state).
          const retryResult = await attempt(freshState.version, false);
          if (!retryResult) {
            alert(
              "Another lab member modified the inventory while you were editing. " +
              "Your change could not be saved automatically. Please review the updated " +
              "inventory and try your action again."
            );
          }
          return retryResult;
        }

        console.error("Granular API request failed:", res.status, await res.text().catch(() => ""));
        return null;
      };

      return await attempt(state.version, !!optimisticState);
    } catch (err) {
      console.error("Failed to sync granular change to server:", err);
      return null;
    } finally {
      setSyncing(false);
    }
  };

  const handleManageUsers = () => {
    const existing = state.users.join(", ");
    const input = window.prompt(
      "Set users as comma-separated names (example: Alice, Bob, Carol)",
      existing
    );

    if (input === null) return;

    const parsedUsers = input
      .split(",")
      .map(name => name.trim())
      .filter(Boolean);

    const uniqueUsers = Array.from(new Set(parsedUsers));

    if (!uniqueUsers.length) {
      alert("Please provide at least one user name.");
      return;
    }

    const nextCurrentUser = uniqueUsers.includes(currentUser) ? currentUser : uniqueUsers[0];
    setCurrentUser(nextCurrentUser);

    apiMutate(
      "/api/users",
      "PATCH",
      { users: uniqueUsers },
      "Users Updated",
      `Updated users list to ${uniqueUsers.length} member(s).`,
      { ...state, users: uniqueUsers }
    );
  };

  // Helper for single click backup export
  const handleBackupExport = async () => {
    try {
      const res = await authFetch("/api/export", { method: "GET" });
      if (!res.ok) {
        alert("Failed to export JSON backup.");
        return;
      }

      const jsonBlob = await res.blob();
      const jsonUrl = URL.createObjectURL(jsonBlob);
      const jsonLink = document.createElement("a");
      jsonLink.href = jsonUrl;
      jsonLink.download = `lab_inventory_backup_${new Date().toISOString().split("T")[0]}.json`;
      document.body.appendChild(jsonLink);
      jsonLink.click();
      document.body.removeChild(jsonLink);

      handleCSVExport();
    } catch {
      alert("Failed to export backup files.");
    }
  };

  const handleExportAuditTrailJSON = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      totalLogs: state.auditLogs.length,
      auditLogs: state.auditLogs
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `lab_inventory_audit_trail_${new Date().toISOString().split("T")[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportAuditTrailCSV = () => {
    const esc = (val: string) => `"${(val || "").replace(/"/g, '""')}"`;
    const rows = state.auditLogs.map(log => [
      esc(log.timestamp),
      esc(log.user),
      esc(log.action),
      esc(log.description)
    ].join(","));

    const csv = ["timestamp,user,action,description", ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `lab_inventory_audit_trail_${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleRestoreFromSnapshot = (snapshotId: string) => {
    const snapshot = state.auditSnapshots.find(s => s.id === snapshotId);
    if (!snapshot) {
      alert("Snapshot not found for this audit entry.");
      return;
    }

    // Snapshots from previous sessions may not have a full state payload
    // (only metadata is persisted to disk).  In that case, we cannot restore.
    if (!snapshot.samples || snapshot.samples.length === 0) {
      alert(
        "This snapshot was created in a previous session and only metadata " +
        "was preserved. Restore is available for snapshots created in the " +
        "current session only."
      );
      return;
    }

    const confirmed = window.confirm(`Restore inventory to this point in time?\n${snapshot.action} (${new Date(snapshot.timestamp).toLocaleString()})`);
    if (!confirmed) return;

    const restoredState: InventoryState = {
      ...state,
      users: snapshot.users || state.users,
      storageUnits: snapshot.storageUnits || [],
      shelves: snapshot.shelves || [],
      racks: snapshot.racks || [],
      drawers: snapshot.drawers || [],
      boxes: snapshot.boxes || [],
      samples: snapshot.samples || []
    };

    saveStateToServer(
      restoredState,
      "State Restored",
      `Restored inventory to audit point: ${snapshot.action} (${new Date(snapshot.timestamp).toLocaleString()}).`
    );
  };

  const handleUndoLastChange = () => {
    if (!state.auditSnapshots || state.auditSnapshots.length < 2) {
      alert("No earlier snapshot available to undo to.");
      return;
    }

    const previousSnapshot = state.auditSnapshots[1];
    handleRestoreFromSnapshot(previousSnapshot.id);
  };

  // Helper to trigger full CSV backup download
  const handleCSVExport = () => {
    const activeSamples = state.samples.filter(s => !s.isArchived);
    const activeBoxes = state.boxes.filter(b => !b.isArchived);
    const csvContent = convertInventoryToCSV(activeSamples, activeBoxes, {
      storageUnits: state.storageUnits.filter(u => !u.isArchived),
      shelves: state.shelves.filter(s => !s.isArchived),
      racks: state.racks.filter(r => !r.isArchived),
      drawers: state.drawers.filter(d => !d.isArchived),
      boxes: activeBoxes
    });
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `lab_inventory_full_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Trigger full restore from manual backup JSON file
  const handleBackupRestore = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        if (!Array.isArray(parsed.storageUnits) || !Array.isArray(parsed.samples)) {
          alert("Invalid backup file format. Must contain storageUnits and samples.");
          return;
        }

        const res = await authFetch(`/api/import?user=${encodeURIComponent(currentUser)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsed)
        });

        if (res.ok) {
          const result = await res.json();
          setState(result.state);
          alert("Database successfully restored from JSON backup!");
        } else {
          alert("Error restoring database on server.");
        }
      } catch (err) {
        alert("Failed to parse the backup JSON file. Make sure it's valid.");
      }
      e.target.value = "";
    };
    reader.readAsText(file);
  };

  const triggerBackupRestorePicker = () => {
    backupRestoreInputRef.current?.click();
  };

  // Quick active selections
  const currentStorage = useMemo(() => {
    return state.storageUnits.find(u => u.id === selectedStorageId && !u.isArchived);
  }, [state.storageUnits, selectedStorageId]);

  const currentShelf = useMemo(() => {
    return state.shelves.find(s => s.id === selectedShelfId && !s.isArchived);
  }, [state.shelves, selectedShelfId]);

  const currentRack = useMemo(() => {
    return state.racks.find(r => r.id === selectedRackId && !r.isArchived);
  }, [state.racks, selectedRackId]);

  const currentDrawer = useMemo(() => {
    return state.drawers.find(d => d.id === selectedDrawerId && !d.isArchived);
  }, [state.drawers, selectedDrawerId]);

  const currentBox = useMemo(() => {
    return state.boxes.find(b => b.id === selectedBoxId && !b.isArchived);
  }, [state.boxes, selectedBoxId]);

  // Keep the selected path coherent so breadcrumbs/tree always show full ancestry.
  useEffect(() => {
    let nextStorageId = selectedStorageId;
    let nextShelfId = selectedShelfId;
    let nextRackId = selectedRackId;

    if (selectedBoxId) {
      const box = state.boxes.find(b => b.id === selectedBoxId && !b.isArchived);
      if (!box) return;
      nextStorageId = box.storageId;
      nextShelfId = box.shelfId;
      nextRackId = box.rackId || "";
    } else if (selectedDrawerId) {
      const drawer = state.drawers.find(d => d.id === selectedDrawerId && !d.isArchived);
      if (!drawer) return;
      nextStorageId = drawer.storageId;
      nextShelfId = drawer.shelfId;
      nextRackId = drawer.rackId;
    } else if (selectedRackId) {
      const rack = state.racks.find(r => r.id === selectedRackId && !r.isArchived);
      if (!rack) return;
      nextStorageId = rack.storageId;
      nextShelfId = rack.shelfId;
    } else if (selectedShelfId) {
      const shelf = state.shelves.find(s => s.id === selectedShelfId && !s.isArchived);
      if (!shelf) return;
      nextStorageId = shelf.storageId;
    } else {
      return;
    }

    if (nextStorageId !== selectedStorageId) setSelectedStorageId(nextStorageId);
    if (nextShelfId !== selectedShelfId) setSelectedShelfId(nextShelfId);
    if (nextRackId !== selectedRackId) setSelectedRackId(nextRackId);
  }, [
    selectedStorageId,
    selectedShelfId,
    selectedRackId,
    selectedDrawerId,
    selectedBoxId,
    state.storageUnits,
    state.shelves,
    state.racks,
    state.drawers,
    state.boxes
  ]);

  const availableDestinationsOnShelf = useMemo(() => {
    if (!currentShelf) return [];
    const options: { id: string; name: string; type: "box" | "drawer" }[] = [];
    const racksOnShelf = state.racks.filter(r => r.shelfId === currentShelf.id && !r.isArchived);
    
    racksOnShelf.forEach(rack => {
      const drawersInRack = state.drawers.filter(d => d.rackId === rack.id && !d.isArchived);
      drawersInRack.forEach(drawer => {
        options.push({
          id: drawer.id,
          name: `Drawer: ${rack.name} > ${drawer.name}`,
          type: "drawer"
        });
      });
    });

    const boxesOnShelf = state.boxes.filter(b => b.shelfId === currentShelf.id && !b.isArchived);
    boxesOnShelf.forEach(box => {
      let namePrefix = "";
      if (box.rackId) {
        const rack = state.racks.find(r => r.id === box.rackId);
        if (rack) namePrefix += `${rack.name} > `;
      }
      if (box.drawerId) {
        const drawer = state.drawers.find(d => d.id === box.drawerId);
        if (drawer) namePrefix += `${drawer.name} > `;
      }
      options.push({
        id: box.id,
        name: `Box: ${namePrefix}${box.name}`,
        type: "box"
      });
    });
    return options;
  }, [state.racks, state.drawers, state.boxes, currentShelf]);

  // Find all boxes and drawers in the storage unit
  const availableDestinationsInStorage = useMemo(() => {
    if (!currentStorage) return [];
    const options: { id: string; name: string; type: "box" | "drawer" }[] = [];
    const shelvesInStorage = state.shelves.filter(s => s.storageId === currentStorage.id && !s.isArchived);
    const racksInStorage = state.racks.filter(r => r.storageId === currentStorage.id && !r.isArchived);
    
    racksInStorage.forEach(rack => {
      const shelf = shelvesInStorage.find(s => s.id === rack.shelfId);
      const shelfPrefix = shelf ? `${shelf.name} > ` : "";
      const drawersInRack = state.drawers.filter(d => d.rackId === rack.id && !d.isArchived);
      drawersInRack.forEach(drawer => {
        options.push({
          id: drawer.id,
          name: `Drawer: ${shelfPrefix}${rack.name} > ${drawer.name}`,
          type: "drawer"
        });
      });
    });

    const boxesInStorage = state.boxes.filter(b => b.storageId === currentStorage.id && !b.isArchived);
    boxesInStorage.forEach(box => {
      let namePrefix = "";
      if (box.shelfId) {
        const shelf = shelvesInStorage.find(s => s.id === box.shelfId);
        if (shelf) namePrefix += `${shelf.name} > `;
      }
      if (box.rackId) {
        const rack = state.racks.find(r => r.id === box.rackId);
        if (rack) namePrefix += `${rack.name} > `;
      }
      if (box.drawerId) {
        const drawer = state.drawers.find(d => d.id === box.drawerId);
        if (drawer) namePrefix += `${drawer.name} > `;
      }
      options.push({
        id: box.id,
        name: `Box: ${namePrefix}${box.name}`,
        type: "box"
      });
    });
    return options;
  }, [state.shelves, state.racks, state.drawers, state.boxes, currentStorage]);

  // Sorted Samples on current shelf
  const sortedShelfSamples = useMemo(() => {
    if (!currentShelf) return [];
    const shelfSamps = state.samples.filter(s => s.shelfId === currentShelf.id && !s.isArchived);
    let filtered = listFilter === "loose" ? shelfSamps.filter(s => !s.boxId) : shelfSamps;

    // Apply expiry/stock filters
    if (expiryFilter === "expired") {
      filtered = filtered.filter(s => getExpiryStatus(s) === "expired");
    } else if (expiryFilter === "expiring") {
      filtered = filtered.filter(s => {
        const st = getExpiryStatus(s);
        return st === "expired" || st === "critical" || st === "warning" || st === "soon";
      });
    } else if (expiryFilter === "lowstock") {
      filtered = filtered.filter(s => isLowStock(s));
    }

    return [...filtered].sort((a, b) => {
      let aVal: any = "";
      let bVal: any = "";

      if (sortField === "chemicalName") {
        aVal = a.chemicalName || "";
        bVal = b.chemicalName || "";
      } else if (sortField === "casNumber") {
        aVal = a.casNumber || "";
        bVal = b.casNumber || "";
      } else if (sortField === "itemType") {
        aVal = a.itemType || "";
        bVal = b.itemType || "";
      } else if (sortField === "qty") {
        aVal = Number(a.qty) || 0;
        bVal = Number(b.qty) || 0;
      } else if (sortField === "location") {
        aVal = getSampleLocationPath(a);
        bVal = getSampleLocationPath(b);
      } else if (sortField === "expiresOn") {
        aVal = a.expiresOn || "";
        bVal = b.expiresOn || "";
      }

      if (typeof aVal === "string") {
        return sortDirection === "asc"
          ? aVal.localeCompare(bVal, undefined, { sensitivity: "base", numeric: true })
          : bVal.localeCompare(aVal, undefined, { sensitivity: "base", numeric: true });
      } else {
        return sortDirection === "asc" ? aVal - bVal : bVal - aVal;
      }
    });
  }, [state.samples, currentShelf, listFilter, expiryFilter, sortField, sortDirection]);

  // Sorted Samples in current storage unit
  const sortedStorageSamples = useMemo(() => {
    if (!currentStorage) return [];
    const storageSamps = state.samples.filter(s => s.storageId === currentStorage.id && !s.isArchived);
    const filtered = listFilter === "loose" ? storageSamps.filter(s => !s.boxId) : storageSamps;

    return [...filtered].sort((a, b) => {
      let aVal: any = "";
      let bVal: any = "";

      if (sortField === "chemicalName") {
        aVal = a.chemicalName || "";
        bVal = b.chemicalName || "";
      } else if (sortField === "casNumber") {
        aVal = a.casNumber || "";
        bVal = b.casNumber || "";
      } else if (sortField === "itemType") {
        aVal = a.itemType || "";
        bVal = b.itemType || "";
      } else if (sortField === "qty") {
        aVal = Number(a.qty) || 0;
        bVal = Number(b.qty) || 0;
      } else if (sortField === "location") {
        aVal = getSampleLocationPath(a);
        bVal = getSampleLocationPath(b);
      } else if (sortField === "expiresOn") {
        aVal = a.expiresOn || "";
        bVal = b.expiresOn || "";
      }

      if (typeof aVal === "string") {
        return sortDirection === "asc"
          ? aVal.localeCompare(bVal, undefined, { sensitivity: "base", numeric: true })
          : bVal.localeCompare(aVal, undefined, { sensitivity: "base", numeric: true });
      } else {
        return sortDirection === "asc" ? aVal - bVal : bVal - aVal;
      }
    });
  }, [state.samples, currentStorage, listFilter, sortField, sortDirection]);

  const handleSort = (field: "chemicalName" | "casNumber" | "qty" | "itemType" | "location" | "expiresOn") => {
    if (sortField === field) {
      setSortDirection(prev => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  type SearchResult =
    | { kind: "sample"; sample: Sample }
    | { kind: "storage"; storage: StorageUnit }
    | { kind: "shelf"; shelf: Shelf; storage?: StorageUnit }
    | { kind: "rack"; rack: Rack; shelf?: Shelf; storage?: StorageUnit }
    | { kind: "drawer"; drawer: Drawer; rack?: Rack; shelf?: Shelf; storage?: StorageUnit }
    | { kind: "box"; box: Box; drawer?: Drawer; rack?: Rack; shelf?: Shelf; storage?: StorageUnit };

  type SampleSearchResult = Extract<SearchResult, { kind: "sample" }>;

  const SEARCH_RESULT_KIND_LABELS: Record<SearchResult["kind"], string> = {
    sample: "Sample",
    storage: "Storage",
    shelf: "Shelf",
    rack: "Rack",
    drawer: "Drawer",
    box: "Box",
  };

  const getSearchResultTitle = (result: SearchResult) => {
    switch (result.kind) {
      case "sample":
        return result.sample.chemicalName || result.sample.chemicalId || "Sample";
      case "storage":
        return result.storage.name;
      case "shelf":
        return result.shelf.name;
      case "rack":
        return result.rack.name;
      case "drawer":
        return result.drawer.name;
      case "box":
        return result.box.name;
    }
  };

  const getSearchResultPath = (result: SearchResult) => {
    switch (result.kind) {
      case "sample": {
        const parentBoxDetail = state.boxes.find(b => b.id === result.sample.boxId);
        const parentDrawerDetail = state.drawers.find(d => d.id === result.sample.drawerId);
        const parentRackDetail = state.racks.find(r => r.id === result.sample.rackId);
        const parentShelfDetail = state.shelves.find(s => s.id === result.sample.shelfId);
        const parentStorageDetail = state.storageUnits.find(u => u.id === result.sample.storageId);
        return [parentStorageDetail?.name, parentShelfDetail?.name, parentRackDetail?.name || parentDrawerDetail?.name, parentBoxDetail?.name]
          .filter(Boolean)
          .join(" > ");
      }
      case "storage":
        return result.storage.name;
      case "shelf":
        return [result.storage?.name, result.shelf.name].filter(Boolean).join(" > ");
      case "rack":
        return [result.storage?.name, result.shelf?.name, result.rack.name].filter(Boolean).join(" > ");
      case "drawer":
        return [result.storage?.name, result.shelf?.name, result.rack?.name, result.drawer.name].filter(Boolean).join(" > ");
      case "box":
        return [result.storage?.name, result.shelf?.name, result.rack?.name || result.drawer?.name, result.box.name].filter(Boolean).join(" > ");
    }
  };

  const parseCreatedAtFromId = (id: string) => {
    const matches = id.match(/-(\d{10,})(?:-|$)/);
    if (!matches) return null;
    const timestamp = Number(matches[1]);
    return Number.isFinite(timestamp) ? timestamp : null;
  };

  const getSearchResultAddedAt = (result: SearchResult) => {
    const dateValue = (() => {
      switch (result.kind) {
        case "sample":
          return result.sample.createdAt || null;
        case "storage":
          return result.storage.createdAt || null;
        case "shelf":
          return result.shelf.createdAt || null;
        case "rack":
          return result.rack.createdAt || null;
        case "drawer":
          return result.drawer.createdAt || null;
        case "box":
          return result.box.createdAt || null;
      }
    })();

    if (dateValue) {
      const parsed = Date.parse(dateValue);
      if (Number.isFinite(parsed)) return parsed;
    }

    const id = (() => {
      switch (result.kind) {
        case "sample":
          return result.sample.id;
        case "storage":
          return result.storage.id;
        case "shelf":
          return result.shelf.id;
        case "rack":
          return result.rack.id;
        case "drawer":
          return result.drawer.id;
        case "box":
          return result.box.id;
      }
    })();

    return parseCreatedAtFromId(id);
  };

  const openDetailedSearch = () => {
    if (!searchQuery.trim()) return;
    setSearchPanelOpen(false);
    setSearchDetailOpen(true);
  };

  const toggleSearchKindFilter = (kind: SearchResult["kind"]) => {
    setSearchKindFilters(prev => (
      prev.includes(kind)
        ? prev.filter(item => item !== kind)
        : [...prev, kind]
    ));
  };

  // Universal Filter / Search logic — Fuse.js fuzzy search (review item 11)
  // Create memoized Fuse instances for each entity type. Threshold 0.4 gives
  // good typo tolerance without too many false positives.
  const sampleFuse = useMemo(() => new Fuse(
    state.samples.filter(s => !s.isArchived),
    {
      keys: [
        "chemicalId", "chemicalName", "casNumber", "itemType", "notes", "plasmidName",
        "organism", "gene", "primaryDepositedBy", "catalogNum", "lot",
      ],
      threshold: 0.4,
      ignoreLocation: true,
      minMatchCharLength: 2,
    }
  ), [state.samples]);

  const storageFuse = useMemo(() => new Fuse(
    state.storageUnits.filter(u => !u.isArchived),
    { keys: ["name", "type"], threshold: 0.4, ignoreLocation: true }
  ), [state.storageUnits]);

  const shelfFuse = useMemo(() => new Fuse(
    state.shelves.filter(s => !s.isArchived),
    { keys: ["name"], threshold: 0.4, ignoreLocation: true }
  ), [state.shelves]);

  const rackFuse = useMemo(() => new Fuse(
    state.racks.filter(r => !r.isArchived),
    { keys: ["name"], threshold: 0.4, ignoreLocation: true }
  ), [state.racks]);

  const drawerFuse = useMemo(() => new Fuse(
    state.drawers.filter(d => !d.isArchived),
    { keys: ["name"], threshold: 0.4, ignoreLocation: true }
  ), [state.drawers]);

  const boxFuse = useMemo(() => new Fuse(
    state.boxes.filter(b => !b.isArchived),
    { keys: ["name"], threshold: 0.4, ignoreLocation: true }
  ), [state.boxes]);

  const searchResults = useMemo<SearchResult[]>(() => {
    const query = searchQuery.trim();
    if (!query) return [];

    const fuseSampleMatches: SampleSearchResult[] = sampleFuse
      .search(query)
      .map(result => ({ kind: "sample" as const, sample: result.item }));

    const normalizedQuery = query.toLowerCase().replace(/\s+/g, "");
    const directIdMatches: SampleSearchResult[] = state.samples
      .filter(s => !s.isArchived)
      .filter(s => {
        const normalizedId = (s.chemicalId || "").toLowerCase().replace(/\s+/g, "");
        return normalizedQuery.length > 0 && normalizedId.includes(normalizedQuery);
      })
      .map(sample => ({ kind: "sample" as const, sample }));

    const sampleMatchesById = new Map<string, SampleSearchResult>();
    [...directIdMatches, ...fuseSampleMatches].forEach(match => {
      sampleMatchesById.set(match.sample.id, match);
    });
    const sampleMatches: SearchResult[] = Array.from(sampleMatchesById.values());

    const storageMatches: SearchResult[] = storageFuse
      .search(query)
      .map(result => ({ kind: "storage" as const, storage: result.item }));

    const shelfMatches: SearchResult[] = shelfFuse
      .search(query)
      .map(result => ({
        kind: "shelf" as const,
        shelf: result.item,
        storage: state.storageUnits.find(u => u.id === result.item.storageId)
      }));

    const rackMatches: SearchResult[] = rackFuse
      .search(query)
      .map(result => ({
        kind: "rack" as const,
        rack: result.item,
        shelf: state.shelves.find(s => s.id === result.item.shelfId),
        storage: state.storageUnits.find(u => u.id === result.item.storageId)
      }));

    const drawerMatches: SearchResult[] = drawerFuse
      .search(query)
      .map(result => ({
        kind: "drawer" as const,
        drawer: result.item,
        rack: state.racks.find(r => r.id === result.item.rackId),
        shelf: state.shelves.find(s => s.id === result.item.shelfId),
        storage: state.storageUnits.find(u => u.id === result.item.storageId)
      }));

    const boxMatches: SearchResult[] = boxFuse
      .search(query)
      .map(result => ({
        kind: "box" as const,
        box: result.item,
        drawer: result.item.drawerId ? state.drawers.find(d => d.id === result.item.drawerId) : undefined,
        rack: result.item.rackId ? state.racks.find(r => r.id === result.item.rackId) : undefined,
        shelf: state.shelves.find(s => s.id === result.item.shelfId),
        storage: state.storageUnits.find(u => u.id === result.item.storageId)
      }));

    return [
      ...sampleMatches,
      ...storageMatches,
      ...shelfMatches,
      ...rackMatches,
      ...drawerMatches,
      ...boxMatches
    ];
  }, [
    sampleFuse,
    storageFuse,
    shelfFuse,
    rackFuse,
    drawerFuse,
    boxFuse,
    state.storageUnits,
    state.shelves,
    state.racks,
    state.drawers,
    searchQuery
  ]);

  const detailedSearchResults = useMemo(() => {
    const fromTimestamp = searchDateFrom ? new Date(`${searchDateFrom}T00:00:00`).getTime() : null;
    const toTimestamp = searchDateTo ? new Date(`${searchDateTo}T23:59:59.999`).getTime() : null;

    const filtered = searchResults.filter(result => {
      if (!searchKindFilters.includes(result.kind)) return false;

      const addedAt = getSearchResultAddedAt(result);
      if (fromTimestamp !== null && (addedAt === null || addedAt < fromTimestamp)) return false;
      if (toTimestamp !== null && (addedAt === null || addedAt > toTimestamp)) return false;

      return true;
    });

    const withDate = filtered.map(result => ({ result, addedAt: getSearchResultAddedAt(result) }));

    withDate.sort((left, right) => {
      if (searchSortMode === "newest") {
        return (right.addedAt || 0) - (left.addedAt || 0);
      }
      if (searchSortMode === "oldest") {
        return (left.addedAt || 0) - (right.addedAt || 0);
      }
      return 0;
    });

    return withDate.map(entry => entry.result);
  }, [searchResults, searchKindFilters, searchDateFrom, searchDateTo, searchSortMode]);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchPanelOpen(false);
      setSearchDetailOpen(false);
    }
  }, [searchQuery]);

  // Track samples mapped to the currently selected container (Shelf, Rack, Drawer, or Box)
  const currentViewSamples = useMemo(() => {
    if (selectedBoxId) {
      return state.samples.filter(s => s.boxId === selectedBoxId && !s.isArchived);
    }
    if (selectedDrawerId) {
      return state.samples.filter(s => s.drawerId === selectedDrawerId && !s.boxId && !s.isArchived);
    }
    if (selectedRackId) {
      return state.samples.filter(s => s.rackId === selectedRackId && !s.drawerId && !s.boxId && !s.isArchived);
    }
    if (selectedShelfId) {
      return state.samples.filter(s => s.shelfId === selectedShelfId && !s.rackId && !s.drawerId && !s.boxId && !s.isArchived);
    }
    return [];
  }, [state.samples, selectedShelfId, selectedRackId, selectedDrawerId, selectedBoxId]);

  const currentGridSamples = useMemo(() => {
    return [...currentViewSamples]
      .filter(sample => typeof sample.row === "number" && typeof sample.col === "number")
      .sort((a, b) => {
        const rowDiff = (a.row || 0) - (b.row || 0);
        if (rowDiff !== 0) return rowDiff;
        return (a.col || 0) - (b.col || 0);
      });
  }, [currentViewSamples]);

  useEffect(() => {
    setSelectedGridSampleIds([]);
    setGridSelectionAnchorId(null);
  }, [selectedBoxId, selectedDrawerId, selectedRackId, selectedShelfId]);

  // Search auto selections
  const handleSearchResultClick = (result: SearchResult) => {
    if (result.kind === "sample") {
      const sample = result.sample;
      setSelectedStorageId(sample.storageId);
      setSelectedShelfId(sample.shelfId);
      setSelectedRackId(sample.rackId || "");
      setSelectedDrawerId(sample.drawerId || "");
      setSelectedBoxId(sample.boxId);
      setSelectedSampleId(sample.id);
      return;
    }

    setSelectedSampleId(null);

    if (result.kind === "storage") {
      setSelectedStorageId(result.storage.id);
      setSelectedShelfId("");
      setSelectedRackId("");
      setSelectedDrawerId("");
      setSelectedBoxId(null);
      return;
    }

    if (result.kind === "shelf") {
      setSelectedStorageId(result.shelf.storageId);
      setSelectedShelfId(result.shelf.id);
      setSelectedRackId("");
      setSelectedDrawerId("");
      setSelectedBoxId(null);
      return;
    }

    if (result.kind === "rack") {
      setSelectedStorageId(result.rack.storageId);
      setSelectedShelfId(result.rack.shelfId);
      setSelectedRackId(result.rack.id);
      setSelectedDrawerId("");
      setSelectedBoxId(null);
      return;
    }

    if (result.kind === "drawer") {
      setSelectedStorageId(result.drawer.storageId);
      setSelectedShelfId(result.drawer.shelfId);
      setSelectedRackId(result.drawer.rackId);
      setSelectedDrawerId(result.drawer.id);
      setSelectedBoxId(null);
      return;
    }

    setSelectedStorageId(result.box.storageId);
    setSelectedShelfId(result.box.shelfId);
    setSelectedRackId(result.box.rackId || "");
    setSelectedDrawerId(result.box.drawerId || "");
    setSelectedBoxId(result.box.id);
  };

  // Handle scan/manual entry: look up a box ID or sample ID and navigate to it
  const handleScanSubmit = () => {
    const query = scanInput.trim();
    if (!query) return;

    // Try box ID first
    const box = state.boxes.find(b => b.id === query && !b.isArchived);
    if (box) {
      setSelectedStorageId(box.storageId);
      setSelectedShelfId(box.shelfId);
      setSelectedRackId(box.rackId || "");
      setSelectedDrawerId(box.drawerId || "");
      setSelectedBoxId(box.id);
      setScanInput("");
      return;
    }

    // Try sample ID
    const sample = state.samples.find(s => s.id === query);
    if (sample) {
      setSelectedStorageId(sample.storageId);
      setSelectedShelfId(sample.shelfId);
      setSelectedRackId(sample.rackId || "");
      setSelectedDrawerId(sample.drawerId || "");
      setSelectedBoxId(sample.boxId);
      setSelectedSampleId(sample.id);
      setScanInput("");
      return;
    }

    // Try CAS number
    const casSample = state.samples.find(s => s.casNumber === query && !s.isArchived);
    if (casSample) {
      setSelectedStorageId(casSample.storageId);
      setSelectedShelfId(casSample.shelfId);
      setSelectedRackId(casSample.rackId || "");
      setSelectedDrawerId(casSample.drawerId || "");
      setSelectedBoxId(casSample.boxId);
      setSelectedSampleId(casSample.id);
      setScanInput("");
      return;
    }

    alert(`No box or sample found for "${query}". Try a Box ID, Sample ID, or CAS number.`);
  };

  // Generate and print QR labels for all boxes
  const handlePrintQRLables = async () => {
    setIsGeneratingQR(true);
    try {
      const labels = await generateAllBoxQRLabels(
        state.boxes,
        state.shelves,
        state.racks,
        state.drawers,
        state.storageUnits
      );
      if (labels.length === 0) {
        alert("No active boxes found to generate QR labels for.");
        return;
      }
      printQRLabels(labels);
    } catch (err) {
      alert("Failed to generate QR labels: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsGeneratingQR(false);
    }
  };

  // Inspect sample
  const inspectedSample = useMemo(() => {
    return state.samples.find(s => s.id === selectedSampleId);
  }, [state.samples, selectedSampleId]);

  const getSampleLocationString = (sample: Sample) => {
    if (sample.boxId) {
      const box = state.boxes.find(b => b.id === sample.boxId);
      const boxName = box ? box.name : "Unknown Box";
      if (sample.row && sample.col) {
        return `${boxName} (Slot ${String.fromCharCode(64 + sample.row)}${sample.col})`;
      }
      return `${boxName} (Loose)`;
    }
    if (sample.drawerId) {
      const drawer = state.drawers.find(d => d.id === sample.drawerId);
      return drawer ? `Drawer "${drawer.name}"` : "Direct inside Drawer";
    }
    if (sample.rackId) {
      const rack = state.racks.find(r => r.id === sample.rackId);
      return rack ? `Rack "${rack.name}"` : "Direct inside Rack";
    }
    if (sample.shelfId) {
      const shelf = state.shelves.find(s => s.id === sample.shelfId);
      return shelf ? `Shelf "${shelf.name}"` : "Direct on Shelf";
    }
    if (sample.storageId) {
      const storage = state.storageUnits.find(u => u.id === sample.storageId);
      return storage ? `Storage "${storage.name}"` : "Direct in Storage";
    }
    return "Unassigned Location";
  };

  // Non-destructive triggers: Archiving items
  const handleArchiveSample = (id: string, name: string) => {
    if (window.confirm(`Are you sure you want to delete/archive sample "${name}"? This action is non-destructive and can be undone.`)) {
      apiMutate(
        `/api/samples/${id}`,
        "PATCH",
        { isArchived: true },
        "Sample Archived",
        `Archived/deleted sample "${name}" from its location.`,
        { ...state, samples: state.samples.map(s => s.id === id ? { ...s, isArchived: true } : s) }
      );
      if (selectedSampleId === id) setSelectedSampleId(null);
      setSelectedGridSampleIds(prev => prev.filter(sampleId => sampleId !== id));
      if (gridSelectionAnchorId === id) setGridSelectionAnchorId(null);
    }
  };

  const handleArchiveSelectedGridSamples = () => {
    if (!selectedGridSampleIds.length) return;

    const selectedCount = selectedGridSampleIds.length;
    const confirmed = window.confirm(`Archive ${selectedCount} selected sample(s) from this box? This action is non-destructive and can be undone.`);
    if (!confirmed) return;

    apiMutate(
      "/api/samples/bulk",
      "PATCH",
      { ids: [...selectedGridSampleIds], changes: { isArchived: true } },
      "Samples Bulk Archived",
      `Archived ${selectedCount} selected sample(s) from the current box.`,
      { ...state, samples: state.samples.map(s => selectedGridSampleIds.includes(s.id) ? { ...s, isArchived: true } : s) }
    );

    if (selectedSampleId && selectedGridSampleIds.includes(selectedSampleId)) {
      setSelectedSampleId(null);
    }
    setSelectedGridSampleIds([]);
    setGridSelectionAnchorId(null);
  };

  const handleMoveSelectedGridSamples = () => {
    if (!selectedGridSampleIds.length) return;

    setBulkItemType("sample");
    setBulkSelectedIds([...selectedGridSampleIds]);
    setBulkSelectOpen(false);
    setBulkMoveOpen(true);
  };

  const handleDepleteSample = (id: string, name: string) => {
    apiMutate(
      `/api/samples/${id}`,
      "PATCH",
      { qty: 0 },
      "Sample Depleted",
      `Marked sample "${name}" as depleted (0 qty).`,
      { ...state, samples: state.samples.map(s => s.id === id ? { ...s, qty: 0 } : s) }
    );
  };

  const handleArchiveBox = (id: string, name: string) => {
    if (window.confirm(`Archive box "${name}"? All samples currently within this box will also be archived. This can be fully restored.`)) {
      apiMutate(
        `/api/boxes/${id}`,
        "PATCH",
        { changes: { isArchived: true }, cascadeArchive: true },
        "Box Archived",
        `Archived box "${name}" along with its contained samples.`,
        { ...state, boxes: state.boxes.map(b => b.id === id ? { ...b, isArchived: true } : b),
          samples: state.samples.map(s => s.boxId === id ? { ...s, isArchived: true } : s) }
      );
      setSelectedBoxId(null);
    }
  };

  const handleArchiveShelf = (id: string, name: string) => {
    if (window.confirm(`Archive shelf "${name}"? This archives all racks, drawers, boxes, and samples on this shelf level.`)) {
      apiMutate(
        `/api/shelves/${id}`,
        "PATCH",
        { changes: { isArchived: true }, cascadeArchive: true },
        "Shelf Archived",
        `Archived shelf "${name}" and all sub-containers.`,
        { ...state, shelves: state.shelves.map(s => s.id === id ? { ...s, isArchived: true } : s),
          racks: state.racks.map(r => r.shelfId === id ? { ...r, isArchived: true } : r),
          drawers: state.drawers.map(d => d.shelfId === id ? { ...d, isArchived: true } : d),
          boxes: state.boxes.map(b => b.shelfId === id ? { ...b, isArchived: true } : b),
          samples: state.samples.map(s => s.shelfId === id ? { ...s, isArchived: true } : s) }
      );
      setSelectedShelfId("");
      setSelectedRackId("");
      setSelectedDrawerId("");
      setSelectedBoxId(null);
    }
  };

  const handleArchiveRack = (id: string, name: string) => {
    if (window.confirm(`Archive rack "${name}"? All drawers, boxes, and samples within this rack will also be archived. This is non-destructive and can be undone.`)) {
      apiMutate(
        `/api/racks/${id}`,
        "PATCH",
        { changes: { isArchived: true }, cascadeArchive: true },
        "Rack Archived",
        `Archived rack "${name}" and all nested sub-containers.`,
        { ...state, racks: state.racks.map(r => r.id === id ? { ...r, isArchived: true } : r),
          drawers: state.drawers.map(d => d.rackId === id ? { ...d, isArchived: true } : d),
          boxes: state.boxes.map(b => b.rackId === id ? { ...b, isArchived: true } : b),
          samples: state.samples.map(s => s.rackId === id ? { ...s, isArchived: true } : s) }
      );
      setSelectedRackId("");
      setSelectedDrawerId("");
      setSelectedBoxId(null);
    }
  };

  const handleArchiveDrawer = (id: string, name: string) => {
    if (window.confirm(`Archive drawer "${name}"? All boxes and samples inside this drawer will also be archived. This is non-destructive and can be undone.`)) {
      apiMutate(
        `/api/drawers/${id}`,
        "PATCH",
        { changes: { isArchived: true }, cascadeArchive: true },
        "Drawer Archived",
        `Archived drawer "${name}" and all nested containers.`,
        { ...state, drawers: state.drawers.map(d => d.id === id ? { ...d, isArchived: true } : d),
          boxes: state.boxes.map(b => b.drawerId === id ? { ...b, isArchived: true } : b),
          samples: state.samples.map(s => s.drawerId === id ? { ...s, isArchived: true } : s) }
      );
      setSelectedDrawerId("");
      setSelectedBoxId(null);
    }
  };

  const handleArchiveStorage = (id: string, name: string) => {
    if (window.confirm(`Archive storage unit "${name}"? This archives everything inside.`)) {
      apiMutate(
        `/api/storage-units/${id}`,
        "PATCH",
        { changes: { isArchived: true }, cascadeArchive: true },
        "Storage Unit Archived",
        `Archived storage unit "${name}" and all nested items.`,
        { ...state, storageUnits: state.storageUnits.map(u => u.id === id ? { ...u, isArchived: true } : u),
          shelves: state.shelves.map(s => s.storageId === id ? { ...s, isArchived: true } : s),
          racks: state.racks.map(r => r.storageId === id ? { ...r, isArchived: true } : r),
          drawers: state.drawers.map(d => d.storageId === id ? { ...d, isArchived: true } : d),
          boxes: state.boxes.map(b => b.storageId === id ? { ...b, isArchived: true } : b),
          samples: state.samples.map(s => s.storageId === id ? { ...s, isArchived: true } : s) }
      );
      
      const nextActive = state.storageUnits.find(u => u.id !== id && !u.isArchived);
      setSelectedStorageId(nextActive ? nextActive.id : "");
      setSelectedShelfId("");
      setSelectedRackId("");
      setSelectedDrawerId("");
      setSelectedBoxId(null);
    }
  };

  // Restore operations from Trash Manager
  const handleRestoreItem = (type: "sample" | "box" | "drawer" | "rack" | "shelf" | "storage", item: any) => {
    const name = item.chemicalName || item.name || "item";
    apiMutate(
      "/api/restore",
      "PATCH",
      { type, item },
      `${type.charAt(0).toUpperCase() + type.slice(1)} Restored`,
      `Restored ${type} "${name}" and its contents.`
    );
  };

  const getRestoreImpactSummary = (type: "sample" | "box" | "drawer" | "rack" | "shelf" | "storage", item: any) => {
    if (type === "sample") {
      return "This will restore 1 sample (and unarchive its parent containers if needed).";
    }

    if (type === "box") {
      const sampleCount = state.samples.filter(s => s.boxId === item.id).length;
      return `This will restore 1 box and ${sampleCount} sample(s).`;
    }

    if (type === "drawer") {
      const boxCount = state.boxes.filter(b => b.drawerId === item.id).length;
      const sampleCount = state.samples.filter(s => s.drawerId === item.id).length;
      return `This will restore 1 drawer, ${boxCount} box(es), and ${sampleCount} sample(s).`;
    }

    if (type === "rack") {
      const drawerCount = state.drawers.filter(d => d.rackId === item.id).length;
      const boxCount = state.boxes.filter(b => b.rackId === item.id).length;
      const sampleCount = state.samples.filter(s => s.rackId === item.id).length;
      return `This will restore 1 rack, ${drawerCount} drawer(s), ${boxCount} box(es), and ${sampleCount} sample(s).`;
    }

    if (type === "shelf") {
      const rackCount = state.racks.filter(r => r.shelfId === item.id).length;
      const drawerCount = state.drawers.filter(d => d.shelfId === item.id).length;
      const boxCount = state.boxes.filter(b => b.shelfId === item.id).length;
      const sampleCount = state.samples.filter(s => s.shelfId === item.id).length;
      return `This will restore 1 shelf, ${rackCount} rack(s), ${drawerCount} drawer(s), ${boxCount} box(es), and ${sampleCount} sample(s).`;
    }

    const shelfCount = state.shelves.filter(s => s.storageId === item.id).length;
    const rackCount = state.racks.filter(r => r.storageId === item.id).length;
    const drawerCount = state.drawers.filter(d => d.storageId === item.id).length;
    const boxCount = state.boxes.filter(b => b.storageId === item.id).length;
    const sampleCount = state.samples.filter(s => s.storageId === item.id).length;
    return `This will restore 1 storage unit, ${shelfCount} shelf(s), ${rackCount} rack(s), ${drawerCount} drawer(s), ${boxCount} box(es), and ${sampleCount} sample(s).`;
  };

  const handleRestoreItemWithConfirm = (type: "sample" | "box" | "drawer" | "rack" | "shelf" | "storage", item: any) => {
    const summary = getRestoreImpactSummary(type, item);
    const name = item.chemicalName || item.name || "item";
    const confirmed = window.confirm(`Restore ${type} "${name}"?\n\n${summary}`);
    if (!confirmed) return;
    handleRestoreItem(type, item);
  };

  // Save manual sample additions / edits
  const handleSaveSample = (savedSample: Sample | Sample[]) => {
    const savedSamples = Array.isArray(savedSample) ? savedSample : [savedSample];
    let updatedSamples = [...state.samples];
    let logAct = savedSamples.length > 1 ? "Samples Added" : "Sample Added";
    let logDesc = savedSamples.length > 1
      ? `Added ${savedSamples.length} sample(s) to storage location.`
      : `Added new sample "${savedSamples[0].chemicalName}" to storage location.`;

    savedSamples.forEach(sampleItem => {
      const index = updatedSamples.findIndex(s => s.id === sampleItem.id);
      if (index >= 0) {
        updatedSamples[index] = {
          ...updatedSamples[index],
          ...sampleItem,
        };
        logAct = savedSamples.length > 1 ? "Samples Updated" : "Sample Updated";
        logDesc = savedSamples.length > 1
          ? `Updated ${savedSamples.length} sample(s) in storage location.`
          : `Updated chemical data & coordinates for sample "${sampleItem.chemicalName}".`;
      } else {
        updatedSamples.push({
          ...sampleItem,
          createdAt: sampleItem.createdAt || new Date().toISOString(),
        });
      }
    });

    apiMutate(
      "/api/samples",
      "PUT",
      { samples: savedSamples },
      logAct,
      logDesc,
      { ...state, samples: updatedSamples }
    );
    setSampleModalOpen(false);
    setSampleDefaultRow(null);
    setSampleDefaultCol(null);
    const focusSample = savedSamples[0];
    setSelectedStorageId(focusSample.storageId);
    setSelectedShelfId(focusSample.shelfId);
    setSelectedRackId(focusSample.rackId || "");
    setSelectedDrawerId(focusSample.drawerId || "");
    setSelectedBoxId(focusSample.boxId || null);
    setSelectedSampleId(focusSample.id);
  };

  // Save manual storage units / shelves / boxes
  const handleSaveStorage = (unit: Omit<StorageUnit, "id"> & { id?: string }) => {
    let updatedUnits = [...state.storageUnits];
    let logAct = "Storage Unit Created";
    let logDesc = `Created new storage container: ${unit.name}`;

    if (unit.id) {
      updatedUnits = updatedUnits.map(u => u.id === unit.id ? { ...u, ...unit } as StorageUnit : u);
      logAct = "Storage Unit Updated";
      logDesc = `Renamed storage unit to "${unit.name}"`;
    } else {
      const newUnit: StorageUnit = {
        ...unit,
        id: `store-${Date.now()}`,
        createdAt: unit.createdAt || new Date().toISOString()
      };
      updatedUnits.push(newUnit);
      setSelectedStorageId(newUnit.id);
    }

    const savedUnit = unit.id ? updatedUnits.find(u => u.id === unit.id)! : updatedUnits[updatedUnits.length - 1];
    apiMutate(
      "/api/storage-units",
      "PUT",
      { unit: savedUnit },
      logAct,
      logDesc,
      { ...state, storageUnits: updatedUnits }
    );
    setStorageModalOpen(false);
  };

  const handleSaveShelf = (
    shelf: Omit<Shelf, "id"> & {
      id?: string;
      defaultRackRows?: number | null;
      defaultRackCols?: number | null;
      defaultDrawerBoxCapacity?: number | null;
    }
  ) => {
    const { defaultRackRows, defaultRackCols, defaultDrawerBoxCapacity, ...shelfData } = shelf;
    let updatedShelves = [...state.shelves];
    let updatedRacks = [...state.racks];
    let updatedDrawers = [...state.drawers];
    let logAct = "Shelf Created";
    let logDesc = `Created new shelf level: ${shelfData.name}`;

    const toAlphabetLabel = (index: number) => {
      let value = index;
      let label = "";
      while (value >= 0) {
        label = String.fromCharCode(65 + (value % 26)) + label;
        value = Math.floor(value / 26) - 1;
      }
      return label;
    };

    if (shelfData.id) {
      updatedShelves = updatedShelves.map(s => s.id === shelfData.id ? { ...s, ...shelfData } as Shelf : s);
      logAct = "Shelf Updated";
      logDesc = `Renamed shelf level to "${shelfData.name}"`;
    } else {
      const newShelf: Shelf = {
        ...shelfData,
        id: `shelf-${Date.now()}`,
        createdAt: shelfData.createdAt || new Date().toISOString()
      };
      updatedShelves.push(newShelf);
      setSelectedShelfId(newShelf.id);

      const rackCount = Number(newShelf.cols) || 0;
      const rackRows = Math.max(1, Math.min(20, Number(defaultRackRows) || 6));
      const rackCols = Math.max(1, Math.min(20, Number(defaultRackCols) || 1));
      const drawerBoxCapacity = Math.max(1, Math.min(500, Number(defaultDrawerBoxCapacity) || 4));
      if (rackCount > 0) {
        const createdAt = Date.now();
        const autoRacks: Rack[] = Array.from({ length: rackCount }, (_, idx) => ({
          id: `rack-${createdAt}-${idx + 1}`,
          storageId: newShelf.storageId,
          shelfId: newShelf.id,
          name: toAlphabetLabel(idx),
          rows: rackRows,
          cols: rackCols,
          shelfCol: idx + 1,
          isArchived: false,
          createdAt: new Date().toISOString()
        }));
        updatedRacks = [...updatedRacks, ...autoRacks];

        const autoDrawers: Drawer[] = autoRacks.flatMap((rackItem, rackIdx) =>
          Array.from({ length: rackRows }, (_, drawerIdx) => ({
            id: `drawer-${createdAt}-${rackIdx + 1}-${drawerIdx + 1}`,
            rackId: rackItem.id,
            shelfId: rackItem.shelfId,
            storageId: rackItem.storageId,
            name: toAlphabetLabel(drawerIdx),
            boxCapacity: drawerBoxCapacity,
            isArchived: false,
            createdAt: new Date().toISOString()
          }))
        );

        updatedDrawers = [...updatedDrawers, ...autoDrawers];
        logDesc = `Created new shelf level: ${shelfData.name} with ${rackCount} auto-generated racks and ${autoDrawers.length} drawers.`;
      }
    }

    if (shelfData.id) {
      const savedShelf = updatedShelves.find(s => s.id === shelfData.id);
      const desiredRackCount = Number(savedShelf?.cols) || 0;
      const rackRows = Math.max(1, Math.min(20, Number(defaultRackRows) || 6));
      const rackCols = Math.max(1, Math.min(20, Number(defaultRackCols) || 1));
      const drawerBoxCapacity = Math.max(1, Math.min(500, Number(defaultDrawerBoxCapacity) || 4));

      if (savedShelf && desiredRackCount > 0) {
        const activeRacks = updatedRacks.filter(r => r.shelfId === savedShelf.id && !r.isArchived);
        const occupiedSlots = new Set(activeRacks.map(r => r.shelfCol).filter((slot): slot is number => typeof slot === "number"));
        const missingSlots = Array.from({ length: desiredRackCount }, (_, idx) => idx + 1)
          .filter(slot => !occupiedSlots.has(slot));

        if (missingSlots.length > 0) {
          const createdAt = Date.now();
          const autoRacks: Rack[] = missingSlots.map((slot, idx) => ({
            id: `rack-${createdAt}-${idx + 1}`,
            storageId: savedShelf.storageId,
            shelfId: savedShelf.id,
            name: toAlphabetLabel(slot - 1),
            rows: rackRows,
            cols: rackCols,
            shelfCol: slot,
            isArchived: false,
            createdAt: new Date().toISOString()
          }));

          updatedRacks = [...updatedRacks, ...autoRacks];

          const autoDrawers: Drawer[] = autoRacks.flatMap((rackItem, rackIdx) =>
            Array.from({ length: rackRows }, (_, drawerIdx) => ({
              id: `drawer-${createdAt}-${rackIdx + 1}-${drawerIdx + 1}`,
              rackId: rackItem.id,
              shelfId: rackItem.shelfId,
              storageId: rackItem.storageId,
              name: toAlphabetLabel(drawerIdx),
              boxCapacity: drawerBoxCapacity,
              isArchived: false,
              createdAt: new Date().toISOString()
            }))
          );

          updatedDrawers = [...updatedDrawers, ...autoDrawers];
          logDesc = `Updated shelf "${shelfData.name}" and auto-created ${autoRacks.length} racks for new positions with ${autoDrawers.length} drawers.`;
        }
      }
    }

    const savedShelf = shelfData.id ? updatedShelves.find(s => s.id === shelfData.id)! : updatedShelves[updatedShelves.length - 1];
    const newAutoRacks = updatedRacks.filter(r => !state.racks.some(sr => sr.id === r.id));
    const newAutoDrawers = updatedDrawers.filter(d => !state.drawers.some(sd => sd.id === d.id));
    apiMutate(
      "/api/shelves",
      "PUT",
      { shelf: savedShelf, autoRacks: newAutoRacks, autoDrawers: newAutoDrawers },
      logAct,
      logDesc,
      { ...state, shelves: updatedShelves, racks: updatedRacks, drawers: updatedDrawers }
    );
    setStorageModalOpen(false);
  };

  const handleSaveRack = (
    rack: Omit<Rack, "id"> & {
      id?: string;
      defaultDrawerBoxCapacity?: number | null;
    }
  ) => {
    const { defaultDrawerBoxCapacity, ...rackData } = rack;
    let updatedRacks = [...state.racks];
    let updatedDrawers = [...state.drawers];
    let logAct = "Rack Created";
    let logDesc = `Created new rack: ${rackData.name}`;

    const toAlphabetLabel = (index: number) => {
      let value = index;
      let label = "";
      while (value >= 0) {
        label = String.fromCharCode(65 + (value % 26)) + label;
        value = Math.floor(value / 26) - 1;
      }
      return label;
    };

    if (rackData.id) {
      updatedRacks = updatedRacks.map(r => r.id === rackData.id ? { ...r, ...rackData } as Rack : r);
      logAct = "Rack Updated";
      logDesc = `Updated configurations of rack "${rackData.name}"`;

      const desiredDrawerCount = Number(rackData.rows) || 0;
      const drawerBoxCapacity = Math.max(1, Math.min(500, Number(defaultDrawerBoxCapacity) || 4));
      if (desiredDrawerCount > 0) {
        const existingDrawers = updatedDrawers.filter(d => d.rackId === rackData.id && !d.isArchived);
        const drawersToCreate = desiredDrawerCount - existingDrawers.length;

        if (drawersToCreate > 0) {
          const usedNames = new Set(existingDrawers.map(d => d.name.trim().toUpperCase()));
          let cursor = 0;
          const nextAvailableLabel = () => {
            while (usedNames.has(toAlphabetLabel(cursor))) {
              cursor += 1;
            }
            const label = toAlphabetLabel(cursor);
            usedNames.add(label);
            cursor += 1;
            return label;
          };

          const createdAt = Date.now();
          const autoDrawers: Drawer[] = Array.from({ length: drawersToCreate }, (_, idx) => ({
            id: `drawer-${createdAt}-${idx + 1}`,
            rackId: rackData.id as string,
            shelfId: rackData.shelfId,
            storageId: rackData.storageId,
            name: nextAvailableLabel(),
            boxCapacity: drawerBoxCapacity,
            isArchived: false,
            createdAt: new Date().toISOString()
          }));

          updatedDrawers = [...updatedDrawers, ...autoDrawers];
          logDesc = `Updated configurations of rack "${rackData.name}" and auto-created ${autoDrawers.length} drawers.`;
        }
      }
    } else {
      const newRack: Rack = {
        ...rackData,
        id: `rack-${Date.now()}`,
        createdAt: rackData.createdAt || new Date().toISOString()
      };
      updatedRacks.push(newRack);

      const drawerCount = Number(newRack.rows) || 0;
      const drawerBoxCapacity = Math.max(1, Math.min(500, Number(defaultDrawerBoxCapacity) || 4));
      if (drawerCount > 0) {
        const createdAt = Date.now();
        const autoDrawers: Drawer[] = Array.from({ length: drawerCount }, (_, idx) => ({
          id: `drawer-${createdAt}-${idx + 1}`,
          rackId: newRack.id,
          shelfId: newRack.shelfId,
          storageId: newRack.storageId,
          name: toAlphabetLabel(idx),
          boxCapacity: drawerBoxCapacity,
          isArchived: false,
          createdAt: new Date().toISOString()
        }));
        updatedDrawers = [...updatedDrawers, ...autoDrawers];
        logDesc = `Created new rack: ${rackData.name} with ${drawerCount} auto-generated drawers (${autoDrawers.map(d => d.name).join(", ")}).`;
      }

    }

    const savedRack = rackData.id ? updatedRacks.find(r => r.id === rackData.id)! : updatedRacks[updatedRacks.length - 1];
    const newAutoDrawers = updatedDrawers.filter(d => !state.drawers.some(sd => sd.id === d.id));
    apiMutate(
      "/api/racks",
      "PUT",
      { rack: savedRack, autoDrawers: newAutoDrawers },
      logAct,
      logDesc,
      { ...state, racks: updatedRacks, drawers: updatedDrawers }
    );
    setStorageModalOpen(false);
  };

  const handleSaveDrawer = (drawer: Omit<Drawer, "id"> & { id?: string }) => {
    const requestedCapacity = Math.max(1, Math.min(500, Number(drawer.boxCapacity) || 4));

    let updatedDrawers = [...state.drawers];
    let logAct = "Drawer Created";
    let logDesc = `Created new drawer: ${drawer.name}`;

    if (drawer.id) {
      const activeBoxesInDrawer = state.boxes.filter(b => b.drawerId === drawer.id && !b.isArchived);
      const highestAssignedSlot = activeBoxesInDrawer.reduce((max, b) => {
        const slot = typeof b.drawerSlot === "number" ? b.drawerSlot : 0;
        return Math.max(max, slot);
      }, 0);

      if (activeBoxesInDrawer.length > requestedCapacity || highestAssignedSlot > requestedCapacity) {
        alert(`Cannot set drawer capacity to ${requestedCapacity}. This drawer currently uses ${activeBoxesInDrawer.length} box(es) and slot ${highestAssignedSlot}.`);
        return;
      }

      updatedDrawers = updatedDrawers.map(d => d.id === drawer.id ? { ...d, ...drawer, boxCapacity: requestedCapacity } as Drawer : d);
      logAct = "Drawer Updated";
      logDesc = `Updated configurations of drawer "${drawer.name}"`;
    } else {
      const newDrawer: Drawer = {
        ...drawer,
        boxCapacity: requestedCapacity,
        id: `drawer-${Date.now()}`,
        createdAt: drawer.createdAt || new Date().toISOString()
      };
      updatedDrawers.push(newDrawer);
    }

    const savedDrawer = drawer.id ? updatedDrawers.find(d => d.id === drawer.id)! : updatedDrawers[updatedDrawers.length - 1];
    apiMutate(
      "/api/drawers",
      "PUT",
      { drawer: savedDrawer },
      logAct,
      logDesc,
      { ...state, drawers: updatedDrawers }
    );
    setStorageModalOpen(false);
  };

  const handleSaveBox = (box: Omit<Box, "id"> & { id?: string }) => {
    const targetDrawer = box.drawerId ? state.drawers.find(d => d.id === box.drawerId && !d.isArchived) : null;
    let boxToSave: Omit<Box, "id"> & { id?: string } = {
      ...box,
      drawerSlot: box.drawerId ? box.drawerSlot ?? null : null
    };

    if (targetDrawer) {
      const drawerCapacity = getDrawerCapacity(targetDrawer);
      const existingInDrawer = state.boxes.filter(
        b => !b.isArchived && b.drawerId === targetDrawer.id && b.id !== box.id
      ).length;
      if (existingInDrawer >= drawerCapacity) {
        alert(`Drawer "${targetDrawer.name}" is at capacity (${drawerCapacity} boxes).`);
        return;
      }

      const occupiedSlots = new Set(
        state.boxes
          .filter(b => !b.isArchived && b.drawerId === targetDrawer.id && b.id !== box.id && typeof b.drawerSlot === "number")
          .map(b => b.drawerSlot as number)
      );

      let finalDrawerSlot = typeof box.drawerSlot === "number" ? box.drawerSlot : null;
      if (finalDrawerSlot && (finalDrawerSlot < 1 || finalDrawerSlot > drawerCapacity)) {
        alert(`Drawer slot must be between 1 and ${drawerCapacity}.`);
        return;
      }
      if (finalDrawerSlot && occupiedSlots.has(finalDrawerSlot)) {
        alert(`Drawer slot ${finalDrawerSlot} is already occupied in "${targetDrawer.name}".`);
        return;
      }

      if (!finalDrawerSlot) {
        finalDrawerSlot = Array.from({ length: drawerCapacity }, (_, idx) => idx + 1)
          .find(slot => !occupiedSlots.has(slot)) || null;
        if (!finalDrawerSlot) {
          alert(`No free drawer slots remain in "${targetDrawer.name}".`);
          return;
        }
      }

      boxToSave = {
        ...boxToSave,
        drawerSlot: finalDrawerSlot
      };
    }

    if (!box.drawerId) {
      boxToSave = {
        ...boxToSave,
        drawerSlot: null
      };
    }

    let updatedBoxes = [...state.boxes];
    let updatedSamples = [...state.samples];
    let logAct = "Box Container Created";
    let logDesc = `Created box: ${boxToSave.name}`;
    let finalBox: Box;

    if (boxToSave.id) {
      updatedBoxes = updatedBoxes.map(b => b.id === boxToSave.id ? { ...b, ...boxToSave } as Box : b);
      finalBox = updatedBoxes.find(b => b.id === boxToSave.id) as Box;
      const boxLocationChanged = state.boxes.some(existingBox =>
        existingBox.id === finalBox.id && (
          existingBox.storageId !== finalBox.storageId ||
          existingBox.shelfId !== finalBox.shelfId ||
          existingBox.rackId !== finalBox.rackId ||
          existingBox.drawerId !== finalBox.drawerId
        )
      );
      if (boxLocationChanged) {
        updatedSamples = syncSamplesToBoxLocation(state.samples, finalBox);
      }
      logAct = "Box Updated";
      logDesc = `Updated configurations of box "${boxToSave.name}"`;
    } else {
      const newBox: Box = {
        ...boxToSave,
        id: `box-${Date.now()}`,
        createdAt: boxToSave.createdAt || new Date().toISOString()
      };
      updatedBoxes.push(newBox);
      finalBox = newBox;
    }

    apiMutate(
      "/api/boxes",
      "PUT",
      { box: finalBox },
      logAct,
      logDesc,
      { ...state, boxes: updatedBoxes, samples: updatedSamples }
    );
    setBoxDefaultDrawerSlot(null);
    setStorageModalOpen(false);
  };

  const hasAnyActiveShelf = useMemo(() => {
    return state.shelves.some(s => !s.isArchived);
  }, [state.shelves]);

  const handleOpenNewSampleModal = () => {
    const activeStorages = state.storageUnits.filter(u => !u.isArchived);
    const activeShelves = state.shelves.filter(s => !s.isArchived);
    if (!activeStorages.length || !activeShelves.length) {
      alert("Please create at least one storage unit and shelf before adding samples.");
      return;
    }

    const targetStorageId = selectedStorageId || activeStorages[0].id;
    const shelvesInStorage = activeShelves.filter(s => s.storageId === targetStorageId);
    const fallbackShelf = shelvesInStorage[0] || activeShelves[0];

    if (!fallbackShelf) {
      alert("Please create at least one shelf before adding samples.");
      return;
    }

    setSelectedStorageId(fallbackShelf.storageId);
    setSelectedShelfId(selectedShelfId || fallbackShelf.id);
    setEditingSample(null);
    setSampleDefaultRow(null);
    setSampleDefaultCol(null);
    setSampleModalOpen(true);
  };

  const handleOpenNewSampleAtGridCell = (row: number, col: number) => {
    if (!currentBox) return;
    setEditingSample(null);
    setSelectedStorageId(currentBox.storageId);
    setSelectedShelfId(currentBox.shelfId);
    setSelectedRackId(currentBox.rackId || "");
    setSelectedDrawerId(currentBox.drawerId || "");
    setSelectedBoxId(currentBox.id);
    setSampleDefaultRow(row);
    setSampleDefaultCol(col);
    setSampleModalOpen(true);
  };

  const handleOpenEditSampleModal = (sample: Sample) => {
    setSelectedSampleId(sample.id);
    setEditingSample(sample);
    setSampleDefaultRow(null);
    setSampleDefaultCol(null);
    setSampleModalOpen(true);
  };

  const handleOpenNewBoxModal = (drawerSlot: number | null = null) => {
    if (currentDrawer) {
      setSelectedStorageId(currentDrawer.storageId);
      setSelectedShelfId(currentDrawer.shelfId);
      setSelectedRackId(currentDrawer.rackId);
      setSelectedDrawerId(currentDrawer.id);
      setSelectedBoxId(null);
    }
    setEditingStorageItem(null);
    setStorageModalMode("box");
    setBoxDefaultDrawerSlot(drawerSlot);
    setStorageModalOpen(true);
  };

  const bulkSelectableItems = useMemo(() => {
    if (bulkItemType === "rack") {
      return state.racks
        .filter(r => {
          if (r.isArchived) return false;
          if (selectedShelfId) return r.shelfId === selectedShelfId;
          if (selectedStorageId) return r.storageId === selectedStorageId;
          return true;
        })
        .map(r => ({ id: r.id, label: r.name }));
    }

    if (bulkItemType === "drawer") {
      return state.drawers
        .filter(d => {
          if (d.isArchived) return false;
          if (selectedRackId) return d.rackId === selectedRackId;
          if (selectedShelfId) return d.shelfId === selectedShelfId;
          if (selectedStorageId) return d.storageId === selectedStorageId;
          return true;
        })
        .map(d => ({ id: d.id, label: d.name }));
    }

    if (bulkItemType === "box") {
      return state.boxes
        .filter(b => {
          if (b.isArchived) return false;
          if (selectedDrawerId) return b.drawerId === selectedDrawerId;
          if (selectedRackId) return b.rackId === selectedRackId;
          if (selectedShelfId) return b.shelfId === selectedShelfId;
          if (selectedStorageId) return b.storageId === selectedStorageId;
          return true;
        })
        .map(b => ({ id: b.id, label: b.name }));
    }

    return state.samples
      .filter(s => {
        if (s.isArchived) return false;
        if (selectedBoxId) return s.boxId === selectedBoxId;
        if (selectedDrawerId) return s.drawerId === selectedDrawerId;
        if (selectedRackId) return s.rackId === selectedRackId;
        if (selectedShelfId) return s.shelfId === selectedShelfId;
        if (selectedStorageId) return s.storageId === selectedStorageId;
        return true;
      })
      .map(s => ({ id: s.id, label: s.chemicalName }));
  }, [bulkItemType, state.racks, state.drawers, state.boxes, state.samples, selectedStorageId, selectedShelfId, selectedRackId, selectedDrawerId, selectedBoxId]);

  useEffect(() => {
    setBulkSelectedIds(prev => prev.filter(id => bulkSelectableItems.some(item => item.id === id)));
  }, [bulkSelectableItems]);

  const handleConfirmBulkMove = async (destination: {
    storageId: string;
    shelfId: string;
    rackId: string | null;
    drawerId: string | null;
    boxId: string | null;
    drawerSlot: number | null;
  }) => {
    if (!bulkSelectedIds.length) return;

    if (bulkItemType === "sample") {
      const destinationBox = destination.boxId ? state.boxes.find(b => b.id === destination.boxId) : null;
      apiMutate(
        "/api/bulk-move",
        "PATCH",
        {
          itemType: "sample",
          ids: [...bulkSelectedIds],
          destination: {
            storageId: destination.storageId,
            shelfId: destination.shelfId,
            rackId: destinationBox?.rackId || destination.rackId,
            drawerId: destinationBox?.drawerId || destination.drawerId,
            boxId: destination.boxId
          }
        },
        "Samples Bulk Relocated",
        `Moved ${bulkSelectedIds.length} sample(s) via bulk action.`,
        { ...state, samples: state.samples.map(s => bulkSelectedIds.includes(s.id) ? { ...s, storageId: destination.storageId, shelfId: destination.shelfId, rackId: destinationBox?.rackId || destination.rackId, drawerId: destinationBox?.drawerId || destination.drawerId, boxId: destination.boxId } : s) }
      );
    }

    if (bulkItemType === "box") {
      const destinationSlotMap = new Map<string, number | null>();
      if (destination.drawerId) {
        const destinationDrawer = state.drawers.find(d => d.id === destination.drawerId && !d.isArchived);
        if (destinationDrawer) {
          const drawerCapacity = getDrawerCapacity(destinationDrawer);

          if (destination.drawerSlot !== null) {
            if (bulkSelectedIds.length !== 1) {
              alert("Select exactly one box when targeting a specific drawer slot.");
              return;
            }

            if (destination.drawerSlot < 1 || destination.drawerSlot > drawerCapacity) {
              alert(`Slot must be between 1 and ${drawerCapacity} for drawer "${destinationDrawer.name}".`);
              return;
            }

            const selectedBox = state.boxes.find(b => b.id === bulkSelectedIds[0] && !b.isArchived);
            if (!selectedBox) {
              alert("Selected box was not found.");
              return;
            }

            const slotOccupant = state.boxes.find(
              b =>
                !b.isArchived &&
                b.drawerId === destinationDrawer.id &&
                typeof b.drawerSlot === "number" &&
                b.drawerSlot === destination.drawerSlot &&
                b.id !== selectedBox.id
            );

            if (slotOccupant) {
              alert(`Drawer slot ${destination.drawerSlot} is occupied by "${slotOccupant.name}".`);
              return;
            }

            destinationSlotMap.set(selectedBox.id, destination.drawerSlot);
          }

          const existingCount = state.boxes.filter(
            b => !b.isArchived && b.drawerId === destinationDrawer.id && !bulkSelectedIds.includes(b.id)
          ).length;
          const incomingCount = state.boxes.filter(
            b => bulkSelectedIds.includes(b.id) && b.drawerId !== destinationDrawer.id
          ).length;
          if (existingCount + incomingCount > drawerCapacity) {
            alert(`Cannot move ${incomingCount} box(es). Drawer "${destinationDrawer.name}" capacity is ${drawerCapacity}.`);
            return;
          }

          const occupiedSlots = new Set(
            state.boxes
              .filter(
                b => !b.isArchived &&
                  b.drawerId === destinationDrawer.id &&
                  !bulkSelectedIds.includes(b.id) &&
                  typeof b.drawerSlot === "number"
              )
              .map(b => b.drawerSlot as number)
          );

          if (destination.drawerSlot !== null) {
            occupiedSlots.add(destination.drawerSlot);
          }

          const movingBoxes = state.boxes.filter(b => bulkSelectedIds.includes(b.id));
          let slotCursor = 1;
          const allocateNextSlot = (): number | null => {
            while (slotCursor <= drawerCapacity) {
              if (!occupiedSlots.has(slotCursor)) {
                const slot = slotCursor;
                occupiedSlots.add(slot);
                slotCursor += 1;
                return slot;
              }
              slotCursor += 1;
            }
            return null;
          };

          movingBoxes.forEach(boxItem => {
            if (destinationSlotMap.has(boxItem.id)) {
              return;
            }

            if (
              boxItem.drawerId === destinationDrawer.id &&
              typeof boxItem.drawerSlot === "number" &&
              boxItem.drawerSlot >= 1 &&
              boxItem.drawerSlot <= drawerCapacity &&
              !occupiedSlots.has(boxItem.drawerSlot)
            ) {
              occupiedSlots.add(boxItem.drawerSlot);
              destinationSlotMap.set(boxItem.id, boxItem.drawerSlot);
              return;
            }

            const allocatedSlot = allocateNextSlot();
            destinationSlotMap.set(boxItem.id, allocatedSlot);
          });
        }
      }

      const updatedBoxes = state.boxes.map(b => {
        if (!bulkSelectedIds.includes(b.id)) return b;
        return {
          ...b,
          storageId: destination.storageId,
          shelfId: destination.shelfId,
          rackId: destination.rackId,
          drawerId: destination.drawerId,
          drawerSlot: destination.drawerId ? (destinationSlotMap.get(b.id) ?? null) : null,
          shelfCol: null
        };
      });

      const updatedSamples = state.samples.map(s => {
        if (!s.boxId || !bulkSelectedIds.includes(s.boxId)) return s;
        return {
          ...s,
          storageId: destination.storageId,
          shelfId: destination.shelfId,
          rackId: destination.rackId,
          drawerId: destination.drawerId
        };
      });

      await apiMutate(
        "/api/bulk-move",
        "PATCH",
        {
          itemType: "box",
          ids: [...bulkSelectedIds],
          destination: {
            storageId: destination.storageId,
            shelfId: destination.shelfId,
            rackId: destination.rackId,
            drawerId: destination.drawerId,
            drawerSlots: Object.fromEntries(
              bulkSelectedIds.map(id => [id, destinationSlotMap.get(id) ?? null])
            )
          }
        },
        "Boxes Bulk Relocated",
        `Moved ${bulkSelectedIds.length} box(es) via bulk action.`,
        { ...state, boxes: updatedBoxes, samples: updatedSamples }
      );
    }

    if (bulkItemType === "drawer") {
      if (!destination.rackId) {
        alert("Please select a rack destination for drawers.");
        return;
      }

      const targetRack = state.racks.find(r => r.id === destination.rackId);
      if (!targetRack) return;

      apiMutate(
        "/api/bulk-move",
        "PATCH",
        {
          itemType: "drawer",
          ids: [...bulkSelectedIds],
          destination: {
            storageId: destination.storageId,
            shelfId: destination.shelfId,
            rackId: destination.rackId
          }
        },
        "Drawers Bulk Relocated",
        `Moved ${bulkSelectedIds.length} drawer(s) via bulk action.`,
        { ...state, drawers: state.drawers.map(d => bulkSelectedIds.includes(d.id) ? { ...d, rackId: destination.rackId, shelfId: destination.shelfId, storageId: destination.storageId } : d) }
      );
    }

    if (bulkItemType === "rack") {
      apiMutate(
        "/api/bulk-move",
        "PATCH",
        {
          itemType: "rack",
          ids: [...bulkSelectedIds],
          destination: {
            storageId: destination.storageId,
            shelfId: destination.shelfId
          }
        },
        "Racks Bulk Relocated",
        `Moved ${bulkSelectedIds.length} rack(s) via bulk action.`,
        {
          ...state,
          racks: state.racks.map(r => bulkSelectedIds.includes(r.id) ? { ...r, shelfId: destination.shelfId, storageId: destination.storageId } : r),
          drawers: state.drawers.map(d => bulkSelectedIds.includes(d.rackId) ? { ...d, shelfId: destination.shelfId, storageId: destination.storageId } : d),
          boxes: state.boxes.map(b => b.rackId && bulkSelectedIds.includes(b.rackId) ? { ...b, shelfId: destination.shelfId, storageId: destination.storageId } : b),
          samples: state.samples.map(s => s.rackId && bulkSelectedIds.includes(s.rackId) ? { ...s, shelfId: destination.shelfId, storageId: destination.storageId } : s)
        }
      );
    }

    setBulkMoveOpen(false);
    setBulkSelectOpen(false);
    setBulkSelectedIds([]);
    setSelectedGridSampleIds([]);
    setGridSelectionAnchorId(null);
  };

  const handleBulkArchive = async () => {
    if (!bulkSelectedIds.length) return;

    const proceed = window.confirm(`Archive ${bulkSelectedIds.length} selected ${bulkItemType}(s)? This can be restored from Trash.`);
    if (!proceed) return;

    if (bulkItemType === "sample") {
      apiMutate(
        "/api/samples/bulk",
        "PATCH",
        { ids: [...bulkSelectedIds], changes: { isArchived: true } },
        "Samples Bulk Archived",
        `Archived ${bulkSelectedIds.length} sample(s).`,
        { ...state, samples: state.samples.map(s => bulkSelectedIds.includes(s.id) ? { ...s, isArchived: true } : s) }
      );
    }

    if (bulkItemType === "box") {
      // Archive each box via cascade-archive (server handles nested samples)
      for (const boxId of bulkSelectedIds) {
        await apiMutate(`/api/boxes/${boxId}`, "PATCH",
          { changes: { isArchived: true }, cascadeArchive: true },
          "Boxes Bulk Archived",
          `Archived ${bulkSelectedIds.length} box(es) and contained samples.`);
      }
    }

    if (bulkItemType === "drawer") {
      // Archive each drawer via cascade-archive (server handles nested boxes+samples)
      for (const drawerId of bulkSelectedIds) {
        await apiMutate(`/api/drawers/${drawerId}`, "PATCH",
          { changes: { isArchived: true }, cascadeArchive: true },
          "Drawers Bulk Archived",
          `Archived ${bulkSelectedIds.length} drawer(s) and nested contents.`);
      }
    }

    if (bulkItemType === "rack") {
      // Archive each rack via cascade-archive (server handles nested drawers+boxes+samples)
      for (const rackId of bulkSelectedIds) {
        await apiMutate(`/api/racks/${rackId}`, "PATCH",
          { changes: { isArchived: true }, cascadeArchive: true },
          "Racks Bulk Archived",
          `Archived ${bulkSelectedIds.length} rack(s) and nested contents.`);
      }
    }

    setBulkSelectedIds([]);
    setBulkSelectOpen(false);
  };

  // Bulk Import Panel Completion handler
  const handleBulkImportComplete = async (importedData: {
    samples: Sample[];
    newStorageUnits: StorageUnit[];
    newShelves: Shelf[];
    newRacks: Rack[];
    newDrawers: Drawer[];
    newBoxes: Box[];
  }): Promise<boolean> => {
    const mergeArrays = <T extends { id: string }>(existing: T[], incoming: T[]): T[] => {
      const newIds = new Set(incoming.map(i => i.id));
      return [...incoming, ...existing.filter(e => !newIds.has(e.id))];
    };
    const result = await apiMutate(
      "/api/bulk-import",
      "POST",
      {
        samples: importedData.samples,
        newStorageUnits: importedData.newStorageUnits,
        newShelves: importedData.newShelves,
        newRacks: importedData.newRacks,
        newDrawers: importedData.newDrawers,
        newBoxes: importedData.newBoxes
      },
      "Bulk CSV Import",
      `Successfully imported ${importedData.samples.length} sample(s) and ${importedData.newBoxes.length} box(es) from external sheet with header mapping.`,
      {
        ...state,
        storageUnits: mergeArrays(state.storageUnits, importedData.newStorageUnits),
        shelves: mergeArrays(state.shelves, importedData.newShelves),
        racks: mergeArrays(state.racks, importedData.newRacks),
        drawers: mergeArrays(state.drawers, importedData.newDrawers),
        boxes: mergeArrays(state.boxes, importedData.newBoxes),
        samples: mergeArrays(state.samples, importedData.samples)
      }
    );
    if (!result) {
      alert("Bulk import could not be committed to the server. Your review plan is still available; please retry.");
      return false;
    }

    setShowBulkImport(false);
    return true;
  };

  const handleBulkRenameComplete = async (plan: {
    operations: Array<{
      entityType: "storage" | "shelf" | "rack" | "drawer" | "box" | "sample";
      id: string;
      oldName: string;
      newName: string;
    }>;
  }): Promise<boolean> => {
    if (!plan.operations.length) {
      alert("No valid rename operations to apply.");
      return false;
    }

    const updatedState: InventoryState = {
      ...state,
      storageUnits: [...state.storageUnits],
      shelves: [...state.shelves],
      racks: [...state.racks],
      drawers: [...state.drawers],
      boxes: [...state.boxes],
      samples: [...state.samples]
    };

    plan.operations.forEach((op) => {
      if (op.entityType === "storage") {
        updatedState.storageUnits = updatedState.storageUnits.map(item =>
          item.id === op.id ? { ...item, name: op.newName } : item
        );
      } else if (op.entityType === "shelf") {
        updatedState.shelves = updatedState.shelves.map(item =>
          item.id === op.id ? { ...item, name: op.newName } : item
        );
      } else if (op.entityType === "rack") {
        updatedState.racks = updatedState.racks.map(item =>
          item.id === op.id ? { ...item, name: op.newName } : item
        );
      } else if (op.entityType === "drawer") {
        updatedState.drawers = updatedState.drawers.map(item =>
          item.id === op.id ? { ...item, name: op.newName } : item
        );
      } else if (op.entityType === "box") {
        updatedState.boxes = updatedState.boxes.map(item =>
          item.id === op.id ? { ...item, name: op.newName } : item
        );
      } else {
        updatedState.samples = updatedState.samples.map(item =>
          item.id === op.id ? { ...item, chemicalName: op.newName } : item
        );
      }
    });

    const result = await apiMutate(
      "/api/bulk-rename",
      "POST",
      { operations: plan.operations },
      "Bulk Rename",
      `Applied ${plan.operations.length} rename operation(s).`,
      updatedState
    );

    if (!result) {
      alert("Bulk rename could not be committed to the server. Please retry.");
      return false;
    }

    setShowBulkRename(false);
    return true;
  };

  // Drag and Drop implementations for Grid slots
  const handleDragStart = (e: React.DragEvent, sampleId: string) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", sampleId);
    setDraggedSampleId(sampleId);
  };

  const handleDragOver = (e: React.DragEvent, r: number, c: number) => {
    e.preventDefault();
    setDragOverCell({ row: r, col: c });
  };

  const handleDragLeave = () => {
    setDragOverCell(null);
  };

  const handleDropOnGrid = (e: React.DragEvent, targetRow: number, targetCol: number) => {
    e.preventDefault();
    const sampleId = e.dataTransfer.getData("text/plain") || draggedSampleId;
    setDragOverCell(null);
    setDraggedSampleId(null);

    if (!sampleId) return;

    const targetSample = state.samples.find(s => s.id === sampleId);
    if (!targetSample) return;

    // Check collision with another sample in the exact same coordinates of the current box
    const collision = state.samples.find(s => 
      s.boxId === selectedBoxId &&
      s.row === targetRow &&
      s.col === targetCol &&
      s.id !== sampleId &&
      !s.isArchived
    );

    if (collision) {
      alert(`Cannot move to row ${targetRow}, col ${targetCol}. It is already occupied by "${collision.chemicalName}".`);
      return;
    }

    // Storage compatibility check: warn if incompatible chemicals are in the same box
    if (targetSample.storageClass) {
      const boxSamples = state.samples.filter(s =>
        s.boxId === selectedBoxId && s.id !== sampleId && !s.isArchived
      );
      const incompatible = checkCompatibility(targetSample, boxSamples);
      if (incompatible.length > 0) {
        const proceed = confirm(
          `⚠ Storage Compatibility Warning\n\n` +
          `"${targetSample.chemicalName}" (${targetSample.storageClass}) may be incompatible with:\n` +
          incompatible.join("\n") +
          `\n\nPlace it here anyway?`
        );
        if (!proceed) return;
      }
    }

    // Move sample to selected location
    const boxName = currentBox?.name || "Target Box";
    apiMutate(
      `/api/samples/${sampleId}`,
      "PATCH",
      {
        storageId: selectedStorageId,
        shelfId: selectedShelfId,
        boxId: selectedBoxId,
        row: targetRow,
        col: targetCol
      },
      "Sample Relocated",
      `Relocated "${targetSample.chemicalName}" to ${boxName} [Row ${targetRow}, Col ${targetCol}] via drag-and-drop.`,
      { ...state, samples: state.samples.map(s => s.id === sampleId ? { ...s, storageId: selectedStorageId, shelfId: selectedShelfId, boxId: selectedBoxId, row: targetRow, col: targetCol } : s) }
    );

    setSelectedSampleId(sampleId);
  };

  const handleDropMove = (e: React.DragEvent, targetType: "shelf" | "rack" | "drawer" | "slot", targetId: string, targetCol?: number | null) => {
    e.preventDefault();
    e.stopPropagation();
    
    let dragDataStr = "";
    try {
      dragDataStr = e.dataTransfer.getData("text/plain");
    } catch (err) {
      // safe fallback
    }
    
    if (!dragDataStr) return;
    
    let dragData: { type: "rack" | "drawer" | "box" | "sample"; id: string } | null = null;
    try {
      dragData = JSON.parse(dragDataStr);
    } catch (err) {
      if (typeof dragDataStr === "string" && dragDataStr.length > 0) {
        dragData = { type: "sample", id: dragDataStr };
      }
    }
    
    if (!dragData) return;
    const { type: draggedType, id: draggedId } = dragData;
    
    if (draggedType === targetType && draggedId === targetId) return;
    
    let updatedRacks = [...state.racks];
    let updatedDrawers = [...state.drawers];
    let updatedBoxes = [...state.boxes];
    let updatedSamples = [...state.samples];
    
    let actionName = "";
    let actionDesc = "";
    
    if (draggedType === "sample") {
      const sample = state.samples.find(s => s.id === draggedId && !s.isArchived);
      if (!sample || targetType !== "drawer") return;

      const drawer = state.drawers.find(d => d.id === targetId && !d.isArchived);
      if (!drawer) return;

      updatedSamples = state.samples.map(s => s.id === draggedId ? {
        ...s,
        storageId: drawer.storageId,
        shelfId: drawer.shelfId,
        rackId: drawer.rackId,
        drawerId: drawer.id,
        boxId: null,
        row: null,
        col: null
      } : s);
      actionName = "Sample Moved to Drawer";
      actionDesc = `Moved sample "${sample.chemicalName}" into drawer "${drawer.name}"`;
    } else if (draggedType === "box") {
      const box = state.boxes.find(b => b.id === draggedId);
      if (!box) return;
      
      if (targetType === "drawer") {
        const drawer = state.drawers.find(d => d.id === targetId);
        if (!drawer) return;
        
        updatedBoxes = state.boxes.map(b => b.id === draggedId ? {
          ...b,
          drawerId: drawer.id,
          rackId: drawer.rackId,
          shelfId: drawer.shelfId,
          storageId: drawer.storageId,
          shelfCol: null
        } : b);
        
        updatedSamples = state.samples.map(s => s.boxId === draggedId ? {
          ...s,
          drawerId: drawer.id,
          rackId: drawer.rackId,
          shelfId: drawer.shelfId,
          storageId: drawer.storageId
        } : s);
        
        actionName = "Box Moved to Drawer";
        actionDesc = `Moved box "${box.name}" into drawer "${drawer.name}"`;
        
      } else if (targetType === "rack") {
        const rack = state.racks.find(r => r.id === targetId);
        if (!rack) return;
        
        updatedBoxes = state.boxes.map(b => b.id === draggedId ? {
          ...b,
          drawerId: null,
          rackId: rack.id,
          shelfId: rack.shelfId,
          storageId: rack.storageId,
          shelfCol: null
        } : b);
        
        updatedSamples = state.samples.map(s => s.boxId === draggedId ? {
          ...s,
          drawerId: null,
          rackId: rack.id,
          shelfId: rack.shelfId,
          storageId: rack.storageId
        } : s);
        
        actionName = "Box Moved to Rack";
        actionDesc = `Moved box "${box.name}" into rack "${rack.name}"`;
        
      } else if (targetType === "shelf") {
        const shelf = state.shelves.find(s => s.id === targetId);
        if (!shelf) return;
        
        updatedBoxes = state.boxes.map(b => b.id === draggedId ? {
          ...b,
          drawerId: null,
          rackId: null,
          shelfId: shelf.id,
          storageId: shelf.storageId,
          shelfCol: targetCol !== undefined ? targetCol : null
        } : b);
        
        updatedSamples = state.samples.map(s => s.boxId === draggedId ? {
          ...s,
          drawerId: null,
          rackId: null,
          shelfId: shelf.id,
          storageId: shelf.storageId
        } : s);
        
        actionName = "Box Moved to Shelf";
        actionDesc = `Moved box "${box.name}" to shelf "${shelf.name}"${targetCol !== undefined && targetCol !== null ? ` slot ${targetCol}` : ""}`;
      }
    } else if (draggedType === "drawer") {
      const drawer = state.drawers.find(d => d.id === draggedId);
      if (!drawer) return;
      
      if (targetType === "rack") {
        const rack = state.racks.find(r => r.id === targetId);
        if (!rack) return;
        
        updatedDrawers = state.drawers.map(d => d.id === draggedId ? {
          ...d,
          rackId: rack.id,
          shelfId: rack.shelfId,
          storageId: rack.storageId
        } : d);
        
        updatedBoxes = state.boxes.map(b => b.drawerId === draggedId ? {
          ...b,
          rackId: rack.id,
          shelfId: rack.shelfId,
          storageId: rack.storageId
        } : b);
        
        const boxIdsInDrawer = state.boxes.filter(b => b.drawerId === draggedId).map(b => b.id);
        updatedSamples = state.samples.map(s => {
          if (s.drawerId === draggedId || (s.boxId && boxIdsInDrawer.includes(s.boxId))) {
            return {
              ...s,
              rackId: rack.id,
              shelfId: rack.shelfId,
              storageId: rack.storageId
            };
          }
          return s;
        });
        
        actionName = "Drawer Relocated";
        actionDesc = `Moved drawer "${drawer.name}" to rack "${rack.name}"`;
      }
    } else if (draggedType === "rack") {
      const rack = state.racks.find(r => r.id === draggedId);
      if (!rack) return;
      
      if (targetType === "shelf") {
        const shelf = state.shelves.find(s => s.id === targetId);
        if (!shelf) return;
        
        updatedRacks = state.racks.map(r => r.id === draggedId ? {
          ...r,
          shelfId: shelf.id,
          storageId: shelf.storageId,
          shelfCol: targetCol !== undefined ? targetCol : null
        } : r);
        
        updatedDrawers = state.drawers.map(d => d.rackId === draggedId ? {
          ...d,
          shelfId: shelf.id,
          storageId: shelf.storageId
        } : d);
        
        updatedBoxes = state.boxes.map(b => b.rackId === draggedId ? {
          ...b,
          shelfId: shelf.id,
          storageId: shelf.storageId
        } : b);
        
        updatedSamples = state.samples.map(s => s.rackId === draggedId ? {
          ...s,
          shelfId: shelf.id,
          storageId: shelf.storageId
        } : s);
        
        actionName = "Rack Relocated";
        actionDesc = `Moved rack "${rack.name}" to shelf "${shelf.name}"${targetCol !== undefined && targetCol !== null ? ` slot ${targetCol}` : ""}`;
      }
    }
    
      if (actionName && actionDesc) {
        // Extract destination from the target entity for the bulk-move API
        const destEntity =
          targetType === "drawer" ? state.drawers.find(d => d.id === targetId) :
          targetType === "rack" ? state.racks.find(r => r.id === targetId) :
          targetType === "shelf" ? state.shelves.find(s => s.id === targetId) : null;
        if (destEntity) {
          apiMutate(
            "/api/bulk-move",
            "PATCH",
            {
              itemType: draggedType,
              ids: [draggedId],
              destination: {
                storageId: destEntity.storageId,
                shelfId: "shelfId" in destEntity ? destEntity.shelfId : undefined,
                rackId: "rackId" in destEntity ? destEntity.rackId : undefined,
                drawerId: targetType === "drawer" ? destEntity.id : undefined,
                boxId: draggedType === "sample" ? null : undefined,
                shelfCol: targetCol !== undefined ? targetCol : undefined
              }
            },
            actionName,
            actionDesc,
            { ...state, racks: updatedRacks, drawers: updatedDrawers, boxes: updatedBoxes, samples: updatedSamples }
          );
        }
      }
  };

  // Capacity visual calculation
  const totalCapacityUsed = useMemo(() => {
    const gridBoxes = state.boxes.filter(b => b.rows && b.cols && !b.isArchived);
    let totalSlots = 0;
    let filledSlots = 0;

    gridBoxes.forEach(b => {
      totalSlots += (b.rows || 0) * (b.cols || 0);
      const boxSamples = state.samples.filter(s => s.boxId === b.id && !s.isArchived && s.row !== null && s.col !== null);
      filledSlots += boxSamples.length;
    });

    return totalSlots > 0 ? Math.round((filledSlots / totalSlots) * 100) : 15;
  }, [state.boxes, state.samples]);

  if (loading) {
    return (
      <div className="w-full min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-3 border-slate-200 border-t-indigo-600 rounded-full animate-spin"></div>
          <p className="text-sm text-slate-400 font-medium">Loading lab inventory...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans overflow-x-hidden selection:bg-indigo-500 selection:text-white">
      {/* Header */}
      <header className="h-16 bg-white border-b border-slate-200 px-4 lg:px-6 flex items-center justify-between shrink-0 sticky top-0 z-30 shadow-3xs">
        <div className="flex items-center gap-2 lg:gap-4 shrink-0">
          {/* Hamburger — mobile only */}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="lg:hidden p-2 rounded-lg hover:bg-slate-100 text-slate-600"
            aria-label="Toggle sidebar"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="w-9 h-9 bg-indigo-600 rounded flex items-center justify-center text-white font-extrabold text-lg shadow-sm">L</div>
          <div className="hidden sm:block">
            <h1 className="text-base font-extrabold tracking-tight text-slate-900">Sousa Lab Inventory</h1>
            <p className="text-[10px] text-slate-400 font-medium tracking-wide uppercase">Durable Lab Inventory</p>
          </div>
        </div>

        {/* Global Search with dynamic dropdown suggestion */}
        <div className="flex-1 max-w-xl px-4 lg:px-10 relative hidden md:block">
          <div className="relative">
            <div className="absolute inset-y-0 left-3.5 flex items-center pointer-events-none text-slate-400">
              <Search className="w-4 h-4" />
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={e => {
                setSearchQuery(e.target.value);
                if (!searchPanelOpen) setSearchPanelOpen(true);
              }}
              onFocus={() => {
                if (searchQuery.trim()) setSearchPanelOpen(true);
              }}
              onKeyDown={e => {
                if (e.key === "Enter" && searchQuery.trim()) {
                  e.preventDefault();
                  openDetailedSearch();
                }
              }}
              placeholder="Search by Chemical ID, CAS, Plasmid, Location, or Lot Number..."
              className="w-full bg-slate-100 border-none rounded-lg py-2.5 pl-10 pr-10 text-xs focus:ring-2 focus:ring-indigo-500/20 focus:bg-white transition-all text-slate-800 outline-hidden font-medium placeholder-slate-400"
            />
            {searchQuery && (
              <button
                onClick={() => {
                  setSearchQuery("");
                  setSearchPanelOpen(false);
                }}
                className="absolute inset-y-0 right-3 flex items-center text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Search suggestions dropdown */}
          {searchQuery && searchPanelOpen && (
            <div className="absolute left-10 right-10 mt-1 bg-white border border-slate-200 rounded-lg shadow-xl max-h-64 overflow-y-auto z-20 divide-y divide-slate-100">
              <div className="p-2 bg-slate-50 text-[10px] uppercase font-bold tracking-wider text-slate-400 flex justify-between">
                <span>Matching Lab Inventory</span>
                <span>{searchResults.length} hits</span>
              </div>
              {searchResults.length === 0 && (
                <div className="p-3 text-xs text-slate-500">No matches found for this search term.</div>
              )}
              {searchResults.map((result, idx) => {
                if (result.kind === "sample") {
                  const s = result.sample;
                  const parentBoxDetail = state.boxes.find(b => b.id === s.boxId);
                  const parentShelfDetail = state.shelves.find(sh => sh.id === s.shelfId);
                  const parentStorageDetail = state.storageUnits.find(u => u.id === s.storageId);
                  return (
                    <button
                      key={`sample-${s.id}`}
                      onClick={() => {
                        handleSearchResultClick(result);
                        setSearchQuery("");
                        setSearchPanelOpen(false);
                      }}
                      className="w-full p-3 text-left hover:bg-slate-50 flex justify-between items-center transition-colors text-xs"
                    >
                      <div>
                        <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                          {s.chemicalName}
                          <span className="px-1.5 py-0.2 bg-emerald-50 text-[10px] rounded text-emerald-700">Sample</span>
                          {s.itemType && <span className="px-1.5 py-0.2 bg-slate-100 text-[10px] rounded text-slate-500">{s.itemType}</span>}
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5 font-mono">
                          {s.casNumber && `CAS: ${s.casNumber} • `}Qty: {s.qty} {s.units}
                        </div>
                      </div>
                      <div className="text-right text-[10px] text-indigo-600 font-medium">
                        {parentStorageDetail?.name} &gt; {parentShelfDetail?.name} {parentBoxDetail ? `&gt; ${parentBoxDetail.name}` : ""}
                      </div>
                    </button>
                  );
                }

                let title = "";
                let path = "";
                let kindLabel = "";

                if (result.kind === "storage") {
                  title = result.storage.name;
                  path = result.storage.type;
                  kindLabel = "Storage";
                } else if (result.kind === "shelf") {
                  title = result.shelf.name;
                  path = `${result.storage?.name || ""}`;
                  kindLabel = "Shelf";
                } else if (result.kind === "rack") {
                  title = result.rack.name;
                  path = `${result.storage?.name || ""} > ${result.shelf?.name || ""}`;
                  kindLabel = "Rack";
                } else if (result.kind === "drawer") {
                  title = result.drawer.name;
                  path = `${result.storage?.name || ""} > ${result.shelf?.name || ""} > ${result.rack?.name || ""}`;
                  kindLabel = "Drawer";
                } else {
                  title = result.box.name;
                  const drawerOrRack = result.drawer?.name || result.rack?.name || "";
                  path = `${result.storage?.name || ""} > ${result.shelf?.name || ""}${drawerOrRack ? ` > ${drawerOrRack}` : ""}`;
                  kindLabel = "Box";
                }

                return (
                  <button
                    key={`node-${result.kind}-${idx}`}
                    onClick={() => {
                      handleSearchResultClick(result);
                      setSearchQuery("");
                      setSearchPanelOpen(false);
                    }}
                    className="w-full p-3 text-left hover:bg-slate-50 flex justify-between items-center transition-colors text-xs"
                  >
                    <div>
                      <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                        {title}
                        <span className="px-1.5 py-0.2 bg-indigo-50 text-[10px] rounded text-indigo-700">{kindLabel}</span>
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        {path}
                      </div>
                    </div>
                  </button>
                );
              })}
              <div className="p-2 bg-slate-50">
                <button
                  onClick={openDetailedSearch}
                  className="w-full px-3 py-2 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold transition-colors"
                >
                  Open detailed results
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Scan / QR Input */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="relative hidden lg:block">
            <div className="absolute inset-y-0 left-2.5 flex items-center pointer-events-none text-slate-400">
              <ScanLine className="w-3.5 h-3.5" />
            </div>
            <input
              type="text"
              value={scanInput}
              onChange={e => setScanInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleScanSubmit();
                }
              }}
              placeholder="Scan / enter Box ID, Sample ID, or CAS..."
              className="w-48 bg-slate-100 border-none rounded-lg py-2 pl-8 pr-3 text-xs focus:ring-2 focus:ring-indigo-500/20 focus:bg-white transition-all text-slate-800 outline-hidden font-medium placeholder-slate-400"
            />
          </div>
          <button
            onClick={handlePrintQRLables}
            disabled={isGeneratingQR}
            className="px-3 py-2 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200/50 rounded-lg flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
            title="Generate printable QR code labels for all boxes"
          >
            <QrCode className="w-3.5 h-3.5" />
            {isGeneratingQR ? "Generating..." : "QR Labels"}
          </button>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Inspector toggle */}
          <button
            onClick={() => setInspectorOpen(!inspectorOpen)}
            className="p-2 rounded-lg hover:bg-slate-100 text-slate-600"
            aria-label="Toggle inspector"
            title="Toggle sample inspector"
          >
            {inspectorOpen ? <PanelRightClose className="h-5 w-5" /> : <PanelRightOpen className="h-5 w-5" />}
          </button>
          {/* Active User Label */}
          <div className="flex items-center gap-1 px-3 py-1.5 bg-indigo-50 border border-indigo-100/50 rounded-lg text-indigo-700 text-xs font-semibold mr-1">
            <User className="h-3.5 w-3.5" />
            <select
              value={currentUser}
              onChange={e => setCurrentUser(e.target.value)}
              className="bg-transparent border-none p-0 focus:ring-0 text-xs font-semibold cursor-pointer outline-hidden"
            >
              {state.users.map(userName => (
                <option key={userName} value={userName}>{userName}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleManageUsers}
              className="ml-1 p-0.5 rounded hover:bg-indigo-100 transition-colors"
              title="Manage users"
              aria-label="Manage users"
            >
              <Edit2 className="h-3 w-3" />
            </button>
          </div>

          <button
            onClick={() => {
              setShowBulkImport(!showBulkImport);
              if (!showBulkImport) {
                setShowBulkRename(false);
              }
            }}
            className={`px-3 py-2 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-all cursor-pointer ${
              showBulkImport 
                ? "bg-slate-800 text-white" 
                : "bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200/50"
            }`}
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            Bulk Excel Import
          </button>

          <button
            onClick={() => {
              setShowBulkRename(!showBulkRename);
              if (!showBulkRename) {
                setShowBulkImport(false);
              }
            }}
            className={`px-3 py-2 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-all cursor-pointer ${
              showBulkRename
                ? "bg-amber-600 text-white"
                : "bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200/50"
            }`}
          >
            <Edit2 className="w-3.5 h-3.5" />
            Bulk Rename
          </button>

          <button
            onClick={() => setShowTrash(!showTrash)}
            className={`px-3 py-2 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-all cursor-pointer ${
              showTrash
                ? "bg-red-50 border border-red-200 text-red-700"
                : "bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200/50"
            }`}
          >
            <Archive className="w-3.5 h-3.5" />
            Trash / Restore
          </button>

          <div className="relative group">
            <button
              onClick={handleBackupExport}
              className="px-3.5 py-2 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-xs hover:shadow-md transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Backup Export
            </button>
            <div className="absolute right-0 mt-1 hidden group-hover:block bg-white border border-slate-200 rounded-lg shadow-xl text-left p-1 z-30 w-44">
              <button
                onClick={handleBackupExport}
                className="w-full text-left px-3 py-2 hover:bg-slate-50 rounded text-xs text-slate-700 flex items-center gap-1.5"
              >
                <Database className="h-3.5 w-3.5 text-slate-400" /> Export JSON backup
              </button>
              <button
                onClick={handleCSVExport}
                className="w-full text-left px-3 py-2 hover:bg-slate-50 rounded text-xs text-slate-700 flex items-center gap-1.5"
              >
                <FileSpreadsheet className="h-3.5 w-3.5 text-slate-400" /> Export full CSV
              </button>
              <button
                onClick={triggerBackupRestorePicker}
                className="w-full text-left px-3 py-2 hover:bg-slate-50 rounded text-xs text-slate-700 flex items-center gap-1.5"
              >
                <Upload className="h-3.5 w-3.5 text-slate-400" />
                <span>Import JSON backup</span>
              </button>
            </div>
          </div>
          <input ref={backupRestoreInputRef} type="file" accept=".json" onChange={handleBackupRestore} className="hidden" />
        </div>
      </header>

      {searchDetailOpen && searchQuery.trim() && (
        <div className="fixed inset-x-0 top-16 bottom-0 z-40 bg-slate-50 border-t border-slate-200 overflow-hidden">
          <div className="h-full flex flex-col">
            <div className="bg-white/95 backdrop-blur border-b border-slate-200 px-4 lg:px-6 py-4 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.28em] text-indigo-600 font-bold">Detailed Search</div>
                  <h2 className="mt-1 text-lg font-extrabold text-slate-900">Results for “{searchQuery}”</h2>
                  <p className="text-xs text-slate-500 mt-1">{detailedSearchResults.length} result(s) after filters</p>
                </div>
                <button
                  onClick={() => setSearchDetailOpen(false)}
                  className="px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold"
                >
                  Close
                </button>
              </div>

              <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_auto] items-end">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Entity Type</div>
                  <div className="flex flex-wrap gap-2">
                    {(Object.keys(SEARCH_RESULT_KIND_LABELS) as Array<SearchResult["kind"]>).map(kind => (
                      <button
                        key={kind}
                        onClick={() => toggleSearchKindFilter(kind)}
                        className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                          searchKindFilters.includes(kind)
                            ? "bg-indigo-600 text-white border-indigo-600"
                            : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                        }`}
                      >
                        {SEARCH_RESULT_KIND_LABELS[kind]}
                      </button>
                    ))}
                    <button
                      onClick={() => setSearchKindFilters(["sample", "storage", "shelf", "rack", "drawer", "box"])}
                      className="px-3 py-1.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-200 hover:bg-slate-200 transition-colors"
                    >
                      Select all
                    </button>
                  </div>
                </div>

                <label className="block">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Added From</div>
                  <input
                    type="date"
                    value={searchDateFrom}
                    onChange={e => setSearchDateFrom(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 outline-hidden focus:ring-2 focus:ring-indigo-500/20"
                  />
                </label>

                <label className="block">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Added To</div>
                  <input
                    type="date"
                    value={searchDateTo}
                    onChange={e => setSearchDateTo(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 outline-hidden focus:ring-2 focus:ring-indigo-500/20"
                  />
                </label>

                <label className="block">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Sort</div>
                  <select
                    value={searchSortMode}
                    onChange={e => setSearchSortMode(e.target.value as typeof searchSortMode)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 outline-hidden focus:ring-2 focus:ring-indigo-500/20"
                  >
                    <option value="relevance">Relevance</option>
                    <option value="newest">Newest added</option>
                    <option value="oldest">Oldest added</option>
                  </select>
                </label>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 lg:px-6 py-4">
              {detailedSearchResults.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
                  No results matched the selected filters.
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                  {detailedSearchResults.map((result, idx) => {
                    const addedAt = getSearchResultAddedAt(result);
                    return (
                      <button
                        key={`${result.kind}-${idx}`}
                        onClick={() => {
                          handleSearchResultClick(result);
                          setSearchDetailOpen(false);
                          setSearchPanelOpen(false);
                        }}
                        className="text-left rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:shadow-md hover:border-indigo-200 transition-all"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                              <span className="px-2 py-1 rounded-full bg-indigo-50 text-indigo-700">{SEARCH_RESULT_KIND_LABELS[result.kind]}</span>
                              {addedAt ? <span>{new Date(addedAt).toLocaleDateString()}</span> : <span>Unknown date</span>}
                            </div>
                            <div className="mt-2 text-sm font-bold text-slate-900 truncate">{getSearchResultTitle(result)}</div>
                            <div className="mt-1 text-xs text-slate-500 leading-relaxed">{getSearchResultPath(result) || "No location available"}</div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Main Body */}
      <main className="flex-1 flex overflow-hidden min-h-[calc(100vh-6rem)] relative">

        {/* Mobile sidebar backdrop */}
        {sidebarOpen && (
          <div
            className="lg:hidden fixed inset-0 bg-black/40 z-20"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Left Sidebar: Navigating refrigerators & shelfs */}
        <aside className={`
          w-64 bg-white border-r border-slate-200 flex flex-col shrink-0
          fixed lg:static inset-y-0 left-0 z-20 lg:z-auto
          transition-transform duration-200
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
        `}>
          
          {/* Storage Units Selectors */}
          <div className="p-4 border-b border-slate-100 flex-1 overflow-y-auto space-y-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Storage Units</h2>
              <button 
                onClick={() => {
                  setEditingStorageItem(null);
                  setStorageModalMode("storage");
                  setStorageModalOpen(true);
                }}
                className="p-1 hover:bg-slate-100 rounded text-slate-500 hover:text-indigo-600 transition-colors"
                title="Add Storage Unit"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-2">
              {groupedSidebarStorageUnits.map(section => (
                <div key={section.type} className="space-y-1">
                  <button
                    type="button"
                    onClick={() => {
                      setCollapsedStorageTypes(prev => ({
                        ...prev,
                        [section.type]: !prev[section.type],
                      }));
                    }}
                    className="w-full px-1 py-0.5 flex items-center justify-between rounded text-[9px] font-bold uppercase tracking-wider text-slate-400 hover:bg-slate-50"
                    title={`${collapsedStorageTypes[section.type] ? "Expand" : "Collapse"} ${section.label}`}
                  >
                    <span className="flex items-center gap-1">
                      {collapsedStorageTypes[section.type] ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      {section.label}
                    </span>
                    <span className="text-[8px] font-semibold text-slate-300">{section.units.length}</span>
                  </button>
                  {!collapsedStorageTypes[section.type] && (
                  <div className="space-y-1">
              {section.units.map(unit => {
                const isActive = selectedStorageId === unit.id;
                const unitShelves = state.shelves.filter(s => s.storageId === unit.id && !s.isArchived);
                return (
                  <div key={unit.id} className="space-y-0.5">
                    <div
                      onClick={() => {
                        setSelectedStorageId(unit.id);
                        setSelectedShelfId("");
                        setSelectedRackId("");
                        setSelectedDrawerId("");
                        setSelectedBoxId(null);
                        setSelectedSampleId(null);
                      }}
                      className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-all ${
                        isActive 
                          ? "bg-indigo-50/70 text-indigo-700 font-semibold" 
                          : "text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate text-xs">
                        <Server className={`w-3.5 h-3.5 ${isActive ? "text-indigo-600" : "text-slate-400"}`} />
                        <span className="truncate" title={unit.name}>{unit.name}</span>
                      </div>
                      <div className="flex items-center opacity-0 hover:opacity-100 group-hover:opacity-100 gap-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingStorageItem(unit);
                            setStorageModalMode("storage");
                            setStorageModalOpen(true);
                          }}
                          className="p-0.5 hover:bg-indigo-100 rounded text-slate-400 hover:text-indigo-600"
                        >
                          <Edit2 className="h-3 w-3" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleArchiveStorage(unit.id, unit.name);
                          }}
                          className="p-0.5 hover:bg-red-100 rounded text-slate-400 hover:text-red-600"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>

                    {/* Cascading levels (Shelves & Boxes) inside selected unit */}
                    {isActive && (
                      <div className="pl-3.5 ml-2.5 border-l border-slate-200 space-y-1 py-1">
                        <div className="flex items-center justify-between pr-1">
                          <span className="text-[9px] uppercase font-bold text-slate-400 tracking-wider">Levels/Shelves</span>
                          <button
                            onClick={() => {
                              setEditingStorageItem(null);
                              setStorageModalMode("shelf");
                              setStorageModalOpen(true);
                            }}
                            className="p-0.5 hover:bg-slate-100 rounded text-slate-400 hover:text-indigo-600"
                            title="Add Shelf"
                          >
                            <Plus className="h-3 w-3" />
                          </button>
                        </div>

                        {unitShelves.map(shelf => {
                          const isShelfActive = selectedShelfId === shelf.id;
                          const shelfRacks = state.racks
                            .filter(r => r.shelfId === shelf.id && !r.isArchived);
                          const shelfDirectBoxes = state.boxes.filter(b => b.shelfId === shelf.id && !b.rackId && !b.isArchived);
                          const isShelfDragOver =
                            dragOverHierarchyItem?.type === "shelf" &&
                            dragOverHierarchyItem.id === shelf.id &&
                            dragOverHierarchyItem.parentId === unit.id;
                          return (
                            <div key={shelf.id} className="space-y-0.5">
                              <div
                                draggable
                                onDragStart={(e) => {
                                  setDraggingHierarchyItem({ type: "shelf", id: shelf.id, parentId: unit.id });
                                  e.dataTransfer.effectAllowed = "move";
                                }}
                                onDragEnd={clearHierarchyDragState}
                                onDragOver={(e) => {
                                  if (isHierarchyDropAllowed("shelf", shelf.id, unit.id)) {
                                    e.preventDefault();
                                    e.dataTransfer.dropEffect = "move";
                                    setDragOverHierarchyItem({ type: "shelf", id: shelf.id, parentId: unit.id });
                                  }
                                }}
                                onDragLeave={() => {
                                  if (isShelfDragOver) {
                                    setDragOverHierarchyItem(null);
                                  }
                                }}
                                onDrop={(e) => {
                                  e.preventDefault();
                                  void handleDropReorderShelf(shelf.id, unit.id);
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedShelfId(shelf.id);
                                  setSelectedRackId("");
                                  setSelectedDrawerId("");
                                  setSelectedBoxId(null);
                                }}
                                className={`flex items-center justify-between p-1 rounded-md cursor-pointer transition-colors text-xs ${
                                  isShelfActive && !selectedBoxId && !selectedRackId
                                    ? "bg-slate-100 text-slate-800 font-semibold"
                                    : isShelfActive
                                    ? "text-indigo-600 font-semibold"
                                    : "text-slate-500 hover:bg-slate-50"
                                } ${isShelfDragOver ? "ring-1 ring-indigo-300 bg-indigo-50/40" : ""}`}
                              >
                                <span className="truncate flex items-center gap-1">
                                  <Move className="h-3 w-3 shrink-0 text-slate-300" />
                                  <Layers className="h-3 w-3 shrink-0" />
                                  <span className="truncate">{shelf.name}</span>
                                </span>
                                <div className="flex gap-1">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setEditingStorageItem(shelf);
                                      setStorageModalMode("shelf");
                                      setStorageModalOpen(true);
                                    }}
                                    className="p-0.5 hover:bg-slate-200 rounded text-slate-300 hover:text-slate-700"
                                  >
                                    <Edit2 className="h-2.5 w-2.5" />
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleArchiveShelf(shelf.id, shelf.name);
                                    }}
                                    className="p-0.5 hover:bg-red-50 rounded text-slate-300 hover:text-red-600"
                                  >
                                    <Trash2 className="h-2.5 w-2.5" />
                                  </button>
                                </div>
                              </div>

                              {/* Shelf Content */}
                              {isShelfActive && (
                                <div className="pl-3 border-l border-indigo-100 space-y-1.5 py-1 ml-1.5">
                                  
                                  {/* Racks Section */}
                                  <div className="space-y-0.5">
                                    <div className="flex items-center justify-between pr-1">
                                      <span className="text-[8px] uppercase font-bold text-slate-400">Racks</span>
                                      <button
                                        onClick={() => {
                                          setEditingStorageItem(null);
                                          setStorageModalMode("rack");
                                          setStorageModalOpen(true);
                                        }}
                                        className="p-0.5 hover:bg-slate-100 rounded text-slate-400 hover:text-indigo-600"
                                        title="Add Rack"
                                      >
                                        <Plus className="h-2.5 w-2.5" />
                                      </button>
                                    </div>

                                    {shelfRacks.map(rack => {
                                      const isRackActive = selectedRackId === rack.id;
                                      const rackDrawers = state.drawers
                                        .filter(d => d.rackId === rack.id && !d.isArchived);
                                      const rackBoxes = state.boxes.filter(b => b.rackId === rack.id && !b.drawerId && !b.isArchived);
                                      const isRackDragOver =
                                        dragOverHierarchyItem?.type === "rack" &&
                                        dragOverHierarchyItem.id === rack.id &&
                                        dragOverHierarchyItem.parentId === shelf.id;
                                      return (
                                        <div key={rack.id} className="space-y-0.5">
                                          <div
                                            draggable
                                            onDragStart={(e) => {
                                              setDraggingHierarchyItem({ type: "rack", id: rack.id, parentId: shelf.id });
                                              e.dataTransfer.effectAllowed = "move";
                                            }}
                                            onDragEnd={clearHierarchyDragState}
                                            onDragOver={(e) => {
                                              if (isHierarchyDropAllowed("rack", rack.id, shelf.id)) {
                                                e.preventDefault();
                                                e.dataTransfer.dropEffect = "move";
                                                setDragOverHierarchyItem({ type: "rack", id: rack.id, parentId: shelf.id });
                                              }
                                            }}
                                            onDragLeave={() => {
                                              if (isRackDragOver) {
                                                setDragOverHierarchyItem(null);
                                              }
                                            }}
                                            onDrop={(e) => {
                                              e.preventDefault();
                                              void handleDropReorderRack(rack.id, shelf.id);
                                            }}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setSelectedRackId(rack.id);
                                              setSelectedDrawerId("");
                                              setSelectedBoxId(null);
                                            }}
                                            className={`flex items-center justify-between p-1 rounded-xs cursor-pointer transition-colors text-[11px] ${
                                              isRackActive && !selectedDrawerId && !selectedBoxId
                                                ? "bg-slate-100 text-slate-800 font-semibold"
                                                : isRackActive
                                                ? "text-indigo-600 font-semibold"
                                                : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                                            } ${isRackDragOver ? "ring-1 ring-amber-300 bg-amber-50/40" : ""}`}
                                          >
                                            <span className="truncate flex items-center gap-1">
                                              <Move className="h-2.5 w-2.5 shrink-0 text-slate-300" />
                                              <Layers className="h-2.5 w-2.5 shrink-0 text-amber-500" />
                                              <span className="truncate">{rack.name}</span>
                                            </span>
                                            <div className="flex gap-0.5">
                                              <button
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  setEditingStorageItem(rack);
                                                  setStorageModalMode("rack");
                                                  setStorageModalOpen(true);
                                                }}
                                                className="p-0.5 rounded hover:bg-slate-200 text-slate-300 hover:text-slate-700"
                                              >
                                                <Edit2 className="h-2.5 w-2.5" />
                                              </button>
                                              <button
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  handleArchiveRack(rack.id, rack.name);
                                                }}
                                                className="p-0.5 rounded hover:bg-red-50 text-slate-300 hover:text-red-600"
                                              >
                                                <Trash2 className="h-2.5 w-2.5" />
                                              </button>
                                            </div>
                                          </div>

                                          {/* Drawers and boxes inside Active Rack */}
                                          {isRackActive && (
                                            <div className="pl-3 border-l border-amber-200 space-y-1 py-0.5 ml-1">
                                              
                                              {/* Drawers header */}
                                              <div className="flex items-center justify-between pr-1">
                                                <span className="text-[7px] uppercase font-bold text-amber-500">Drawers</span>
                                                <button
                                                  onClick={() => {
                                                    setEditingStorageItem(null);
                                                    setStorageModalMode("drawer");
                                                    setStorageModalOpen(true);
                                                  }}
                                                  className="p-0.5 hover:bg-slate-100 rounded text-slate-400 hover:text-indigo-600"
                                                  title="Add Drawer"
                                                >
                                                  <Plus className="h-2 w-2" />
                                                </button>
                                              </div>

                                              {rackDrawers.map(drawer => {
                                                const isDrawerActive = selectedDrawerId === drawer.id;
                                                const drawerBoxes = getDrawerBoxesSortedBySlot(drawer.id);
                                                const isDrawerDragOver =
                                                  dragOverHierarchyItem?.type === "drawer" &&
                                                  dragOverHierarchyItem.id === drawer.id &&
                                                  dragOverHierarchyItem.parentId === rack.id;
                                                return (
                                                  <div key={drawer.id} className="space-y-0.5">
                                                    <div
                                                      draggable
                                                      onDragStart={(e) => {
                                                        setDraggingHierarchyItem({ type: "drawer", id: drawer.id, parentId: rack.id });
                                                        e.dataTransfer.effectAllowed = "move";
                                                      }}
                                                      onDragEnd={clearHierarchyDragState}
                                                      onDragOver={(e) => {
                                                        const dragPayload = readDragPayload(e);
                                                        if (dragPayload?.type === "box") {
                                                          e.preventDefault();
                                                          e.dataTransfer.dropEffect = "move";
                                                          setDragOverHierarchyItem({ type: "drawer", id: drawer.id, parentId: rack.id });
                                                        } else if (isHierarchyDropAllowed("drawer", drawer.id, rack.id)) {
                                                          e.preventDefault();
                                                          e.dataTransfer.dropEffect = "move";
                                                          setDragOverHierarchyItem({ type: "drawer", id: drawer.id, parentId: rack.id });
                                                        }
                                                      }}
                                                      onDragLeave={() => {
                                                        if (isDrawerDragOver) {
                                                          setDragOverHierarchyItem(null);
                                                        }
                                                      }}
                                                      onDrop={(e) => {
                                                        e.preventDefault();
                                                        const dragPayload = readDragPayload(e);
                                                        if (dragPayload?.type === "box") {
                                                          const occupiedSlots = new Set(
                                                            drawerBoxes
                                                              .filter(box => box.id !== dragPayload.id && typeof box.drawerSlot === "number")
                                                              .map(box => box.drawerSlot as number)
                                                          );
                                                          const availableSlot = Array.from(
                                                            { length: getDrawerCapacity(drawer) },
                                                            (_, index) => index + 1
                                                          ).find(slot => !occupiedSlots.has(slot));
                                                          if (availableSlot) {
                                                            void handleDropBoxOnDrawerSlot(e, drawer.id, availableSlot);
                                                          } else {
                                                            alert(`Drawer "${drawer.name}" is full.`);
                                                            clearBoxDragState();
                                                          }
                                                        } else {
                                                          void handleDropReorderDrawer(drawer.id, rack.id);
                                                        }
                                                      }}
                                                      onClick={(e) => {
                                                        e.stopPropagation();
                                                        setSelectedDrawerId(drawer.id);
                                                        setSelectedBoxId(null);
                                                      }}
                                                      className={`flex items-center justify-between p-0.5 rounded-xs cursor-pointer transition-colors text-[10px] ${
                                                        isDrawerActive && !selectedBoxId
                                                          ? "bg-slate-100 text-slate-800 font-semibold"
                                                          : isDrawerActive
                                                          ? "text-indigo-600 font-semibold"
                                                          : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                                                      } ${isDrawerDragOver ? "ring-1 ring-emerald-300 bg-emerald-50/40" : ""}`}
                                                    >
                                                      <span className="truncate flex items-center gap-1">
                                                        <Move className="h-2.5 w-2.5 shrink-0 text-slate-300" />
                                                        <Grid className="h-2.5 w-2.5 shrink-0 text-emerald-500" />
                                                        <span className="truncate">{drawer.name}</span>
                                                      </span>
                                                      <div className="flex gap-0.5">
                                                        <button
                                                          onClick={(e) => {
                                                            e.stopPropagation();
                                                            setEditingStorageItem(drawer);
                                                            setStorageModalMode("drawer");
                                                            setStorageModalOpen(true);
                                                          }}
                                                          className="p-0.5 rounded hover:bg-slate-200 text-slate-300 hover:text-slate-700"
                                                        >
                                                          <Edit2 className="h-2 w-2" />
                                                        </button>
                                                        <button
                                                          onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleArchiveDrawer(drawer.id, drawer.name);
                                                          }}
                                                          className="p-0.5 rounded hover:bg-red-50 text-slate-300 hover:text-red-600"
                                                        >
                                                          <Trash2 className="h-2 w-2" />
                                                        </button>
                                                      </div>
                                                    </div>

                                                    {/* Boxes inside active drawer */}
                                                    {isDrawerActive && (
                                                      <div className="pl-2 border-l border-emerald-200 space-y-0.5 py-0.5 ml-1">
                                                        <div className="flex items-center justify-between pr-1">
                                                          <span className="text-[6px] uppercase font-bold text-emerald-600">Boxes</span>
                                                          <button
                                                            onClick={() => {
                                                              setEditingStorageItem(null);
                                                              setStorageModalMode("box");
                                                              setStorageModalOpen(true);
                                                            }}
                                                            className="p-0.5 hover:bg-slate-100 rounded text-slate-400 hover:text-indigo-600"
                                                            title="Add Box in Drawer"
                                                          >
                                                            <Plus className="h-2 w-2" />
                                                          </button>
                                                        </div>

                                                        {drawerBoxes.map(box => {
                                                          const isBoxActive = selectedBoxId === box.id;
                                                          const isBoxDragOver = dragOverBoxId === box.id;
                                                          return (
                                                            <div
                                                              key={box.id}
                                                              draggable
                                                              onDragStart={(e) => {
                                                                setDraggedBoxId(box.id);
                                                                e.dataTransfer.effectAllowed = "move";
                                                                e.dataTransfer.setData("text/plain", JSON.stringify({ type: "box", id: box.id }));
                                                              }}
                                                              onDragEnd={clearBoxDragState}
                                                              onDragOver={(e) => {
                                                                if (draggedBoxId && draggedBoxId !== box.id) {
                                                                  e.preventDefault();
                                                                  e.stopPropagation();
                                                                  e.dataTransfer.dropEffect = "move";
                                                                  setDragOverBoxId(box.id);
                                                                }
                                                              }}
                                                              onDragLeave={() => {
                                                                if (isBoxDragOver) {
                                                                  setDragOverBoxId(null);
                                                                }
                                                              }}
                                                              onDrop={(e) => {
                                                                e.preventDefault();
                                                                e.stopPropagation();
                                                                void handleDropReorderBoxesInDrawer(box.id, drawer.id);
                                                              }}
                                                              onClick={(e) => {
                                                                e.stopPropagation();
                                                                setSelectedBoxId(box.id);
                                                              }}
                                                              className={`flex items-center justify-between p-0.5 rounded-xs cursor-pointer transition-colors text-[9px] ${
                                                                isBoxActive
                                                                  ? "bg-indigo-600 text-white font-semibold"
                                                                  : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                                                              } ${isBoxDragOver ? "ring-1 ring-indigo-300 bg-indigo-50/40" : ""}`}
                                                            >
                                                              <span className="truncate flex items-center gap-0.5">
                                                                <BoxIcon className="h-2 w-2 shrink-0" />
                                                                <span className="truncate">{box.name}</span>
                                                              </span>
                                                              <div className="flex gap-0.5">
                                                                <button
                                                                  onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setEditingStorageItem(box);
                                                                    setStorageModalMode("box");
                                                                    setStorageModalOpen(true);
                                                                  }}
                                                                  className={`p-0.5 rounded ${isBoxActive ? "hover:bg-indigo-700 text-indigo-200" : "hover:bg-slate-200 text-slate-300"}`}
                                                                >
                                                                  <Edit2 className="h-2 w-2" />
                                                                </button>
                                                                <button
                                                                  onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    handleArchiveBox(box.id, box.name);
                                                                  }}
                                                                  className={`p-0.5 rounded ${isBoxActive ? "hover:bg-indigo-700 text-indigo-200" : "hover:bg-red-50 text-slate-300"}`}
                                                                >
                                                                  <Trash2 className="h-2 w-2" />
                                                                </button>
                                                              </div>
                                                            </div>
                                                          );
                                                        })}
                                                      </div>
                                                    )}
                                                  </div>
                                                );
                                              })}

                                              {/* Rack Boxes (Direct inside rack, no drawer) */}
                                              {rackBoxes.length > 0 && (
                                                <div className="pl-1 mt-1.5 space-y-0.5">
                                                  <span className="text-[7px] uppercase font-bold text-slate-400 block">Direct in Rack</span>
                                                  {rackBoxes.map(box => {
                                                    const isBoxActive = selectedBoxId === box.id;
                                                    return (
                                                      <div
                                                        key={box.id}
                                                        onClick={(e) => {
                                                          e.stopPropagation();
                                                          setSelectedBoxId(box.id);
                                                        }}
                                                        className={`flex items-center justify-between p-0.5 rounded-xs cursor-pointer transition-colors text-[9px] ${
                                                          isBoxActive
                                                            ? "bg-indigo-600 text-white font-semibold"
                                                            : "text-slate-500 hover:bg-slate-50"
                                                        }`}
                                                      >
                                                        <span className="truncate flex items-center gap-0.5">
                                                          <BoxIcon className="h-2 w-2 shrink-0" />
                                                          <span className="truncate">{box.name}</span>
                                                        </span>
                                                        <div className="flex gap-0.5">
                                                          <button
                                                            onClick={(e) => {
                                                              e.stopPropagation();
                                                              setEditingStorageItem(box);
                                                              setStorageModalMode("box");
                                                              setStorageModalOpen(true);
                                                            }}
                                                            className={`p-0.5 rounded ${isBoxActive ? "hover:bg-indigo-700 text-indigo-200" : "hover:bg-slate-200 text-slate-300"}`}
                                                          >
                                                            <Edit2 className="h-2 w-2" />
                                                          </button>
                                                          <button
                                                            onClick={(e) => {
                                                              e.stopPropagation();
                                                              handleArchiveBox(box.id, box.name);
                                                            }}
                                                            className={`p-0.5 rounded ${isBoxActive ? "hover:bg-indigo-700 text-indigo-200" : "hover:bg-red-50 text-slate-300"}`}
                                                          >
                                                            <Trash2 className="h-2 w-2" />
                                                          </button>
                                                        </div>
                                                      </div>
                                                    );
                                                  })}
                                                </div>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>

                                  {/* Shelf Direct Boxes (no rack) */}
                                  <div className="space-y-0.5 pt-1 border-t border-slate-100">
                                    <div className="flex items-center justify-between pr-1">
                                      <span className="text-[8px] uppercase font-bold text-slate-400">Direct Boxes</span>
                                      <button
                                        onClick={() => {
                                          setEditingStorageItem(null);
                                          setStorageModalMode("box");
                                          setStorageModalOpen(true);
                                        }}
                                        className="p-0.5 hover:bg-slate-100 rounded text-slate-400 hover:text-indigo-600"
                                        title="Add Direct Box"
                                      >
                                        <Plus className="h-2.5 w-2.5" />
                                      </button>
                                    </div>

                                    {shelfDirectBoxes.map(box => {
                                      const isBoxActive = selectedBoxId === box.id;
                                      return (
                                        <div
                                          key={box.id}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setSelectedBoxId(box.id);
                                          }}
                                          className={`flex items-center justify-between p-1 rounded-sm cursor-pointer transition-colors text-[11px] ${
                                            isBoxActive
                                              ? "bg-indigo-600 text-white font-semibold shadow-xs"
                                              : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                                          }`}
                                        >
                                          <span className="truncate flex items-center gap-1">
                                            <BoxIcon className="h-3 w-3 shrink-0" />
                                            <span className="truncate">{box.name}</span>
                                          </span>
                                          <div className="flex gap-0.5">
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setEditingStorageItem(box);
                                                setStorageModalMode("box");
                                                setStorageModalOpen(true);
                                              }}
                                              className={`p-0.5 rounded ${isBoxActive ? "hover:bg-indigo-700 text-indigo-200" : "hover:bg-slate-200 text-slate-300 hover:text-slate-700"}`}
                                            >
                                              <Edit2 className="h-2.5 w-2.5" />
                                            </button>
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                handleArchiveBox(box.id, box.name);
                                              }}
                                              className={`p-0.5 rounded ${isBoxActive ? "hover:bg-indigo-700 text-indigo-200" : "hover:bg-red-50 text-slate-300 hover:text-red-600"}`}
                                            >
                                              <Trash2 className="h-2.5 w-2.5" />
                                            </button>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}

                        {unitShelves.length === 0 && (
                          <div className="text-[10px] text-slate-400 italic py-1">No shelves created</div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
                  </div>
                  )}
                </div>
              ))}

              {sortedActiveStorageUnits.length === 0 && (
                <div className="text-center py-6">
                  <p className="text-xs text-slate-400">No refrigerators or freezers initialized.</p>
                  <button
                    onClick={() => {
                      setEditingStorageItem(null);
                      setStorageModalMode("storage");
                      setStorageModalOpen(true);
                    }}
                    className="mt-2 text-xs font-bold text-indigo-600 hover:underline"
                  >
                    + Add New Unit
                  </button>
                </div>
              )}
            </div>
          </div>

        </aside>

        {/* Center Main Work Space: Grid Visualizer or Bulk Import */}
        <section className="flex-1 p-6 flex flex-col gap-6 overflow-y-auto">
          
          {showBulkImport ? (
            <BulkImportPanel
              storageUnits={state.storageUnits}
              shelves={state.shelves}
              racks={state.racks}
              drawers={state.drawers}
              boxes={state.boxes}
              onImportComplete={handleBulkImportComplete}
            />
          ) : showBulkRename ? (
            <BulkRenamePanel
              storageUnits={state.storageUnits}
              shelves={state.shelves}
              racks={state.racks}
              drawers={state.drawers}
              boxes={state.boxes}
              samples={state.samples}
              onRenameComplete={handleBulkRenameComplete}
            />
          ) : (
            <>
              {/* Context bar / Breadcrumbs */}
              <div className="flex items-center justify-between shrink-0 bg-white border border-slate-200/60 rounded-xl p-4 shadow-3xs">
                <div>
                  <nav className="flex flex-wrap gap-1.5 text-[10px] uppercase font-bold tracking-wider text-slate-400 mb-1 items-center">
                    <button 
                      onClick={() => {
                        setSelectedStorageId("");
                        setSelectedShelfId("");
                        setSelectedRackId("");
                        setSelectedDrawerId("");
                        setSelectedBoxId(null);
                        setSelectedSampleId(null);
                      }}
                      className="hover:text-indigo-600 transition-colors cursor-pointer"
                    >
                      Lab Units
                    </button>
                    <span>&gt;</span>
                    {currentStorage ? (
                      <button
                        onClick={() => {
                          setSelectedShelfId("");
                          setSelectedRackId("");
                          setSelectedDrawerId("");
                          setSelectedBoxId(null);
                          setSelectedSampleId(null);
                        }}
                        className={`hover:text-indigo-600 transition-colors cursor-pointer ${!selectedShelfId ? "text-indigo-600" : "text-slate-600"}`}
                      >
                        {currentStorage.name}
                      </button>
                    ) : (
                      <span className="text-slate-500">None Selected</span>
                    )}
                    
                    {currentShelf && (
                      <>
                        <span>&gt;</span>
                        <button
                          onClick={() => {
                            setSelectedRackId("");
                            setSelectedDrawerId("");
                            setSelectedBoxId(null);
                            setSelectedSampleId(null);
                          }}
                          className={`hover:text-indigo-600 transition-colors cursor-pointer ${!selectedRackId && !selectedBoxId ? "text-indigo-600" : "text-slate-600"}`}
                        >
                          {currentShelf.name}
                        </button>
                      </>
                    )}

                    {currentRack && (
                      <>
                        <span>&gt;</span>
                        <button
                          onClick={() => {
                            setSelectedDrawerId("");
                            setSelectedBoxId(null);
                            setSelectedSampleId(null);
                          }}
                          className={`hover:text-indigo-600 transition-colors cursor-pointer ${!selectedDrawerId && !selectedBoxId ? "text-indigo-600" : "text-slate-600"}`}
                        >
                          {currentRack.name}
                        </button>
                      </>
                    )}

                    {currentDrawer && (
                      <>
                        <span>&gt;</span>
                        <button
                          onClick={() => {
                            setSelectedBoxId(null);
                            setSelectedSampleId(null);
                          }}
                          className={`hover:text-indigo-600 transition-colors cursor-pointer ${!selectedBoxId ? "text-indigo-600" : "text-slate-600"}`}
                        >
                          {currentDrawer.name}
                        </button>
                      </>
                    )}

                    {currentBox && (
                      <>
                        <span>&gt;</span>
                        <span className="text-indigo-600 font-extrabold">{currentBox.name}</span>
                      </>
                    )}
                  </nav>
                  
                  <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-1.5">
                    {currentBox 
                      ? `${currentBox.name} Grid View` 
                      : currentDrawer
                      ? `${currentDrawer.name} Drawer View`
                      : currentRack
                      ? `${currentRack.name} Rack View`
                      : currentShelf 
                      ? `${currentShelf.name} Shelf View` 
                      : currentStorage
                      ? currentStorage.name
                      : "Laboratory Storage Dashboard"}
                    {currentBox && currentBox.rows && (
                      <span className="text-xs font-normal text-slate-400">
                        — Grid layout ({currentBox.rows}x{currentBox.cols})
                      </span>
                    )}
                  </h3>
                </div>

                <div className="flex gap-2">
                  {selectedGridSampleIds.length > 0 && currentBox && currentBox.rows && currentBox.cols && (
                    <>
                      <div className="px-2.5 py-2 text-xs font-bold rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700">
                        {selectedGridSampleIds.length} selected
                      </div>
                      <button
                        onClick={handleMoveSelectedGridSamples}
                        className="px-3 py-2 text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-sm transition-all flex items-center gap-1 cursor-pointer"
                      >
                        <Move className="h-3.5 w-3.5" /> Move Selected
                      </button>
                      <button
                        onClick={handleArchiveSelectedGridSamples}
                        className="px-3 py-2 text-xs font-bold bg-red-600 hover:bg-red-700 text-white rounded-lg shadow-sm transition-all flex items-center gap-1 cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Archive Selected
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => {
                      setBulkSelectedIds([]);
                      setBulkItemType("sample");
                      setBulkSelectOpen(true);
                    }}
                    className="px-3 py-2 text-xs font-bold bg-white border border-slate-200 hover:border-indigo-200 hover:bg-slate-50 text-slate-700 rounded-lg shadow-sm transition-all flex items-center gap-1 cursor-pointer"
                  >
                    <Move className="h-3.5 w-3.5" /> Bulk Actions
                  </button>
                  <button
                    onClick={handleOpenNewSampleModal}
                    disabled={!hasAnyActiveShelf}
                    className="px-4 py-2 text-xs font-bold bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded-lg shadow-sm transition-all flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="h-3.5 w-3.5" /> New Sample
                  </button>
                </div>
              </div>

              {/* Trash restored manager panel */}
              {showTrash && (
                <div className="bg-red-50/50 border border-red-100 rounded-xl p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Inbox className="h-5 w-5 text-red-600" />
                      <h4 className="text-sm font-bold text-red-900">Trash / Archive Manager (Non-destructive Restoration)</h4>
                    </div>
                    <button onClick={() => setShowTrash(false)} className="p-1 hover:bg-red-100 text-red-400 rounded-full">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <p className="text-xs text-red-800/80">
                    All archived samples and containers are listed here. You can restore samples, boxes, drawers, racks, shelves, and storage units with one click.
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 max-h-72 overflow-y-auto pt-1">
                    {/* Samples */}
                    <div className="p-3 bg-white border border-red-100 rounded-lg space-y-2">
                      <div className="text-[10px] font-bold text-red-700 uppercase tracking-wider">Archived Samples</div>
                      {state.samples.filter(s => s.isArchived).length === 0 ? (
                        <p className="text-xs text-slate-400 italic">No archived samples</p>
                      ) : (
                        <div className="divide-y divide-slate-100 max-h-40 overflow-y-auto text-xs">
                          {state.samples.filter(s => s.isArchived).map(s => (
                            <div key={s.id} className="py-2 flex justify-between items-center">
                              <div>
                                <span className="font-semibold text-slate-800">{s.chemicalName}</span>
                                <p className="text-[10px] text-slate-400">Qty: {s.qty} {s.units}</p>
                              </div>
                              <button
                                onClick={() => handleRestoreItemWithConfirm("sample", s)}
                                className="px-2 py-1 text-[10px] bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded font-semibold"
                              >
                                Restore
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Boxes */}
                    <div className="p-3 bg-white border border-red-100 rounded-lg space-y-2">
                      <div className="text-[10px] font-bold text-red-700 uppercase tracking-wider">Archived Boxes</div>
                      {state.boxes.filter(b => b.isArchived).length === 0 ? (
                        <p className="text-xs text-slate-400 italic">No archived boxes</p>
                      ) : (
                        <div className="divide-y divide-slate-100 max-h-40 overflow-y-auto text-xs">
                          {state.boxes.filter(b => b.isArchived).map(b => (
                            <div key={b.id} className="py-2 flex justify-between items-center">
                              <span className="font-semibold text-slate-800">{b.name}</span>
                              <button
                                onClick={() => handleRestoreItemWithConfirm("box", b)}
                                className="px-2 py-1 text-[10px] bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded font-semibold"
                              >
                                Restore
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Drawers */}
                    <div className="p-3 bg-white border border-red-100 rounded-lg space-y-2">
                      <div className="text-[10px] font-bold text-red-700 uppercase tracking-wider">Archived Drawers</div>
                      {state.drawers.filter(d => d.isArchived).length === 0 ? (
                        <p className="text-xs text-slate-400 italic">No archived drawers</p>
                      ) : (
                        <div className="divide-y divide-slate-100 max-h-40 overflow-y-auto text-xs">
                          {state.drawers.filter(d => d.isArchived).map(d => (
                            <div key={d.id} className="py-2 flex justify-between items-center">
                              <span className="font-semibold text-slate-800">{d.name}</span>
                              <button
                                onClick={() => handleRestoreItemWithConfirm("drawer", d)}
                                className="px-2 py-1 text-[10px] bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded font-semibold"
                              >
                                Restore
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Racks */}
                    <div className="p-3 bg-white border border-red-100 rounded-lg space-y-2">
                      <div className="text-[10px] font-bold text-red-700 uppercase tracking-wider">Archived Racks</div>
                      {state.racks.filter(r => r.isArchived).length === 0 ? (
                        <p className="text-xs text-slate-400 italic">No archived racks</p>
                      ) : (
                        <div className="divide-y divide-slate-100 max-h-40 overflow-y-auto text-xs">
                          {state.racks.filter(r => r.isArchived).map(r => (
                            <div key={r.id} className="py-2 flex justify-between items-center">
                              <span className="font-semibold text-slate-800">{r.name}</span>
                              <button
                                onClick={() => handleRestoreItemWithConfirm("rack", r)}
                                className="px-2 py-1 text-[10px] bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded font-semibold"
                              >
                                Restore
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Shelves */}
                    <div className="p-3 bg-white border border-red-100 rounded-lg space-y-2">
                      <div className="text-[10px] font-bold text-red-700 uppercase tracking-wider">Archived Shelves</div>
                      {state.shelves.filter(s => s.isArchived).length === 0 ? (
                        <p className="text-xs text-slate-400 italic">No archived shelves</p>
                      ) : (
                        <div className="divide-y divide-slate-100 max-h-40 overflow-y-auto text-xs">
                          {state.shelves.filter(s => s.isArchived).map(s => (
                            <div key={s.id} className="py-2 flex justify-between items-center">
                              <span className="font-semibold text-slate-800">{s.name}</span>
                              <button
                                onClick={() => handleRestoreItemWithConfirm("shelf", s)}
                                className="px-2 py-1 text-[10px] bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded font-semibold"
                              >
                                Restore
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Storage Units */}
                    <div className="p-3 bg-white border border-red-100 rounded-lg space-y-2">
                      <div className="text-[10px] font-bold text-red-700 uppercase tracking-wider">Archived Storage Units</div>
                      {state.storageUnits.filter(u => u.isArchived).length === 0 ? (
                        <p className="text-xs text-slate-400 italic">No archived storage units</p>
                      ) : (
                        <div className="divide-y divide-slate-100 max-h-40 overflow-y-auto text-xs">
                          {state.storageUnits.filter(u => u.isArchived).map(u => (
                            <div key={u.id} className="py-2 flex justify-between items-center">
                              <span className="font-semibold text-slate-800">{u.name}</span>
                              <button
                                onClick={() => handleRestoreItemWithConfirm("storage", u)}
                                className="px-2 py-1 text-[10px] bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded font-semibold"
                              >
                                Restore
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Visualization and Interactive Stage */}
              <div className="flex-1 min-h-[400px] bg-white border border-slate-200 rounded-xl p-6 shadow-3xs flex flex-col justify-between">
                
                {/* 1. Box Level visualization */}
                {currentBox ? (
                  currentBox.rows && currentBox.cols ? (
                    <div className="space-y-6 flex-1 flex flex-col justify-between">
                      {/* Visual Grid Coordinate Container */}
                      <div className="overflow-auto w-full p-2 bg-slate-50 rounded-xl border border-slate-100 shadow-inner">
                        <div 
                          className="grid gap-2 p-3 sm:p-4 bg-white border border-slate-200 rounded-lg shadow-xs w-full"
                          style={{
                            gridTemplateColumns: `repeat(${currentBox.cols}, minmax(0, 1fr))`
                          }}
                        >
                          {Array.from({ length: currentBox.rows }).map((_, rIdx) => {
                            const rowNum = rIdx + 1;
                            return Array.from({ length: currentBox.cols }).map((_, cIdx) => {
                              const colNum = cIdx + 1;
                              
                              // Find sample inside this slot
                              const slotSample = currentViewSamples.find(s => s.row === rowNum && s.col === colNum);
                              const isSelected = Boolean(slotSample && (selectedGridSampleIds.includes(slotSample.id) || selectedSampleId === slotSample.id));
                              const selectionIndex = slotSample ? selectedGridSampleIds.indexOf(slotSample.id) : -1;
                              const isDragOver = dragOverCell?.row === rowNum && dragOverCell?.col === colNum;
                              
                              // Determine fill colors based on quantity or presence
                              let bgClass = "bg-slate-50 hover:bg-slate-100 text-slate-300 border-slate-200/60";
                              if (slotSample) {
                                if (slotSample.qty === 0) {
                                  bgClass = "bg-orange-50 hover:bg-orange-100 border-orange-200 text-orange-700 font-bold";
                                } else {
                                  bgClass = "bg-indigo-50 hover:bg-indigo-100 border-indigo-200 text-indigo-700 font-bold";
                                }
                              }
                              
                              if (isSelected) {
                                bgClass = "bg-indigo-600 text-white border-indigo-700 shadow-md ring-2 ring-indigo-300 scale-95 z-5";
                              }

                              if (isDragOver) {
                                bgClass = "bg-emerald-100 text-emerald-800 border-dashed border-emerald-500 scale-105 z-10 animate-pulse";
                              }

                              return (
                                <div
                                  key={`${rowNum}-${colNum}`}
                                  draggable={!!slotSample}
                                  onDragStart={(e) => slotSample && handleDragStart(e, slotSample.id)}
                                  onDragOver={(e) => handleDragOver(e, rowNum, colNum)}
                                  onDragLeave={handleDragLeave}
                                  onDrop={(e) => handleDropOnGrid(e, rowNum, colNum)}
                                  onClick={(e) => {
                                    if (slotSample) {
                                      const clickedSampleId = slotSample.id;
                                      if (e.shiftKey && currentGridSamples.length > 0) {
                                        const anchorId = gridSelectionAnchorId || selectedSampleId;
                                        const anchorIndex = anchorId ? currentGridSamples.findIndex(sample => sample.id === anchorId) : -1;
                                        const clickedIndex = currentGridSamples.findIndex(sample => sample.id === clickedSampleId);

                                        if (anchorIndex >= 0 && clickedIndex >= 0) {
                                          const startIndex = Math.min(anchorIndex, clickedIndex);
                                          const endIndex = Math.max(anchorIndex, clickedIndex);
                                          const rangeSelection = currentGridSamples.slice(startIndex, endIndex + 1).map(sample => sample.id);
                                          setSelectedGridSampleIds(rangeSelection);
                                          setGridSelectionAnchorId(anchorId || clickedSampleId);
                                          setSelectedSampleId(clickedSampleId);
                                          return;
                                        }
                                      }

                                      if (e.ctrlKey || e.metaKey) {
                                        setSelectedGridSampleIds(prev => {
                                          const alreadySelected = prev.includes(clickedSampleId);
                                          const next = alreadySelected
                                            ? prev.filter(sampleId => sampleId !== clickedSampleId)
                                            : [...prev, clickedSampleId];

                                          if (alreadySelected) {
                                            setSelectedSampleId(next[0] || null);
                                            if (gridSelectionAnchorId === clickedSampleId) {
                                              setGridSelectionAnchorId(next[0] || null);
                                            }
                                          } else {
                                            setSelectedSampleId(clickedSampleId);
                                            setGridSelectionAnchorId(clickedSampleId);
                                          }

                                          return next;
                                        });
                                        return;
                                      }

                                      setSelectedSampleId(clickedSampleId);
                                      setSelectedGridSampleIds([clickedSampleId]);
                                      setGridSelectionAnchorId(clickedSampleId);
                                      return;
                                    }
                                    handleOpenNewSampleAtGridCell(rowNum, colNum);
                                  }}
                                  onDoubleClick={() => {
                                    if (slotSample) {
                                      handleOpenEditSampleModal(slotSample);
                                    }
                                  }}
                                  className={`relative aspect-square min-h-[56px] border rounded-md flex flex-col items-center justify-center cursor-pointer transition-all p-1 ${bgClass}`}
                                  title={slotSample ? `${slotSample.chemicalName} (Qty: ${slotSample.qty} ${slotSample.units})${slotSample.expiresOn ? ` | Expires: ${slotSample.expiresOn}` : ""}${isLowStock(slotSample) ? " | LOW STOCK" : ""}` : `Empty slot Row ${rowNum}, Col ${colNum}`}
                                >
                                  {isSelected && (
                                    <span className="absolute top-0.5 right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-white/95 px-1 text-[8px] font-extrabold text-indigo-700 shadow-sm border border-indigo-200">
                                      {selectedGridSampleIds.length > 1 && selectionIndex >= 0 ? selectionIndex + 1 : <Check className="h-2.5 w-2.5" />}
                                    </span>
                                  )}
                                  {/* Expiry / low-stock indicator dots */}
                                  {slotSample && !isSelected && (() => {
                    const expiryStatus = getExpiryStatus(slotSample);
                    const lowStock = isLowStock(slotSample);
                    if (expiryStatus === "none" && !lowStock) return null;
                    return (
                      <span className="absolute top-0.5 left-0.5 flex gap-0.5">
                        {expiryStatus !== "none" && (
                          <span className={`w-2 h-2 rounded-full ${getExpiryColorClass(expiryStatus)}`} title={`Expiry: ${getExpiryLabel(expiryStatus)}`} />
                        )}
                        {lowStock && (
                          <span className="w-2 h-2 rounded-full bg-orange-500" title="Low stock" />
                        )}
                      </span>
                    );
                  })()}
                                  <span className="text-[10px] sm:text-[11px] block opacity-60 font-semibold leading-none">
                                    {String.fromCharCode(64 + rowNum)}{colNum}
                                  </span>
                                  {slotSample && (
                                    <span className="text-[9px] sm:text-[10px] mt-1 px-0.5 font-sans font-bold text-center leading-tight line-clamp-2 break-words w-full">
                                      {slotSample.qty === 0 ? "EMPTY" : slotSample.chemicalName}
                                    </span>
                                  )}
                                </div>
                              );
                            });
                          })}
                        </div>
                      </div>

                      {/* Grid Keys */}
                      <div className="flex flex-wrap gap-5 text-xs text-slate-500 bg-slate-50 p-3 rounded-lg border border-slate-100">
                        <div className="flex items-center gap-2">
                          <span className="w-3.5 h-3.5 bg-indigo-50 border border-indigo-200 rounded"></span> 
                          <span className="font-medium">Active Sample</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="w-3.5 h-3.5 bg-orange-50 border border-orange-200 rounded"></span> 
                          <span className="font-medium">Depleted / Stock Empty</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="w-3.5 h-3.5 bg-slate-50 border border-slate-200/60 rounded"></span> 
                          <span className="font-medium">Available Slot</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="w-3.5 h-3.5 bg-indigo-600 rounded"></span> 
                          <span className="font-medium">Selected Item</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-red-500"></span>
                          <span className="font-medium">Expired / Expiring Soon</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-orange-500"></span>
                          <span className="font-medium">Low Stock</span>
                        </div>
                        <p className="text-[11px] text-indigo-700 italic ml-auto self-center flex items-center gap-1">
                          <HelpCircle className="h-3 w-3" /> Drag-and-drop a grid sample onto any empty slot to relocate!
                        </p>
                      </div>
                    </div>
                  ) : (
                    /* Free-form box list view */
                    <div className="flex-1 flex flex-col justify-between">
                      <div className="flex-1 overflow-y-auto space-y-3.5">
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                            Stored Items ({currentViewSamples.length})
                          </h4>
                        </div>

                        {currentViewSamples.length === 0 ? (
                          <div className="text-center py-16 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                            <Inbox className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                            <p className="text-xs text-slate-500">No samples placed directly in this container.</p>
                            <button
                              onClick={handleOpenNewSampleModal}
                              className="mt-2 text-xs font-bold text-indigo-600 hover:underline cursor-pointer"
                            >
                              + Add Sample Now
                            </button>
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {currentViewSamples.map(sample => {
                              const isSelected = selectedSampleId === sample.id;
                              return (
                                <div
                                  key={sample.id}
                                  onClick={() => setSelectedSampleId(sample.id)}
                                  onDoubleClick={() => handleOpenEditSampleModal(sample)}
                                  className={`p-3.5 rounded-xl border cursor-pointer transition-all flex flex-col justify-between ${
                                    isSelected 
                                      ? "bg-indigo-600 text-white border-indigo-700 shadow-md scale-[0.99]" 
                                      : "bg-white border-slate-200/70 hover:border-indigo-200 hover:bg-slate-50/50 text-slate-700"
                                  }`}
                                >
                                  <div>
                                    <div className="flex justify-between items-start">
                                      <h5 className="font-bold text-xs truncate max-w-[80%]">{sample.chemicalName}</h5>
                                      <span className={`text-[9px] uppercase px-1.5 py-0.5 rounded font-extrabold tracking-wider ${isSelected ? "bg-indigo-700/80 text-white" : "bg-slate-100 text-slate-500"}`}>
                                        {sample.itemType || "Sample"}
                                      </span>
                                    </div>
                                    <p className={`text-[10px] font-mono mt-1 ${isSelected ? "text-indigo-200" : "text-slate-400"}`}>
                                      {sample.casNumber && `CAS: ${sample.casNumber} • `}Qty: {sample.qty} {sample.units}
                                    </p>
                                    <p className={`text-[10px] font-mono mt-1 ${isSelected ? "text-indigo-200" : "text-slate-400"}`}>
                                      {getSampleConcentrationLabel(sample)} • {getSampleVolumeLabel(sample)}
                                    </p>
                                  </div>
                                  {sample.notes && (
                                    <p className={`text-[10px] mt-2 line-clamp-1 italic ${isSelected ? "text-indigo-100" : "text-slate-400"}`}>
                                      "{sample.notes}"
                                    </p>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                ) : currentDrawer ? (
                  /* 2. Drawer Level - Shows Boxes inside this Drawer */
                  <div className="space-y-4 flex-1 flex flex-col">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-extrabold text-slate-400 uppercase tracking-wider">
                        Boxes in this Drawer ({state.boxes.filter(b => b.drawerId === currentDrawer.id && !b.isArchived).length})
                      </h4>
                    </div>
                    {(() => {
                      const drawerBoxes = state.boxes.filter(b => b.drawerId === currentDrawer.id && !b.isArchived);
                          const drawerCapacity = getDrawerCapacity(currentDrawer);
                          const slottedBoxMap = new Map<number, Box>();
                          const unslottedBoxes: Box[] = [];

                          drawerBoxes.forEach(box => {
                            if (
                              typeof box.drawerSlot === "number" &&
                              box.drawerSlot >= 1 &&
                              box.drawerSlot <= drawerCapacity &&
                              !slottedBoxMap.has(box.drawerSlot)
                            ) {
                              slottedBoxMap.set(box.drawerSlot, box);
                              return;
                            }
                            unslottedBoxes.push(box);
                          });

                      return (
                            <div className="space-y-4 overflow-y-auto pb-4 flex-1">
                              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
                                <div className="flex items-center justify-between text-[11px] font-semibold text-slate-600">
                                  <span>Drawer Slots</span>
                                  <span>{slottedBoxMap.size}/{drawerCapacity} occupied</span>
                                </div>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                  {Array.from({ length: drawerCapacity }, (_, idx) => idx + 1).map(slotNum => {
                                    const slotBox = slottedBoxMap.get(slotNum);
                                    const isSlotDragOver = dragOverDrawerSlot === slotNum;
                                    return (
                                      <div
                                        key={slotNum}
                                        onDragOver={(e) => {
                                          e.preventDefault();
                                          e.dataTransfer.dropEffect = "move";
                                          setDragOverDrawerSlot(slotNum);
                                        }}
                                        onDragLeave={() => {
                                          if (isSlotDragOver) {
                                            setDragOverDrawerSlot(null);
                                          }
                                        }}
                                        onDrop={(e) => {
                                          void handleDropBoxOnDrawerSlot(e, currentDrawer.id, slotNum);
                                        }}
                                        onClick={() => {
                                          if (slotBox) {
                                            setSelectedBoxId(slotBox.id);
                                            return;
                                          }
                                          handleOpenNewBoxModal(slotNum);
                                        }}
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter" || e.key === " ") {
                                            e.preventDefault();
                                            if (slotBox) {
                                              setSelectedBoxId(slotBox.id);
                                              return;
                                            }
                                            handleOpenNewBoxModal(slotNum);
                                          }
                                        }}
                                        role="button"
                                        tabIndex={0}
                                        className={`text-left rounded-md border px-2 py-1.5 text-[10px] transition-colors relative ${slotBox ? "bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100" : "bg-white border-slate-200 text-slate-400"} ${isSlotDragOver ? "ring-2 ring-indigo-300 border-indigo-300 bg-indigo-100/50" : ""}`}
                                      >
                                        {slotBox && (
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              void handleUnassignBoxFromSlot(slotBox.id);
                                            }}
                                            className="absolute top-1 right-1 px-1 py-0.5 rounded bg-white/90 border border-indigo-200 text-[8px] font-bold text-indigo-600 hover:bg-white"
                                            title="Remove this box from slot assignment"
                                          >
                                            Unslot
                                          </button>
                                        )}
                                        <div className="font-bold">Slot {slotNum}</div>
                                        <div className="truncate">{slotBox ? slotBox.name : "Empty"}</div>
                                      </div>
                                    );
                                  })}
                                </div>
                                {unslottedBoxes.length > 0 ? (
                                  <p className="text-[10px] text-amber-700">
                                    {unslottedBoxes.length} box(es) have no assigned slot yet. Edit each box to assign a drawer slot.
                                  </p>
                                ) : null}
                              </div>

                              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                          {drawerBoxes.map(box => {
                            const samplesCount = getBoxSamplesCount(box.id);
                            return (
                              <div 
                                key={box.id}
                                onClick={() => setSelectedBoxId(box.id)}
                                draggable={true}
                                onDragStart={(e) => {
                                  setDraggedBoxId(box.id);
                                  e.dataTransfer.setData("text/plain", JSON.stringify({ type: "box", id: box.id }));
                                }}
                                onDragEnd={clearBoxDragState}
                                className="group relative flex flex-col justify-between bg-white hover:bg-indigo-50/10 border border-slate-200 hover:border-indigo-300 rounded-xl p-4 shadow-3xs hover:shadow-xs transition-all duration-200 cursor-pointer h-32 overflow-hidden"
                              >
                                <div className="absolute top-0 left-0 bottom-0 w-1 bg-blue-500" />
                                <div>
                                  <div className="flex justify-between items-start mb-1">
                                    <div className="flex items-center gap-1.5 max-w-[85%]">
                                      <BoxIcon className="h-4 w-4 shrink-0 text-blue-500" />
                                      <h4 className="text-xs font-bold text-slate-800 group-hover:text-indigo-600 transition-colors truncate" title={box.name}>
                                        {box.name}
                                      </h4>
                                    </div>
                                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setEditingStorageItem(box);
                                          setStorageModalMode("box");
                                          setStorageModalOpen(true);
                                        }}
                                        className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-indigo-600 cursor-pointer"
                                      >
                                        <Edit2 className="h-3 w-3" />
                                      </button>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleArchiveBox(box.id, box.name);
                                        }}
                                        className="p-1 hover:bg-red-50 rounded text-slate-400 hover:text-red-600 cursor-pointer"
                                      >
                                        <Trash2 className="h-3 w-3" />
                                      </button>
                                    </div>
                                  </div>
                                  <p className="text-[10px] text-slate-400">
                                    {box.rows && box.cols ? `Grid Coordinate layout (${box.rows}x${box.cols})` : "Free-form layout"}
                                  </p>
                                  <p className="text-[10px] text-slate-400">
                                    Drawer slot: {typeof box.drawerSlot === "number" ? box.drawerSlot : "Unassigned"}
                                  </p>
                                </div>
                                <div className="flex items-center justify-between text-[10px] font-semibold text-slate-500 mt-2">
                                  <span className="flex items-center gap-1">
                                    <Database className="h-3.5 w-3.5 text-slate-400" />
                                    <span>{samplesCount} {samplesCount === 1 ? "sample" : "samples"}</span>
                                  </span>
                                  <span className="text-indigo-500 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all font-bold">
                                    Open Box <ArrowRight className="h-3 w-3" />
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                          </div>
                          {/* Add box card */}
                          <div
                            onClick={() => handleOpenNewBoxModal(null)}
                            className="flex flex-col items-center justify-center border-2 border-dashed border-slate-200 hover:border-indigo-400 bg-slate-50/40 hover:bg-indigo-50/5 rounded-xl p-4 h-32 transition-all duration-200 cursor-pointer text-slate-400 hover:text-indigo-600 text-center group"
                          >
                            <Plus className="h-5 w-5 mb-1.5 text-slate-300 group-hover:text-indigo-500 group-hover:scale-110 transition-transform" />
                            <span className="text-[10px] font-bold uppercase tracking-wider">Add Box in Drawer</span>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Loose / Direct Stored Items in Drawer */}
                    {(() => {
                      const drawerDirectSamples = state.samples.filter(
                        s => s.drawerId === currentDrawer.id && !s.boxId && !s.isArchived
                      );
                      if (drawerDirectSamples.length === 0) return null;
                      return (
                        <div className="space-y-3 pt-4 border-t border-slate-100 shrink-0">
                          <div className="flex items-center justify-between">
                            <h4 className="text-xs font-extrabold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                              <Database className="h-3.5 w-3.5 text-indigo-500" />
                              Direct / Loose Items in this Drawer ({drawerDirectSamples.length})
                            </h4>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 max-h-56 overflow-y-auto pb-2">
                            {drawerDirectSamples.map(sample => {
                              const isSelected = selectedSampleId === sample.id;
                              return (
                                <div
                                  key={sample.id}
                                  onClick={() => setSelectedSampleId(sample.id)}
                                  onDoubleClick={() => handleOpenEditSampleModal(sample)}
                                  draggable={true}
                                  onDragStart={(e) => handleDragStart(e, sample.id)}
                                  onDragEnd={() => setDraggedSampleId(null)}
                                  className={`p-3 rounded-xl border cursor-grab active:cursor-grabbing transition-all flex flex-col justify-between ${
                                    isSelected 
                                      ? "bg-indigo-600 text-white border-indigo-700 shadow-md scale-[0.99]" 
                                      : "bg-white border-slate-200/70 hover:border-indigo-200 hover:bg-slate-50/50 text-slate-700"
                                  }`}
                                >
                                  <div>
                                    <div className="flex justify-between items-start">
                                      <h5 className="font-bold text-xs truncate max-w-[80%]">{sample.chemicalName}</h5>
                                      <span className={`text-[9px] uppercase px-1.5 py-0.5 rounded font-extrabold tracking-wider ${isSelected ? "bg-indigo-700/80 text-white" : "bg-slate-100 text-slate-500"}`}>
                                        {sample.itemType || "Sample"}
                                      </span>
                                    </div>
                                    <p className={`text-[10px] font-mono mt-1 ${isSelected ? "text-indigo-200" : "text-slate-400"}`}>
                                      {sample.casNumber && `CAS: ${sample.casNumber} • `}Qty: {sample.qty} {sample.units}
                                    </p>
                                    <p className={`text-[10px] font-mono mt-1 ${isSelected ? "text-indigo-200" : "text-slate-400"}`}>
                                      {getSampleConcentrationLabel(sample)} • {getSampleVolumeLabel(sample)}
                                    </p>
                                  </div>
                                  {sample.notes && (
                                    <p className={`text-[10px] mt-2 line-clamp-1 italic ${isSelected ? "text-indigo-100" : "text-slate-400"}`}>
                                      "{sample.notes}"
                                    </p>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                ) : currentRack ? (
                  /* 3. Rack Level - Shows Boxes inside Drawers */
                  <div className="space-y-6 flex-1 flex flex-col overflow-y-auto pb-4">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-extrabold text-slate-400 uppercase tracking-wider">
                          Drawer Box Grid ({state.drawers.filter(d => d.rackId === currentRack.id && !d.isArchived).length} drawers)
                        </h4>
                      </div>

                      {(() => {
                        const rackDrawers = state.drawers
                          .filter(d => d.rackId === currentRack.id && !d.isArchived)
                          .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));

                        return (
                          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                            {rackDrawers.map(drawer => {
                              const drawerBoxes = state.boxes
                                .filter(b => b.drawerId === drawer.id && !b.isArchived)
                                .sort((a, b) => {
                                  const aSlot = typeof a.drawerSlot === "number" ? a.drawerSlot : Number.MAX_SAFE_INTEGER;
                                  const bSlot = typeof b.drawerSlot === "number" ? b.drawerSlot : Number.MAX_SAFE_INTEGER;
                                  if (aSlot !== bSlot) return aSlot - bSlot;
                                  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
                                });
                              const drawerCapacity = getDrawerCapacity(drawer);
                              const isDrawerActive = selectedDrawerId === drawer.id;
                              return (
                                <div
                                  key={drawer.id}
                                  onDragOver={(e) => {
                                    e.preventDefault();
                                    e.dataTransfer.dropEffect = "move";
                                  }}
                                  onDrop={(e) => {
                                    e.preventDefault();
                                    const dragPayload = readDragPayload(e);
                                    if (dragPayload?.type === "box") {
                                      const occupiedSlots = new Set(
                                        drawerBoxes
                                          .filter(box => typeof box.drawerSlot === "number")
                                          .map(box => box.drawerSlot as number)
                                      );
                                      const availableSlot = Array.from(
                                        { length: drawerCapacity },
                                        (_, index) => index + 1
                                      ).find(slot => !occupiedSlots.has(slot));
                                      if (availableSlot) {
                                        void handleDropBoxOnDrawerSlot(e, drawer.id, availableSlot);
                                      } else {
                                        alert(`Drawer "${drawer.name}" is full.`);
                                        clearBoxDragState();
                                      }
                                    } else if (dragPayload?.type === "sample") {
                                      handleDropMove(e, "drawer", drawer.id);
                                    }
                                  }}
                                  onClick={() => setSelectedDrawerId(drawer.id)}
                                  className={`group relative rounded-2xl border bg-white shadow-3xs overflow-hidden transition-all cursor-pointer ${
                                    isDrawerActive ? "border-indigo-300 ring-2 ring-indigo-100" : "border-slate-200 hover:border-indigo-200"
                                  }`}
                                >
                                  <div className="absolute top-0 left-0 bottom-0 w-1.5 bg-emerald-500" />
                                  <div className="p-4 pl-5 border-b border-slate-100 bg-slate-50/70 flex items-start justify-between gap-3">
                                    <div>
                                      <h4 className="text-xs font-bold text-slate-900 group-hover:text-indigo-600 transition-colors truncate" title={drawer.name}>
                                        {drawer.name}
                                      </h4>
                                      <p className="text-[10px] text-slate-500 mt-1">
                                        {drawerBoxes.length} box{drawerBoxes.length === 1 ? "" : "es"} • {drawerCapacity} slot{drawerCapacity === 1 ? "" : "s"}
                                      </p>
                                    </div>
                                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setEditingStorageItem(drawer);
                                          setStorageModalMode("drawer");
                                          setStorageModalOpen(true);
                                        }}
                                        className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-indigo-600 cursor-pointer"
                                      >
                                        <Edit2 className="h-3 w-3" />
                                      </button>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleArchiveDrawer(drawer.id, drawer.name);
                                        }}
                                        className="p-1 hover:bg-red-50 rounded text-slate-400 hover:text-red-600 cursor-pointer"
                                      >
                                        <Trash2 className="h-3 w-3" />
                                      </button>
                                    </div>
                                  </div>

                                  <div className="p-4 pl-5">
                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                                      {drawerBoxes.length > 0 ? drawerBoxes.map(box => {
                                        const isBoxActive = selectedBoxId === box.id;
                                        return (
                                          <div
                                            key={box.id}
                                            draggable={true}
                                            onDragStart={(e) => {
                                              setDraggedBoxId(box.id);
                                              e.dataTransfer.setData("text/plain", JSON.stringify({ type: "box", id: box.id }));
                                            }}
                                            onDragEnd={clearBoxDragState}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setSelectedBoxId(box.id);
                                            }}
                                            className={`group/box relative rounded-xl border p-2.5 min-h-[92px] transition-all cursor-pointer shadow-3xs hover:shadow-xs ${
                                              isBoxActive
                                                ? "bg-indigo-600 text-white border-indigo-700"
                                                : "bg-slate-50 border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/20 text-slate-700"
                                            }`}
                                          >
                                            <div className={`absolute top-0 left-0 bottom-0 w-1 rounded-l-xl ${isBoxActive ? "bg-white/70" : "bg-blue-500"}`} />
                                            <div className="flex justify-between items-start gap-2 pl-1">
                                              <div className="min-w-0">
                                                <div className="flex items-center gap-1.5 min-w-0">
                                                  <BoxIcon className={`h-3.5 w-3.5 shrink-0 ${isBoxActive ? "text-blue-100" : "text-blue-500"}`} />
                                                  <h5 className="text-[11px] font-bold truncate" title={box.name}>
                                                    {box.name}
                                                  </h5>
                                                </div>
                                                <p className={`text-[9px] mt-1 ${isBoxActive ? "text-blue-100" : "text-slate-400"}`}>
                                                  Slot {typeof box.drawerSlot === "number" ? box.drawerSlot : "-"}
                                                </p>
                                              </div>
                                              <div className="flex gap-0.5 opacity-0 group-hover/box:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                                                <button
                                                  onClick={() => {
                                                    setEditingStorageItem(box);
                                                    setStorageModalMode("box");
                                                    setStorageModalOpen(true);
                                                  }}
                                                  className={`p-0.5 rounded ${isBoxActive ? "hover:bg-indigo-700 text-indigo-200" : "hover:bg-slate-200 text-slate-400 hover:text-slate-700"}`}
                                                >
                                                  <Edit2 className="h-2.5 w-2.5" />
                                                </button>
                                                <button
                                                  onClick={() => handleArchiveBox(box.id, box.name)}
                                                  className={`p-0.5 rounded ${isBoxActive ? "hover:bg-indigo-700 text-indigo-200" : "hover:bg-red-50 text-slate-400 hover:text-red-600"}`}
                                                >
                                                  <Trash2 className="h-2.5 w-2.5" />
                                                </button>
                                              </div>
                                            </div>

                                            <div className="mt-3 pl-1 flex items-center justify-between text-[10px] font-semibold">
                                              <span className={isBoxActive ? "text-blue-100" : "text-slate-500"}>
                                                {getBoxSamplesCount(box.id)} sample{getBoxSamplesCount(box.id) === 1 ? "" : "s"}
                                              </span>
                                              <span className={isBoxActive ? "text-blue-100" : "text-indigo-500"}>
                                                Open
                                              </span>
                                            </div>
                                          </div>
                                        );
                                      }) : (
                                        <div className="col-span-full rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-4 text-center text-[11px] text-slate-400">
                                          No boxes in this drawer.
                                        </div>
                                      )}
                                    </div>

                                    <div className="mt-3 flex items-center justify-between text-[10px] text-slate-400">
                                      <span>{drawerBoxes.length} placed / {drawerCapacity} slots</span>
                                      <span className="opacity-0 group-hover:opacity-100 transition-opacity">Click a box to open it</span>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </div>

                    {/* Direct Boxes inside Rack */}
                    <div className="space-y-3 pt-4 border-t border-slate-100">
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-extrabold text-slate-400 uppercase tracking-wider">
                          Direct Boxes in this Rack ({state.boxes.filter(b => b.rackId === currentRack.id && !b.drawerId && !b.isArchived).length})
                        </h4>
                      </div>
                      {(() => {
                        const rackDirectBoxes = state.boxes.filter(b => b.rackId === currentRack.id && !b.drawerId && !b.isArchived);
                        return (
                          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                            {rackDirectBoxes.map(box => {
                              const samplesCount = getBoxSamplesCount(box.id);
                              return (
                                <div 
                                  key={box.id}
                                  onClick={() => setSelectedBoxId(box.id)}
                                  draggable={true}
                                  onDragStart={(e) => {
                                    setDraggedBoxId(box.id);
                                    e.dataTransfer.effectAllowed = "move";
                                    e.dataTransfer.setData("text/plain", JSON.stringify({ type: "box", id: box.id }));
                                  }}
                                  onDragEnd={clearBoxDragState}
                                  className="group relative flex flex-col justify-between bg-white hover:bg-indigo-50/10 border border-slate-200 hover:border-indigo-300 rounded-xl p-4 shadow-3xs hover:shadow-xs transition-all duration-200 cursor-pointer h-32 overflow-hidden"
                                >
                                  <div className="absolute top-0 left-0 bottom-0 w-1 bg-blue-500" />
                                  <div>
                                    <div className="flex justify-between items-start mb-1">
                                      <div className="flex items-center gap-1.5 max-w-[85%]">
                                        <BoxIcon className="h-4 w-4 shrink-0 text-blue-500" />
                                        <h4 className="text-xs font-bold text-slate-800 group-hover:text-indigo-600 transition-colors truncate" title={box.name}>
                                          {box.name}
                                        </h4>
                                      </div>
                                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setEditingStorageItem(box);
                                            setStorageModalMode("box");
                                            setStorageModalOpen(true);
                                          }}
                                          className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-indigo-600 cursor-pointer"
                                        >
                                          <Edit2 className="h-3 w-3" />
                                        </button>
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleArchiveBox(box.id, box.name);
                                          }}
                                          className="p-1 hover:bg-red-50 rounded text-slate-400 hover:text-red-600 cursor-pointer"
                                        >
                                          <Trash2 className="h-3 w-3" />
                                        </button>
                                      </div>
                                    </div>
                                    <p className="text-[10px] text-slate-400">
                                      {box.rows && box.cols ? `Grid Coordinate layout (${box.rows}x${box.cols})` : "Free-form layout"}
                                    </p>
                                  </div>
                                  <div className="flex items-center justify-between text-[10px] font-semibold text-slate-500 mt-2">
                                    <span className="flex items-center gap-1">
                                      <Database className="h-3.5 w-3.5 text-slate-400" />
                                      <span>{samplesCount} {samplesCount === 1 ? "sample" : "samples"}</span>
                                    </span>
                                    <span className="text-indigo-500 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all font-bold">
                                      Open Box <ArrowRight className="h-3 w-3" />
                                    </span>
                                  </div>
                                </div>
                              );
                            })}
                            <div
                              onClick={() => {
                                setEditingStorageItem(null);
                                setStorageModalMode("box");
                                setStorageModalOpen(true);
                              }}
                              className="flex flex-col items-center justify-center border-2 border-dashed border-slate-200 hover:border-indigo-400 bg-slate-50/40 hover:bg-indigo-50/5 rounded-xl p-4 h-32 transition-all duration-200 cursor-pointer text-slate-400 hover:text-indigo-600 text-center group"
                            >
                              <Plus className="h-5 w-5 mb-1.5 text-slate-300 group-hover:text-indigo-500 group-hover:scale-110 transition-transform" />
                              <span className="text-[10px] font-bold uppercase tracking-wider">Add Direct Box</span>
                            </div>
                          </div>
                        );
                      })()}
                    </div>

                    {/* Loose / Direct Stored Items in Rack */}
                    {(() => {
                      const rackDirectSamples = state.samples.filter(
                        s => s.rackId === currentRack.id && !s.drawerId && !s.boxId && !s.isArchived
                      );
                      if (rackDirectSamples.length === 0) return null;
                      return (
                        <div className="space-y-3 pt-4 border-t border-slate-100 shrink-0">
                          <div className="flex items-center justify-between">
                            <h4 className="text-xs font-extrabold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                              <Database className="h-3.5 w-3.5 text-indigo-500" />
                              Direct / Loose Items in this Rack ({rackDirectSamples.length})
                            </h4>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 max-h-56 overflow-y-auto pb-2">
                            {rackDirectSamples.map(sample => {
                              const isSelected = selectedSampleId === sample.id;
                              return (
                                <div
                                  key={sample.id}
                                  onClick={() => setSelectedSampleId(sample.id)}
                                  onDoubleClick={() => handleOpenEditSampleModal(sample)}
                                  draggable={true}
                                  onDragStart={(e) => handleDragStart(e, sample.id)}
                                  onDragEnd={() => setDraggedSampleId(null)}
                                  className={`p-3 rounded-xl border cursor-grab active:cursor-grabbing transition-all flex flex-col justify-between ${
                                    isSelected 
                                      ? "bg-indigo-600 text-white border-indigo-700 shadow-md scale-[0.99]" 
                                      : "bg-white border-slate-200/70 hover:border-indigo-200 hover:bg-slate-50/50 text-slate-700"
                                  }`}
                                >
                                  <div>
                                    <div className="flex justify-between items-start">
                                      <h5 className="font-bold text-xs truncate max-w-[80%]">{sample.chemicalName}</h5>
                                      <span className={`text-[9px] uppercase px-1.5 py-0.5 rounded font-extrabold tracking-wider ${isSelected ? "bg-indigo-700/80 text-white" : "bg-slate-100 text-slate-500"}`}>
                                        {sample.itemType || "Sample"}
                                      </span>
                                    </div>
                                    <p className={`text-[10px] font-mono mt-1 ${isSelected ? "text-indigo-200" : "text-slate-400"}`}>
                                      {sample.casNumber && `CAS: ${sample.casNumber} • `}Qty: {sample.qty} {sample.units}
                                    </p>
                                    <p className={`text-[10px] font-mono mt-1 ${isSelected ? "text-indigo-200" : "text-slate-400"}`}>
                                      {getSampleConcentrationLabel(sample)} • {getSampleVolumeLabel(sample)}
                                    </p>
                                  </div>
                                  {sample.notes && (
                                    <p className={`text-[10px] mt-2 line-clamp-1 italic ${isSelected ? "text-indigo-100" : "text-slate-400"}`}>
                                      "{sample.notes}"
                                    </p>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                ) : currentShelf ? (
                  /* 4. Shelf Level - Shows Racks and Direct Boxes on this Shelf */
                  <div className="space-y-6 flex-1 flex flex-col overflow-y-auto pb-4">
                    {/* Shelf View Mode Header */}
                    <div className="flex items-center justify-between bg-slate-50 border border-slate-200/60 p-3 rounded-xl gap-3">
                      <div className="flex items-center gap-2">
                        <Layers className="h-4.5 w-4.5 text-indigo-500 animate-pulse" />
                        <div>
                          <span className="text-xs font-bold text-slate-800 uppercase tracking-wide">
                            {currentShelf.name} Dashboard
                          </span>
                          <span className="text-[10px] text-slate-500 font-medium block">
                            Configure layout & explore direct inventory list or physical container grid.
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {/* Toggle View Mode */}
                        <div className="flex items-center bg-slate-100 p-1 rounded-lg border border-slate-200 text-xs">
                          <button
                            onClick={() => setViewMode("grid")}
                            className={`px-3 py-1 rounded-md font-bold transition-all cursor-pointer flex items-center gap-1 ${
                              viewMode === "grid" 
                                ? "bg-white text-indigo-600 shadow-3xs" 
                                : "text-slate-500 hover:text-slate-800"
                            }`}
                          >
                            <Grid className="h-3 w-3" /> Grid View
                          </button>
                          <button
                            onClick={() => setViewMode("list")}
                            className={`px-3 py-1 rounded-md font-bold transition-all cursor-pointer flex items-center gap-1 ${
                              viewMode === "list" 
                                ? "bg-white text-indigo-600 shadow-3xs" 
                                : "text-slate-500 hover:text-slate-800"
                            }`}
                          >
                            <FileText className="h-3 w-3" /> Sortable List
                          </button>
                        </div>
                      </div>
                    </div>

                    {viewMode === "list" ? (
                      /* LIST VIEW */
                      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs flex-1 flex flex-col overflow-hidden">
                        <div className="bg-slate-50/50 p-4 border-b border-slate-100 flex flex-wrap gap-3 items-center justify-between shrink-0">
                          <div className="flex items-center gap-2">
                            <FileText className="h-4 w-4 text-indigo-500" />
                            <h4 className="text-xs font-extrabold text-slate-700 uppercase tracking-wider">
                              Shelf Inventory List ({sortedShelfSamples.length} samples)
                            </h4>
                          </div>
                          <div className="flex items-center gap-3">
                            <select
                              value={listFilter}
                              onChange={(e) => setListFilter(e.target.value as "all" | "loose")}
                              className="text-xs bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-600 font-semibold focus:outline-hidden focus:border-indigo-300 cursor-pointer shadow-3xs"
                            >
                              <option value="all">Show All Samples on Shelf</option>
                              <option value="loose">Show Loose Samples Only</option>
                            </select>
                            <div className="flex gap-1">
                              <button
                                onClick={() => setExpiryFilter(expiryFilter === "expired" ? "none" : "expired")}
                                className={`text-[10px] font-bold px-2 py-1.5 rounded-lg border transition-colors cursor-pointer ${
                                  expiryFilter === "expired"
                                    ? "bg-red-100 text-red-700 border-red-300"
                                    : "bg-white text-slate-500 border-slate-200 hover:border-red-200 hover:text-red-600"
                                }`}
                              >
                                Expired
                              </button>
                              <button
                                onClick={() => setExpiryFilter(expiryFilter === "expiring" ? "none" : "expiring")}
                                className={`text-[10px] font-bold px-2 py-1.5 rounded-lg border transition-colors cursor-pointer ${
                                  expiryFilter === "expiring"
                                    ? "bg-amber-100 text-amber-700 border-amber-300"
                                    : "bg-white text-slate-500 border-slate-200 hover:border-amber-200 hover:text-amber-600"
                                }`}
                              >
                                Expiring Soon
                              </button>
                              <button
                                onClick={() => setExpiryFilter(expiryFilter === "lowstock" ? "none" : "lowstock")}
                                className={`text-[10px] font-bold px-2 py-1.5 rounded-lg border transition-colors cursor-pointer ${
                                  expiryFilter === "lowstock"
                                    ? "bg-orange-100 text-orange-700 border-orange-300"
                                    : "bg-white text-slate-500 border-slate-200 hover:border-orange-200 hover:text-orange-600"
                                }`}
                              >
                                Low Stock
                              </button>
                            </div>
                          </div>
                        </div>

                        <div className="flex-1 overflow-auto min-h-[300px]">
                          <table className="w-full text-left border-collapse">
                            <thead>
                              <tr className="bg-slate-50 text-slate-400 font-extrabold text-[10px] uppercase tracking-wider border-b border-slate-100 select-none">
                                <th 
                                  onClick={() => handleSort("chemicalName")}
                                  className="py-3 px-4 cursor-pointer hover:bg-slate-100 hover:text-slate-700 transition-colors border-b border-slate-100"
                                >
                                  <div className="flex items-center gap-1">
                                    <span>Chemical Name</span>
                                    {sortField === "chemicalName" && (sortDirection === "asc" ? "▲" : "▼")}
                                  </div>
                                </th>
                                <th 
                                  onClick={() => handleSort("casNumber")}
                                  className="py-3 px-4 cursor-pointer hover:bg-slate-100 hover:text-slate-700 transition-colors border-b border-slate-100"
                                >
                                  <div className="flex items-center gap-1">
                                    <span>CAS Number</span>
                                    {sortField === "casNumber" && (sortDirection === "asc" ? "▲" : "▼")}
                                  </div>
                                </th>
                                <th 
                                  onClick={() => handleSort("itemType")}
                                  className="py-3 px-4 cursor-pointer hover:bg-slate-100 hover:text-slate-700 transition-colors border-b border-slate-100"
                                >
                                  <div className="flex items-center gap-1">
                                    <span>Type</span>
                                    {sortField === "itemType" && (sortDirection === "asc" ? "▲" : "▼")}
                                  </div>
                                </th>
                                <th 
                                  onClick={() => handleSort("qty")}
                                  className="py-3 px-4 cursor-pointer hover:bg-slate-100 hover:text-slate-700 transition-colors border-b border-slate-100"
                                >
                                  <div className="flex items-center gap-1">
                                    <span>Quantity</span>
                                    {sortField === "qty" && (sortDirection === "asc" ? "▲" : "▼")}
                                  </div>
                                </th>
                                <th
                                  onClick={() => handleSort("expiresOn")}
                                  className="py-3 px-4 cursor-pointer hover:bg-slate-100 hover:text-slate-700 transition-colors border-b border-slate-100"
                                >
                                  <div className="flex items-center gap-1">
                                    <span>Expires</span>
                                    {sortField === "expiresOn" && (sortDirection === "asc" ? "▲" : "▼")}
                                  </div>
                                </th>
                                <th className="py-3 px-4 border-b border-slate-100">Stock</th>
                                <th className="py-3 px-4 border-b border-slate-100">Hazard</th>
                                <th className="py-3 px-4 border-b border-slate-100">Concentration</th>
                                <th className="py-3 px-4 border-b border-slate-100">Volume / Mass</th>
                                <th 
                                  onClick={() => handleSort("location")}
                                  className="py-3 px-4 cursor-pointer hover:bg-slate-100 hover:text-slate-700 transition-colors border-b border-slate-100"
                                >
                                  <div className="flex items-center gap-1">
                                    <span>Location Context</span>
                                    {sortField === "location" && (sortDirection === "asc" ? "▲" : "▼")}
                                  </div>
                                </th>
                                <th className="py-3 px-4 border-b border-slate-100">Quick Assignment / Actions</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 text-xs text-slate-600">
                              {sortedShelfSamples.length === 0 ? (
                                <tr>
                                  <td colSpan={11} className="text-center py-10 text-slate-400 italic">
                                    No samples matching filters on this shelf.
                                  </td>
                                </tr>
                              ) : (
                                sortedShelfSamples.map(sample => {
                                  const isSelected = selectedSampleId === sample.id;
                                  const isLoose = !sample.boxId;
                                  return (
                                    <tr 
                                      key={sample.id} 
                                      onClick={() => setSelectedSampleId(sample.id)}
                                      onDoubleClick={() => handleOpenEditSampleModal(sample)}
                                      className={`hover:bg-slate-50/60 cursor-pointer transition-colors ${isSelected ? "bg-indigo-50/40" : ""}`}
                                    >
                                      <td className="py-3 px-4 font-bold text-slate-800">{sample.chemicalName}</td>
                                      <td className="py-3 px-4 font-mono text-slate-500">{sample.casNumber || "—"}</td>
                                      <td className="py-3 px-4">
                                        <span className="px-1.5 py-0.5 rounded text-[10px] font-extrabold uppercase bg-slate-100 text-slate-500">
                                          {sample.itemType || "Sample"}
                                        </span>
                                      </td>
                                      <td className="py-3 px-4 font-mono">{sample.qty} {sample.units}</td>
                                      <td className="py-3 px-4 text-[11px]">
                                        {sample.expiresOn ? (() => {
                                          const status = getExpiryStatus(sample);
                                          return (
                                            <span className={`px-1.5 py-0.5 rounded-full border text-[10px] font-bold ${getExpiryBadgeClass(status)}`}>
                                              {new Date(sample.expiresOn).toLocaleDateString()}
                                            </span>
                                          );
                                        })() : "—"}
                                      </td>
                                      <td className="py-3 px-4 text-[11px]">
                                        {isLowStock(sample) ? (
                                          <span className="px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700 border border-orange-200 text-[10px] font-bold">
                                            Low ({sample.qty}/{sample.minStockLevel})
                                          </span>
                                        ) : "—"}
                                      </td>
                                      <td className="py-3 px-4 text-[11px]">
                                        {sample.ghsHazardCodes && sample.ghsHazardCodes.length > 0 ? (
                                          <span className="px-1.5 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200 text-[10px] font-bold" title={sample.ghsHazardCodes.join(", ")}>
                                            {sample.ghsHazardCodes.length} GHS
                                          </span>
                                        ) : sample.storageClass ? (
                                          <span className="px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-200 text-[10px] font-bold capitalize">
                                            {sample.storageClass}
                                          </span>
                                        ) : "—"}
                                      </td>
                                      <td className="py-3 px-4 font-mono text-[11px]">{sample.concentration || "-"}</td>
                                      <td className="py-3 px-4 font-mono text-[11px]">{sample.volumeMass || "-"}</td>
                                      <td className="py-3 px-4 text-slate-500 font-medium text-[11px]">
                                        <div className="flex items-center gap-1">
                                          {isLoose ? (
                                            <span className="text-orange-650 bg-orange-50 border border-orange-100 px-1.5 py-0.5 rounded text-[10px] font-bold">
                                              Loose on Shelf
                                            </span>
                                          ) : (
                                            <span className="text-indigo-650 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded text-[10px] font-bold truncate max-w-xs">
                                              {getSampleLocationPath(sample)}
                                            </span>
                                          )}
                                        </div>
                                      </td>
                                      <td className="py-3 px-4" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                                        <div className="flex items-center gap-2">
                                          {isLoose ? (
                                            <select
                                              onChange={(e) => {
                                                const val = e.target.value;
                                                if (val) {
                                                  const [destType, destId] = val.split(":");
                                                  handleQuickAssignSample(sample.id, destType as "box" | "drawer", destId);
                                                }
                                              }}
                                              className="text-[11px] bg-slate-50 hover:bg-slate-100 border border-slate-200 hover:border-indigo-300 rounded px-2 py-1 text-slate-600 font-bold cursor-pointer transition-colors"
                                              defaultValue=""
                                            >
                                              <option value="" disabled>→ Quick Assign to Box/Drawer</option>
                                              {availableDestinationsOnShelf.map(dest => (
                                                <option key={dest.id} value={`${dest.type}:${dest.id}`}>
                                                  {dest.name}
                                                </option>
                                              ))}
                                            </select>
                                          ) : (
                                            <button
                                              onClick={() => {
                                                apiMutate(
                                                  `/api/samples/${sample.id}`,
                                                  "PATCH",
                                                  { rackId: null, drawerId: null, boxId: null, row: null, col: null },
                                                  "Sample Relocated",
                                                  `Removed "${sample.chemicalName}" from box/drawer to make it loose on shelf.`,
                                                  { ...state, samples: state.samples.map(s => s.id === sample.id ? { ...s, rackId: null, drawerId: null, boxId: null, row: null, col: null } : s) }
                                                );
                                              }}
                                              className="text-[10px] text-slate-400 hover:text-orange-600 font-bold border border-slate-200 hover:border-orange-200 bg-white hover:bg-orange-50 px-2 py-1 rounded transition-colors cursor-pointer"
                                            >
                                              Make Loose
                                            </button>
                                          )}
                                          
                                          <button
                                            onClick={() => {
                                              handleOpenEditSampleModal(sample);
                                            }}
                                            className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-indigo-600 cursor-pointer"
                                            title="Edit Details"
                                          >
                                            <Edit2 className="h-3.5 w-3.5" />
                                          </button>
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ) : (
                      /* GRID VIEW */
                      <>
                        {(() => {
                          const shelfRacks = state.racks.filter(r => r.shelfId === currentShelf.id && !r.isArchived);
                          const shelfDirectBoxes = state.boxes.filter(b => b.shelfId === currentShelf.id && !b.rackId && !b.drawerId && !b.isArchived);
                          const hasLoose = state.samples.some(
                            s => s.shelfId === currentShelf.id && !s.rackId && !s.drawerId && !s.boxId && !s.isArchived
                          );

                          return (
                            <>
                              {hasLoose && (
                                <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3 flex items-center justify-between shadow-3xs">
                                  <div className="flex items-center gap-2">
                                    <Layers className="h-4 w-4 text-amber-500 animate-pulse" />
                                    <div>
                                      <span className="text-xs font-bold text-slate-700">Physical Containers Grid is {structureMinimized ? "minimized" : "expanded"}</span>
                                      <span className="text-[10px] text-slate-500 block">
                                        Looking at loose items on shelf by default. Contains {shelfRacks.length} Racks and {shelfDirectBoxes.length} direct Boxes.
                                      </span>
                                    </div>
                                  </div>
                                  <button
                                    onClick={() => setStructureMinimized(!structureMinimized)}
                                    className="px-3 py-1 bg-white hover:bg-slate-50 border border-slate-200 text-xs font-bold text-indigo-600 rounded-lg shadow-3xs hover:shadow-2xs cursor-pointer transition-all"
                                  >
                                    {structureMinimized ? "Expand Containers Grid" : "Minimize Grid"}
                                  </button>
                                </div>
                              )}

                              {!structureMinimized ? (
                                <div className="space-y-6">
                                  {(() => {
                                    // If grid/column layout is defined for the shelf
                                    if (currentShelf.cols) {
                                      const colsCount = currentShelf.cols;
                        
                        // Group items by slot position (1-indexed)
                        const itemsBySlot: Record<number, { type: "rack" | "box"; item: any }[]> = {};
                        for (let i = 1; i <= colsCount; i++) {
                          itemsBySlot[i] = [];
                        }
                        
                        const unassignedItems: { type: "rack" | "box"; item: any }[] = [];
                        
                        shelfRacks.forEach(rack => {
                          if (rack.shelfCol && rack.shelfCol >= 1 && rack.shelfCol <= colsCount) {
                            itemsBySlot[rack.shelfCol].push({ type: "rack", item: rack });
                          } else {
                            unassignedItems.push({ type: "rack", item: rack });
                          }
                        });
                        
                        shelfDirectBoxes.forEach(box => {
                          if (box.shelfCol && box.shelfCol >= 1 && box.shelfCol <= colsCount) {
                            itemsBySlot[box.shelfCol].push({ type: "box", item: box });
                          } else {
                            unassignedItems.push({ type: "box", item: box });
                          }
                        });

                        return (
                          <div className="space-y-6 flex-1">
                            {/* Shelf Visual Grid */}
                            <div className="bg-slate-100 p-4 rounded-2xl border border-slate-200 shadow-inner">
                              <div className="text-center font-bold text-[10px] text-slate-400 uppercase tracking-widest mb-3 pb-2 border-b border-slate-200">
                                Physical Shelf Layout Grid ({colsCount} Slots Across)
                              </div>
                              <div 
                                className="grid gap-4 overflow-x-auto pb-2"
                                style={{
                                  gridTemplateColumns: `repeat(${colsCount}, minmax(150px, 1fr))`
                                }}
                              >
                                {Array.from({ length: colsCount }, (_, idx) => {
                                  const colNum = idx + 1;
                                  const slotItems = itemsBySlot[colNum] || [];
                                  
                                  return (
                                    <div key={colNum} className="flex flex-col gap-2 p-2.5 bg-white/50 border border-slate-200/60 rounded-xl min-h-[160px] relative">
                                      <div className="absolute top-1.5 right-2 text-[9px] font-bold text-slate-400 bg-slate-100/80 px-1.5 py-0.5 rounded-sm">
                                        Slot {colNum}
                                      </div>
                                      
                                      <div className="flex-1 flex flex-col gap-2 pt-6">
                                        {slotItems.length > 0 ? (
                                          slotItems.map(({ type, item }) => {
                                            if (type === "rack") {
                                              const samplesCount = getRackSamplesCount(item.id);
                                              const rackDrawersCount = state.drawers.filter(d => d.rackId === item.id && !d.isArchived).length;
                                              const rackBoxesCount = state.boxes.filter(b => b.rackId === item.id && !b.isArchived).length;
                                              return (
                                                <div 
                                                  key={item.id}
                                                  onClick={() => setSelectedRackId(item.id)}
                                                  className="group relative flex flex-col justify-between bg-white hover:bg-amber-50/10 border border-slate-200 hover:border-amber-400 rounded-lg p-2.5 shadow-3xs cursor-pointer min-h-[96px] overflow-hidden select-none"
                                                >
                                                  <div className="absolute top-0 left-0 bottom-0 w-1 bg-amber-500" />
                                                  <div className="flex justify-between items-start">
                                                    <h5 className="text-[11px] font-bold text-slate-800 group-hover:text-indigo-600 truncate max-w-[80%]" title={item.name}>
                                                      {item.name}
                                                    </h5>
                                                    <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                                      <button
                                                        onClick={(e) => {
                                                          e.stopPropagation();
                                                          setEditingStorageItem(item);
                                                          setStorageModalMode("rack");
                                                          setStorageModalOpen(true);
                                                        }}
                                                        className="p-0.5 hover:bg-slate-100 rounded text-slate-400 hover:text-indigo-600 cursor-pointer"
                                                      >
                                                        <Edit2 className="h-2.5 w-2.5" />
                                                      </button>
                                                    </div>
                                                  </div>
                                                  <p className="text-[9px] text-slate-400 mt-0.5 font-medium">
                                                    {rackDrawersCount} drawers • {rackBoxesCount} boxes
                                                  </p>
                                                  <div className="text-[9px] font-semibold text-slate-500 mt-2 flex justify-between items-center">
                                                    <span>{samplesCount} samples</span>
                                                    <ArrowRight className="h-2.5 w-2.5 text-indigo-500 opacity-0 group-hover:opacity-100 transition-all" />
                                                  </div>
                                                </div>
                                              );
                                            } else {
                                              const samplesCount = getBoxSamplesCount(item.id);
                                              return (
                                                <div 
                                                  key={item.id}
                                                  onClick={() => setSelectedBoxId(item.id)}
                                                  className="group relative flex flex-col justify-between bg-white hover:bg-blue-50/10 border border-slate-200 hover:border-blue-400 rounded-lg p-2.5 shadow-3xs cursor-pointer min-h-[96px] overflow-hidden select-none"
                                                >
                                                  <div className="absolute top-0 left-0 bottom-0 w-1 bg-blue-500" />
                                                  <div className="flex justify-between items-start">
                                                    <h5 className="text-[11px] font-bold text-slate-800 group-hover:text-indigo-600 truncate max-w-[80%]" title={item.name}>
                                                      {item.name}
                                                    </h5>
                                                    <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                                      <button
                                                        onClick={(e) => {
                                                          e.stopPropagation();
                                                          setEditingStorageItem(item);
                                                          setStorageModalMode("box");
                                                          setStorageModalOpen(true);
                                                        }}
                                                        className="p-0.5 hover:bg-slate-100 rounded text-slate-400 hover:text-indigo-600 cursor-pointer"
                                                      >
                                                        <Edit2 className="h-2.5 w-2.5" />
                                                      </button>
                                                    </div>
                                                  </div>
                                                  <p className="text-[9px] text-slate-400 mt-0.5">
                                                    {item.rows && item.cols ? `${item.rows}x${item.cols} grid` : "freebox"}
                                                  </p>
                                                  <div className="text-[9px] font-semibold text-slate-500 mt-2 flex justify-between items-center">
                                                    <span>{samplesCount} samples</span>
                                                    <ArrowRight className="h-2.5 w-2.5 text-indigo-500 opacity-0 group-hover:opacity-100 transition-all" />
                                                  </div>
                                                </div>
                                              );
                                            }
                                          })
                                        ) : (
                                          <div className="flex-1 flex flex-col items-center justify-center p-2 text-center">
                                            <div className="text-[9px] text-slate-400 font-medium italic mb-2">Empty Slot</div>
                                            <div className="flex gap-1">
                                              <button
                                                onClick={() => {
                                                  setEditingStorageItem(null);
                                                  setStorageModalMode("rack");
                                                  setStorageModalOpen(true);
                                                }}
                                                className="px-1.5 py-0.5 bg-indigo-50 hover:bg-indigo-100 text-[9px] font-bold text-indigo-600 rounded-sm border border-indigo-100 transition-all cursor-pointer"
                                              >
                                                + Rack
                                              </button>
                                              <button
                                                onClick={() => {
                                                  setEditingStorageItem(null);
                                                  setStorageModalMode("box");
                                                  setStorageModalOpen(true);
                                                }}
                                                className="px-1.5 py-0.5 bg-blue-50 hover:bg-blue-100 text-[9px] font-bold text-blue-600 rounded-sm border border-blue-100 transition-all cursor-pointer"
                                              >
                                                + Box
                                              </button>
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>

                            {/* Unassigned Items Section */}
                            {unassignedItems.length > 0 && (
                              <div className="space-y-3 pt-4 border-t border-slate-200">
                                <div className="flex items-center justify-between">
                                  <h5 className="text-xs font-extrabold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                                    <span>Unassigned items on shelf ({unassignedItems.length})</span>
                                    <span className="text-[9px] font-semibold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full lowercase">
                                      edit them to assign to a shelf slot
                                    </span>
                                  </h5>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                                  {unassignedItems.map(({ type, item }) => {
                                    if (type === "rack") {
                                      const samplesCount = getRackSamplesCount(item.id);
                                      const rackDrawersCount = state.drawers.filter(d => d.rackId === item.id && !d.isArchived).length;
                                      const rackBoxesCount = state.boxes.filter(b => b.rackId === item.id && !b.isArchived).length;
                                      return (
                                        <div 
                                          key={item.id}
                                          onClick={() => setSelectedRackId(item.id)}
                                          className="group relative flex flex-col justify-between bg-white hover:bg-indigo-50/10 border border-slate-200 hover:border-indigo-300 rounded-xl p-4 shadow-3xs hover:shadow-xs transition-all duration-200 cursor-pointer h-32 overflow-hidden"
                                        >
                                          <div className="absolute top-0 left-0 bottom-0 w-1 bg-amber-500" />
                                          <div>
                                            <div className="flex justify-between items-start mb-1">
                                              <div className="flex items-center gap-1.5 max-w-[85%]">
                                                <Layers className="h-4 w-4 shrink-0 text-amber-500" />
                                                <h4 className="text-xs font-bold text-slate-800 group-hover:text-indigo-600 transition-colors truncate" title={item.name}>
                                                  {item.name}
                                                </h4>
                                              </div>
                                              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    setEditingStorageItem(item);
                                                    setStorageModalMode("rack");
                                                    setStorageModalOpen(true);
                                                  }}
                                                  className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-indigo-600 cursor-pointer"
                                                >
                                                  <Edit2 className="h-3 w-3" />
                                                </button>
                                                <button
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleArchiveRack(item.id, item.name);
                                                  }}
                                                  className="p-1 hover:bg-red-50 rounded text-slate-400 hover:text-red-600 cursor-pointer"
                                                >
                                                  <Trash2 className="h-3 w-3" />
                                                </button>
                                              </div>
                                            </div>
                                            <p className="text-[10px] text-slate-400">
                                              Contains {rackDrawersCount} drawers • {rackBoxesCount} boxes
                                            </p>
                                          </div>
                                          <div className="flex items-center justify-between text-[10px] font-semibold text-slate-500 mt-2">
                                            <span>{samplesCount} {samplesCount === 1 ? "sample" : "samples"}</span>
                                            <span className="text-indigo-500 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all font-bold">
                                              Open Rack <ArrowRight className="h-3 w-3" />
                                            </span>
                                          </div>
                                        </div>
                                      );
                                    } else {
                                      const samplesCount = getBoxSamplesCount(item.id);
                                      return (
                                        <div 
                                          key={item.id}
                                          onClick={() => setSelectedBoxId(item.id)}
                                          className="group relative flex flex-col justify-between bg-white hover:bg-indigo-50/10 border border-slate-200 hover:border-indigo-300 rounded-xl p-4 shadow-3xs hover:shadow-xs transition-all duration-200 cursor-pointer h-32 overflow-hidden"
                                        >
                                          <div className="absolute top-0 left-0 bottom-0 w-1 bg-blue-500" />
                                          <div>
                                            <div className="flex justify-between items-start mb-1">
                                              <div className="flex items-center gap-1.5 max-w-[85%]">
                                                <BoxIcon className="h-4 w-4 shrink-0 text-blue-500" />
                                                <h4 className="text-xs font-bold text-slate-800 group-hover:text-indigo-600 transition-colors truncate" title={item.name}>
                                                  {item.name}
                                                </h4>
                                              </div>
                                              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    setEditingStorageItem(item);
                                                    setStorageModalMode("box");
                                                    setStorageModalOpen(true);
                                                  }}
                                                  className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-indigo-600 cursor-pointer"
                                                >
                                                  <Edit2 className="h-3 w-3" />
                                                </button>
                                                <button
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleArchiveBox(item.id, item.name);
                                                  }}
                                                  className="p-1 hover:bg-red-50 rounded text-slate-400 hover:text-red-600 cursor-pointer"
                                                >
                                                  <Trash2 className="h-3 w-3" />
                                                </button>
                                              </div>
                                            </div>
                                            <p className="text-[10px] text-slate-400">
                                              {item.rows && item.cols ? `Grid Coordinate layout (${item.rows}x${item.cols})` : "Free-form layout"}
                                            </p>
                                          </div>
                                          <div className="flex items-center justify-between text-[10px] font-semibold text-slate-500 mt-2">
                                            <span>{samplesCount} {samplesCount === 1 ? "sample" : "samples"}</span>
                                            <span className="text-indigo-500 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all font-bold">
                                              Open Box <ArrowRight className="h-3 w-3" />
                                            </span>
                                          </div>
                                        </div>
                                      );
                                    }
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      }

                      // Backwards compatible fallback (free-form layout)
                      return (
                        <>
                          {/* Racks */}
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <h4 className="text-xs font-extrabold text-slate-400 uppercase tracking-wider">
                                Racks on this Shelf ({shelfRacks.length})
                              </h4>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                              {shelfRacks.map(rack => {
                                const samplesCount = getRackSamplesCount(rack.id);
                                const rackDrawersCount = state.drawers.filter(d => d.rackId === rack.id && !d.isArchived).length;
                                const rackBoxesCount = state.boxes.filter(b => b.rackId === rack.id && !b.isArchived).length;
                                const isRackDragOver = dragOverRackId === rack.id;
                                return (
                                  <div 
                                    key={rack.id}
                                    onClick={() => setSelectedRackId(rack.id)}
                                    draggable={true}
                                    onDragStart={(e) => {
                                      e.dataTransfer.setData("text/plain", JSON.stringify({ type: "rack", id: rack.id }));
                                    }}
                                    onDragOver={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      setDragOverRackId(rack.id);
                                    }}
                                    onDragLeave={() => setDragOverRackId(null)}
                                    onDrop={(e) => {
                                      setDragOverRackId(null);
                                      handleDropMove(e, "rack", rack.id);
                                    }}
                                    className={`group relative flex flex-col justify-between bg-white hover:bg-indigo-50/10 border rounded-xl p-4 shadow-3xs hover:shadow-xs transition-all duration-200 cursor-pointer h-32 overflow-hidden ${
                                      isRackDragOver
                                        ? "bg-emerald-50 border-dashed border-2 border-emerald-500 scale-[1.02]"
                                        : "border-slate-200 hover:border-indigo-300"
                                    }`}
                                  >
                                    <div className="absolute top-0 left-0 bottom-0 w-1 bg-amber-500" />
                                    <div>
                                      <div className="flex justify-between items-start mb-1">
                                        <div className="flex items-center gap-1.5 max-w-[85%]">
                                          <Layers className="h-4 w-4 shrink-0 text-amber-500" />
                                          <h4 className="text-xs font-bold text-slate-800 group-hover:text-indigo-600 transition-colors truncate" title={rack.name}>
                                            {rack.name}
                                          </h4>
                                        </div>
                                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setEditingStorageItem(rack);
                                              setStorageModalMode("rack");
                                              setStorageModalOpen(true);
                                            }}
                                            className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-indigo-600 cursor-pointer"
                                          >
                                            <Edit2 className="h-3 w-3" />
                                          </button>
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleArchiveRack(rack.id, rack.name);
                                            }}
                                            className="p-1 hover:bg-red-50 rounded text-slate-400 hover:text-red-600 cursor-pointer"
                                          >
                                            <Trash2 className="h-3 w-3" />
                                          </button>
                                        </div>
                                      </div>
                                      <p className="text-[10px] text-slate-400">
                                        Contains {rackDrawersCount} drawers • {rackBoxesCount} boxes
                                      </p>
                                    </div>
                                    <div className="flex items-center justify-between text-[10px] font-semibold text-slate-500 mt-2">
                                      <span className="flex items-center gap-1">
                                        <Database className="h-3.5 w-3.5 text-slate-400" />
                                        <span>{samplesCount} {samplesCount === 1 ? "sample" : "samples"}</span>
                                      </span>
                                      <span className="text-indigo-500 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all font-bold">
                                        Open Rack <ArrowRight className="h-3 w-3" />
                                      </span>
                                    </div>
                                  </div>
                                );
                              })}
                              <div
                                onClick={() => {
                                  setEditingStorageItem(null);
                                  setStorageModalMode("rack");
                                  setStorageModalOpen(true);
                                }}
                                className="flex flex-col items-center justify-center border-2 border-dashed border-slate-200 hover:border-indigo-400 bg-slate-50/40 hover:bg-indigo-50/5 rounded-xl p-4 h-32 transition-all duration-200 cursor-pointer text-slate-400 hover:text-indigo-600 text-center group"
                              >
                                <Plus className="h-5 w-5 mb-1.5 text-slate-300 group-hover:text-indigo-500 group-hover:scale-110 transition-transform" />
                                <span className="text-[10px] font-bold uppercase tracking-wider">Add Rack</span>
                              </div>
                            </div>
                          </div>

                          {/* Direct Boxes on Shelf */}
                          <div className="space-y-3 pt-4 border-t border-slate-100">
                            <div className="flex items-center justify-between">
                              <h4 className="text-xs font-extrabold text-slate-400 uppercase tracking-wider">
                                Direct Boxes on this Shelf ({shelfDirectBoxes.length})
                              </h4>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                              {shelfDirectBoxes.map(box => {
                                const samplesCount = getBoxSamplesCount(box.id);
                                return (
                                  <div 
                                    key={box.id}
                                    onClick={() => setSelectedBoxId(box.id)}
                                    draggable={true}
                                    onDragStart={(e) => {
                                      e.dataTransfer.setData("text/plain", JSON.stringify({ type: "box", id: box.id }));
                                    }}
                                    className="group relative flex flex-col justify-between bg-white hover:bg-indigo-50/10 border border-slate-200 hover:border-indigo-300 rounded-xl p-4 shadow-3xs hover:shadow-xs transition-all duration-200 cursor-pointer h-32 overflow-hidden"
                                  >
                                    <div className="absolute top-0 left-0 bottom-0 w-1 bg-blue-500" />
                                    <div>
                                      <div className="flex justify-between items-start mb-1">
                                        <div className="flex items-center gap-1.5 max-w-[85%]">
                                          <BoxIcon className="h-4 w-4 shrink-0 text-blue-500" />
                                          <h4 className="text-xs font-bold text-slate-800 group-hover:text-indigo-600 transition-colors truncate" title={box.name}>
                                            {box.name}
                                          </h4>
                                        </div>
                                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setEditingStorageItem(box);
                                              setStorageModalMode("box");
                                              setStorageModalOpen(true);
                                            }}
                                            className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-indigo-600 cursor-pointer"
                                          >
                                            <Edit2 className="h-3 w-3" />
                                          </button>
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleArchiveBox(box.id, box.name);
                                            }}
                                            className="p-1 hover:bg-red-50 rounded text-slate-400 hover:text-red-600 cursor-pointer"
                                          >
                                            <Trash2 className="h-3 w-3" />
                                          </button>
                                        </div>
                                      </div>
                                      <p className="text-[10px] text-slate-400">
                                        {box.rows && box.cols ? `Grid Coordinate layout (${box.rows}x${box.cols})` : "Free-form layout"}
                                      </p>
                                    </div>
                                    <div className="flex items-center justify-between text-[10px] font-semibold text-slate-500 mt-2">
                                      <span className="flex items-center gap-1">
                                        <Database className="h-3.5 w-3.5 text-slate-400" />
                                        <span>{samplesCount} {samplesCount === 1 ? "sample" : "samples"}</span>
                                      </span>
                                      <span className="text-indigo-500 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all font-bold">
                                        Open Box <ArrowRight className="h-3 w-3" />
                                      </span>
                                    </div>
                                  </div>
                                );
                              })}
                              <div
                                onClick={() => {
                                  setEditingStorageItem(null);
                                  setStorageModalMode("box");
                                  setStorageModalOpen(true);
                                }}
                                className="flex flex-col items-center justify-center border-2 border-dashed border-slate-200 hover:border-indigo-400 bg-slate-50/40 hover:bg-indigo-50/5 rounded-xl p-4 h-32 transition-all duration-200 cursor-pointer text-slate-400 hover:text-indigo-600 text-center group"
                              >
                                <Plus className="h-5 w-5 mb-1.5 text-slate-300 group-hover:text-indigo-500 group-hover:scale-110 transition-transform" />
                                <span className="text-[10px] font-bold uppercase tracking-wider">Add Direct Box</span>
                              </div>
                            </div>
                          </div>
                        </>
                      );
                    })()}
                                </div>
                              ) : null}

                              {/* Loose / Direct Stored Items on Shelf */}
                              {(() => {
                                const shelfDirectSamples = state.samples.filter(
                                  s => s.shelfId === currentShelf.id && !s.rackId && !s.drawerId && !s.boxId && !s.isArchived
                                ).sort((a, b) => {
                                  const nameOrder = (a.chemicalName || "").localeCompare(
                                    b.chemicalName || "",
                                    undefined,
                                    { sensitivity: "base", numeric: true }
                                  );
                                  if (nameOrder !== 0) return nameOrder;
                                  return (a.casNumber || "").localeCompare(b.casNumber || "", undefined, {
                                    sensitivity: "base",
                                    numeric: true
                                  });
                                });
                                if (shelfDirectSamples.length === 0) return null;
                                return (
                                  <div className="space-y-3 pt-4 border-t border-slate-200 shrink-0">
                                    <div className="flex items-center justify-between">
                                      <h4 className="text-xs font-extrabold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                                        <Database className="h-3.5 w-3.5 text-indigo-500 animate-pulse" />
                                        Direct / Loose Items on this Shelf ({shelfDirectSamples.length})
                                      </h4>
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 max-h-56 overflow-y-auto pb-2">
                                      {shelfDirectSamples.map(sample => {
                                        const isSelected = selectedSampleId === sample.id;
                                        return (
                                          <div
                                            key={sample.id}
                                            onClick={() => setSelectedSampleId(sample.id)}
                                            onDoubleClick={() => handleOpenEditSampleModal(sample)}
                                            className={`p-3 rounded-xl border cursor-pointer transition-all flex flex-col justify-between ${
                                              isSelected 
                                                ? "bg-indigo-600 text-white border-indigo-700 shadow-md scale-[0.99]" 
                                                : "bg-white border-slate-200/70 hover:border-indigo-200 hover:bg-slate-50/50 text-slate-700"
                                            }`}
                                          >
                                            <div>
                                              <div className="flex justify-between items-start">
                                                <h5 className="font-bold text-xs truncate max-w-[80%]">{sample.chemicalName}</h5>
                                                <span className={`text-[9px] uppercase px-1.5 py-0.5 rounded font-extrabold tracking-wider ${isSelected ? "bg-indigo-700/80 text-white" : "bg-slate-100 text-slate-500"}`}>
                                                  {sample.itemType || "Sample"}
                                                </span>
                                              </div>
                                              <p className={`text-[10px] font-mono mt-1 ${isSelected ? "text-indigo-200" : "text-slate-400"}`}>
                                                {sample.casNumber && `CAS: ${sample.casNumber} • `}Qty: {sample.qty} {sample.units}
                                              </p>
                                              <p className={`text-[10px] font-mono mt-1 ${isSelected ? "text-indigo-200" : "text-slate-400"}`}>
                                                {getSampleConcentrationLabel(sample)} • {getSampleVolumeLabel(sample)}
                                              </p>
                                            </div>
                                            {sample.notes && (
                                              <p className={`text-[10px] mt-2 line-clamp-1 italic ${isSelected ? "text-indigo-100" : "text-slate-400"}`}>
                                                "{sample.notes}"
                                              </p>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                );
                              })()}
                            </>
                          );
                        })()}
                      </>
                    )}
                  </div>
                ) : currentStorage ? (
                  /* 5. Storage Unit Level - Shows Shelves inside this Storage Unit */
                  <div className="space-y-4 flex-1 flex flex-col">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="text-xs font-extrabold text-slate-400 uppercase tracking-wider">
                          Storage Profile: {currentStorage.name}
                        </h4>
                        <p className="text-[10px] text-slate-500 font-medium mt-0.5">
                          Interactive Physical Profile. Racks and Boxes can be dragged and repositioned directly between levels.
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            setEditingStorageItem(null);
                            setStorageModalMode("shelf");
                            setStorageModalOpen(true);
                          }}
                          className="px-2.5 py-1 text-xs font-bold bg-indigo-50 hover:bg-indigo-100 text-indigo-600 border border-indigo-200 rounded-lg flex items-center gap-1 cursor-pointer transition-colors"
                        >
                          <Plus className="h-3 w-3" /> Add Shelf Level
                        </button>
                      </div>
                    </div>
                    {(() => {
                      // Sort shelves descending so Shelf 1 / Level 1 sits visually at the bottom, mimicking a real upright freezer/fridge stack!
                      const storageShelves = state.shelves
                        .filter(s => s.storageId === currentStorage.id && !s.isArchived)
                        .sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: "base" }));

                      if (storageShelves.length === 0) {
                        return (
                          <div className="text-center py-16 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                            <Layers className="h-10 w-10 text-slate-300 mx-auto mb-2" />
                            <p className="text-xs text-slate-500">No shelf levels defined in this storage unit.</p>
                            <button
                              onClick={() => {
                                setEditingStorageItem(null);
                                setStorageModalMode("shelf");
                                setStorageModalOpen(true);
                              }}
                              className="mt-2 text-xs font-bold text-indigo-600 hover:underline cursor-pointer"
                            >
                              + Add First Shelf
                            </button>
                          </div>
                        );
                      }

                      return (
                        <div className="border-4 border-slate-300 rounded-2xl bg-slate-100 p-4 shadow-inner flex flex-col gap-6 max-w-5xl mx-auto w-full flex-1 overflow-y-auto min-h-[400px]">
                          {storageShelves.map(shelf => {
                            const shelfRacks = state.racks.filter(r => r.shelfId === shelf.id && !r.isArchived);
                            const shelfDirectBoxes = state.boxes.filter(b => b.shelfId === shelf.id && !b.rackId && !b.drawerId && !b.isArchived);
                            
                            const samplesCount = getShelfSamplesCount(shelf.id);
                            const hasGrid = !!shelf.cols;
                            const totalCols = shelf.cols || 6;

                            return (
                              <div
                                key={shelf.id}
                                className="relative bg-white border border-slate-200/80 shadow-xs hover:shadow-sm rounded-xl p-4 flex flex-col gap-3 min-h-[160px] group transition-all"
                              >
                                {/* Left/Top color indicator of Shelf Level */}
                                <div className="absolute top-0 bottom-0 left-0 w-1.5 bg-indigo-500 rounded-l-xl" />
                                
                                {/* Shelf header/meta bar */}
                                <div className="flex justify-between items-center z-10 border-b border-slate-100 pb-1.5">
                                  <div className="flex items-center gap-2">
                                    <span 
                                      className="text-xs font-black text-slate-800 uppercase tracking-wide flex items-center gap-1.5 hover:text-indigo-600 cursor-pointer"
                                      onClick={() => setSelectedShelfId(shelf.id)}
                                    >
                                      <Layers className="h-3.5 w-3.5 text-indigo-500" />
                                      {shelf.name}
                                    </span>
                                    <span className="text-[9px] bg-slate-100 text-slate-500 font-extrabold px-1.5 py-0.5 rounded-full uppercase tracking-wider">
                                      {hasGrid ? `${totalCols} Rack Slots Across` : "Free-Form Layout"} • {samplesCount} {samplesCount === 1 ? "sample" : "samples"}
                                    </span>
                                  </div>
                                  <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setEditingStorageItem(shelf);
                                        setStorageModalMode("shelf");
                                        setStorageModalOpen(true);
                                      }}
                                      className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-indigo-600 cursor-pointer"
                                      title="Edit Shelf"
                                    >
                                      <Edit2 className="h-3 w-3" />
                                    </button>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleArchiveShelf(shelf.id, shelf.name);
                                      }}
                                      className="p-1 hover:bg-red-50 rounded text-slate-400 hover:text-red-600 cursor-pointer"
                                      title="Delete Shelf"
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </button>
                                  </div>
                                </div>

                                {/* Shelf physical slots or free-form space */}
                                {hasGrid ? (
                                  <div 
                                    className="grid gap-3 flex-1 items-stretch"
                                    style={{
                                      gridTemplateColumns: `repeat(${totalCols}, minmax(120px, 1fr))`
                                    }}
                                  >
                                    {Array.from({ length: totalCols }).map((_, cIdx) => {
                                      const colNum = cIdx + 1;
                                      
                                      // Find rack in this column slot
                                      const slotRack = shelfRacks.find(r => r.shelfCol === colNum);
                                      // Find direct box in this column slot
                                      const slotBox = shelfDirectBoxes.find(b => b.shelfCol === colNum);
                                      const isSlotDragOver = dragOverShelfId === `${shelf.id}-${colNum}`;

                                      return (
                                        <div
                                          key={colNum}
                                          onDragOver={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            setDragOverShelfId(`${shelf.id}-${colNum}`);
                                          }}
                                          onDragLeave={() => setDragOverShelfId(null)}
                                          onDrop={(e) => {
                                            setDragOverShelfId(null);
                                            handleDropMove(e, "shelf", shelf.id, colNum);
                                          }}
                                          className={`rounded-lg p-2.5 flex flex-col justify-between transition-all select-none border min-h-[110px] ${
                                            slotRack || slotBox
                                              ? "bg-slate-50/50 border-slate-200"
                                              : isSlotDragOver
                                              ? "bg-emerald-50 border-dashed border-2 border-emerald-500 scale-[1.02] animate-pulse"
                                              : "border-dashed border border-slate-200 bg-slate-50/20 hover:bg-slate-50/50 hover:border-indigo-300"
                                          }`}
                                        >
                                          {slotRack ? (
                                            <div
                                              draggable={true}
                                              onDragStart={(e) => {
                                                e.dataTransfer.setData("text/plain", JSON.stringify({ type: "rack", id: slotRack.id }));
                                              }}
                                              onClick={() => setSelectedRackId(slotRack.id)}
                                              className="flex flex-col justify-between flex-1 cursor-pointer group/item text-left"
                                            >
                                              <div>
                                                <div className="flex items-center justify-between">
                                                  <span className="text-[10px] font-extrabold text-amber-600 flex items-center gap-0.5 truncate max-w-[85%]" title={slotRack.name}>
                                                    <Layers className="h-3 w-3 shrink-0" />
                                                    {slotRack.name}
                                                  </span>
                                                  <span className="text-[8px] font-bold text-slate-400 bg-slate-100 px-1 rounded">
                                                    S{colNum}
                                                  </span>
                                                </div>
                                                
                                                {/* Mini Drawers Vertical Representation */}
                                                <div className="mt-1.5 space-y-0.5 max-h-12 overflow-hidden border border-amber-200 rounded p-1 bg-amber-50/30 flex flex-col justify-start">
                                                  {(() => {
                                                    const drawersInRack = state.drawers.filter(d => d.rackId === slotRack.id && !d.isArchived);
                                                    if (drawersInRack.length === 0) {
                                                      return <span className="text-[8px] text-slate-400 block italic">Empty Frame</span>;
                                                    }
                                                    return drawersInRack.slice(0, 3).map(dr => (
                                                      <div key={dr.id} className="h-2 bg-white border border-slate-200 rounded-sm flex items-center justify-center shrink-0">
                                                        <div className="w-2.5 h-0.5 bg-slate-300 rounded-[1px]" />
                                                      </div>
                                                    ));
                                                  })()}
                                                </div>
                                              </div>

                                              <div className="flex items-center justify-between text-[8px] font-bold text-slate-400 mt-2">
                                                <span>{getRackSamplesCount(slotRack.id)} samples</span>
                                                <span className="text-indigo-500 opacity-0 group-hover/item:opacity-100 transition-opacity">Open</span>
                                              </div>
                                            </div>
                                          ) : slotBox ? (
                                            <div
                                              draggable={true}
                                              onDragStart={(e) => {
                                                e.dataTransfer.setData("text/plain", JSON.stringify({ type: "box", id: slotBox.id }));
                                              }}
                                              onClick={() => setSelectedBoxId(slotBox.id)}
                                              className="flex flex-col justify-between flex-1 cursor-pointer group/item text-left"
                                            >
                                              <div>
                                                <div className="flex items-center justify-between">
                                                  <span className="text-[10px] font-extrabold text-blue-600 flex items-center gap-0.5 truncate max-w-[85%]" title={slotBox.name}>
                                                    <BoxIcon className="h-3 w-3 shrink-0" />
                                                    {slotBox.name}
                                                  </span>
                                                  <span className="text-[8px] font-bold text-slate-400 bg-slate-100 px-1 rounded">
                                                    S{colNum}
                                                  </span>
                                                </div>
                                                <p className="text-[8px] text-slate-400 mt-1">
                                                  {slotBox.rows ? `${slotBox.rows}x${slotBox.cols} Box Grid` : "Free-form box"}
                                                </p>
                                              </div>
                                              <div className="flex items-center justify-between text-[8px] font-bold text-slate-400 mt-2">
                                                <span>{getBoxSamplesCount(slotBox.id)} samples</span>
                                                <span className="text-indigo-500 opacity-0 group-hover/item:opacity-100 transition-opacity">Open</span>
                                              </div>
                                            </div>
                                          ) : (
                                            <div className="flex-1 flex flex-col items-center justify-center text-center py-2 h-full">
                                              <span className="text-[8px] font-extrabold text-slate-400 uppercase tracking-widest block">Slot {colNum}</span>
                                              <span className="text-[7px] text-slate-400 italic block mt-1">Drag Racks/Boxes Here</span>
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <div
                                    onDragOver={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      setDragOverShelfId(shelf.id);
                                    }}
                                    onDragLeave={() => setDragOverShelfId(null)}
                                    onDrop={(e) => {
                                      setDragOverShelfId(null);
                                      handleDropMove(e, "shelf", shelf.id, null);
                                    }}
                                    className={`flex flex-wrap gap-4 items-stretch p-3 rounded-lg flex-1 border transition-all ${
                                      dragOverShelfId === shelf.id
                                        ? "bg-emerald-50 border-dashed border-2 border-emerald-500 animate-pulse"
                                        : "bg-slate-50/20 border-slate-100"
                                    }`}
                                  >
                                    {shelfRacks.length === 0 && shelfDirectBoxes.length === 0 ? (
                                      <div className="flex-1 flex flex-col items-center justify-center text-center py-4">
                                        <p className="text-[10px] text-slate-400 italic">This shelf is currently empty.</p>
                                        <p className="text-[9px] text-slate-400/80">Drag active racks or boxes onto this compartment to store them.</p>
                                      </div>
                                    ) : (
                                      <>
                                        {shelfRacks.map(rack => (
                                          <div
                                            key={rack.id}
                                            draggable={true}
                                            onDragStart={(e) => {
                                              e.dataTransfer.setData("text/plain", JSON.stringify({ type: "rack", id: rack.id }));
                                            }}
                                            onClick={() => setSelectedRackId(rack.id)}
                                            className="group/item relative flex flex-col justify-between bg-white hover:bg-amber-50/10 border border-slate-200 hover:border-amber-400 rounded-lg p-3 cursor-pointer w-36 shadow-3xs hover:shadow-2xs transition-all text-left"
                                          >
                                            <div>
                                              <span className="text-[10px] font-extrabold text-amber-600 flex items-center gap-1">
                                                <Layers className="h-3 w-3 text-amber-500" />
                                                {rack.name}
                                              </span>
                                              <p className="text-[8px] text-slate-400 mt-1">
                                                Contains {state.drawers.filter(d => d.rackId === rack.id && !d.isArchived).length} drawers
                                              </p>
                                            </div>
                                            <div className="flex items-center justify-between text-[8px] font-bold text-slate-400 mt-2.5">
                                              <span>{getRackSamplesCount(rack.id)} samples</span>
                                              <span className="text-indigo-500 opacity-0 group-hover/item:opacity-100 transition-opacity font-bold">Open</span>
                                            </div>
                                          </div>
                                        ))}

                                        {shelfDirectBoxes.map(box => (
                                          <div
                                            key={box.id}
                                            draggable={true}
                                            onDragStart={(e) => {
                                              e.dataTransfer.setData("text/plain", JSON.stringify({ type: "box", id: box.id }));
                                            }}
                                            onClick={() => setSelectedBoxId(box.id)}
                                            className="group/item relative flex flex-col justify-between bg-white hover:bg-blue-50/10 border border-slate-200 hover:border-blue-400 rounded-lg p-3 cursor-pointer w-36 shadow-3xs hover:shadow-2xs transition-all text-left"
                                          >
                                            <div>
                                              <span className="text-[10px] font-extrabold text-blue-600 flex items-center gap-1">
                                                <BoxIcon className="h-3 w-3 text-blue-500" />
                                                {box.name}
                                              </span>
                                              <p className="text-[8px] text-slate-400 mt-1">
                                                {box.rows ? `${box.rows}x${box.cols} Grid` : "Free-form box"}
                                              </p>
                                            </div>
                                            <div className="flex items-center justify-between text-[8px] font-bold text-slate-400 mt-2.5">
                                              <span>{getBoxSamplesCount(box.id)} samples</span>
                                              <span className="text-indigo-500 opacity-0 group-hover/item:opacity-100 transition-opacity font-bold">Open</span>
                                            </div>
                                          </div>
                                        ))}
                                      </>
                                    )}
                                  </div>
                                )}

                                {/* Bottom styled freezer shelf metal grille line representation */}
                                <div className="absolute left-0 right-0 bottom-0 h-1.5 bg-slate-300 rounded-b-xl opacity-80" />
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}

                    {/* Loose / Direct Stored Items in Storage Unit */}
                    {(() => {
                      const storageDirectSamples = state.samples.filter(
                        s => s.storageId === currentStorage.id && !s.boxId && !s.isArchived
                      );
                      if (storageDirectSamples.length === 0) return null;
                      return (
                        <div className="space-y-3 pt-4 border-t border-slate-200 shrink-0">
                          <div className="flex items-center justify-between">
                            <h4 className="text-xs font-extrabold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                              <Database className="h-3.5 w-3.5 text-indigo-500" />
                              Direct / Loose Items in this Storage Unit ({storageDirectSamples.length})
                            </h4>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 max-h-56 overflow-y-auto pb-2">
                            {storageDirectSamples.map(sample => {
                              const isSelected = selectedSampleId === sample.id;
                              const sampleShelf = state.shelves.find(sh => sh.id === sample.shelfId);
                              return (
                                <div
                                  key={sample.id}
                                  onClick={() => setSelectedSampleId(sample.id)}
                                  onDoubleClick={() => handleOpenEditSampleModal(sample)}
                                  className={`p-3 rounded-xl border cursor-pointer transition-all flex flex-col justify-between ${
                                    isSelected 
                                      ? "bg-indigo-600 text-white border-indigo-700 shadow-md scale-[0.99]" 
                                      : "bg-white border-slate-200/70 hover:border-indigo-200 hover:bg-slate-50/50 text-slate-700"
                                  }`}
                                >
                                  <div>
                                    <div className="flex justify-between items-start">
                                      <h5 className="font-bold text-xs truncate max-w-[80%]">{sample.chemicalName}</h5>
                                      <span className={`text-[9px] uppercase px-1.5 py-0.5 rounded font-extrabold tracking-wider ${isSelected ? "bg-indigo-700/80 text-white" : "bg-slate-100 text-slate-500"}`}>
                                        {sample.itemType || "Sample"}
                                      </span>
                                    </div>
                                    <p className={`text-[10px] font-mono mt-1 ${isSelected ? "text-indigo-200" : "text-slate-400"}`}>
                                      {sample.casNumber && `CAS: ${sample.casNumber} • `}Qty: {sample.qty} {sample.units}
                                    </p>
                                    <p className={`text-[10px] font-mono mt-1 ${isSelected ? "text-indigo-200" : "text-slate-400"}`}>
                                      {getSampleConcentrationLabel(sample)} • {getSampleVolumeLabel(sample)}
                                    </p>
                                    {sampleShelf && (
                                      <p className={`text-[10px] font-medium mt-1.5 flex items-center gap-1 ${isSelected ? "text-indigo-200" : "text-slate-500"}`}>
                                        <MapPin className="h-3 w-3 shrink-0" />
                                        <span>Shelf: {sampleShelf.name}</span>
                                      </p>
                                    )}
                                  </div>
                                  {sample.notes && (
                                    <p className={`text-[10px] mt-2 line-clamp-1 italic ${isSelected ? "text-indigo-100" : "text-slate-400"}`}>
                                      "{sample.notes}"
                                    </p>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                ) : (
                  /* 6. Root/Lab Level - Shows all active Storage Units */
                  <div className="space-y-4 flex-1 flex flex-col">
                    <DashboardPanels
                      samples={state.samples}
                      onSelectSample={(sampleId) => {
                        const s = state.samples.find(s => s.id === sampleId);
                        if (s) {
                          setSelectedStorageId(s.storageId);
                          setSelectedShelfId(s.shelfId);
                          setSelectedRackId(s.rackId || "");
                          setSelectedDrawerId(s.drawerId || "");
                          setSelectedBoxId(s.boxId);
                          setSelectedSampleId(s.id);
                        }
                      }}
                    />
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-extrabold text-slate-400 uppercase tracking-wider">
                        Storage Units ({sortedActiveStorageUnits.length})
                      </h4>
                    </div>
                    {(() => {
                      const activeUnits = sortedActiveStorageUnits;
                      return (
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 overflow-y-auto pb-4 flex-1">
                          {activeUnits.map(unit => {
                            const samplesCount = getStorageSamplesCount(unit.id);
                            const shelvesCount = state.shelves.filter(s => s.storageId === unit.id && !s.isArchived).length;
                            return (
                              <div 
                                key={unit.id}
                                onClick={() => setSelectedStorageId(unit.id)}
                                className="group relative flex flex-col justify-between bg-white hover:bg-indigo-50/10 border border-slate-200 hover:border-indigo-300 rounded-xl p-4 shadow-3xs hover:shadow-xs transition-all duration-200 cursor-pointer h-32 overflow-hidden"
                              >
                                <div className="absolute top-0 left-0 bottom-0 w-1 bg-violet-500" />
                                <div>
                                  <div className="flex justify-between items-start mb-1">
                                    <div className="flex items-center gap-1.5 max-w-[85%]">
                                      <Server className="h-4 w-4 shrink-0 text-violet-500" />
                                      <h4 className="text-xs font-bold text-slate-800 group-hover:text-indigo-600 transition-colors truncate" title={unit.name}>
                                        {unit.name}
                                      </h4>
                                    </div>
                                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setEditingStorageItem(unit);
                                          setStorageModalMode("storage");
                                          setStorageModalOpen(true);
                                        }}
                                        className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-indigo-600 cursor-pointer"
                                      >
                                        <Edit2 className="h-3 w-3" />
                                      </button>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleArchiveStorage(unit.id, unit.name);
                                        }}
                                        className="p-1 hover:bg-red-50 rounded text-slate-400 hover:text-red-600 cursor-pointer"
                                      >
                                        <Trash2 className="h-3 w-3" />
                                      </button>
                                    </div>
                                  </div>
                                  <p className="text-[10px] text-slate-400">
                                    Contains {shelvesCount} {shelvesCount === 1 ? "shelf" : "shelves"}
                                  </p>
                                </div>
                                <div className="flex items-center justify-between text-[10px] font-semibold text-slate-500 mt-2">
                                  <span className="flex items-center gap-1">
                                    <Database className="h-3.5 w-3.5 text-slate-400" />
                                    <span>{samplesCount} {samplesCount === 1 ? "sample" : "samples"}</span>
                                  </span>
                                  <span className="text-indigo-500 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all font-bold">
                                    Open Unit <ArrowRight className="h-3 w-3" />
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                          <div
                            onClick={() => {
                              setEditingStorageItem(null);
                              setStorageModalMode("storage");
                              setStorageModalOpen(true);
                            }}
                            className="flex flex-col items-center justify-center border-2 border-dashed border-slate-200 hover:border-indigo-400 bg-slate-50/40 hover:bg-indigo-50/5 rounded-xl p-4 h-32 transition-all duration-200 cursor-pointer text-slate-400 hover:text-indigo-600 text-center group"
                          >
                            <Plus className="h-5 w-5 mb-1.5 text-slate-300 group-hover:text-indigo-500 group-hover:scale-110 transition-transform" />
                            <span className="text-[10px] font-bold uppercase tracking-wider">Add Storage Unit</span>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            </>
          )}
        </section>

        {/* Right Sidebar: Detail Inspector & Chronological Audit Trail */}
        {/* Mobile backdrop for inspector */}
        {inspectorOpen && (
          <div
            className="xl:hidden fixed inset-0 bg-black/40 z-20"
            onClick={() => setInspectorOpen(false)}
          />
        )}
        <div className={`
          shrink-0 overflow-hidden
          fixed xl:relative inset-y-0 right-0 z-20 xl:z-auto
          transition-transform xl:transition-[width] duration-200
          ${inspectorOpen ? "translate-x-0 xl:w-80" : "translate-x-full xl:translate-x-0 xl:w-0"}
        `}>
        <SampleInspector
          inspectedSample={inspectedSample}
          allSamples={state.samples}
          auditLogs={state.auditLogs}
          locationString={inspectedSample ? getSampleLocationString(inspectedSample) : ""}
          onEdit={() => inspectedSample && handleOpenEditSampleModal(inspectedSample)}
          onDeplete={handleDepleteSample}
          onArchive={handleArchiveSample}
          onUndoLastChange={handleUndoLastChange}
          onShowFullTrail={() => setShowAuditTrailModal(true)}
        />
        </div>
      </main>

      <AuditTrailModal
        isOpen={showAuditTrailModal}
        auditLogs={state.auditLogs}
        auditSnapshots={state.auditSnapshots}
        auditSearch={auditSearch}
        onAuditSearchChange={setAuditSearch}
        onUndoLastChange={handleUndoLastChange}
        onExportAuditTrailCSV={handleExportAuditTrailCSV}
        onExportAuditTrailJSON={handleExportAuditTrailJSON}
        onRestoreFromSnapshot={handleRestoreFromSnapshot}
        onClose={() => setShowAuditTrailModal(false)}
      />

      {/* Footer Status */}
      <footer className="h-8 bg-slate-900 text-white flex items-center px-4 text-[10px] uppercase tracking-wider shrink-0 justify-between">
        <div className="flex gap-4 items-center">
          <span className="flex items-center gap-1.5 text-emerald-400 font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
            <span className="hidden sm:inline">Database Synced</span>
          </span>
          <span className="text-slate-400 hidden md:inline">OneDrive Shared Lab Folder: /LAB_RESOURCES</span>
        </div>
        <div className="flex gap-4 text-slate-300">
          <span>Active: {state.samples.filter(s => !s.isArchived).length}</span>
          <span className="hidden sm:inline">Capacity: {totalCapacityUsed}%</span>
        </div>
      </footer>

      {bulkSelectOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
          <div className="w-full max-w-xl bg-white rounded-xl border border-slate-200 shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">Bulk Select & Actions</h3>
              <button
                onClick={() => setBulkSelectOpen(false)}
                className="p-1 rounded hover:bg-slate-100 text-slate-500"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-slate-400 font-bold mb-1">Item Type</label>
                  <select
                    value={bulkItemType}
                    onChange={(e) => {
                      setBulkItemType(e.target.value as "sample" | "box" | "drawer" | "rack");
                      setBulkSelectedIds([]);
                    }}
                    className="w-full px-3 py-2 text-xs font-semibold border border-slate-200 rounded-lg outline-hidden"
                  >
                    <option value="sample">Samples</option>
                    <option value="box">Boxes</option>
                    <option value="drawer">Drawers</option>
                    <option value="rack">Racks</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-slate-400 font-bold mb-1">Selected</label>
                  <div className="h-[34px] px-3 flex items-center text-xs font-semibold rounded-lg border border-slate-200 bg-slate-50 text-slate-700">
                    {bulkSelectedIds.length} item(s)
                  </div>
                </div>
              </div>

              <div className="border border-slate-200 rounded-lg max-h-64 overflow-y-auto divide-y divide-slate-100">
                {bulkSelectableItems.length === 0 ? (
                  <p className="text-xs text-slate-500 p-4">No matching items in the current scope.</p>
                ) : (
                  bulkSelectableItems.map(item => {
                    const checked = bulkSelectedIds.includes(item.id);
                    return (
                      <label key={item.id} className="flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-slate-50 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setBulkSelectedIds(prev => [...prev, item.id]);
                            } else {
                              setBulkSelectedIds(prev => prev.filter(id => id !== item.id));
                            }
                          }}
                          className="h-3.5 w-3.5"
                        />
                        <span className="text-slate-800 font-medium truncate">{item.label}</span>
                      </label>
                    );
                  })
                )}
              </div>
            </div>

            <div className="px-5 py-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-2">
              <button
                onClick={() => setBulkSelectOpen(false)}
                className="px-3 py-2 text-xs font-bold border border-slate-200 rounded-lg hover:bg-slate-100 text-slate-700"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (!bulkSelectedIds.length) return;
                  setBulkMoveOpen(true);
                }}
                disabled={!bulkSelectedIds.length}
                className="px-3 py-2 text-xs font-bold border border-indigo-200 text-indigo-700 rounded-lg hover:bg-indigo-50 disabled:opacity-50"
              >
                Move Selected
              </button>
              <button
                onClick={handleBulkArchive}
                disabled={!bulkSelectedIds.length}
                className="px-3 py-2 text-xs font-bold bg-red-600 hover:bg-red-700 text-white rounded-lg disabled:opacity-50"
              >
                Archive Selected
              </button>
            </div>
          </div>
        </div>
      )}

      <BulkMoveModal
        isOpen={bulkMoveOpen}
        onClose={() => setBulkMoveOpen(false)}
        itemType={bulkItemType}
        selectedCount={bulkSelectedIds.length}
        storageUnits={state.storageUnits}
        shelves={state.shelves}
        racks={state.racks}
        drawers={state.drawers}
        boxes={state.boxes}
        defaultStorageId={selectedStorageId}
        defaultShelfId={selectedShelfId}
        defaultRackId={selectedRackId}
        defaultDrawerId={selectedDrawerId}
        defaultBoxId={selectedBoxId}
        onConfirmMove={handleConfirmBulkMove}
      />

      {/* Form Modals */}
      <SampleFormModal
        isOpen={sampleModalOpen}
        onClose={() => {
          setSampleModalOpen(false);
          setSampleDefaultRow(null);
          setSampleDefaultCol(null);
        }}
        onSave={handleSaveSample}
        sample={editingSample}
        storageUnits={state.storageUnits}
        shelves={state.shelves}
        racks={state.racks}
        drawers={state.drawers}
        boxes={state.boxes}
        allSamples={state.samples}
        defaultStorageId={selectedStorageId}
        defaultShelfId={selectedShelfId}
        defaultRackId={selectedRackId}
        defaultDrawerId={selectedDrawerId}
        defaultBoxId={selectedBoxId}
        defaultRow={sampleDefaultRow}
        defaultCol={sampleDefaultCol}
      />

      <StorageFormModal
        isOpen={storageModalOpen}
        onClose={() => {
          setStorageModalOpen(false);
          setBoxDefaultDrawerSlot(null);
        }}
        onSaveStorage={handleSaveStorage}
        onSaveShelf={handleSaveShelf}
        onSaveRack={handleSaveRack}
        onSaveDrawer={handleSaveDrawer}
        onSaveBox={handleSaveBox}
        mode={storageModalMode}
        editItem={editingStorageItem}
        storageUnits={state.storageUnits}
        shelves={state.shelves}
        racks={state.racks}
        drawers={state.drawers}
        boxes={state.boxes}
        preselectedStorageId={selectedStorageId}
        preselectedShelfId={selectedShelfId}
        preselectedRackId={selectedRackId}
        preselectedDrawerId={selectedDrawerId}
        preselectedDrawerSlot={boxDefaultDrawerSlot}
      />
    </div>
  );
}
