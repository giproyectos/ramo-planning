import React, { useState } from 'react';
import { useRamoPlan } from '../../ramo/store';
import { DataBases } from './DataBases';
import { SchemeIO } from './SchemeIO';

/** Datos y esquemas: las bases de SAP del lunes (inventario real) y los esquemas y turnos en Excel. */
export function DataScreen() {
  const { baseline, templateOverrides } = useRamoPlan();
  const [tab, setTab] = useState<'bases' | 'esquemas'>('bases');
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight">Datos y esquemas</h1>
          <p className="text-sm text-slate-600 max-w-3xl">De dónde sale la información del plan: el inventario real de SAP y los esquemas de producción que Producción mantiene en Excel.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-black">
          <span className={`rounded-full px-3 py-1.5 ${baseline?.usable ? 'bg-[#7AFFA1]' : 'bg-[#FFF87C]'}`}>Inventario: {baseline?.usable ? 'bases de SAP' : 'ejemplo'}</span>
          <span className="rounded-full px-3 py-1.5 bg-[#DDCBF5]">{templateOverrides.length} cambio(s) de esquema vigentes</span>
        </div>
      </div>
      <div className="inline-flex rounded-full bg-white/70 border border-white/80 p-0.5 text-[11px] font-bold" role="tablist" aria-label="Qué cargar">
        {([['bases', 'Bases de SAP'], ['esquemas', 'Esquemas y turnos en Excel']] as const).map(([t, label]) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`px-4 py-1.5 rounded-full cursor-pointer ${tab === t ? 'bg-slate-950 text-white' : 'text-slate-600'}`}>{label}</button>
        ))}
      </div>
      {tab === 'bases' ? <DataBases /> : <SchemeIO />}
    </div>
  );
}
