/**
 * Dashboard panels for expiry alerts, low-stock alerts, and shopping list export.
 * (Review items 3, 5)
 */
import React from "react";
import { AlertTriangle, ShoppingCart, Clock, TrendingDown, Download } from "lucide-react";
import { Sample } from "../types.js";
import {
  getExpiringSamples,
  getExpiryStatus,
  getExpiryBadgeClass,
  getExpiryLabel,
  getDaysUntilExpiry,
  getLowStockSamples,
  generateShoppingListCSV,
} from "../labUtils.js";

interface DashboardPanelsProps {
  samples: Sample[];
  onSelectSample: (sampleId: string) => void;
}

export default function DashboardPanels({ samples, onSelectSample }: DashboardPanelsProps) {
  const expiringSamples = getExpiringSamples(samples);
  const lowStockSamples = getLowStockSamples(samples);

  const expiredCount = expiringSamples.filter(s => getExpiryStatus(s) === "expired").length;
  const criticalCount = expiringSamples.filter(s => getExpiryStatus(s) === "critical").length;
  const warningCount = expiringSamples.filter(s => getExpiryStatus(s) === "warning").length;
  const soonCount = expiringSamples.filter(s => getExpiryStatus(s) === "soon").length;

  const handleExportShoppingList = () => {
    const csv = generateShoppingListCSV(samples);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `shopping-list-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Don't render panels if there's nothing to show
  if (expiringSamples.length === 0 && lowStockSamples.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4 mb-6">
      {/* Expiring Soon Panel */}
      {expiringSamples.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50/50">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-amber-500" />
              <h3 className="text-sm font-bold text-slate-800">Expiring Soon</h3>
              <div className="flex gap-1.5 ml-2">
                {expiredCount > 0 && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700">{expiredCount} Expired</span>
                )}
                {criticalCount > 0 && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-50 text-red-600">{criticalCount} &lt;30d</span>
                )}
                {warningCount > 0 && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700">{warningCount} &lt;60d</span>
                )}
                {soonCount > 0 && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-yellow-50 text-yellow-700">{soonCount} &lt;90d</span>
                )}
              </div>
            </div>
          </div>
          <div className="max-h-48 overflow-y-auto">
            {expiringSamples.slice(0, 20).map(sample => {
              const status = getExpiryStatus(sample);
              const days = getDaysUntilExpiry(sample);
              return (
                <div
                  key={sample.id}
                  onClick={() => onSelectSample(sample.id)}
                  className="flex items-center justify-between px-4 py-2 hover:bg-slate-50 cursor-pointer border-b border-slate-50 last:border-0"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${getExpiryBadgeClass(status)}`}>
                      {getExpiryLabel(status)}
                    </span>
                    <span className="text-xs font-semibold text-slate-700 truncate">{sample.chemicalName}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] text-slate-400">
                      {sample.expiresOn ? new Date(sample.expiresOn).toLocaleDateString() : "—"}
                    </span>
                    <span className="text-[10px] font-medium text-slate-500">
                      {days !== null && days < 0 ? `${Math.abs(days)}d ago` : days !== null ? `${days}d left` : ""}
                    </span>
                  </div>
                </div>
              );
            })}
            {expiringSamples.length > 20 && (
              <div className="px-4 py-2 text-[10px] text-slate-400 italic text-center">
                +{expiringSamples.length - 20} more expiring items...
              </div>
            )}
          </div>
        </div>
      )}

      {/* Low Stock Panel */}
      {lowStockSamples.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50/50">
            <div className="flex items-center gap-2">
              <TrendingDown className="h-4 w-4 text-orange-500" />
              <h3 className="text-sm font-bold text-slate-800">Low Stock Alerts</h3>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700">
                {lowStockSamples.length} items
              </span>
            </div>
            <button
              onClick={handleExportShoppingList}
              className="flex items-center gap-1 text-[10px] font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-2 py-1 rounded-lg border border-indigo-200 transition-colors cursor-pointer"
            >
              <Download className="h-3 w-3" />
              Export Shopping List
            </button>
          </div>
          <div className="max-h-48 overflow-y-auto">
            {lowStockSamples.slice(0, 20).map(sample => (
              <div
                key={sample.id}
                onClick={() => onSelectSample(sample.id)}
                className="flex items-center justify-between px-4 py-2 hover:bg-slate-50 cursor-pointer border-b border-slate-50 last:border-0"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <ShoppingCart className="h-3 w-3 text-orange-400 shrink-0" />
                  <span className="text-xs font-semibold text-slate-700 truncate">{sample.chemicalName}</span>
                  {sample.catalogNum && (
                    <span className="text-[10px] text-slate-400 font-mono">#{sample.catalogNum}</span>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0 text-[10px]">
                  <span className="text-orange-600 font-bold">
                    {sample.qty} / {sample.minStockLevel} {sample.units}
                  </span>
                  {sample.reorderQty && (
                    <span className="text-slate-400">Reorder: {sample.reorderQty}</span>
                  )}
                </div>
              </div>
            ))}
            {lowStockSamples.length > 20 && (
              <div className="px-4 py-2 text-[10px] text-slate-400 italic text-center">
                +{lowStockSamples.length - 20} more low-stock items...
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
