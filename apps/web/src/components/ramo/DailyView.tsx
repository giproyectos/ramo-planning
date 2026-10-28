import React, { useMemo, useState } from 'react';
import { ProductionTemplate, toProductiveQty } from '@ramo/domain';
import { AllocationRule, DailyCell, DailyWeek, buildDailySchedule, suggestDailyBalance, weekdayOf } from '@ramo/engine';
import { useRamoPlan } from '../../ramo/store';
import { useAuth } from '../../ramo/auth';
import { fmtDec, fmtInt, weekLabel } from '../../ramo/format';
import { AiTag } from './ai';
import { Card, Disclosure, ProgressBar } from './ui';
import { SERIES_COLORS } from './charts';

const DAY_LETTER = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const DAY_NAME = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

const heat = (pct: number) => (pct > 110 ? '#FFA27D' : pct > 100 ? '#FFF87C' : pct > 85 ? '#9CF5B8' : '#CFFBE0');
const dayNum = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDate();
const dayName = (iso: string) => DAY_NAME[weekdayOf(iso) - 1];

const RULES: { id: AllocationRule; label: string; hint: string }[] = [
  { id: 'EVEN', label: 'Parejo según las horas de cada día', hint: 'La cantidad de la semana se reparte entre los días de producción en proporción a sus horas: la carga queda pareja.' },
  { id: 'COVER', label: 'Acumulando la necesidad hasta la próxima producción', hint: 'Cada día de producción cubre la demanda desde ese día hasta la próxima vez que se produce el producto (lunes y miércoles: el lunes cubre 2 días, el miércoles 5).' },
];

type Draft = { templateId: string; days: Record<number, string[]>; shifts: Record<number, number>; scope: 'WEEK' | 'FROM'; reason: string };

