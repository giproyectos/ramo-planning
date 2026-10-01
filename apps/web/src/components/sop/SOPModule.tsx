import React, { useState } from 'react';
import { ProductFamily, SOPFamilyPlan, SOPPeriodData } from '../../types/demand';
import {
  ArrowRight,
  TrendingUp,
  AlertTriangle,
  DollarSign,
  Layers,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  Lock,
  Unlock,
  Sparkles,
  BarChart2,
} from 'lucide-react';
import { useTranslation } from '../../i18n/i18n';

interface SOPModuleProps {
  families: ProductFamily[];
  plans: Record<string, SOPFamilyPlan>;
  onUpdatePlan: (familyId: string, updatedPlan: SOPFamilyPlan) => void;
  onPromoteToDRP: () => void;
}

export const SOPModule: React.FC<SOPModuleProps> = ({
  families,
  plans,
  onUpdatePlan,
  onPromoteToDRP,
}) => {
  const { t } = useTranslation();
  const [selectedFamilyId, setSelectedFamilyId] = useState<string>(families[0]?.id || 'fam-pmd');
  const [lastEditedCell, setLastEditedCell] = useState<string | null>(null);

  const [demandOpen, setDemandOpen] = useState(true);
  const [capacityOpen, setCapacityOpen] = useState(true);

  const currentPlan = plans[selectedFamilyId] || plans[Object.keys(plans)[0]];

  // Totals calculations
  const totalConsensus = currentPlan.periods.reduce((sum, p) => sum + p.consensusDemand, 0);
  const totalCapacity = currentPlan.periods.reduce((sum, p) => sum + p.operationsCapacity, 0);
  const totalGap = currentPlan.periods.reduce((sum, p) => sum + p.gap, 0);
  const totalRevenue = currentPlan.periods.reduce((sum, p) => sum + p.projectedRevenue, 0);
  const avgUtilization = Math.round((totalConsensus / totalCapacity) * 100);

  const handleCellChange = (periodIndex: number, field: keyof SOPPeriodData, value: number) => {
    const newPeriods = [...currentPlan.periods];
    const item = { ...newPeriods[periodIndex] };

    (item[field] as number) = value;

    if (field === 'salesForecast' || field === 'marketingUplift') {
      item.consensusDemand = item.salesForecast + item.marketingUplift;
    }
    item.gap = item.operationsCapacity - item.consensusDemand;
    item.projectedRevenue = Math.round(item.consensusDemand * 1.5);

    newPeriods[periodIndex] = item;

    setLastEditedCell(`${field}-${periodIndex}`);
    setTimeout(() => setLastEditedCell(null), 1200);

    onUpdatePlan(selectedFamilyId, {
      ...currentPlan,
      periods: newPeriods,
    });
  };

  const handleToggleStatus = () => {
    const nextStatus = currentPlan.executiveStatus === 'Approved' ? 'Draft' : 'Approved';
    onUpdatePlan(selectedFamilyId, {
      ...currentPlan,
      executiveStatus: nextStatus,
    });
  };

  const handleApplyMarketingSurge = () => {
    const newPeriods = currentPlan.periods.map((p) => {
      const uplift = p.marketingUplift + 50;
      const consensus = p.salesForecast + uplift;
      return {
        ...p,
        marketingUplift: uplift,
        consensusDemand: consensus,
        gap: p.operationsCapacity - consensus,
        projectedRevenue: Math.round(consensus * 1.5),
      };
    });

    onUpdatePlan(selectedFamilyId, {
      ...currentPlan,
      periods: newPeriods,
    });
  };

  return (
    <div className="space-y-5">
      {/* Sleek Contextual Stage Header */}
      <div className="glass-panel rounded-3xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
            <span className="w-2 h-2 rounded-full bg-[#7AFFA1]"></span>
            <span className="text-black font-extrabold">{t('sop.stage')}</span>
            <span className="text-slate-300">·</span>
            <span>{t('sop.horizonLabel')}</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black tracking-tight text-slate-950 flex flex-wrap items-center gap-2.5">
            <span>{t('sop.title')}</span>
            <span
              className={`text-[10px] font-extrabold px-2.5 py-0.5 rounded-full shrink-0 shadow-2xs ${
                currentPlan.executiveStatus === 'Approved'
                  ? 'bg-[#7AFFA1] text-black'
                  : 'bg-[#FFF87C] text-black'
              }`}
            >
              {t(`sop.status.${currentPlan.executiveStatus}`)}
            </span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5 font-medium">
            {t('sop.subtitle')}
          </p>
        </div>

        {/* Product Family Pill Selector & Actions */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1 p-1 rounded-full glass-pill">
            {families.map((fam) => (
              <button
                key={fam.id}
                onClick={() => setSelectedFamilyId(fam.id)}
                className={`px-3.5 py-1 text-xs font-bold rounded-full transition-all cursor-pointer ${
                  selectedFamilyId === fam.id
                    ? 'bg-slate-950 text-white shadow-xs'
                    : 'text-slate-600 hover:text-black'
                }`}
              >
                <span>{fam.name}</span>
                <span className="ml-1 text-[10px] opacity-70">({fam.revenueWeight}%)</span>
              </button>
            ))}
          </div>

          <button
            onClick={onPromoteToDRP}
            className="px-4 py-2 text-xs font-bold text-white bg-slate-950 hover:bg-black rounded-full flex items-center gap-1.5 transition-all cursor-pointer shadow-sm active:scale-95 shrink-0"
          >
            <span>{t('sop.promoteToDrp')}</span>
            <ArrowRight className="w-3.5 h-3.5 text-[#7AFFA1]" />
          </button>
        </div>
      </div>

      {/* KPI Cards Ribbon in clean frosted glass style */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        {/* Card 1: Demand */}
        <div className="glass-card rounded-3xl p-4.5 space-y-1.5 border border-white/80">
          <div className="flex items-center justify-between text-xs font-bold text-slate-500">
            <span>{t('sop.kpi.demand6mo')}</span>
            <div className="w-6 h-6 rounded-full bg-[#7AFFA1] flex items-center justify-center text-black shadow-2xs">
              <TrendingUp className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-black tracking-tight font-sans">
            {totalConsensus.toLocaleString()}{' '}
            <span className="text-xs font-semibold text-slate-500">{t('sop.kpi.units')}</span>
          </div>
          <div className="text-xs text-slate-500 font-medium">
            {t('sop.kpi.baseline')} <strong className="text-black font-semibold">{currentPlan.periods.reduce((s, p) => s + p.statisticalForecast, 0).toLocaleString()}</strong>
          </div>
        </div>

        {/* Card 2: Plant Capacity */}
        <div className="glass-card rounded-3xl p-4.5 space-y-1.5 border border-white/80">
          <div className="flex items-center justify-between text-xs font-bold text-slate-500">
            <span>{t('sop.kpi.factoryCeiling')}</span>
            <div className="w-6 h-6 rounded-full bg-[#DDCBF5] flex items-center justify-center text-black shadow-2xs">
              <Layers className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-black tracking-tight font-sans">
            {totalCapacity.toLocaleString()}{' '}
            <span className="text-xs font-semibold text-slate-500">{t('sop.kpi.units')}</span>
          </div>
          <div className="text-xs text-slate-500 font-medium">
            {t('sop.kpi.plantUtilization')} <strong className="text-black font-semibold">{avgUtilization}%</strong>
          </div>
        </div>

        {/* Card 3: Balance */}
        <div className="glass-card rounded-3xl p-4.5 space-y-1.5 border border-white/80">
          <div className="flex items-center justify-between text-xs font-bold text-slate-500">
            <span>{t('sop.kpi.netGapDelta')}</span>
            <div
              className={`w-6 h-6 rounded-full flex items-center justify-center text-black shadow-2xs ${
                totalGap < 0 ? 'bg-[#FFA27D]' : 'bg-[#7AFFA1]'
              }`}
            >
              {totalGap < 0 ? <AlertTriangle className="w-3.5 h-3.5" /> : <ShieldCheck className="w-3.5 h-3.5" />}
            </div>
          </div>
          <div className={`text-2xl sm:text-3xl font-black tracking-tight font-sans ${totalGap < 0 ? 'text-[#FFA27D]' : 'text-black'}`}>
            {totalGap > 0 ? `+${totalGap}` : totalGap}{' '}
            <span className="text-xs font-semibold text-slate-500">{t('sop.kpi.units')}</span>
          </div>
          <div className="text-xs text-slate-500 font-medium">
            {totalGap < 0 ? t('sop.kpi.deficit') : t('sop.kpi.surplus')}
          </div>
        </div>

        {/* Card 4: Revenue */}
        <div className="glass-card rounded-3xl p-4.5 space-y-1.5 border border-white/80">
          <div className="flex items-center justify-between text-xs font-bold text-slate-500">
            <span>{t('sop.kpi.projectedPipeline')}</span>
            <div className="w-6 h-6 rounded-full bg-[#FFF87C] flex items-center justify-center text-black shadow-2xs">
              <DollarSign className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-black tracking-tight font-sans">
            ${(totalRevenue / 1000).toFixed(2)}M
          </div>
          <div className="text-xs text-slate-500 font-medium">
            {t('sop.kpi.targetMargin')} <strong className="text-black font-semibold">{currentPlan.consensusMarginPct}%</strong>
          </div>
        </div>
      </div>

      {/* Visual Supply vs Demand Profile */}
      <div className="glass-panel rounded-3xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-extrabold text-black flex items-center gap-2">
              <BarChart2 className="w-4 h-4 text-slate-700" />
              <span>{t('sop.chart.title')}</span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {t('sop.chart.subtitle')}
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs font-semibold">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-[#7AFFA1] shadow-2xs"></span>
              <span className="text-slate-700">{t('sop.chart.consensusDemand')}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-[#DDCBF5] shadow-2xs"></span>
              <span className="text-slate-700">{t('sop.chart.factoryCeiling')}</span>
            </div>
          </div>
        </div>

        {/* Chart Bars - cleanly spaced without any floating overlapping text bubbles */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 pt-2 pb-2 border-b border-black/5">
          {currentPlan.periods.map((p) => {
            const maxVal = 2100;
            const consensusHeight = Math.min(100, (p.consensusDemand / maxVal) * 100);
            const capHeight = Math.min(100, (p.operationsCapacity / maxVal) * 100);
            const isDeficit = p.gap < 0;

            return (
              <div key={p.period} className="flex flex-col items-center">
                <div className="h-40 w-full flex items-end justify-center gap-2 bg-white/45 border border-white/60 rounded-2xl p-2 relative">
                  {/* Capacity line reference */}
                  <div
                    style={{ bottom: `${capHeight}%` }}
                    className="absolute left-1 right-1 border-b-2 border-dashed border-slate-400/40 z-10 pointer-events-none"
                    title={`Plant Capacity: ${p.operationsCapacity} units`}
                  ></div>

                  {/* Plant bar */}
                  <div
                    style={{ height: `${capHeight}%` }}
                    className="w-4.5 bg-[#DDCBF5] rounded-t-xl transition-all shadow-2xs"
                    title={`Capacity: ${p.operationsCapacity} units`}
                  ></div>

                  {/* Demand bar */}
                  <div
                    style={{ height: `${consensusHeight}%` }}
                    className={`w-4.5 rounded-t-xl transition-all shadow-2xs ${
                      isDeficit ? 'bg-[#FFA27D]' : 'bg-[#7AFFA1]'
                    }`}
                    title={`Demand: ${p.consensusDemand} units`}
                  ></div>
                </div>

                <span className="text-xs font-bold text-black mt-2">
                  {p.period}
                </span>
                <span className="text-[11px] font-mono text-slate-500 font-semibold">
                  {p.consensusDemand} / {p.operationsCapacity}
                </span>
                {isDeficit ? (
                  <span className="mt-1 text-[9px] font-mono font-bold text-black bg-[#FFA27D] px-2 py-0.5 rounded-full">
                    {p.gap} {t('sop.chart.deficit')}
                  </span>
                ) : (
                  <span className="mt-1 text-[9px] font-mono font-semibold text-emerald-900 bg-[#7AFFA1]/50 px-2 py-0.5 rounded-full">
                    +{p.gap} {t('sop.chart.surplus')}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* S&OP Detailed Spreadsheet Ledger */}
      <div className="glass-panel rounded-3xl overflow-hidden">
        <div className="px-5 py-4 border-b border-black/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-extrabold text-black">
              {t('sop.ledger.title')}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 font-medium">
              {t('sop.ledger.subtitle')}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleApplyMarketingSurge}
              className="px-3.5 py-1.5 rounded-full text-xs font-bold bg-[#FFF87C] text-black hover:opacity-90 transition-all cursor-pointer shadow-2xs flex items-center gap-1.5"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>{t('sop.ledger.campaignLift')}</span>
            </button>

            <button
              onClick={handleToggleStatus}
              className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 shadow-2xs ${
                currentPlan.executiveStatus === 'Approved'
                  ? 'bg-[#7AFFA1] text-black'
                  : 'bg-white/90 text-slate-700 hover:bg-white'
              }`}
            >
              {currentPlan.executiveStatus === 'Approved' ? (
                <>
                  <Lock className="w-3.5 h-3.5 text-black" />
                  <span>{t('sop.ledger.approved')}</span>
                </>
              ) : (
                <>
                  <Unlock className="w-3.5 h-3.5 text-slate-500" />
                  <span>{t('sop.ledger.lockConsensus')}</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Collapsible Categories Grid */}
        <div className="divide-y divide-black/5 text-xs">
          {/* Category 1: Demand Streams */}
          <div>
            <button
              onClick={() => setDemandOpen(!demandOpen)}
              className="w-full px-5 py-3 bg-white/40 hover:bg-white/60 flex items-center justify-between font-extrabold text-black cursor-pointer transition-colors"
            >
              <span className="flex items-center gap-2">
                {demandOpen ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
                <span>{t('sop.ledger.demandSection')}</span>
              </span>
              <span className="text-[11px] font-mono text-slate-500 font-semibold">
                {t('sop.ledger.total')} {totalConsensus.toLocaleString()} {t('sop.kpi.units')}
              </span>
            </button>

            {demandOpen && (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-white/30 text-slate-400 font-mono text-[11px] uppercase border-b border-black/5">
                    <tr>
                      <th className="py-2.5 px-5 font-bold min-w-[220px]">{t('sop.ledger.column')}</th>
                      {currentPlan.periods.map((p) => (
                        <th key={p.period} className="py-2.5 px-4 text-right font-bold min-w-[90px]">{p.period}</th>
                      ))}
                      <th className="py-2.5 px-5 text-right font-bold min-w-[100px]">{t('sop.ledger.total')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/5 text-slate-700">
                    <tr className="hover:bg-white/50 transition-colors">
                      <td className="py-2.5 px-5 font-medium">{t('sop.ledger.statisticalForecast')}</td>
                      {currentPlan.periods.map((p) => (
                        <td key={p.period} className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-500">
                          {p.statisticalForecast.toLocaleString()}
                        </td>
                      ))}
                      <td className="py-2.5 px-5 text-right font-mono font-bold text-slate-700">
                        {currentPlan.periods.reduce((s, p) => s + p.statisticalForecast, 0).toLocaleString()}
                      </td>
                    </tr>

                    <tr className="hover:bg-white/50 transition-colors bg-white/20">
                      <td className="py-2.5 px-5 font-bold text-black">
                        <div className="flex items-center justify-between gap-2">
                          <span>{t('sop.ledger.salesForecast')}</span>
                          <span className="text-[10px] text-slate-400 font-sans font-medium">{t('sop.ledger.editable')}</span>
                        </div>
                      </td>
                      {currentPlan.periods.map((p, idx) => (
                        <td key={p.period} className="py-2.5 px-4 text-right font-mono tabular-nums">
                          <input
                            type="number"
                            value={p.salesForecast}
                            onChange={(e) => handleCellChange(idx, 'salesForecast', parseInt(e.target.value) || 0)}
                            className={`w-18 text-right font-mono font-bold text-black bg-white/70 border border-slate-200/80 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-black ${
                              lastEditedCell === `salesForecast-${idx}` ? 'cell-updated' : ''
                            }`}
                          />
                        </td>
                      ))}
                      <td className="py-2.5 px-5 text-right font-mono font-extrabold text-black">
                        {currentPlan.periods.reduce((s, p) => s + p.salesForecast, 0).toLocaleString()}
                      </td>
                    </tr>

                    <tr className="hover:bg-white/50 transition-colors">
                      <td className="py-2.5 px-5 font-bold text-black">
                        <div className="flex items-center justify-between gap-2">
                          <span>{t('sop.ledger.marketingUplift')}</span>
                          <span className="text-[10px] text-slate-400 font-sans font-medium">{t('sop.ledger.editable')}</span>
                        </div>
                      </td>
                      {currentPlan.periods.map((p, idx) => (
                        <td key={p.period} className="py-2.5 px-4 text-right font-mono tabular-nums">
                          <input
                            type="number"
                            value={p.marketingUplift}
                            onChange={(e) => handleCellChange(idx, 'marketingUplift', parseInt(e.target.value) || 0)}
                            className="w-18 text-right font-mono font-bold text-emerald-800 bg-emerald-50/70 border border-emerald-200/80 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500"
                          />
                        </td>
                      ))}
                      <td className="py-2.5 px-5 text-right font-mono font-extrabold text-emerald-800">
                        +{currentPlan.periods.reduce((s, p) => s + p.marketingUplift, 0).toLocaleString()}
                      </td>
                    </tr>

                    <tr className="bg-[#dbfced]/30 font-bold hover:bg-[#dbfced]/40 transition-colors">
                      <td className="py-3 px-5 text-black">
                        <div className="flex items-center justify-between gap-2">
                          <span>{t('sop.ledger.consensusDemand')}</span>
                          <span className="text-[9px] bg-[#7AFFA1] text-black px-2 py-0.5 rounded-full shadow-2xs font-extrabold shrink-0">
                            {t('sop.ledger.locked')}
                          </span>
                        </div>
                      </td>
                      {currentPlan.periods.map((p) => (
                        <td key={p.period} className="py-3 px-4 text-right font-mono tabular-nums text-black font-extrabold">
                          {p.consensusDemand.toLocaleString()}
                        </td>
                      ))}
                      <td className="py-3 px-5 text-right font-mono font-black text-black">
                        {totalConsensus.toLocaleString()}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Category 2: Demonstrated Operations Capacity */}
          <div>
            <button
              onClick={() => setCapacityOpen(!capacityOpen)}
              className="w-full px-5 py-3 bg-white/40 hover:bg-white/60 flex items-center justify-between font-extrabold text-black cursor-pointer transition-colors"
            >
              <span className="flex items-center gap-2">
                {capacityOpen ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
                <span>{t('sop.ledger.capacitySection')}</span>
              </span>
              <span className="text-[11px] font-mono text-slate-500 font-semibold">
                {t('sop.ledger.ceiling')} {totalCapacity.toLocaleString()} {t('sop.kpi.units')}
              </span>
            </button>

            {capacityOpen && (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <tbody className="divide-y divide-black/5 text-slate-700">
                    <tr className="hover:bg-white/50 transition-colors">
                      <td className="py-2.5 px-5 font-medium min-w-[220px]">{t('sop.ledger.factoryCeilingCapacity')}</td>
                      {currentPlan.periods.map((p) => (
                        <td key={p.period} className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-600 min-w-[90px]">
                          {p.operationsCapacity.toLocaleString()}
                        </td>
                      ))}
                      <td className="py-2.5 px-5 text-right font-mono font-bold text-slate-800 min-w-[100px]">
                        {totalCapacity.toLocaleString()}
                      </td>
                    </tr>

                    <tr className="bg-white/40 font-bold">
                      <td className="py-2.5 px-5 text-black">
                        {t('sop.ledger.gapRow')}
                      </td>
                      {currentPlan.periods.map((p) => (
                        <td
                          key={p.period}
                          className={`py-2.5 px-4 text-right font-mono tabular-nums font-bold ${
                            p.gap < 0 ? 'text-[#FFA27D]' : 'text-emerald-800'
                          }`}
                        >
                          {p.gap > 0 ? `+${p.gap}` : p.gap}
                        </td>
                      ))}
                      <td className={`py-2.5 px-5 text-right font-mono font-black ${totalGap < 0 ? 'text-[#FFA27D]' : 'text-emerald-800'}`}>
                        {totalGap > 0 ? `+${totalGap}` : totalGap}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
