import React, { useState } from 'react';
import { MPSSkuRow } from '../../types/demand';
import {
  Lock,
  Unlock,
  ArrowRight,
  ShoppingCart,
  Info,
  Sparkles,
  Calendar,
  X,
} from 'lucide-react';
import { useTranslation } from '../../i18n/i18n';

interface MPSModuleProps {
  skuRows: MPSSkuRow[];
  onUpdateSku: (skuId: string, updatedSku: MPSSkuRow) => void;
  onPromoteToCRP: () => void;
}

export const MPSModule: React.FC<MPSModuleProps> = ({
  skuRows,
  onUpdateSku,
  onPromoteToCRP,
}) => {
  const { t } = useTranslation();
  const [selectedSkuId, setSelectedSkuId] = useState<string>(skuRows[0]?.skuId || 'sku-4001');
  const [orderModalOpen, setOrderModalOpen] = useState(false);
  const [simWeek, setSimWeek] = useState('W42');
  const [simQty, setSimQty] = useState(60);
  const [simResult, setSimResult] = useState<{
    possible: boolean;
    atpAvailable: number;
    message: string;
  } | null>(null);

  const currentSku = skuRows.find((s) => s.skuId === selectedSkuId) || skuRows[0];

  const handleBuildQtyChange = (weekNum: number, newQty: number) => {
    const newPeriods = [...currentSku.periods];
    const periodIdx = newPeriods.findIndex((p) => p.weekNum === weekNum);
    if (periodIdx === -1) return;

    newPeriods[periodIdx] = {
      ...newPeriods[periodIdx],
      mpsPlannedBuild: newQty,
    };

    let runningBalance = currentSku.currentOnHand;
    for (let i = 0; i < newPeriods.length; i++) {
      const p = newPeriods[i];
      const effectiveDemand = p.zone === 'Frozen' ? p.customerOrders : Math.max(p.forecastDemand, p.customerOrders);
      runningBalance = runningBalance + p.mpsPlannedBuild - effectiveDemand;
      p.projectedAvailableBalance = runningBalance;

      if (p.mpsPlannedBuild > 0 || i === 0) {
        const buildAmt = i === 0 ? currentSku.currentOnHand + p.mpsPlannedBuild : p.mpsPlannedBuild;
        let bookedOrders = p.customerOrders;
        for (let j = i + 1; j < newPeriods.length; j++) {
          if (newPeriods[j].mpsPlannedBuild > 0) break;
          bookedOrders += newPeriods[j].customerOrders;
        }
        p.discreteATP = Math.max(0, buildAmt - bookedOrders);
      } else {
        p.discreteATP = 0;
      }
    }

    let cumulative = 0;
    for (let i = 0; i < newPeriods.length; i++) {
      cumulative += newPeriods[i].discreteATP;
      newPeriods[i].cumulativeATP = cumulative;
    }

    onUpdateSku(selectedSkuId, {
      ...currentSku,
      periods: newPeriods,
    });
  };

  const handleSimulateOrder = () => {
    const targetPeriod = currentSku.periods.find((p) => p.week === simWeek);
    if (!targetPeriod) return;

    if (targetPeriod.cumulativeATP >= simQty) {
      setSimResult({
        possible: true,
        atpAvailable: targetPeriod.cumulativeATP,
        message: t('mps.simulateModal.possibleMessage', { qty: simQty, week: simWeek }),
      });
    } else {
      setSimResult({
        possible: false,
        atpAvailable: targetPeriod.cumulativeATP,
        message: t('mps.simulateModal.shortageMessage', {
          atp: targetPeriod.cumulativeATP,
          week: simWeek,
          shortage: simQty - targetPeriod.cumulativeATP,
        }),
      });
    }
  };

  const handleCommitOrderToMPS = () => {
    if (!simResult?.possible) return;

    const newPeriods = currentSku.periods.map((p) => {
      if (p.week === simWeek) {
        return {
          ...p,
          customerOrders: p.customerOrders + simQty,
        };
      }
      return p;
    });

    onUpdateSku(selectedSkuId, {
      ...currentSku,
      periods: newPeriods,
    });

    setOrderModalOpen(false);
  };

  const totalBuild = currentSku.periods.reduce((s, p) => s + p.mpsPlannedBuild, 0);
  const totalOrders = currentSku.periods.reduce((s, p) => s + p.customerOrders, 0);

  return (
    <div className="space-y-5">
      {/* Sleek Stage Header Banner */}
      <div className="glass-panel rounded-3xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
            <span className="w-2 h-2 rounded-full bg-[#7AFFA1]"></span>
            <span className="text-black font-extrabold">{t('mps.stage')}</span>
            <span className="text-slate-300">·</span>
            <span>{t('mps.horizonLabel')}</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black tracking-tight text-slate-950 flex flex-wrap items-center gap-3">
            <span>{t('mps.title')}</span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5 font-medium">
            {t('mps.subtitle')}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={() => {
              setSimResult(null);
              setOrderModalOpen(true);
            }}
            className="px-3.5 py-1.5 text-xs font-bold text-black bg-[#FFF87C] hover:opacity-90 rounded-full flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs"
          >
            <ShoppingCart className="w-3.5 h-3.5" />
            <span>{t('mps.simulateOrderAtp')}</span>
          </button>

          <button
            onClick={onPromoteToCRP}
            className="px-4 py-2 text-xs font-bold text-white bg-slate-950 hover:bg-black rounded-full flex items-center gap-1.5 transition-all cursor-pointer shadow-sm active:scale-95"
          >
            <span>{t('mps.verifyCapacityInCrp')}</span>
            <ArrowRight className="w-3.5 h-3.5 text-[#7AFFA1]" />
          </button>
        </div>
      </div>

      {/* SKU Selector & Inventory Profile Bar */}
      <div className="glass-panel rounded-3xl p-4.5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-slate-500 font-bold">{t('mps.skuBar.finishedItem')}</span>
          <div className="flex rounded-full glass-pill p-1">
            {skuRows.map((sku) => (
              <button
                key={sku.skuId}
                onClick={() => setSelectedSkuId(sku.skuId)}
                className={`px-3.5 py-1 text-xs font-bold rounded-full transition-all cursor-pointer ${
                  selectedSkuId === sku.skuId
                    ? 'bg-slate-950 text-white shadow-xs'
                    : 'text-slate-600 hover:text-black'
                }`}
              >
                <span>{sku.skuCode}</span>
                <span className="ml-1 text-[10px] opacity-70">({sku.skuName})</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-4 text-xs text-slate-600 font-semibold flex-wrap">
          <div>
            <span>{t('mps.skuBar.currentStock')} </span>
            <strong className="text-black font-mono font-bold">{currentSku.currentOnHand} {t('mps.kpi.units')}</strong>
          </div>
          <span className="text-slate-300">·</span>
          <div>
            <span>{t('mps.skuBar.safetyStock')} </span>
            <strong className="text-black font-mono font-bold">{currentSku.safetyStock} {t('mps.kpi.units')}</strong>
          </div>
          <span className="text-slate-300">·</span>
          <div>
            <span>{t('mps.skuBar.finalAtp')} </span>
            <strong className="text-emerald-900 font-mono font-bold bg-[#7AFFA1]/40 px-2 py-0.5 rounded-full">
              {currentSku.periods[currentSku.periods.length - 1]?.cumulativeATP} {t('mps.kpi.units')}
            </strong>
          </div>
        </div>
      </div>

      {/* Visual Time Fence Horizon Ribbon */}
      <div className="glass-panel rounded-3xl p-5 space-y-3.5">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-slate-700" />
            <span className="font-extrabold text-black">{t('mps.fence.title')}</span>
          </div>
          <span className="text-slate-500 font-medium">{t('mps.fence.weeksRange')}</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="p-3.5 rounded-2xl bg-[#DDCBF5]/40 border border-[#DDCBF5] text-black">
            <div className="flex items-center justify-between">
              <span className="font-extrabold text-xs flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-black" />
                {t('mps.fence.frozen.label')}
              </span>
              <span className="text-[9px] font-mono font-bold bg-white px-2 py-0.5 rounded-full shadow-2xs">
                {t('mps.fence.frozen.days')}
              </span>
            </div>
            <p className="text-xs text-slate-700 mt-1.5 leading-snug font-medium">
              {t('mps.fence.frozen.description')}
            </p>
          </div>

          <div className="p-3.5 rounded-2xl bg-[#FFF87C]/50 border border-[#FFF87C] text-black">
            <div className="flex items-center justify-between">
              <span className="font-extrabold text-xs flex items-center gap-1.5">
                <Unlock className="w-3.5 h-3.5 text-black" />
                {t('mps.fence.slushy.label')}
              </span>
              <span className="text-[9px] font-mono font-bold bg-white px-2 py-0.5 rounded-full shadow-2xs">
                {t('mps.fence.slushy.days')}
              </span>
            </div>
            <p className="text-xs text-slate-700 mt-1.5 leading-snug font-medium">
              {t('mps.fence.slushy.description')}
            </p>
          </div>

          <div className="p-3.5 rounded-2xl bg-[#7AFFA1]/35 border border-[#7AFFA1] text-black">
            <div className="flex items-center justify-between">
              <span className="font-extrabold text-xs flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-black" />
                {t('mps.fence.liquid.label')}
              </span>
              <span className="text-[9px] font-mono font-bold bg-white px-2 py-0.5 rounded-full shadow-2xs">
                {t('mps.fence.liquid.days')}
              </span>
            </div>
            <p className="text-xs text-slate-700 mt-1.5 leading-snug font-medium">
              {t('mps.fence.liquid.description')}
            </p>
          </div>
        </div>
      </div>

      {/* Main MPS Matrix Grid */}
      <div className="glass-panel rounded-3xl overflow-hidden">
        <div className="px-5 py-4 border-b border-black/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-extrabold text-black">
              {t('mps.matrix.title')}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5 font-medium">
              {t('mps.matrix.subtitle')}
            </p>
          </div>

          <div className="flex items-center gap-4 text-xs font-bold">
            <div>
              <span className="text-slate-500">{t('mps.matrix.plannedBuild')} </span>
              <span className="font-mono text-black font-black">{totalBuild} {t('mps.kpi.units')}</span>
            </div>
            <span className="text-slate-300">·</span>
            <div>
              <span className="text-slate-500">{t('mps.matrix.firmBooked')} </span>
              <span className="font-mono text-black font-black">{totalOrders} {t('mps.kpi.units')}</span>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-white/30 text-slate-400 font-mono text-[11px] uppercase border-b border-black/5">
              <tr>
                <th className="py-2.5 px-5 font-bold min-w-[220px]">
                  {t('mps.matrix.column')}
                </th>
                {currentSku.periods.map((p) => (
                  <th key={p.week} className="py-2.5 px-4 text-right font-bold min-w-[85px]">
                    <div className="flex flex-col items-end">
                      <span className="text-black font-bold">{p.week}</span>
                      <span
                        className={`text-[9px] px-1.5 py-0.5 rounded font-mono uppercase ${
                          p.zone === 'Frozen'
                            ? 'bg-[#DDCBF5] text-black font-extrabold'
                            : p.zone === 'Slushy'
                            ? 'bg-[#FFF87C] text-black font-extrabold'
                            : 'bg-[#7AFFA1] text-black font-extrabold'
                        }`}
                      >
                        {t(`mps.zone.${p.zone}`)}
                      </span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5 text-slate-700">
              {/* Forecast Demand */}
              <tr className="hover:bg-white/50 transition-colors">
                <td className="py-2.5 px-5 font-medium text-slate-600">
                  {t('mps.matrix.forecastDemand')}
                </td>
                {currentSku.periods.map((p) => (
                  <td key={p.week} className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-500">
                    {p.forecastDemand}
                  </td>
                ))}
              </tr>

              {/* Customer Booked Orders */}
              <tr className="hover:bg-white/50 transition-colors bg-white/20">
                <td className="py-2.5 px-5 font-bold text-black">
                  <div className="flex items-center justify-between gap-2">
                    <span>{t('mps.matrix.customerOrders')}</span>
                    <span className="text-[9px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-sans font-medium shrink-0">
                      {t('mps.matrix.bookings')}
                    </span>
                  </div>
                </td>
                {currentSku.periods.map((p) => (
                  <td key={p.week} className="py-2.5 px-4 text-right font-mono tabular-nums text-black font-bold">
                    {p.customerOrders}
                  </td>
                ))}
              </tr>

              {/* Projected Available Balance */}
              <tr className="hover:bg-white/50 transition-colors">
                <td className="py-2.5 px-5 font-bold text-black">
                  {t('mps.matrix.projectedAvailableBalance')}
                </td>
                {currentSku.periods.map((p) => (
                  <td
                    key={p.week}
                    className={`py-2.5 px-4 text-right font-mono tabular-nums font-bold ${
                      p.projectedAvailableBalance < currentSku.safetyStock
                        ? 'text-[#FFA27D] font-black'
                        : 'text-slate-900'
                    }`}
                  >
                    {p.projectedAvailableBalance}
                  </td>
                ))}
              </tr>

              {/* MPS Planned Build */}
              <tr className="bg-[#dbfced]/30 font-bold hover:bg-[#dbfced]/50 transition-colors">
                <td className="py-3 px-5 text-black">
                  <div className="flex items-center justify-between gap-2">
                    <span>{t('mps.matrix.mpsBuild')}</span>
                    <span className="text-[9px] bg-[#7AFFA1] text-black px-2 py-0.5 rounded-full shadow-2xs font-extrabold shrink-0">
                      {t('mps.matrix.editableSlushLiquid')}
                    </span>
                  </div>
                </td>
                {currentSku.periods.map((p) => {
                  const isFrozen = p.zone === 'Frozen';
                  return (
                    <td key={p.week} className="py-2.5 px-4 text-right">
                      {isFrozen ? (
                        <div className="flex items-center justify-end gap-1 text-black font-black font-mono">
                          <Lock className="w-3 h-3 text-slate-400" />
                          <span>{p.mpsPlannedBuild}</span>
                        </div>
                      ) : (
                        <input
                          type="number"
                          value={p.mpsPlannedBuild}
                          onChange={(e) =>
                            handleBuildQtyChange(p.weekNum, parseInt(e.target.value) || 0)
                          }
                          className="w-16 text-right font-mono font-black text-black bg-white/80 border border-slate-200/80 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-black"
                        />
                      )}
                    </td>
                  );
                })}
              </tr>

              {/* Discrete ATP */}
              <tr className="hover:bg-white/50 transition-colors">
                <td className="py-2.5 px-5 text-slate-700 font-medium">
                  <div className="flex items-center gap-1.5">
                    <span>{t('mps.matrix.discreteAtp')}</span>
                    <span title={t('mps.matrix.discreteAtpTooltip')}>
                      <Info className="w-3.5 h-3.5 text-slate-400" />
                    </span>
                  </div>
                </td>
                {currentSku.periods.map((p) => (
                  <td key={p.week} className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-700 font-semibold">
                    {p.discreteATP > 0 ? p.discreteATP : '-'}
                  </td>
                ))}
              </tr>

              {/* Cumulative ATP */}
              <tr className="bg-[#fffde3]/40 font-bold hover:bg-[#fffde3]/60 transition-colors">
                <td className="py-3 px-5 text-black">
                  <div className="flex items-center justify-between gap-2">
                    <span>{t('mps.matrix.cumulativeAtp')}</span>
                    <span className="text-[9px] bg-[#FFF87C] text-black px-2 py-0.5 rounded-full shadow-2xs font-extrabold shrink-0">
                      {t('mps.matrix.orderPromising')}
                    </span>
                  </div>
                </td>
                {currentSku.periods.map((p) => (
                  <td
                    key={p.week}
                    className="py-3 px-4 text-right font-mono tabular-nums text-black font-black"
                  >
                    <span className="bg-[#FFF87C] text-black px-2 py-0.5 rounded-full shadow-2xs">
                      {p.cumulativeATP}
                    </span>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ATP Order Simulation Modal */}
      {orderModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/35 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass-panel rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-white/90">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-black text-black flex items-center gap-2">
                <ShoppingCart className="w-4 h-4 text-slate-700" />
                <span>{t('mps.simulateModal.title')}</span>
              </h3>
              <button
                onClick={() => setOrderModalOpen(false)}
                className="w-7 h-7 rounded-full glass-pill flex items-center justify-center text-slate-500 hover:text-black cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <p className="text-xs text-slate-600 font-medium">
              {t('mps.simulateModal.description')}
            </p>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">{t('mps.simulateModal.targetWeek')}</label>
                <select
                  value={simWeek}
                  onChange={(e) => setSimWeek(e.target.value)}
                  className="w-full bg-white/80 border border-slate-200 rounded-xl px-3 py-2 text-black font-semibold focus:outline-none"
                >
                  {currentSku.periods.map((p) => (
                    <option key={p.week} value={p.week}>
                      {t('mps.simulateModal.optionLabel', {
                        week: p.week,
                        zone: t(`mps.zone.${p.zone}`),
                        atp: p.cumulativeATP,
                      })}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">{t('mps.simulateModal.requestedQty')}</label>
                <input
                  type="number"
                  value={simQty}
                  onChange={(e) => setSimQty(parseInt(e.target.value) || 0)}
                  className="w-full bg-white/80 border border-slate-200 rounded-xl px-3 py-2 text-black font-mono font-bold focus:outline-none"
                />
              </div>

              <button
                onClick={handleSimulateOrder}
                className="w-full py-2.5 rounded-full text-xs font-bold text-black bg-[#FFF87C] hover:opacity-90 transition-all cursor-pointer shadow-2xs"
              >
                {t('mps.simulateModal.runCheck')}
              </button>
            </div>

            {simResult && (
              <div
                className={`p-4 rounded-2xl border text-xs space-y-1.5 ${
                  simResult.possible
                    ? 'bg-[#7AFFA1]/30 border-[#7AFFA1] text-emerald-950'
                    : 'bg-[#FFA27D]/30 border-[#FFA27D] text-amber-950'
                }`}
              >
                <div className="font-black flex items-center justify-between">
                  <span>{simResult.possible ? t('mps.simulateModal.feasible') : t('mps.simulateModal.shortageAlert')}</span>
                  <span className="font-mono">{simResult.atpAvailable} {t('mps.simulateModal.unitsAvailable')}</span>
                </div>
                <p className="leading-snug font-medium">{simResult.message}</p>
              </div>
            )}

            <div className="pt-3 border-t border-black/5 flex items-center justify-end gap-2.5">
              <button
                onClick={() => setOrderModalOpen(false)}
                className="px-4 py-2 rounded-full text-xs font-bold text-slate-600 hover:text-black glass-pill cursor-pointer"
              >
                {t('mps.simulateModal.cancel')}
              </button>
              {simResult?.possible && (
                <button
                  onClick={handleCommitOrderToMPS}
                  className="px-5 py-2 rounded-full text-xs font-bold text-white bg-slate-950 hover:bg-black transition-all cursor-pointer shadow-sm"
                >
                  {t('mps.simulateModal.commit')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
