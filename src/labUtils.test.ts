import { describe, it, expect } from "vitest";
import {
  getExpiryStatus,
  getExpiryColorClass,
  getExpiryBadgeClass,
  getExpiryLabel,
  getDaysUntilExpiry,
  getExpiringSamples,
  isLowStock,
  getLowStockSamples,
  generateShoppingListCSV,
  getGHSPictograms,
  GHS_PICTOGRAM_MAP,
  isIncompatible,
  checkCompatibility,
} from "./labUtils.js";
import { Sample } from "./types.js";

// Helper to create a minimal sample
function makeSample(overrides: Partial<Sample> = {}): Sample {
  return {
    id: "s1",
    storageId: "store-1",
    shelfId: "shelf-1",
    boxId: null,
    row: null,
    col: null,
    chemicalName: "Test",
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
    lot: "",
    qty: 10,
    units: "mL",
    isArchived: false,
    ...overrides,
  };
}

function daysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

// ---------------------------------------------------------------------------
// Expiry tracking
// ---------------------------------------------------------------------------

describe("getExpiryStatus", () => {
  it("returns 'none' when no expiresOn is set", () => {
    expect(getExpiryStatus(makeSample())).toBe("none");
  });

  it("returns 'none' for invalid date", () => {
    expect(getExpiryStatus(makeSample({ expiresOn: "not-a-date" }))).toBe("none");
  });

  it("returns 'expired' for past dates", () => {
    expect(getExpiryStatus(makeSample({ expiresOn: daysFromNow(-1) }))).toBe("expired");
    expect(getExpiryStatus(makeSample({ expiresOn: daysFromNow(-100) }))).toBe("expired");
  });

  it("returns 'critical' for dates within 30 days", () => {
    expect(getExpiryStatus(makeSample({ expiresOn: daysFromNow(1) }))).toBe("critical");
    expect(getExpiryStatus(makeSample({ expiresOn: daysFromNow(30) }))).toBe("critical");
  });

  it("returns 'warning' for dates within 60 days", () => {
    expect(getExpiryStatus(makeSample({ expiresOn: daysFromNow(31) }))).toBe("warning");
    expect(getExpiryStatus(makeSample({ expiresOn: daysFromNow(60) }))).toBe("warning");
  });

  it("returns 'soon' for dates within 90 days", () => {
    expect(getExpiryStatus(makeSample({ expiresOn: daysFromNow(61) }))).toBe("soon");
    expect(getExpiryStatus(makeSample({ expiresOn: daysFromNow(90) }))).toBe("soon");
  });

  it("returns 'ok' for dates beyond 90 days", () => {
    expect(getExpiryStatus(makeSample({ expiresOn: daysFromNow(91) }))).toBe("ok");
    expect(getExpiryStatus(makeSample({ expiresOn: daysFromNow(365) }))).toBe("ok");
  });
});

describe("getExpiryColorClass", () => {
  it("returns a class for each status", () => {
    expect(getExpiryColorClass("expired")).toContain("red");
    expect(getExpiryColorClass("ok")).toContain("emerald");
    expect(getExpiryColorClass("none")).toContain("slate");
  });
});

describe("getExpiryBadgeClass", () => {
  it("returns badge classes", () => {
    expect(getExpiryBadgeClass("expired")).toContain("red");
    expect(getExpiryBadgeClass("ok")).toContain("emerald");
  });
});

describe("getExpiryLabel", () => {
  it("returns human-readable labels", () => {
    expect(getExpiryLabel("expired")).toBe("Expired");
    expect(getExpiryLabel("critical")).toBe("< 30 days");
    expect(getExpiryLabel("none")).toBe("No expiry");
  });
});

describe("getDaysUntilExpiry", () => {
  it("returns null when no expiry date", () => {
    expect(getDaysUntilExpiry(makeSample())).toBeNull();
  });

  it("returns positive days for future dates", () => {
    expect(getDaysUntilExpiry(makeSample({ expiresOn: daysFromNow(10) }))).toBe(10);
  });

  it("returns negative days for past dates", () => {
    expect(getDaysUntilExpiry(makeSample({ expiresOn: daysFromNow(-5) }))).toBe(-5);
  });
});

