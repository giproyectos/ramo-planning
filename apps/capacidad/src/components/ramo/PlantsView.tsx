import React, { useMemo, useState } from 'react';
import { PlantRow, PlantStatus, summarizePlants } from '@ramo/engine';
import { useRamoPlan } from '../../ramo/store';
import { useAuth } from '../../ramo/auth';
import { fmtDec, fmtInt, weekLabel } from '../../ramo/format';
import { ProcessStep } from '../../ramo/steps';
import { ProgressBar } from './ui';

const STATUS: Record<PlantStatus, { label: string; tone: string }> = {
  PENDING: { label: 'Pendiente', tone: 'bg-slate-200 text-slate-700' },
  CONFIRMED: { label: 'Confirmado', tone: 'bg-[#7AFFA1] text-black' },
  PARTIAL: { label: 'Parcial', tone: 'bg-[#FFF87C] text-black' },
  CANNOT: { label: 'No puede', tone: 'bg-[#FFA27D] text-black' },
};
const QUICK = [100, 90, 70, 50, 0];
const when = (iso: string) => iso.slice(0, 16).replace('T', ' ');
const keyOf = (r: { skuId: string; weekStart: string }) => `${r.skuId}|${r.weekStart}`;

/** Confirmación de plantas: Producción dice cuánto de lo que pide el MPS puede fabricar cada planta; todo queda con autor y motivo, y lo entregado se compara contra lo confirmado. */
export function PlantsView({ onSelectStep }: { onSelectStep: (s: ProcessStep) => void }) {
  const { dataset, weeks, stage, plantRows, confirmPlant, confirmPlantMany, recordDelivery, removeDelivery, can } = useRamoPlan();
  const { user } = useAuth();
  const author = user?.name ?? 'Producción';
  const canEdit = can('capacity.edit');

  const firstPending = useMemo(() => Math.max(0, weeks.findIndex((w) => plantRows.some((r) => r.weekStart === w && r.status === 'PENDING'))), [weeks, plantRows]);
  const [weekIdx, setWeekIdx] = useState<number | null>(null);
  const week = weeks[Math.min(weekIdx ?? firstPending, weeks.length - 1)];
  const [editing, setEditing] = useState<{ key: string; qty: string; reason: string } | null>(null);
  const [delivering, setDelivering] = useState<{ key: string; qty: string; note: string } | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const skuName = (id: string) => dataset.skus.find((s) => s.id === id)?.name.replace(' (sint.)', '') ?? id;
  const plantName = (id: string) => dataset.plants.find((p) => p.id === id)?.name.replace(' (sint.)', '') ?? id;
  const lineName = (id: string) => dataset.lines.find((l) => l.id === id)?.name.replace('Línea ', '') ?? id;

  const weekRows = plantRows.filter((r) => r.weekStart === week);
  const sumWeek = summarizePlants(weekRows);
  const sumAll = summarizePlants(plantRows);
  const plants = [...new Set(weekRows.map((r) => r.plantId))];
  const closed = stage === 'MPS_FINAL' || stage === 'FINAL_ALERTS';

  const weekState = (w: string) => {
    const rows = plantRows.filter((r) => r.weekStart === w);
    if (rows.length === 0) return 'none' as const;
    if (rows.some((r) => r.status === 'PENDING')) return 'pending' as const;
    if (rows.some((r) => r.status === 'PARTIAL' || r.status === 'CANNOT' || r.planChanged)) return 'short' as const;
    return 'ok' as const;
  };
  const weekColor = { none: '#e5e7eb', pending: '#cbd5e1', short: '#FFA27D', ok: '#7AFFA1' };

  const startEdit = (r: PlantRow) => setEditing({ key: keyOf(r), qty: String(r.current ? r.confirmedQty : r.plannedNow), reason: '' });
  const saveEdit = (r: PlantRow) => {
    if (!editing) return;
    const qty = Math.max(0, Math.round(Number(editing.qty) || 0));
    const needsReason = qty < r.plannedNow;
    if (needsReason && !editing.reason.trim()) return;
    confirmPlant({ skuId: r.skuId, weekStart: r.weekStart, plannedQty: r.plannedNow, confirmedQty: qty, reason: editing.reason.trim() || 'Confirmado completo', author });
    setEditing(null);
  };
  const confirmFull = (rows: PlantRow[]) =>
    confirmPlantMany(rows.map((r) => ({ skuId: r.skuId, weekStart: r.weekStart, plannedQty: r.plannedNow, confirmedQty: r.plannedNow, reason: 'Confirmado completo', author })));
  const saveDelivery = (r: PlantRow) => {
    if (!delivering) return;
    const qty = Math.round(Number(delivering.qty) || 0);
    if (qty <= 0) return;
    recordDelivery({ skuId: r.skuId, weekStart: r.weekStart, qty, note: delivering.note.trim(), author });
    setDelivering(null);
  };
  const toggle = (k: string) => setOpen((o) => { const n = new Set(o); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  // Historial reciente de todo el horizonte (confirmaciones y entregas), lo más nuevo primero.
  const events = useMemo(() => {
    const ev: { at: string; text: string; who: string }[] = [];
    for (const r of plantRows) {
      for (const c of r.history) ev.push({ at: c.createdAt, who: c.author, text: `${skuName(c.skuId)} · sem. ${weekLabel(c.weekStart)}: confirmó ${fmtInt(c.confirmedQty)} de ${fmtInt(c.plannedQty)} cajas — ${c.reason}` });
      for (const d of r.deliveries) ev.push({ at: d.createdAt, who: d.author, text: `${skuName(d.skuId)} · sem. ${weekLabel(d.weekStart)}: entregó ${fmtInt(d.qty)} cajas${d.note ? ` — ${d.note}` : ''}` });
    }
    return ev.sort((a, b) => b.at.localeCompare(a.at));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plantRows, dataset]);

  if (weeks.length === 0 || !week) return <div className="glass-panel rounded-3xl p-5 text-xs">No hay producción en el MPS para confirmar.</div>;

  const hoursOf = (r: PlantRow, qty: number) => {
    const sku = dataset.skus.find((s) => s.id === r.skuId);
    const line = dataset.lines.find((l) => l.id === r.lineId);
    if (!sku || !line) return 0;
    return (qty * sku.productiveUnitsPerCommercial) / line.rate.value;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight">Confirmación de plantas</h1>
          <p className="text-sm text-slate-600 max-w-3xl">Producción confirma qué puede fabricar cada planta de lo que pide el MPS. Cada confirmación queda con su autor y su motivo, y lo entregado se compara contra lo confirmado.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-black">
          <span className={`rounded-full px-3 py-1.5 ${sumAll.pending ? 'bg-slate-200' : 'bg-[#7AFFA1]'}`}>{sumAll.pending ? `${sumAll.pending} por confirmar` : 'Todo confirmado'}</span>
          <span className={`rounded-full px-3 py-1.5 ${sumAll.shortfall ? 'bg-[#FFA27D]' : 'bg-[#7AFFA1]/70'}`}>{sumAll.shortfall ? `faltan ${fmtInt(sumAll.shortfall)} cajas confirmadas` : 'Sin faltantes'}</span>
          {sumAll.fulfillment !== null && <span className="rounded-full px-3 py-1.5 bg-[#DDCBF5]">cumplimiento {fmtDec(sumAll.fulfillment * 100, 0)} %</span>}
        </div>
      </div>

      {!closed && (
        <div className="rounded-2xl bg-[#FFF87C]/45 border border-[#FFF87C] px-4 py-2.5 text-xs">
          <b>El MPS todavía no está cerrado.</b> Puedes confirmar con el plan actual; si cambia después, la fila lo marca («el MPS cambió») y el estado se recalcula con la cantidad nueva.
        </div>
      )}

      {/* Semanas */}
      <section className="glass-panel rounded-3xl p-4">
        <div className="flex items-end gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Semana">
          {weeks.map((w, i) => {
            const on = w === week;
            const st = weekState(w);
            return (
              <button key={w} role="tab" aria-selected={on} onClick={() => { setWeekIdx(i); setEditing(null); setDelivering(null); }} title={{ none: 'Sin producción', pending: 'Hay productos por confirmar', short: 'Confirmada por debajo del plan', ok: 'Confirmada completa' }[st]}
                className={`shrink-0 w-[58px] rounded-2xl px-1.5 pt-2 pb-1.5 text-center cursor-pointer transition-all ${on ? 'bg-white shadow-md ring-2 ring-slate-950' : 'bg-white/50 hover:bg-white/80'}`}>
                <div className="mx-auto h-2.5 w-8 rounded-full" style={{ background: weekColor[st] }} />
                <div className="text-[10px] font-bold text-slate-700 mt-1.5">{weekLabel(w)}</div>
              </button>
            );
          })}
        </div>
        <p className="text-[10px] text-slate-500 mt-2">Gris: hay productos por confirmar · naranja: confirmada por debajo del plan · verde: confirmada completa.</p>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_330px] gap-4 items-start">
        <div className="space-y-4 min-w-0">
          {plants.length === 0 && <div className="glass-panel rounded-3xl p-5 text-xs text-slate-600">Esta semana no hay producción pedida en el MPS.</div>}
          {plants.map((pid) => {
            const rows = weekRows.filter((r) => r.plantId === pid);
            const sum = summarizePlants(rows);
            const pending = rows.filter((r) => r.status === 'PENDING');
            return (
              <section key={pid} className="glass-panel rounded-3xl p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <div>
                    <h2 className="text-sm font-black">{plantName(pid)}</h2>
                    <p className="text-[11px] text-slate-500">{fmtInt(sum.planned)} cajas pedidas · {sum.coverage !== null ? `${fmtDec(sum.coverage * 100, 0)} % confirmado de lo ya revisado` : 'nada confirmado todavía'}</p>
                  </div>
                  {pending.length > 0 && (
                    <button onClick={() => confirmFull(pending)} disabled={!canEdit} className="px-4 py-2 text-xs font-black rounded-full bg-slate-950 text-white disabled:opacity-40 cursor-pointer">
                      Confirmar al 100 % lo pendiente ({pending.length})
                    </button>
                  )}
                </div>

                <div className="space-y-2">
                  {rows.map((r) => {
                    const k = keyOf(r);
                    const isEditing = editing?.key === k;
                    const isDelivering = delivering?.key === k;
                    const isOpen = open.has(k);
                    const st = STATUS[r.status];
                    const qtyNow = isEditing ? Math.max(0, Math.round(Number(editing!.qty) || 0)) : 0;
                    return (
                      <div key={k} className={`rounded-2xl border px-3.5 py-3 ${r.status === 'PENDING' ? 'bg-white/60 border-white' : r.status === 'CONFIRMED' ? 'bg-[#7AFFA1]/15 border-[#7AFFA1]/50' : 'bg-[#FFF87C]/20 border-[#FFD66B]'}`}>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                          <div className="min-w-[160px] flex-1">
                            <div className="text-xs font-black">{skuName(r.skuId)}</div>
                            <div className="text-[10px] text-slate-500">Línea {lineName(r.lineId)}</div>
                          </div>
                          <div className="text-center">
                            <div className="text-[10px] uppercase font-bold text-slate-500">Pide el MPS</div>
                            <div className="font-mono font-black text-sm">{fmtInt(r.plannedNow)}</div>
                          </div>
                          <div className="text-center min-w-[96px]">
                            <div className="text-[10px] uppercase font-bold text-slate-500">Confirmado</div>
                            <div className="font-mono font-black text-sm">{r.current ? fmtInt(r.confirmedQty) : '—'}{r.current && <span className="text-[10px] text-slate-500 font-bold"> · {fmtDec(r.coverage * 100, 0)} %</span>}</div>
                          </div>
                          <span className={`text-[10px] font-black rounded-full px-2.5 py-1 ${st.tone}`}>{st.label}</span>
                          <div className="flex items-center gap-2 ml-auto">
                            {r.status === 'PENDING' ? (
                              <>
                                <button onClick={() => confirmFull([r])} disabled={!canEdit} className="px-3 py-1.5 text-[11px] font-black rounded-full bg-[#7AFFA1] text-black disabled:opacity-40 cursor-pointer">Confirmar 100 %</button>
                                <button onClick={() => startEdit(r)} disabled={!canEdit} className="px-3 py-1.5 text-[11px] font-bold rounded-full bg-white/80 border border-black/10 disabled:opacity-40 cursor-pointer">Ajustar…</button>
                              </>
                            ) : (
                              <button onClick={() => startEdit(r)} disabled={!canEdit} className="px-3 py-1.5 text-[11px] font-bold rounded-full bg-white/80 border border-black/10 disabled:opacity-40 cursor-pointer">Cambiar…</button>
                            )}
                            <button onClick={() => toggle(k)} aria-expanded={isOpen} className="text-[11px] font-bold underline cursor-pointer">{isOpen ? 'Ocultar' : 'Historial'}</button>
                          </div>
                        </div>

                        {r.planChanged && r.current && (
                          <p className="mt-2 text-[11px] font-bold text-[#c2410c]">El MPS cambió desde la confirmación: pedía {fmtInt(r.current.plannedQty)} cajas y hoy pide {fmtInt(r.plannedNow)}. Vuelve a confirmar con la cantidad actual.</p>
                        )}
                        {r.current && r.shortfall > 0 && !r.planChanged && (
                          <p className="mt-2 text-[11px] text-slate-700">Faltan <b>{fmtInt(r.shortfall)}</b> cajas ({fmtDec(hoursOf(r, r.shortfall), 1)} h de la línea) que la planta no puede fabricar. Motivo: {r.current.reason}.</p>
                        )}

                        {isEditing && (
                          <div className="mt-3 rounded-2xl bg-white/80 border border-white p-3 space-y-2 text-xs">
                            <div className="flex flex-wrap items-center gap-2">
                              <label htmlFor={`q-${k}`} className="font-bold">Cajas que sí puede fabricar</label>
                              <input id={`q-${k}`} type="number" min={0} step={100} value={editing!.qty} onChange={(e) => setEditing({ ...editing!, qty: e.target.value })} className="w-28 rounded-lg border border-black/10 bg-white px-2 py-1 font-mono" />
                              <span className="text-slate-500">de {fmtInt(r.plannedNow)} ({r.plannedNow > 0 ? fmtDec((qtyNow / r.plannedNow) * 100, 0) : 0} %)</span>
                              <span className="flex gap-1">{QUICK.map((p) => <button key={p} onClick={() => setEditing({ ...editing!, qty: String(Math.round((r.plannedNow * p) / 100)) })} className="text-[10px] font-bold rounded-full px-2 py-0.5 bg-white border border-black/10 cursor-pointer">{p} %</button>)}</span>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <input value={editing!.reason} onChange={(e) => setEditing({ ...editing!, reason: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(r); }} placeholder={qtyNow < r.plannedNow ? 'Motivo (obligatorio): equipo dañado, empaque, personal…' : 'Motivo (opcional)'} aria-label="Motivo" className="flex-1 min-w-[220px] rounded-lg border border-black/10 bg-white px-2.5 py-1.5" />
                              <button onClick={() => saveEdit(r)} disabled={qtyNow < r.plannedNow && !editing!.reason.trim()} className="px-4 py-1.5 text-[11px] font-black rounded-full bg-slate-950 text-white disabled:opacity-40 cursor-pointer">Guardar · {author}</button>
                              <button onClick={() => setEditing(null)} className="text-[11px] font-bold underline cursor-pointer">Cancelar</button>
                            </div>
                          </div>
                        )}

                        {r.current && (
                          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                            <div className="text-[10px] uppercase font-bold text-slate-500">Entregado</div>
                            <div className="flex-1 min-w-[140px]"><ProgressBar value={Math.min(r.delivered, Math.max(r.confirmedQty, 1))} max={Math.max(r.confirmedQty, 1)} color="#2a9d8f" height={7} /></div>
                            <div className="font-mono text-[11px] font-bold">{fmtInt(r.delivered)} <span className="text-slate-500">de {fmtInt(r.confirmedQty)} · {fmtDec(r.fulfillment * 100, 0)} %</span></div>
                            <button onClick={() => setDelivering(isDelivering ? null : { key: k, qty: '', note: '' })} disabled={!canEdit} className="text-[11px] font-bold underline disabled:opacity-40 cursor-pointer">+ Registrar entrega</button>
                          </div>
                        )}
                        {isDelivering && (
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                            <input type="number" min={1} step={100} value={delivering!.qty} onChange={(e) => setDelivering({ ...delivering!, qty: e.target.value })} placeholder="Cajas" aria-label="Cajas entregadas" className="w-28 rounded-lg border border-black/10 bg-white px-2 py-1 font-mono" />
                            <input value={delivering!.note} onChange={(e) => setDelivering({ ...delivering!, note: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') saveDelivery(r); }} placeholder="Nota (opcional)" aria-label="Nota" className="flex-1 min-w-[180px] rounded-lg border border-black/10 bg-white px-2.5 py-1" />
                            <button onClick={() => saveDelivery(r)} disabled={!(Number(delivering!.qty) > 0)} className="px-3.5 py-1.5 text-[11px] font-black rounded-full bg-slate-950 text-white disabled:opacity-40 cursor-pointer">Registrar</button>
                          </div>
                        )}

                        {isOpen && (
                          <div className="mt-3 border-t border-black/5 pt-3 space-y-1.5 text-[11px]">
                            {r.history.length === 0 && r.deliveries.length === 0 && <p className="text-slate-500">Todavía no hay movimientos en este producto y semana.</p>}
                            {[...r.history.map((c) => ({ at: c.createdAt, kind: 'c' as const, c })), ...r.deliveries.map((d) => ({ at: d.createdAt, kind: 'd' as const, d }))]
                              .sort((a, b) => b.at.localeCompare(a.at))
                              .map((e) => e.kind === 'c' ? (
                                <div key={e.c.id}><span className="font-mono text-slate-400 mr-2">{when(e.at)}</span><b>{e.c.author}</b> confirmó <b>{fmtInt(e.c.confirmedQty)}</b> de {fmtInt(e.c.plannedQty)} cajas — {e.c.reason}{r.current?.id === e.c.id ? <span className="ml-1 text-[9px] font-black rounded-full px-1.5 py-0.5 bg-[#DDCBF5]">vigente</span> : null}</div>
                              ) : (
                                <div key={e.d.id} className="flex items-start justify-between gap-2"><span><span className="font-mono text-slate-400 mr-2">{when(e.at)}</span><b>{e.d.author}</b> registró entrega de <b>{fmtInt(e.d.qty)}</b> cajas{e.d.note ? ` — ${e.d.note}` : ''}</span>{canEdit && <button onClick={() => removeDelivery(e.d.id)} aria-label="Quitar entrega" className="text-slate-400 hover:text-black cursor-pointer">✕</button>}</div>
                              ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>

        <aside className="space-y-3 xl:sticky xl:top-[88px]">
          <section className="glass-panel rounded-3xl p-4 space-y-3">
            <h2 className="text-[11px] font-black uppercase tracking-wider text-slate-500">Semana del {weekLabel(week)}</h2>
            <div className="space-y-2.5 text-xs">
              {[
                ['Pide el MPS', sumWeek.planned, '#2b50aa'],
                ['Confirmado', weekRows.reduce((a, r) => a + r.confirmedQty, 0), '#2a9d8f'],
                ['Entregado', weekRows.reduce((a, r) => a + r.delivered, 0), '#c9601c'],
              ].map(([label, v, color]) => (
                <div key={String(label)}>
                  <div className="flex justify-between"><span className="font-bold">{label}</span><span className="font-mono font-black">{fmtInt(Number(v))}</span></div>
                  <ProgressBar value={Number(v)} max={Math.max(sumWeek.planned, 1)} color={String(color)} height={7} />
                </div>
              ))}
            </div>
            <p className="text-[11px] text-slate-600">{sumWeek.pending} por confirmar · {sumWeek.confirmed} confirmados · {sumWeek.partial} parciales · {sumWeek.cannot} sin poder fabricar.</p>
          </section>

          <section className="glass-panel rounded-3xl p-4">
            <h2 className="text-[11px] font-black uppercase tracking-wider text-slate-500 mb-2">Atención</h2>
            {sumAll.pending === 0 && sumAll.shortfall === 0 && sumAll.planChanged === 0 ? (
              <p className="text-xs font-bold text-emerald-800">Todas las plantas confirmaron lo que pide el MPS.</p>
            ) : (
              <ul className="space-y-2 text-xs">
                {sumAll.pending > 0 && <li className="rounded-xl bg-slate-100 px-3 py-2"><b>{sumAll.pending}</b> producto-semana(s) sin confirmar en el horizonte.</li>}
                {sumAll.planChanged > 0 && <li className="rounded-xl bg-[#FFA27D]/30 px-3 py-2"><b>{sumAll.planChanged}</b> confirmación(es) quedaron viejas porque el MPS cambió.</li>}
                {sumAll.shortfall > 0 && (
                  <li className="rounded-xl bg-[#FFF87C]/50 px-3 py-2">
                    Las plantas no pueden fabricar <b>{fmtInt(sumAll.shortfall)}</b> cajas de lo que pide el MPS. Distribución decide si se reprograma o se acepta el faltante.
                    <div className="mt-1.5 flex gap-3"><button onClick={() => onSelectStep('mps')} className="font-black underline cursor-pointer">Ir al MPS</button><button onClick={() => onSelectStep('crp')} className="font-black underline cursor-pointer">Ir a Capacidad</button></div>
                  </li>
                )}
              </ul>
            )}
          </section>

          <section className="glass-panel rounded-3xl p-4">
            <h2 className="text-[11px] font-black uppercase tracking-wider text-slate-500 mb-2">Trazabilidad reciente</h2>
            {events.length === 0 ? <p className="text-xs text-slate-500">Todavía no hay confirmaciones ni entregas.</p> : (
              <ul className="space-y-2 text-[11px] max-h-72 overflow-auto pr-1">
                {events.slice(0, 8).map((e, i) => <li key={i}><span className="font-mono text-slate-400 mr-1.5">{when(e.at)}</span><b>{e.who}</b> · {e.text}</li>)}
              </ul>
            )}
            {events.length > 8 && <p className="text-[10px] text-slate-500 mt-2">Las {events.length - 8} anteriores están en el historial de cada producto.</p>}
          </section>
          {!canEdit && <p className="text-[11px] text-slate-500 px-1">Tu rol puede ver las confirmaciones pero no registrarlas: las lleva Producción.</p>}
        </aside>
      </div>
    </div>
  );
}
