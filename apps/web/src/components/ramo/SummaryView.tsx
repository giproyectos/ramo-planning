import React, { useMemo } from 'react';
import { RiskStatus } from '@ramo/engine';
import { useRamoPlan } from '../../ramo/store';
import { fmtDec, fmtInt, weekLabel } from '../../ramo/format';
import { ProcessStep } from '../../ramo/steps';
import { CycleStepper } from './CycleStepper';
import { LineChart, SERIES_COLORS, Sparkline, fmtShort } from './charts';

type Tone = 'ok' | 'warn' | 'bad' | 'info';
const TONE_BG: Record<Tone, string> = { ok: 'bg-[#7AFFA1]', warn: 'bg-[#FFF87C]', bad: 'bg-[#FFA27D]', info: 'bg-[#DDCBF5]' };
const TONE_CHIP: Record<Tone, string> = { ok: 'bg-[#7AFFA1] text-black', warn: 'bg-[#FFF87C] text-black', bad: 'bg-[#FFA27D] text-black', info: 'bg-[#DDCBF5] text-black' };

const heat = (pct: number) => (pct > 110 ? '#FFA27D' : pct > 100 ? '#FFF87C' : pct > 85 ? '#9CF5B8' : '#CFFBE0');
const RISK_BAR: Record<RiskStatus, string> = { CRITICAL: '#e2683c', ORDER: '#e9b43b', WATCH: '#8b80d6', OK: '#3aa97f' };
const RISK_LABEL: Record<RiskStatus, string> = { CRITICAL: 'Ruptura dentro del plazo', ORDER: 'Pedir ya', WATCH: 'Vigilar', OK: 'Sin riesgo cercano' };

interface Attention { step: ProcessStep; tone: Tone; text: string }

