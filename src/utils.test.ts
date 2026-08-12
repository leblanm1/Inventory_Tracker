import { describe, it, expect } from "vitest";
import { parseCSV, escapeCSVCell, convertSamplesToCSV, convertInventoryToCSV, syncSamplesToBoxLocation, ALL_CSV_HEADERS, HEADER_TO_FIELD_MAP } from "./utils.js";
import { Box, Drawer, Rack, Sample, Shelf, StorageUnit } from "./types.js";

// ---------------------------------------------------------------------------
// CSV Parser (RFC 4180 compliance)
// ---------------------------------------------------------------------------

describe("parseCSV", () => {
  it("parses a simple single-row CSV", () => {
    const result = parseCSV("a,b,c");
    expect(result).toEqual([["a", "b", "c"]]);
  });

  it("parses multiple rows", () => {
    const result = parseCSV("a,b\nc,d");
    expect(result).toEqual([["a", "b"], ["c", "d"]]);
  });

  it("handles quoted fields containing commas", () => {
    const result = parseCSV('"hello, world",b');
    expect(result).toEqual([["hello, world", "b"]]);
  });

  it("handles quoted fields containing newlines", () => {
    const result = parseCSV('"line1\nline2",b');
    expect(result).toEqual([["line1\nline2", "b"]]);
  });

  it("handles escaped double quotes inside quoted fields", () => {
    const result = parseCSV('"she said ""hi""",b');
    expect(result).toEqual([['she said "hi"', "b"]]);
  });

  it("handles empty fields", () => {
    const result = parseCSV("a,,c");
    expect(result).toEqual([["a", "", "c"]]);
  });

  it("handles CRLF line endings", () => {
    const result = parseCSV("a,b\r\nc,d");
    expect(result).toEqual([["a", "b"], ["c", "d"]]);
  });

  it("handles trailing newline without adding empty row", () => {
    const result = parseCSV("a,b\n");
    expect(result).toEqual([["a", "b"]]);
  });

  it("handles empty input", () => {
    const result = parseCSV("");
    expect(result).toEqual([]);
  });

  it("handles a single quoted field", () => {
    const result = parseCSV('"only"');
    expect(result).toEqual([["only"]]);
  });
});

// ---------------------------------------------------------------------------
// escapeCSVCell
// ---------------------------------------------------------------------------

describe("escapeCSVCell", () => {
  it("returns empty string for null/undefined", () => {
    expect(escapeCSVCell(null)).toBe("");
    expect(escapeCSVCell(undefined)).toBe("");
  });

  it("returns plain values without quotes", () => {
    expect(escapeCSVCell("hello")).toBe("hello");
    expect(escapeCSVCell(42)).toBe("42");
  });

  it("quotes values containing commas", () => {
    expect(escapeCSVCell("a,b")).toBe('"a,b"');
  });

  it("quotes values containing double quotes and escapes them", () => {
    expect(escapeCSVCell('say "hi"')).toBe('"say ""hi"""');
  });

  it("quotes values containing newlines", () => {
    expect(escapeCSVCell("line1\nline2")).toBe('"line1\nline2"');
  });

  it("joins arrays with semicolons", () => {
    expect(escapeCSVCell(["H225", "H314"])).toBe("H225;H314");
  });

  it("handles empty arrays", () => {
    expect(escapeCSVCell([])).toBe("");
  });
});

// ---------------------------------------------------------------------------
// convertSamplesToCSV round-trip
// ---------------------------------------------------------------------------

describe("convertSamplesToCSV", () => {
  it("produces a header row matching ALL_CSV_HEADERS", () => {
    const csv = convertSamplesToCSV([]);
    const lines = csv.split("\n");
    expect(lines[0]).toBe(ALL_CSV_HEADERS.join(","));
  });

  it("round-trips a sample through CSV export and parse", () => {
    const sample: Sample = {
      id: "test-1",
      storageId: "store-1",
      shelfId: "shelf-1",
      boxId: "box-1",
      row: 0,
      col: 0,
      chemicalId: "CID-1",
      chemicalName: "Test Chemical",
      casNumber: "123-45-6",
      lab: "Lab A",
      qty: 5,
      units: "mL",
      phase: "Liquid",
      room: "Room 101",
      location: "Freezer A",
      subLocation: "Shelf 1",
      status: "active",
      plasmidName: "",
      itemType: "",
      notes: "",
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
      createdOn: "2024-01-01",
      catalogNum: "",
      packaging: "",
      price: "",
      lot: "",
      isArchived: false,
      ghsHazardCodes: ["H225", "H314"],
      storageClass: "flammable",
      minStockLevel: 2,
      reorderQty: 10,
    };

    const csv = convertSamplesToCSV([sample]);
    const rows = parseCSV(csv);
    expect(rows.length).toBe(2); // header + 1 data row
    expect(rows[0].length).toBe(ALL_CSV_HEADERS.length);

    // Verify GHS codes are semicolon-joined in the CSV
    const ghsHeaderIdx = ALL_CSV_HEADERS.indexOf("GHS Hazard Codes");
    expect(rows[1][ghsHeaderIdx]).toBe("H225;H314");
  });
});