describe("getExpiringSamples", () => {
  it("filters out archived samples", () => {
    const samples = [
      makeSample({ id: "a", expiresOn: daysFromNow(10) }),
      makeSample({ id: "b", expiresOn: daysFromNow(10), isArchived: true }),
    ];
    expect(getExpiringSamples(samples).length).toBe(1);
  });

  it("filters out samples with no expiry", () => {
    const samples = [
      makeSample({ id: "a", expiresOn: daysFromNow(10) }),
      makeSample({ id: "b" }),
    ];
    expect(getExpiringSamples(samples).length).toBe(1);
  });

  it("filters out samples expiring beyond 90 days", () => {
    const samples = [
      makeSample({ id: "a", expiresOn: daysFromNow(10) }),
      makeSample({ id: "b", expiresOn: daysFromNow(200) }),
    ];
    expect(getExpiringSamples(samples).length).toBe(1);
  });

  it("sorts by expiry date ascending", () => {
    const samples = [
      makeSample({ id: "late", expiresOn: daysFromNow(60) }),
      makeSample({ id: "early", expiresOn: daysFromNow(5) }),
    ];
    const result = getExpiringSamples(samples);
    expect(result[0].id).toBe("early");
    expect(result[1].id).toBe("late");
  });
});

// ---------------------------------------------------------------------------
// Low-stock alerts
// ---------------------------------------------------------------------------

describe("isLowStock", () => {
  it("returns false when no minStockLevel is set", () => {
    expect(isLowStock(makeSample({ qty: 0 }))).toBe(false);
  });

  it("returns false for archived samples", () => {
    expect(isLowStock(makeSample({ qty: 0, minStockLevel: 5, isArchived: true }))).toBe(false);
  });

  it("returns true when qty equals minStockLevel", () => {
    expect(isLowStock(makeSample({ qty: 5, minStockLevel: 5 }))).toBe(true);
  });

  it("returns true when qty is below minStockLevel", () => {
    expect(isLowStock(makeSample({ qty: 2, minStockLevel: 10 }))).toBe(true);
  });

  it("returns false when qty is above minStockLevel", () => {
    expect(isLowStock(makeSample({ qty: 20, minStockLevel: 10 }))).toBe(false);
  });
});

describe("getLowStockSamples", () => {
  it("returns only low-stock samples sorted by urgency", () => {
    const samples = [
      makeSample({ id: "ok", qty: 100, minStockLevel: 10 }),
      makeSample({ id: "bad", qty: 1, minStockLevel: 10 }),
      makeSample({ id: "mid", qty: 5, minStockLevel: 10 }),
    ];
    const result = getLowStockSamples(samples);
    expect(result.length).toBe(2);
    expect(result[0].id).toBe("bad"); // lowest ratio
    expect(result[1].id).toBe("mid");
  });
});

describe("generateShoppingListCSV", () => {
  it("generates CSV with header row", () => {
    const csv = generateShoppingListCSV([]);
    const lines = csv.split("\n");
    expect(lines[0]).toContain("Chemical Name");
    expect(lines[0]).toContain("Reorder Qty");
  });

  it("includes low-stock items in the CSV", () => {
    const samples = [
      makeSample({ id: "low", chemicalName: "Acid", qty: 1, minStockLevel: 10, reorderQty: 20, catalogNum: "CAT-1", source: "Sigma", units: "mL" }),
    ];
    const csv = generateShoppingListCSV(samples);
    const lines = csv.split("\n");
    expect(lines.length).toBe(2);
    expect(lines[1]).toContain("Acid");
    expect(lines[1]).toContain("20");
  });
});

// ---------------------------------------------------------------------------
// GHS pictograms
// ---------------------------------------------------------------------------

