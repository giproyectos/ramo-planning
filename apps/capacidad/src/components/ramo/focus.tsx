import React, { useState } from 'react';
import { Alternative, CYCLE_ORDER, EXTRA_HOUR_WEIGHT, RebalancePlan, UNMET_HOUR_WEIGHT } from '@ramo/engine';
import { useRamoPlan } from '../../ramo/store';
import { useAuth } from '../../ramo/auth';
import { fmtDec, fmtInt, weekLabel } from '../../ramo/format';
import { Card } from './ui';
import { AiTag } from './ai';


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
