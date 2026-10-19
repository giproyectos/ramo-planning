import React, { useMemo, useState } from 'react';
import { MeasureView, convertCommercialQty } from '@ramo/domain';
import { CYCLE_ORDER } from '@ramo/engine';
import { useRamoPlan } from '../../ramo/store';
import { useAuth } from '../../ramo/auth';
import { MEASURE_LABELS, fmtDec, fmtInt, weekLabel } from '../../ramo/format';
import { CycleStepper } from './CycleStepper';
import { SERIES_COLORS } from './charts';
import { Card, Disclosure, StackedBars } from './ui';
import { RebalanceCard } from './ai';

/** Vista de Distribución: MPS final = necesidad neta de todo el negocio + ajustes acordados con el equipo. */
export function MpsView() {
  const { dataset, weeks, stage, decisions, adjustments, danielView, addAdjustment, removeAdjustment, advance, can, canAdvance, drp, supplyRisk, rebalanceDaniel } = useRamoPlan();
  const [measure, setMeasure] = useState<MeasureView>('commercial_units');
  const [skuId, setSkuId] = useState(dataset.skus[0].id);
  const [week, setWeek] = useState(weeks[1] ?? weeks[0]);
  const [delta, setDelta] = useState('-1000');
  const [chartSku, setChartSku] = useState('');
  const [reason, setReason] = useState('');
  const { user: authUser } = useAuth();
  const [author, setAuthor] = useState(authUser?.name ?? 'Distribución');

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
            <span className="text-black font-extrabold">MPS final · Vista de Distribución</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black tracking-tight text-slate-950">Producción neta consolidada del negocio</h1>
          <p className="text-xs text-slate-500 mt-0.5 font-medium">
            Demanda − inventario − órdenes en curso (+ Hard Discount y Exportaciones completos). Los "rojos" vienen del CRP de Producción. Datos sintéticos.
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
          Producción todavía no envía su plan de capacidades. Puedes ver el neto, pero los ajustes se habilitan cuando lo reciba.
        </div>
      )}

      <Card
        title="Producción neta por semana"
        hint={chartSku ? 'Cajas a producir de este producto; las semanas ajustadas por Distribución se ven más intensas.' : 'Lo que hay que producir cada semana, apilado por planta. Pasa el cursor sobre una barra para ver el detalle.'}
        action={
          <label className="text-[11px] font-bold text-slate-600 flex items-center gap-2">
            Ver
            <select value={chartSku} onChange={(e) => setChartSku(e.target.value)} className="rounded-xl border border-black/10 bg-white/80 px-2.5 py-1.5 text-xs font-bold">
              <option value="">Todos los productos</option>
              {dataset.skus.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        }
      >
        <StackedBars
          labels={weeks.map(weekLabel)}
          unit={MEASURE_LABELS[measure].toLowerCase()}
          highlight={chartSku ? (i) => adjusted(chartSku, weeks[i]) : undefined}
          stacks={
            chartSku
              ? [{ name: dataset.skus.find((s) => s.id === chartSku)?.name ?? chartSku, color: SERIES_COLORS[0], values: weeks.map((w) => convertCommercialQty(dataset.skus.find((s) => s.id === chartSku)!, netBy.get(`${chartSku}|${w}`) ?? 0, measure)) }]
              : dataset.plants.map((pl, k) => ({
                  name: pl.name,
                  color: SERIES_COLORS[k % SERIES_COLORS.length],
                  values: weeks.map((w) => dataset.skus.filter((s) => dataset.lines.find((l) => l.id === s.lineId)?.plantId === pl.id).reduce((acc, s) => acc + convertCommercialQty(s, netBy.get(`${s.id}|${w}`) ?? 0, measure), 0)),
                }))
          }
        />
        <div className="mt-2 grid gap-1 relative" style={{ gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))`, paddingLeft: '7.2%', paddingRight: '1.7%' }}>
          <div className="absolute left-0 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-500 leading-tight">Capacidad</div>
          {weeks.map((w) => {
            const reds = redWeek(w);
            return reds.length > 0 ? (
              <span key={w} className="text-center rounded-full bg-[#FFA27D] text-black font-black text-[9px] py-0.5" title={reds.map((a) => `${crewName(a.crewId)}: faltan ${fmtDec(a.excessHours)} h`).join('\n')}>{reds.length} rojo{reds.length > 1 ? 's' : ''}</span>
            ) : (
              <span key={w} className="text-center rounded-full bg-[#7AFFA1]/60 text-black font-black text-[9px] py-0.5">✓</span>
            );
          })}
        </div>
        <p className="text-[10px] text-slate-500 mt-2">{decisions.length > 0 ? `Incluye ${decisions.length} decisión(es) de horas extra de Producción. ` : ''}La fila "Capacidad" muestra, semana a semana, si las líneas alcanzan (✓) o cuántas tripulaciones quedan en rojo.</p>
        <Disclosure title="Ver la tabla producto por semana (también sirve para escoger la celda a ajustar)">
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
        <p className="text-[10px] text-slate-500 mt-2">Morado = semana ajustada. Pasa el cursor sobre una cifra para ver la demanda bruta. {decisions.length > 0 && `Incluye ${decisions.length} decisión(es) de horas extra de Producción.`}</p>
        </Disclosure>
      </Card>

      <RebalanceCard view="mps" />

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
          {adjustments.length > 0 && (() => {
            const isOpt = (x: { reason: string }) => x.reason.startsWith('Rebalanceo sugerido');
            const manual = adjustments.filter((x) => !isOpt(x));
            const opt = adjustments.filter(isOpt);
            const row = (a: (typeof adjustments)[number]) => (
              <li key={a.id} className="flex items-start justify-between gap-2">
                <span>
                  <span className="font-mono font-bold">{a.deltaCommercialQty > 0 ? '+' : ''}{fmtInt(a.deltaCommercialQty)}</span> {dataset.skus.find((s) => s.id === a.skuId)?.name.replace(' (sint.)', '')} · {weekLabel(a.weekStart)} — {a.reason} <span className="text-slate-400">({a.author})</span>
                </span>
                {editable && <button onClick={() => removeAdjustment(a.id)} className="text-slate-400 hover:text-black cursor-pointer" aria-label="Quitar">✕</button>}
              </li>
            );
            return (
              <div className="pt-1 space-y-2">
                {manual.length > 0 && <ul className="text-xs space-y-1">{manual.map(row)}</ul>}
                {opt.length > 0 && (
                  <div className="rounded-2xl bg-[#DDCBF5]/30 border border-[#DDCBF5] px-3 py-2 text-xs space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span><span className="font-black">✦ Rebalanceo del optimizador:</span> {Math.ceil(opt.length / 2)} movimiento(s) de producción ({opt.length} ajustes, cada uno suma y resta las mismas cajas en dos semanas)</span>
                      {editable && <button onClick={() => opt.forEach((x) => removeAdjustment(x.id))} className="text-[11px] font-bold underline text-slate-600 hover:text-black cursor-pointer">Quitar todos</button>}
                    </div>
                    <Disclosure title={`Ver los ${opt.length} ajustes`}>
                      <ul className="space-y-1">{opt.map(row)}</ul>
                    </Disclosure>
                  </div>
                )}
              </div>
            );
          })()}
        </div>

        {(() => {
          const reds = danielView.alerts;
          const redWeeks = new Set(reds.map((r) => r.weekStart));
          const closed = stage === 'MPS_FINAL' || stage === 'FINAL_ALERTS';
          const ready = received && !closed;
          const stockouts = drp?.alerts.filter((x) => x.code === 'STOCKOUT').length ?? 0;
          const criticalMats = supplyRisk?.risks.filter((r) => r.status === 'CRITICAL').length ?? 0;
          const plus = adjustments.filter((x) => x.deltaCommercialQty > 0).reduce((acc, x) => acc + x.deltaCommercialQty, 0);
          const minus = adjustments.filter((x) => x.deltaCommercialQty < 0).reduce((acc, x) => acc + x.deltaCommercialQty, 0);
          const status = closed
            ? { label: 'MPS final cerrado', tone: 'bg-[#7AFFA1]' }
            : !received
            ? { label: 'Esperando el plan de Producción', tone: 'bg-[#DDCBF5]' }
            : reds.length === 0
            ? { label: 'Listo para cerrar', tone: 'bg-[#7AFFA1]' }
            : { label: `Se puede cerrar con ${reds.length} pendiente(s) de capacidad`, tone: 'bg-[#FFF87C]' };
          const why = closed ? 'Ya está cerrado: Producción lo recarga desde la vista de Capacidad.' : !received ? 'Se habilita cuando Producción envíe su plan de capacidades.' : !can('mps.edit') ? 'Tu rol no puede cerrar el MPS final.' : '';
          const items: { tone: 'ok' | 'warn' | 'info'; title: string; detail: React.ReactNode }[] = [
            reds.length === 0
              ? { tone: 'ok', title: 'Capacidad', detail: 'Con los ajustes actuales ninguna tripulación pasa de su capacidad.' }
              : {
                  tone: 'warn',
                  title: `Capacidad: ${reds.length} pendiente(s)`,
                  detail: (
                    <span>
                      {[...reds].sort((x, y) => y.excessHours - x.excessHours).slice(0, 4).map((x) => `${crewName(x.crewId)} · ${weekLabel(x.weekStart)} (faltan ${fmtDec(x.excessHours)} h)`).join(' · ')}
                      {reds.length > 4 ? ` · y ${reds.length - 4} más` : ''}.
                      {rebalanceDaniel && rebalanceDaniel.movedHours > 0 ? ' El optimizador de arriba propone resolver ' + fmtDec(rebalanceDaniel.movedHours, 1) + ' h adelantando producción.' : ''}
                    </span>
                  ),
                },
            adjustments.length === 0
              ? { tone: 'info', title: 'Ajustes de Distribución', detail: 'Todavía no hay ajustes. El MPS final sería igual al plan que envió Producción.' }
              : { tone: 'ok', title: `Ajustes de Distribución: ${adjustments.length}`, detail: `Suman ${fmtInt(plus)} cajas y restan ${fmtInt(-minus)}; cada uno queda con su motivo y su autor.` },
            stockouts === 0
              ? { tone: 'ok', title: 'Red de distribución', detail: 'El DRP no proyecta quiebres.' }
              : { tone: 'warn', title: `Red de distribución: ${stockouts} quiebre(s) proyectado(s)`, detail: 'Revisa la pantalla DRP. Canasta, rotación y frecuencias de despacho todavía no se modelan.' },
            criticalMats === 0
              ? { tone: 'ok', title: 'Materiales', detail: 'Ningún material se acaba dentro de su plazo de entrega.' }
              : { tone: 'info', title: `Materiales: ${criticalMats} con ruptura dentro del plazo`, detail: 'Se resuelven con compras (pantalla Materiales); no impiden cerrar el MPS.' },
          ];
          const icon = { ok: ['bg-[#7AFFA1]', '✓'], warn: ['bg-[#FFA27D]', '!'], info: ['bg-[#DDCBF5]', 'i'] } as const;
          return (
            <div className="glass-panel rounded-3xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-black text-slate-950">Cierre del MPS final</div>
                <span className={`text-[11px] font-black rounded-full px-3 py-1 text-black ${status.tone}`}>{status.label}</span>
              </div>

              <div>
                <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1.5">
                  <span>Capacidad semana a semana</span>
                  <span className="font-bold text-slate-700">{weeks.length - redWeeks.size} de {weeks.length} semanas resueltas</span>
                </div>
                <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))` }}>
                  {weeks.map((w) => (
                    <span key={w} title={`${weekLabel(w)}: ${redWeeks.has(w) ? reds.filter((x) => x.weekStart === w).map((x) => `${crewName(x.crewId)} faltan ${fmtDec(x.excessHours)} h`).join(' · ') : 'capacidad alcanza'}`} className={`h-3 rounded-full ${redWeeks.has(w) ? 'bg-[#FFA27D]' : 'bg-[#7AFFA1]'}`}></span>
                  ))}
                </div>
                <div className="flex justify-between text-[10px] text-slate-400 mt-1"><span>{weeks[0] ? weekLabel(weeks[0]) : ''}</span><span>{weeks.length ? weekLabel(weeks[weeks.length - 1]) : ''}</span></div>
              </div>

              <ul className="space-y-2.5">
                {items.map((it) => (
                  <li key={it.title} className="flex items-start gap-3">
                    <span className={`mt-0.5 w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-[10px] font-black text-black ${icon[it.tone][0]}`}>{icon[it.tone][1]}</span>
                    <div className="min-w-0">
                      <div className="text-xs font-black text-slate-900">{it.title}</div>
                      <div className="text-[11px] text-slate-600 leading-snug">{it.detail}</div>
                    </div>
                  </li>
                ))}
              </ul>

              <div className="border-t border-black/5 pt-3 space-y-1.5">
                <button
                  onClick={() => advance('MPS_FINAL', 'Distribución', `MPS final cerrado con ${adjustments.length} ajuste(s); ${reds.length} rojo(s) pendiente(s)`)}
                  disabled={!editable || !canAdvance('MPS_FINAL')}
                  className="px-5 py-2.5 text-xs font-bold text-white bg-slate-950 rounded-full disabled:opacity-40 cursor-pointer"
                >
                  Cerrar MPS final y devolver a Producción →
                </button>
                <p className="text-[11px] text-slate-500">
                  {why || (ready ? 'Al cerrar, el plan vuelve a Producción, que lo recarga y emite las alertas finales de producción.' : '')}
                </p>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
