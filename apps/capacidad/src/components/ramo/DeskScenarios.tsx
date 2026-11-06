import React, { useState } from 'react';
import { ScenarioRecord } from '@ramo/domain';
import { ScheduleMetrics } from '@ramo/engine';
import { fmtDec } from '../../ramo/format';

export interface ScenarioColumn {
  key: string;
  title: string;
  subtitle?: string;
  metrics: ScheduleMetrics;
  changes: number;
  highlight?: boolean;
}

const ROWS: { key: keyof ScheduleMetrics | 'changes'; label: string; unit: string; hint: string }[] = [
  { key: 'excessHours', label: 'Déficit de horas en el horizonte', unit: 'h', hint: 'Suma de los días sobre su capacidad: las horas extra que habría que pedir.' },
  { key: 'overDays', label: 'Días con sobrecarga', unit: '', hint: 'Días-línea sobre el 100 % de su capacidad.' },
  { key: 'unscheduledHours', label: 'Horas sin día de producción', unit: 'h', hint: 'Producción que no tiene en qué día hacerse (producto fuera del esquema o con todos sus días cerrados).' },
  { key: 'changeoverHours', label: 'Horas de cambio de producto', unit: 'h', hint: 'Tiempo perdido en aseos y cambios de sabor.' },
  { key: 'crewConflicts', label: 'Choques de tripulación', unit: '', hint: 'Días en que la misma tripulación queda en dos líneas.' },
  { key: 'ruleViolations', label: 'Reglas de planta violadas', unit: '', hint: 'Productos que no pueden ir juntos, días prohibidos o mínimos de días que el escenario no respeta.' },
  { key: 'changes', label: 'Cambios frente al plan vigente', unit: '', hint: 'Cuántos movimientos, cambios de esquema y paradas incluye.' },
];

