import React from 'react';
import { Alternative, RebalancePlan } from '@ramo/engine';
import { fmtDec } from '../../ramo/format';

/** Lista de alternativas para resolver la sobrecarga: se elige una, y al pasar el cursor el mapa muestra cómo quedaría. */
export function AltPicker({
  alts, chosenId, onPick, onHover, children,
}: {
  alts: Alternative<RebalancePlan>[];
  chosenId: string | undefined;
  onPick: (id: string) => void;
  onHover: (id: string | null) => void;
  children?: React.ReactNode;
}) {
  const chosen = alts.find((a) => a.id === chosenId);
  return (
    <section className="glass-panel rounded-3xl p-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-[11px] font-black uppercase tracking-wider text-slate-500">Cómo resolver la sobrecarga</h2>
        <span className="text-[10px] font-black rounded-full px-2 py-0.5 bg-[#DDCBF5]" title="Optimización con restricciones; no usa un modelo de lenguaje. Sugiere: una persona decide.">✦ Asistente</span>
      </div>
      {alts.length === 0 || alts[0].plan.overloaded === 0 ? (
        <p className="text-xs font-bold text-emerald-800">No hay semanas sobre capacidad: no hay nada que resolver.</p>
      ) : (
        <div className="space-y-2">
          <p className="text-[11px] text-slate-600">{alts[0].plan.overloaded} tripulación-semana(s), {fmtDec(alts[0].plan.excessBefore, 1)} h por cubrir. Coloca el cursor para verlo en el mapa.</p>
          {alts.map((a) => {
            const on = chosen?.id === a.id;
            return (
              <div key={a.id} onMouseEnter={() => onHover(a.id)} onMouseLeave={() => onHover(null)} onFocus={() => onHover(a.id)} onBlur={() => onHover(null)}>
                <button onClick={() => onPick(a.id)} aria-pressed={on} className={`w-full text-left rounded-2xl p-3 border cursor-pointer transition-all ${on ? 'bg-slate-950 text-white border-slate-950' : 'bg-white/70 border-white hover:bg-white'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-black">{a.label}</span>
                    {a.recommended && <span className="text-[9px] font-black rounded-full px-2 py-0.5 bg-[#7AFFA1] text-black shrink-0">Recomendada</span>}
                  </div>
                  <div className={`mt-1 text-[11px] ${on ? 'text-slate-300' : 'text-slate-600'}`}>
                    Adelanta {fmtDec(a.metrics.movedHours, 1)} h · {a.metrics.unmetHours > 0 ? `${fmtDec(a.metrics.unmetHours, 1)} h sin cubrir` : `${fmtDec(a.metrics.extraHours, 1)} h extra`}
                  </div>
                </button>
              </div>
            );
          })}
          {chosen && <div className="rounded-2xl bg-white/60 border border-white p-3 text-xs space-y-2"><p className="text-slate-600">{chosen.description}</p>{children}</div>}
        </div>
      )}
    </section>
  );
}
