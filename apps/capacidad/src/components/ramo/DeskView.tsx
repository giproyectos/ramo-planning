import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { DailyAdjustment, TemplateOverride, toProductiveQty } from '@ramo/domain';
import {
  DailyCell, DailyWeek, TemplateEvaluation, buildDailySchedule, dailyAlternatives, dayAvailableHours, dayConfidence, recommendTemplates, weekdayOf, weekdayShort,
} from '@ramo/engine';
import { useRamoPlan } from '../../ramo/store';
import { useAuth } from '../../ramo/auth';
import { fmtDec, fmtInt, weekLabel } from '../../ramo/format';
import { ConfidenceChip } from './focus';

/**
 * Mesa de programación: el tablero de la semana de una línea, con cambios en borrador (se prueban antes de aplicarse),
 * arrastrar y soltar para mover producción, y un panel que explica qué falla y propone cómo arreglarlo.
 */

const LETTERS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const NAMES = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
const PASTEL = ['#C9DBFF', '#FFD9BC', '#BFEBDD', '#E4D3FA'];
const INK = ['#2b50aa', '#c9601c', '#2a9d8f', '#7c4dbd'];
const dayNum = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDate();
const dayShort = (iso: string) => `${NAMES[weekdayOf(iso) - 1]} ${dayNum(iso)}`;
const heatColor = (pct: number) => (pct > 110 ? '#FFA27D' : pct > 100 ? '#FFCB7D' : pct >= 85 ? '#FFF87C' : '#7AFFA1');

type Days = Record<number, string[]>;
type Shifts = Record<number, number>;
interface DraftMove { id: string; skuId: string; fromDate: string; toDate: string; qty: number }
interface DraftScheme { templateId: string; weekStart: string; days: Days; shifts: Shifts; source: string }
interface Draft { moves: DraftMove[]; schemes: DraftScheme[] }
const EMPTY: Draft = { moves: [], schemes: [] };
let moveSeq = 0;

interface Proposal {
  key: string;
  title: string;
  lines: string[];
  badge?: string;
  moves?: DraftMove[];
  scheme?: { days: Days; shifts: Shifts };
  eval?: TemplateEvaluation;
  extraText?: string;
}

const sameDays = (a: Days, b: Days) => JSON.stringify(Object.entries(a).filter(([, l]) => l.length).map(([d, l]) => [d, [...l].sort()]).sort()) === JSON.stringify(Object.entries(b).filter(([, l]) => l.length).map(([d, l]) => [d, [...l].sort()]).sort());

