import React, { useEffect, useMemo, useState } from 'react';
import { MeasureView, convertCommercialQty, toProductiveQty } from '@ramo/domain';
import { CYCLE_ORDER, PriorityRule, computeCrp, explainNet, movesToAdjustments, prioritizeCuts } from '@ramo/engine';
import { useRamoPlan } from '../../ramo/store';
import { useAuth } from '../../ramo/auth';
import { MEASURE_LABELS, fmtDec, fmtInt, weekLabel } from '../../ramo/format';
import { SERIES_COLORS } from './charts';
import { StackedBars } from './ui';
import { CycleBar } from './CycleBar';
import { AltPicker } from './AltPicker';

const RULES: { id: PriorityRule; label: string; hint: string }[] = [
  { id: 'RISK', label: 'Proteger lo que más riesgo de quiebre tiene', hint: 'Se deja de producir primero lo que menos riesgo de agotarse tiene en la red.' },
  { id: 'VALUE', label: 'Proteger lo de mayor valor', hint: 'Se deja de producir primero lo de menor valor (costo por caja × cajas).' },
  { id: 'EVEN', label: 'Recortar parejo', hint: 'Cada producto cede en proporción a las horas que pide.' },
];
type Flow = 'all' | 'cedi' | 'mto';

const QUICK = [-5000, -1000, -500, 500, 1000, 5000];

