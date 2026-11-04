import React, { useMemo } from 'react';
import { recommendTemplates } from '@ramo/engine';
import { useRamoPlan } from '../../ramo/store';
import { fmtDec, fmtInt, weekLabel } from '../../ramo/format';
import { ProcessStep } from '../../ramo/steps';
import { AiTag } from './ai';

/** Resumen: el recorrido MPS → CRP → esquema → día a día y lo que propone el asistente en cada paso. */
export function FocusSummary({ onSelectStep }: { onSelectStep: (s: ProcessStep) => void }) {
  const { dataset, stage, danielView, miguelView, weeks, daily, weeklyAltsCapacity, crewConfidence, templateOverrides, dailyAdjustments, allocationRule } = useRamoPlan();

  const stageText = { DRAFT: 'Borrador', SENT_TO_MPS: 'En revisión', MPS_FINAL: 'Cerrado', FINAL_ALERTS: 'Cerrado' }[stage];
  const totalCajas = danielView.net.reduce((a, r) => a + r.netProduction, 0);
  const crpRed = miguelView.alerts.length;
  const dailyRedWeeks = new Set(daily?.alerts.filter((a) => a.code === 'OVER_CAPACITY').map((a) => a.weekStart)).size;
  const rec = weeklyAltsCapacity.find((a) => a.recommended);
  const hidden = crewConfidence.filter((c) => c.requiredHours > 1e-6 && c.requiredHours <= c.nominalHours && c.pCovers < 0.9).sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  const hiddenWeeks = new Set(hidden.map((c) => c.weekStart)).size;

  const best = useMemo(() => {
    const out = (dataset.templates ?? [])
      .map((t) => {
        const r = recommendTemplates(dataset, danielView.net, t.id, { fromWeek: weeks[0], weeks: 4, overrides: templateOverrides, adjustments: dailyAdjustments, rule: allocationRule });
        const cur = r.find((e) => e.current);
        const top = r[0];
        if (!cur || !top || top.current) return null;
        return { name: t.name.split(' (')[0], gain: cur.excessHours + cur.unscheduledHours - (top.excessHours + top.unscheduledHours), days: top.changedDays };
      })
      .filter((x): x is { name: string; gain: number; days: number } => x !== null && x.gain > 0.05)
      .sort((a, b) => b.gain - a.gain);
    return out;
  }, [dataset, danielView.net, weeks, templateOverrides, dailyAdjustments, allocationRule]);

  const steps: { id: ProcessStep; code: string; title: string; value: string; note: string; bad: boolean; link: string }[] = [
    { id: 'crp', code: '1', title: 'Capacidad (CRP)', value: crpRed > 0 ? `${crpRed} en rojo` : 'Factible', note: crpRed > 0 ? 'tripulación-semana sobre capacidad' : 'cabe en el papel', bad: crpRed > 0, link: '⇄' },
    { id: 'mps', code: '2', title: 'MPS final', value: `${fmtInt(totalCajas)} cajas`, note: `${weeks.length} semanas · ${stageText}`, bad: false, link: '→' },
    { id: 'daily', code: '3', title: 'Esquemas y día a día', value: dailyRedWeeks > 0 ? `${dailyRedWeeks} sem. en rojo` : 'Factible', note: 'sale del plan cerrado', bad: dailyRedWeeks > 0, link: '' },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-black tracking-tight">Programación de capacidad</h1>
        <p className="text-sm text-slate-600 mt-1 max-w-3xl">
          La capacidad y el MPS se ajustan entre sí hasta cerrar el plan; el día a día sale del plan cerrado. ¿Cabe en la capacidad?, ¿en qué días se fabrica cada producto? y ¿qué tan seguro es que se cumpla? Todo se recalcula al instante cuando cambia el plan, un esquema o un día.
        </p>
        <p className="text-[11px] text-slate-500 mt-1">Ciclo: Producción revisa la capacidad (1) y la envía al MPS; Distribución ajusta y cierra (2); con el MPS cerrado el CRP vuelve a revisar y, si queda algo en rojo, se repite.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {steps.map((s) => (
          <button key={s.id} onClick={() => onSelectStep(s.id)} className="glass-card glass-card-hover rounded-3xl p-5 text-left cursor-pointer relative">
            <div className="flex items-center justify-between">
              <span className="w-7 h-7 rounded-full bg-slate-950 text-white text-xs font-black flex items-center justify-center">{s.code}</span>
              {s.link && <span className="hidden md:block absolute -right-3.5 top-1/2 -translate-y-1/2 text-slate-500 font-black z-10">{s.link}</span>}
            </div>
            <div className="mt-3 text-xs font-bold text-slate-500 uppercase tracking-wider">{s.title}</div>
            <div className={`mt-1 text-2xl font-black ${s.bad ? 'text-[#c2410c]' : ''}`}>{s.value}</div>
            <div className="text-[11px] text-slate-500 mt-0.5">{s.note}</div>
          </button>
        ))}
      </div>

      <div>
        <div className="flex items-center gap-2 mb-2">
          <h2 className="text-sm font-black">Lo que propone el asistente hoy</h2>
          <AiTag kind="Optimización" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div className="glass-panel rounded-3xl p-5 flex flex-col">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Cuando el MPS no cabe</div>
            {crpRed > 0 && rec ? (
              <>
                <div className="mt-1 text-sm font-black">3 alternativas; la recomendada es «{rec.label}»</div>
                <p className="text-xs text-slate-600 mt-1">Adelanta {fmtDec(rec.metrics.movedHours, 1)} h de producción y pide {fmtDec(rec.metrics.extraHours, 1)} h extra para resolver {fmtDec(rec.plan.excessBefore, 1)} h que faltan.</p>
              </>
            ) : (
              <p className="mt-1 text-xs text-emerald-800 font-bold">El MPS cabe en la capacidad semanal.</p>
            )}
            <button onClick={() => onSelectStep('crp')} className="mt-auto pt-3 text-xs font-bold underline text-left cursor-pointer">Ver las alternativas →</button>
          </div>

          <div className="glass-panel rounded-3xl p-5 flex flex-col">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Esquema de producción</div>
            {best.length > 0 ? (
              <>
                <div className="mt-1 text-sm font-black">Hay un esquema mejor para {best.length === 1 ? best[0].name : `${best.length} líneas`}</div>
                <p className="text-xs text-slate-600 mt-1">{best[0].name}: {fmtDec(best[0].gain, 1)} h menos de exceso en las próximas 4 semanas cambiando {best[0].days} día{best[0].days === 1 ? '' : 's'} del esquema.</p>
              </>
            ) : (
              <p className="mt-1 text-xs text-emerald-800 font-bold">Los esquemas vigentes ya son de los mejores para las próximas semanas.</p>
            )}
            <button onClick={() => onSelectStep('daily')} className="mt-auto pt-3 text-xs font-bold underline text-left cursor-pointer">Ver el esquema recomendado →</button>
          </div>

          <div className="glass-panel rounded-3xl p-5 flex flex-col">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Qué tan seguro es el plan</div>
            {hidden.length > 0 ? (
              <>
                <div className="mt-1 text-sm font-black">{hiddenWeeks} semana(s) en verde tienen riesgo</div>
                <p className="text-xs text-slate-600 mt-1">En alguna línea caben en el papel, pero con el rendimiento real tienen menos de 90 % de probabilidad de cumplirse; la primera es la del {weekLabel(hidden[0].weekStart)}.</p>
              </>
            ) : (
              <p className="mt-1 text-xs text-emerald-800 font-bold">Las semanas que caben en el papel también tienen más de 90 % de probabilidad de cumplirse.</p>
            )}
            <button onClick={() => onSelectStep('crp')} className="mt-auto pt-3 text-xs font-bold underline text-left cursor-pointer">Ver la confiabilidad →</button>
          </div>
        </div>
        <p className="text-[10px] text-slate-500 mt-2">Son sugerencias con el método a la vista: una persona decide. Ninguna usa un modelo de lenguaje. El historial de producción de este piloto es sintético.</p>
      </div>
    </div>
  );
}
