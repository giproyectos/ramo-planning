import React, { useMemo, useState } from 'react';
import { MAKE_TO_ORDER_FLOWS, toProductiveQty } from '@ramo/domain';
import { CYCLE_ORDER, LoadStatus, lineAvailableHours, weekExceptions } from '@ramo/engine';
import { useRamoPlan } from '../../ramo/store';
import { useAuth } from '../../ramo/auth';
import { EXCEPTION_LABELS, fmtDec, fmtInt, weekLabel } from '../../ramo/format';
import { CycleStepper } from './CycleStepper';

const cellColor = (status: LoadStatus, pct: number) =>
  status === 'CRITICAL' ? 'bg-[#FFA27D] text-black' : status === 'OVER' ? 'bg-[#FFF87C] text-black' : pct === 0 ? 'bg-white/40 text-slate-400' : 'bg-[#7AFFA1]/60 text-black';

/** Vista de Miguel: capacidad por línea y tripulación, con decisiones de horas extra. */
export function CrpView() {
  const { dataset, weeks, stage, crewMode, setCrewMode, miguelView, decisions, addDecision, removeDecision, advance, can, canAdvance } = useRamoPlan();
  const [sel, setSel] = useState<{ week: string; crewId: string }>({ week: weeks[1] ?? weeks[0], crewId: 'C-BARMINI' });
  const [extra, setExtra] = useState('2');
  const [reason, setReason] = useState('');
  const { user: authUser } = useAuth();
  const [author, setAuthor] = useState(authUser?.name ?? 'Miguel');

  const stageIdx = CYCLE_ORDER.indexOf(stage);
  const editable = (stage === 'DRAFT' || stage === 'FINAL_ALERTS') && can('capacity.edit');
  const lineName = (id: string) => dataset.lines.find((l) => l.id === id)?.name ?? id;
  const crewName = (id: string) => dataset.crews.find((c) => c.id === id)?.name ?? id;

  const weekCap = miguelView.capacity.find((w) => w.weekStart === sel.week);
  const crewLoad = weekCap?.crews.find((c) => c.crewId === sel.crewId);
  const crew = dataset.crews.find((c) => c.id === sel.crewId);

  const skuRows = useMemo(() => {
    if (!crew) return [];
    return miguelView.net
      .filter((r) => r.weekStart === sel.week)
      .map((r) => ({ r, sku: dataset.skus.find((s) => s.id === r.skuId)! }))
      .filter(({ sku }) => sku && crew.lineIds.includes(sku.lineId) && (miguelView.net.length > 0))
      .map(({ r, sku }) => {
        const line = dataset.lines.find((l) => l.id === sku.lineId)!;
        const productive = toProductiveQty(sku, r.netProduction);
        return { sku, r, line, productive, hours: productive / line.rate.value };
      });
  }, [crew, dataset, miguelView.net, sel.week]);

  const weekDecisions = decisions.filter((d) => d.crewId === sel.crewId && d.weekStart === sel.week);
  const alerts = miguelView.alerts;

  const submitDecision = () => {
    const h = Number(extra);
    if (!(h > 0) || !reason.trim() || !author.trim()) return;
    addDecision({ crewId: sel.crewId, weekStart: sel.week, extraHours: h, reason: reason.trim(), author: author.trim() });
    setReason('');
  };

  return (
    <div className="space-y-5">
      <div className="glass-panel rounded-3xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
            <span className="w-2 h-2 rounded-full bg-[#FFA27D]"></span>
            <span className="text-black font-extrabold">CRP · Vista de Miguel</span>
            <span className="text-slate-300">·</span>
            <span>Horizonte {weeks.length} semanas</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black tracking-tight text-slate-950">Capacidad por línea y tripulación</h1>
          <p className="text-xs text-slate-500 mt-0.5 font-medium">
            Necesidad neta (CEDI + Hard Discount + Exportaciones) × ritmo ÷ horas netas del calendario = % de saturación. Datos sintéticos.
          </p>
        </div>
        <div className="flex flex-col items-start lg:items-end gap-2">
          <div className="inline-flex rounded-full bg-white/70 border border-white/80 p-0.5 text-[11px] font-bold">
            {(['POOLED', 'INDEPENDENT'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setCrewMode(m)}
                className={`px-3 py-1.5 rounded-full cursor-pointer ${crewMode === m ? 'bg-slate-950 text-white' : 'text-slate-600'}`}
              >
                {m === 'POOLED' ? 'Tripulación agrupada' : 'Líneas independientes'}
              </button>
            ))}
          </div>
          <span className="text-[10px] text-slate-500 max-w-xs lg:text-right">
            Agrupada = supuesto provisional: las horas de las líneas que comparten tripulación se suman. Pendiente de confirmar con Miguel.
          </span>
        </div>
      </div>

      <CycleStepper />

      {stage === 'FINAL_ALERTS' && (
        <div className={`rounded-3xl px-5 py-3 text-xs font-bold border ${alerts.length ? 'bg-[#FFA27D]/30 border-[#FFA27D]' : 'bg-[#7AFFA1]/40 border-[#7AFFA1]'}`}>
          {alerts.length
            ? `Alertas de producción finales: ${alerts.length} semana(s)/tripulación(es) siguen sobre capacidad tras el MPS final — ${alerts.map((a) => `${crewName(a.crewId)} ${weekLabel(a.weekStart)} (${fmtDec(a.excessHours)} h)`).join(' · ')}`
            : 'Alertas de producción finales: capacidad resuelta en todo el horizonte con el MPS final.'}
        </div>
      )}

      <div className="glass-panel rounded-3xl p-5 overflow-x-auto">
        <table className="w-full text-xs border-separate border-spacing-1">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-slate-500">
              <th className="text-left font-bold pr-2">Tripulación / línea</th>
              {weeks.map((w) => (
                <th key={w} className="font-mono font-bold">{weekLabel(w)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dataset.crews.map((c) => (
              <React.Fragment key={c.id}>
                <tr>
                  <td className="font-black text-slate-900 pr-2 whitespace-nowrap">
                    {c.name}
                    {c.lineIds.length > 1 && <span className="ml-1.5 text-[9px] font-bold bg-[#DDCBF5] rounded-full px-1.5 py-0.5">compartida</span>}
                  </td>
                  {miguelView.capacity.map((w) => {
                    const cl = w.crews.find((x) => x.crewId === c.id)!;
                    const selected = sel.week === w.weekStart && sel.crewId === c.id;
                    return (
                      <td key={w.weekStart}>
                        <button
                          onClick={() => setSel({ week: w.weekStart, crewId: c.id })}
                          className={`w-full rounded-lg px-1.5 py-1.5 font-mono font-extrabold cursor-pointer ${cellColor(cl.status, cl.saturationPct)} ${selected ? 'ring-2 ring-black' : ''}`}
                          title={`${fmtDec(cl.requiredHours)} h requeridas / ${fmtDec(cl.availableHours + cl.extraHours)} h disponibles`}
                        >
                          {fmtDec(cl.saturationPct, 0)}%
                        </button>
                      </td>
                    );
                  })}
                </tr>
                {c.lineIds.length > 1 &&
                  c.lineIds.map((lid) => (
                    <tr key={lid}>
                      <td className="text-slate-500 pl-4 pr-2 whitespace-nowrap">↳ {lineName(lid)}</td>
                      {miguelView.capacity.map((w) => {
                        const l = w.lines.find((x) => x.lineId === lid)!;
                        return (
                          <td key={w.weekStart} className={`text-center font-mono text-[11px] rounded-lg ${l.status === 'OK' ? 'text-slate-500' : 'text-[#c2410c] font-bold'}`}>
                            {fmtDec(l.saturationPct, 0)}%
                          </td>
                        );
                      })}
                    </tr>
                  ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
        <p className="text-[10px] text-slate-500 mt-2">Verde ≤ 100 % · amarillo &gt; 100 % · naranja &gt; 110 %. Clic en una celda para ver el detalle.</p>
      </div>

      {crewLoad && crew && (
        <div className="grid grid-cols-1 xl:grid-cols-[1.4fr_1fr] gap-5 items-start">
          <div className="glass-panel rounded-3xl p-5 space-y-4">
            <div>
              <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                {crewName(sel.crewId)} · semana del {weekLabel(sel.week)}
              </div>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-5 gap-y-1">
                <span className="text-3xl font-black font-mono">{fmtDec(crewLoad.saturationPct, 0)}%</span>
                <span className="text-xs text-slate-600">
                  {fmtDec(crewLoad.requiredHours)} h requeridas / {fmtDec(crewLoad.availableHours)} h disponibles
                  {crewLoad.extraHours > 0 && ` + ${fmtDec(crewLoad.extraHours)} h extra`}
                </span>
                <span className={`text-xs font-black ${crewLoad.excessHours > 0 ? 'text-[#c2410c]' : 'text-emerald-800'}`}>
                  {crewLoad.excessHours > 0 ? `Faltan ${fmtDec(crewLoad.excessHours)} h` : 'Factible'}
                </span>
              </div>
            </div>

            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] uppercase text-slate-500 text-left">
                  <th className="py-1">Línea</th><th>Ritmo</th><th className="text-right">Horas req.</th><th className="text-right">Horas disp.</th><th className="text-right">%</th>
                </tr>
              </thead>
              <tbody>
                {crew.lineIds.map((lid) => {
                  const l = weekCap!.lines.find((x) => x.lineId === lid)!;
                  const line = dataset.lines.find((x) => x.id === lid)!;
                  const cal = dataset.calendars.find((c) => c.lineId === lid)!;
                  const ex = weekExceptions(cal, sel.week);
                  return (
                    <React.Fragment key={lid}>
                      <tr className="border-t border-black/5">
                        <td className="py-1.5 font-bold">{line.name}</td>
                        <td className="font-mono">{fmtInt(line.rate.value)} {line.rate.unit}</td>
                        <td className="text-right font-mono">{fmtDec(l.requiredHours)}</td>
                        <td className="text-right font-mono">{fmtDec(lineAvailableHours(cal, sel.week))}</td>
                        <td className="text-right font-mono font-extrabold">{fmtDec(l.saturationPct, 0)}%</td>
                      </tr>
                      {ex.length > 0 && (
                        <tr>
                          <td colSpan={5} className="pb-1.5 text-[11px] text-slate-500">
                            Calendario: {ex.map((e) => `${EXCEPTION_LABELS[e.reason]} ${e.date.slice(5)} (${e.hours} h)`).join(' · ')}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>

            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] uppercase text-slate-500 text-left">
                  <th className="py-1">SKU</th><th className="text-right">Cajas netas</th><th className="text-right">Unid. productivas</th><th className="text-right">Horas</th><th className="text-right">Make-to-order</th>
                </tr>
              </thead>
              <tbody>
                {skuRows.map(({ sku, r, line, productive, hours }) => (
                  <tr key={sku.id} className="border-t border-black/5">
                    <td className="py-1.5">{sku.name} <span className="text-slate-400">· {line.id}</span></td>
                    <td className="text-right font-mono">{fmtInt(r.netProduction)}</td>
                    <td className="text-right font-mono">{fmtInt(productive)} {sku.productiveUnit}</td>
                    <td className="text-right font-mono">{fmtDec(hours)}</td>
                    <td className="text-right font-mono text-slate-500">{r.grossMto > 0 ? fmtInt(r.grossMto) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[10px] text-slate-500">
              Hard Discount y Exportaciones ({[...MAKE_TO_ORDER_FLOWS].join(', ')}) entran completos: no se netean contra inventario ni pasan por el DRP.
            </p>
          </div>

          <div className="glass-panel rounded-3xl p-5 space-y-3">
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Decisión de capacidad</div>
            <p className="text-xs text-slate-600">Horas extra / turno extendido para {crewName(sel.crewId)} la semana del {weekLabel(sel.week)}.</p>
            <div className="grid grid-cols-[90px_1fr] gap-2 text-xs">
              <input type="number" min="0.5" step="0.5" value={extra} onChange={(e) => setExtra(e.target.value)} disabled={!editable} aria-label="Horas extra" className="rounded-xl border border-black/10 bg-white/80 px-2.5 py-2 font-mono" />
              <input value={author} onChange={(e) => setAuthor(e.target.value)} disabled={!editable} aria-label="Autor" className="rounded-xl border border-black/10 bg-white/80 px-2.5 py-2" />
            </div>
            <input value={reason} onChange={(e) => setReason(e.target.value)} disabled={!editable} placeholder="Motivo (obligatorio)" aria-label="Motivo" className="w-full rounded-xl border border-black/10 bg-white/80 px-2.5 py-2 text-xs" />
            <button
              onClick={submitDecision}
              disabled={!editable || !(Number(extra) > 0) || !reason.trim()}
              className="w-full px-4 py-2 text-xs font-bold text-white bg-slate-950 rounded-full disabled:opacity-40 cursor-pointer"
            >
              Registrar horas extra
            </button>
            {!editable && <p className="text-[11px] text-slate-500">Bloqueado mientras el plan está en manos de Daniel.</p>}
            {weekDecisions.length > 0 && (
              <ul className="text-xs space-y-1 pt-1">
                {weekDecisions.map((d) => (
                  <li key={d.id} className="flex items-start justify-between gap-2">
                    <span>+{d.extraHours} h · {d.reason} <span className="text-slate-400">({d.author})</span></span>
                    {editable && <button onClick={() => removeDecision(d.id)} className="text-slate-400 hover:text-black cursor-pointer" aria-label="Quitar">✕</button>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        {stage === 'DRAFT' && (
          <button
            disabled={!canAdvance('SENT_TO_MPS')}
            title={canAdvance('SENT_TO_MPS') ? undefined : 'Tu rol no puede enviar el plan de capacidades'}
            onClick={() => advance('SENT_TO_MPS', 'Miguel', `Plan de capacidades enviado a Daniel (${decisions.length} decisión(es), ${miguelView.alerts.length} alerta(s) abiertas)`)}
            className="px-5 py-2.5 text-xs font-bold text-white bg-slate-950 rounded-full cursor-pointer disabled:opacity-40"
          >
            Enviar plan de capacidades al MPS →
          </button>
        )}
        {stage === 'MPS_FINAL' && (
          <button
            disabled={!canAdvance('FINAL_ALERTS')}
            title={canAdvance('FINAL_ALERTS') ? undefined : 'Tu rol no puede emitir las alertas finales'}
            onClick={() => advance('FINAL_ALERTS', 'Miguel', 'Recarga el MPS final, recalcula la explosión y emite las alertas de producción finales')}
            className="px-5 py-2.5 text-xs font-bold text-white bg-slate-950 rounded-full cursor-pointer disabled:opacity-40"
          >
            Recargar MPS final y emitir alertas →
          </button>
        )}
        {stageIdx === 1 && <span className="text-xs text-slate-500 self-center">En manos de Daniel (MPS final). Cambia a la vista MPS para ajustar.</span>}
      </div>
    </div>
  );
}
