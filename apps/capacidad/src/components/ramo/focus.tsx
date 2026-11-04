import React, { useMemo, useState } from 'react';
import {
  Alternative, CYCLE_ORDER, DailyBalancePlan, DailyWeek, EXTRA_HOUR_WEIGHT, RebalancePlan, TemplateEvaluation, UNMET_HOUR_WEIGHT, dailyAlternatives, recommendTemplates, weekdayOf,
  weekdayShort, weeklyConfidence,
} from '@ramo/engine';
import { useRamoPlan } from '../../ramo/store';
import { useAuth } from '../../ramo/auth';
import { fmtDec, fmtInt, weekLabel } from '../../ramo/format';
import { Card } from './ui';
import { SERIES_COLORS } from './charts';
import { AiTag } from './ai';

const DAY_NAME = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
const dayNum = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDate();
const dayName = (iso: string) => DAY_NAME[weekdayOf(iso) - 1];

/** Probabilidad de que el plan se cumpla, con color: verde ≥ 90 %, amarillo ≥ 70 %, naranja por debajo. */
export function ConfidenceChip({ p, title, compact, over }: { p: number; title?: string; compact?: boolean; over?: boolean }) {
  if (over) {
    return (
      <span title={title} className={`inline-flex items-center justify-center rounded-full font-black text-white bg-slate-700 ${compact ? 'text-[10px] px-1.5 py-0.5' : 'text-[11px] px-2.5 py-1'}`}>
        No cabe
      </span>
    );
  }
  const pct = Math.round(p * 100);
  const tone = p >= 0.9 ? 'bg-[#7AFFA1]' : p >= 0.7 ? 'bg-[#FFF87C]' : 'bg-[#FFA27D]';
  return (
    <span title={title} className={`inline-flex items-center justify-center rounded-full font-black text-black ${tone} ${compact ? 'text-[10px] px-1.5 py-0.5' : 'text-[11px] px-2.5 py-1'}`}>
      {p >= 0.995 ? '≈100 %' : p < 0.005 ? '0 %' : `${pct} %`}
    </span>
  );
}

// ------------------------------------------------------------------------------------------------------------------------
// Alternativas (tarjetas para elegir)
// ------------------------------------------------------------------------------------------------------------------------

