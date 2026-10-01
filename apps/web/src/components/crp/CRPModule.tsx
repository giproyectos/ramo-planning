import React, { useState } from 'react';
import { WorkCenterCRP, WorkCenterLoadPeriod } from '../../types/demand';
import {
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Zap,
} from 'lucide-react';
import { useTranslation } from '../../i18n/i18n';

interface CRPModuleProps {
  workCenters: WorkCenterCRP[];
  onUpdateWorkCenters: (updated: WorkCenterCRP[]) => void;
  onPromoteToMRP: () => void;
}

export const CRPModule: React.FC<CRPModuleProps> = ({
  workCenters,
  onUpdateWorkCenters,
  onPromoteToMRP,
}) => {
  const { t } = useTranslation();
  const [selectedCenterId, setSelectedCenterId] = useState<string>(workCenters[0]?.workCenter.id || 'wc-101');
  const [mitigationLog, setMitigationLog] = useState<string | null>(null);

  const currentCenterCRP =
    workCenters.find((w) => w.workCenter.id === selectedCenterId) || workCenters[0];
  const { workCenter, loadByWeek } = currentCenterCRP;

  const bottleneckWeeks = loadByWeek.filter((l) => l.utilizationPct > 100);

  const handleApplyOvertime = () => {
    const updated = workCenters.map((wcItem) => {
      if (wcItem.workCenter.id === selectedCenterId) {
        const overtimeHours = 16;
        const newEffectiveCap = (wcItem.workCenter.standardWeeklyHours + overtimeHours) * wcItem.workCenter.efficiencyRating;
        const newLoads = wcItem.loadByWeek.map((period) => {
          const util = (period.mpsPlannedLoadHours / newEffectiveCap) * 100;
          return {
            ...period,
            effectiveCapacityHours: Math.round(newEffectiveCap * 10) / 10,
            utilizationPct: Math.round(util * 10) / 10,
            status: (util > 110 ? 'Critical' : util > 100 ? 'Overload' : 'Normal') as WorkCenterLoadPeriod['status'],
          };
        });

        return {
          ...wcItem,
          workCenter: {
            ...wcItem.workCenter,
            currentOvertimeAuthorized: overtimeHours,
          },
          loadByWeek: newLoads,
          mitigationStrategy: 'Overtime Added' as const,
        };
      }
      return wcItem;
    });

    onUpdateWorkCenters(updated);
    setMitigationLog(t('crp.overtimeNotice', { name: workCenter.name }));
    setTimeout(() => setMitigationLog(null), 5000);
  };

  const handleApplyRerouting = () => {
    const updated = workCenters.map((wcItem) => {
      if (wcItem.workCenter.id === selectedCenterId) {
        const newLoads = wcItem.loadByWeek.map((period) => {
          if (period.utilizationPct > 100) {
            const relievedLoad = Math.max(120, period.mpsPlannedLoadHours - 24);
            const util = (relievedLoad / period.effectiveCapacityHours) * 100;
            return {
              ...period,
              mpsPlannedLoadHours: relievedLoad,
              runHours: relievedLoad - period.setupHours,
              utilizationPct: Math.round(util * 10) / 10,
              status: (util > 100 ? 'Overload' : 'Normal') as WorkCenterLoadPeriod['status'],
            };
          }
          return period;
        });

        return {
          ...wcItem,
          loadByWeek: newLoads,
          mitigationStrategy: 'Alternate Route' as const,
        };
      }
      return wcItem;
    });

    onUpdateWorkCenters(updated);
    setMitigationLog(t('crp.reroutingNotice'));
    setTimeout(() => setMitigationLog(null), 5000);
  };

  return (
    <div className="space-y-5">
      {/* Sleek Stage Header Banner */}
      <div className="glass-panel rounded-3xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
            <span className="w-2 h-2 rounded-full bg-[#FFA27D]"></span>
            <span className="text-black font-extrabold">{t('crp.stage')}</span>
            <span className="text-slate-300">·</span>
            <span>{t('crp.horizonLabel')}</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black tracking-tight text-slate-950 flex flex-wrap items-center gap-3">
            <span>{t('crp.title')}</span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5 font-medium">
            {t('crp.subtitle')}
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={onPromoteToMRP}
            className="px-4 py-2 text-xs font-bold text-white bg-slate-950 hover:bg-black rounded-full flex items-center gap-1.5 transition-all cursor-pointer shadow-sm active:scale-95"
          >
            <span>{t('crp.explodeMrp')}</span>
            <ArrowRight className="w-3.5 h-3.5 text-[#7AFFA1]" />
          </button>
        </div>
      </div>

      {mitigationLog && (
        <div className="bg-[#7AFFA1]/40 border border-[#7AFFA1] text-black text-xs px-5 py-2.5 rounded-full flex items-center gap-2.5 font-bold shadow-xs">
          <CheckCircle2 className="w-4 h-4 text-black shrink-0" />
          <span>{mitigationLog}</span>
        </div>
      )}

      {/* Work Center Tabs Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {workCenters.map((wcItem) => {
          const isSelected = wcItem.workCenter.id === selectedCenterId;
          const maxUtil = Math.max(...wcItem.loadByWeek.map((l) => l.utilizationPct));

          return (
            <button
              key={wcItem.workCenter.id}
              onClick={() => setSelectedCenterId(wcItem.workCenter.id)}
              className={`p-4 rounded-2xl border text-left transition-all cursor-pointer ${
                isSelected
                  ? 'glass-card border-black ring-2 ring-black/10 shadow-md'
                  : 'glass-card hover:bg-white/80 border-white/80'
              }`}
            >
              <div className="flex items-center justify-between text-xs">
                <span className="font-mono font-extrabold text-black">
                  {wcItem.workCenter.code}
                </span>
                <span
                  className={`font-mono text-[9px] font-black px-2 py-0.5 rounded-full shadow-2xs ${
                    maxUtil > 110
                      ? 'bg-[#FFA27D] text-black'
                      : maxUtil > 100
                      ? 'bg-[#FFF87C] text-black'
                      : 'bg-[#7AFFA1] text-black'
                  }`}
                >
                  {maxUtil}% {t('crp.tabs.max')}
                </span>
              </div>

              <div className="text-sm font-black text-slate-900 mt-1.5 truncate">
                {wcItem.workCenter.name}
              </div>
              <div className="text-[11px] text-slate-500 font-medium truncate mt-0.5">
                {wcItem.workCenter.department} · {wcItem.workCenter.standardWeeklyHours}h {t('crp.tabs.std')}
              </div>

              <div className="mt-2.5 pt-2 border-t border-black/5 flex items-center justify-between text-[11px]">
                <span className="text-slate-500">{t('crp.tabs.status')}</span>
                <span
                  className={`font-bold ${
                    maxUtil > 100 ? 'text-[#FFA27D]' : 'text-emerald-800'
                  }`}
                >
                  {maxUtil > 100 ? t('crp.status.Bottleneck') : t('crp.status.Feasible')}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Selected Work Center Detail & Actions */}
      <div className="glass-panel rounded-3xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
            <span>{t('crp.focus.label')}</span>
            <span className="font-mono text-black font-extrabold">{workCenter.code}</span>
            <span className="text-slate-300">·</span>
            <span className="text-black font-semibold">{workCenter.name}</span>
          </div>

          <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-600 font-medium flex-wrap">
            <span>{t('crp.focus.standardCap')} <strong className="text-black font-mono">{workCenter.standardWeeklyHours} {t('crp.focus.hrsPerWk')}</strong></span>
            <span className="text-slate-300">·</span>
            <span>{t('crp.focus.overtime')} <strong className="text-black font-mono">+{workCenter.currentOvertimeAuthorized} {t('crp.focus.hrs')}</strong></span>
            <span className="text-slate-300">·</span>
            <span>{t('crp.focus.efficiency')} <strong className="text-black font-mono">{(workCenter.efficiencyRating * 100).toFixed(0)}%</strong></span>
          </div>
        </div>

        {/* Mitigation Actions */}
        <div className="flex flex-wrap items-center gap-2">
          {bottleneckWeeks.length > 0 && (
            <div className="flex items-center gap-1.5 text-xs font-bold text-black bg-[#FFA27D]/35 px-3 py-1.5 rounded-full border border-[#FFA27D]/50">
              <AlertTriangle className="w-3.5 h-3.5 text-black" />
              <span>{t('crp.actions.overloadWeeks', { count: bottleneckWeeks.length })}</span>
            </div>
          )}

          <button
            onClick={handleApplyOvertime}
            className="px-3.5 py-1.5 text-xs font-bold text-black bg-[#FFF87C] hover:opacity-90 rounded-full flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs"
          >
            <Clock className="w-3.5 h-3.5" />
            <span>{t('crp.actions.addOvertime')}</span>
          </button>

          <button
            onClick={handleApplyRerouting}
            className="px-3.5 py-1.5 text-xs font-bold text-black glass-pill hover:bg-white rounded-full flex items-center gap-1.5 transition-all cursor-pointer"
          >
            <Zap className="w-3.5 h-3.5" />
            <span>{t('crp.actions.alternateRouting')}</span>
          </button>
        </div>
      </div>

      {/* Capacity Load Profile Chart & Finite Ledger */}
      <div className="glass-panel rounded-3xl overflow-hidden">
        <div className="px-5 py-4 border-b border-black/5 flex items-center justify-between">
          <div>
            <h3 className="text-base font-extrabold text-black">
              {t('crp.chart.title')}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5 font-medium">
              {t('crp.chart.subtitle')}
            </p>
          </div>
          <span className="text-xs font-mono font-bold text-slate-500">
            {t('crp.chart.efficiencyRating')} {(workCenter.efficiencyRating * 100).toFixed(0)}%
          </span>
        </div>

        {/* Chart View */}
        <div className="p-5 border-b border-black/5">
          <div className="grid grid-cols-4 sm:grid-cols-8 gap-3">
            {loadByWeek.map((period) => {
              const maxScale = 200;
              const loadHeight = Math.min(100, (period.mpsPlannedLoadHours / maxScale) * 100);
              const capHeight = Math.min(100, (period.effectiveCapacityHours / maxScale) * 100);
              const isOver = period.utilizationPct > 100;

              return (
                <div key={period.week} className="flex flex-col items-center">
                  <div className="h-40 w-full flex items-end justify-center gap-1.5 bg-white/40 border border-white/60 rounded-2xl p-2 relative">
                    {/* Capacity line reference */}
                    <div
                      style={{ bottom: `${capHeight}%` }}
                      className="absolute left-1 right-1 border-b-2 border-dashed border-slate-400 z-10 pointer-events-none"
                      title={t('crp.chart.tooltipEffectiveCapacity', { hours: period.effectiveCapacityHours })}
                    ></div>

                    {/* Capacity Bar */}
                    <div
                      style={{ height: `${capHeight}%` }}
                      className="w-4 bg-slate-200/80 rounded-t-lg transition-all"
                      title={t('crp.chart.tooltipCapacity', { hours: period.effectiveCapacityHours })}
                    ></div>

                    {/* Load Bar */}
                    <div
                      style={{ height: `${loadHeight}%` }}
                      className={`w-4 rounded-t-lg transition-all ${
                        isOver ? 'bg-[#FFA27D]' : 'bg-[#7AFFA1]'
                      }`}
                      title={t('crp.chart.tooltipLoad', { hours: period.mpsPlannedLoadHours, pct: period.utilizationPct })}
                    ></div>
                  </div>

                  <span className="text-xs font-bold text-black mt-2">
                    {period.week}
                  </span>
                  <span
                    className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-full mt-1 ${
                      isOver ? 'bg-[#FFA27D] text-black font-extrabold' : 'text-slate-600'
                    }`}
                  >
                    {period.utilizationPct}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Tabular Ledger */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-white/30 text-slate-400 font-mono text-[11px] uppercase border-b border-black/5">
              <tr>
                <th className="py-2.5 px-5 font-bold min-w-[220px]">{t('crp.table.column')}</th>
                {loadByWeek.map((l) => (
                  <th key={l.week} className="py-2.5 px-4 text-right font-bold min-w-[85px]">{l.week}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5 text-slate-700">
              <tr className="hover:bg-white/50 transition-colors">
                <td className="py-2.5 px-5 font-medium text-slate-600">{t('crp.table.setupHours')}</td>
                {loadByWeek.map((l) => (
                  <td key={l.week} className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-500">
                    {l.setupHours}h
                  </td>
                ))}
              </tr>

              <tr className="hover:bg-white/50 transition-colors">
                <td className="py-2.5 px-5 font-medium text-slate-600">{t('crp.table.runHours')}</td>
                {loadByWeek.map((l) => (
                  <td key={l.week} className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-500">
                    {l.runHours}h
                  </td>
                ))}
              </tr>

              <tr className="hover:bg-white/50 transition-colors bg-white/20">
                <td className="py-2.5 px-5 font-bold text-black">
                  {t('crp.table.totalLoad')}
                </td>
                {loadByWeek.map((l) => (
                  <td key={l.week} className="py-2.5 px-4 text-right font-mono tabular-nums font-bold text-black">
                    {l.mpsPlannedLoadHours}h
                  </td>
                ))}
              </tr>

              <tr className="hover:bg-white/50 transition-colors">
                <td className="py-2.5 px-5 font-medium text-slate-600">{t('crp.table.effectiveCapacity')}</td>
                {loadByWeek.map((l) => (
                  <td key={l.week} className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-600 font-semibold">
                    {l.effectiveCapacityHours}h
                  </td>
                ))}
              </tr>

              <tr className="bg-[#fffde3]/40 font-bold hover:bg-[#fffde3]/60 transition-colors">
                <td className="py-3 px-5 text-black">
                  <div className="flex items-center justify-between gap-2">
                    <span>{t('crp.table.utilizationPct')}</span>
                    <span className="text-[9px] bg-[#FFF87C] text-black px-2 py-0.5 rounded-full shadow-2xs font-extrabold shrink-0">
                      {t('crp.table.target')}
                    </span>
                  </div>
                </td>
                {loadByWeek.map((l) => (
                  <td
                    key={l.week}
                    className="py-3 px-4 text-right font-mono tabular-nums font-black"
                  >
                    <span
                      className={`px-2 py-0.5 rounded-full shadow-2xs ${
                        l.utilizationPct > 100
                          ? 'bg-[#FFA27D] text-black font-extrabold'
                          : 'text-slate-800'
                      }`}
                    >
                      {l.utilizationPct}%
                    </span>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
