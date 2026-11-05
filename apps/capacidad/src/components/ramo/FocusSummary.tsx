import React, { useMemo } from 'react';
import { CYCLE_ORDER, CycleStage, recommendTemplates, summarizePlants } from '@ramo/engine';
import { useRamoPlan } from '../../ramo/store';
import { fmtDec, fmtInt, weekLabel } from '../../ramo/format';
import { ProcessStep } from '../../ramo/steps';

const STAGE_TEXT: Record<CycleStage, string> = {
  DRAFT: 'Capacidad en borrador',
  SENT_TO_MPS: 'Enviado al MPS',
  MPS_FINAL: 'MPS final cerrado',
  FINAL_ALERTS: 'Alertas finales',
};

type Tone = 'bad' | 'warn' | 'ok' | 'info';
const TONE: Record<Tone, string> = { bad: 'bg-[#FFA27D]', warn: 'bg-[#FFF87C]', ok: 'bg-[#7AFFA1]', info: 'bg-[#DDCBF5]' };
const heatColor = (pct: number) => (pct > 110 ? '#FFA27D' : pct > 100 ? '#FFCB7D' : pct >= 85 ? '#FFF87C' : '#7AFFA1');

/** Resumen: qué toca hacer ahora, cómo está el plan semana a semana y qué conviene mirar primero. */
export function FocusSummary({ onSelectStep }: { onSelectStep: (s: ProcessStep) => void }) {
  const {
    dataset, stage, danielView, miguelView, weeks, daily, weeklyAltsCapacity, crewConfidence, templateOverrides, dailyAdjustments, allocationRule, adjustments, decisions, plantRows, plantRules, releases,
  } = useRamoPlan();
  const stageIdx = CYCLE_ORDER.indexOf(stage);
  const crewName = (id: string) => dataset.crews.find((c) => c.id === id)?.name.replace('Tripulación ', '') ?? id;

  const alerts = miguelView.alerts;
  const hoursToSolve = alerts.reduce((a, x) => a + x.excessHours, 0);
  const rec = weeklyAltsCapacity.find((a) => a.recommended);
  const riskyList = crewConfidence.filter((c) => c.requiredHours > 1e-6 && c.requiredHours <= c.nominalHours + 0.05 && c.pCovers < 0.9).sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  const riskyWeeks = new Set(riskyList.map((c) => c.weekStart)).size;
  const dailyOver = daily?.alerts.filter((a) => a.code === 'OVER_CAPACITY') ?? [];
  const dailyRedWeeks = new Set(dailyOver.map((a) => a.weekStart));
  const plantSum = summarizePlants(plantRows);
  const totalCajas = danielView.net.reduce((a, r) => a + r.netProduction, 0);

  const worstTemplate = useMemo(() => {
    const by = new Map<string, number>();
    for (const a of dailyOver) by.set(a.templateId, (by.get(a.templateId) ?? 0) + a.value);
    const top = [...by.entries()].sort((a, b) => b[1] - a[1])[0];
    return top ? { name: dataset.templates?.find((t) => t.id === top[0])?.name.split(' (')[0] ?? top[0], hours: top[1] } : null;
  }, [dailyOver, dataset.templates]);

  const bestScheme = useMemo(() => {
    const out = (dataset.templates ?? [])
      .map((t) => {
        const r = recommendTemplates(dataset, danielView.net, t.id, { fromWeek: weeks[0], weeks: 4, overrides: templateOverrides, adjustments: dailyAdjustments, rule: allocationRule, rules: plantRules });
        const cur = r.find((e) => e.current);
        const top = r[0];
        if (!cur || !top || top.current) return null;
        return { name: t.name.split(' (')[0], gain: cur.excessHours + cur.unscheduledHours - (top.excessHours + top.unscheduledHours), days: top.changedDays };
      })
      .filter((x): x is { name: string; gain: number; days: number } => x !== null && x.gain > 0.05)
      .sort((a, b) => b.gain - a.gain);
    return out[0] ?? null;
  }, [dataset, danielView.net, weeks, templateOverrides, dailyAdjustments, allocationRule, plantRules]);

  // ---- Siguiente paso, según el paso del ciclo -------------------------------------------------------------------------
  const next: { who: string; title: string; detail: string; go: ProcessStep; button: string } =
    stage === 'DRAFT' ? {
      who: 'Producción', go: 'crp', button: 'Ir a Capacidad →',
      title: alerts.length ? `Resuelve las ${alerts.length} semanas en rojo y envía el plan al MPS` : 'Envía el plan de capacidades al MPS',
      detail: alerts.length ? `Faltan ${fmtDec(hoursToSolve, 1)} h en total. Puedes registrar horas extra o dejar que Distribución adelante producción.` : 'Todo cabe en la capacidad.',
    } : stage === 'SENT_TO_MPS' ? {
      who: 'Distribución', go: 'mps', button: 'Ir al MPS →',
      title: alerts.length ? `Ajusta el MPS: quedan ${alerts.length} semanas en rojo` : 'El MPS cabe en la capacidad: ciérralo',
      detail: `${adjustments.length} ajuste(s) hechos. Al cerrarlo, el plan vuelve a Producción para las alertas finales.`,
    } : stage === 'MPS_FINAL' ? {
      who: 'Producción', go: 'crp', button: 'Ir a Capacidad →',
      title: 'Recarga el MPS final y emite las alertas de producción',
      detail: 'El MPS ya está cerrado: Producción revisa si queda algo en rojo.',
    } : releases.length === 0 && plantSum.pending === 0 && alerts.length === 0 ? {
      who: 'Producción', go: 'release', button: 'Ir al plan oficial →',
      title: 'Todo está confirmado: libera el plan oficial',
      detail: 'Se generan los archivos por planta y la versión queda guardada con su autor.',
    } : {
      who: 'Producción', go: 'daily', button: 'Ir a la mesa de programación →',
      title: alerts.length ? `Quedan ${alerts.length} semanas en rojo: revísalas en la mesa de programación` : 'Baja el plan a los días en la mesa de programación',
      detail: 'Con el MPS cerrado, decide qué se fabrica cada día y prueba los cambios en un borrador.',
    };

  // ---- Qué mirar primero -----------------------------------------------------------------------------------------------
  const worst = [...alerts].sort((a, b) => b.excessHours - a.excessHours).slice(0, 2);
  const items: { tone: Tone; title: string; detail: string; go: ProcessStep; button: string }[] = [];
  if (alerts.length > 0) {
    items.push({
      tone: 'bad', go: stage === 'SENT_TO_MPS' ? 'mps' : 'crp', button: 'Ver alternativas',
      title: `${alerts.length} tripulación-semana(s) sobre la capacidad`,
      detail: `${worst.map((w) => `${crewName(w.crewId)} ${weekLabel(w.weekStart)} (faltan ${fmtDec(w.excessHours, 1)} h)`).join(' · ')}${rec ? `. El asistente recomienda «${rec.label}»: adelanta ${fmtDec(rec.metrics.movedHours, 1)} h y pide ${fmtDec(rec.metrics.extraHours, 1)} h extra.` : '.'}`,
    });
  }
  if (bestScheme) {
    items.push({
      tone: 'warn', go: 'daily', button: 'Probar el esquema',
      title: `Hay un esquema mejor para ${bestScheme.name}`,
      detail: `${fmtDec(bestScheme.gain, 1)} h menos de exceso en las próximas 4 semanas cambiando ${bestScheme.days} día${bestScheme.days === 1 ? '' : 's'} del esquema.`,
    });
  }
  if (dailyRedWeeks.size > 0 && worstTemplate) {
    items.push({
      tone: 'bad', go: 'daily', button: 'Abrir la mesa',
      title: `${dailyRedWeeks.size} semana(s) con días sobre su capacidad`,
      detail: `${worstTemplate.name} es donde más faltan horas (${fmtDec(worstTemplate.hours, 0)} h en el horizonte). La mesa propone cómo moverlas entre días.`,
    });
  }
  if (plantSum.rows > 0 && (plantSum.pending > 0 || plantSum.shortfall > 0 || plantSum.planChanged > 0)) {
    items.push({
      tone: plantSum.shortfall > 0 || plantSum.planChanged > 0 ? 'bad' : 'info', go: 'plants', button: 'Abrir confirmación de plantas',
      title: plantSum.pending > 0 ? `${plantSum.pending} producto-semana(s) sin confirmar con las plantas` : plantSum.planChanged > 0 ? `${plantSum.planChanged} confirmación(es) quedaron viejas porque el MPS cambió` : `Las plantas no pueden fabricar ${fmtInt(plantSum.shortfall)} cajas`,
      detail: `${plantSum.shortfall > 0 ? `Faltan ${fmtInt(plantSum.shortfall)} cajas confirmadas por debajo del MPS. ` : ''}${plantSum.coverage !== null ? `Lo ya confirmado cubre ${fmtDec(plantSum.coverage * 100, 0)} % de lo que pide el MPS.` : 'Todavía no hay ninguna confirmación.'}`,
    });
  }
  if (riskyWeeks > 0) {
    items.push({
      tone: 'warn', go: 'crp', button: 'Ver con rendimiento real',
      title: `${riskyWeeks} semana(s) en verde tienen riesgo`,
      detail: `Caben en el papel, pero con el rendimiento real de la línea hay menos de 90 % de probabilidad de cumplirlas; la primera es la del ${weekLabel(riskyList[0].weekStart)}.`,
    });
  }
  if (items.length === 0) items.push({ tone: 'ok', go: 'daily', button: 'Ver la mesa', title: 'Todo en orden', detail: 'La capacidad alcanza, los esquemas vigentes son buenos y no hay semanas con riesgo.' });

  const cap = miguelView.capacity;
  const tiles: { label: string; value: string; note: string; tone: Tone; go: ProcessStep }[] = [
    { label: 'Producción del MPS', value: fmtInt(totalCajas), note: `cajas en ${weeks.length} semanas · ${adjustments.length} ajuste(s)`, tone: 'info', go: 'mps' },
    { label: 'Capacidad', value: alerts.length ? `${alerts.length} en rojo` : 'Todo cabe', note: alerts.length ? `faltan ${fmtDec(hoursToSolve, 1)} h` : `${decisions.length} decisión(es) de horas extra`, tone: alerts.length ? 'bad' : 'ok', go: 'crp' },
    { label: 'Riesgo real', value: riskyWeeks ? `${riskyWeeks} semanas` : 'Sin riesgo', note: 'caben en el papel, pero con menos de 90 % de probabilidad', tone: riskyWeeks ? 'warn' : 'ok', go: 'crp' },
    { label: 'Plantas', value: plantSum.rows === 0 ? '—' : plantSum.pending > 0 ? `${plantSum.pending} por confirmar` : plantSum.shortfall > 0 ? `faltan ${fmtInt(plantSum.shortfall)}` : 'Al día', note: plantSum.fulfillment !== null ? `cumplimiento de lo entregado ${fmtDec(plantSum.fulfillment * 100, 0)} %` : 'confirmación de lo que cada planta puede fabricar', tone: plantSum.rows === 0 ? 'info' : plantSum.pending > 0 ? 'info' : plantSum.shortfall > 0 ? 'bad' : 'ok', go: 'plants' },
    { label: 'Mesa de programación', value: dailyRedWeeks.size ? `${dailyRedWeeks.size} sem. en rojo` : 'Todo cabe', note: 'semanas con días sobre su capacidad', tone: dailyRedWeeks.size ? 'bad' : 'ok', go: 'daily' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight">Resumen del plan</h1>
          <p className="text-sm text-slate-600">Del {weeks[0] ? weekLabel(weeks[0]) : ''} al {weeks.length ? weekLabel(weeks[weeks.length - 1]) : ''}. La capacidad y el MPS se ajustan entre sí hasta cerrar el plan; el día a día sale del plan cerrado.</p>
        </div>
        <span className="rounded-full px-3 py-1.5 text-[11px] font-black bg-white/80 border border-white">Paso {stageIdx + 1} de 4 · {STAGE_TEXT[stage]}</span>
      </div>

      {/* Qué toca ahora */}
      <section className="rounded-3xl bg-slate-950 text-white p-5 sm:p-6 shadow-lg">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 max-w-2xl">
            <div className="text-[11px] font-black uppercase tracking-wider text-[#7AFFA1]">Qué toca ahora · {next.who}</div>
            <h2 className="mt-1.5 text-xl sm:text-2xl font-black leading-tight">{next.title}</h2>
            <p className="mt-1.5 text-sm text-slate-300">{next.detail}</p>
          </div>
          <button onClick={() => onSelectStep(next.go)} className="px-6 py-3 text-sm font-black text-black bg-[#7AFFA1] rounded-full cursor-pointer shrink-0 hover:brightness-95">{next.button}</button>
        </div>
        <ol className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-2" aria-label="Pasos del ciclo semanal">
          {CYCLE_ORDER.map((s, i) => (
            <li key={s} className={`rounded-2xl px-3 py-2 text-[11px] font-bold border ${i === stageIdx ? 'bg-white text-black border-white' : i < stageIdx ? 'bg-[#7AFFA1]/20 border-[#7AFFA1]/40 text-[#7AFFA1]' : 'bg-white/5 border-white/10 text-slate-400'}`}>
              <span className="font-mono opacity-70">{i < stageIdx ? '✓' : i + 1}</span> {STAGE_TEXT[s]}
            </li>
          ))}
        </ol>
      </section>

      {/* Cifras */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {tiles.map((t) => (
          <button key={t.label} onClick={() => onSelectStep(t.go)} className="glass-card glass-card-hover rounded-3xl p-4 text-left cursor-pointer">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-500"><span className={`w-2 h-2 rounded-full ${TONE[t.tone]}`} />{t.label}</div>
            <div className="mt-1.5 text-2xl font-black leading-none">{t.value}</div>
            <div className="mt-1 text-[11px] text-slate-500 leading-snug">{t.note}</div>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] gap-4 items-start">
        {/* Mapa del horizonte */}
        <section className="glass-panel rounded-3xl p-4 sm:p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-black">El horizonte de un vistazo</h2>
            <button onClick={() => onSelectStep('crp')} className="text-[11px] font-bold underline cursor-pointer">Abrir el mapa de capacidad</button>
          </div>
          <div className="overflow-x-auto">
            <div className="grid gap-1 min-w-[520px]" style={{ gridTemplateColumns: `120px repeat(${weeks.length}, minmax(26px, 1fr))` }}>
              <div />
              {weeks.map((w) => <div key={w} className="text-center text-[9px] font-bold text-slate-500">{weekLabel(w).replace(' ', ' ')}</div>)}
              {dataset.crews.map((c) => (
                <React.Fragment key={c.id}>
                  <button onClick={() => onSelectStep('crp')} className="text-left text-[11px] font-black truncate cursor-pointer hover:underline">{crewName(c.id)}</button>
                  {weeks.map((w) => {
                    const cl = cap.find((x) => x.weekStart === w)?.crews.find((x) => x.crewId === c.id);
                    return (
                      <button key={w} onClick={() => onSelectStep('crp')} title={cl ? `${crewName(c.id)} · ${weekLabel(w)}: ${fmtDec(cl.saturationPct, 0)} %` : ''} aria-label={cl ? `${crewName(c.id)} ${weekLabel(w)} ${fmtDec(cl.saturationPct, 0)} por ciento` : ''}
                        className="h-7 rounded-md cursor-pointer hover:brightness-95" style={{ background: cl && cl.requiredHours > 0 ? heatColor(cl.saturationPct) : 'rgba(255,255,255,0.4)' }} />
                    );
                  })}
                </React.Fragment>
              ))}
              <div className="text-[11px] font-black pt-1.5">Días en la mesa</div>
              {weeks.map((w) => (
                <button key={w} onClick={() => onSelectStep('daily')} title={`${weekLabel(w)}: ${dailyRedWeeks.has(w) ? 'hay días sobre su capacidad' : 'los días caben'}`} aria-label={`${weekLabel(w)}: ${dailyRedWeeks.has(w) ? 'hay días en rojo' : 'los días caben'}`}
                  className="h-3 mt-2 rounded-full cursor-pointer" style={{ background: dailyRedWeeks.has(w) ? '#FFA27D' : '#7AFFA1' }} />
              ))}
            </div>
          </div>
          <p className="text-[10px] text-slate-500 mt-3">Cada cuadro es una semana: verde cabe, amarillo pasa del 100 %, naranja pasa del 110 %. La fila de abajo dice si los días de esa semana caben según el esquema vigente.</p>
        </section>

        {/* Qué mirar primero */}
        <section className="glass-panel rounded-3xl p-4 sm:p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-black">Qué mirar primero</h2>
            <span className="text-[10px] font-black rounded-full px-2 py-0.5 bg-[#DDCBF5]" title="Cálculo de optimización y estadística; no usa un modelo de lenguaje. Sugiere: una persona decide.">✦ Asistente</span>
          </div>
          <ul className="space-y-2.5">
            {items.map((it) => (
              <li key={it.title} className="flex items-start gap-3 rounded-2xl bg-white/60 px-3.5 py-3">
                <span className={`mt-1 w-2.5 h-2.5 rounded-full shrink-0 ${TONE[it.tone]}`} />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-black leading-snug">{it.title}</div>
                  <div className="text-[11px] text-slate-600 leading-snug mt-0.5">{it.detail}</div>
                  <button onClick={() => onSelectStep(it.go)} className="mt-1.5 text-[11px] font-black underline cursor-pointer">{it.button} →</button>
                </div>
              </li>
            ))}
          </ul>
          <p className="text-[10px] text-slate-500 mt-3">Las sugerencias muestran su método y una persona decide. El historial de producción de este piloto es sintético.</p>
        </section>
      </div>
    </div>
  );
}
