import React from 'react';
import { useRamoPlan } from '../ramo/store';
import { weekLabel } from '../ramo/format';
import { ProcessStep, STEP_TITLES } from '../ramo/steps';

/** Encabezado: dónde estás y con qué datos se calculó el plan que ves. */
export const Header: React.FC<{ currentStep: ProcessStep }> = ({ currentStep }) => {
  const { baseline, weeks, serverMode, sync, forecast, danielView } = useRamoPlan();
  const overloads = danielView.alerts.length;
  const syncText = { local: '', loading: 'cargando…', saving: 'guardando…', saved: 'guardado', conflict: 'conflicto: recarga la página', denied: 'cambio no permitido', offline: 'sin conexión' }[sync.state];

  return (
    <header className="px-5 lg:px-6 py-3.5 flex items-center justify-between gap-3 border-b border-white/70 glass-panel sticky top-0 z-20">
      <div className="flex items-center glass-pill rounded-full px-3.5 py-1.5 gap-2 min-w-0">
        <span className="text-xs font-black text-slate-900 tracking-tight truncate">{STEP_TITLES[currentStep]}</span>
      </div>

      <div className="flex items-center gap-2 shrink-0 text-[11px] font-bold text-slate-700">
        {weeks[0] && (
          <span className="hidden md:inline glass-pill rounded-full px-3 py-1.5">Plan desde el {weekLabel(weeks[0])} · {weeks.length} sem.</span>
        )}
        <span className="hidden sm:inline glass-pill rounded-full px-3 py-1.5" title="Origen del inventario con el que se calcula el plan">
          Inventario: {baseline?.usable ? 'bases SAP' : 'ejemplo'}
        </span>
        <span className="hidden lg:inline glass-pill rounded-full px-3 py-1.5" title="Demanda que alimenta el plan">
          Demanda: {forecast ? 'pronóstico' : 'fija'}
        </span>
        <span className={`rounded-full px-3 py-1.5 text-black ${overloads > 0 ? 'bg-[#FFA27D]' : 'bg-[#7AFFA1]/70'}`} title="Tripulaciones con horas faltantes en el plan actual">
          {overloads > 0 ? `${overloads} alerta(s) de capacidad` : 'Capacidad factible'}
        </span>
        {serverMode && syncText && <span className="glass-pill rounded-full px-3 py-1.5">{syncText}</span>}
      </div>
    </header>
  );
};