/** Tabla para comparar el plan vigente, el borrador y los escenarios guardados: lo mejor de cada fila va en verde. */
export function ScenarioCompare({ columns, onClose }: { columns: ScenarioColumn[]; onClose: () => void }) {
  const base = columns[0];
  const value = (c: ScenarioColumn, k: (typeof ROWS)[number]['key']) => (k === 'changes' ? c.changes : c.metrics[k]);
  return (
    <section className="glass-panel rounded-3xl p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h2 className="text-sm font-black">Comparar escenarios</h2>
          <p className="text-[11px] text-slate-500">Cada columna es el plan completo de las 13 semanas con esos cambios. En verde, lo mejor de cada fila; entre paréntesis, la diferencia frente al plan vigente.</p>
        </div>
        <button onClick={onClose} aria-label="Cerrar la comparación" className="text-slate-500 hover:text-black font-black cursor-pointer">✕</button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs min-w-[520px]">
          <thead>
            <tr className="text-left align-bottom">
              <th className="pb-2 pr-3 w-56" />
              {columns.map((c) => (
                <th key={c.key} className={`pb-2 px-2 ${c.highlight ? 'text-[#7c4dbd]' : ''}`}>
                  <div className="font-black">{c.title}</div>
                  {c.subtitle && <div className="text-[10px] font-normal text-slate-500">{c.subtitle}</div>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => {
              const vals = columns.map((c) => value(c, r.key));
              const compareBest = r.key !== 'changes';
              const best = Math.min(...vals);
              return (
                <tr key={r.key} className="border-t border-black/5">
                  <td className="py-2 pr-3 font-bold" title={r.hint}>{r.label}</td>
                  {columns.map((c, i) => {
                    const v = vals[i];
                    const diff = i === 0 ? null : Math.round((v - vals[0]) * 10) / 10;
                    const isBest = compareBest && columns.length > 1 && v === best && vals.some((x) => x !== v);
                    return (
                      <td key={c.key} className="py-2 px-2">
                        <span className={`inline-flex items-baseline gap-1.5 rounded-lg px-2 py-1 font-mono font-black ${isBest ? 'bg-[#7AFFA1]/60' : ''}`}>
                          {fmtDec(v, Number.isInteger(v) ? 0 : 1)}{r.unit ? ` ${r.unit}` : ''}
                          {diff !== null && diff !== 0 && r.key !== 'changes' && <span className={`text-[10px] font-bold ${diff < 0 ? 'text-emerald-800' : 'text-[#c2410c]'}`}>({diff > 0 ? '+' : ''}{fmtDec(diff, Number.isInteger(diff) ? 0 : 1)})</span>}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {base && <p className="text-[10px] text-slate-500 mt-3">«{base.title}» es lo que rige hoy. Un escenario se puede cargar al borrador para revisarlo en la programación diaria y aplicarlo al plan.</p>}
    </section>
  );
}

/** Lista de escenarios guardados: cargar al borrador, quitar y elegir cuáles comparar. */
export function ScenarioList({
  scenarios, metricsOf, picked, onPick, onLoad, onRemove, onCompare, canEdit, hasDraft,
}: {
  scenarios: ScenarioRecord[];
  metricsOf: (s: ScenarioRecord) => ScheduleMetrics;
  picked: string[];
  onPick: (id: string, on: boolean) => void;
  onLoad: (s: ScenarioRecord) => void;
  onRemove: (id: string) => void;
  onCompare: () => void;
  canEdit: boolean;
  hasDraft: boolean;
}) {
  const [confirm, setConfirm] = useState<string | null>(null);
  return (
    <div className="mt-3 space-y-2">
      {scenarios.length === 0 && <p className="text-slate-500">Todavía no hay escenarios. Haz cambios en el borrador y usa «Guardar escenario» para compararlos con el plan vigente y entre sí.</p>}
      {scenarios.map((s) => {
        const m = metricsOf(s);
        const n = s.moves.length + s.schemes.length + s.calendar.length;
        return (
          <div key={s.id} className="rounded-xl bg-white/70 px-3 py-2 space-y-1.5">
            <div className="flex items-start justify-between gap-2">
              <label className="flex items-start gap-2 cursor-pointer min-w-0">
                <input type="checkbox" checked={picked.includes(s.id)} onChange={(e) => onPick(s.id, e.target.checked)} className="mt-0.5" aria-label={`Comparar ${s.name}`} />
                <span className="min-w-0"><b className="block truncate">{s.name}</b><span className="text-slate-500">{n} cambio{n === 1 ? '' : 's'} · {s.author} · {s.createdAt.slice(0, 10)}</span></span>
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={`text-[10px] font-black rounded-full px-2 py-0.5 ${m.excessHours > 0.05 ? 'bg-[#FFA27D]' : 'bg-[#7AFFA1]'}`}>déficit de {fmtDec(m.excessHours, 1)} h</span>
              {m.ruleViolations > 0 && <span className="text-[10px] font-black rounded-full px-2 py-0.5 bg-[#FFF87C]">{m.ruleViolations} regla(s)</span>}
              <span className="ml-auto flex items-center gap-2">
                <button onClick={() => (hasDraft && confirm !== s.id ? setConfirm(s.id) : (onLoad(s), setConfirm(null)))} className="font-bold underline cursor-pointer">{confirm === s.id ? 'Reemplazar el borrador' : 'Cargar al borrador'}</button>
                {canEdit && <button onClick={() => onRemove(s.id)} className="font-bold underline cursor-pointer text-slate-500">Quitar</button>}
              </span>
            </div>
            {confirm === s.id && <p className="text-[10px] text-slate-500">Hay un borrador en curso: al cargar este escenario se reemplaza (se puede deshacer).</p>}
          </div>
        );
      })}
      {scenarios.length > 0 && (
        <button onClick={onCompare} disabled={picked.length === 0} className="px-3.5 py-1.5 text-[11px] font-black rounded-full bg-slate-950 text-white disabled:opacity-40 cursor-pointer">
          Comparar{picked.length ? ` (${picked.length}) con el plan vigente` : ' (elige al menos uno)'}
        </button>
      )}
    </div>
  );
}
