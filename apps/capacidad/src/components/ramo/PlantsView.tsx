import React, { useEffect, useMemo, useState } from 'react';
import { PlantRow, PlantStatus, summarizePlants } from '@ramo/engine';
import { useRamoPlan } from '../../ramo/store';
import { useAuth } from '../../ramo/auth';
import { fmtDec, fmtInt, weekLabel } from '../../ramo/format';
import { ProcessStep } from '../../ramo/steps';
import { Disclosure, ProgressBar } from './ui';

const STATUS: Record<PlantStatus, { label: string; tone: string; color: string }> = {
  PENDING: { label: 'Pendiente', tone: 'bg-slate-200 text-slate-700', color: 'rgba(203,213,225,0.7)' },
  CONFIRMED: { label: 'Confirmado', tone: 'bg-[#7AFFA1] text-black', color: 'rgba(122,255,161,0.75)' },
  PARTIAL: { label: 'Parcial', tone: 'bg-[#FFF87C] text-black', color: '#FFF87C' },
  CANNOT: { label: 'No puede', tone: 'bg-[#FFA27D] text-black', color: '#FFA27D' },
};
const QUICK = [90, 70, 50, 0];
const when = (iso: string) => iso.slice(0, 16).replace('T', ' ');
const keyOf = (r: { skuId: string; weekStart: string }) => `${r.skuId}|${r.weekStart}`;
const deliveryColor = (f: number) => (f >= 0.999 ? 'rgba(122,255,161,0.75)' : f >= 0.7 ? '#FFF87C' : f > 0 ? '#FFA27D' : 'rgba(203,213,225,0.7)');

