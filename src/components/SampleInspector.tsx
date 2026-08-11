/**
 * Sample Inspector Panel — extracted from App.tsx (review item 6).
 * Right sidebar showing sample details, safety info, and recent audit trail.
 */
import React from "react";
import { Edit2, Trash2, AlertTriangle, History, User } from "lucide-react";
import { Sample, AuditLog } from "../types.js";
import {
  getExpiryStatus,
  getExpiryBadgeClass,
  getExpiryLabel,
  getDaysUntilExpiry,
  isLowStock,
  getGHSPictograms,
  GHS_PICTOGRAM_SYMBOLS,
  GHS_PICTOGRAM_LABELS,
  checkCompatibility,
} from "../labUtils.js";

interface SampleInspectorProps {
  inspectedSample: Sample | null;
  allSamples: Sample[];
  auditLogs: AuditLog[];
  locationString: string;
  onEdit: () => void;
  onDeplete: (sampleId: string, chemicalName: string) => void;
  onArchive: (sampleId: string, chemicalName: string) => void;
  onUndoLastChange: () => void;
  onShowFullTrail: () => void;
}

export default function SampleInspector({
  inspectedSample,
  allSamples,
  auditLogs,
  locationString,
  onEdit,
  onDeplete,
  onArchive,
  onUndoLastChange,
  onShowFullTrail,
}: SampleInspectorProps) {
  const isPlasmidSeriesSample = inspectedSample
    ? /^pms/i.test((inspectedSample.chemicalName || "").trim())
      || /plasmid/i.test((inspectedSample.itemType || "").trim())
      || Boolean((inspectedSample.plasmidName || "").trim())
    : false;

  const antibioticResistanceLabel = inspectedSample
    ? (inspectedSample.antibioticResistance || inspectedSample.markers || "").trim()
    : "";

  return (
    <aside className="w-80 bg-white border-l border-slate-200 flex flex-col shrink-0">
      {/* Sample Inspector Panel */}
      <div className="p-5 border-b border-slate-100 bg-slate-50/30">
        <div className="flex justify-between items-center mb-4">
          <h2 className="font-bold text-slate-900 text-sm">Sample Inspector</h2>
          {inspectedSample && (
            <button
              onClick={onEdit}
              className="text-indigo-600 hover:text-indigo-800 text-xs font-bold flex items-center gap-1 cursor-pointer"
            >
              <Edit2 className="h-3 w-3" /> Edit Info
            </button>
          )}
        </div>

        {inspectedSample ? (
          <div className="space-y-4">
            <div>
              <label className="text-[9px] uppercase font-bold text-slate-400 tracking-wider">Chemical / Sample Name</label>
              <p className="text-xs font-bold text-slate-800">{inspectedSample.chemicalName}</p>
            </div>

            {isPlasmidSeriesSample && (
              <div className="p-3 rounded-lg border border-rose-200 bg-rose-50 space-y-1">
                <div className="text-[10px] uppercase tracking-wider font-extrabold text-rose-700">Plasmid Antibiotic Resistance</div>
                <div className="text-sm font-extrabold text-rose-900">
                  {antibioticResistanceLabel || "Not set"}
                </div>
                {!antibioticResistanceLabel && (
                  <p className="text-[10px] text-rose-700/80">Add this in Edit Info for quick plasmid screening.</p>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3.5">
              <div>
                <label className="text-[9px] uppercase font-bold text-slate-400 tracking-wider">Quantity</label>
                <p className="text-xs font-semibold text-slate-800">
                  {inspectedSample.qty} <span className="text-slate-400 font-normal">{inspectedSample.units}</span>
                </p>
              </div>
              <div>
                <label className="text-[9px] uppercase font-bold text-slate-400 tracking-wider">Item Type</label>
                <p className="text-xs font-semibold text-slate-800">{inspectedSample.itemType || "—"}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3.5">
              <div>
                <label className="text-[9px] uppercase font-bold text-slate-400 tracking-wider">CAS Number</label>
                <p className="text-xs font-mono text-slate-700">{inspectedSample.casNumber || "—"}</p>
              </div>
              <div>
                <label className="text-[9px] uppercase font-bold text-slate-400 tracking-wider">Location Placement</label>
                <p className="text-xs font-semibold text-indigo-600 bg-indigo-50/50 px-1.5 py-0.5 rounded border border-indigo-100/30 w-fit leading-normal">
                  {locationString}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3.5">
              <div>
                <label className="text-[9px] uppercase font-bold text-slate-400 tracking-wider">Concentration</label>
                <p className="text-xs font-mono text-slate-700">{inspectedSample.concentration || "—"}</p>
              </div>
              <div>
                <label className="text-[9px] uppercase font-bold text-slate-400 tracking-wider">Volume / Mass</label>
                <p className="text-xs font-mono text-slate-700">{inspectedSample.volumeMass || "—"}</p>
              </div>
            </div>

            {/* Expiry & Stock Status */}
            {(() => {
              const expiryStatus = getExpiryStatus(inspectedSample);
              const daysLeft = getDaysUntilExpiry(inspectedSample);
              const lowStock = isLowStock(inspectedSample);
              const ghsPictograms = getGHSPictograms(inspectedSample.ghsHazardCodes);
              const hasSafetyInfo = expiryStatus !== "none" || lowStock || ghsPictograms.length > 0 || inspectedSample.sdsUrl || inspectedSample.storageClass;
              if (!hasSafetyInfo) return null;
              return (
                <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-100 space-y-2">
                  {expiryStatus !== "none" && (
                    <div className="flex items-center justify-between">
                      <label className="text-[9px] uppercase font-bold text-slate-400 tracking-wider">Expiry</label>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${getExpiryBadgeClass(expiryStatus)}`}>
                        {getExpiryLabel(expiryStatus)}
                        {daysLeft !== null && daysLeft >= 0 ? ` (${daysLeft}d)` : daysLeft !== null ? ` (${-daysLeft}d ago)` : ""}
                      </span>
                    </div>
                  )}
                  {inspectedSample.expiresOn && (
                    <div className="text-[10px] text-slate-500">
                      Expires: {new Date(inspectedSample.expiresOn).toLocaleDateString()}
                    </div>
                  )}
                  {lowStock && (
                    <div className="flex items-center justify-between">
                      <label className="text-[9px] uppercase font-bold text-slate-400 tracking-wider">Stock Status</label>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 border border-orange-200">
                        Low Stock ({inspectedSample.qty}/{inspectedSample.minStockLevel})
                      </span>
                    </div>
                  )}
                  {inspectedSample.storageClass && (
                    <div className="flex items-center justify-between">
                      <label className="text-[9px] uppercase font-bold text-slate-400 tracking-wider">Storage Class</label>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 border border-violet-200 capitalize">
                        {inspectedSample.storageClass}
                      </span>
                    </div>
                  )}
                  {ghsPictograms.length > 0 && (
                    <div>
                      <label className="text-[9px] uppercase font-bold text-slate-400 tracking-wider block mb-1">GHS Hazard Pictograms</label>
                      <div className="flex flex-wrap gap-1">
                        {ghsPictograms.map(p => (
                          <span
                            key={p}
                            className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-50 text-red-700 border border-red-200"
                            title={GHS_PICTOGRAM_LABELS[p] || p}
                          >
                            <span>{GHS_PICTOGRAM_SYMBOLS[p] || "?"}</span>
                            {GHS_PICTOGRAM_LABELS[p] || p}
                          </span>
                        ))}
                      </div>
                      {inspectedSample.ghsHazardCodes && inspectedSample.ghsHazardCodes.length > 0 && (
                        <div className="text-[9px] text-slate-400 mt-1 font-mono">
                          {inspectedSample.ghsHazardCodes.join(", ")}
                        </div>
                      )}
                    </div>
                  )}
                  {inspectedSample.sdsUrl && (
                    <div className="flex items-center justify-between">
                      <label className="text-[9px] uppercase font-bold text-slate-400 tracking-wider">SDS</label>
                      <a
                        href={inspectedSample.sdsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800 underline"
                      >
                        View Safety Data Sheet
                      </a>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Storage Compatibility Warning */}
            {inspectedSample.storageClass && (() => {
              const containerSamples = allSamples.filter(s =>
                s.boxId === inspectedSample.boxId &&
                s.id !== inspectedSample.id &&
                !s.isArchived
              );
              const incompatible = checkCompatibility(inspectedSample, containerSamples);
              if (incompatible.length === 0) return null;
              return (
                <div className="p-2.5 bg-red-50 rounded-lg border border-red-200">
                  <div className="flex items-center gap-1.5 mb-1">
                    <AlertTriangle className="h-3.5 w-3.5 text-red-600" />
                    <label className="text-[9px] uppercase font-bold text-red-600 tracking-wider">Storage Incompatibility</label>
                  </div>
                  <p className="text-[10px] text-red-700 leading-relaxed">
                    This item ({inspectedSample.storageClass}) is incompatible with: {incompatible.join(", ")}
                  </p>
                </div>
              );
            })()}

            {inspectedSample.plasmidName && (
              <div>
                <label className="text-[9px] uppercase font-bold text-slate-400 tracking-wider">Plasmid Details</label>
                <div className="p-2 bg-slate-50 rounded border border-slate-100 text-[11px] space-y-0.5 text-slate-600">
                  <div><span className="font-semibold text-slate-800">Plasmid:</span> {inspectedSample.plasmidName}</div>
                  {antibioticResistanceLabel && <div><span className="font-semibold text-slate-800">Antibiotic Resistance:</span> {antibioticResistanceLabel}</div>}
                  {inspectedSample.organism && <div><span className="font-semibold text-slate-800">Organism:</span> {inspectedSample.organism}</div>}
                  {inspectedSample.vector && <div><span className="font-semibold text-slate-800">Vector:</span> {inspectedSample.vector}</div>}
                  {inspectedSample.gene && <div><span className="font-semibold text-slate-800">Gene:</span> {inspectedSample.gene}</div>}
                </div>
              </div>
            )}

            {inspectedSample.notes && (
              <div>
                <label className="text-[9px] uppercase font-bold text-slate-400 tracking-wider">Storage & Prep Notes</label>
                <p className="text-xs text-slate-600 leading-relaxed bg-slate-50 p-2 rounded border border-slate-100 font-serif italic">
                  "{inspectedSample.notes}"
                </p>
              </div>
            )}

            {/* Micro Actions */}
            <div className="pt-2 grid grid-cols-2 gap-2">
              <button
                onClick={() => onDeplete(inspectedSample.id, inspectedSample.chemicalName)}
                disabled={inspectedSample.qty === 0}
                className="py-1.5 bg-orange-50 hover:bg-orange-100 disabled:opacity-50 text-orange-700 text-xs font-bold rounded-lg border border-orange-200 transition-colors flex items-center justify-center gap-1 cursor-pointer"
              >
                Mark Depleted
              </button>
              <button
                onClick={() => onArchive(inspectedSample.id, inspectedSample.chemicalName)}
                className="py-1.5 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-bold rounded-lg border border-red-200 transition-colors flex items-center justify-center gap-1 cursor-pointer"
              >
                <Trash2 className="h-3 w-3" />
                Archive/Delete
              </button>
            </div>
          </div>
        ) : (
          <div className="text-center py-10 bg-slate-50/50 rounded-xl border border-dashed border-slate-200">
            <p className="text-xs text-slate-400">Click a sample to inspect all spreadsheet metadata, notes, and catalog references.</p>
          </div>
        )}
      </div>

      {/* Chronological Audit Logs */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="px-5 py-3 border-b border-slate-50 bg-slate-50/50 flex items-center justify-between shrink-0">
          <h3 className="text-[10px] uppercase font-bold text-slate-400 tracking-widest flex items-center gap-1">
            <History className="h-3.5 w-3.5 text-slate-400" /> Recent Audit Trail
          </h3>
          <div className="flex items-center gap-1">
            <button
              onClick={onUndoLastChange}
              className="text-[9px] bg-orange-100 hover:bg-orange-200 text-orange-700 font-bold px-1.5 py-0.5 rounded-full cursor-pointer"
              title="Undo last change"
            >
              Undo Last
            </button>
            <button
              onClick={onShowFullTrail}
              className="text-[9px] bg-slate-200 hover:bg-slate-300 text-slate-600 font-bold px-1.5 py-0.5 rounded-full cursor-pointer"
            >
              Full Trail
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {auditLogs && auditLogs.length > 0 ? (
            auditLogs.slice(0, 50).map((log) => (
              <div key={log.id} className="relative pl-4 border-l-2 border-slate-200/80">
                <div className="absolute -left-[5px] top-0.5 w-2.5 h-2.5 rounded-full bg-indigo-500 border border-white"></div>
                <p className="text-[11px] font-bold text-slate-800">{log.action}</p>
                <p className="text-[10px] text-slate-400 mt-0.5 font-medium flex items-center gap-1">
                  <User className="h-2.5 w-2.5 text-slate-300" /> {log.user} • {new Date(log.timestamp).toLocaleTimeString()}
                </p>
                <p className="text-[10px] text-slate-500 mt-1 italic leading-relaxed">
                  {log.description}
                </p>
              </div>
            ))
          ) : (
            <p className="text-xs text-slate-400 italic text-center py-6">No audit logs yet.</p>
          )}
        </div>
      </div>
    </aside>
  );
}
