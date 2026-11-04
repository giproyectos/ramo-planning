import React from 'react';
import { CYCLE_ORDER, CycleStage } from '@ramo/engine';
import { useRamoPlan } from '../../ramo/store';

const STEPS: Record<CycleStage, { title: string; owner: string }> = {
  DRAFT: { title: 'Capacidad en borrador', owner: 'Producción' },
  SENT_TO_MPS: { title: 'Enviado al MPS', owner: 'Distribución' },
  MPS_FINAL: { title: 'MPS final cerrado', owner: 'Distribución' },
  FINAL_ALERTS: { title: 'Alertas finales', owner: 'Producción' },
};

export interface CycleCta {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  hint?: string;
}

/** Franja del ciclo semanal: en qué paso estás, quién lo tiene y el botón que lo hace avanzar; el registro queda plegado. */
export function CycleBar({ cta, note, banner }: { cta?: CycleCta | null; note?: string; banner?: React.ReactNode }) {
  const { stage, log, reset } = useRamoPlan();
  const stageIdx = CYCLE_ORDER.indexOf(stage);
  return (
    <section className="glass-panel rounded-3xl px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <ol className="flex flex-wrap items-center gap-1.5" aria-label="Pasos del ciclo semanal">
          {CYCLE_ORDER.map((s, i) => (
            <li
              key={s}
              className={`rounded-full px-3 py-1.5 text-[11px] font-bold border ${i === stageIdx ? 'bg-slate-950 text-white border-slate-950' : i < stageIdx ? 'bg-[#7AFFA1]/40 border-[#7AFFA1] text-black' : 'bg-white/60 border-white/80 text-slate-500'}`}
              title={`Paso ${i + 1} · ${STEPS[s].owner}`}
            >
              {i < stageIdx ? '✓ ' : `${i + 1}. `}
              {STEPS[s].title}
            </li>
          ))}
        </ol>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {note && <span className="text-xs text-slate-500">{note}</span>}
          {cta && (
            <>
              {cta.hint && <span className="text-[11px] text-slate-500 hidden lg:inline">{cta.hint}</span>}
              <button disabled={cta.disabled} title={cta.title} onClick={cta.onClick} className="px-5 py-2 text-xs font-black text-black bg-[#7AFFA1] rounded-full cursor-pointer disabled:opacity-40">
                {cta.label}
              </button>
            </>
          )}
        </div>
      </div>
      {banner}
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer font-bold text-slate-500">Registro del ciclo ({log.length})</summary>
        <div className="mt-2">
          {log.length === 0 ? (
            <p className="text-slate-400">Aún no hay movimientos en este ciclo.</p>
          ) : (
            <ul className="space-y-1 max-h-40 overflow-auto pr-1">
              {log.map((e, i) => (
                <li key={i}>
                  <span className="font-mono text-[10px] text-slate-400 mr-2">{e.at.slice(11, 19)}</span>
                  <span className="font-extrabold">{e.actor}</span> — {e.text}
                </li>
              ))}
            </ul>
          )}
          <button onClick={reset} className="mt-2 text-[11px] font-bold text-slate-500 hover:text-black underline cursor-pointer">Reiniciar ciclo</button>
        </div>
      </details>
    </section>
  );
}