describe("convertInventoryToCSV", () => {
  it("includes empty boxes as dedicated rows", () => {
    const storageUnit: StorageUnit = { id: "store-1", name: "Freezer A", type: "freezer" };
    const shelf: Shelf = { id: "shelf-1", storageId: "store-1", name: "Shelf 1" };
    const rack: Rack = { id: "rack-1", storageId: "store-1", shelfId: "shelf-1", name: "Rack 1" };
    const drawer: Drawer = { id: "drawer-1", storageId: "store-1", shelfId: "shelf-1", rackId: "rack-1", name: "Drawer 1" };
    const box: Box = {
      id: "box-1",
      storageId: "store-1",
      shelfId: "shelf-1",
      rackId: "rack-1",
      drawerId: "drawer-1",
      name: "Box A",
      rows: null,
      cols: null,
      isArchived: false
    };

    const csv = convertInventoryToCSV([], [box], {
      storageUnits: [storageUnit],
      shelves: [shelf],
      racks: [rack],
      drawers: [drawer],
      boxes: [box]
    });

    const rows = parseCSV(csv);
    expect(rows.length).toBe(2);
    const itemTypeIdx = ALL_CSV_HEADERS.indexOf("Item Type");
    const boxIdIdx = ALL_CSV_HEADERS.indexOf("Box ID");
    const boxNameIdx = ALL_CSV_HEADERS.indexOf("Box Name");
    expect(rows[1][itemTypeIdx]).toBe("Box");
    expect(rows[1][boxIdIdx]).toBe("box-1");
    expect(rows[1][boxNameIdx]).toBe("Box A");
  });
});

describe("syncSamplesToBoxLocation", () => {
  it("updates ancestry for samples contained in the moved box", () => {
    const samples: Sample[] = [
      {
        id: "sample-1",
        storageId: "freezer-2",
        shelfId: "shelf-2",
        rackId: "rack-2",
        drawerId: "drawer-2",
        boxId: "box-1",
        row: 1,
        col: 1,
        qty: 1,
        units: "uL",
        chemicalName: "Sample 1",
        casNumber: "",
        itemType: "",
        notes: "",
        chemicalId: "",
        lab: "",
        phase: "",
        room: "",
        location: "",
        subLocation: "",
        status: "",
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
        createdOn: "",
        catalogNum: "",
        packaging: "",
        price: "",
        lot: ""
      },
      {
        id: "sample-2",
        storageId: "freezer-2",
        shelfId: "shelf-2",
        rackId: null,
        drawerId: null,
        boxId: null,
        row: null,
        col: null,
        qty: 1,
        units: "uL",
        chemicalName: "Loose Sample",
        casNumber: "",
        itemType: "",
        notes: "",
        chemicalId: "",
        lab: "",
        phase: "",
        room: "",
        location: "",
        subLocation: "",
        status: "",
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
        createdOn: "",
        catalogNum: "",
        packaging: "",
        price: "",
        lot: ""
      }
    ];

    const updated = syncSamplesToBoxLocation(samples, {
      id: "box-1",
      storageId: "freezer-1",
      shelfId: "shelf-1",
      rackId: null,
      drawerId: null
    });

    expect(updated[0]).toMatchObject({
      storageId: "freezer-1",
      shelfId: "shelf-1",
      rackId: null,
      drawerId: null
    });
    expect(updated[1]).toBe(samples[1]);
  });
});

// ---------------------------------------------------------------------------
// HEADER_TO_FIELD_MAP
// ---------------------------------------------------------------------------

describe("HEADER_TO_FIELD_MAP", () => {
  it("maps the legacy 'rooom' typo to 'room'", () => {
    expect(HEADER_TO_FIELD_MAP["rooom"]).toBe("room");
  });

  it("maps all new lab safety fields", () => {
    expect(HEADER_TO_FIELD_MAP["ghshazardcodes"]).toBe("ghsHazardCodes");
    expect(HEADER_TO_FIELD_MAP["sdsurl"]).toBe("sdsUrl");
    expect(HEADER_TO_FIELD_MAP["storageclass"]).toBe("storageClass");
    expect(HEADER_TO_FIELD_MAP["minstocklevel"]).toBe("minStockLevel");
    expect(HEADER_TO_FIELD_MAP["reorderqty"]).toBe("reorderQty");
  });

  it("maps expires on to expiresOn", () => {
    expect(HEADER_TO_FIELD_MAP["expireson"]).toBe("expiresOn");
  });
});