/** MPS final: lo que hay que producir de cada producto cada semana; se ajusta, se resuelve la sobrecarga y se cierra el plan. */
export function MpsView() {
  const {
    dataset, weeks, stage, decisions, adjustments, danielView, addAdjustment, removeAdjustment, advance, can, canAdvance, drp, weeklyAltsMps, applyRebalanceMoves, crewMode, horizonDemand, riskBySku,
  } = useRamoPlan();
  const { user } = useAuth();
  const author = user?.name ?? 'Distribución';

  const [measure, setMeasure] = useState<MeasureView>('commercial_units');
  const [view, setView] = useState<'map' | 'chart'>('map');
  const [chartSku, setChartSku] = useState('');
  const [delta, setDelta] = useState('-1000');
  const [reason, setReason] = useState('');
  const [hoverAlt, setHoverAlt] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [flow, setFlow] = useState<Flow>('all');
  const [rule, setRule] = useState<PriorityRule>('RISK');
  const [hoverCuts, setHoverCuts] = useState(false);

  const stageIdx = CYCLE_ORDER.indexOf(stage);
  const received = stageIdx >= CYCLE_ORDER.indexOf('SENT_TO_MPS');
  const closed = stage === 'MPS_FINAL' || stage === 'FINAL_ALERTS';
  const editable = stage === 'SENT_TO_MPS' && can('mps.edit');
  const crewName = (id: string) => dataset.crews.find((c) => c.id === id)?.name.replace('Tripulación ', '') ?? id;
  const skuName = (id: string) => dataset.skus.find((s) => s.id === id)?.name.replace(' (sint.)', '') ?? id;
  const fmtCell = (n: number) =>
    measure === 'tons' ? fmtDec(n, 1) : Math.abs(n) >= 1e6 ? `${fmtDec(n / 1e6, 1)} M` : Math.abs(n) >= 1000 ? `${fmtDec(n / 1000, Math.abs(n) >= 10000 ? 0 : 1)} k` : fmtInt(n);

  // ---- Vista previa de una alternativa ----------------------------------------------------------------------------------
  const alts = weeklyAltsMps;
  const recommended = alts.find((a) => a.recommended)?.id ?? alts[0]?.id ?? '';
  const chosen = alts.find((a) => a.id === (picked ?? recommended));
  const previewAlt = alts.find((a) => a.id === (hoverAlt ?? pinned));
  const priority = useMemo(() => prioritizeCuts(dataset, danielView.net, { rule, riskBySku, crewMode, decisions }), [dataset, danielView.net, rule, riskBySku, crewMode, decisions]);
  const previewCuts = hoverCuts && priority.cuts.length > 0 ? priority : null;
  const preview = useMemo(() => {
    if (!previewAlt && !previewCuts) return null;
    const net = danielView.net.map((r) => ({ ...r }));
    const deltas = previewAlt ? movesToAdjustments(previewAlt.plan.moves) : previewCuts!.cuts.map((c) => ({ skuId: c.skuId, weekStart: c.weekStart, deltaCommercialQty: -c.qty }));
    for (const a of deltas) {
      const row = net.find((r) => r.skuId === a.skuId && r.weekStart === a.weekStart);
      if (row) row.netProduction = Math.max(0, row.netProduction + a.deltaCommercialQty);
    }
    const cap = computeCrp(dataset, net, { crewMode, decisions });
    return { net, alerts: cap.flatMap((w) => w.crews.filter((c) => c.excessHours > 0.05).map((c) => ({ crewId: c.crewId, weekStart: w.weekStart, excessHours: c.excessHours }))) };
  }, [previewAlt, previewCuts, danielView.net, dataset, crewMode, decisions]);

  const baseNet = danielView.net;
  const shownNet = preview?.net ?? baseNet;
  const shownAlerts = preview?.alerts ?? danielView.alerts;
  const rawQty = (net: typeof baseNet, sku: string, w: string) => net.find((r) => r.skuId === sku && r.weekStart === w)?.netProduction ?? 0;
  /** Cajas del MPS según el flujo que se mira: todo, solo CEDI (lo que pide el DRP a la planta) o solo lo bajo pedido (Hard Discount y Exportaciones). */
  const qtyOf = (net: typeof baseNet, sku: string, w: string) => {
    const r = net.find((x) => x.skuId === sku && x.weekStart === w);
    if (!r) return 0;
    return flow === 'all' ? r.netProduction : flow === 'mto' ? r.grossMto : Math.max(0, r.netProduction - r.grossMto);
  };
  const adjusted = (sku: string, w: string) => adjustments.some((a) => a.skuId === sku && a.weekStart === w);
  const redIn = (list: typeof shownAlerts, w: string) => list.filter((a) => a.weekStart === w);
  const totals = weeks.map((w) => dataset.skus.reduce((acc, s) => acc + convertCommercialQty(s, qtyOf(shownNet, s.id, w), measure), 0));

  // ---- Selección ------------------------------------------------------------------------------------------------------------
  const first = danielView.alerts[0];
  const [sel, setSel] = useState<{ skuId: string; week: string }>(() => {
    const crew = first ? dataset.crews.find((c) => c.id === first.crewId) : undefined;
    const cands = dataset.skus.filter((s) => !crew || crew.lineIds.includes(s.lineId));
    const best = [...cands].sort((a, b) => (danielView.net.find((r) => r.skuId === b.id && r.weekStart === first?.weekStart)?.netProduction ?? 0) - (danielView.net.find((r) => r.skuId === a.id && r.weekStart === first?.weekStart)?.netProduction ?? 0))[0];
    return { skuId: best?.id ?? dataset.skus[0].id, week: first?.weekStart ?? weeks[0] };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
      const wi = weeks.indexOf(sel.week);
      const si = dataset.skus.findIndex((s) => s.id === sel.skuId);
      if (e.key === 'ArrowLeft') setSel({ ...sel, week: weeks[Math.max(0, wi - 1)] });
      else if (e.key === 'ArrowRight') setSel({ ...sel, week: weeks[Math.min(weeks.length - 1, wi + 1)] });
      else if (e.key === 'ArrowUp') setSel({ ...sel, skuId: dataset.skus[Math.max(0, si - 1)].id });
      else if (e.key === 'ArrowDown') setSel({ ...sel, skuId: dataset.skus[Math.min(dataset.skus.length - 1, si + 1)].id });
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sel, weeks, dataset.skus]);

  const sku = dataset.skus.find((s) => s.id === sel.skuId)!;
  const line = dataset.lines.find((l) => l.id === sku.lineId)!;
  const crew = dataset.crews.find((c) => c.lineIds.includes(sku.lineId));
  const crewLoad = danielView.capacity.find((w) => w.weekStart === sel.week)?.crews.find((c) => c.crewId === crew?.id);
  const hpc = toProductiveQty(sku, 1) / line.rate.value;
  const d = Number(delta) || 0;
  const availH = crewLoad ? crewLoad.availableHours + crewLoad.extraHours : 0;
  const pctNow = crewLoad && availH > 0 ? (crewLoad.requiredHours / availH) * 100 : 0;
  const pctAfter = crewLoad && availH > 0 ? ((crewLoad.requiredHours + d * hpc) / availH) * 100 : 0;
  const cellAdj = adjustments.filter((a) => a.skuId === sel.skuId && a.weekStart === sel.week);
  const cellNet = rawQty(baseNet, sel.skuId, sel.week);
  const explain = useMemo(() => explainNet(dataset, horizonDemand, sel.skuId, sel.week), [dataset, horizonDemand, sel.skuId, sel.week]);
  const cellAdjSum = adjustments.filter((a) => a.skuId === sel.skuId && a.weekStart === sel.week).reduce((a, x) => a + x.deltaCommercialQty, 0);
  const plantOf = dataset.plants.find((x) => x.id === line.plantId);
  const row = baseNet.find((r) => r.skuId === sel.skuId && r.weekStart === sel.week);

  const submit = () => {
    if (!d || !reason.trim() || !editable) return;
    addAdjustment({ skuId: sel.skuId, weekStart: sel.week, deltaCommercialQty: d, reason: reason.trim(), author });
    setReason('');
  };

  // ---- Cierre ---------------------------------------------------------------------------------------------------------------
  const reds = danielView.alerts;
  const redWeeks = new Set(reds.map((r) => r.weekStart));
  const stockouts = drp?.alerts.filter((x) => x.code === 'STOCKOUT').length ?? 0;
  const plus = adjustments.filter((x) => x.deltaCommercialQty > 0).reduce((acc, x) => acc + x.deltaCommercialQty, 0);
  const minus = adjustments.filter((x) => x.deltaCommercialQty < 0).reduce((acc, x) => acc + x.deltaCommercialQty, 0);
  const status = closed ? { label: 'MPS final cerrado', tone: 'bg-[#7AFFA1]' }
    : !received ? { label: 'Esperando el plan de Producción', tone: 'bg-[#DDCBF5]' }
    : reds.length === 0 ? { label: 'Listo para cerrar', tone: 'bg-[#7AFFA1]' }
    : { label: `Se puede cerrar con ${reds.length} pendiente(s)`, tone: 'bg-[#FFF87C]' };
  const why = closed ? 'Ya está cerrado: Producción lo recarga desde Capacidad.' : !received ? 'Se habilita cuando Producción envíe su plan de capacidades.' : !can('mps.edit') ? 'Tu rol no puede cerrar el MPS final.' : '';
  const checks: { tone: 'ok' | 'warn' | 'info'; title: string; detail: string }[] = [
    reds.length === 0
      ? { tone: 'ok', title: 'Capacidad', detail: 'Con los ajustes actuales ninguna tripulación pasa de su capacidad.' }
      : { tone: 'warn', title: `Capacidad: ${reds.length} pendiente(s)`, detail: [...reds].sort((x, y) => y.excessHours - x.excessHours).slice(0, 3).map((x) => `${crewName(x.crewId)} ${weekLabel(x.weekStart)} (déficit de ${fmtDec(x.excessHours)} h)`).join(' · ') + (reds.length > 3 ? ` · y ${reds.length - 3} más` : '') },
    adjustments.length === 0
      ? { tone: 'info', title: 'Ajustes de Distribución', detail: 'Todavía no hay ajustes: el MPS final sería igual al plan que envió Producción.' }
      : { tone: 'ok', title: `Ajustes: ${adjustments.length}`, detail: `Suman ${fmtInt(plus)} cajas y restan ${fmtInt(-minus)}; cada uno con su motivo y autor.` },
    stockouts === 0
      ? { tone: 'ok', title: 'Red de distribución', detail: 'El DRP no proyecta quiebres de producto en los puntos de la red.' }
      : { tone: 'warn', title: `Red: ${stockouts} quiebre(s) proyectado(s)`, detail: 'El DRP proyecta faltantes en algún punto de la red; canasta, rotación y frecuencias de despacho todavía no se modelan.' },
  ];
  const icon = { ok: ['bg-[#7AFFA1]', '✓'], warn: ['bg-[#FFA27D]', '!'], info: ['bg-[#DDCBF5]', 'i'] } as const;
  const canMoves = editable;
  const movesReason = !can('mps.edit') ? 'Tu rol no puede ajustar el MPS.' : stage !== 'SENT_TO_MPS' ? (stageIdx < 1 ? 'Los movimientos los aplica Distribución cuando Producción le envía el plan.' : 'El MPS ya está cerrado.') : '';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight">MPS final</h1>
          <p className="text-sm text-slate-600">Lo que hay que producir de cada producto cada semana. Ajusta una celda, resuelve la sobrecarga y cierra el plan.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-black">
          <span className={`rounded-full px-3 py-1.5 ${reds.length ? 'bg-[#FFA27D]' : 'bg-[#7AFFA1]'}`}>{reds.length ? `${reds.length} con sobrecarga` : 'Capacidad resuelta'}</span>
          <span className="rounded-full px-3 py-1.5 bg-[#DDCBF5]">{adjustments.length} ajuste(s)</span>
          <label className="font-bold text-slate-600 flex items-center gap-1.5">
            Flujo
            <select value={flow} onChange={(e) => setFlow(e.target.value as Flow)} className="rounded-xl border border-black/10 bg-white/80 px-2 py-1.5 text-[11px] font-bold" aria-label="Flujo de demanda que se muestra">
              <option value="all">Todo</option>
              <option value="cedi">Solo CEDI (lo que pide el DRP)</option>
              <option value="mto">Solo bajo pedido (Hard Discount y Exportaciones)</option>
            </select>
          </label>
          <label className="font-bold text-slate-600 flex items-center gap-1.5">
            Medida
            <select value={measure} onChange={(e) => setMeasure(e.target.value as MeasureView)} className="rounded-xl border border-black/10 bg-white/80 px-2 py-1.5 text-[11px] font-bold">
              {(Object.keys(MEASURE_LABELS) as MeasureView[]).map((m) => <option key={m} value={m}>{MEASURE_LABELS[m]}</option>)}
            </select>
          </label>
        </div>
      </div>

      <CycleBar
        note={!received ? 'Producción todavía no envía su plan: puedes ver el neto, pero los ajustes se habilitan cuando lo reciba.' : undefined}
        cta={received && !closed ? {
          label: 'Cerrar el MPS final y devolver a Producción →',
          disabled: !editable || !canAdvance('MPS_FINAL'),
          title: why || undefined,
          hint: reds.length ? `Se cierra con ${reds.length} pendiente(s) de capacidad.` : 'La carga está dentro de la capacidad.',
          onClick: () => advance('MPS_FINAL', 'Distribución', `MPS final cerrado con ${adjustments.length} ajuste(s); ${reds.length} sobrecarga(s) pendiente(s)`),
        } : null}
      />

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-4 items-start">
        <div className="space-y-4 min-w-0">
          <section className="glass-panel rounded-3xl p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <h2 className="text-sm font-black">Producción por producto y semana</h2>
              <div className="inline-flex rounded-full bg-white/70 border border-white/80 p-0.5 text-[11px] font-bold" role="group" aria-label="Forma de verlo">
                {([['map', 'Mapa'], ['chart', 'Gráfico']] as const).map(([v, label]) => (
                  <button key={v} onClick={() => setView(v)} aria-pressed={view === v} className={`px-3 py-1.5 rounded-full cursor-pointer ${view === v ? 'bg-slate-950 text-white' : 'text-slate-600'}`}>{label}</button>
                ))}
              </div>
            </div>

            {flow !== 'all' && (
              <div className="mb-3 rounded-2xl bg-white/70 border border-white px-4 py-2 text-[11px]">
                Mostrando <b>{flow === 'cedi' ? 'solo CEDI' : 'solo bajo pedido (MTO)'}</b>. {flow === 'cedi' ? 'Es la necesidad que el DRP pide a la planta, ya descontados inventario y órdenes en curso.' : 'Hard Discount y Exportaciones entran completos: no se netean contra inventario ni pasan por el DRP.'} Los totales y la capacidad usan siempre todo.
              </div>
            )}
            {previewCuts && !previewAlt && (
              <div className="mb-3 rounded-2xl bg-[#DDCBF5]/55 border border-[#DDCBF5] px-4 py-2 text-xs"><b>Vista previa de la priorización:</b> así quedaría el MPS si se dejan de producir esas cajas. Todavía no se ha aplicado.</div>
            )}
            {previewAlt && (
              <div className="mb-3 rounded-2xl bg-[#DDCBF5]/55 border border-[#DDCBF5] px-4 py-2 text-xs flex items-center justify-between gap-3">
                <span><b>Vista previa de «{previewAlt.label}»:</b> así quedaría el MPS. Todavía no se ha aplicado. Las celdas con borde morado cambian.</span>
                {pinned && <button onClick={() => setPinned(null)} className="font-bold underline shrink-0 cursor-pointer">Quitar vista previa</button>}
              </div>
            )}

            {view === 'map' ? (
              <div className="overflow-x-auto">
                <div className="grid gap-1 min-w-[640px]" style={{ gridTemplateColumns: `150px repeat(${weeks.length}, minmax(40px, 1fr))` }}>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 self-end pb-1">Capacidad →</div>
                  {weeks.map((w) => {
                    const r = redIn(shownAlerts, w);
                    return (
                      <div key={w} title={r.length ? r.map((a) => `${crewName(a.crewId)}: déficit de ${fmtDec(a.excessHours)} h`).join('\n') : 'Capacidad suficiente'} className={`text-center rounded-lg py-1 ${w === sel.week ? 'bg-white' : ''}`}>
                        <div className="text-[10px] font-bold text-slate-500">{weekLabel(w)}</div>
                        <span className={`inline-block mt-0.5 rounded-full text-[9px] font-black px-1.5 py-0.5 text-black ${r.length ? 'bg-[#FFA27D]' : 'bg-[#7AFFA1]/70'}`}>{r.length ? `${r.length} sobrecarga${r.length > 1 ? 's' : ''}` : '✓'}</span>
                      </div>
                    );
                  })}
                  {dataset.skus.map((s) => (
                    <React.Fragment key={s.id}>
                      <button onClick={() => setSel({ ...sel, skuId: s.id })} className={`text-left rounded-xl px-2 py-1.5 cursor-pointer min-w-0 ${s.id === sel.skuId ? 'bg-white shadow-sm' : 'hover:bg-white/50'}`}>
                        <div className="text-[11px] font-black truncate" title={skuName(s.id)}>{skuName(s.id)}</div>
                        <div className="text-[9px] text-slate-500 truncate">{dataset.lines.find((l) => l.id === s.lineId)?.name.replace('Línea ', '')}</div>
                      </button>
                      {weeks.map((w) => {
                        const q = qtyOf(shownNet, s.id, w);
                        const changed = !!preview && Math.round(q) !== Math.round(qtyOf(baseNet, s.id, w));
                        const isSel = sel.skuId === s.id && sel.week === w;
                        const adj = adjusted(s.id, w);
                        return (
                          <button key={w} onClick={() => setSel({ skuId: s.id, week: w })} aria-label={`${skuName(s.id)}, semana del ${weekLabel(w)}: ${fmtInt(q)} cajas`}
                            title={`${fmtInt(convertCommercialQty(s, q, measure))} · CEDI bruto ${fmtInt(baseNet.find((r) => r.skuId === s.id && r.weekStart === w)?.grossCedi ?? 0)} · bajo pedido ${fmtInt(baseNet.find((r) => r.skuId === s.id && r.weekStart === w)?.grossMto ?? 0)} cajas`}
                            className={`h-9 rounded-lg font-mono text-[11px] font-bold cursor-pointer transition-all hover:brightness-95 ${adj ? 'bg-[#DDCBF5]' : 'bg-white/55'} ${isSel ? 'ring-2 ring-slate-950' : changed ? 'ring-2 ring-[#9b6fe0]' : ''}`}>
                            {q > 0 ? fmtCell(convertCommercialQty(s, q, measure)) : <span className="text-slate-300">—</span>}
                          </button>
                        );
                      })}
                    </React.Fragment>
                  ))}
                  <div className="text-xs font-black pt-2 pl-2">Total</div>
                  {totals.map((t, i) => <div key={weeks[i]} className="text-center font-mono text-[11px] font-black pt-2">{fmtCell(t)}</div>)}
                </div>
              </div>
            ) : (
              <div>
                <label className="text-[11px] font-bold text-slate-600 flex items-center gap-2 mb-2">
                  Ver
                  <select value={chartSku} onChange={(e) => setChartSku(e.target.value)} className="rounded-xl border border-black/10 bg-white/80 px-2.5 py-1.5 text-xs font-bold">
                    <option value="">Todos los productos, por planta</option>
                    {dataset.skus.map((s) => <option key={s.id} value={s.id}>{skuName(s.id)}</option>)}
                  </select>
                </label>
                <StackedBars
                  labels={weeks.map(weekLabel)}
                  unit={MEASURE_LABELS[measure].toLowerCase()}
                  height={230}
                  highlight={chartSku ? (i) => adjusted(chartSku, weeks[i]) : undefined}
                  stacks={chartSku
                    ? [{ name: skuName(chartSku), color: SERIES_COLORS[0], values: weeks.map((w) => convertCommercialQty(dataset.skus.find((s) => s.id === chartSku)!, qtyOf(shownNet, chartSku, w), measure)) }]
                    : dataset.plants.map((pl, k) => ({
                        name: pl.name,
                        color: SERIES_COLORS[k % SERIES_COLORS.length],
                        values: weeks.map((w) => dataset.skus.filter((s) => dataset.lines.find((l) => l.id === s.lineId)?.plantId === pl.id).reduce((acc, s) => acc + convertCommercialQty(s, qtyOf(shownNet, s.id, w), measure), 0)),
                      }))}
                />
                <div className="mt-2 grid gap-1 relative" style={{ gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))`, paddingLeft: '7.2%', paddingRight: '1.7%' }}>
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-500 leading-tight">Capacidad</div>
                  {weeks.map((w) => {
                    const r = redIn(shownAlerts, w);
                    return r.length > 0
                      ? <span key={w} className="text-center rounded-full bg-[#FFA27D] text-black font-black text-[9px] py-0.5">{r.length} sobrecarga{r.length > 1 ? 's' : ''}</span>
                      : <span key={w} className="text-center rounded-full bg-[#7AFFA1]/60 text-black font-black text-[9px] py-0.5">✓</span>;
                  })}
                </div>
              </div>
            )}
            <p className="text-[10px] text-slate-500 mt-3">
              Cifras en {MEASURE_LABELS[measure].toLowerCase()}{measure === 'commercial_units' ? ' (miles con «k»)' : ''}. Morado: celda ajustada por Distribución. La fila «Capacidad» dice si las líneas tienen capacidad suficiente (✓) o cuántas tripulaciones quedan con sobrecarga.{decisions.length > 0 ? ` Incluye ${decisions.length} decisión(es) de horas extra de Producción.` : ''} Flechas del teclado para moverte.
            </p>
          </section>

          {/* Antes de cerrar */}
          <section className="glass-panel rounded-3xl p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <h2 className="text-sm font-black">Antes de cerrar el MPS</h2>
              <span className={`text-[11px] font-black rounded-full px-3 py-1 text-black ${status.tone}`}>{status.label}</span>
            </div>
            <div className="mb-3">
              <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1.5"><span>Capacidad semana a semana</span><span className="font-bold text-slate-700">{weeks.length - redWeeks.size} de {weeks.length} semanas resueltas</span></div>
              <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))` }}>
                {weeks.map((w) => <span key={w} title={`${weekLabel(w)}: ${redWeeks.has(w) ? 'hay sobrecarga' : 'dentro de capacidad'}`} className={`h-2.5 rounded-full ${redWeeks.has(w) ? 'bg-[#FFA27D]' : 'bg-[#7AFFA1]'}`} />)}
              </div>
            </div>
            <ul className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {checks.map((it) => (
                <li key={it.title} className="flex items-start gap-2.5 rounded-2xl bg-white/50 px-3 py-2.5">
                  <span className={`mt-0.5 w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-[10px] font-black text-black ${icon[it.tone][0]}`}>{icon[it.tone][1]}</span>
                  <div className="min-w-0"><div className="text-xs font-black">{it.title}</div><div className="text-[11px] text-slate-600 leading-snug">{it.detail}</div></div>
                </li>
              ))}
            </ul>
            {why && <p className="text-[11px] text-slate-500 mt-3">{why}</p>}
          </section>
        </div>

        {/* Panel derecho */}
        <aside className="space-y-3 xl:sticky xl:top-[88px]">
          <section className="glass-panel rounded-3xl p-4 space-y-3">
            <div className="text-[11px] font-black uppercase tracking-wider text-slate-500">{skuName(sel.skuId)} · semana del {weekLabel(sel.week)}</div>
            <div className="flex items-baseline gap-3 flex-wrap">
              <span className="text-3xl font-black font-mono">{fmtInt(cellNet)}</span>
              <span className="text-xs text-slate-600">cajas{row && row.grossMto > 0 ? ` (${fmtInt(row.grossMto)} bajo pedido)` : ''}</span>
              <span className="text-xs text-slate-500">{fmtDec(cellNet * hpc, 1)} h de {line.name.replace('Línea ', '')}</span>
            </div>
            {crew && crewLoad && (
              <div className="rounded-2xl bg-white/60 border border-white px-3 py-2 text-xs">
                <div className="font-bold">{crewName(crew.id)} esa semana</div>
                <div className="mt-0.5 flex items-center gap-2">
                  <span className={`font-mono font-black ${pctNow > 100 ? 'text-[#c2410c]' : ''}`}>{fmtDec(pctNow, 0)} %</span>
                  {d !== 0 && <><span className="text-slate-400">→</span><span className={`font-mono font-black ${pctAfter > 100 ? 'text-[#c2410c]' : 'text-emerald-800'}`}>{fmtDec(pctAfter, 0)} %</span><span className="text-[11px] text-slate-500">con el ajuste de abajo</span></>}
                  <span className={`ml-auto text-[10px] font-black rounded-full px-2 py-0.5 ${crewLoad.excessHours > 0 ? 'bg-[#FFA27D]' : 'bg-[#7AFFA1]'}`}>{crewLoad.excessHours > 0 ? `déficit de ${fmtDec(crewLoad.excessHours, 1)} h` : 'cabe'}</span>
                </div>
              </div>
            )}
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Ajustar cajas</div>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {QUICK.map((q) => <button key={q} onClick={() => setDelta(String(q))} disabled={!editable} className={`text-[11px] font-bold rounded-full px-2.5 py-1 border cursor-pointer disabled:opacity-40 ${d === q ? 'bg-slate-950 text-white border-slate-950' : 'bg-white/70 border-white'}`}>{q > 0 ? '+' : ''}{fmtInt(q)}</button>)}
              </div>
              <div className="grid grid-cols-[100px_1fr] gap-2 text-xs">
                <input type="number" step="100" value={delta} onChange={(e) => setDelta(e.target.value)} disabled={!editable} aria-label="Cajas a sumar o restar" className="rounded-xl border border-black/10 bg-white/80 px-2.5 py-2 font-mono" />
                <input value={reason} onChange={(e) => setReason(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} disabled={!editable} placeholder="Motivo (obligatorio)" aria-label="Motivo" className="rounded-xl border border-black/10 bg-white/80 px-2.5 py-2" />
              </div>
              <button onClick={submit} disabled={!editable || !d || !reason.trim()} className="mt-2 w-full px-4 py-2 text-xs font-bold text-white bg-slate-950 rounded-full disabled:opacity-40 cursor-pointer">Registrar ajuste · {author}</button>
              {!editable && <p className="text-[11px] text-slate-500 mt-1.5">{closed ? 'El MPS ya está cerrado.' : !received ? 'Se habilita cuando Producción envíe su plan.' : 'Tu rol no puede ajustar el MPS.'}</p>}
            </div>
            {cellAdj.length > 0 && (
              <ul className="text-xs space-y-1 border-t border-black/5 pt-2">
                {cellAdj.map((a) => (
                  <li key={a.id} className="flex items-start justify-between gap-2"><span><span className="font-mono font-bold">{a.deltaCommercialQty > 0 ? '+' : ''}{fmtInt(a.deltaCommercialQty)}</span> · {a.reason} <span className="text-slate-400">({a.author})</span></span>{editable && <button onClick={() => removeAdjustment(a.id)} className="text-slate-400 hover:text-black cursor-pointer" aria-label="Quitar">✕</button>}</li>
                ))}
              </ul>
            )}
          </section>

          <details open className="glass-panel rounded-3xl p-4 text-xs">
            <summary className="font-black uppercase tracking-wider text-[11px] text-slate-500 cursor-pointer">¿De dónde sale esta cifra?</summary>
            {explain ? (
              <div className="mt-3 space-y-1.5">
                <p className="text-[11px] text-slate-500">{skuName(sel.skuId)} · semana del {weekLabel(sel.week)} · {plantOf?.name.replace(' (sint.)', '')}, línea {line.name.replace('Línea ', '')}</p>
                {([
                  ['Demanda CEDI (lo que pide el DRP)', explain.grossCedi, ''],
                  ['− Inventario al empezar la semana', -explain.startInventory, ''],
                  ['− Órdenes en curso que llegan', -explain.openOrders, ''],
                  ['= Falta producir para CEDI', explain.netCedi, 'sum'],
                  ['+ Hard Discount (bajo pedido)', explain.mtoByFlow.HARD_DISCOUNT ?? 0, ''],
                  ['+ Exportaciones (bajo pedido)', explain.mtoByFlow.EXPORT ?? 0, ''],
                  ['= Producción neta', explain.netProduction, 'sum'],
                  ['± Ajustes de Distribución', cellAdjSum, ''],
                  ['= MPS final de esta celda', cellNet, 'total'],
                ] as [string, number, string][]).map(([label, v, kind]) => (
                  <div key={label} className={`flex justify-between gap-3 ${kind === 'total' ? 'border-t border-black/10 pt-1.5 font-black text-sm' : kind === 'sum' ? 'font-black' : 'text-slate-700'}`}>
                    <span>{label}</span><span className="font-mono">{v > 0 && label.startsWith('±') ? '+' : ''}{fmtInt(v || 0)}</span>
                  </div>
                ))}
                <p className="text-[10px] text-slate-500 pt-1">Cifras en cajas. El inventario que sobra al terminar la semana ({fmtInt(explain.endInventory)} cajas) pasa a la siguiente.</p>
              </div>
            ) : <p className="mt-3 text-slate-500">Esta semana no tiene demanda para explicar.</p>}
          </details>

          <AltPicker alts={alts} chosenId={chosen?.id} onPick={setPicked} onHover={setHoverAlt}>
            {chosen && (
              <>
                {chosen.plan.moves.length > 0 ? (
                  <>
                    <p><b>{new Set(chosen.plan.moves.map((m) => `${m.skuId}|${m.fromWeek}|${m.toWeek}`)).size} movimientos</b> de producción a semanas anteriores ({fmtDec(chosen.metrics.movedHours, 1)} h).</p>
                    <button onClick={() => applyRebalanceMoves(chosen.plan, author)} disabled={!canMoves} className="px-3.5 py-1.5 text-[11px] font-black rounded-full bg-slate-950 text-white disabled:opacity-40 cursor-pointer">Aplicar como ajustes al MPS</button>
                    {!canMoves && <p className="text-[11px] text-slate-500">{movesReason}</p>}
                  </>
                ) : <p>Esta alternativa no mueve producción entre semanas.</p>}
                {chosen.plan.extraHours.length > 0 && <p className="text-slate-600">Quedan {fmtDec(chosen.metrics.extraHours, 1)} h para horas extra: las decide Producción en Capacidad.</p>}
                {chosen.metrics.unmetHours > 0 && <p className="font-bold text-[#c2410c]">Quedan {fmtDec(chosen.metrics.unmetHours, 1)} h sin cubrir.</p>}
                <button onClick={() => setPinned(pinned === chosen.id ? null : chosen.id)} className="text-[11px] font-bold underline cursor-pointer">{pinned === chosen.id ? 'Quitar vista previa del mapa' : 'Fijar la vista previa en el mapa'}</button>
              </>
            )}
          </AltPicker>

          <section className="glass-panel rounded-3xl p-4 text-xs" onMouseEnter={() => setHoverCuts(true)} onMouseLeave={() => setHoverCuts(false)}>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-[11px] font-black uppercase tracking-wider text-slate-500">Capacidad insuficiente: priorizar</h2>
              <span className="text-[10px] font-black rounded-full px-2 py-0.5 bg-[#DDCBF5]" title="Regla explicable: no usa un modelo de lenguaje. Sugiere: una persona decide.">✦ Asistente</span>
            </div>
            <p className="text-[11px] text-slate-600 mb-2">Cuando ni las horas extra ni adelantar producción resuelven una semana, hay que decidir qué se deja de producir. Los productos bajo pedido (MTO) nunca se recortan.</p>
            <div className="space-y-1" role="radiogroup" aria-label="Regla de prioridad">
              {RULES.map((r) => (
                <label key={r.id} className="flex items-start gap-2 cursor-pointer" title={r.hint}>
                  <input type="radio" name="priority-rule" checked={rule === r.id} onChange={() => setRule(r.id)} className="mt-0.5" />
                  <span><b>{r.label}</b><span className="block text-[10px] text-slate-500">{r.hint}</span></span>
                </label>
              ))}
            </div>
            {priority.overloaded === 0 ? (
              <p className="mt-3 font-bold text-emerald-800">No hace falta priorizar: la carga está dentro de la capacidad.</p>
            ) : (
              <div className="mt-3 space-y-2">
                <p><b>{fmtInt(priority.qtyCut)} cajas</b> ({fmtDec(priority.hoursCut, 1)} h) se dejarían de producir en {new Set(priority.cuts.map((c) => c.weekStart)).size} semana(s) para que todo quepa sin horas extra.</p>
                <ul className="space-y-1">
                  {priority.bySku.map((b) => (
                    <li key={b.skuId} className="flex justify-between gap-2"><span className="font-bold truncate">{skuName(b.skuId)}</span><span className="font-mono text-slate-600">−{fmtInt(b.qty)} · {fmtDec(b.hours, 1)} h{rule === 'RISK' ? ` · riesgo ${fmtDec((riskBySku[b.skuId] ?? 0) * 100, 0)} %` : ''}</span></li>
                  ))}
                </ul>
                {priority.unresolvedHours > 0 && <p className="font-bold text-[#c2410c]">Siguen faltando {fmtDec(priority.unresolvedHours, 1)} h porque lo que queda es bajo pedido.</p>}
                <button
                  onClick={() => { for (const c of priority.cuts) addAdjustment({ skuId: c.skuId, weekStart: c.weekStart, deltaCommercialQty: -c.qty, reason: `Priorización (${RULES.find((r) => r.id === rule)!.label.toLowerCase()})`, author }); setHoverCuts(false); }}
                  disabled={!canMoves} className="px-3.5 py-1.5 text-[11px] font-black rounded-full bg-slate-950 text-white disabled:opacity-40 cursor-pointer">Aplicar como ajustes al MPS</button>
                {!canMoves && <p className="text-[11px] text-slate-500">{movesReason}</p>}
                <p className="text-[10px] text-slate-500">Coloca el cursor por esta tarjeta para ver cómo quedaría el mapa. Es el último recurso: antes conviene revisar las alternativas de arriba.</p>
              </div>
            )}
          </section>

          <details className="glass-panel rounded-3xl p-4 text-xs">
            <summary className="font-black uppercase tracking-wider text-[11px] text-slate-500 cursor-pointer">Todos los ajustes ({adjustments.length})</summary>
            <div className="mt-3 space-y-2">
              {adjustments.length === 0 && <p className="text-slate-500">Todavía no hay ajustes.</p>}
              {adjustments.length > 1 && editable && <button onClick={() => adjustments.forEach((a) => removeAdjustment(a.id))} className="text-[11px] font-bold underline cursor-pointer">Quitar todos</button>}
              {adjustments.map((a) => (
                <div key={a.id} className="rounded-xl bg-white/70 px-3 py-2 flex items-start justify-between gap-2">
                  <span><b className="font-mono">{a.deltaCommercialQty > 0 ? '+' : ''}{fmtInt(a.deltaCommercialQty)}</b> {skuName(a.skuId)} · {weekLabel(a.weekStart)}<br /><span className="text-slate-500">{a.reason} · {a.author}</span></span>
                  {editable && <button onClick={() => removeAdjustment(a.id)} className="font-bold underline shrink-0 cursor-pointer">Quitar</button>}
                </div>
              ))}
            </div>
          </details>
        </aside>
      </div>
    </div>
  );
}
