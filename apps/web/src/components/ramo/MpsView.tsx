import React, { useMemo, useState } from 'react';
import { MeasureView, convertCommercialQty } from '@ramo/domain';
import { CYCLE_ORDER } from '@ramo/engine';
import { useRamoPlan } from '../../ramo/store';
import { MEASURE_LABELS, fmtDec, fmtInt, weekLabel } from '../../ramo/format';
import { CycleStepper } from './CycleStepper';

/** Vista de Daniel: MPS final = necesidad neta de todo el negocio + ajustes acordados con el equipo. */
export function MpsView() {
  const { dataset, weeks, stage, decisions, adjustments, danielView, addAdjustment, removeAdjustment, advance, can, canAdvance } = useRamoPlan();
  const [measure, setMeasure] = useState<MeasureView>('commercial_units');
  const [skuId, setSkuId] = useState(dataset.skus[0].id);
  const [week, setWeek] = useState(weeks[1] ?? weeks[0]);
  const [delta, setDelta] = useState('-1000');
  const [reason, setReason] = useState('');
  const [author, setAuthor] = useState('Daniel (demo)');

  const stageIdx = CYCLE_ORDER.indexOf(stage);
  const received = stageIdx >= CYCLE_ORDER.indexOf('SENT_TO_MPS');
  const editable = stage === 'SENT_TO_MPS' && can('mps.edit');
  const crewName = (id: string) => dataset.crews.find((c) => c.id === id)?.name ?? id;
  const fmtCell = (n: number) => (measure === 'tons' ? fmtDec(n, 1) : fmtInt(n));

  const netBy = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of danielView.net) m.set(`${r.skuId}|${r.weekStart}`, r.netProduction);
    return m;
  }, [danielView.net]);
  const rowBy = useMemo(() => new Map(danielView.net.map((r) => [`${r.skuId}|${r.weekStart}`, r])), [danielView.net]);

  const adjusted = (sku: string, w: string) => adjustments.some((a) => a.skuId === sku && a.weekStart === w);
  const redWeek = (w: string) => danielView.alerts.filter((a) => a.weekStart === w);

  const totals = weeks.map((w) =>
    dataset.skus.reduce((acc, s) => acc + convertCommercialQty(s, netBy.get(`${s.id}|${w}`) ?? 0, measure), 0),
  );

  const submit = () => {
    const d = Number(delta);
    if (!d || !reason.trim() || !author.trim()) return;
    addAdjustment({ skuId, weekStart: week, deltaCommercialQty: d, reason: reason.trim(), author: author.trim() });
    setReason('');
  };

  return (
    <div className="space-y-5">
      <div className="glass-panel rounded-3xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
            <span className="w-2 h-2 rounded-full bg-[#DDCBF5]"></span>
            <span className="text-black font-extrabold">MPS final · Vista de Daniel</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black tracking-tight text-slate-950">Producción neta consolidada del negocio</h1>
          <p className="text-xs text-slate-500 mt-0.5 font-medium">
            Demanda − inventario − órdenes en curso (+ Hard Discount y Exportaciones completos). Los "rojos" vienen del CRP de Miguel. Datos sintéticos.
          </p>
        </div>
        <label className="text-[11px] font-bold text-slate-600 flex items-center gap-2">
          Unidad de medida
          <select value={measure} onChange={(e) => setMeasure(e.target.value as MeasureView)} className="rounded-xl border border-black/10 bg-white/80 px-2.5 py-1.5 text-xs font-bold">
            {(Object.keys(MEASURE_LABELS) as MeasureView[]).map((m) => (
              <option key={m} value={m}>{MEASURE_LABELS[m]}</option>
            ))}
          </select>
        </label>
      </div>

      <CycleStepper showLog={false} />

      {!received && (
        <div className="rounded-3xl px-5 py-3 text-xs font-bold bg-[#FFF87C]/50 border border-[#FFF87C]">
          Miguel todavía no envía su plan de capacidades. Puedes ver el neto, pero los ajustes se habilitan cuando lo reciba.
        </div>
      )}

      <div className="glass-panel rounded-3xl p-5 overflow-x-auto">
        <table className="w-full text-xs border-separate border-spacing-y-0.5">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-slate-500">
              <th className="text-left font-bold pr-3">SKU</th>
              {weeks.map((w) => (
                <th key={w} className="font-mono font-bold text-right px-1.5">{weekLabel(w)}</th>
              ))}
            </tr>
            <tr>
              <td className="text-[10px] font-bold text-slate-500">Riesgo de capacidad</td>
              {weeks.map((w) => {
                const reds = redWeek(w);
                return (
                  <td key={w} className="text-right px-1.5">
                    {reds.length > 0 ? (
                      <span className="inline-block rounded-full bg-[#FFA27D] text-black font-black text-[9px] px-1.5 py-0.5" title={reds.map((a) => `${crewName(a.crewId)}: faltan ${fmtDec(a.excessHours)} h`).join('\n')}>
                        {reds.length} rojo{reds.length > 1 ? 's' : ''}
                      </span>
                    ) : (
                      <span className="text-emerald-700 font-bold">✓</span>
                    )}
                  </td>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {dataset.skus.map((s) => (
              <tr key={s.id} className="hover:bg-white/50">
                <td className="pr-3 py-1 whitespace-nowrap">
                  <span className="font-bold">{s.name}</span> <span className="text-slate-400">· {s.lineId}</span>
                </td>
                {weeks.map((w) => {
                  const row = rowBy.get(`${s.id}|${w}`);
                  return (
                    <td key={w} className="text-right px-1.5">
                      <button
                        onClick={() => { setSkuId(s.id); setWeek(w); }}
                        className={`font-mono rounded px-1 cursor-pointer ${adjusted(s.id, w) ? 'bg-[#DDCBF5] font-extrabold' : ''} ${skuId === s.id && week === w ? 'ring-2 ring-black' : ''}`}
                        title={row ? `CEDI bruto ${fmtInt(row.grossCedi)} · make-to-order ${fmtInt(row.grossMto)} cajas` : ''}
                      >
                        {fmtCell(convertCommercialQty(s, netBy.get(`${s.id}|${w}`) ?? 0, measure))}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr className="border-t">
              <td className="font-black pt-2">Total</td>
              {totals.map((t, i) => (
                <td key={weeks[i]} className="text-right font-mono font-black pt-2 px-1.5">{fmtCell(t)}</td>
              ))}
            </tr>
          </tbody>
        </table>
        <p className="text-[10px] text-slate-500 mt-2">Morado = semana ajustada. Pasa el cursor sobre una cifra para ver la demanda bruta. {decisions.length > 0 && `Incluye ${decisions.length} decisión(es) de horas extra de Miguel.`}</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_1fr] gap-5 items-start">
        <div className="glass-panel rounded-3xl p-5 space-y-3">
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Ajuste al MPS (decisión conjunta)</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
            <select value={skuId} onChange={(e) => setSkuId(e.target.value)} disabled={!editable} aria-label="SKU" className="rounded-xl border border-black/10 bg-white/80 px-2.5 py-2">
              {dataset.skus.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select value={week} onChange={(e) => setWeek(e.target.value)} disabled={!editable} aria-label="Semana" className="rounded-xl border border-black/10 bg-white/80 px-2.5 py-2">
              {weeks.map((w) => <option key={w} value={w}>{weekLabel(w)}</option>)}
            </select>
            <input type="number" step="100" value={delta} onChange={(e) => setDelta(e.target.value)} disabled={!editable} aria-label="Cajas a sumar o restar" className="rounded-xl border border-black/10 bg-white/80 px-2.5 py-2 font-mono" />
          </div>
          <div className="grid grid-cols-[1fr_170px] gap-2 text-xs">
            <input value={reason} onChange={(e) => setReason(e.target.value)} disabled={!editable} placeholder="Motivo (obligatorio)" aria-label="Motivo" className="rounded-xl border border-black/10 bg-white/80 px-2.5 py-2" />
            <input value={author} onChange={(e) => setAuthor(e.target.value)} disabled={!editable} aria-label="Autor" className="rounded-xl border border-black/10 bg-white/80 px-2.5 py-2" />
          </div>
          <button onClick={submit} disabled={!editable || !Number(delta) || !reason.trim()} className="px-4 py-2 text-xs font-bold text-white bg-slate-950 rounded-full disabled:opacity-40 cursor-pointer">
            Registrar ajuste (cajas)
          </button>
          {adjustments.length > 0 && (
            <ul className="text-xs space-y-1 pt-1">
              {adjustments.map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-2">
                  <span>
                    <span className="font-mono font-bold">{a.deltaCommercialQty > 0 ? '+' : ''}{fmtInt(a.deltaCommercialQty)}</span> {dataset.skus.find((s) => s.id === a.skuId)?.name} · {weekLabel(a.weekStart)} — {a.reason} <span className="text-slate-400">({a.author})</span>
                  </span>
                  {editable && <button onClick={() => removeAdjustment(a.id)} className="text-slate-400 hover:text-black cursor-pointer" aria-label="Quitar">✕</button>}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="glass-panel rounded-3xl p-5 space-y-3">
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Cierre del MPS final</div>
          <p className="text-xs text-slate-600">
            {danielView.alerts.length === 0
              ? 'Con los ajustes actuales no quedan rojos de capacidad.'
              : `Quedan ${danielView.alerts.length} rojo(s) de capacidad: ${danielView.alerts.map((a) => `${crewName(a.crewId)} ${weekLabel(a.weekStart)} (${fmtDec(a.excessHours)} h)`).join(' · ')}.`}
          </p>
          <p className="text-[11px] text-slate-500">
            Riesgos de distribución (canasta, espacio, rotación) y frecuencias de distribución: pendientes de modelar (fase DRP).
          </p>
          <button
            onClick={() => advance('MPS_FINAL', 'Daniel', `MPS final cerrado con ${adjustments.length} ajuste(s); ${danielView.alerts.length} rojo(s) pendiente(s)`)}
            disabled={!editable || !canAdvance('MPS_FINAL')}
            className="px-5 py-2.5 text-xs font-bold text-white bg-slate-950 rounded-full disabled:opacity-40 cursor-pointer"
          >
            Cerrar MPS final y devolver a Miguel →
          </button>
          {stage === 'MPS_FINAL' && <p className="text-xs font-bold text-emerald-800">MPS final cerrado. Miguel lo recarga desde la vista CRP.</p>}
        </div>
      </div>
    </div>
  );
}