/** Programación diaria: el plan semanal del MPS bajado a días según la plantilla de cada línea, con la carga y las alertas de cada día. */
export function DailyView() {
  const {
    dataset, daily, allocationRule, setAllocationRule, templateOverrides, saveTemplateOverride, removeTemplateOverride, dailyAdjustments, moveDaily,
    applyDailyBalance, removeDailyAdjustment, danielView, can,
  } = useRamoPlan();
  const { user } = useAuth();
  const weeks = useMemo(() => [...new Set((daily?.weeks ?? []).map((w) => w.weekStart))].sort(), [daily]);
  const firstRed = useMemo(() => Math.max(0, weeks.findIndex((w) => daily!.weeks.some((x) => x.weekStart === w && x.excessHours > 0.05))), [weeks, daily]);
  const [weekIdx, setWeekIdx] = useState<number | null>(null);
  const [selected, setSelected] = useState<{ templateId: string; date: string; lineId: string } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [author, setAuthor] = useState(user?.name ?? 'Producción');
  const [move, setMove] = useState({ skuId: '', from: '', to: '', qty: '1000', reason: '' });

  const skuName = (id: string) => dataset.skus.find((s) => s.id === id)?.name.replace(' (sint.)', '') ?? id;
  const lineName = (id: string) => dataset.lines.find((l) => l.id === id)?.name ?? id;
  /** Horas que pide una cantidad de cajas de un producto en su línea. */
  const hoursOf = (skuId: string, qty: number) => {
    const sku = dataset.skus.find((x) => x.id === skuId);
    const line = dataset.lines.find((l) => l.id === sku?.lineId);
    return sku && line ? toProductiveQty(sku, qty) / line.rate.value : 0;
  };

  const idx = weekIdx ?? firstRed;
  const week = weeks[idx] ?? weeks[0];
  const editing = draft !== null;

  // Con el cambio en edición, la tabla se calcula en vivo con la plantilla provisional.
  const preview = useMemo(() => {
    if (!draft || !week) return null;
    return buildDailySchedule(dataset, danielView.net, {
      overrides: [...templateOverrides, { id: 'draft', templateId: draft.templateId, scope: 'WEEK', weekStart: week, days: draft.days, shifts: draft.shifts, reason: '', author: '', createdAt: '9999' }],
      adjustments: dailyAdjustments,
      rule: allocationRule,
    });
  }, [draft, week, dataset, danielView.net, templateOverrides, dailyAdjustments, allocationRule]);

  const weekData = useMemo(() => {
    const src = (w: DailyWeek) => (preview && draft && w.templateId === draft.templateId ? preview.weeks.find((x) => x.weekStart === w.weekStart && x.templateId === w.templateId) ?? w : w);
    return (daily?.weeks ?? []).filter((w) => w.weekStart === week).map(src);
  }, [daily, week, preview, draft]);

  const weekPlan = useMemo(() => (daily ? suggestDailyBalance(dataset, { weeks: weekData, alerts: [] }) : null), [dataset, daily, weekData]);

  if (!daily || weeks.length === 0) {
    return (
      <div className="glass-panel rounded-3xl p-5 text-xs">
        <h1 className="text-xl font-black">Programación diaria</h1>
        <p className="mt-2 text-slate-600">El dataset no define plantillas de producción.</p>
      </div>
    );
  }

  const canEdit = can('capacity.edit');
  const overCells = weekData.flatMap((w) => w.cells.filter((c) => c.excessHours > 0.05));
  const unscheduled = weekData.flatMap((w) => w.unscheduled.map((u) => ({ ...u, templateName: w.template.name })));
  // Se cuenta sobre lo que se está viendo (incluida la vista previa de una edición), no sobre lo guardado.
  const crewConflicts = new Set(weekData.flatMap((w) => w.cells.filter((c) => c.crewConflict).map((c) => `${w.templateId}|${c.date}`))).size;

  const startEdit = (t: ProductionTemplate) => setDraft({ templateId: t.id, days: JSON.parse(JSON.stringify(t.days)), shifts: { ...t.shifts }, scope: 'WEEK', reason: '' });
  const toggleDay = (wd: number, skuId: string) => {
    if (!draft) return;
    const cur = new Set(draft.days[wd] ?? []);
    if (cur.has(skuId)) cur.delete(skuId); else cur.add(skuId);
    const days = { ...draft.days, [wd]: [...cur] };
    if (days[wd].length === 0) delete days[wd];
    setDraft({ ...draft, days });
  };
  const setShifts = (wd: number, n: number) => draft && setDraft({ ...draft, shifts: { ...draft.shifts, [wd]: Math.max(0, Math.min(4, n)) } });
  const saveDraft = () => {
    if (!draft || !draft.reason.trim() || !author.trim()) return;
    saveTemplateOverride({ templateId: draft.templateId, scope: draft.scope, weekStart: week, days: draft.days, shifts: draft.shifts, reason: draft.reason.trim(), author: author.trim() });
    setDraft(null);
  };

  const submitMove = () => {
    const qty = Number(move.qty);
    if (!move.skuId || !move.from || !move.to || move.from === move.to || !(qty > 0) || !move.reason.trim()) return;
    moveDaily({ skuId: move.skuId, fromDate: move.from, toDate: move.to, qty, reason: move.reason.trim(), author: author.trim() || 'Producción' });
    setMove({ ...move, reason: '' });
  };

  const isOpt = (a: { reason: string }) => a.reason.startsWith('Rebalanceo diario');
  const weekDates = new Set(weekData.flatMap((w) => w.days.map((d) => d.date)));
  const weekAdjustments = dailyAdjustments.filter((a) => weekDates.has(a.date));
  const manualAdj = weekAdjustments.filter((a) => !isOpt(a));
  const optAdj = weekAdjustments.filter(isOpt);
  const crpWeek = danielView.capacity.find((c) => c.weekStart === week);

  const cellColor = (c: DailyCell | undefined) => (c ? heat(c.saturationPct) : '#f1f5f9');

  return (
    <div className="space-y-5">
      <div className="glass-panel rounded-3xl p-5 space-y-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
            <span className="w-2 h-2 rounded-full bg-[#FFA27D]"></span>
            <span className="text-black font-extrabold">Programación diaria · Esquemas de producción</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black tracking-tight text-slate-950">¿Qué se produce cada día y alcanza la capacidad de ese día?</h1>
          <p className="text-xs text-slate-500 mt-0.5 font-medium max-w-4xl">
            El plan semanal del MPS se baja a días siguiendo la plantilla de cada línea o grupo de líneas que comparten tripulación. Cada día se compara con sus horas (turnos, festivos, paradas y cambio de producto).
            Cambia la plantilla de la semana, mueve producción de un día a otro y mira las alertas al instante. Las plantillas, turnos y tiempos de cambio son de ejemplo y se validan con Producción.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex items-center gap-1 rounded-full bg-white/70 border border-white/80 p-0.5 text-xs font-bold">
            <button onClick={() => setWeekIdx(Math.max(0, idx - 1))} disabled={idx === 0 || editing} className="px-3 py-1.5 rounded-full cursor-pointer disabled:opacity-30" aria-label="Semana anterior">◀</button>
            <select value={idx} onChange={(e) => setWeekIdx(Number(e.target.value))} disabled={editing} className="bg-transparent px-1 py-1.5 font-black cursor-pointer" aria-label="Semana">
              {weeks.map((w, i) => <option key={w} value={i}>Semana del {weekLabel(w)}</option>)}
            </select>
            <button onClick={() => setWeekIdx(Math.min(weeks.length - 1, idx + 1))} disabled={idx === weeks.length - 1 || editing} className="px-3 py-1.5 rounded-full cursor-pointer disabled:opacity-30" aria-label="Semana siguiente">▶</button>
          </div>
          <div className="inline-flex rounded-full bg-white/70 border border-white/80 p-0.5 text-[11px] font-bold" title={RULES.find((r) => r.id === allocationRule)?.hint}>
            {RULES.map((r) => (
              <button key={r.id} onClick={() => setAllocationRule(r.id)} className={`px-3 py-1.5 rounded-full cursor-pointer ${allocationRule === r.id ? 'bg-slate-950 text-white' : 'text-slate-600'}`}>{r.label}</button>
            ))}
          </div>
          <span className={`text-[11px] font-black rounded-full px-3 py-1 text-black ${overCells.length > 0 ? 'bg-[#FFA27D]' : 'bg-[#7AFFA1]'}`}>
            {overCells.length > 0 ? `${overCells.length} día(s) sobre capacidad esta semana` : 'Capacidad alcanza todos los días'}
          </span>
          {unscheduled.length > 0 && <span className="text-[11px] font-black rounded-full px-3 py-1 bg-[#FFF87C] text-black">{unscheduled.length} producto(s) sin día de producción</span>}
          {crewConflicts > 0 && <span className="text-[11px] font-black rounded-full px-3 py-1 bg-[#FFA27D] text-black">{crewConflicts} día(s) con la tripulación en dos líneas</span>}
        </div>
        <p className="text-[11px] text-slate-500">{RULES.find((r) => r.id === allocationRule)?.hint}</p>
      </div>

      {/* Mapa de todas las semanas */}
      <Card title="Mapa del horizonte" hint="Cada cuadro es una semana de una plantilla; el color es el día más cargado. Haz clic para ir a esa semana." >
        <div className="overflow-x-auto">
          <div className="min-w-[560px] grid gap-1 items-center" style={{ gridTemplateColumns: `190px repeat(${weeks.length}, minmax(0, 1fr))` }}>
            <div></div>
            {weeks.map((w, i) => <div key={w} className={`text-[10px] text-center ${i === idx ? 'font-black text-slate-900' : 'text-slate-400'}`}>{i % 2 === 0 ? weekLabel(w) : ''}</div>)}
            {(dataset.templates ?? []).map((t) => (
              <React.Fragment key={t.id}>
                <div className="text-xs font-semibold text-slate-700 truncate pr-2">{t.name}</div>
                {weeks.map((w, i) => {
                  const dw = daily.weeks.find((x) => x.weekStart === w && x.templateId === t.id);
                  const worst = Math.max(0, ...(dw?.cells.map((c) => (c.saturationPct >= 999 ? 130 : c.saturationPct)) ?? [0]));
                  return (
                    <button
                      key={w}
                      onClick={() => !editing && setWeekIdx(i)}
                      title={`${t.name} · semana del ${weekLabel(w)}: ${dw && dw.excessHours > 0.05 ? `faltan ${fmtDec(dw.excessHours, 1)} h` : 'alcanza'}${dw?.overridden ? ' · plantilla modificada' : ''}`}
                      className={`h-8 rounded-md text-[10px] font-bold text-slate-800 cursor-pointer ${i === idx ? 'ring-2 ring-slate-900' : ''}`}
                      style={{ background: dw ? heat(worst) : '#f1f5f9' }}
                    >
                      {worst > 100 ? fmtDec(Math.min(worst, 999), 0) : ''}{dw?.overridden ? '•' : ''}
                    </button>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        </div>
        <p className="text-[10px] text-slate-500 mt-2">Verde claro: holgado · verde: casi lleno · amarillo: más del 100 % · naranja: más del 110 % (se muestra el %) · el punto (•) marca una semana con la plantilla modificada.</p>
      </Card>

      {/* Tableros por plantilla */}
      {weekData.map((w) => {
        const t = editing && draft!.templateId === w.templateId ? { ...w.template, days: draft!.days, shifts: draft!.shifts } : w.template;
        const isEditing = editing && draft!.templateId === w.templateId;
        const skus = dataset.skus.filter((s) => t.lineIds.includes(s.lineId));
        const sel = selected && selected.templateId === w.templateId ? w.cells.find((c) => c.date === selected.date && c.lineId === selected.lineId) : undefined;
        const crpCrew = crpWeek?.crews.find((c) => c.crewId === t.crewId);
        const shared = t.lineIds.length > 1;
        return (
          <Card
            key={w.templateId}
            title={t.name}
            hint={`${shared ? 'Tripulación compartida: se turna entre las líneas (una por día).' : 'Línea con su propia tripulación.'} ${w.overridden ? 'Esta semana tiene la plantilla modificada.' : ''}`}
            action={
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <span className="font-mono font-bold">{fmtDec(w.requiredHours, 1)} h pedidas / {fmtDec(w.capacityHours, 1)} h de la plantilla</span>
                {w.excessHours > 0.05 && <span className="rounded-full px-2.5 py-1 font-black bg-[#FFA27D] text-black">faltan {fmtDec(w.excessHours, 1)} h</span>}
                {!isEditing && (
                  <button onClick={() => startEdit(w.template)} disabled={editing || !canEdit} title={canEdit ? undefined : 'Tu rol no puede cambiar plantillas'} className="px-3 py-1.5 font-bold bg-white/80 border border-black/10 rounded-full disabled:opacity-40 cursor-pointer">Cambiar plantilla</button>
                )}
              </div>
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-separate border-spacing-1 min-w-[640px]">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-slate-500">
                    <th className="text-left font-bold pr-2">Producto</th>
                    {w.days.map((d) => (
                      <th key={d.date} className="font-bold text-center">
                        <div>{DAY_LETTER[d.weekday - 1]}</div>
                        <div className="font-mono text-slate-400 normal-case">{dayNum(d.date)}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {skus.map((s) => (
                    <tr key={s.id}>
                      <td className="pr-2 whitespace-nowrap">
                        <div className="font-bold">{skuName(s.id)}</div>
                        <div className="text-[10px] text-slate-400">{lineName(s.lineId)}</div>
                      </td>
                      {w.days.map((d) => {
                        const scheduled = (t.days[d.weekday] ?? []).includes(s.id);
                        const cell = w.cells.find((c) => c.date === d.date && c.lineId === s.lineId);
                        const q = cell?.qty[s.id] ?? 0;
                        const isSel = selected?.date === d.date && selected?.lineId === s.lineId && selected.templateId === w.templateId;
                        if (isEditing) {
                          return (
                            <td key={d.date} className="text-center">
                              <button
                                onClick={() => toggleDay(d.weekday, s.id)}
                                aria-label={`${skuName(s.id)} ${DAY_NAME[d.weekday - 1]}`}
                                aria-pressed={scheduled}
                                className={`w-full h-11 rounded-lg border-2 text-[11px] font-black cursor-pointer ${scheduled ? 'border-slate-900' : 'border-dashed border-slate-300 text-slate-400'}`}
                                style={{ background: scheduled ? cellColor(cell) : 'transparent' }}
                              >
                                {scheduled ? (q > 0 ? fmtInt(q) : '✓') : '+'}
                              </button>
                            </td>
                          );
                        }
                        if (!scheduled && q <= 0) return <td key={d.date}><div className="h-11 rounded-lg bg-white/40"></div></td>;
                        const closed = d.closed;
                        return (
                          <td key={d.date}>
                            <button
                              onClick={() => setSelected({ templateId: w.templateId, date: d.date, lineId: s.lineId })}
                              title={closed ? 'Cerrado ese día (festivo o parada)' : `${fmtInt(q)} cajas · ${cell ? fmtDec(cell.saturationPct, 0) : 0} % de la capacidad del día`}
                              className={`w-full h-11 rounded-lg px-1 leading-tight cursor-pointer ${isSel ? 'ring-2 ring-slate-900' : ''} ${cell?.adjusted ? 'outline outline-2 outline-[#DDCBF5]' : ''}`}
                              style={closed ? { background: 'repeating-linear-gradient(45deg,#e2e8f0,#e2e8f0 4px,#f1f5f9 4px,#f1f5f9 8px)' } : { background: scheduled ? cellColor(cell) : '#DDCBF5' }}
                            >
                              {closed ? <span className="text-[10px] font-bold text-slate-500">Cerrado</span> : (
                                <>
                                  <div className="font-mono font-extrabold text-[11px]">{fmtInt(q)}</div>
                                  <div className="text-[9px] text-slate-600">{fmtDec(hoursOf(s.id, q), 1)} h</div>
                                </>
                              )}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  <tr>
                    <td className="pr-2 text-[10px] font-bold text-slate-500">Turnos</td>
                    {w.days.map((d) => (
                      <td key={d.date} className="text-center">
                        {isEditing ? (
                          <span className="inline-flex items-center gap-1">
                            <button onClick={() => setShifts(d.weekday, (draft!.shifts[d.weekday] ?? 0) - 1)} className="w-5 h-5 rounded-full bg-white/80 border border-black/10 text-[11px] font-black cursor-pointer" aria-label={`Menos turnos ${DAY_NAME[d.weekday - 1]}`}>−</button>
                            <span className="font-mono font-bold w-3">{draft!.shifts[d.weekday] ?? 0}</span>
                            <button onClick={() => setShifts(d.weekday, (draft!.shifts[d.weekday] ?? 0) + 1)} className="w-5 h-5 rounded-full bg-white/80 border border-black/10 text-[11px] font-black cursor-pointer" aria-label={`Más turnos ${DAY_NAME[d.weekday - 1]}`}>+</button>
                          </span>
                        ) : (
                          <span className="font-mono font-bold">{d.shifts || '—'}</span>
                        )}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="pr-2 text-[10px] font-bold text-slate-500">Horas del día</td>
                    {w.days.map((d) => <td key={d.date} className={`text-center font-mono text-[11px] ${d.closed ? 'text-[#c2410c] font-bold' : 'text-slate-600'}`}>{d.closed ? 'festivo' : d.hours > 0 ? fmtDec(d.hours, 0) : '—'}</td>)}
                  </tr>
                  <tr>
                    <td className="pr-2 text-[10px] font-bold text-slate-500">Carga del día</td>
                    {w.days.map((d) => {
                      const cs = w.cells.filter((c) => c.date === d.date && c.requiredHours > 0);
                      return (
                        <td key={d.date} className="text-center">
                          <div className="flex flex-col gap-0.5 items-center">
                            {cs.map((c) => (
                              <span key={c.lineId} className="inline-block rounded-full px-1.5 py-0.5 text-[10px] font-black text-black" style={{ background: cellColor(c) }} title={`${lineName(c.lineId)}: ${fmtDec(c.requiredHours, 1)} h de ${fmtDec(c.availableHours, 1)} h`}>
                                {shared ? `${lineName(c.lineId).replace('Línea ', '').slice(0, 5)} ` : ''}{c.saturationPct >= 999 ? 'sin horas' : `${fmtDec(c.saturationPct, 0)} %`}
                              </span>
                            ))}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                </tbody>
              </table>
            </div>

            <p className="text-[10px] text-slate-500 mt-1">
              Cada cuadro muestra las cajas del día y las horas que piden; el color es la carga de la línea ese día. Un cuadro lila es producción agregada con un ajuste en un día que la plantilla no trabaja.
              {crpCrew ? ` El CRP semanal supone ${fmtDec(crpCrew.availableHours, 1)} h para esta tripulación (líneas en paralelo); con esta plantilla, que trabaja una línea por día, son ${fmtDec(w.capacityHours, 1)} h.` : ''}
            </p>

            {w.unscheduled.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {w.unscheduled.map((u) => (
                  <span key={u.skuId} className="rounded-full px-2.5 py-1 text-[11px] font-black bg-[#FFF87C] text-black">
                    {skuName(u.skuId)}: {fmtInt(u.qty)} cajas {u.reason === 'NO_PRODUCTION_DAY' ? 'sin día de producción (todos sus días están cerrados)' : 'sin plantilla (el producto no está en ningún día)'}
                  </span>
                ))}
              </div>
            )}

            {isEditing && (
              <div className="mt-3 rounded-2xl bg-[#DDCBF5]/30 border border-[#DDCBF5] p-3 space-y-2 text-xs">
                <div className="font-black">Editando la plantilla · la tabla de arriba ya muestra el efecto</div>
                <div className="flex flex-wrap items-center gap-4">
                  {([['WEEK', `Solo la semana del ${weekLabel(week)}`], ['FROM', `Desde la semana del ${weekLabel(week)} en adelante`]] as const).map(([k, label]) => (
                    <label key={k} className="flex items-center gap-1.5 font-bold cursor-pointer">
                      <input type="radio" name="scope" checked={draft!.scope === k} onChange={() => setDraft({ ...draft!, scope: k })} />
                      {label}
                    </label>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input value={draft!.reason} onChange={(e) => setDraft({ ...draft!, reason: e.target.value })} placeholder="Motivo del cambio (obligatorio)" aria-label="Motivo" className="flex-1 min-w-56 rounded-xl border border-black/10 bg-white/80 px-2.5 py-2" />
                  <input value={author} onChange={(e) => setAuthor(e.target.value)} aria-label="Autor" className="w-40 rounded-xl border border-black/10 bg-white/80 px-2.5 py-2" />
                  <button onClick={saveDraft} disabled={!draft!.reason.trim() || !author.trim()} className="px-4 py-2 text-xs font-bold text-white bg-slate-950 rounded-full disabled:opacity-40 cursor-pointer">Guardar cambio</button>
                  <button onClick={() => setDraft(null)} className="px-4 py-2 text-xs font-bold bg-white/80 border border-black/10 rounded-full cursor-pointer">Cancelar</button>
                </div>
                <p className="text-[10px] text-slate-500">Haz clic en un cuadro para producir o dejar de producir ese producto ese día, y usa − / + para cambiar los turnos. Si una semana tiene un festivo o una parada, el día queda cerrado aunque tenga turnos.</p>
              </div>
            )}

            {sel && !isEditing && (
              <div className="mt-3 rounded-2xl bg-white/60 border border-white/80 p-3 text-xs space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="font-black">{DAY_NAME[sel.weekday - 1]} {dayNum(sel.date)} · {lineName(sel.lineId)}</div>
                  <button onClick={() => setSelected(null)} className="text-[11px] underline text-slate-500 cursor-pointer">Cerrar</button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <div><div className="text-[10px] uppercase font-bold text-slate-500">Cajas</div><div className="font-mono font-black">{fmtInt(Object.values(sel.qty).reduce((a, b) => a + b, 0))}</div></div>
                  <div><div className="text-[10px] uppercase font-bold text-slate-500">Horas que pide</div><div className="font-mono font-black">{fmtDec(sel.requiredHours, 1)} h</div></div>
                  <div><div className="text-[10px] uppercase font-bold text-slate-500">Horas disponibles</div><div className="font-mono font-black">{fmtDec(sel.availableHours, 1)} h</div>{sel.changeoverHours > 0 && <div className="text-[10px] text-slate-500">ya sin {fmtDec(sel.changeoverHours, 1)} h de cambio de producto</div>}</div>
                  <div><div className="text-[10px] uppercase font-bold text-slate-500">Carga</div><div className="font-mono font-black">{sel.saturationPct >= 999 ? 'sin horas' : `${fmtDec(sel.saturationPct, 0)} %`}</div></div>
                </div>
                <div className="space-y-0.5">
                  {Object.entries(sel.qty).filter(([, q]) => q > 0).map(([sid, q]) => <div key={sid} className="flex justify-between"><span>{skuName(sid)}</span><span className="font-mono">{fmtInt(q)} cajas</span></div>)}
                </div>
                {sel.excessHours > 0.05 && <div className="font-bold text-[#c2410c]">Faltan {fmtDec(sel.excessHours, 1)} h este día.</div>}
              </div>
            )}
          </Card>
        );
      })}

      {/* Optimizador diario */}
      <Card
        title="Optimizador diario"
        hint="Para cada día sobre su capacidad intenta pasar producción a otro día de la misma semana con holgura: primero a un día en que el producto ya se produce, luego a un día libre de la tripulación, el anterior más cercano primero. Lo que no cabe queda como horas extra. Es una sugerencia que se revisa y se aplica."
        action={<AiTag kind="Optimización" />}
      >
        {!weekPlan || weekPlan.overloaded === 0 ? (
          <p className="text-xs text-emerald-800 font-bold">Ningún día de esta semana pasa de su capacidad: no hay nada que rebalancear.</p>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              {[
                ['Días sobre capacidad', String(weekPlan.overloaded)],
                ['Horas que faltan', fmtDec(weekPlan.excessBefore, 1)],
                ['Se resuelven moviendo', `${fmtDec(weekPlan.movedHours, 1)} h`],
                ['Quedan como horas extra', `${fmtDec(weekPlan.extraTotal, 1)} h`],
              ].map(([k, v]) => (
                <div key={k} className="rounded-xl bg-white/60 border border-white/80 px-3 py-2">
                  <div className="text-[10px] uppercase font-bold text-slate-500">{k}</div>
                  <div className="font-mono font-black text-lg">{v}</div>
                </div>
              ))}
            </div>
            <ProgressBar value={weekPlan.movedHours} max={Math.max(weekPlan.excessBefore, 0.1)} color={SERIES_COLORS[2]} height={10} />
            {weekPlan.moves.length > 0 && (
              <ul className="text-xs space-y-1">
                {weekPlan.moves.map((m) => (
                  <li key={`${m.skuId}${m.fromDate}${m.toDate}`}>
                    <span className="font-bold">{skuName(m.skuId)}</span> · <span className="font-mono">{fmtInt(m.qty)} cajas</span> del {dayName(m.fromDate)} {dayNum(m.fromDate)} al {dayName(m.toDate)} {dayNum(m.toDate)} ({fmtDec(m.hours, 1)} h)
                    <span className="ml-1 text-[10px] font-bold rounded-full px-2 py-0.5 bg-white/80 border border-black/5">{m.kind === 'PRODUCTION_DAY' ? 'día en que ya se produce' : 'día nuevo'}</span>
                  </li>
                ))}
              </ul>
            )}
            {weekPlan.extra.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {weekPlan.extra.map((e) => <span key={`${e.lineId}${e.date}`} className="text-[11px] font-bold rounded-full px-2.5 py-1 bg-[#FFF87C] text-black">{lineName(e.lineId)} · {dayName(e.date)} {dayNum(e.date)} · {fmtDec(e.hours, 1)} h extra</span>)}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <button onClick={() => applyDailyBalance(weekPlan, author)} disabled={!canEdit || weekPlan.moves.length === 0 || editing} className="px-4 py-2 text-xs font-bold text-white bg-slate-950 rounded-full disabled:opacity-40 cursor-pointer">Aplicar los movimientos de esta semana</button>
              {!canEdit && <span className="text-[11px] text-slate-500">Tu rol no puede mover producción.</span>}
            </div>
          </div>
        )}
        <p className="text-[10px] text-slate-500 mt-3">Heurística voraz, no un óptimo matemático: no compara el costo de las horas extra con el de mantener más inventario, no considera vida útil ni la secuencia entre sabores más allá del tiempo de cambio, y adelantar producción adelanta el consumo de materiales (revisa Materiales).</p>
      </Card>

      {/* Mover a mano y ajustes */}
      <Card title="Mover producción a mano" hint="Pasa cajas de un día a otro de la semana (resta en el origen y suma en el destino) con su motivo y autor.">
        <div className="grid grid-cols-1 md:grid-cols-[1.4fr_1fr_1fr_110px] gap-2 text-xs">
          <select value={move.skuId} onChange={(e) => setMove({ ...move, skuId: e.target.value })} aria-label="Producto" className="rounded-xl border border-black/10 bg-white/80 px-2.5 py-2">
            <option value="">Producto…</option>
            {weekData.flatMap((w) => dataset.skus.filter((s) => w.template.lineIds.includes(s.lineId))).map((s) => <option key={s.id} value={s.id}>{skuName(s.id)}</option>)}
          </select>
          <select value={move.from} onChange={(e) => setMove({ ...move, from: e.target.value })} aria-label="Día origen" className="rounded-xl border border-black/10 bg-white/80 px-2.5 py-2">
            <option value="">Del día…</option>
            {[...weekDates].sort().map((d) => <option key={d} value={d}>{dayName(d)} {dayNum(d)}</option>)}
          </select>
          <select value={move.to} onChange={(e) => setMove({ ...move, to: e.target.value })} aria-label="Día destino" className="rounded-xl border border-black/10 bg-white/80 px-2.5 py-2">
            <option value="">Al día…</option>
            {[...weekDates].sort().map((d) => <option key={d} value={d}>{dayName(d)} {dayNum(d)}</option>)}
          </select>
          <input type="number" min="1" step="100" value={move.qty} onChange={(e) => setMove({ ...move, qty: e.target.value })} aria-label="Cajas" className="rounded-xl border border-black/10 bg-white/80 px-2.5 py-2 font-mono" />
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <input value={move.reason} onChange={(e) => setMove({ ...move, reason: e.target.value })} placeholder="Motivo (obligatorio)" aria-label="Motivo del movimiento" className="flex-1 min-w-56 rounded-xl border border-black/10 bg-white/80 px-2.5 py-2 text-xs" />
          <input value={author} onChange={(e) => setAuthor(e.target.value)} aria-label="Autor del movimiento" className="w-40 rounded-xl border border-black/10 bg-white/80 px-2.5 py-2 text-xs" />
          <button onClick={submitMove} disabled={!canEdit || !move.skuId || !move.from || !move.to || move.from === move.to || !(Number(move.qty) > 0) || !move.reason.trim()} className="px-4 py-2 text-xs font-bold text-white bg-slate-950 rounded-full disabled:opacity-40 cursor-pointer">Mover</button>
        </div>

        {(manualAdj.length > 0 || optAdj.length > 0) && (
          <div className="mt-3 space-y-2">
            {manualAdj.length > 0 && (
              <ul className="text-xs space-y-1">
                {manualAdj.map((a) => (
                  <li key={a.id} className="flex items-start justify-between gap-2">
                    <span><span className="font-mono font-bold">{a.deltaCommercialQty > 0 ? '+' : ''}{fmtInt(a.deltaCommercialQty)}</span> {skuName(a.skuId)} · {dayName(a.date)} {dayNum(a.date)} — {a.reason} <span className="text-slate-400">({a.author})</span></span>
                    {canEdit && <button onClick={() => removeDailyAdjustment(a.id)} className="text-slate-400 hover:text-black cursor-pointer" aria-label="Quitar">✕</button>}
                  </li>
                ))}
              </ul>
            )}
            {optAdj.length > 0 && (
              <div className="rounded-2xl bg-[#DDCBF5]/30 border border-[#DDCBF5] px-3 py-2 text-xs space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span><span className="font-black">✦ Rebalanceo diario del optimizador:</span> {Math.ceil(optAdj.length / 2)} movimiento(s) esta semana ({optAdj.length} ajustes)</span>
                  {canEdit && <button onClick={() => optAdj.forEach((a) => removeDailyAdjustment(a.id))} className="text-[11px] font-bold underline text-slate-600 hover:text-black cursor-pointer">Quitar todos</button>}
                </div>
                <Disclosure title={`Ver los ${optAdj.length} ajustes`}>
                  <ul className="space-y-1">
                    {optAdj.map((a) => (
                      <li key={a.id} className="flex items-start justify-between gap-2">
                        <span><span className="font-mono font-bold">{a.deltaCommercialQty > 0 ? '+' : ''}{fmtInt(a.deltaCommercialQty)}</span> {skuName(a.skuId)} · {dayName(a.date)} {dayNum(a.date)} <span className="text-slate-400">({a.author})</span></span>
                        {canEdit && <button onClick={() => removeDailyAdjustment(a.id)} className="text-slate-400 hover:text-black cursor-pointer" aria-label="Quitar">✕</button>}
                      </li>
                    ))}
                  </ul>
                </Disclosure>
              </div>
            )}
          </div>
        )}
      </Card>

      {templateOverrides.length > 0 && (
        <Card title="Cambios de plantilla vigentes" hint="Cada cambio queda con su motivo y su autor. Quitarlo devuelve la plantilla anterior.">
          <ul className="text-xs space-y-1.5">
            {[...templateOverrides].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((o) => (
              <li key={o.id} className="flex items-start justify-between gap-2">
                <span>
                  <span className="font-bold">{dataset.templates?.find((t) => t.id === o.templateId)?.name ?? o.templateId}</span> · {o.scope === 'WEEK' ? `solo la semana del ${weekLabel(o.weekStart)}` : `desde la semana del ${weekLabel(o.weekStart)}`} — {o.reason} <span className="text-slate-400">({o.author})</span>
                </span>
                {canEdit && <button onClick={() => removeTemplateOverride(o.id)} className="text-slate-400 hover:text-black cursor-pointer" aria-label="Quitar cambio">✕</button>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
