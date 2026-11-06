import React, { useState } from 'react';
import { CalendarExceptionReason, ChangeCause, PlantRule, PlantRuleSpec } from '@ramo/domain';

export const CAUSES: { id: ChangeCause; label: string }[] = [
  { id: 'PACKAGING', label: 'Empaque que no llega' },
  { id: 'STAFF', label: 'Personal' },
  { id: 'EQUIPMENT', label: 'Equipo' },
  { id: 'FOCUS', label: 'Foco de la planta (volumen o ahorro)' },
  { id: 'OTHER', label: 'Otro' },
];
export const causeLabel = (c?: ChangeCause) => CAUSES.find((x) => x.id === c)?.label ?? '';

const WEEKDAYS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const field = 'rounded-lg border border-black/10 bg-white px-2 py-1.5 text-xs';

export const CAL_TYPES: { id: CalendarExceptionReason; label: string; hours: number; hint: string }[] = [
  { id: 'HOLIDAY', label: 'Festivo', hours: 0, hint: 'La línea no trabaja ese día.' },
  { id: 'PLANT_STOP', label: 'Parada no programada', hours: 0, hint: 'Avería, falta de material o personal: indica cuántas horas sí quedan (0 = día perdido).' },
  { id: 'MAINTENANCE', label: 'Mantenimiento', hours: 0, hint: 'Parada programada: indica cuántas horas sí quedan (0 = día completo).' },
  { id: 'EXTENDED', label: 'Turno extendido', hours: 12, hint: 'Horas totales de trabajo ese día (más que las normales).' },
];