function Panel({ title, hint, children, action, className = '' }: { title: string; hint?: string; children: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <section className={`glass-panel rounded-3xl p-5 ${className}`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h2 className="text-[15px] font-bold text-slate-900 leading-tight">{title}</h2>
          {hint && <p className="text-xs text-slate-500 mt-0.5">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Kpi({ label, value, unit, note, tone, spark, onClick }: { label: string; value: string; unit?: string; note: string; tone: Tone; spark?: number[]; onClick: () => void }) {
  return (
    <button onClick={onClick} className="glass-panel glass-card-hover rounded-2xl p-4 text-left cursor-pointer rise">
      <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
        <span className={`w-2 h-2 rounded-full ${TONE_BG[tone]}`}></span>
        {label}
      </div>
      <div className="mt-1.5 flex items-baseline gap-1.5">
        <span className="text-[28px] leading-none font-extrabold tracking-tight text-slate-900">{value}</span>
        {unit && <span className="text-xs font-semibold text-slate-500">{unit}</span>}
      </div>
      <div className="text-xs text-slate-500 mt-1.5 min-h-[16px]">{note}</div>
      {spark && <div className="mt-2"><Sparkline values={spark} color={tone === 'bad' ? '#c9601c' : '#2b50aa'} /></div>}
    </button>
  );
}

/** Resumen del plan: indicadores, evolución semanal, mapa de capacidad, riesgo de materiales y lo que requiere atención. */
export function SummaryView({ onSelectStep }: { onSelectStep: (step: ProcessStep) => void }) {
  const {
    dataset, baseline, history, forecast, consensus, useForecast, userBlocks, drp, useDrp, baseNet, weeks, stage, danielView,
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

  const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
  const series = (m: Map<string, number>) => weeks.map((w) => m.get(w) ?? 0);
  const risks = supplyRisk?.risks ?? [];
  const riskCount = (s: RiskStatus) => risks.filter((r) => r.status === s).length;
  const stockouts = drp?.alerts.filter((a) => a.code === 'STOCKOUT') ?? [];
  const belowSafety = drp?.alerts.filter((a) => a.code === 'BELOW_SAFETY') ?? [];
  const overloads = danielView.alerts;
  const critRecs = pendingRecommendations.filter((r) => r.urgency === 'CRITICAL');

  let peak = { pct: 0, crewId: '', week: '' };
  for (const w of danielView.capacity) for (const c of w.crews) if (c.saturationPct > peak.pct) peak = { pct: c.saturationPct, crewId: c.crewId, week: w.weekStart };
  const satSeries = weeks.map((w) => Math.max(0, ...(danielView.capacity.find((c) => c.weekStart === w)?.crews.map((c) => c.saturationPct) ?? [0])));

  const horizonDays = supplyRisk?.dates.length ?? 90;
  const riskRows = [...risks].filter((r) => r.status !== 'OK').sort((a, b) => ['CRITICAL', 'ORDER', 'WATCH'].indexOf(a.status) - ['CRITICAL', 'ORDER', 'WATCH'].indexOf(b.status) || (a.daysToRupture ?? 999) - (b.daysToRupture ?? 999)).slice(0, 8);

  const pipeline: { step: ProcessStep; name: string; tone: Tone; badge: string; detail: string }[] = [
    { step: 'sop', name: 'Demanda', tone: forecast ? 'ok' : 'warn', badge: forecast ? 'Pronóstico' : 'Fija', detail: `${fmtShort(sum(demandByWeek))} cajas · ${userBlocks.length} ajuste(s)` },
    { step: 'drp', name: 'Distribución', tone: !drp ? 'info' : stockouts.length > 0 ? 'bad' : belowSafety.length > 0 ? 'warn' : 'ok', badge: !drp ? 'Sin red' : stockouts.length > 0 ? `${stockouts.length} quiebre(s)` : 'Sin quiebres', detail: drp ? `${fmtShort(sum(plantByWeek))} cajas a planta${useDrp ? '' : ' (apagado)'}` : 'Sin red definida' },
    { step: 'mps', name: 'MPS final', tone: stage === 'DRAFT' ? 'info' : stage === 'SENT_TO_MPS' ? 'warn' : 'ok', badge: { DRAFT: 'Borrador', SENT_TO_MPS: 'En revisión', MPS_FINAL: 'Cerrado', FINAL_ALERTS: 'Cerrado' }[stage], detail: `${fmtShort(sum(netByWeek))} cajas · ${adjustments.length} ajuste(s)` },
    { step: 'crp', name: 'Capacidad', tone: overloads.length > 0 ? 'bad' : 'ok', badge: overloads.length > 0 ? `${overloads.length} en rojo` : 'Factible', detail: peak.pct > 0 ? `Pico ${fmtDec(peak.pct, 0)} % en ${crewName(peak.crewId)}` : 'Sin carga' },
    { step: 'mrp', name: 'Materiales', tone: !supplyRisk ? 'info' : riskCount('CRITICAL') > 0 ? 'bad' : riskCount('ORDER') > 0 ? 'warn' : 'ok', badge: !supplyRisk ? 'Sin datos' : riskCount('CRITICAL') > 0 ? `${riskCount('CRITICAL')} crítico(s)` : 'Sin críticos', detail: supplyRisk ? `${riskCount('ORDER')} pedir ya · ${riskCount('WATCH')} vigilar` : 'Sin lista de materiales' },
  ];

  const attention: Attention[] = [];
  if (!baseline?.usable) attention.push({ step: 'data', tone: 'warn', text: 'El inventario del plan es el de ejemplo. Carga las bases SAP del lunes para partir del inventario real.' });
  if (!history.ok) attention.push({ step: 'sop', tone: 'warn', text: 'El histórico de demanda cargado no se pudo usar: el plan usa la demanda fija.' });
  for (const a of [...overloads].sort((x, y) => y.excessHours - x.excessHours).slice(0, 3))
    attention.push({ step: 'crp', tone: 'bad', text: `${crewName(a.crewId)} · sem. ${weekLabel(a.weekStart)}: faltan ${fmtDec(a.excessHours, 1)} h (${fmtDec(a.saturationPct, 0)} %).` });
  for (const a of stockouts.slice(0, 2)) {
    const node = dataset.nodes?.find((n) => n.id === a.nodeId)?.name ?? a.nodeId;
    attention.push({ step: 'drp', tone: 'bad', text: `Quiebre en ${node}${a.skuId ? ` · ${skuName(a.skuId)}` : ''} · sem. ${weekLabel(a.weekStart)}: ${fmtInt(a.value)} cajas sin cubrir.` });
  }
  for (const r of critRecs.slice(0, 3)) attention.push({ step: 'ai', tone: 'warn', text: r.title });
  if (stage === 'DRAFT' && overloads.length === 0) attention.push({ step: 'crp', tone: 'info', text: 'El plan de capacidad está en borrador: Miguel puede enviarlo a Daniel.' });

  const labels = weeks.map(weekLabel);

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2 rise">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Plan de las próximas {weeks.length} semanas</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Desde el {weeks[0] ? weekLabel(weeks[0]) : '—'} · inventario {baseline?.usable ? 'de las bases SAP' : 'de ejemplo'} · {serverMode ? 'con servidor' : 'modo local, nada se guarda'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <Kpi label="Demanda a servir" value={fmtShort(sum(demandByWeek))} unit="cajas" note={forecast ? `${forecast.n1.skus.length} productos pronosticados` : 'Demanda fija del dataset'} tone={forecast ? 'ok' : 'warn'} spark={series(demandByWeek)} onClick={() => onSelectStep('sop')} />
        <Kpi label="Producción neta" value={fmtShort(sum(netByWeek))} unit="cajas" note={`${adjustments.length} ajuste(s) de Daniel`} tone="info" spark={series(netByWeek)} onClick={() => onSelectStep('mps')} />
        <Kpi label="Pico de capacidad" value={peak.pct > 0 ? fmtDec(peak.pct, 0) : '—'} unit="%" note={peak.pct > 0 ? `${crewName(peak.crewId)} · ${weekLabel(peak.week)}` : ''} tone={overloads.length > 0 ? 'bad' : 'ok'} spark={satSeries} onClick={() => onSelectStep('crp')} />
        <Kpi label="Materiales en riesgo" value={String(riskCount('CRITICAL') + riskCount('ORDER'))} unit={`de ${risks.length}`} note={`${riskCount('CRITICAL')} se rompen dentro del plazo`} tone={riskCount('CRITICAL') > 0 ? 'bad' : riskCount('ORDER') > 0 ? 'warn' : 'ok'} onClick={() => onSelectStep('mrp')} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-5">
        <Panel title="Del pedido a la fábrica" hint="Lo que se pronostica vender, lo que la red le pide a la planta y lo que finalmente se programa producir, por semana.">
          <LineChart
            labels={labels}
            series={[
              { name: 'Demanda CEDI', color: SERIES_COLORS[0], values: series(demandByWeek) },
              ...(drp ? [{ name: 'Necesidad hacia planta', color: SERIES_COLORS[2], values: series(plantByWeek), dashed: true }] : []),
              { name: 'Producción neta (MPS)', color: SERIES_COLORS[1], values: series(netByWeek) },
            ]}
          />
        </Panel>

        <Panel title="Estado del proceso" hint="Haz clic en una etapa para abrirla.">
          <ol className="relative">
            {pipeline.map((p, i) => (
              <li key={p.step} className="relative pl-7 pb-4 last:pb-0">
                {i < pipeline.length - 1 && <span className="absolute left-[7px] top-4 bottom-0 w-px bg-slate-200"></span>}
                <span className={`absolute left-0 top-1 w-[15px] h-[15px] rounded-full border-[3px] border-white ring-1 ring-black/10 ${TONE_BG[p.tone]}`}></span>
                <button onClick={() => onSelectStep(p.step)} className="w-full text-left cursor-pointer group">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-bold text-slate-900 group-hover:underline">{p.name}</span>
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${TONE_CHIP[p.tone]}`}>{p.badge}</span>
                  </div>
                  <div className="text-xs text-slate-500">{p.detail}</div>
                </button>
              </li>
            ))}
          </ol>
        </Panel>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <Panel title="Carga de cada tripulación" hint="Qué tan llena queda cada tripulación cada semana. Naranja = pasa del 110 %, amarillo = pasa del 100 %.">
          <div className="overflow-x-auto">
            <div className="min-w-[480px]">
              <div className="grid gap-1" style={{ gridTemplateColumns: `128px repeat(${weeks.length}, minmax(0, 1fr))` }}>
                <div></div>
                {weeks.map((w, i) => <div key={w} className="text-[10px] text-slate-400 text-center">{i % 2 === 0 ? weekLabel(w) : ''}</div>)}
                {dataset.crews.map((c) => (
                  <React.Fragment key={c.id}>
                    <div className="text-xs font-semibold text-slate-700 truncate pr-2 self-center">{c.name.replace('Tripulación ', '')}</div>
                    {weeks.map((w) => {
                      const cl = danielView.capacity.find((x) => x.weekStart === w)?.crews.find((x) => x.crewId === c.id);
                      const pct = cl?.saturationPct ?? 0;
                      return (
                        <button
                          key={w}
                          onClick={() => onSelectStep('crp')}
                          title={`${c.name} · sem. ${weekLabel(w)}: ${fmtDec(pct, 0)} %${cl && cl.excessHours > 0 ? ` · faltan ${fmtDec(cl.excessHours, 1)} h` : ''}`}
                          className="h-8 rounded-md text-[10px] font-bold text-slate-800 cursor-pointer hover:ring-2 hover:ring-slate-900/30"
                          style={{ background: cl ? heat(pct) : '#f2f4f7' }}
                        >
                          {pct > 100 ? fmtDec(pct, 0) : ''}
                        </button>
                      );
                    })}
                  </React.Fragment>
                ))}
              </div>
            </div>
          </div>
        </Panel>

        <Panel title="Materiales: ¿llegan a tiempo?" hint="La barra llega hasta el día en que se acaba el material; la marca negra es el plazo de entrega. Si la barra termina antes de la marca, ya no alcanza.">
          {riskRows.length === 0 ? (
            <p className="text-xs text-slate-500">Ningún material con riesgo cercano.</p>
          ) : (
            <ul className="space-y-2">
              {riskRows.map((r) => {
                const rupture = r.daysToRupture ?? horizonDays;
                const pct = (v: number) => `${Math.min(100, (v / horizonDays) * 100)}%`;
                return (
                  <li key={r.materialId}>
                    <button onClick={() => onSelectStep('mrp')} className="w-full text-left cursor-pointer group">
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="font-semibold text-slate-800 truncate pr-2 group-hover:underline">{matName(r.materialId).replace(' (sint.)', '')}</span>
                        <span className="text-slate-500 shrink-0">{r.daysToRupture !== null ? `se acaba en ${r.daysToRupture} d` : 'no se acaba'} · plazo {r.leadTimeDays} d</span>
                      </div>
                      <div className="relative h-2.5 rounded-full bg-slate-100">
                        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: pct(rupture), background: RISK_BAR[r.status] }} title={RISK_LABEL[r.status]}></div>
                        <div className="absolute -top-1 -bottom-1 w-0.5 bg-slate-900 rounded" style={{ left: pct(r.leadTimeDays) }}></div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-slate-500">
            {(['CRITICAL', 'ORDER', 'WATCH'] as RiskStatus[]).map((s) => (
              <span key={s} className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: RISK_BAR[s] }}></span>{RISK_LABEL[s]}</span>
            ))}
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_1.2fr] gap-5">
        <Panel title="Requiere atención" hint="Lo más urgente de cada etapa. Haz clic para resolverlo.">
          {attention.length === 0 ? (
            <p className="text-xs text-slate-500">Nada urgente con los datos actuales.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {attention.map((a, i) => (
                <li key={i}>
                  <button onClick={() => onSelectStep(a.step)} className="w-full text-left flex items-start gap-2.5 py-2 hover:bg-slate-50 cursor-pointer rounded-lg px-1">
                    <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${TONE_BG[a.tone]}`}></span>
                    <span className="text-[13px] text-slate-700 leading-snug">{a.text}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <CycleStepper showLog={false} />
      </div>
    </div>
  );
}