export function DeskView() {
  const {
    dataset, daily, danielView, templateOverrides, dailyAdjustments, allocationRule, setAllocationRule, saveTemplateOverride, removeTemplateOverride, moveDaily,
    removeDailyAdjustment, efficiency, can,
  } = useRamoPlan();
  const { user } = useAuth();
  const templates = dataset.templates ?? [];
  const author = user?.name ?? 'Producción';
  const canEdit = can('capacity.edit');

  const [tid, setTid] = useState<string | null>(null);
  const [weekIdx, setWeekIdx] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [past, setPast] = useState<Draft[]>([]);
  const [future, setFuture] = useState<Draft[]>([]);
  const [scope, setScope] = useState<'WEEK' | 'FROM'>('FROM');
  const [selected, setSelected] = useState<{ date: string; lineId: string; skuId?: string } | null>(null);
  const [hover, setHover] = useState<Proposal | null>(null);
  const [dragging, setDragging] = useState<{ skuId: string; date: string; qty: number; lineId: string } | null>(null);
  const [overDay, setOverDay] = useState<string | null>(null);
  const [palette, setPalette] = useState(false);
  const [query, setQuery] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [moveQty, setMoveQty] = useState('');
  const [tipOpen, setTipOpen] = useState(() => {
    try { return localStorage.getItem('mesa-tip') !== '1'; } catch { return true; }
  });

  const skuById = useMemo(() => new Map(dataset.skus.map((s) => [s.id, s])), [dataset]);
  const lineById = useMemo(() => new Map(dataset.lines.map((l) => [l.id, l])), [dataset]);
  const skuName = (id: string) => skuById.get(id)?.name.replace(' (sint.)', '') ?? id;
  const hoursOf = useCallback((skuId: string, qty: number) => {
    const s = skuById.get(skuId);
    const l = s ? lineById.get(s.lineId) : undefined;
    return s && l ? toProductiveQty(s, qty) / l.rate.value : 0;
  }, [skuById, lineById]);

  // ---- Borrador -> programación en vivo ---------------------------------------------------------------------------------
  const movesToAdj = (moves: DraftMove[]): DailyAdjustment[] =>
    moves.flatMap((m) => [
      { id: `${m.id}a`, skuId: m.skuId, date: m.fromDate, deltaCommercialQty: -m.qty, reason: '', author: '', createdAt: '' },
      { id: `${m.id}b`, skuId: m.skuId, date: m.toDate, deltaCommercialQty: m.qty, reason: '', author: '', createdAt: '' },
    ]);
  const schemesToOverrides = (schemes: DraftScheme[]): TemplateOverride[] =>
    schemes.map((s, i) => ({ id: `draft-${i}`, templateId: s.templateId, scope, weekStart: s.weekStart, days: s.days, shifts: s.shifts, reason: '', author: '', createdAt: '9999' }));

  const hasDraft = draft.moves.length > 0 || draft.schemes.length > 0;
  const schedule = (d: Draft, extra?: Proposal | null, extraTid?: string, extraWeek?: string) => {
    const ov = [...templateOverrides, ...schemesToOverrides(d.schemes)];
    const adj = [...dailyAdjustments, ...movesToAdj(d.moves), ...(extra?.moves ? movesToAdj(extra.moves) : [])];
    if (extra?.scheme && extraTid && extraWeek) ov.push({ id: 'hover', templateId: extraTid, scope, weekStart: extraWeek, days: extra.scheme.days, shifts: extra.scheme.shifts, reason: '', author: '', createdAt: '99999' });
    return buildDailySchedule(dataset, danielView.net, { overrides: ov, adjustments: adj, rule: allocationRule });
  };

  const live = useMemo(() => (hasDraft ? schedule(draft, null) : daily), [hasDraft, draft, scope, daily, dataset, danielView.net, templateOverrides, dailyAdjustments, allocationRule]); // eslint-disable-line react-hooks/exhaustive-deps
  const weeks = useMemo(() => [...new Set((live?.weeks ?? []).map((w) => w.weekStart))].sort(), [live]);
  const firstRed = useMemo(() => {
    const w = daily?.alerts.filter((a) => a.code === 'OVER_CAPACITY').map((a) => a.weekStart).sort()[0];
    return Math.max(0, weeks.indexOf(w ?? ''));
  }, [daily, weeks]);
  const idx = Math.min(weekIdx ?? firstRed, Math.max(0, weeks.length - 1));
  const week = weeks[idx];
  const defaultTid = useMemo(() => {
    const a = daily?.alerts.find((x) => x.code === 'OVER_CAPACITY' && x.weekStart === week);
    return a?.templateId ?? templates[0]?.id ?? '';
  }, [daily, week, templates]);
  const currentTid = tid ?? defaultTid;
  const tpl = templates.find((t) => t.id === currentTid);

  const hovered = useMemo(() => (hover && week ? schedule(draft, hover, currentTid, week) : null), [hover, draft, scope, week, currentTid]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = hovered ?? live;
  const w: DailyWeek | undefined = shown?.weeks.find((x) => x.weekStart === week && x.templateId === currentTid);
  const wLive: DailyWeek | undefined = live?.weeks.find((x) => x.weekStart === week && x.templateId === currentTid);

  // ---- Totales para la barra del borrador ---------------------------------------------------------------------------------
  const sumExcess = (r: typeof daily) => (r ? r.weeks.reduce((a, x) => a + x.excessHours, 0) : 0);
  const excessSaved = sumExcess(daily);
  const excessLive = sumExcess(live);

  // ---- Historial (deshacer / rehacer) ----------------------------------------------------------------------------------
  const push = useCallback((next: Draft) => {
    setPast((p) => [...p.slice(-30), draft]);
    setFuture([]);
    setDraft(next);
    setConfirming(false);
  }, [draft]);
  const undo = useCallback(() => {
    setPast((p) => {
      if (p.length === 0) return p;
      setFuture((f) => [draft, ...f]);
      setDraft(p[p.length - 1]);
      return p.slice(0, -1);
    });
  }, [draft]);
  const redo = useCallback(() => {
    setFuture((f) => {
      if (f.length === 0) return f;
      setPast((p) => [...p, draft]);
      setDraft(f[0]);
      return f.slice(1);
    });
  }, [draft]);
  const discard = useCallback(() => { push(EMPTY); setPast([]); setFuture([]); }, [push]);

  const addMove = (skuId: string, fromDate: string, toDate: string, qty: number) => {
    if (fromDate === toDate || !(qty > 0)) return;
    const q = Math.round(qty);
    const ex = draft.moves.find((m) => m.skuId === skuId && m.fromDate === fromDate && m.toDate === toDate);
    const moves = ex ? draft.moves.map((m) => (m === ex ? { ...m, qty: m.qty + q } : m)) : [...draft.moves, { id: `mv${++moveSeq}`, skuId, fromDate, toDate, qty: q }];
    push({ ...draft, moves });
    setSelected(null);
  };
  const setScheme = (days: Days, shifts: Shifts, source: string, sc?: 'WEEK' | 'FROM') => {
    if (!week || !currentTid) return;
    if (sc) setScope(sc);
    else if (draft.schemes.length === 0) setScope('WEEK');
    const rest = draft.schemes.filter((s) => s.templateId !== currentTid);
    push({ ...draft, schemes: [...rest, { templateId: currentTid, weekStart: week, days, shifts, source }] });
  };
  const editScheme = (fn: (days: Days, shifts: Shifts) => void) => {
    if (!wLive) return;
    const days: Days = JSON.parse(JSON.stringify(wLive.template.days));
    const shifts: Shifts = { ...wLive.template.shifts };
    fn(days, shifts);
    setScheme(days, shifts, 'Cambio manual en la mesa');
  };
  const setShiftsOf = (wd: number, n: number) => editScheme((_, sh) => { sh[wd] = Math.max(0, Math.min(4, n)); });
  const toggleSku = (wd: number, skuId: string) => editScheme((d) => {
    const set = new Set(d[wd] ?? []);
    if (set.has(skuId)) set.delete(skuId); else set.add(skuId);
    if (set.size === 0) delete d[wd]; else d[wd] = [...set];
  });

  const applyDraft = () => {
    if (!reason.trim() || !canEdit) return;
    for (const s of draft.schemes) saveTemplateOverride({ templateId: s.templateId, scope, weekStart: s.weekStart, days: s.days, shifts: s.shifts, reason: reason.trim(), author });
    for (const m of draft.moves) moveDaily({ skuId: m.skuId, fromDate: m.fromDate, toDate: m.toDate, qty: m.qty, reason: reason.trim(), author });
    setDraft(EMPTY); setPast([]); setFuture([]); setConfirming(false); setReason('');
  };

  // ---- Propuestas del asistente -----------------------------------------------------------------------------------------
  const dayProposals = useMemo<Proposal[]>(() => {
    if (!wLive || wLive.excessHours <= 0.05) return [];
    const alts = dailyAlternatives(dataset, { weeks: [wLive], alerts: [] });
    return alts
      .filter((a) => a.plan.moves.length > 0)
      .sort((a, b) => Number(b.recommended) - Number(a.recommended))
      .map((a) => ({
        key: `d-${a.id}`,
        title: a.label,
        badge: a.recommended ? 'Recomendada' : undefined,
        lines: [
          `Mueve ${fmtDec(a.metrics.movedHours, 1)} h entre días`,
          a.metrics.extraHours > 0 ? `Quedan ${fmtDec(a.metrics.extraHours, 1)} h para horas extra` : 'No pide horas extra',
        ],
        moves: a.plan.moves.map((m) => ({ id: `p${++moveSeq}`, skuId: m.skuId, fromDate: m.fromDate, toDate: m.toDate, qty: m.qty })),
      }));
  }, [wLive, dataset]);

  const schemeEvals = useMemo<TemplateEvaluation[]>(() => {
    if (!week || !currentTid) return [];
    return recommendTemplates(dataset, danielView.net, currentTid, { fromWeek: week, weeks: 4, overrides: templateOverrides, adjustments: dailyAdjustments, rule: allocationRule });
  }, [dataset, danielView.net, currentTid, week, templateOverrides, dailyAdjustments, allocationRule]);
  const schemeProposals = useMemo<Proposal[]>(() => {
    const cur = schemeEvals.find((e) => e.current);
    return schemeEvals
      .filter((e) => !e.current && cur && e.score < cur.score - 0.05)
      .slice(0, 3)
      .map((e, i) => ({
        key: `s-${e.id}`,
        title: i === 0 ? 'Esquema recomendado' : `Otro esquema (${i + 1})`,
        badge: i === 0 ? 'Mejor' : undefined,
        lines: [...e.versusCurrent, `Cambia ${e.changedDays} día${e.changedDays === 1 ? '' : 's'}`],
        scheme: { days: e.days, shifts: e.shifts },
        eval: e,
      }));
  }, [schemeEvals]);

  const tryProposal = (p: Proposal) => {
    setHover(null);
    if (p.moves) push({ ...draft, moves: [...draft.moves, ...p.moves] });
    if (p.scheme) {
      const rest = draft.schemes.filter((s) => s.templateId !== currentTid);
      setScope('FROM');
      push({ ...(p.moves ? { ...draft, moves: [...draft.moves, ...(p.moves ?? [])] } : draft), schemes: [...rest, { templateId: currentTid, weekStart: week!, days: p.scheme.days, shifts: p.scheme.shifts, source: p.title }] });
    }
  };

  // ---- Teclado --------------------------------------------------------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => !p); setQuery(''); return; }
      if (e.key === 'Escape') { setPalette(false); setSelected(null); return; }
      if (typing || palette) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (e.key === 'ArrowLeft') setWeekIdx(Math.max(0, idx - 1));
      if (e.key === 'ArrowRight') setWeekIdx(Math.min(weeks.length - 1, idx + 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [idx, weeks.length, palette, undo, redo]);

  if (!live || weeks.length === 0 || !tpl || !w || !wLive) {
    return <div className="glass-panel rounded-3xl p-5 text-xs">No hay esquemas de producción definidos.</div>;
  }

  // ---- Datos del tablero ------------------------------------------------------------------------------------------------
  const cols = w.days.filter((d) => d.weekday <= 6 || d.shifts > 0 || d.skuIds.length > 0);
  const lineIds = tpl.lineIds;
  const skusOfLine = (lid: string) => dataset.skus.filter((s) => s.lineId === lid);
  const colorIdx = (skuId: string) => Math.max(0, dataset.skus.filter((s) => tpl.lineIds.includes(s.lineId)).findIndex((s) => s.id === skuId)) % PASTEL.length;
  const cellOf = (ww: DailyWeek | undefined, lineId: string, date: string): DailyCell | undefined => ww?.cells.find((c) => c.lineId === lineId && c.date === date);
  const changedVsLive = (lineId: string, date: string, skuId: string) => !!hovered && Math.round(cellOf(w, lineId, date)?.qty[skuId] ?? 0) !== Math.round(cellOf(wLive, lineId, date)?.qty[skuId] ?? 0);

  const fit = (lineId: string, date: string, skuId: string, qty: number) => {
    const c = cellOf(wLive, lineId, date);
    const avail = c ? c.availableHours : dayAvailableHours(dataset, wLive.template, lineId, date);
    if (avail <= 0.01) return { state: 'closed' as const, pct: 0, over: 0 };
    const req = (c?.requiredHours ?? 0) + hoursOf(skuId, qty);
    const pct = (req / avail) * 100;
    return { state: pct > 100.05 ? ('over' as const) : ('fit' as const), pct, over: Math.max(0, req - avail) };
  };

  /** Cuántas cajas conviene mover al soltar: lo que sobra en el día de origen, sin pasar de lo que cabe en el destino; si el origen no está en rojo, todo el bloque. */
  const smartQty = (lineId: string, fromDate: string, toDate: string, skuId: string, qty: number) => {
    const src = cellOf(wLive, lineId, fromDate);
    const hpc = hoursOf(skuId, 1);
    if (!src || src.excessHours <= 0.05 || hpc <= 0) return qty;
    const need = Math.ceil(src.excessHours / hpc);
    const dst = cellOf(wLive, lineId, toDate);
    const avail = dst ? dst.availableHours : dayAvailableHours(dataset, wLive.template, lineId, toDate);
    const slack = avail - (dst?.requiredHours ?? 0);
    const q = slack > 0 ? Math.min(need, Math.floor(slack / hpc)) : need;
    return Math.max(1, Math.min(qty, q));
  };

  const alertsHere = (live?.alerts ?? []).filter((a) => a.weekStart === week && a.templateId === currentTid);
  const lineName = (id: string) => lineById.get(id)?.name.replace('Línea ', '') ?? id;
  const alertText = (a: (typeof alertsHere)[number]): { text: string; date?: string; lineId?: string } => {
    if (a.code === 'OVER_CAPACITY') return { text: `${dayShort(a.date!)} · ${lineName(a.lineId!)}: faltan ${fmtDec(a.value, 1)} h`, date: a.date, lineId: a.lineId };
    if (a.code === 'CREW_CONFLICT') return { text: `${dayShort(a.date!)}: la tripulación está en ${a.value} líneas a la vez`, date: a.date };
    if (a.code === 'NO_PRODUCTION_DAY') return { text: `${skuName(a.skuId!)}: ${fmtInt(a.value)} cajas sin día para producirse (días cerrados)` };
    return { text: `${skuName(a.skuId!)}: ${fmtInt(a.value)} cajas, pero el producto no está en el esquema` };
  };

  const redWeek = (t: string, wk: string) => (live?.weeks.find((x) => x.templateId === t && x.weekStart === wk)?.excessHours ?? 0) > 0.05;
  const weekMaxSat = (t: string, wk: string) => Math.max(0, ...((live?.weeks.find((x) => x.templateId === t && x.weekStart === wk)?.cells ?? []).map((c) => (c.saturationPct > 900 ? 130 : c.saturationPct))));
  const redCount = (t: string) => weeks.filter((wk) => redWeek(t, wk)).length;

  const sel = selected;
  const selCell = sel ? cellOf(wLive, sel.lineId, sel.date) : undefined;
  const selQty = sel?.skuId ? Math.round(selCell?.qty[sel.skuId] ?? 0) : 0;
  const savedForTpl = templateOverrides.filter((o) => o.templateId === currentTid);
  const weekDates = new Set(w.days.map((d) => d.date));
  const savedAdj = dailyAdjustments.filter((a) => weekDates.has(a.date));
  const bestProposal = [...dayProposals, ...schemeProposals][0];

  // ---- Paleta de comandos ----------------------------------------------------------------------------------------------
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const commands: { label: string; hint?: string; run: () => void }[] = [
    ...weeks.map((wk, i) => ({ label: `Ir a la semana del ${weekLabel(wk)}`, hint: redWeek(currentTid, wk) ? 'en rojo' : '', run: () => setWeekIdx(i) })),
    ...templates.map((t) => ({ label: `Ver ${t.name.split(' (')[0]}`, hint: redCount(t.id) > 0 ? `${redCount(t.id)} sem. en rojo` : '', run: () => { setTid(t.id); setSelected(null); } })),
    ...(bestProposal ? [{ label: `Probar: ${bestProposal.title}`, run: () => tryProposal(bestProposal) }] : []),
    ...(past.length ? [{ label: 'Deshacer el último cambio', hint: 'Ctrl+Z', run: undo }] : []),
    ...(future.length ? [{ label: 'Rehacer', hint: 'Ctrl+Shift+Z', run: redo }] : []),
    ...(hasDraft ? [{ label: 'Aplicar los cambios del borrador al plan', run: () => setConfirming(true) }, { label: 'Descartar el borrador', run: discard }] : []),
  ];
  const results = commands.filter((c) => norm(c.label).includes(norm(query))).slice(0, 8);

  return (
    <div className="space-y-4">
      {/* Encabezado */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight">Mesa de programación</h1>
          <p className="text-sm text-slate-600">Qué se fabrica cada día de la semana. Prueba cambios en un borrador y aplícalos al plan cuando te convenzan.</p>
        </div>
        <button onClick={() => { setPalette(true); setQuery(''); }} className="glass-pill rounded-full px-4 py-2 text-xs font-bold text-slate-700 cursor-pointer flex items-center gap-2">
          Buscar o ir a… <kbd className="font-mono text-[10px] bg-black/5 rounded px-1.5 py-0.5">Ctrl K</kbd>
        </button>
      </div>

      {tipOpen && (
        <div className="rounded-2xl bg-[#DDCBF5]/45 border border-[#DDCBF5] px-4 py-2.5 text-xs flex items-center justify-between gap-3">
          <span><b>Cómo usarla:</b> arrastra un bloque a otro día para moverlo, haz clic en un día para ver opciones, y mira a la derecha lo que propone el asistente. Nada cambia en el plan hasta que lo aplicas.</span>
          <button onClick={() => { setTipOpen(false); try { localStorage.setItem('mesa-tip', '1'); } catch { /* sin almacenamiento */ } }} className="font-bold underline shrink-0 cursor-pointer">Entendido</button>
        </div>
      )}

      {/* Línea y semana */}
      <section className="glass-panel rounded-3xl p-4 space-y-3">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Línea o grupo de líneas">
          {templates.map((t) => {
            const on = t.id === currentTid;
            const rc = redCount(t.id);
            return (
              <button key={t.id} role="tab" aria-selected={on} onClick={() => { setTid(t.id); setSelected(null); }}
                className={`px-3.5 py-2 rounded-2xl text-xs font-black flex items-center gap-2 cursor-pointer transition-all ${on ? 'bg-slate-950 text-white shadow-md' : 'bg-white/70 hover:bg-white text-slate-800'}`}>
                <span className="w-2 h-2 rounded-full" style={{ background: rc > 0 ? '#FF7A45' : '#34d399' }} />
                {t.name.split(' (')[0]}
                {rc > 0 && <span className={`text-[10px] font-bold ${on ? 'text-slate-300' : 'text-slate-500'}`}>{rc} sem.</span>}
              </button>
            );
          })}
        </div>
        <div className="flex items-end gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Semana">
          <button onClick={() => setWeekIdx(Math.max(0, idx - 1))} disabled={idx === 0} aria-label="Semana anterior" className="shrink-0 w-7 h-7 rounded-full bg-white/70 text-xs font-black disabled:opacity-30 cursor-pointer">←</button>
          {weeks.map((wk, i) => {
            const on = i === idx;
            const sat = weekMaxSat(currentTid, wk);
            return (
              <button key={wk} role="tab" aria-selected={on} onClick={() => { setWeekIdx(i); setSelected(null); }} title={`Semana del ${weekLabel(wk)}: ${redWeek(currentTid, wk) ? 'hay días en rojo' : 'alcanza'}`}
                className={`shrink-0 w-[58px] rounded-2xl px-1.5 pt-1.5 pb-1 text-center cursor-pointer transition-all ${on ? 'bg-white shadow-md ring-2 ring-slate-950' : 'bg-white/50 hover:bg-white/80'}`}>
                <div className="h-8 flex items-end justify-center">
                  <div className="w-5 rounded-t-md" style={{ height: `${Math.max(12, Math.min(100, (sat / 130) * 100))}%`, background: heatColor(sat) }} />
                </div>
                <div className="text-[10px] font-bold text-slate-700 mt-1">{weekLabel(wk)}</div>
              </button>
            );
          })}
          <button onClick={() => setWeekIdx(Math.min(weeks.length - 1, idx + 1))} disabled={idx === weeks.length - 1} aria-label="Semana siguiente" className="shrink-0 w-7 h-7 rounded-full bg-white/70 text-xs font-black disabled:opacity-30 cursor-pointer">→</button>
        </div>
      </section>

      {/* Barra del borrador */}
      {hasDraft && (
        <div className="sticky top-[70px] z-10 rounded-2xl bg-slate-950 text-white px-4 py-3 shadow-lg">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="text-xs font-black flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-[#7AFFA1] animate-pulse" /> Borrador · {draft.moves.length + draft.schemes.length} cambio{draft.moves.length + draft.schemes.length === 1 ? '' : 's'}</span>
            <span className="text-xs">
              Horas que faltan en el horizonte: <b className="font-mono">{fmtDec(excessSaved, 1)}</b> → <b className={`font-mono ${excessLive < excessSaved - 0.05 ? 'text-[#7AFFA1]' : excessLive > excessSaved + 0.05 ? 'text-[#FFA27D]' : ''}`}>{fmtDec(excessLive, 1)}</b> h
            </span>
            {draft.schemes.length > 0 && (
              <span className="text-xs flex items-center gap-1.5">
                Esquema:
                {(['WEEK', 'FROM'] as const).map((s) => (
                  <button key={s} onClick={() => setScope(s)} aria-pressed={scope === s} className={`px-2.5 py-1 rounded-full text-[11px] font-bold cursor-pointer ${scope === s ? 'bg-white text-black' : 'bg-white/10 hover:bg-white/20'}`}>{s === 'WEEK' ? 'solo esta semana' : 'desde esta semana'}</button>
                ))}
              </span>
            )}
            <span className="ml-auto flex items-center gap-2">
              <button onClick={undo} disabled={past.length === 0} className="text-[11px] font-bold px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-30 cursor-pointer">Deshacer</button>
              <button onClick={redo} disabled={future.length === 0} className="text-[11px] font-bold px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-30 cursor-pointer">Rehacer</button>
              <button onClick={discard} className="text-[11px] font-bold px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 cursor-pointer">Descartar</button>
              <button onClick={() => setConfirming(!confirming)} disabled={!canEdit} className="text-[11px] font-black px-4 py-1.5 rounded-full bg-[#7AFFA1] text-black disabled:opacity-40 cursor-pointer">Aplicar al plan</button>
            </span>
          </div>
          {confirming && (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/15 pt-3">
              <label className="text-xs font-bold" htmlFor="motivo">Motivo del cambio</label>
              <input id="motivo" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') applyDraft(); }} placeholder="Ej.: empaque de Mini llega el jueves" className="flex-1 min-w-[220px] rounded-xl bg-white text-black px-3 py-1.5 text-xs" />
              <button onClick={applyDraft} disabled={!reason.trim()} className="text-[11px] font-black px-4 py-1.5 rounded-full bg-[#7AFFA1] text-black disabled:opacity-40 cursor-pointer">Confirmar · {author}</button>
            </div>
          )}
          {!canEdit && <div className="mt-2 text-[11px] text-slate-300">Tu rol puede probar cambios pero no aplicarlos.</div>}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_330px] gap-4 items-start">
        {/* Tablero */}
        <section className="glass-panel rounded-3xl p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div>
              <h2 className="text-sm font-black">{tpl.name}</h2>
              <p className="text-[11px] text-slate-500">Semana del {weekLabel(week)} · {fmtDec(w.requiredHours, 1)} h pedidas de {fmtDec(w.capacityHours, 1)} h del esquema{w.overridden ? ' · esquema modificado' : ''}</p>
            </div>
            {w.excessHours > 0.05 ? <span className="rounded-full px-3 py-1 text-[11px] font-black bg-[#FFA27D]">Faltan {fmtDec(w.excessHours, 1)} h</span> : <span className="rounded-full px-3 py-1 text-[11px] font-black bg-[#7AFFA1]">Todo cabe</span>}
          </div>

          <div className="overflow-x-auto">
            <div className="grid gap-1.5 min-w-[640px]" style={{ gridTemplateColumns: `130px repeat(${cols.length}, minmax(84px, 1fr))` }}>
              {/* Cabecera de días */}
              <div />
              {cols.map((d) => {
                const dq = dragging ? smartQty(dragging.lineId, dragging.date, d.date, dragging.skuId, dragging.qty) : 0;
                const f = dragging ? fit(dragging.lineId, d.date, dragging.skuId, dq) : null;
                const isDrop = dragging && overDay === d.date && f && f.state !== 'closed' && d.date !== dragging.date;
                return (
                  <div key={d.date} onDragOver={(e) => { if (dragging) { e.preventDefault(); setOverDay(d.date); } }} onDragLeave={() => setOverDay(null)}
                    onDrop={(e) => { e.preventDefault(); if (dragging && f && f.state !== 'closed') addMove(dragging.skuId, dragging.date, d.date, dq); setDragging(null); setOverDay(null); }}
                    className={`rounded-2xl px-2 py-1.5 text-center transition-all ${isDrop ? 'bg-white ring-2 ring-slate-950' : 'bg-white/50'} ${d.closed ? 'opacity-60' : ''}`}>
                    <div className="text-[11px] font-black">{LETTERS[d.weekday - 1]} <span className="font-mono font-bold text-slate-500">{dayNum(d.date)}</span></div>
                    {d.closed ? <div className="text-[10px] font-bold text-slate-500">Cerrado</div> : (
                      <div className="flex items-center justify-center gap-1 text-[10px] text-slate-600 mt-0.5">
                        <button aria-label="Menos turnos" disabled={!canEdit || d.shifts <= 0} onClick={() => setShiftsOf(d.weekday, d.shifts - 1)} className="w-4 h-4 rounded-full bg-black/5 hover:bg-black/10 font-black leading-none disabled:opacity-30 cursor-pointer">−</button>
                        <span className="font-bold whitespace-nowrap">{d.shifts} {d.shifts === 1 ? 'turno' : 'turnos'}</span>
                        <button aria-label="Más turnos" disabled={!canEdit || d.shifts >= 4} onClick={() => setShiftsOf(d.weekday, d.shifts + 1)} className="w-4 h-4 rounded-full bg-black/5 hover:bg-black/10 font-black leading-none disabled:opacity-30 cursor-pointer">+</button>
                      </div>
                    )}
                    {dragging && f && d.date !== dragging.date && (
                      <div className={`mt-1 text-[10px] font-black rounded-full px-1.5 py-0.5 ${f.state === 'closed' ? 'bg-slate-200 text-slate-600' : f.state === 'over' ? 'bg-[#FFA27D]' : 'bg-[#7AFFA1]'}`}>
                        {f.state === 'closed' ? 'cerrado' : f.state === 'over' ? `excede ${fmtDec(f.over, 1)} h` : `cabe · ${fmtDec(f.pct, 0)} %`}
                        <div className="font-mono font-bold opacity-70">{f.state !== 'closed' ? `${fmtInt(dq)} cajas` : ''}</div>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Líneas */}
              {lineIds.map((lid) => (
                <React.Fragment key={lid}>
                  {lineIds.length > 1 && (
                    <div className="col-span-full text-[10px] font-extrabold uppercase tracking-wider text-slate-500 pt-2 pl-1">{lineById.get(lid)?.name} · {fmtInt(lineById.get(lid)?.rate.value ?? 0)} {lineById.get(lid)?.rate.unit}</div>
                  )}
                  {skusOfLine(lid).map((s) => (
                    <React.Fragment key={s.id}>
                      <div className="flex items-center gap-2 pr-1 min-w-0">
                        <span className="w-2.5 h-8 rounded-full shrink-0" style={{ background: INK[colorIdx(s.id)] }} />
                        <span className="text-[11px] font-bold leading-tight truncate" title={skuName(s.id)}>{skuName(s.id)}</span>
                      </div>
                      {cols.map((d) => {
                        const c = cellOf(w, lid, d.date);
                        const qty = c?.qty[s.id] ?? 0;
                        const inScheme = (w.template.days[d.weekday] ?? []).includes(s.id);
                        const isSel = sel && sel.date === d.date && sel.skuId === s.id;
                        const changed = changedVsLive(lid, d.date, s.id);
                        if (qty > 0.5) {
                          return (
                            <button key={d.date} draggable
                              onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', s.id); setDragging({ skuId: s.id, date: d.date, qty: Math.round(qty), lineId: lid }); setSelected(null); }}
                              onDragEnd={() => { setDragging(null); setOverDay(null); }}
                              onClick={() => { setSelected(isSel ? null : { date: d.date, lineId: lid, skuId: s.id }); setMoveQty(String(Math.round(qty))); }}
                              aria-label={`${skuName(s.id)}, ${dayShort(d.date)}: ${fmtInt(qty)} cajas`}
                              className={`rounded-xl h-12 px-1.5 flex flex-col items-center justify-center cursor-grab active:cursor-grabbing transition-all hover:shadow-md ${isSel ? 'ring-2 ring-slate-950' : changed ? 'ring-2 ring-[#9b6fe0]' : ''}`}
                              style={{ background: PASTEL[colorIdx(s.id)], border: `1px solid ${INK[colorIdx(s.id)]}33`, opacity: dragging && dragging.date === d.date && dragging.skuId === s.id ? 0.4 : 1 }}>
                              <span className="font-mono font-black text-[12px] leading-none">{fmtInt(qty)}</span>
                              <span className="text-[10px] text-slate-700 leading-none mt-1">{fmtDec(hoursOf(s.id, qty), 1)} h{c?.adjusted ? ' ✎' : ''}</span>
                            </button>
                          );
                        }
                        if (inScheme) {
                          return <button key={d.date} onClick={() => canEdit && toggleSku(d.weekday, s.id)} title="Está en el esquema, sin producción esta semana. Clic para quitarlo del día." className="rounded-xl h-12 border border-dashed text-[10px] text-slate-500 cursor-pointer hover:bg-white/60" style={{ borderColor: `${INK[colorIdx(s.id)]}66` }}>en esquema</button>;
                        }
                        return (
                          <button key={d.date} onClick={() => canEdit && toggleSku(d.weekday, s.id)} disabled={!canEdit || d.closed} title={`Agregar ${skuName(s.id)} al esquema ese día`} aria-label={`Agregar ${skuName(s.id)} el ${dayShort(d.date)}`}
                            className="rounded-xl h-12 text-slate-300 hover:text-slate-700 hover:bg-white/60 text-lg font-light cursor-pointer disabled:cursor-default disabled:opacity-40">+</button>
                        );
                      })}
                    </React.Fragment>
                  ))}

                  {/* Carga del día de la línea */}
                  <div className="flex items-center text-[10px] font-bold text-slate-500 uppercase tracking-wider pr-1">Carga del día</div>
                  {cols.map((d) => {
                    const c = cellOf(w, lid, d.date);
                    const eff = efficiency[lid];
                    const avail = c ? c.availableHours + c.changeoverHours : dayAvailableHours(dataset, w.template, lid, d.date);
                    if (!c || (c.requiredHours < 0.01 && c.skuIds.length === 0)) {
                      return <div key={d.date} className="h-12 rounded-xl bg-white/30 text-[10px] text-slate-400 flex items-center justify-center">{avail > 0.01 ? `libre · ${fmtDec(avail, 0)} h` : 'sin turno'}</div>;
                    }
                    const pct = c.saturationPct > 900 ? 130 : c.saturationPct;
                    const p = eff ? dayConfidence(eff, c.weekday, c.requiredHours, c.availableHours) : null;
                    const realisticPct = eff ? (eff.byWeekday[c.weekday] ?? eff.mean) * (c.availableHours / Math.max(0.01, c.availableHours + c.changeoverHours)) * 100 : null;
                    const isSel = sel && sel.date === d.date && sel.lineId === lid && !sel.skuId;
                    return (
                      <button key={d.date} onClick={() => setSelected(isSel ? null : { date: d.date, lineId: lid })} aria-label={`Carga ${dayShort(d.date)}: ${fmtDec(pct, 0)} %`}
                        className={`h-12 rounded-xl px-2 py-1.5 text-left bg-white/60 cursor-pointer ${isSel ? 'ring-2 ring-slate-950' : ''}`}>
                        <div className="relative h-2.5 rounded-full bg-black/10 overflow-visible">
                          <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(100, pct)}%`, background: heatColor(pct) }} />
                          {c.changeoverHours > 0 && <div className="absolute inset-y-0 right-0 rounded-r-full bg-slate-400/50" style={{ width: `${(c.changeoverHours / (c.availableHours + c.changeoverHours)) * 100}%` }} title={`${fmtDec(c.changeoverHours, 1)} h de cambio de producto`} />}
                          {realisticPct !== null && <div className="absolute -top-1 -bottom-1 w-0.5 bg-slate-900/70" style={{ left: `${Math.min(100, realisticPct)}%` }} title={`Capacidad realista según el historial: ${fmtDec(realisticPct, 0)} %`} />}
                        </div>
                        <div className="flex items-center justify-between mt-1">
                          <span className={`font-mono text-[10px] font-bold ${pct > 100 ? 'text-[#c2410c]' : 'text-slate-600'}`}>{c.saturationPct > 900 ? 'sin horas' : `${fmtDec(pct, 0)} %`}</span>
                          {p !== null && c.requiredHours > 0.01 && <ConfidenceChip p={p} over={pct > 100} compact title="Probabilidad de que el día alcance con el rendimiento real de la línea" />}
                        </div>
                      </button>
                    );
                  })}
                </React.Fragment>
              ))}
            </div>
          </div>
          <p className="text-[10px] text-slate-500 mt-3">La barra muestra la carga contra las horas del día; la raya oscura es la capacidad realista según el historial (sintético) y la franja gris, el tiempo de cambio de producto. Arrastra un bloque para moverlo de día.</p>

          {/* Detalle del día / bloque */}
          {sel && (
            <div className="mt-4 rounded-2xl bg-white/80 border border-white p-4 text-xs space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-black">{sel.skuId ? skuName(sel.skuId) : `Línea ${lineName(sel.lineId)}`} · {dayShort(sel.date)}</div>
                  {selCell && <div className="text-slate-600 mt-0.5">{fmtDec(selCell.requiredHours, 1)} h pedidas de {fmtDec(selCell.availableHours, 1)} h disponibles ({selCell.saturationPct > 900 ? 'sin horas' : `${fmtDec(selCell.saturationPct, 0)} %`}){selCell.changeoverHours > 0 ? ` · ${fmtDec(selCell.changeoverHours, 1)} h de cambio de producto` : ''}</div>}
                </div>
                <button onClick={() => setSelected(null)} aria-label="Cerrar detalle" className="text-slate-500 hover:text-black font-black cursor-pointer">✕</button>
              </div>
              {sel.skuId ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <label htmlFor="qty" className="font-bold">Mover</label>
                    <input id="qty" type="number" min={1} max={selQty} step={100} value={moveQty} onChange={(e) => setMoveQty(e.target.value)} className="w-24 rounded-lg border border-black/10 bg-white px-2 py-1 font-mono" />
                    <span className="text-slate-500">de {fmtInt(selQty)} cajas a:</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {cols.filter((d) => d.date !== sel.date).map((d) => {
                      const q = Math.max(1, Math.min(selQty, Number(moveQty) || selQty));
                      const f = fit(sel.lineId, d.date, sel.skuId!, q);
                      return (
                        <button key={d.date} disabled={f.state === 'closed'} onClick={() => addMove(sel.skuId!, sel.date, d.date, q)}
                          className={`px-3 py-1.5 rounded-full font-bold cursor-pointer disabled:opacity-40 border border-black/5 ${f.state === 'over' ? 'bg-[#FFA27D]/60' : f.state === 'fit' ? 'bg-[#7AFFA1]/60' : 'bg-slate-200'}`}>
                          {dayShort(d.date)} · {f.state === 'closed' ? 'cerrado' : f.state === 'over' ? `excede ${fmtDec(f.over, 1)} h` : `cabe ${fmtDec(f.pct, 0)} %`}
                        </button>
                      );
                    })}
                  </div>
                  {!canEdit && <p className="text-slate-500">Tu rol puede probar el movimiento pero no aplicarlo al plan.</p>}
                </div>
              ) : (
                <ul className="space-y-1">
                  {alertsHere.filter((a) => a.date === sel.date).map((a, i) => <li key={i}>• {alertText(a).text}</li>)}
                  {alertsHere.filter((a) => a.date === sel.date).length === 0 && <li className="text-slate-500">Sin alertas ese día. Haz clic en un bloque para moverlo.</li>}
                </ul>
              )}
            </div>
          )}
        </section>

        {/* Panel del asistente */}
        <aside className="space-y-3 xl:sticky xl:top-[150px]">
          <section className="glass-panel rounded-3xl p-4">
            <h2 className="text-xs font-black uppercase tracking-wider text-slate-500 mb-2">Atención</h2>
            {alertsHere.length === 0 ? (
              <p className="text-xs font-bold text-emerald-800">Todo cabe esta semana en {tpl.name.split(' (')[0].toLowerCase()}.</p>
            ) : (
              <ul className="space-y-1.5">
                {alertsHere.slice(0, 6).map((a, i) => {
                  const t = alertText(a);
                  return (
                    <li key={i}>
                      <button onClick={() => t.date && setSelected({ date: t.date, lineId: t.lineId ?? lineIds[0] })} className="w-full text-left text-xs rounded-xl bg-[#FFA27D]/25 hover:bg-[#FFA27D]/40 px-3 py-2 font-semibold cursor-pointer">{t.text}</button>
                    </li>
                  );
                })}
                {alertsHere.length > 6 && <li className="text-[11px] text-slate-500">y {alertsHere.length - 6} más</li>}
              </ul>
            )}
          </section>

          <section className="glass-panel rounded-3xl p-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xs font-black uppercase tracking-wider text-slate-500">Propuestas</h2>
              <span className="text-[10px] font-black rounded-full px-2 py-0.5 bg-[#DDCBF5]" title="Cálculo de optimización con simulación; no usa un modelo de lenguaje. Sugiere: una persona decide.">✦ Asistente</span>
            </div>
            {dayProposals.length + schemeProposals.length === 0 ? (
              <p className="text-xs text-slate-600">{w.excessHours > 0.05 ? 'No hay una forma de moverlo que reduzca el exceso. Prueba horas extra o cambia turnos.' : 'Nada que arreglar: el esquema vigente alcanza para estas semanas.'}</p>
            ) : (
              <div className="space-y-2">
                {[...dayProposals.slice(0, 1), ...schemeProposals.slice(0, 1), ...dayProposals.slice(1), ...schemeProposals.slice(1)].map((p, i) => (
                  <div key={p.key} onMouseEnter={() => setHover(p)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(p)} onBlur={() => setHover(null)}
                    className={`rounded-2xl p-3 border transition-all ${i < 2 ? 'bg-white/90 border-white' : 'bg-white/50 border-white/60'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-xs font-black leading-tight">{p.title}</div>
                      {p.badge && <span className="text-[9px] font-black rounded-full px-2 py-0.5 bg-[#7AFFA1] shrink-0">{p.badge}</span>}
                    </div>
                    <ul className="mt-1.5 text-[11px] text-slate-700 space-y-0.5">{p.lines.map((l) => <li key={l}>✓ {l}</li>)}</ul>
                    {p.scheme && <MiniScheme days={p.scheme.days} skuIds={skusOfLine(lineIds[0]).concat(lineIds.slice(1).flatMap(skusOfLine)).map((s) => s.id)} colorIdx={colorIdx} skuName={skuName} />}
                    {(() => {
                      const inDraft = p.scheme ? draft.schemes.some((x) => x.templateId === currentTid && sameDays(x.days, p.scheme!.days)) : !!p.moves && p.moves.every((m) => draft.moves.some((d) => d.skuId === m.skuId && d.fromDate === m.fromDate && d.toDate === m.toDate));
                      return <button onClick={() => tryProposal(p)} disabled={inDraft} className="mt-2 px-3.5 py-1.5 text-[11px] font-black rounded-full bg-slate-950 text-white cursor-pointer disabled:bg-slate-300 disabled:text-slate-600 disabled:cursor-default">{inDraft ? 'Ya está en el borrador ✓' : 'Probar en el borrador'}</button>;
                    })()}
                  </div>
                ))}
                <p className="text-[10px] text-slate-500">Pasa el cursor por una propuesta para verla en el tablero sin aplicarla.</p>
              </div>
            )}
          </section>

          <details className="glass-panel rounded-3xl p-4 text-xs">
            <summary className="font-black uppercase tracking-wider text-[11px] text-slate-500 cursor-pointer">Cambios vigentes ({savedForTpl.length + savedAdj.length})</summary>
            <div className="mt-3 space-y-2">
              {savedForTpl.length + savedAdj.length === 0 && <p className="text-slate-500">Todavía no hay cambios aplicados en esta línea.</p>}
              {savedForTpl.map((o) => (
                <div key={o.id} className="rounded-xl bg-white/70 px-3 py-2 flex items-start justify-between gap-2">
                  <span><b>Esquema {o.scope === 'WEEK' ? 'solo la semana' : 'desde la semana'} del {weekLabel(o.weekStart)}</b><br /><span className="text-slate-500">{o.reason} · {o.author}</span></span>
                  {canEdit && <button onClick={() => removeTemplateOverride(o.id)} className="font-bold underline shrink-0 cursor-pointer">Quitar</button>}
                </div>
              ))}
              {savedAdj.map((a) => (
                <div key={a.id} className="rounded-xl bg-white/70 px-3 py-2 flex items-start justify-between gap-2">
                  <span><b>{a.deltaCommercialQty > 0 ? '+' : ''}{fmtInt(a.deltaCommercialQty)} {skuName(a.skuId)}</b> · {dayShort(a.date)}<br /><span className="text-slate-500">{a.reason} · {a.author}</span></span>
                  {canEdit && <button onClick={() => removeDailyAdjustment(a.id)} className="font-bold underline shrink-0 cursor-pointer">Quitar</button>}
                </div>
              ))}
            </div>
          </details>

          <details className="glass-panel rounded-3xl p-4 text-xs">
            <summary className="font-black uppercase tracking-wider text-[11px] text-slate-500 cursor-pointer">Opciones</summary>
            <div className="mt-3 space-y-1.5">
              <div className="font-bold">¿Cómo se reparte la semana entre los días de producción?</div>
              {([['EVEN', 'Parejo según las horas de cada día'], ['COVER', 'Cada día cubre hasta la próxima producción']] as const).map(([v, label]) => (
                <label key={v} className="flex items-center gap-2 cursor-pointer"><input type="radio" name="rule" checked={allocationRule === v} onChange={() => setAllocationRule(v)} /> {label}</label>
              ))}
            </div>
          </details>
        </aside>
      </div>

      {/* Paleta de comandos */}
      {palette && (
        <div className="fixed inset-0 z-50 bg-slate-950/30 backdrop-blur-sm flex items-start justify-center pt-[15vh] px-4" onClick={() => setPalette(false)}>
          <div role="dialog" aria-label="Buscar o ir a" className="w-full max-w-lg glass-panel rounded-3xl p-3 shadow-2xl bg-white/90" onClick={(e) => e.stopPropagation()}>
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) { results[0].run(); setPalette(false); } }} placeholder="Ir a una semana, cambiar de línea, deshacer…" className="w-full rounded-2xl bg-white px-4 py-3 text-sm border border-black/10" />
            <ul className="mt-2 max-h-72 overflow-y-auto">
              {results.map((r) => (
                <li key={r.label}>
                  <button onClick={() => { r.run(); setPalette(false); }} className="w-full text-left px-4 py-2 rounded-xl hover:bg-black/5 text-xs font-semibold flex items-center justify-between cursor-pointer">
                    {r.label}<span className="text-[10px] text-slate-500">{r.hint}</span>
                  </button>
                </li>
              ))}
              {results.length === 0 && <li className="px-4 py-3 text-xs text-slate-500">Nada coincide.</li>}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

/** Vista mínima de un esquema: lunes a sábado con el producto de cada día. */
function MiniScheme({ days, skuIds, colorIdx, skuName }: { days: Days; skuIds: string[]; colorIdx: (id: string) => number; skuName: (id: string) => string }) {
  return (
    <div className="mt-2 grid grid-cols-6 gap-0.5">
      {[1, 2, 3, 4, 5, 6].map((d) => (
        <div key={d} className="text-center">
          <div className="text-[9px] font-bold text-slate-500">{weekdayShort(d)}</div>
          {(days[d] ?? []).length === 0 ? <div className="h-5 rounded border border-dashed border-black/10" /> : (days[d] ?? []).filter((id) => skuIds.includes(id)).map((id) => (
            <div key={id} title={skuName(id)} className="h-5 rounded text-[9px] font-black flex items-center justify-center overflow-hidden" style={{ background: PASTEL[colorIdx(id)] }}>{skuName(id).slice(0, 4)}</div>
          ))}
        </div>
      ))}
    </div>
  );
}