describe("getGHSPictograms", () => {
  it("returns empty array for undefined codes", () => {
    expect(getGHSPictograms(undefined)).toEqual([]);
  });

  it("returns empty array for empty codes", () => {
    expect(getGHSPictograms([])).toEqual([]);
  });

  it("maps known GHS codes to pictogram categories", () => {
    expect(getGHSPictograms(["H225"])).toEqual(["flammable"]);
    expect(getGHSPictograms(["H314"])).toEqual(["corrosive"]);
    expect(getGHSPictograms(["H300"])).toEqual(["toxic"]);
  });

  it("returns unique pictograms for multiple codes in same category", () => {
    const result = getGHSPictograms(["H220", "H225"]);
    expect(result).toEqual(["flammable"]);
  });

  it("returns multiple pictograms for codes in different categories", () => {
    const result = getGHSPictograms(["H225", "H314", "H400"]);
    expect(result).toContain("flammable");
    expect(result).toContain("corrosive");
    expect(result).toContain("environment");
  });

  it("handles lowercase codes", () => {
    expect(getGHSPictograms(["h225"])).toEqual(["flammable"]);
  });

  it("ignores unknown codes", () => {
    expect(getGHSPictograms(["H999"])).toEqual([]);
  });
});

describe("GHS_PICTOGRAM_MAP", () => {
  it("maps H318 to corrosive (not irritant)", () => {
    expect(GHS_PICTOGRAM_MAP["H318"]).toBe("corrosive");
  });

  it("maps H319 to irritant", () => {
    expect(GHS_PICTOGRAM_MAP["H319"]).toBe("irritant");
  });
});

// ---------------------------------------------------------------------------
// Storage compatibility
// ---------------------------------------------------------------------------

describe("isIncompatible", () => {
  it("returns false when either class is missing", () => {
    expect(isIncompatible(undefined, "flammable")).toBe(false);
    expect(isIncompatible("flammable", undefined)).toBe(false);
  });

  it("returns true for flammable + oxidizer", () => {
    expect(isIncompatible("flammable", "oxidizer")).toBe(true);
    expect(isIncompatible("oxidizer", "flammable")).toBe(true);
  });

  it("returns true for acid + base", () => {
    expect(isIncompatible("acid", "base")).toBe(true);
    expect(isIncompatible("base", "acid")).toBe(true);
  });

  it("returns false for compatible classes", () => {
    expect(isIncompatible("general", "general")).toBe(false);
    expect(isIncompatible("light-sensitive", "general")).toBe(false);
  });
});

describe("checkCompatibility", () => {
  it("returns empty list when sample has no storage class", () => {
    const sample = makeSample({ id: "s1" });
    const others = [makeSample({ id: "s2", storageClass: "flammable" })];
    expect(checkCompatibility(sample, others)).toEqual([]);
  });

  it("detects incompatible samples in the same container", () => {
    const sample = makeSample({ id: "s1", storageClass: "flammable", chemicalName: "Ethanol" });
    const others = [
      makeSample({ id: "s2", storageClass: "oxidizer", chemicalName: "KMnO4" }),
      makeSample({ id: "s3", storageClass: "general", chemicalName: "Salt" }),
    ];
    const result = checkCompatibility(sample, others);
    expect(result.length).toBe(1);
    expect(result[0]).toContain("KMnO4");
    expect(result[0]).toContain("oxidizer");
  });

  it("skips archived samples", () => {
    const sample = makeSample({ id: "s1", storageClass: "flammable" });
    const others = [
      makeSample({ id: "s2", storageClass: "oxidizer", isArchived: true, chemicalName: "Old Oxidizer" }),
    ];
    expect(checkCompatibility(sample, others)).toEqual([]);
  });

  it("skips the sample itself", () => {
    const sample = makeSample({ id: "s1", storageClass: "flammable", chemicalName: "Ethanol" });
    const others = [sample];
    expect(checkCompatibility(sample, others)).toEqual([]);
  });
});
