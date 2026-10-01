import React from 'react';
import { CYCLE_ORDER, CycleStage } from '@ramo/engine';
import { useRamoPlan } from '../../ramo/store';

const STEPS: Record<CycleStage, { title: string; owner: string }> = {
  DRAFT: { title: 'Capacidad en borrador', owner: 'Miguel' },
  SENT_TO_MPS: { title: 'Enviado al MPS', owner: 'Daniel' },
  MPS_FINAL: { title: 'MPS final cerrado', owner: 'Daniel' },
  FINAL_ALERTS: { title: 'Alertas finales', owner: 'Miguel' },
};

/** Cinta con las 4 etapas del ciclo semanal y el registro de quién hizo qué y por qué. */
export function CycleStepper({ showLog = true }: { showLog?: boolean }) {
  const { stage, log, reset } = useRamoPlan();
  const current = CYCLE_ORDER.indexOf(stage);

  return (
    <div className="glass-panel rounded-3xl p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">
          Ciclo semanal · mié comparte · jue decide · vie sale el plan oficial
        </div>
        <button onClick={reset} className="text-[11px] font-bold text-slate-500 hover:text-black underline cursor-pointer">
          Reiniciar ciclo
        </button>
      </div>

      <ol className="grid grid-cols-1 sm:grid-cols-4 gap-2">
        {CYCLE_ORDER.map((s, i) => (
          <li
            key={s}
            className={`rounded-2xl px-3 py-2.5 border text-xs ${
              i === current ? 'bg-slate-950 text-white border-slate-950' : i < current ? 'bg-[#7AFFA1]/40 border-[#7AFFA1] text-black' : 'bg-white/60 border-white/80 text-slate-500'
            }`}
          >
            <div className="font-mono text-[10px] opacity-70">Paso {i + 1} · {STEPS[s].owner}</div>
            <div className="font-black">{STEPS[s].title}</div>
          </li>
        ))}
      </ol>

      {showLog && (
        <div>
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Registro (quién · qué · por qué)</div>
          {log.length === 0 ? (
            <p className="text-xs text-slate-400">Aún no hay movimientos en este ciclo.</p>
          ) : (
            <ul className="space-y-1 max-h-40 overflow-auto pr-1">
              {log.map((e, i) => (
                <li key={i} className="text-xs text-slate-700">
                  <span className="font-mono text-[10px] text-slate-400 mr-2">{e.at.slice(11, 19)}</span>
                  <span className="font-extrabold">{e.actor}</span> — {e.text}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
