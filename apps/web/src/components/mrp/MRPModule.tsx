import React, { useState } from 'react';
import { MRPRecord, MRPActionMessage } from '../../types/demand';
import {
  Boxes,
  CheckCircle2,
  AlertTriangle,
  Send,
  Building2,
  Clock,
  GitBranch,
  X,
} from 'lucide-react';
import { useTranslation } from '../../i18n/i18n';

interface MRPModuleProps {
  records: MRPRecord[];
  actionMessages: MRPActionMessage[];
  onExecuteAction: (actionId: string) => void;
  onExecuteAllActions: () => void;
}

export const MRPModule: React.FC<MRPModuleProps> = ({
  records,
  actionMessages,
  onExecuteAction,
  onExecuteAllActions,
}) => {
  const { t } = useTranslation();
  const [selectedPartId, setSelectedPartId] = useState<string>('all');
  const [activeTab, setActiveTab] = useState<'matrix' | 'actions' | 'bom_tree'>('matrix');
  const [peggedModalItem, setPeggedModalItem] = useState<{
    part: string;
    week: string;
    parentSku: string;
    parentLot: number;
    customerOrderRef: string;
  } | null>(null);

  const filteredRecords =
    selectedPartId === 'all'
      ? records
      : records.filter((r) => r.component.id === selectedPartId);

  const pendingActions = actionMessages.filter((a) => !a.executed);

  return (
    <div className="space-y-5">
      {/* Sleek Stage Header Banner */}
      <div className="glass-panel rounded-3xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
            <span className="w-2 h-2 rounded-full bg-[#DDCBF5]"></span>
            <span className="text-black font-extrabold">{t('mrp.stage')}</span>
            <span className="text-slate-300">·</span>
            <span>{t('mrp.horizonLabel')}</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black tracking-tight text-slate-950 flex flex-wrap items-center gap-3">
            <span>{t('mrp.title')}</span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5 font-medium">
            {t('mrp.subtitle')}
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          {pendingActions.length > 0 && (
            <button
              onClick={onExecuteAllActions}
              className="px-4 py-2 text-xs font-bold text-white bg-slate-950 hover:bg-black rounded-full flex items-center gap-1.5 transition-all cursor-pointer shadow-sm active:scale-95"
            >
              <Send className="w-3.5 h-3.5 text-[#7AFFA1]" />
              <span>{t('mrp.transmitAllPos', { count: pendingActions.length })}</span>
            </button>
          )}
        </div>
      </div>

      {/* Tab Switcher & Part Filter Bar */}
      <div className="glass-panel rounded-3xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center glass-pill p-1 rounded-full">
          <button
            onClick={() => setActiveTab('matrix')}
            className={`px-3.5 py-1 text-xs font-bold rounded-full transition-all cursor-pointer ${
              activeTab === 'matrix'
                ? 'bg-slate-950 text-white shadow-xs'
                : 'text-slate-600 hover:text-black'
            }`}
          >
            {t('mrp.tabs.matrix')}
          </button>
          <button
            onClick={() => setActiveTab('actions')}
            className={`px-3.5 py-1 text-xs font-bold rounded-full transition-all flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'actions'
                ? 'bg-slate-950 text-white shadow-xs'
                : 'text-slate-600 hover:text-black'
            }`}
          >
            <span>{t('mrp.tabs.actions')}</span>
            {pendingActions.length > 0 && (
              <span className="text-[9px] font-mono font-bold bg-[#FFA27D] text-black px-1.5 py-0.5 rounded-full shadow-2xs">
                {pendingActions.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('bom_tree')}
            className={`px-3.5 py-1 text-xs font-bold rounded-full transition-all cursor-pointer ${
              activeTab === 'bom_tree'
                ? 'bg-slate-950 text-white shadow-xs'
                : 'text-slate-600 hover:text-black'
            }`}
          >
            {t('mrp.tabs.bomTree')}
          </button>
        </div>

        {activeTab === 'matrix' && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-500 font-bold">{t('mrp.filterPart')}</span>
            <select
              value={selectedPartId}
              onChange={(e) => setSelectedPartId(e.target.value)}
              className="bg-white/80 border border-slate-200 text-slate-800 font-semibold rounded-full px-3 py-1 text-xs focus:outline-none glass-pill cursor-pointer"
            >
              <option value="all">{t('mrp.allExplodedParts', { count: records.length })}</option>
              {records.map((r) => (
                <option key={r.component.id} value={r.component.id}>
                  {r.component.partNumber} · {r.component.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Tab 1: Time-Phased Matrix */}
      {activeTab === 'matrix' && (
        <div className="space-y-4">
          {filteredRecords.map((record) => {
            const { component, periods } = record;

            return (
              <div
                key={component.id}
                className="glass-panel rounded-3xl overflow-hidden border border-white/80 shadow-xs"
              >
                {/* Component Specs Ribbon */}
                <div className="px-5 py-3.5 border-b border-black/5 flex flex-col md:flex-row md:items-center justify-between gap-3 bg-white/40">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs font-black text-black">
                        {component.partNumber}
                      </span>
                      <span className="text-slate-300">·</span>
                      <span className="text-xs font-black text-slate-900 truncate">
                        {component.name}
                      </span>
                      <span className="text-[9px] font-mono font-bold bg-[#DDCBF5] text-black px-2 py-0.5 rounded-full">
                        {t('mrp.table.level', { level: component.level })}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 text-[11px] text-slate-500 mt-0.5 flex-wrap">
                      <span className="flex items-center gap-1">
                        <Building2 className="w-3 h-3 text-slate-400" />
                        <span>{t('mrp.table.supplierLabel')} <strong className="text-black font-semibold">{component.supplier}</strong> ({component.supplierReliabilityPct}%)</span>
                      </span>
                      <span className="text-slate-300">·</span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3 text-slate-400" />
                        <span>{t('mrp.table.leadTimeLabel')} <strong className="text-black font-mono font-bold">{component.leadTimeWeeks}w</strong></span>
                      </span>
                      <span className="text-slate-300">·</span>
                      <span>{t('mrp.table.lotLabel')} <strong className="text-black font-semibold">{component.lotSizingRule} ({component.lotSizeQty} {component.unit})</strong></span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 text-xs text-slate-500 shrink-0 font-medium flex-wrap">
                    <div>
                      <span>{t('mrp.table.stockLabel')} </span>
                      <strong className="text-black font-mono font-bold">{component.currentStock} {component.unit}</strong>
                    </div>
                    <span className="text-slate-200">|</span>
                    <div>
                      <span>{t('mrp.table.safetyLabel')} </span>
                      <strong className="text-black font-mono font-bold">{component.safetyStock} {component.unit}</strong>
                    </div>
                    <span className="text-slate-200">|</span>
                    <div>
                      <span>{t('mrp.table.costLabel')} </span>
                      <strong className="text-black font-mono font-bold">${component.standardCostUSD}</strong>
                    </div>
                  </div>
                </div>

                {/* Grid */}
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-white/30 text-slate-400 font-mono text-[11px] uppercase border-b border-black/5">
                      <tr>
                        <th className="py-2.5 px-5 font-bold min-w-[220px]">
                          {t('mrp.table.element')}
                        </th>
                        {periods.map((p) => (
                          <th key={p.week} className="py-2.5 px-4 text-right font-bold min-w-[85px]">
                            {p.week}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black/5 text-slate-700">
                      {/* Gross Requirements */}
                      <tr className="hover:bg-white/50 transition-colors">
                        <td className="py-2.5 px-5 font-bold text-black min-w-[220px]">
                          <div className="flex items-center justify-between gap-2">
                            <span>{t('mrp.table.grossRequirements')}</span>
                            <span className="text-[10px] text-slate-400 font-sans font-normal shrink-0">{t('mrp.table.clickTrace')}</span>
                          </div>
                        </td>
                        {periods.map((p) => (
                          <td
                            key={p.week}
                            onClick={() =>
                              setPeggedModalItem({
                                part: `${component.partNumber} - ${component.name}`,
                                week: p.week,
                                parentSku: 'Servo Drive Pro S-120 (SD-120P)',
                                parentLot: p.grossRequirements / component.quantityPerParent,
                                customerOrderRef: 'CO-9842 (ABB Robotics Automation)',
                              })
                            }
                            className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-800 hover:text-black font-semibold cursor-pointer hover:underline"
                            title={t('mrp.table.clickTraceTitle')}
                          >
                            {p.grossRequirements}
                          </td>
                        ))}
                      </tr>

                      {/* Scheduled Receipts */}
                      <tr className="hover:bg-white/50 transition-colors">
                        <td className="py-2.5 px-5 font-medium text-slate-600">
                          {t('mrp.table.scheduledReceipts')}
                        </td>
                        {periods.map((p) => (
                          <td key={p.week} className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-500">
                            {p.scheduledReceipts}
                          </td>
                        ))}
                      </tr>

                      {/* Projected On Hand */}
                      <tr className="hover:bg-white/50 transition-colors bg-white/20">
                        <td className="py-2.5 px-5 font-bold text-black">
                          {t('mrp.table.projectedOnHand')}
                        </td>
                        {periods.map((p) => (
                          <td
                            key={p.week}
                            className={`py-2.5 px-4 text-right font-mono tabular-nums font-bold ${
                              p.projectedOnHand < component.safetyStock
                                ? 'text-[#FFA27D] font-extrabold'
                                : 'text-slate-900'
                            }`}
                          >
                            {p.projectedOnHand}
                          </td>
                        ))}
                      </tr>

                      {/* Net Requirements */}
                      <tr className="hover:bg-white/50 transition-colors">
                        <td className="py-2.5 px-5 font-medium text-slate-600">
                          {t('mrp.table.netRequirements')}
                        </td>
                        {periods.map((p) => (
                          <td
                            key={p.week}
                            className={`py-2.5 px-4 text-right font-mono tabular-nums ${
                              p.netRequirements > 0 ? 'text-[#FFA27D] font-bold' : 'text-slate-400'
                            }`}
                          >
                            {p.netRequirements}
                          </td>
                        ))}
                      </tr>

                      {/* Planned Order Receipts */}
                      <tr className="hover:bg-white/50 transition-colors">
                        <td className="py-2.5 px-5 font-medium text-slate-600">
                          {t('mrp.table.plannedOrderReceipts')}
                        </td>
                        {periods.map((p) => (
                          <td key={p.week} className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-700">
                            {p.plannedOrderReceipts > 0 ? p.plannedOrderReceipts : '-'}
                          </td>
                        ))}
                      </tr>

                      {/* Planned Order Releases */}
                      <tr className="hover:bg-white/50 transition-colors bg-[#dbfced]/30 font-bold">
                        <td className="py-3 px-5 text-black min-w-[220px]">
                          <div className="flex items-center justify-between gap-2">
                            <span>{t('mrp.table.plannedOrderReleases', { weeks: component.leadTimeWeeks })}</span>
                            <span className="text-[9px] bg-[#7AFFA1] text-black px-2 py-0.5 rounded-full shadow-2xs font-extrabold shrink-0">
                              {t('mrp.table.poTrigger')}
                            </span>
                          </div>
                        </td>
                        {periods.map((p) => (
                          <td
                            key={p.week}
                            className="py-3 px-4 text-right font-mono tabular-nums text-black font-extrabold"
                          >
                            {p.plannedOrderReleases > 0 ? (
                              <span className="bg-[#7AFFA1] text-black px-2 py-0.5 rounded-full shadow-2xs">
                                {p.plannedOrderReleases}
                              </span>
                            ) : (
                              <span className="text-slate-300">-</span>
                            )}
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Tab 2: Action Orders & Exceptions */}
      {activeTab === 'actions' && (
        <div className="glass-panel rounded-3xl p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-black text-black">
                {t('mrp.actions.title')}
              </h3>
              <p className="text-xs text-slate-500 font-medium mt-0.5">
                {t('mrp.actions.subtitle')}
              </p>
            </div>
            {pendingActions.length > 0 && (
              <button
                onClick={onExecuteAllActions}
                className="px-4 py-1.5 text-xs font-bold text-white bg-slate-950 hover:bg-black rounded-full flex items-center gap-1.5 cursor-pointer shadow-xs active:scale-95 transition-all self-start sm:self-auto"
              >
                <Send className="w-3 h-3 text-[#7AFFA1]" />
                <span>{t('mrp.actions.executeAll', { count: pendingActions.length })}</span>
              </button>
            )}
          </div>

          <div className="space-y-2.5">
            {actionMessages.map((msg) => (
              <div
                key={msg.id}
                className={`p-3.5 rounded-2xl border transition-all flex flex-col md:flex-row md:items-center justify-between gap-3 ${
                  msg.executed
                    ? 'bg-slate-50/70 border-slate-200 opacity-60'
                    : 'glass-card border-white/90 hover:bg-white/90'
                }`}
              >
                <div className="flex items-start gap-3 min-w-0">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                      msg.executed
                        ? 'bg-slate-200 text-slate-600'
                        : msg.urgency === 'High'
                        ? 'bg-[#FFA27D] text-black shadow-xs'
                        : msg.urgency === 'Medium'
                        ? 'bg-[#FFF87C] text-black shadow-xs'
                        : 'bg-[#7AFFA1] text-black shadow-xs'
                    }`}
                  >
                    {msg.executed ? (
                      <CheckCircle2 className="w-4 h-4" />
                    ) : (
                      <AlertTriangle className="w-4 h-4" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-black text-black">
                        {msg.partNumber}
                      </span>
                      <span className="text-slate-300">·</span>
                      <span
                        className={`text-[9px] font-bold px-2 py-0.5 rounded-full shrink-0 ${
                          msg.type === 'Release Order'
                            ? 'bg-[#7AFFA1] text-black'
                            : msg.type === 'Expedite'
                            ? 'bg-[#FFA27D] text-black'
                            : 'bg-slate-200 text-slate-800'
                        }`}
                      >
                        {t(`mrp.badges.type.${msg.type}`).toUpperCase()}
                      </span>
                      <span className="text-slate-400 text-xs font-semibold">
                        {t('mrp.actions.due', { week: msg.weekRequired })}
                      </span>
                    </div>

                    <div className="text-xs font-black text-black mt-1 truncate">
                      {t('mrp.actions.summaryLine', {
                        type: t(`mrp.badges.type.${msg.type}`),
                        quantity: msg.quantity.toLocaleString(),
                        supplier: msg.supplier,
                      })}
                    </div>
                    <div className="text-xs text-slate-600 font-medium mt-0.5">
                      {t(`mrp.actionReasons.${msg.id}`)}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {msg.executed ? (
                    <span className="text-xs font-bold text-slate-500 bg-white/80 px-3 py-1 rounded-full border border-slate-200">
                      {t('mrp.actions.transmitted')}
                    </span>
                  ) : (
                    <button
                      onClick={() => onExecuteAction(msg.id)}
                      className="px-4 py-1.5 text-xs font-bold text-white bg-slate-950 hover:bg-black rounded-full flex items-center gap-1.5 cursor-pointer shadow-xs active:scale-95 transition-all"
                    >
                      <Send className="w-3 h-3 text-[#7AFFA1]" />
                      <span>{t('mrp.actions.executeTransmit')}</span>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab 3: Multi-Level BOM Hierarchy */}
      {activeTab === 'bom_tree' && (
        <div className="glass-panel rounded-3xl p-5 space-y-4">
          <div>
            <h3 className="text-base font-black text-black">
              {t('mrp.bomTree.title')}
            </h3>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              {t('mrp.bomTree.subtitle')}
            </p>
          </div>

          <div className="space-y-3 font-mono text-xs">
            {/* Level 0 Finished Good */}
            <div className="p-3.5 rounded-2xl bg-slate-950 text-white flex items-center justify-between shadow-xs">
              <div className="flex items-center gap-2.5">
                <span className="px-2 py-0.5 text-[9px] font-black rounded-full bg-[#7AFFA1] text-black">
                  {t('mrp.bomTree.level0')}
                </span>
                <span className="font-bold">{t('mrp.bomTree.finishedGoodLabel')}</span>
              </div>
              <span className="text-slate-300 font-semibold">{t('mrp.bomTree.costPerUnit')}</span>
            </div>

            {/* Level 1 Components */}
            <div className="pl-5 space-y-2">
              {records.map((rec) => {
                const c = rec.component;
                return (
                  <div
                    key={c.id}
                    className="p-3 rounded-2xl border border-white/80 glass-card flex items-center justify-between shadow-2xs"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="px-2 py-0.5 text-[9px] font-bold rounded-full bg-[#DDCBF5] text-black">
                        L{c.level}
                      </span>
                      <div>
                        <div className="font-black text-black">
                          {c.partNumber} · {c.name}
                        </div>
                        <div className="text-[11px] text-slate-500 font-sans font-medium mt-0.5">
                          {t('mrp.bomTree.qtyPerParent')} <strong className="text-black">{c.quantityPerParent}</strong> · {t('mrp.bomTree.leadTime')} <strong className="text-black">{c.leadTimeWeeks}w</strong> · {t('mrp.bomTree.vendor')} <strong className="text-black">{c.supplier}</strong>
                        </div>
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="font-mono font-bold text-black">
                        ${c.standardCostUSD}
                      </div>
                      <div className="text-[10px] text-slate-400 font-sans font-medium">
                        {t('mrp.bomTree.standardCost')}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Upward Pegged Demand Modal */}
      {peggedModalItem && (
        <div className="fixed inset-0 z-50 bg-black/35 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass-panel rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-black/5">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-[#DDCBF5] flex items-center justify-center text-black font-bold">
                  <GitBranch className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-black text-black">{t('mrp.modal.title')}</h3>
              </div>
              <button
                onClick={() => setPeggedModalItem(null)}
                className="w-7 h-7 rounded-full bg-white/80 hover:bg-white flex items-center justify-center text-slate-700 transition-colors cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <p className="text-xs text-slate-600 font-medium">
              {t('mrp.modal.description')}
            </p>

            <div className="space-y-2 text-xs bg-white/60 p-4 rounded-2xl border border-white/70">
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">{t('mrp.modal.component')}</span>
                <span className="font-bold text-black">{peggedModalItem.part}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">{t('mrp.modal.scheduleWeek')}</span>
                <span className="font-mono font-bold text-black">{peggedModalItem.week}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">{t('mrp.modal.parentAssembly')}</span>
                <span className="font-bold text-black">{peggedModalItem.parentSku}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">{t('mrp.modal.parentBatchSize')}</span>
                <span className="font-mono font-bold text-black">{peggedModalItem.parentLot} {t('mrp.modal.assemblies')}</span>
              </div>
              <div className="flex justify-between pt-2 border-t border-black/5">
                <span className="text-slate-500 font-medium">{t('mrp.modal.customerOrderRef')}</span>
                <span className="font-mono font-black text-black">{peggedModalItem.customerOrderRef}</span>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setPeggedModalItem(null)}
                className="px-5 py-2 text-xs font-bold text-white bg-slate-950 hover:bg-black rounded-full cursor-pointer shadow-xs active:scale-95 transition-all"
              >
                {t('mrp.modal.closeTrace')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
