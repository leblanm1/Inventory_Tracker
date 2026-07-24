/**
 * Full Audit Trail Modal — extracted from App.tsx (review item 6).
 * Displays the complete change history with search, restore, and export.
 */
import React from "react";
import { X, Download } from "lucide-react";
import { AuditLog, AuditSnapshot } from "../types.js";

interface AuditTrailModalProps {
  isOpen: boolean;
  auditLogs: AuditLog[];
  auditSnapshots: AuditSnapshot[];
  auditSearch: string;
  onAuditSearchChange: (value: string) => void;
  onUndoLastChange: () => void;
  onExportAuditTrailCSV: () => void;
  onExportAuditTrailJSON: () => void;
  onRestoreFromSnapshot: (snapshotId: string) => void;
  onClose: () => void;
}

export default function AuditTrailModal({
  isOpen,
  auditLogs,
  auditSnapshots,
  auditSearch,
  onAuditSearchChange,
  onUndoLastChange,
  onExportAuditTrailCSV,
  onExportAuditTrailJSON,
  onRestoreFromSnapshot,
  onClose
}: AuditTrailModalProps) {
  if (!isOpen) return null;

  const query = auditSearch.trim().toLowerCase();
  const filteredAuditLogs = auditLogs.filter(log => {
    if (!query) return true;
    return (
      log.action.toLowerCase().includes(query) ||
      log.description.toLowerCase().includes(query) ||
      log.user.toLowerCase().includes(query)
    );
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-5xl max-h-[90vh] bg-white rounded-xl border border-slate-200 shadow-2xl overflow-hidden flex flex-col">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <div>
            <h3 className="text-base font-bold text-slate-900">Full Audit Trail</h3>
            <p className="text-xs text-slate-500">Review, restore, and export complete change history.</p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-slate-200 text-slate-500"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-slate-100 bg-white flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={auditSearch}
            onChange={(e) => onAuditSearchChange(e.target.value)}
            placeholder="Filter by action, description, or user..."
            className="flex-1 min-w-[220px] px-3 py-2 border border-slate-200 rounded-lg text-xs focus:ring-2 focus:ring-indigo-500 outline-hidden"
          />
          <button
            onClick={onUndoLastChange}
            className="px-3 py-2 text-xs font-bold bg-orange-100 hover:bg-orange-200 text-orange-700 rounded-lg"
          >
            Undo Last Change
          </button>
          <button
            onClick={onExportAuditTrailCSV}
            className="px-3 py-2 text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg flex items-center gap-1"
          >
            <Download className="h-3.5 w-3.5" /> Export CSV
          </button>
          <button
            onClick={onExportAuditTrailJSON}
            className="px-3 py-2 text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg flex items-center gap-1"
          >
            <Download className="h-3.5 w-3.5" /> Export JSON
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3 bg-slate-50/30">
          {filteredAuditLogs.length === 0 ? (
            <p className="text-xs text-slate-500 italic text-center py-8">No audit records match your filter.</p>
          ) : (
            filteredAuditLogs.map(log => {
              const relatedSnapshot = auditSnapshots.find(s => s.logId === log.id);
              return (
                <div key={log.id} className="bg-white border border-slate-200 rounded-lg p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs font-bold text-slate-900">{log.action}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {new Date(log.timestamp).toLocaleString()} • {log.user}
                      </p>
                    </div>
                    {relatedSnapshot ? (
                      <button
                        onClick={() => onRestoreFromSnapshot(relatedSnapshot.id)}
                        className="px-2.5 py-1.5 text-[11px] font-bold bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-md"
                      >
                        Restore This Point
                      </button>
                    ) : (
                      <span className="text-[10px] text-slate-400">No snapshot</span>
                    )}
                  </div>
                  <p className="text-xs text-slate-600 mt-2 leading-relaxed">{log.description}</p>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