/** Registrar un festivo, una parada, un mantenimiento, un cierre o un turno extendido en una o varias líneas. Va al borrador. */
export function CalendarForm({
  lines, days, defaultDate, onAdd, onCancel,
}: {
  lines: { id: string; name: string }[];
  days: { date: string; label: string }[];
  defaultDate: string;
  onAdd: (e: { lineIds: string[]; date: string; hours: number; reason: CalendarExceptionReason; note: string }) => void;
  onCancel: () => void;
}) {
  const [date, setDate] = useState(defaultDate);
  const [type, setType] = useState<CalendarExceptionReason>('PLANT_STOP');
  const [hours, setHours] = useState('0');
  const [picked, setPicked] = useState<string[]>(lines.map((l) => l.id));
  const [note, setNote] = useState('');
  const info = CAL_TYPES.find((t) => t.id === type)!;
  const h = Number(hours);
  const valid = picked.length > 0 && h >= 0 && h <= 24 && Number.isFinite(h);

  return (
    <div className="mb-4 rounded-2xl bg-white/80 border border-white p-4 text-xs space-y-3" role="group" aria-label="Registrar parada o festivo">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-black">Registrar parada o festivo</div>
          <p className="text-slate-500 mt-0.5">{info.hint} El cambio va al borrador: se ve en la programación diaria y se aplica con el resto.</p>
        </div>
        <button onClick={onCancel} aria-label="Cerrar" className="text-slate-500 hover:text-black font-black cursor-pointer">✕</button>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 font-bold">Tipo
          <select value={type} onChange={(e) => { const t = e.target.value as CalendarExceptionReason; setType(t); setHours(String(CAL_TYPES.find((x) => x.id === t)!.hours)); }} className={field}>
            {CAL_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 font-bold">Día
          <select value={date} onChange={(e) => setDate(e.target.value)} className={field}>
            {days.map((d) => <option key={d.date} value={d.date}>{d.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 font-bold">{type === 'EXTENDED' ? 'Horas del día' : 'Horas que quedan'}
          <input type="number" min={0} max={24} step={0.5} value={hours} onChange={(e) => setHours(e.target.value)} className={`${field} w-24 font-mono`} />
        </label>
        <label className="flex flex-col gap-1 font-bold flex-1 min-w-[180px]">Nota (opcional)
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej.: se dañó la selladora" className={field} />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-bold">Líneas:</span>
        {lines.map((l) => (
          <label key={l.id} className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={picked.includes(l.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, l.id] : picked.filter((x) => x !== l.id))} /> {l.name}
          </label>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <button onClick={() => valid && onAdd({ lineIds: picked, date, hours: h, reason: type, note: note.trim() })} disabled={!valid} className="px-4 py-2 text-[11px] font-black rounded-full bg-slate-950 text-white disabled:opacity-40 cursor-pointer">Agregar al borrador</button>
        <button onClick={onCancel} className="text-[11px] font-bold underline cursor-pointer">Cancelar</button>
      </div>
    </div>
  );
}

/** Cambiar el orden de la semana en bloque: invertirlo o intercambiar los días de dos productos. */
export function SequenceMenu({
  skus, onInvert, onSwapProducts, onClose,
}: {
  skus: { id: string; name: string }[];
  onInvert: () => void;
  onSwapProducts: (a: string, b: string) => void;
  onClose: () => void;
}) {
  const [a, setA] = useState(skus[0]?.id ?? '');
  const [b, setB] = useState(skus[1]?.id ?? skus[0]?.id ?? '');
  return (
    <div className="mb-4 rounded-2xl bg-white/80 border border-white p-4 text-xs space-y-3" role="group" aria-label="Cambiar la secuencia">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-black">Cambiar la secuencia de la semana</div>
          <p className="text-slate-500 mt-0.5">Para casos como «esta semana primero barras y después chocomini». Los turnos de cada día no cambian; el resultado va al borrador y se puede deshacer.</p>
        </div>
        <button onClick={onClose} aria-label="Cerrar" className="text-slate-500 hover:text-black font-black cursor-pointer">✕</button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => { onInvert(); onClose(); }} className="px-4 py-2 text-[11px] font-black rounded-full bg-slate-950 text-white cursor-pointer">Invertir el orden de la semana</button>
        <span className="text-slate-500">el último producto pasa a hacerse primero y así hacia atrás</span>
      </div>
      {skus.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-bold">Intercambiar los días de</span>
          <select value={a} onChange={(e) => setA(e.target.value)} className={field} aria-label="Primer producto">{skus.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <span className="font-bold">y de</span>
          <select value={b} onChange={(e) => setB(e.target.value)} className={field} aria-label="Segundo producto">{skus.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <button onClick={() => { if (a !== b) { onSwapProducts(a, b); onClose(); } }} disabled={a === b} className="px-4 py-1.5 text-[11px] font-black rounded-full bg-slate-950 text-white disabled:opacity-40 cursor-pointer">Intercambiar</button>
        </div>
      )}
      <p className="text-slate-500">También puedes arrastrar el encabezado de un día sobre otro, o usar el botón ⇄ de dos días, para intercambiar lo que se produce en ellos.</p>
    </div>
  );
}

export function ruleText(r: PlantRule, skuName: (id: string) => string): string {
  if (r.kind === 'NO_TOGETHER') return `${skuName(r.skuA)} y ${skuName(r.skuB)} no pueden ir el mismo día`;
  if (r.kind === 'NO_WEEKDAY') return `${skuName(r.skuId)} no se puede producir el ${WEEKDAYS[r.weekday - 1]}`;
  if (r.kind === 'MIN_DAYS') return `${skuName(r.skuId)} necesita al menos ${r.days} día${r.days === 1 ? '' : 's'} de producción por semana`;
  return `Cambio entre ${skuName(r.skuA)} y ${skuName(r.skuB)}: ${r.hours} h`;
}

type Kind = PlantRuleSpec['kind'];
const KINDS: { id: Kind; label: string }[] = [
  { id: 'NO_TOGETHER', label: 'No pueden ir el mismo día' },
  { id: 'NO_WEEKDAY', label: 'No se puede producir un día' },
  { id: 'MIN_DAYS', label: 'Mínimo de días por semana' },
  { id: 'CHANGEOVER', label: 'Tiempo de cambio entre dos productos' },
];

/** Reglas de planta: lo que el esquema debe respetar. La programación diaria avisa si se violan y las propuestas las respetan. */
export function RulesPanel({
  rules, skus, canEdit, author, skuName, onAdd, onRemove,
}: {
  rules: PlantRule[];
  skus: { id: string; name: string }[];
  canEdit: boolean;
  author: string;
  skuName: (id: string) => string;
  onAdd: (r: PlantRuleSpec & { reason: string; author: string }) => void;
  onRemove: (id: string) => void;
}) {
  const [kind, setKind] = useState<Kind>('NO_TOGETHER');
  const [a, setA] = useState(skus[0]?.id ?? '');
  const [b, setB] = useState(skus[1]?.id ?? skus[0]?.id ?? '');
  const [weekday, setWeekday] = useState(7);
  const [days, setDays] = useState('2');
  const [hrs, setHrs] = useState('2');
  const [reason, setReason] = useState('');

  const pair = kind === 'NO_TOGETHER' || kind === 'CHANGEOVER';
  const valid = reason.trim().length > 0 && a !== '' && (!pair || (b !== '' && a !== b)) && (kind !== 'MIN_DAYS' || (Number(days) >= 1 && Number(days) <= 7)) && (kind !== 'CHANGEOVER' || Number(hrs) >= 0);
  const submit = () => {
    if (!valid) return;
    const base = { reason: reason.trim(), author };
    if (kind === 'NO_TOGETHER') onAdd({ kind, skuA: a, skuB: b, ...base });
    else if (kind === 'NO_WEEKDAY') onAdd({ kind, skuId: a, weekday, ...base });
    else if (kind === 'MIN_DAYS') onAdd({ kind, skuId: a, days: Math.round(Number(days)), ...base });
    else onAdd({ kind, skuA: a, skuB: b, hours: Number(hrs), ...base });
    setReason('');
  };

  return (
    <div className="mt-3 space-y-3">
      {rules.length === 0 && <p className="text-slate-500">Todavía no hay reglas. Agrega las que Producción confirme (sabores que no van juntos, días prohibidos, tiempos de aseo entre sabores).</p>}
      {rules.map((r) => (
        <div key={r.id} className="rounded-xl bg-white/70 px-3 py-2 flex items-start justify-between gap-2">
          <span><b>{ruleText(r, skuName)}</b><br /><span className="text-slate-500">{r.reason} · {r.author}</span></span>
          {canEdit && <button onClick={() => onRemove(r.id)} className="font-bold underline shrink-0 cursor-pointer">Quitar</button>}
        </div>
      ))}
      {canEdit && (
        <div className="rounded-xl bg-white/50 p-3 space-y-2">
          <div className="font-black">Nueva regla</div>
          <select value={kind} onChange={(e) => setKind(e.target.value as Kind)} className={`${field} w-full`} aria-label="Tipo de regla">{KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</select>
          <div className="flex flex-wrap items-center gap-2">
            <select value={a} onChange={(e) => setA(e.target.value)} className={field} aria-label="Producto">{skus.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            {pair && <><span className="font-bold">y</span><select value={b} onChange={(e) => setB(e.target.value)} className={field} aria-label="Segundo producto">{skus.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></>}
            {kind === 'NO_WEEKDAY' && <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))} className={field} aria-label="Día">{WEEKDAYS.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}</select>}
            {kind === 'MIN_DAYS' && <><input type="number" min={1} max={7} value={days} onChange={(e) => setDays(e.target.value)} className={`${field} w-16 font-mono`} aria-label="Días" /><span>días</span></>}
            {kind === 'CHANGEOVER' && <><input type="number" min={0} step={0.5} value={hrs} onChange={(e) => setHrs(e.target.value)} className={`${field} w-16 font-mono`} aria-label="Horas" /><span>h</span></>}
          </div>
          <input value={reason} onChange={(e) => setReason(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} placeholder="Motivo (obligatorio): aseo de alérgenos, equipo compartido…" aria-label="Motivo de la regla" className={`${field} w-full`} />
          <button onClick={submit} disabled={!valid} className="px-3.5 py-1.5 text-[11px] font-black rounded-full bg-slate-950 text-white disabled:opacity-40 cursor-pointer">Agregar regla</button>
        </div>
      )}
    </div>
  );
}
