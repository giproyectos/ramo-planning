import React, { useMemo } from 'react';
import { RiskStatus } from '@ramo/engine';
import { useRamoPlan } from '../../ramo/store';
import { fmtDec, fmtInt, weekLabel } from '../../ramo/format';
import { ProcessStep } from '../../ramo/steps';
import { CycleStepper } from './CycleStepper';

type Tone = 'ok' | 'warn' | 'bad' | 'info';
const TONE: Record<Tone, string> = { ok: 'bg-[#7AFFA1]', warn: 'bg-[#FFF87C]', bad: 'bg-[#FFA27D]', info: 'bg-[#DDCBF5]' };

interface Card {
  step: ProcessStep;
  code: string;
  title: string;
  tone: Tone;
  badge: string;
  lines: string[];
}

interface Attention {
  step: ProcessStep;
  tone: Tone;
  text: string;
}

/** Resumen del plan: una mirada a todas las etapas, con cifras del motor real y lo que requiere atención. */
export function SummaryView({ onSelectStep }: { onSelectStep: (step: ProcessStep) => void }) {
  const {
    dataset, baseline, history, historyLabel, forecast, consensus, useForecast, userBlocks, drp, useDrp, baseNet, weeks, stage, danielView,
    adjustments, supplyRisk, pendingRecommendations, serverMode,
  } = useRamoPlan();

  const skuName = (id: string) => dataset.skus.find((s) => s.id === id)?.name ?? id;
  const crewName = (id: string) => dataset.crews.find((c) => c.id === id)?.name ?? id;
  const matName = (id: string) => dataset.materials?.find((m) => m.id === id)?.name ?? id;

  const demandByWeek = useMemo(() => {
    const m = new Map<string, number>();
    if (useForecast && consensus.length > 0) {
      for (const r of consensus) {
        if (r.flow === 'CEDI') m.set(r.weekStart, (m.get(r.weekStart) ?? 0) + r.commercialQty);
      }
    } else {
      for (const r of baseNet) m.set(r.weekStart, (m.get(r.weekStart) ?? 0) + r.grossCedi);
    }
    return m;
  }, [useForecast, consensus, baseNet]);
  const plantByWeek = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of drp?.plantRequirements ?? []) m.set(p.weekStart, (m.get(p.weekStart) ?? 0) + p.qty);
    return m;
  }, [drp]);
  const netByWeek = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of danielView.net) m.set(r.weekStart, (m.get(r.weekStart) ?? 0) + r.netProduction);
    return m;
  }, [danielView.net]);
  const maxSatByWeek = useMemo(() => {
    const m = new Map<string, { pct: number; crewId: string }>();
    for (const w of danielView.capacity) {
      const top = [...w.crews].sort((a, b) => b.saturationPct - a.saturationPct)[0];
      if (top) m.set(w.weekStart, { pct: top.saturationPct, crewId: top.crewId });
    }
    return m;
  }, [danielView.capacity]);

  const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
  const risks = supplyRisk?.risks ?? [];
  const riskCount = (s: RiskStatus) => risks.filter((r) => r.status === s).length;
  const stockouts = drp?.alerts.filter((a) => a.code === 'STOCKOUT') ?? [];
  const belowSafety = drp?.alerts.filter((a) => a.code === 'BELOW_SAFETY') ?? [];
  const spaceAlerts = drp?.alerts.filter((a) => a.code === 'SPACE') ?? [];
  const overloads = danielView.alerts;
  const worst = [...overloads].sort((a, b) => b.excessHours - a.excessHours)[0];
  const critRecs = pendingRecommendations.filter((r) => r.urgency === 'CRITICAL');
  const stageLabel = { DRAFT: 'Capacidad en borrador', SENT_TO_MPS: 'En revisión de Daniel', MPS_FINAL: 'MPS final cerrado', FINAL_ALERTS: 'Alertas finales emitidas' }[stage];

  const cards: Card[] = [
    {
      step: 'sop', code: 'Demanda', title: 'Plan de demanda',
      tone: forecast ? 'ok' : 'warn', badge: forecast ? 'Pronóstico activo' : 'Demanda fija',
      lines: forecast
        ? [`${fmtInt(sum(demandByWeek))} cajas CEDI en ${weeks.length} semanas`, `${forecast.n1.skus.length} productos pronosticados`, `${userBlocks.length} ajuste(s) propios · histórico: ${historyLabel}`]
        : [`${fmtInt(sum(demandByWeek))} cajas CEDI en ${weeks.length} semanas`, history.ok ? 'El histórico no alcanzó para pronosticar' : 'Histórico rechazado: se usa la demanda fija del dataset'],
    },
    {
      step: 'drp', code: 'DRP', title: 'Red de distribución',
      tone: !drp ? 'info' : stockouts.length > 0 ? 'bad' : belowSafety.length + spaceAlerts.length > 0 ? 'warn' : 'ok',
      badge: !drp ? 'Sin red' : stockouts.length > 0 ? `${stockouts.length} quiebre(s)` : 'Sin quiebres',
      lines: drp
        ? [`Necesidad hacia planta: ${fmtInt(sum(plantByWeek))} cajas`, `${belowSafety.length} bajo seguridad · ${spaceAlerts.length} de espacio`, useDrp ? 'Alimenta el MPS' : 'Apagado: el MPS usa la demanda directa']
        : ['El dataset no define una red de distribución'],
    },
    {
      step: 'mps', code: 'MPS', title: 'MPS final (Daniel)',
      tone: stage === 'MPS_FINAL' || stage === 'FINAL_ALERTS' ? 'ok' : stage === 'SENT_TO_MPS' ? 'warn' : 'info',
      badge: { DRAFT: 'Borrador', SENT_TO_MPS: 'En revisión', MPS_FINAL: 'Cerrado', FINAL_ALERTS: 'Cerrado' }[stage],
      lines: [`Producción neta: ${fmtInt(sum(netByWeek))} cajas`, `${adjustments.length} ajuste(s) de Daniel`, stageLabel],
    },
    {
      step: 'crp', code: 'CRP', title: 'Capacidad (Miguel)',
      tone: overloads.length > 0 ? 'bad' : 'ok', badge: overloads.length > 0 ? `${overloads.length} en rojo` : 'Factible',
      lines: worst
        ? [`Mayor faltante: ${fmtDec(worst.excessHours, 1)} h en ${crewName(worst.crewId)} (sem. ${weekLabel(worst.weekStart)})`, `Saturación ${fmtDec(worst.saturationPct, 0)} %`]
        : ['Las líneas alcanzan para el plan con las horas extra decididas'],
    },
    {
      step: 'mrp', code: 'MRP', title: 'Materiales',
      tone: !supplyRisk ? 'info' : riskCount('CRITICAL') > 0 ? 'bad' : riskCount('ORDER') > 0 ? 'warn' : 'ok',
      badge: !supplyRisk ? 'Sin materiales' : riskCount('CRITICAL') > 0 ? `${riskCount('CRITICAL')} crítico(s)` : 'Sin críticos',
      lines: supplyRisk
        ? [`${riskCount('CRITICAL')} ruptura en plazo · ${riskCount('ORDER')} pedir ya`, `${riskCount('WATCH')} vigilar · ${riskCount('OK')} sin riesgo cercano`]
        : ['El dataset no define materiales ni lista de materiales'],
    },
    {
      step: 'ai', code: 'Recomendaciones', title: 'Compras asistidas',
      tone: critRecs.length > 0 ? 'bad' : pendingRecommendations.length > 0 ? 'warn' : 'ok',
      badge: `${pendingRecommendations.length} pendiente(s)`,
      lines: [`${critRecs.length} críticas · ${pendingRecommendations.length - critRecs.length} otras`, 'Cada una se aprueba o rechaza con motivo'],
    },
  ];

  const attention: Attention[] = [];
  if (!baseline?.usable) attention.push({ step: 'data', tone: 'warn', text: 'El inventario del plan es el de ejemplo. Carga las bases SAP del lunes para partir del inventario real.' });
  if (!history.ok) attention.push({ step: 'sop', tone: 'warn', text: 'El histórico de demanda cargado no se pudo usar: el plan usa la demanda fija.' });
  for (const a of [...overloads].sort((x, y) => y.excessHours - x.excessHours).slice(0, 4))
    attention.push({ step: 'crp', tone: 'bad', text: `${crewName(a.crewId)} · sem. ${weekLabel(a.weekStart)}: faltan ${fmtDec(a.excessHours, 1)} h (${fmtDec(a.saturationPct, 0)} % de saturación).` });
  for (const a of stockouts.slice(0, 3)) {
    const node = dataset.nodes?.find((n) => n.id === a.nodeId)?.name ?? a.nodeId;
    attention.push({ step: 'drp', tone: 'bad', text: `Quiebre en ${node}${a.skuId ? ` · ${skuName(a.skuId)}` : ''} · sem. ${weekLabel(a.weekStart)}: ${fmtInt(a.value)} cajas sin cubrir.` });
  }
  for (const r of risks.filter((x) => x.status === 'CRITICAL').slice(0, 4))
    attention.push({ step: 'mrp', tone: 'bad', text: `${matName(r.materialId)}: se acaba el ${r.ruptureDate ?? '—'} y el plazo de entrega es de ${r.leadTimeDays} días${r.lateOrder ? '; hay una orden abierta que llega tarde' : ''}.` });
  for (const r of critRecs.slice(0, 3)) attention.push({ step: 'ai', tone: 'warn', text: r.title });
  if (stage === 'DRAFT' && overloads.length === 0) attention.push({ step: 'crp', tone: 'info', text: 'El plan de capacidad está en borrador: Miguel puede enviarlo a Daniel.' });

  return (
    <div className="space-y-5">
      <div className="glass-panel rounded-3xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
            <span className="w-2 h-2 rounded-full bg-[#7AFFA1]"></span>
            <span className="text-black font-extrabold">Resumen del plan</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black tracking-tight text-slate-950">De la demanda a los materiales, en una mirada</h1>
          <p className="text-xs text-slate-500 mt-0.5 font-medium max-w-3xl">
            Todo lo que ves aquí sale del mismo cálculo que las demás pantallas: lo que cambias en una etapa se refleja en las siguientes. Haz clic en una tarjeta para ir a esa etapa.
          </p>
        </div>
        <div className="text-[11px] font-semibold text-slate-600 space-y-0.5 shrink-0">
          <div>Inventario: <span className="font-black">{baseline?.usable ? 'bases SAP' : 'ejemplo sintético'}</span></div>
          <div>Plan de {weeks.length} semanas desde el {weeks[0] ? weekLabel(weeks[0]) : '—'}</div>
          <div>Modo: <span className="font-black">{serverMode ? 'con servidor (usuarios y auditoría)' : 'local (nada se guarda)'}</span></div>
        </div>
      </div>

      <CycleStepper showLog={false} />

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {cards.map((c) => (
          <button key={c.step} onClick={() => onSelectStep(c.step)} className="glass-card glass-card-hover rounded-3xl p-4 text-left cursor-pointer space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">{c.code}</div>
                <div className="text-sm font-black text-slate-950">{c.title}</div>
              </div>
              <span className={`text-[10px] font-extrabold px-2.5 py-1 rounded-full text-black ${TONE[c.tone]}`}>{c.badge}</span>
            </div>
            <ul className="text-xs text-slate-600 space-y-0.5">
              {c.lines.map((l) => <li key={l}>{l}</li>)}
            </ul>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.4fr_1fr] gap-5">
        <div className="glass-panel rounded-3xl p-5">
          <h2 className="text-sm font-black text-slate-950">Semana a semana</h2>
          <p className="text-[11px] text-slate-500 mb-2">Cajas por semana en cada etapa y la tripulación más saturada. La saturación en naranja supera el 100 %.</p>
          <div className="overflow-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-slate-400">
                  <th className="py-1.5 pr-3 font-bold">Semana</th>
                  <th className="py-1.5 pr-3 font-bold text-right">Demanda CEDI</th>
                  <th className="py-1.5 pr-3 font-bold text-right">Necesidad planta</th>
                  <th className="py-1.5 pr-3 font-bold text-right">Producción neta</th>
                  <th className="py-1.5 font-bold">Tripulación más cargada</th>
                </tr>
              </thead>
              <tbody>
                {weeks.map((w) => {
                  const s = maxSatByWeek.get(w);
                  return (
                    <tr key={w} className="border-t border-black/5">
                      <td className="py-1.5 pr-3 font-bold">{weekLabel(w)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{fmtInt(demandByWeek.get(w) ?? 0)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{drp ? fmtInt(plantByWeek.get(w) ?? 0) : '—'}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums font-bold">{fmtInt(netByWeek.get(w) ?? 0)}</td>
                      <td className="py-1.5">
                        {s ? <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-extrabold text-black ${s.pct > 100 ? 'bg-[#FFA27D]' : 'bg-[#7AFFA1]'}`}>{fmtDec(s.pct, 0)} % · {crewName(s.crewId)}</span> : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="glass-panel rounded-3xl p-5">
          <h2 className="text-sm font-black text-slate-950">Requiere atención</h2>
          <p className="text-[11px] text-slate-500 mb-2">Lo más urgente de cada etapa. Haz clic para ir a resolverlo.</p>
          {attention.length === 0 ? (
            <p className="text-xs text-slate-500">Nada urgente con los datos actuales.</p>
          ) : (
            <ul className="space-y-1.5">
              {attention.map((a, i) => (
                <li key={i}>
                  <button onClick={() => onSelectStep(a.step)} className="w-full text-left flex items-start gap-2 rounded-2xl px-2.5 py-2 hover:bg-white/80 cursor-pointer">
                    <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${TONE[a.tone]}`}></span>
                    <span className="text-xs text-slate-700">{a.text}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