function AlternativeTiles<P>({ alts, selected, onSelect, unit }: { alts: Alternative<P>[]; selected: string; onSelect: (id: string) => void; unit: 'semana' | 'día' }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {alts.map((a) => {
        const on = a.id === selected;
        return (
          <button
            key={a.id}
            onClick={() => onSelect(a.id)}
            aria-pressed={on}
            className={`text-left rounded-2xl p-4 border transition-all cursor-pointer ${on ? 'bg-slate-950 text-white border-slate-950 shadow-md' : 'bg-white/70 border-white/80 hover:bg-white'}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="text-sm font-black leading-tight">{a.label}</div>
              {a.recommended && <span className="text-[9px] font-black rounded-full px-2 py-0.5 bg-[#7AFFA1] text-black shrink-0">Recomendada</span>}
            </div>
            <p className={`text-[11px] mt-1 ${on ? 'text-slate-300' : 'text-slate-500'}`}>{a.description}</p>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-[10px]">
              <div>
                <dt className={`uppercase font-bold ${on ? 'text-slate-400' : 'text-slate-500'}`}>Mueve</dt>
                <dd className="font-mono font-black text-sm">{fmtDec(a.metrics.movedHours, 1)} h</dd>
              </div>
              <div>
                <dt className={`uppercase font-bold ${on ? 'text-slate-400' : 'text-slate-500'}`}>Horas extra</dt>
                <dd className="font-mono font-black text-sm">{fmtDec(a.metrics.extraHours, 1)} h</dd>
              </div>
              <div>
                <dt className={`uppercase font-bold ${on ? 'text-slate-400' : 'text-slate-500'}`}>{a.metrics.unmetHours > 0 ? 'Sin cubrir' : `Costo (${unit})`}</dt>
                <dd className="font-mono font-black text-sm">{a.metrics.unmetHours > 0 ? `${fmtDec(a.metrics.unmetHours, 1)} h` : fmtDec(a.metrics.cost, 1)}</dd>
              </div>
            </dl>
          </button>
        );
      })}
    </div>
  );
}

const COST_NOTE = `Costo relativo: cada hora de producción adelantada cuenta por las semanas que se adelanta, cada hora extra pesa ${EXTRA_HOUR_WEIGHT} y cada hora que queda sin cubrir ${UNMET_HOUR_WEIGHT}. Son pesos supuestos: se ajustan con Producción.`;

/** Alternativas para las semanas sobre capacidad (reemplaza a la sugerencia única). */
export function WeeklyAlternativesCard({ view }: { view: 'capacity' | 'mps' }) {
  const { dataset, weeklyAltsCapacity, weeklyAltsMps, applyRebalanceMoves, applyRebalanceExtra, stage, can } = useRamoPlan();
  const { user } = useAuth();
  const alts = view === 'capacity' ? weeklyAltsCapacity : weeklyAltsMps;
  const recommended = alts.find((a) => a.recommended)?.id ?? alts[0]?.id ?? '';
  const [picked, setPicked] = useState<string | null>(null);
  const sel = alts.find((a) => a.id === (picked ?? recommended)) ?? alts[0];
  if (!sel) return null;
  const plan: RebalancePlan = sel.plan;
  const sku = (id: string) => dataset.skus.find((s) => s.id === id)?.name.replace(' (sint.)', '') ?? id;
  const crew = (id: string) => dataset.crews.find((c) => c.id === id)?.name.replace('Tripulación ', '') ?? id;
  const author = user?.name ?? (view === 'capacity' ? 'Producción' : 'Distribución');
  const stageIdx = CYCLE_ORDER.indexOf(stage);

  const overloaded = alts[0].plan.overloaded;
  if (overloaded === 0) {
    return (
      <Card title="Alternativas de capacidad" action={<AiTag kind="Optimización" />}>
        <p className="text-xs text-emerald-800 font-bold">No hay semanas sobre capacidad: no hay nada que resolver.</p>
      </Card>
    );
  }

  const canMoves = stage === 'SENT_TO_MPS' && can('mps.edit');
  const canExtra = (stage === 'DRAFT' || stage === 'FINAL_ALERTS') && can('capacity.edit');
  const movesReason = !can('mps.edit') ? 'Tu rol no puede ajustar el MPS.' : stage !== 'SENT_TO_MPS' ? (stageIdx < 1 ? 'Los movimientos los aplica Distribución cuando Producción le envía el plan.' : 'El MPS ya está cerrado.') : '';
  const extraReason = !can('capacity.edit') ? 'Tu rol no puede decidir horas extra.' : stage === 'DRAFT' || stage === 'FINAL_ALERTS' ? '' : 'El plan está en manos de Distribución.';

  const grouped = Object.values(
    plan.moves.reduce<Record<string, { skuId: string; from: string; to: string; qty: number; hours: number }>>((acc, m) => {
      const k = `${m.skuId}|${m.fromWeek}|${m.toWeek}`;
      acc[k] = acc[k] ? { ...acc[k], qty: acc[k].qty + m.qty, hours: acc[k].hours + m.hours } : { skuId: m.skuId, from: m.fromWeek, to: m.toWeek, qty: m.qty, hours: m.hours };
      return acc;
    }, {}),
  );

  return (
    <Card
      title="Alternativas para resolver la sobrecarga"
      hint={`${overloaded} tripulación-semana(s) sobre capacidad, ${fmtDec(alts[0].plan.excessBefore, 1)} h por resolver. En vez de una sola sugerencia, tres formas de resolverlo con lo que cuesta cada una; una persona elige.`}
      action={<AiTag kind="Optimización" />}
    >
      <AlternativeTiles alts={alts} selected={sel.id} onSelect={setPicked} unit="semana" />
      <p className="text-[10px] text-slate-500 mt-2">{COST_NOTE}</p>

      <div className="mt-4 rounded-2xl bg-white/60 border border-white/80 p-4 space-y-3">
        <div className="text-xs font-black">{sel.label}</div>
        {grouped.length > 0 ? (
          <div>
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Adelantar producción ({grouped.length} movimiento{grouped.length > 1 ? 's' : ''})</div>
            <ul className="text-xs space-y-1">
              {grouped.slice(0, 6).map((m) => (
                <li key={`${m.skuId}${m.from}${m.to}`} className="flex flex-wrap items-center gap-x-2">
                  <span className="font-bold">{sku(m.skuId)}</span>
                  <span className="font-mono">{fmtInt(m.qty)} cajas</span>
                  <span className="text-slate-500">de la semana del {weekLabel(m.from)} a la del {weekLabel(m.to)} ({fmtDec(m.hours, 1)} h)</span>
                </li>
              ))}
              {grouped.length > 6 && <li className="text-slate-500">… y {grouped.length - 6} movimiento(s) más</li>}
            </ul>
            {view === 'mps' && (
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <button onClick={() => applyRebalanceMoves(plan, author)} disabled={!canMoves} className="px-4 py-2 text-xs font-bold text-white bg-slate-950 rounded-full disabled:opacity-40 cursor-pointer">Aplicar los movimientos como ajustes al MPS</button>
                {!canMoves && <span className="text-[11px] text-slate-500">{movesReason}</span>}
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-slate-600">Esta alternativa no mueve producción de una semana a otra.</p>
        )}

        {plan.extraHours.length > 0 && (
          <div>
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Horas extra · lo decide Producción</div>
            <div className="flex flex-wrap gap-2">
              {plan.extraHours.map((e) => (
                <span key={`${e.crewId}${e.weekStart}`} className="text-[11px] font-bold rounded-full px-2.5 py-1 bg-[#FFF87C] text-black">{crew(e.crewId)} · {weekLabel(e.weekStart)} · {fmtDec(e.hours, 1)} h</span>
              ))}
            </div>
            {view === 'capacity' && (
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <button onClick={() => applyRebalanceExtra(plan, author)} disabled={!canExtra} className="px-4 py-2 text-xs font-bold text-white bg-slate-950 rounded-full disabled:opacity-40 cursor-pointer">Registrar estas horas extra</button>
                {!canExtra && <span className="text-[11px] text-slate-500">{extraReason}</span>}
              </div>
            )}
          </div>
        )}
        {sel.metrics.unmetHours > 0 && (
          <p className="text-xs font-bold text-[#c2410c]">Quedan {fmtDec(sel.metrics.unmetHours, 1)} h sin cubrir: hay que decidir si se pide horas extra, se mueve a otra línea o se acepta el faltante.</p>
        )}
      </div>
      <p className="text-[10px] text-slate-500 mt-3">Heurística voraz sobre las restricciones de capacidad, no un óptimo matemático. No toca lo que es bajo pedido y no considera vida útil.</p>
    </Card>
  );
}

/** Alternativas para los días sobre capacidad de la semana elegida. */
export function DailyAlternativesCard({ weekData, editing }: { weekData: DailyWeek[]; editing: boolean }) {
  const { dataset, applyDailyBalance, can } = useRamoPlan();
  const { user } = useAuth();
  const alts = useMemo(() => dailyAlternatives(dataset, { weeks: weekData, alerts: [] }), [dataset, weekData]);
  const recommended = alts.find((a) => a.recommended)?.id ?? '';
  const [picked, setPicked] = useState<string | null>(null);
  const sel = alts.find((a) => a.id === (picked ?? recommended)) ?? alts[0];
  const sku = (id: string) => dataset.skus.find((s) => s.id === id)?.name.replace(' (sint.)', '') ?? id;
  const lineName = (id: string) => dataset.lines.find((l) => l.id === id)?.name ?? id;
  const author = user?.name ?? 'Producción';
  const canEdit = can('capacity.edit');
  const plan: DailyBalancePlan = sel.plan;

  if (plan.overloaded === 0) {
    return (
      <Card title="Alternativas de la semana" action={<AiTag kind="Optimización" />}>
        <p className="text-xs text-emerald-800 font-bold">Ningún día de esta semana pasa de su capacidad: no hay nada que resolver.</p>
      </Card>
    );
  }
  return (
    <Card
      title="Alternativas para los días en rojo"
      hint={`${plan.overloaded} día(s) sobre capacidad esta semana, ${fmtDec(plan.excessBefore, 1)} h por resolver. Tres secuencias posibles, con lo que cuesta cada una; una persona elige y aplica.`}
      action={<AiTag kind="Optimización" />}
    >
      <AlternativeTiles alts={alts} selected={sel.id} onSelect={setPicked} unit="día" />
      <div className="mt-4 rounded-2xl bg-white/60 border border-white/80 p-4 space-y-3">
        <div className="text-xs font-black">{sel.label}</div>
        {plan.moves.length > 0 ? (
          <ul className="text-xs space-y-1">
            {plan.moves.map((m) => (
              <li key={`${m.skuId}${m.fromDate}${m.toDate}`}>
                <span className="font-bold">{sku(m.skuId)}</span> · <span className="font-mono">{fmtInt(m.qty)} cajas</span> del {dayName(m.fromDate)} {dayNum(m.fromDate)} al {dayName(m.toDate)} {dayNum(m.toDate)} ({fmtDec(m.hours, 1)} h)
                <span className="ml-1 text-[10px] font-bold rounded-full px-2 py-0.5 bg-white/80 border border-black/5">{m.kind === 'PRODUCTION_DAY' ? 'día en que ya se produce' : 'día nuevo'}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-slate-600">Esta alternativa no mueve producción entre días.</p>
        )}
        {plan.extra.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {plan.extra.map((e) => <span key={`${e.lineId}${e.date}`} className="text-[11px] font-bold rounded-full px-2.5 py-1 bg-[#FFF87C] text-black">{lineName(e.lineId)} · {dayName(e.date)} {dayNum(e.date)} · {fmtDec(e.hours, 1)} h extra</span>)}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={() => applyDailyBalance(plan, author)} disabled={!canEdit || plan.moves.length === 0 || editing} className="px-4 py-2 text-xs font-bold text-white bg-slate-950 rounded-full disabled:opacity-40 cursor-pointer">Aplicar los movimientos de esta semana</button>
          {!canEdit && <span className="text-[11px] text-slate-500">Tu rol no puede mover producción.</span>}
        </div>
      </div>
      <p className="text-[10px] text-slate-500 mt-3">Heurística voraz. Adelantar producción adelanta el consumo de materiales; la secuencia entre sabores solo considera el tiempo de cambio.</p>
    </Card>
  );
}

// ------------------------------------------------------------------------------------------------------------------------
// Recomendador de esquema
// ------------------------------------------------------------------------------------------------------------------------

/** Mini tablero lunes a sábado de un esquema: qué producto va cada día. */
function SchemeStrip({ days, shifts, skuIds, skuName }: { days: Record<number, string[]>; shifts: Record<number, number>; skuIds: string[]; skuName: (id: string) => string }) {
  const cols = [1, 2, 3, 4, 5, 6].filter((d) => (shifts[d] ?? 0) > 0 || (days[d] ?? []).length > 0);
  return (
    <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(0, 1fr))` }}>
      {cols.map((d) => {
        const list = days[d] ?? [];
        return (
          <div key={d} className="min-w-0">
            <div className="text-[9px] font-bold text-slate-500 text-center">{weekdayShort(d)}</div>
            <div className="mt-0.5 space-y-0.5">
              {list.length === 0 ? (
                <div className="rounded-md border border-dashed border-black/10 text-[9px] text-slate-400 text-center py-1.5">libre</div>
              ) : (
                list.map((id) => (
                  <div key={id} title={skuName(id)} className="rounded-md text-[9px] font-bold text-black text-center py-1.5 px-0.5 truncate" style={{ background: SERIES_COLORS[Math.max(0, skuIds.indexOf(id)) % SERIES_COLORS.length] }}>
                    {skuName(id).split(' ')[0]} {skuName(id).split(' ')[1] ?? ''}
                  </div>
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const WEEKDAY_TOGGLES = [1, 2, 3, 4, 5, 6, 7];

/** Recomendador de esquema: prueba combinaciones de días por producto con el motor diario y propone las mejores frente al esquema vigente. */
export function TemplateAdvisorCard({ week }: { week: string }) {
  const { dataset, danielView, templateOverrides, dailyAdjustments, allocationRule, saveTemplateOverride, efficiency, daily, can } = useRamoPlan();
  const { user } = useAuth();
  const templates = dataset.templates ?? [];
  const defaultTemplate = useMemo(() => {
    const red = daily?.weeks.find((w) => w.weekStart === week && w.excessHours > 0.05);
    return red?.templateId ?? templates[0]?.id ?? '';
  }, [daily, week, templates]);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [horizon, setHorizon] = useState(4);
  const [blocked, setBlocked] = useState<number[]>([]);
  const tid = templateId ?? defaultTemplate;
  const tpl = templates.find((t) => t.id === tid);
  const skuName = (id: string) => dataset.skus.find((s) => s.id === id)?.name.replace(' (sint.)', '') ?? id;
  const skuIds = useMemo(() => dataset.skus.filter((s) => tpl?.lineIds.includes(s.lineId)).map((s) => s.id), [dataset, tpl]);

  const evals = useMemo<(TemplateEvaluation & { pAvg: number })[]>(() => {
    if (!tpl) return [];
    const list = recommendTemplates(dataset, danielView.net, tpl.id, {
      fromWeek: week, weeks: horizon, overrides: templateOverrides, adjustments: dailyAdjustments, rule: allocationRule, constraints: { blockedWeekdays: blocked },
    });
    return list.map((e) => {
      const wc = weeklyConfidence(dataset, e.result, efficiency, { sims: 200 }).filter((w) => w.requiredHours > 0);
      const pAvg = wc.length ? wc.reduce((a, w) => a + w.pCovers, 0) / wc.length : 1;
      return { ...e, pAvg };
    });
  }, [dataset, danielView.net, tpl, week, horizon, templateOverrides, dailyAdjustments, allocationRule, blocked, efficiency]);

  const [author, setAuthor] = useState(user?.name ?? 'Producción');
  const [done, setDone] = useState<string | null>(null);
  const canEdit = can('capacity.edit');
  if (!tpl) return null;
  const cur = evals.find((e) => e.current);
  const better = evals.filter((e) => !e.current);
  const evaluated = evals[0]?.evaluated ?? 0;

  return (
    <Card
      title="Esquema recomendado"
      hint="Prueba muchas combinaciones de días por producto con el motor diario y propone las que mejor cubren la necesidad de las próximas semanas frente al esquema vigente. Cada una se puede abrir y revisar antes de usarla."
      action={<AiTag kind="Optimización" />}
    >
      <div className="flex flex-wrap items-center gap-3 text-xs mb-3">
        <label className="flex items-center gap-2 font-bold">
          Línea o grupo
          <select value={tid} onChange={(e) => { setTemplateId(e.target.value); setDone(null); }} className="rounded-xl border border-black/10 bg-white/80 px-2.5 py-1.5 font-semibold">
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 font-bold">
          Evaluar
          <select value={horizon} onChange={(e) => setHorizon(Number(e.target.value))} className="rounded-xl border border-black/10 bg-white/80 px-2.5 py-1.5 font-semibold">
            {[2, 4, 6, 8].map((n) => <option key={n} value={n}>{n} semanas desde el {weekLabel(week)}</option>)}
          </select>
        </label>
        <div className="flex items-center gap-1.5">
          <span className="font-bold">No usar:</span>
          {WEEKDAY_TOGGLES.map((d) => {
            const off = blocked.includes(d);
            return (
              <button key={d} onClick={() => setBlocked(off ? blocked.filter((x) => x !== d) : [...blocked, d])} aria-pressed={off} title={off ? 'Día excluido del esquema' : 'Clic para excluir este día'}
                className={`text-[10px] font-black rounded-full px-2 py-1 cursor-pointer border ${off ? 'bg-slate-950 text-white border-slate-950' : 'bg-white/70 border-black/10 text-slate-700'}`}>
                {weekdayShort(d)}
              </button>
            );
          })}
        </div>
      </div>

      {better.length === 0 || (cur && better.every((e) => e.score >= cur.score - 0.05)) ? (
        <div className="rounded-2xl bg-[#7AFFA1]/25 border border-[#7AFFA1]/60 p-4 text-xs">
          <span className="font-black">El esquema vigente ya es de los mejores</span> entre las {fmtInt(evaluated)} combinaciones probadas para {tpl.name.toLowerCase()} en estas {horizon} semanas: ninguna reduce el exceso de capacidad ni los cambios de producto.
          {cur && <div className="mt-3 max-w-md"><SchemeStrip days={cur.days} shifts={cur.shifts} skuIds={skuIds} skuName={skuName} /></div>}
        </div>
      ) : (
        <div className="space-y-3">
          {cur && (
            <div className="rounded-2xl bg-white/60 border border-white/80 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <div className="text-xs font-black">Esquema vigente</div>
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="font-mono font-bold">{fmtDec(cur.excessHours + cur.unscheduledHours, 1)} h de exceso</span>
                  <span className="font-mono font-bold">{fmtDec(cur.changeoverHours, 1)} h de cambios</span>
                  <span className="text-slate-500">alcanza</span><ConfidenceChip p={cur.pAvg} compact title="Probabilidad media de cumplir cada semana con el rendimiento real de la línea" />
                </div>
              </div>
              <div className="max-w-xl"><SchemeStrip days={cur.days} shifts={cur.shifts} skuIds={skuIds} skuName={skuName} /></div>
            </div>
          )}
          {better.map((e, i) => (
            <div key={e.id} className={`rounded-2xl p-4 border ${i === 0 ? 'bg-white/90 border-[#7AFFA1] shadow-sm' : 'bg-white/60 border-white/80'}`}>
              <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                <div className="min-w-0">
                  <div className="text-xs font-black flex items-center gap-2">
                    {i === 0 && <span className="text-[9px] font-black rounded-full px-2 py-0.5 bg-[#7AFFA1] text-black">Mejor</span>}
                    <span className="truncate">{e.id.startsWith('combo-') ? `Opción ${i + 1}` : e.label}</span>
                  </div>
                  <ul className="mt-1 text-[11px] text-emerald-900 space-y-0.5">
                    {e.versusCurrent.map((v) => <li key={v}>✓ {v}</li>)}
                    <li className="text-slate-500">Cambia {e.changedDays} día{e.changedDays === 1 ? '' : 's'} del esquema</li>
                  </ul>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="font-mono font-bold">{fmtDec(e.excessHours + e.unscheduledHours, 1)} h de exceso</span>
                  <span className="font-mono font-bold">{fmtDec(e.changeoverHours, 1)} h de cambios</span>
                  <span className="text-slate-500">alcanza</span><ConfidenceChip p={e.pAvg} compact />
                </div>
              </div>
              <div className="max-w-xl"><SchemeStrip days={e.days} shifts={e.shifts} skuIds={skuIds} skuName={skuName} /></div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  onClick={() => {
                    saveTemplateOverride({
                      templateId: tpl.id, scope: 'FROM', weekStart: week, days: e.days, shifts: e.shifts,
                      reason: `Esquema recomendado por el asistente: ${e.versusCurrent.join('; ')}`, author: author.trim() || 'Producción',
                    });
                    setDone(e.id);
                  }}
                  disabled={!canEdit || done === e.id}
                  className="px-4 py-2 text-xs font-bold text-white bg-slate-950 rounded-full disabled:opacity-40 cursor-pointer"
                >
                  {done === e.id ? 'Esquema aplicado' : `Usar este esquema desde el ${weekLabel(week)}`}
                </button>
                {!canEdit && <span className="text-[11px] text-slate-500">Tu rol no puede cambiar esquemas.</span>}
              </div>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
            <label className="flex items-center gap-1.5">Quién cambia el esquema: <input value={author} onChange={(e) => setAuthor(e.target.value)} className="rounded-lg border border-black/10 bg-white/80 px-2 py-1 w-36" /></label>
          </div>
        </div>
      )}
      <p className="text-[10px] text-slate-500 mt-3">
        Se probaron {fmtInt(evaluated)} esquemas (un producto por día, sin cambios de turnos). Aún no se conocen las reglas reales de planta (qué sabores no pueden ir juntos, qué días no se puede producir un producto): se excluyen con los botones de arriba y se cargan como restricciones cuando Producción las confirme. Recomienda; una persona decide.
      </p>
    </Card>
  );
}

// ------------------------------------------------------------------------------------------------------------------------
// Confiabilidad del plan (capacidad real)
// ------------------------------------------------------------------------------------------------------------------------

export function ConfidenceCard() {
  const { dataset, crewConfidence, efficiency } = useRamoPlan();
  const weeks = [...new Set(crewConfidence.map((c) => c.weekStart))].sort();
  if (weeks.length === 0) return null;
  const hidden = crewConfidence.filter((c) => c.requiredHours > 1e-6 && c.requiredHours <= c.nominalHours && c.pCovers < 0.9);
  const hiddenWeeks = new Set(hidden.map((c) => c.weekStart)).size;
  const lineName = (id: string) => dataset.lines.find((l) => l.id === id)?.name ?? id;

  return (
    <Card
      title="¿Qué tan seguro es que el plan se cumpla?"
      hint="La capacidad de SAP es la nominal; en planta casi nunca se logra. Con el historial de producción de cada línea se estima cuánto rinde de verdad y cuánto varía, y cada tripulación-semana recibe la probabilidad de alcanzar la carga."
      action={<AiTag kind="Aprendizaje" />}
    >
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] uppercase text-slate-500">
              <th className="text-left font-bold pb-2 pr-3">Tripulación</th>
              {weeks.map((w) => <th key={w} className="font-bold pb-2 px-1 text-center whitespace-nowrap">{weekLabel(w)}</th>)}
            </tr>
          </thead>
          <tbody>
            {dataset.crews.map((crew) => (
              <tr key={crew.id} className="border-t border-black/5">
                <td className="py-2 pr-3 font-bold whitespace-nowrap">{crew.name.replace('Tripulación ', '')}</td>
                {weeks.map((w) => {
                  const c = crewConfidence.find((x) => x.weekStart === w && x.crewId === crew.id);
                  if (!c) return <td key={w} />;
                  if (c.requiredHours <= 1e-6) return <td key={w} className="text-center text-slate-300">—</td>;
                  return (
                    <td key={w} className="px-1 py-1.5 text-center">
                      <ConfidenceChip
                        p={c.pCovers}
                        over={c.requiredHours > c.nominalHours + 0.05}
                        compact
                        title={`Carga ${fmtDec(c.requiredHours, 1)} h · capacidad nominal ${fmtDec(c.nominalHours, 1)} h · realista ${fmtDec(c.realisticHours, 1)} h (rango ${fmtDec(c.realisticP10, 1)}–${fmtDec(c.realisticP90, 1)} h)`}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-slate-500 mt-2">«No cabe»: la carga ya supera la capacidad nominal (es lo que muestra el mapa de arriba en rojo). Verde ≥ 90 % · amarillo ≥ 70 % · naranja por debajo. Pasa el cursor por una celda para ver la carga, la capacidad nominal y la realista.</p>

      {hidden.length > 0 && (
        <div className="mt-4 rounded-2xl bg-[#FFF87C]/40 border border-[#FFF87C] p-3 text-xs">
          <span className="font-black">{hiddenWeeks} semana(s) que el CRP da por factibles en alguna tripulación tienen menos de 90 % de probabilidad de cumplirse</span> porque la línea rinde menos que su ritmo nominal. El CRP en verde solo dice que cabe en el papel.
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
        {dataset.lines.map((l) => {
          const e = efficiency[l.id];
          if (!e) return null;
          return (
            <div key={l.id} className="rounded-xl bg-white/60 border border-white/80 px-3 py-2">
              <div className="text-[10px] uppercase font-bold text-slate-500">{lineName(l.id)}</div>
              <div className="font-mono font-black text-lg">{fmtDec(e.mean * 100, 0)} %</div>
              <div className="text-[10px] text-slate-500">rinde del ritmo nominal · lunes {fmtDec(e.byWeekday[1] * 100, 0)} % · paradas el {fmtDec(e.stoppageRate * 100, 0)} % de los días</div>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-slate-500 mt-3">
        Estimado con 26 semanas de historial <b>sintético</b>: muestra el mecanismo, no afirma que acierte. Con el registro real de producción de Ramo se valida contra semanas que el modelo no vio antes de usarlo para decidir.
      </p>
    </Card>
  );
}
