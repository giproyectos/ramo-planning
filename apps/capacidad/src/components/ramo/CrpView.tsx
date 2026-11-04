import React, { useEffect, useMemo, useState } from 'react';
import { CapacityDecision, toProductiveQty } from '@ramo/domain';
import { Alternative, CYCLE_ORDER, RebalancePlan, computeCrp, crpConfidence, movesToAdjustments, weekExceptions } from '@ramo/engine';
import { useRamoPlan } from '../../ramo/store';
import { useAuth } from '../../ramo/auth';
import { EXCEPTION_LABELS, fmtDec, fmtInt, weekLabel } from '../../ramo/format';
import { LineChart, SERIES_COLORS } from './charts';
import { Card, Disclosure, ProgressBar } from './ui';
import { ConfidenceChip } from './focus';
import { CycleBar } from './CycleBar';
import { AltPicker } from './AltPicker';

const paperColor = (pct: number) => (pct > 110 ? '#FFA27D' : pct > 100 ? '#FFF87C' : pct === 0 ? 'rgba(255,255,255,0.45)' : 'rgba(122,255,161,0.65)');

/** Capacidad (CRP): el mapa de saturación por tripulación y semana, lo que falla, qué propone el asistente y la decisión de horas extra. */
export function CrpView() {
  const {
    dataset, weeks, stage, crewMode, setCrewMode, miguelView, decisions, addDecision, removeDecision, advance, can, canAdvance, weeklyAltsCapacity, crewConfidence, efficiency,
    applyRebalanceExtra,
  } = useRamoPlan();
  const { user } = useAuth();
  const author = user?.name ?? 'Producción';

  const firstAlert = miguelView.alerts[0];
  const [sel, setSel] = useState<{ week: string; crewId: string }>(() => ({ week: firstAlert?.weekStart ?? weeks[0], crewId: firstAlert?.crewId ?? dataset.crews[0]?.id }));
  const [mode, setMode] = useState<'paper' | 'real'>('paper');
  const [hoverAlt, setHoverAlt] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [extra, setExtra] = useState('2');
  const [reason, setReason] = useState('');

  const stageIdx = CYCLE_ORDER.indexOf(stage);
  const editable = (stage === 'DRAFT' || stage === 'FINAL_ALERTS') && can('capacity.edit');
  const lineName = (id: string) => dataset.lines.find((l) => l.id === id)?.name ?? id;
  const crewName = (id: string) => dataset.crews.find((c) => c.id === id)?.name.replace('Tripulación ', '') ?? id;

  // ---- Vista previa de una alternativa sobre el mapa --------------------------------------------------------------------
  const alts = weeklyAltsCapacity;
  const recommended = alts.find((a) => a.recommended)?.id ?? alts[0]?.id ?? '';
  const chosen: Alternative<RebalancePlan> | undefined = alts.find((a) => a.id === (picked ?? recommended));
  const previewAlt = alts.find((a) => a.id === (hoverAlt ?? pinned));
  const preview = useMemo(() => {
    if (!previewAlt) return null;
    const net = miguelView.net.map((r) => ({ ...r }));
    for (const a of movesToAdjustments(previewAlt.plan.moves)) {
      const row = net.find((r) => r.skuId === a.skuId && r.weekStart === a.weekStart);
      if (row) row.netProduction = Math.max(0, row.netProduction + a.deltaCommercialQty);
    }
    const extraDecisions: CapacityDecision[] = previewAlt.plan.extraHours.map((e, i) => ({ id: `prev${i}`, crewId: e.crewId, weekStart: e.weekStart, extraHours: e.hours, reason: '', author: '', createdAt: '' }));
    const cap = computeCrp(dataset, net, { crewMode, decisions: [...decisions, ...extraDecisions] });
    return { cap, conf: crpConfidence(cap, efficiency, { sims: 200 }) };
  }, [previewAlt, miguelView.net, dataset, crewMode, decisions, efficiency]);

  const cap = preview?.cap ?? miguelView.capacity;
  const conf = preview?.conf ?? crewConfidence;
  const crewWeek = (c: typeof cap, w: string, id: string) => c.find((x) => x.weekStart === w)?.crews.find((x) => x.crewId === id);
  const confOf = (cf: typeof conf, w: string, id: string) => cf.find((x) => x.weekStart === w && x.crewId === id);

  // ---- Cifras de cabecera -----------------------------------------------------------------------------------------------
  const alerts = miguelView.alerts;
  const hoursToSolve = alerts.reduce((a, x) => a + x.excessHours, 0);
  const risky = crewConfidence.filter((c) => c.requiredHours > 1e-6 && c.requiredHours <= c.nominalHours + 0.05 && c.pCovers < 0.9).length;

  // ---- Selección y teclado ----------------------------------------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
      const wi = weeks.indexOf(sel.week);
      const ci = dataset.crews.findIndex((c) => c.id === sel.crewId);
      if (e.key === 'ArrowLeft') setSel({ ...sel, week: weeks[Math.max(0, wi - 1)] });
      else if (e.key === 'ArrowRight') setSel({ ...sel, week: weeks[Math.min(weeks.length - 1, wi + 1)] });
      else if (e.key === 'ArrowUp') setSel({ ...sel, crewId: dataset.crews[Math.max(0, ci - 1)].id });
      else if (e.key === 'ArrowDown') setSel({ ...sel, crewId: dataset.crews[Math.min(dataset.crews.length - 1, ci + 1)].id });
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sel, weeks, dataset.crews]);

  const crew = dataset.crews.find((c) => c.id === sel.crewId)!;
  const crewLoad = crewWeek(cap, sel.week, sel.crewId);
  const crewConf = confOf(conf, sel.week, sel.crewId);
  const weekCap = cap.find((w) => w.weekStart === sel.week);
  const weekDecisions = decisions.filter((d) => d.crewId === sel.crewId && d.weekStart === sel.week);

  const skuRows = useMemo(
    () =>
      miguelView.net
        .filter((r) => r.weekStart === sel.week)
        .map((r) => ({ r, sku: dataset.skus.find((s) => s.id === r.skuId)! }))
        .filter(({ sku }) => sku && crew?.lineIds.includes(sku.lineId))
        .map(({ r, sku }) => {
          const line = dataset.lines.find((l) => l.id === sku.lineId)!;
          const productive = toProductiveQty(sku, r.netProduction);
          return { sku, r, line, productive, hours: productive / line.rate.value };
        })
        .sort((a, b) => b.hours - a.hours),
    [crew, dataset, miguelView.net, sel.week],
  );

  const submitDecision = () => {
    const h = Number(extra);
    if (!(h > 0) || !reason.trim()) return;
    addDecision({ crewId: sel.crewId, weekStart: sel.week, extraHours: h, reason: reason.trim(), author });
    setReason('');
  };

  const cta =
    stage === 'DRAFT' ? { label: 'Enviar el plan de capacidades al MPS →', to: 'SENT_TO_MPS' as const, actor: 'Producción', text: `Plan de capacidades enviado a Distribución (${decisions.length} decisión(es), ${miguelView.alerts.length} alerta(s) abiertas)`, hint: `${alerts.length} semana(s) en rojo se envían con el plan; Distribución puede adelantar producción.` }
    : stage === 'MPS_FINAL' ? { label: 'Recargar el MPS final y emitir alertas →', to: 'FINAL_ALERTS' as const, actor: 'Producción', text: 'Recarga el MPS final, recalcula la explosión y emite las alertas de producción finales', hint: 'El MPS ya está cerrado: revisa si queda algo en rojo.' }
    : null;

  return (
    <div className="space-y-4">
      {/* Encabezado */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight">Capacidad (CRP)</h1>
          <p className="text-sm text-slate-600">¿Cabe el plan en las horas de cada tripulación? Elige una semana en el mapa para ver por qué y qué hacer.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-black">
          <span className={`rounded-full px-3 py-1.5 ${alerts.length ? 'bg-[#FFA27D]' : 'bg-[#7AFFA1]'}`}>{alerts.length ? `${alerts.length} en rojo · faltan ${fmtDec(hoursToSolve, 1)} h` : 'Todo cabe'}</span>
          <span className={`rounded-full px-3 py-1.5 ${risky ? 'bg-[#FFF87C]' : 'bg-[#7AFFA1]/70'}`} title="Semanas que caben en el papel pero tienen menos de 90 % de probabilidad de cumplirse con el rendimiento real">{risky ? `${risky} con riesgo real` : 'Sin riesgo real'}</span>
        </div>
      </div>

      <CycleBar
        note={stageIdx === 1 ? 'En manos de Distribución: se ajusta en la pantalla MPS.' : undefined}
        cta={cta ? { label: cta.label, hint: cta.hint, disabled: !canAdvance(cta.to), title: canAdvance(cta.to) ? undefined : 'Tu rol no puede avanzar este paso', onClick: () => advance(cta.to, cta.actor, cta.text) } : null}
        banner={stage === 'FINAL_ALERTS' ? (
          <div className={`mt-3 rounded-2xl px-4 py-2.5 text-xs font-bold border ${alerts.length ? 'bg-[#FFA27D]/30 border-[#FFA27D]' : 'bg-[#7AFFA1]/40 border-[#7AFFA1]'}`}>
            {alerts.length ? `Alertas finales: ${alerts.length} tripulación(es)-semana siguen sobre capacidad con el MPS final — ${alerts.map((a) => `${crewName(a.crewId)} ${weekLabel(a.weekStart)} (${fmtDec(a.excessHours)} h)`).join(' · ')}` : 'Alertas finales: la capacidad quedó resuelta en todo el horizonte con el MPS final.'}
          </div>
        ) : undefined}
      />

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-4 items-start">
        <div className="space-y-4 min-w-0">
          {/* Mapa */}
          <section className="glass-panel rounded-3xl p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <h2 className="text-sm font-black">Mapa de capacidad por tripulación y semana</h2>
              <div className="inline-flex rounded-full bg-white/70 border border-white/80 p-0.5 text-[11px] font-bold" role="group" aria-label="Qué mostrar en el mapa">
                {([['paper', 'Sobre el papel'], ['real', 'Con rendimiento real']] as const).map(([m, label]) => (
                  <button key={m} onClick={() => setMode(m)} aria-pressed={mode === m} className={`px-3 py-1.5 rounded-full cursor-pointer ${mode === m ? 'bg-slate-950 text-white' : 'text-slate-600'}`}>{label}</button>
                ))}
              </div>
            </div>

            {previewAlt && (
              <div className="mb-3 rounded-2xl bg-[#DDCBF5]/55 border border-[#DDCBF5] px-4 py-2 text-xs flex items-center justify-between gap-3">
                <span><b>Vista previa de «{previewAlt.label}»:</b> así quedaría la capacidad. Todavía no se ha aplicado. Las celdas con borde morado cambian.</span>
                {pinned && <button onClick={() => setPinned(null)} className="font-bold underline shrink-0 cursor-pointer">Quitar vista previa</button>}
              </div>
            )}

            <div className="overflow-x-auto">
              <div className="grid gap-1.5 min-w-[640px]" style={{ gridTemplateColumns: `124px repeat(${weeks.length}, minmax(40px, 1fr))` }}>
                <div />
                {weeks.map((w) => (
                  <div key={w} className={`text-center text-[10px] font-bold rounded-lg py-1 ${w === sel.week ? 'bg-white text-black' : 'text-slate-500'}`}>{weekLabel(w)}</div>
                ))}
                {dataset.crews.map((c) => (
                  <React.Fragment key={c.id}>
                    <button onClick={() => setSel({ ...sel, crewId: c.id })} className={`text-left rounded-xl px-2 py-2 text-xs font-black cursor-pointer ${c.id === sel.crewId ? 'bg-white shadow-sm' : 'hover:bg-white/50'}`}>
                      {crewName(c.id)}
                      {c.lineIds.length > 1 && <span className="ml-1.5 text-[9px] font-bold bg-[#DDCBF5] rounded-full px-1.5 py-0.5">compartida</span>}
                    </button>
                    {weeks.map((w) => {
                      const cl = crewWeek(cap, w, c.id);
                      const base = crewWeek(miguelView.capacity, w, c.id);
                      const cf = confOf(conf, w, c.id);
                      if (!cl) return <div key={w} />;
                      const selected = sel.week === w && sel.crewId === c.id;
                      const changed = !!preview && base && (Math.round(cl.saturationPct) !== Math.round(base.saturationPct) || cl.status !== base.status);
                      const over = cl.requiredHours > cl.availableHours + cl.extraHours + 0.05;
                      return (
                        <button key={w} onClick={() => setSel({ week: w, crewId: c.id })} aria-label={`${crewName(c.id)}, semana del ${weekLabel(w)}: ${fmtDec(cl.saturationPct, 0)} %`}
                          title={`${fmtDec(cl.requiredHours, 1)} h pedidas / ${fmtDec(cl.availableHours + cl.extraHours, 1)} h disponibles`}
                          className={`h-11 rounded-xl flex items-center justify-center cursor-pointer transition-all hover:brightness-95 ${selected ? 'ring-2 ring-slate-950' : changed ? 'ring-2 ring-[#9b6fe0]' : ''}`}
                          style={{ background: mode === 'paper' ? paperColor(cl.saturationPct) : 'rgba(255,255,255,0.45)' }}>
                          {mode === 'paper'
                            ? <span className="font-mono font-extrabold text-[11px]">{fmtDec(cl.saturationPct, 0)}%</span>
                            : cl.requiredHours <= 1e-6 ? <span className="text-slate-300">—</span>
                            : cf ? <ConfidenceChip p={cf.pCovers} over={over} compact title={`Carga ${fmtDec(cf.requiredHours, 1)} h · nominal ${fmtDec(cf.nominalHours, 1)} h · realista ${fmtDec(cf.realisticHours, 1)} h`} /> : null}
                        </button>
                      );
                    })}
                  </React.Fragment>
                ))}
              </div>
            </div>
            <p className="text-[10px] text-slate-500 mt-3">
              {mode === 'paper' ? 'Porcentaje de las horas disponibles que pide el plan. Verde: cabe · amarillo: pasa del 100 % · naranja: pasa del 110 %.' : 'Probabilidad de que la semana alcance la carga con el rendimiento real de las líneas. «No cabe»: ya pasa el 100 % sobre el papel.'} Flechas del teclado para moverte entre semanas y tripulaciones.
            </p>
          </section>

          {/* Horas en el horizonte */}
          {crew && (
            <Card title={`Horas de ${crewName(sel.crewId)} en todo el horizonte`} hint="Donde la línea naranja pasa por encima de la azul, faltan horas esa semana. La verde es lo que realmente se espera lograr según el historial.">
              <LineChart
                labels={weeks.map(weekLabel)}
                height={210}
                unit="h"
                series={[
                  { name: 'Horas que pide el plan', color: SERIES_COLORS[1], values: cap.map((w) => w.crews.find((x) => x.crewId === sel.crewId)?.requiredHours ?? 0) },
                  { name: 'Horas disponibles (con extras)', color: SERIES_COLORS[0], values: cap.map((w) => { const c = w.crews.find((x) => x.crewId === sel.crewId); return c ? c.availableHours + c.extraHours : 0; }), dashed: true },
                  { name: 'Horas realistas (mediana)', color: SERIES_COLORS[2], values: conf.filter((x) => x.crewId === sel.crewId).sort((a, b) => a.weekStart.localeCompare(b.weekStart)).map((x) => x.realisticHours), dashed: true },
                ]}
              />
            </Card>
          )}

          <details className="glass-panel rounded-3xl p-5 text-xs">
            <summary className="cursor-pointer font-black text-sm">¿Cómo se calculó? y opciones</summary>
            <div className="mt-3 space-y-4">
              <p className="text-slate-600">Horas que pide = necesidad neta (CEDI + Hard Discount + Exportaciones) × ritmo de cada línea ÷ horas netas del calendario. «Con rendimiento real» usa el historial de producción (sintético en este piloto): cuánto rinde cada línea de su ritmo nominal y cuánto varía.</p>
              <div>
                <div className="font-bold mb-1.5">Si dos líneas comparten tripulación…</div>
                <div className="inline-flex rounded-full bg-white/70 border border-white/80 p-0.5 font-bold">
                  {(['POOLED', 'INDEPENDENT'] as const).map((m) => (
                    <button key={m} onClick={() => setCrewMode(m)} className={`px-3 py-1.5 rounded-full cursor-pointer ${crewMode === m ? 'bg-slate-950 text-white' : 'text-slate-600'}`}>{m === 'POOLED' ? 'Suman sus horas' : 'Cada línea responde sola'}</button>
                  ))}
                </div>
                <p className="text-[11px] text-slate-500 mt-1">«Suman sus horas» es un supuesto provisional pendiente de confirmar con Producción; la mesa de programación muestra la capacidad real cuando la tripulación va una línea por día.</p>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {dataset.lines.map((l) => {
                  const e = efficiency[l.id];
                  return e ? (
                    <div key={l.id} className="rounded-xl bg-white/60 border border-white/80 px-3 py-2">
                      <div className="text-[10px] uppercase font-bold text-slate-500">{l.name}</div>
                      <div className="font-mono font-black text-lg">{fmtDec(e.mean * 100, 0)} %</div>
                      <div className="text-[10px] text-slate-500">del ritmo nominal · paradas el {fmtDec(e.stoppageRate * 100, 0)} % de los días</div>
                    </div>
                  ) : null;
                })}
              </div>
              <p className="text-[10px] text-slate-500">Estimado con 26 semanas de historial <b>sintético</b>: muestra el mecanismo, no afirma que acierte. Con el registro real de Ramo se valida contra semanas que el modelo no vio antes de usarlo para decidir.</p>
            </div>
          </details>
        </div>

        {/* Panel derecho */}
        <aside className="space-y-3 xl:sticky xl:top-[88px]">
          {/* Semana elegida */}
          {crewLoad && (
            <section className="glass-panel rounded-3xl p-4 space-y-3">
              <div className="text-[11px] font-black uppercase tracking-wider text-slate-500">{crewName(sel.crewId)} · semana del {weekLabel(sel.week)}</div>
              <div className="flex items-baseline gap-3 flex-wrap">
                <span className="text-3xl font-black font-mono">{fmtDec(crewLoad.saturationPct, 0)}%</span>
                <span className={`text-xs font-black rounded-full px-2.5 py-1 ${crewLoad.excessHours > 0 ? 'bg-[#FFA27D]' : 'bg-[#7AFFA1]'}`}>{crewLoad.excessHours > 0 ? `Faltan ${fmtDec(crewLoad.excessHours, 1)} h` : 'Cabe'}</span>
                {crewConf && crewLoad.requiredHours > 0 && <span className="text-[11px] text-slate-600 flex items-center gap-1">con rendimiento real <ConfidenceChip p={crewConf.pCovers} over={crewLoad.requiredHours > crewLoad.availableHours + crewLoad.extraHours + 0.05} compact /></span>}
              </div>
              <p className="text-xs text-slate-600">
                {fmtDec(crewLoad.requiredHours, 1)} h pedidas de {fmtDec(crewLoad.availableHours, 1)} h disponibles{crewLoad.extraHours > 0 ? ` + ${fmtDec(crewLoad.extraHours, 1)} h extra` : ''}
                {crewConf && crewLoad.requiredHours > 0 ? ` · se esperan ${fmtDec(crewConf.realisticHours, 1)} h productivas` : ''}.
              </p>
              {crew.lineIds.length > 1 && weekCap && (
                <div className="flex flex-wrap gap-1.5 text-[11px]">
                  {crew.lineIds.map((lid) => { const l = weekCap.lines.find((x) => x.lineId === lid); return l ? <span key={lid} className="rounded-full bg-white/70 border border-white px-2.5 py-1 font-bold">{lineName(lid).replace('Línea ', '')} {fmtDec(l.saturationPct, 0)} %</span> : null; })}
                </div>
              )}
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Qué consume las horas</div>
                <ul className="space-y-1.5">
                  {skuRows.slice(0, 4).map(({ sku, r, hours }) => (
                    <li key={sku.id}>
                      <div className="flex justify-between text-[11px]"><span className="font-bold truncate pr-2">{sku.name.replace(' (sint.)', '')}</span><span className="font-mono text-slate-600">{fmtDec(hours, 1)} h</span></div>
                      <ProgressBar value={hours} max={Math.max(crewLoad.requiredHours, crewLoad.availableHours + crewLoad.extraHours, 1)} mark={crewLoad.availableHours + crewLoad.extraHours} color={SERIES_COLORS[1]} height={6} />
                      {r.grossMto > 0 && <div className="text-[9px] text-slate-400">{fmtInt(r.grossMto)} cajas bajo pedido</div>}
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {crew.lineIds.flatMap((lid) => {
                    const cal = dataset.calendars.find((c) => c.lineId === lid);
                    return cal ? weekExceptions(cal, sel.week).map((e) => <span key={lid + e.date} className="text-[10px] font-bold rounded-full px-2 py-0.5 bg-[#DDCBF5]">{lineName(lid).replace('Línea ', '')}: {EXCEPTION_LABELS[e.reason]} {e.date.slice(5)} ({e.hours} h)</span>) : [];
                  })}
                </div>
              </div>
              <Disclosure title="Cifras por producto">
                <table className="w-full text-[11px]">
                  <thead><tr className="text-[10px] uppercase text-slate-500 text-left"><th className="py-1">Producto</th><th className="text-right">Cajas</th><th className="text-right">Horas</th></tr></thead>
                  <tbody>{skuRows.map(({ sku, r, hours }) => <tr key={sku.id} className="border-t border-black/5"><td className="py-1">{sku.name.replace(' (sint.)', '')}</td><td className="text-right font-mono">{fmtInt(r.netProduction)}</td><td className="text-right font-mono">{fmtDec(hours, 1)}</td></tr>)}</tbody>
                </table>
              </Disclosure>
            </section>
          )}

          <AltPicker alts={alts} chosenId={chosen?.id} onPick={setPicked} onHover={setHoverAlt}>
            {chosen && (
              <>
                {chosen.plan.moves.length > 0 && (
                  <p><b>{new Set(chosen.plan.moves.map((m) => `${m.skuId}|${m.fromWeek}|${m.toWeek}`)).size} movimientos</b> de producción a semanas anteriores: los aplica Distribución en la pantalla MPS.</p>
                )}
                {chosen.plan.extraHours.length > 0 ? (
                  <>
                    <div className="flex flex-wrap gap-1.5">{chosen.plan.extraHours.map((e) => <span key={`${e.crewId}${e.weekStart}`} className="text-[10px] font-bold rounded-full px-2 py-0.5 bg-[#FFF87C]">{crewName(e.crewId)} · {weekLabel(e.weekStart)} · {fmtDec(e.hours, 1)} h</span>)}</div>
                    <button onClick={() => applyRebalanceExtra(chosen.plan, author)} disabled={!editable} className="px-3.5 py-1.5 text-[11px] font-black rounded-full bg-slate-950 text-white disabled:opacity-40 cursor-pointer">Registrar estas horas extra</button>
                    {!editable && <p className="text-[11px] text-slate-500">{!can('capacity.edit') ? 'Tu rol no puede decidir horas extra.' : 'El plan está en manos de Distribución.'}</p>}
                  </>
                ) : chosen.metrics.unmetHours > 0 ? (
                  <p className="font-bold text-[#c2410c]">Quedan {fmtDec(chosen.metrics.unmetHours, 1)} h sin cubrir: hay que decidir qué hacer con ellas.</p>
                ) : <p className="text-emerald-800 font-bold">No necesita horas extra.</p>}
                <button onClick={() => setPinned(pinned === chosen.id ? null : chosen.id)} className="text-[11px] font-bold underline cursor-pointer">{pinned === chosen.id ? 'Quitar vista previa del mapa' : 'Dejar fija la vista previa en el mapa'}</button>
              </>
            )}
          </AltPicker>

          {/* Decisión manual */}
          <section className="glass-panel rounded-3xl p-4 space-y-2">
            <h2 className="text-[11px] font-black uppercase tracking-wider text-slate-500">Horas extra de esta semana</h2>
            <div className="grid grid-cols-[84px_1fr] gap-2 text-xs">
              <input type="number" min="0.5" step="0.5" value={extra} onChange={(e) => setExtra(e.target.value)} disabled={!editable} aria-label="Horas extra" className="rounded-xl border border-black/10 bg-white/80 px-2.5 py-2 font-mono" />
              <input value={reason} onChange={(e) => setReason(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submitDecision(); }} disabled={!editable} placeholder="Motivo (obligatorio)" aria-label="Motivo" className="rounded-xl border border-black/10 bg-white/80 px-2.5 py-2" />
            </div>
            <button onClick={submitDecision} disabled={!editable || !(Number(extra) > 0) || !reason.trim()} className="w-full px-4 py-2 text-xs font-bold text-white bg-slate-950 rounded-full disabled:opacity-40 cursor-pointer">Registrar horas extra · {author}</button>
            {!editable && <p className="text-[11px] text-slate-500">Bloqueado mientras el plan está en manos de Distribución.</p>}
            {weekDecisions.length > 0 && (
              <ul className="text-xs space-y-1 pt-1">
                {weekDecisions.map((d) => (
                  <li key={d.id} className="flex items-start justify-between gap-2"><span>+{d.extraHours} h · {d.reason} <span className="text-slate-400">({d.author})</span></span>{editable && <button onClick={() => removeDecision(d.id)} className="text-slate-400 hover:text-black cursor-pointer" aria-label="Quitar">✕</button>}</li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
