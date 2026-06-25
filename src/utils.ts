import { Sample } from "./types.js";

/**
 * Standard CSV Headers requested by user
 */
export const ALL_CSV_HEADERS = [
  "ChemicalID", "ChemicalName", "CAS Number", "Lab", "Qty", "Units", "Phase", "Rooom", 
  "Location", "SubLocation", "Status", "Plasmid Name", "Primary Box", "Secondary Box", 
  "Primary Tube", "Secondary Tube", "Primary Date Deposited", "Secondary Date Deposited", 
  "Primary Deposited By", "Secondary Deposited By", "Primary Preparation/Concentration", 
  "Secondary Preparation/Concentration", "Primary Reference", "Secondary Reference", 
  "System", "Organism", "gene", "Fragment Size", "Mutations", "Vector", "Markers", "Hosts", 
  "Notebook Reference", "Source", "File", "Freezer ID", "Freezer Name", "Shelf ID", 
  "Shelf Name", "Rack ID", "Rack Name", "Drawer ID", "Drawer Name", "Category ID", "Category Name", "Box ID", 
  "Box Name", "Item Group ID", "Item Group Name", "Item ID", "Item Name", "Row", "Column", 
  "Concentration", "Volume/Mass", "Expires On", "Created On", "Notes", "Catalog #", 
  "Packaging", "Price", "Lot", "Item Type"
];

/**
 * Normalizes strings by lowercasing and removing non-alphanumeric characters.
 * This ensures robust mapping from slightly varying spreadsheet headers.
 */
function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Maps normalized CSV headers to the fields on our Sample interface
 */
export const HEADER_TO_FIELD_MAP: Record<string, keyof Sample> = {
  chemicalid: "chemicalId",
  chemicalname: "chemicalName",
  casnumber: "casNumber",
  lab: "lab",
  qty: "qty",
  units: "units",
  phase: "phase",
  room: "room",
  rooom: "room", // support user's literal typo
  location: "location",
  sublocation: "subLocation",
  status: "status",
  plasmidname: "plasmidName",
  primarybox: "primaryBox",
  secondarybox: "secondaryBox",
  primarytube: "primaryTube",
  secondarytube: "secondaryTube",
  primarydatedeposited: "primaryDateDeposited",
  secondarydatedeposited: "secondaryDateDeposited",
  primarydepositedby: "primaryDepositedBy",
  secondarydepositedby: "secondaryDepositedBy",
  primarypreparationconcentration: "primaryPrep",
  secondarypreparationconcentration: "secondaryPrep",
  primaryreference: "primaryRef",
  secondaryreference: "secondaryRef",
  system: "system",
  organism: "organism",
  gene: "gene",
  fragmentsize: "fragmentSize",
  mutations: "mutations",
  vector: "vector",
  markers: "markers",
  hosts: "hosts",
  notebookreference: "notebookRef",
  source: "source",
  file: "file",
  freezerid: "freezerIdStr",
  freezername: "freezerNameStr",
  shelfid: "shelfIdStr",
  shelfname: "shelfNameStr",
  rackid: "rackId",
  rackname: "rackName",
  drawerid: "drawerIdStr",
  drawername: "drawerNameStr",
  categoryid: "categoryId",
  categoryname: "categoryName",
  boxid: "boxIdStr",
  boxname: "boxNameStr",
  itemgroupid: "itemGroupId",
  itemgroupname: "itemGroupName",
  itemid: "itemId",
  itemname: "itemName",
  row: "row",
  column: "col",
  concentration: "concentration",
  volumemass: "volumeMass",
  expireson: "expiresOn",
  createdon: "createdOn",
  notes: "notes",
  catalog: "catalogNum",
  catalognum: "catalogNum",
  packaging: "packaging",
  price: "price",
  lot: "lot",
  itemtype: "itemType",
  vendor: "source",
  owner: "primaryDepositedBy",
  locationdetails: "notes",
  amountinstock: "qty",
  amountinstockunits: "units",
  unitsize: "volumeMass",
  url: "notebookRef",
  technicaldetails: "notes",
  expirationdate: "expiresOn",
  lotnumber: "lot",
  alternatename: "chemicalName"
};

/**
 * High quality RFC 4180 compliant CSV parser
 */
export function parseCSV(text: string): string[][] {
  const result: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];
    
    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          cell += '"';
          i++; // Skip the second double quote
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        row.push(cell);
        cell = '';
      } else if (char === '\n' || char === '\r') {
        row.push(cell);
        // Avoid inserting empty lines
        if (row.length > 1 || row[0] !== '') {
          result.push(row);
        }
        row = [];
        cell = '';
        if (char === '\r' && nextChar === '\n') {
          i++; // Skip the newline character
        }
      } else {
        cell += char;
      }
    }
  }
  
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    result.push(row);
  }
  
  return result;
}

/**
 * Escapes a cell value for CSV formatting
 */
export function escapeCSVCell(value: any): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Converts a list of Samples back to a full CSV String
 */
export function convertSamplesToCSV(samples: Sample[]): string {
  const lines: string[] = [];
  
  // Header line
  lines.push(ALL_CSV_HEADERS.join(","));
  
  // Row lines
  for (const sample of samples) {
    const rowValues = ALL_CSV_HEADERS.map(header => {
      const norm = normalizeHeader(header);
      const field = HEADER_TO_FIELD_MAP[norm];
      if (!field) return '';
      
      const val = sample[field];
      return escapeCSVCell(val);
    });
    lines.push(rowValues.join(","));
  }
  
  return lines.join("\n");
}

/**
 * Map field name to full user-friendly label
 */
export function getFieldLabel(field: keyof Sample): string {
  // Find matching CSV header
  for (const header of ALL_CSV_HEADERS) {
    const norm = normalizeHeader(header);
    if (HEADER_TO_FIELD_MAP[norm] === field) {
      return header;
    }
  }
  
  // Fallbacks
  switch (field) {
    case 'chemicalName': return 'Chemical Name';
    case 'casNumber': return 'CAS Number';
    case 'qty': return 'Quantity';
    case 'units': return 'Units';
    case 'itemType': return 'Item Type';
    case 'catalogNum': return 'Catalog #';
    case 'volumeMass': return 'Volume/Mass';
    case 'primaryPrep': return 'Primary Prep/Concentration';
    case 'secondaryPrep': return 'Secondary Prep/Concentration';
    default: return String(field);
  }
}