/** Confirmación de plantas: el mapa de producto por semana muestra qué confirmó cada planta; el panel de la derecha confirma, ajusta, registra entregas y guarda la trazabilidad. */
export function PlantsView({ onSelectStep }: { onSelectStep: (s: ProcessStep) => void }) {
  const { dataset, weeks, stage, plantRows, confirmPlant, confirmPlantMany, recordDelivery, removeDelivery, can } = useRamoPlan();
  const { user } = useAuth();
  const author = user?.name ?? 'Producción';
  const canEdit = can('capacity.edit');
  const closed = stage === 'MPS_FINAL' || stage === 'FINAL_ALERTS';

  const byKey = useMemo(() => new Map(plantRows.map((r) => [keyOf(r), r])), [plantRows]);
  const firstPending = plantRows.find((r) => r.status === 'PENDING') ?? plantRows[0];
  // La selección queda fija aunque la fila deje de estar pendiente (no salta sola a la siguiente).
  const [sel, setSel] = useState<{ skuId: string; week: string } | null>(() => (firstPending ? { skuId: firstPending.skuId, week: firstPending.weekStart } : null));
  const [mode, setMode] = useState<'conf' | 'deliv'>('conf');
  const [edit, setEdit] = useState<{ qty: string; reason: string } | null>(null);
  const [deliv, setDeliv] = useState({ qty: '', note: '' });

  const skuName = (id: string) => dataset.skus.find((s) => s.id === id)?.name.replace(' (sint.)', '') ?? id;
  const plantName = (id: string) => dataset.plants.find((p) => p.id === id)?.name.replace(' (sint.)', '') ?? id;
  const lineName = (id: string) => dataset.lines.find((l) => l.id === id)?.name.replace('Línea ', '') ?? id;

  // Productos agrupados por planta (los que tienen producción en algún momento del horizonte).
  const groups = useMemo(() => {
    const out: { plantId: string; skus: string[] }[] = [];
    for (const pl of dataset.plants) {
      const ids = dataset.skus.filter((s) => dataset.lines.find((l) => l.id === s.lineId)?.plantId === pl.id && plantRows.some((r) => r.skuId === s.id)).map((s) => s.id);
      if (ids.length) out.push({ plantId: pl.id, skus: ids });
    }
    return out;
  }, [dataset, plantRows]);
  const order = groups.flatMap((g) => g.skus);

  const cur = sel ?? (firstPending ? { skuId: firstPending.skuId, week: firstPending.weekStart } : null);
  const row = cur ? byKey.get(keyOf({ skuId: cur.skuId, weekStart: cur.week })) : undefined;
  const select = (skuId: string, week: string) => { setSel({ skuId, week }); setEdit(null); setDeliv({ qty: '', note: '' }); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') || !cur) return;
      const wi = weeks.indexOf(cur.week);
      const si = order.indexOf(cur.skuId);
      if (e.key === 'ArrowLeft') select(cur.skuId, weeks[Math.max(0, wi - 1)]);
      else if (e.key === 'ArrowRight') select(cur.skuId, weeks[Math.min(weeks.length - 1, wi + 1)]);
      else if (e.key === 'ArrowUp') select(order[Math.max(0, si - 1)], cur.week);
      else if (e.key === 'ArrowDown') select(order[Math.min(order.length - 1, si + 1)], cur.week);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur?.skuId, cur?.week, order.join(','), weeks.join(',')]);

  const sumAll = summarizePlants(plantRows);
  const weekRows = cur ? plantRows.filter((r) => r.weekStart === cur.week) : [];
  const sumWeek = summarizePlants(weekRows);
  const weekPending = weekRows.filter((r) => r.status === 'PENDING');
  const weekState = (w: string) => {
    const rows = plantRows.filter((r) => r.weekStart === w);
    if (rows.length === 0) return 'rgba(229,231,235,0.8)';
    if (rows.some((r) => r.status === 'PENDING')) return STATUS.PENDING.color;
    if (rows.some((r) => r.status === 'PARTIAL' || r.status === 'CANNOT' || r.planChanged)) return STATUS.PARTIAL.color;
    return STATUS.CONFIRMED.color;
  };

  const confirmFull = (rows: PlantRow[]) => confirmPlantMany(rows.map((r) => ({ skuId: r.skuId, weekStart: r.weekStart, plannedQty: r.plannedNow, confirmedQty: r.plannedNow, reason: 'Confirmado completo', author })));
  const qtyNow = edit ? Math.max(0, Math.round(Number(edit.qty) || 0)) : 0;
  const saveEdit = () => {
    if (!row || !edit) return;
    if (qtyNow < row.plannedNow && !edit.reason.trim()) return;
    confirmPlant({ skuId: row.skuId, weekStart: row.weekStart, plannedQty: row.plannedNow, confirmedQty: qtyNow, reason: edit.reason.trim() || 'Confirmado completo', author });
    setEdit(null);
  };
  const saveDelivery = () => {
    if (!row) return;
    const qty = Math.round(Number(deliv.qty) || 0);
    if (qty <= 0) return;
    recordDelivery({ skuId: row.skuId, weekStart: row.weekStart, qty, note: deliv.note.trim(), author });
    setDeliv({ qty: '', note: '' });
  };
  const hoursOf = (r: PlantRow, qty: number) => {
    const sku = dataset.skus.find((s) => s.id === r.skuId);
    const line = dataset.lines.find((l) => l.id === r.lineId);
    return sku && line ? (qty * sku.productiveUnitsPerCommercial) / line.rate.value : 0;
  };

  const events = useMemo(() => {
    const ev: { at: string; text: string; who: string }[] = [];
    for (const r of plantRows) {
      for (const c of r.history) ev.push({ at: c.createdAt, who: c.author, text: `${skuName(c.skuId)} · sem. ${weekLabel(c.weekStart)}: confirmó ${fmtInt(c.confirmedQty)} de ${fmtInt(c.plannedQty)} cajas — ${c.reason}` });
      for (const d of r.deliveries) ev.push({ at: d.createdAt, who: d.author, text: `${skuName(d.skuId)} · sem. ${weekLabel(d.weekStart)}: entregó ${fmtInt(d.qty)} cajas${d.note ? ` — ${d.note}` : ''}` });
    }
    return ev.sort((a, b) => b.at.localeCompare(a.at));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plantRows, dataset]);

  if (weeks.length === 0 || !cur || plantRows.length === 0) return <div className="glass-panel rounded-3xl p-5 text-xs">No hay producción en el MPS para confirmar.</div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight">Confirmación de plantas</h1>
          <p className="text-sm text-slate-600 max-w-3xl">¿Cuánto de lo que pide el MPS puede fabricar cada planta? Elige un producto y una semana en el mapa para confirmar, ajustar y registrar lo entregado.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-black">
          <span className={`rounded-full px-3 py-1.5 ${sumAll.pending ? 'bg-slate-200' : 'bg-[#7AFFA1]'}`}>{sumAll.pending ? `${sumAll.pending} por confirmar` : 'Todo confirmado'}</span>
          <span className={`rounded-full px-3 py-1.5 ${sumAll.shortfall ? 'bg-[#FFA27D]' : 'bg-[#7AFFA1]/70'}`}>{sumAll.shortfall ? `faltan ${fmtInt(sumAll.shortfall)} cajas` : 'Sin faltantes'}</span>
          {sumAll.fulfillment !== null && <span className="rounded-full px-3 py-1.5 bg-[#DDCBF5]">cumplimiento {fmtDec(sumAll.fulfillment * 100, 0)} %</span>}
        </div>
      </div>

      {!closed && (
        <div className="rounded-2xl bg-[#FFF87C]/45 border border-[#FFF87C] px-4 py-2 text-xs">
          <b>El MPS todavía no está cerrado.</b> Puedes confirmar con el plan actual; si cambia, la fila se marca con «!» y hay que volver a confirmar.
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-4 items-start">
        {/* Mapa */}
        <section className="glass-panel rounded-3xl p-4 sm:p-5 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h2 className="text-sm font-black">Mapa de plantas por producto y semana</h2>
            <div className="inline-flex rounded-full bg-white/70 border border-white/80 p-0.5 text-[11px] font-bold" role="group" aria-label="Qué mostrar en el mapa">
              {([['conf', 'Confirmación'], ['deliv', 'Entregas']] as const).map(([m, label]) => (
                <button key={m} onClick={() => setMode(m)} aria-pressed={mode === m} className={`px-3 py-1.5 rounded-full cursor-pointer ${mode === m ? 'bg-slate-950 text-white' : 'text-slate-600'}`}>{label}</button>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto">
            <div className="grid gap-1 min-w-[640px]" style={{ gridTemplateColumns: `150px repeat(${weeks.length}, minmax(40px, 1fr))` }}>
              <div />
              {weeks.map((w) => (
                <div key={w} className={`text-center rounded-lg py-1 ${w === cur.week ? 'bg-white' : ''}`}>
                  <div className="text-[10px] font-bold text-slate-500">{weekLabel(w)}</div>
                  <div className="mx-auto mt-0.5 h-1.5 w-6 rounded-full" style={{ background: weekState(w) }} />
                </div>
              ))}
              {groups.map((g) => (
                <React.Fragment key={g.plantId}>
                  <div className="col-span-full text-[10px] font-extrabold uppercase tracking-wider text-slate-500 pt-2 pl-1">{plantName(g.plantId)}</div>
                  {g.skus.map((id) => (
                    <React.Fragment key={id}>
                      <button onClick={() => select(id, cur.week)} className={`text-left rounded-xl px-2 py-1.5 cursor-pointer min-w-0 ${id === cur.skuId ? 'bg-white shadow-sm' : 'hover:bg-white/50'}`}>
                        <div className="text-[11px] font-black truncate" title={skuName(id)}>{skuName(id)}</div>
                        <div className="text-[9px] text-slate-500 truncate">Línea {lineName(dataset.skus.find((s) => s.id === id)!.lineId)}</div>
                      </button>
                      {weeks.map((w) => {
                        const r = byKey.get(keyOf({ skuId: id, weekStart: w }));
                        if (!r) return <div key={w} className="h-9 rounded-lg bg-white/25" />;
                        const isSel = id === cur.skuId && w === cur.week;
                        const f = r.fulfillment;
                        const label = mode === 'conf' ? (r.current ? `${fmtDec(r.coverage * 100, 0)}%` : '—') : r.current ? `${fmtDec(f * 100, 0)}%` : '—';
                        return (
                          <button key={w} onClick={() => select(id, w)} aria-label={`${skuName(id)}, semana del ${weekLabel(w)}: ${STATUS[r.status].label}`}
                            title={`${STATUS[r.status].label} · pide ${fmtInt(r.plannedNow)} · confirmado ${r.current ? fmtInt(r.confirmedQty) : 'sin confirmar'} · entregado ${fmtInt(r.delivered)}${r.planChanged ? ' · el MPS cambió' : ''}`}
                            className={`relative h-9 rounded-lg font-mono text-[11px] font-bold cursor-pointer hover:brightness-95 ${isSel ? 'ring-2 ring-slate-950' : r.planChanged ? 'ring-2 ring-[#9b6fe0]' : ''}`}
                            style={{ background: mode === 'conf' ? STATUS[r.status].color : r.current ? deliveryColor(f) : 'rgba(203,213,225,0.5)' }}>
                            {label}
                            {r.planChanged && <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-[#9b6fe0] text-white text-[9px] leading-[14px] font-black">!</span>}
                          </button>
                        );
                      })}
                    </React.Fragment>
                  ))}
                </React.Fragment>
              ))}
            </div>
          </div>
          <p className="text-[10px] text-slate-500 mt-3">
            {mode === 'conf' ? 'Porcentaje de lo que pide el MPS que la planta confirmó. Gris: pendiente · verde: completo · amarillo: parcial · naranja: no puede. «!» (morado): el MPS cambió después de confirmar.' : 'Entregado ÷ confirmado. Gris: sin entregas · naranja: menos del 70 % · amarillo: 70 % o más · verde: completo.'} Flechas del teclado para moverte.
          </p>
        </section>

        {/* Panel */}
        <aside className="space-y-3 xl:sticky xl:top-[88px]">
          {row && (() => {
            const st = STATUS[row.status];
            const k = keyOf(row);
            return (
              <section key={k} className="glass-panel rounded-3xl p-4 space-y-3">
                <div className="text-[11px] font-black uppercase tracking-wider text-slate-500">{skuName(row.skuId)} · semana del {weekLabel(row.weekStart)}</div>
                <div className="text-[11px] text-slate-500 -mt-2">{plantName(row.plantId)}, línea {lineName(row.lineId)}</div>
                <div className="flex items-baseline gap-3 flex-wrap">
                  <span className="text-3xl font-black font-mono">{fmtInt(row.plannedNow)}</span>
                  <span className="text-xs text-slate-600">cajas que pide el MPS</span>
                  <span className={`text-[10px] font-black rounded-full px-2.5 py-1 ${st.tone}`}>{st.label}{row.current && row.status !== 'CONFIRMED' ? ` · ${fmtDec(row.coverage * 100, 0)} %` : ''}</span>
                </div>

                {row.planChanged && row.current && <p className="rounded-xl bg-[#FFA27D]/30 px-3 py-2 text-[11px] font-bold">El MPS cambió desde la confirmación: pedía {fmtInt(row.current.plannedQty)} cajas y hoy pide {fmtInt(row.plannedNow)}. Vuelve a confirmar con la cantidad actual.</p>}
                {row.current && (
                  <div className="rounded-xl bg-white/60 px-3 py-2 text-xs">
                    <b>{fmtInt(row.confirmedQty)}</b> confirmadas por {row.current.author} · <span className="text-slate-500">{when(row.current.createdAt)}</span>
                    <div className="text-slate-600">«{row.current.reason}»</div>
                    {row.shortfall > 0 && !row.planChanged && <div className="mt-1 font-bold text-[#c2410c]">Faltan {fmtInt(row.shortfall)} cajas ({fmtDec(hoursOf(row, row.shortfall), 1)} h de la línea).</div>}
                  </div>
                )}

                {edit === null ? (
                  <div className="flex flex-wrap gap-1.5">
                    {row.status !== 'CONFIRMED' || row.planChanged ? <button onClick={() => confirmFull([row])} disabled={!canEdit} className="px-4 py-2 text-[11px] font-black rounded-full bg-[#7AFFA1] text-black disabled:opacity-40 cursor-pointer">Confirmar 100 %</button> : null}
                    {QUICK.map((p) => <button key={p} onClick={() => setEdit({ qty: String(Math.round((row.plannedNow * p) / 100)), reason: '' })} disabled={!canEdit} className="px-3 py-2 text-[11px] font-bold rounded-full bg-white/80 border border-black/10 disabled:opacity-40 cursor-pointer">{p} %</button>)}
                    <button onClick={() => setEdit({ qty: String(row.current ? row.confirmedQty : row.plannedNow), reason: '' })} disabled={!canEdit} className="px-3 py-2 text-[11px] font-bold rounded-full bg-white/80 border border-black/10 disabled:opacity-40 cursor-pointer">Otra cantidad…</button>
                  </div>
                ) : (
                  <div className="rounded-2xl bg-white/80 border border-white p-3 space-y-2 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <label htmlFor="pq" className="font-bold">Cajas que sí puede fabricar</label>
                      <input id="pq" autoFocus type="number" min={0} step={100} value={edit.qty} onChange={(e) => setEdit({ ...edit, qty: e.target.value })} className="w-28 rounded-lg border border-black/10 bg-white px-2 py-1 font-mono" />
                      <span className="text-slate-500">({row.plannedNow > 0 ? fmtDec((qtyNow / row.plannedNow) * 100, 0) : 0} %)</span>
                    </div>
                    <input value={edit.reason} onChange={(e) => setEdit({ ...edit, reason: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); }} placeholder={qtyNow < row.plannedNow ? 'Motivo (obligatorio): equipo dañado, empaque, personal…' : 'Motivo (opcional)'} aria-label="Motivo" className="w-full rounded-lg border border-black/10 bg-white px-2.5 py-1.5" />
                    <div className="flex items-center gap-3">
                      <button onClick={saveEdit} disabled={qtyNow < row.plannedNow && !edit.reason.trim()} className="px-4 py-1.5 text-[11px] font-black rounded-full bg-slate-950 text-white disabled:opacity-40 cursor-pointer">Guardar · {author}</button>
                      <button onClick={() => setEdit(null)} className="text-[11px] font-bold underline cursor-pointer">Cancelar</button>
                    </div>
                  </div>
                )}
                {!canEdit && <p className="text-[11px] text-slate-500">Tu rol puede ver las confirmaciones pero no registrarlas: las lleva Producción.</p>}

                {row.current && (
                  <div className="border-t border-black/5 pt-3 space-y-2">
                    <div className="flex items-center justify-between text-xs"><span className="font-bold">Entregado</span><span className="font-mono font-black">{fmtInt(row.delivered)} <span className="text-slate-500 font-bold">de {fmtInt(row.confirmedQty)} · {fmtDec(row.fulfillment * 100, 0)} %</span></span></div>
                    <ProgressBar value={Math.min(row.delivered, Math.max(row.confirmedQty, 1))} max={Math.max(row.confirmedQty, 1)} color="#2a9d8f" height={7} />
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <input type="number" min={1} step={100} value={deliv.qty} onChange={(e) => setDeliv({ ...deliv, qty: e.target.value })} placeholder="Cajas entregadas" aria-label="Cajas entregadas" className="w-32 rounded-lg border border-black/10 bg-white px-2 py-1 font-mono" />
                      <input value={deliv.note} onChange={(e) => setDeliv({ ...deliv, note: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') saveDelivery(); }} placeholder="Nota (opcional)" aria-label="Nota" className="flex-1 min-w-[100px] rounded-lg border border-black/10 bg-white px-2.5 py-1" />
                      <button onClick={saveDelivery} disabled={!canEdit || !(Number(deliv.qty) > 0)} className="px-3.5 py-1.5 text-[11px] font-black rounded-full bg-slate-950 text-white disabled:opacity-40 cursor-pointer">Registrar</button>
                    </div>
                  </div>
                )}

                <Disclosure title={`Historial de este producto y semana (${row.history.length + row.deliveries.length})`}>
                  <div className="space-y-1.5 text-[11px]">
                    {row.history.length + row.deliveries.length === 0 && <p className="text-slate-500">Todavía no hay movimientos.</p>}
                    {[...row.history.map((c) => ({ at: c.createdAt, kind: 'c' as const, c })), ...row.deliveries.map((d) => ({ at: d.createdAt, kind: 'd' as const, d }))]
                      .sort((a, b) => b.at.localeCompare(a.at))
                      .map((e) => e.kind === 'c' ? (
                        <div key={e.c.id}><span className="font-mono text-slate-400 mr-2">{when(e.at)}</span><b>{e.c.author}</b> confirmó <b>{fmtInt(e.c.confirmedQty)}</b> de {fmtInt(e.c.plannedQty)} — {e.c.reason}{row.current?.id === e.c.id ? <span className="ml-1 text-[9px] font-black rounded-full px-1.5 py-0.5 bg-[#DDCBF5]">vigente</span> : null}</div>
                      ) : (
                        <div key={e.d.id} className="flex items-start justify-between gap-2"><span><span className="font-mono text-slate-400 mr-2">{when(e.at)}</span><b>{e.d.author}</b> entregó <b>{fmtInt(e.d.qty)}</b>{e.d.note ? ` — ${e.d.note}` : ''}</span>{canEdit && <button onClick={() => removeDelivery(e.d.id)} aria-label="Quitar entrega" className="text-slate-400 hover:text-black cursor-pointer">✕</button>}</div>
                      ))}
                  </div>
                </Disclosure>
              </section>
            );
          })()}

          <section className="glass-panel rounded-3xl p-4 space-y-2">
            <h2 className="text-[11px] font-black uppercase tracking-wider text-slate-500">Semana del {weekLabel(cur.week)}</h2>
            <p className="text-xs text-slate-600">{fmtInt(sumWeek.planned)} cajas pedidas · {sumWeek.pending} por confirmar · {sumWeek.confirmed} confirmados · {sumWeek.partial} parciales · {sumWeek.cannot} sin poder fabricar.</p>
            {weekPending.length > 0 && <button onClick={() => confirmFull(weekPending)} disabled={!canEdit} className="px-4 py-2 text-[11px] font-black rounded-full bg-slate-950 text-white disabled:opacity-40 cursor-pointer">Confirmar al 100 % lo pendiente de la semana ({weekPending.length})</button>}
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

          <details className="glass-panel rounded-3xl p-4 text-xs">
            <summary className="font-black uppercase tracking-wider text-[11px] text-slate-500 cursor-pointer">Trazabilidad reciente ({events.length})</summary>
            {events.length === 0 ? <p className="mt-3 text-slate-500">Todavía no hay confirmaciones ni entregas.</p> : (
              <ul className="mt-3 space-y-2 text-[11px] max-h-72 overflow-auto pr-1">
                {events.slice(0, 12).map((e, i) => <li key={i}><span className="font-mono text-slate-400 mr-1.5">{when(e.at)}</span><b>{e.who}</b> · {e.text}</li>)}
              </ul>
            )}
          </details>
        </aside>
      </div>
    </div>
  );
}
