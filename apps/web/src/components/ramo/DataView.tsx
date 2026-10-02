import React, { useState } from 'react';
import { BaseName, IngestTexts, summarizeIssues } from '@ramo/ingest';
import { DEFAULT_CUT_AT, useRamoPlan } from '../../ramo/store';
import { Disclosure, ProgressBar } from './ui';
import { SAMPLE_LIMPIO, SAMPLE_SUCIO } from '../../ramo/samples';
import { fmtDec, fmtInt } from '../../ramo/format';

const BASES: { key: keyof IngestTexts; base: BaseName; title: string; hint: string }[] = [
  { key: 'stock', base: 'stock', title: 'Inventarios · stock al corte', hint: 'Foto de stock del lunes ~8 am' },
  { key: 'movimientos', base: 'movimientos', title: 'Inventarios · movimientos', hint: 'Último mes, cantidad con signo' },
  { key: 'abastecimiento', base: 'abastecimiento', title: 'Abastecimiento', hint: 'Triangulación zona franca (0004 → 0060)' },
  { key: 'despachos', base: 'despachos', title: 'Trazabilidad de despachos', hint: 'Consulta Z: falta por entregar 8 am–2 pm' },
];

const sevStyle = {
  error: 'bg-[#FFA27D] text-black',
  warning: 'bg-[#FFF87C] text-black',
  info: 'bg-[#DDCBF5] text-black',
} as const;
const sevLabel = { error: 'Error', warning: 'Aviso', info: 'Nota' } as const;
const statusStyle = { ok: 'bg-[#7AFFA1] text-black', missing: 'bg-white/70 text-slate-500', failed: 'bg-[#FFA27D] text-black' } as const;
const statusLabel = { ok: 'Cargada', missing: 'Sin cargar', failed: 'Rechazada' } as const;

/** Paso "Datos SAP": carga las 4 bases del lunes, las valida y muestra el estado base por SKU. */
export function DataView() {
  const { dataset, baseline, baselineCutAt, loadBaseline, clearBaseline } = useRamoPlan();
  const [texts, setTexts] = useState<IngestTexts>({});
  const [names, setNames] = useState<Partial<Record<keyof IngestTexts, string>>>({});
  const [cutAt, setCutAt] = useState(baselineCutAt || DEFAULT_CUT_AT);

  const onFile = async (key: keyof IngestTexts, file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    setTexts((t) => ({ ...t, [key]: text }));
    setNames((n) => ({ ...n, [key]: file.name }));
  };

  const useSample = (sample: IngestTexts, label: string) => {
    setTexts(sample);
    setNames({ stock: label, movimientos: label, abastecimiento: label, despachos: label });
    loadBaseline(sample, cutAt);
  };

  const issues = baseline ? summarizeIssues(baseline.issues) : [];
  const skuName = (id: string) => dataset.skus.find((s) => s.id === id)?.name ?? id;
  const errorRows = baseline ? baseline.issues.filter((i) => i.severity === 'error' && i.code !== 'MISSING_BASE').length : 0;
  const loadedCount = Object.values(texts).filter((t) => t !== undefined).length;

  return (
    <div className="space-y-5">
      <div className="glass-panel rounded-3xl p-5">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
          <span className="w-2 h-2 rounded-full bg-[#7AFFA1]"></span>
          <span className="text-black font-extrabold">Datos SAP · Bases del lunes</span>
        </div>
        <h1 className="text-xl sm:text-2xl font-black tracking-tight text-slate-950">Estado base desde las 3 bases de SAP</h1>
        <p className="text-xs text-slate-500 mt-0.5 font-medium max-w-3xl">
          Carga los archivos CSV que Miguel descarga cada lunes. Se leen en tu navegador (no se envían a ningún servidor), se validan y el inventario disponible
          (stock + en tránsito − pendiente de despacho) pasa a alimentar el neto del MPS. El formato de las columnas es un supuesto: ver docs/formatos-bases-sap.md.
        </p>
      </div>

      <div className="glass-panel rounded-3xl p-5 space-y-4">
        <div className="flex flex-wrap items-end gap-4">
          <label className="text-[11px] font-bold text-slate-600">
            Corte de las bases
            <input type="datetime-local" value={cutAt} onChange={(e) => setCutAt(e.target.value)} className="block mt-1 rounded-xl border border-black/10 bg-white/80 px-2.5 py-2 text-xs font-mono" />
          </label>
          <button onClick={() => useSample(SAMPLE_LIMPIO, 'ejemplo sintético limpio')} className="px-4 py-2 text-xs font-bold text-white bg-slate-950 rounded-full cursor-pointer">
            Cargar ejemplo sintético
          </button>
          <button onClick={() => useSample(SAMPLE_SUCIO, 'ejemplo sintético con defectos')} className="px-4 py-2 text-xs font-bold bg-white/80 border border-black/10 rounded-full cursor-pointer">
            Cargar ejemplo con defectos
          </button>
          {baseline && (
            <button onClick={clearBaseline} className="text-[11px] font-bold text-slate-500 hover:text-black underline cursor-pointer">
              Quitar bases y volver al inventario sintético
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {BASES.map(({ key, base, title, hint }) => {
            const st = baseline?.status[base] ?? 'missing';
            return (
              <div key={key} className="rounded-2xl bg-white/60 border border-white/80 p-3.5 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-xs font-black text-slate-900">{title}</div>
                  <span className={`text-[9px] font-black rounded-full px-2 py-0.5 ${statusStyle[st]}`}>{statusLabel[st]}</span>
                </div>
                <div className="text-[11px] text-slate-500">{hint}</div>
                <input type="file" accept=".csv,text/csv,.txt" aria-label={`Archivo ${title}`} onChange={(e) => onFile(key, e.target.files?.[0])} className="block w-full text-[11px]" />
                <div className="text-[11px] text-slate-600 font-mono">
                  {names[key] ? `${names[key]}` : 'sin archivo'}
                  {baseline && st !== 'missing' ? ` · ${fmtInt(baseline.rowCounts[base])} filas válidas` : ''}
                </div>
              </div>
            );
          })}
        </div>

        <button
          onClick={() => loadBaseline(texts, cutAt)}
          disabled={loadedCount === 0}
          className="px-5 py-2.5 text-xs font-bold text-white bg-slate-950 rounded-full disabled:opacity-40 cursor-pointer"
        >
          Validar y usar en el plan
        </button>
      </div>

      {baseline && (
        <>
          <div className={`rounded-3xl px-5 py-3 text-xs font-bold border ${!baseline.usable ? 'bg-[#FFA27D]/30 border-[#FFA27D]' : errorRows > 0 ? 'bg-[#FFF87C]/50 border-[#FFF87C]' : 'bg-[#7AFFA1]/40 border-[#7AFFA1]'}`}>
            {!baseline.usable
              ? 'Las bases no se pudieron usar (falta el stock o una columna obligatoria). El plan sigue con el inventario sintético.'
              : errorRows > 0
              ? `Línea base aplicada con ${errorRows} problema(s) de nivel error: esas filas se descartaron (corte ${baselineCutAt.replace('T', ' ')}). Corrige los archivos antes de confiar en las cifras.`
              : `Línea base aplicada (corte ${baselineCutAt.replace('T', ' ')}): el inventario del plan viene de SAP.`}
          </div>

          <div className="glass-panel rounded-3xl p-5 overflow-x-auto">
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">Problemas encontrados ({baseline.issues.length})</div>
            {issues.length === 0 ? (
              <p className="text-xs text-emerald-800 font-bold">Sin problemas.</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] uppercase text-slate-500 text-left">
                    <th className="py-1">Nivel</th><th>Base</th><th>Código</th><th className="text-right pr-3">Filas</th><th>Ejemplo</th>
                  </tr>
                </thead>
                <tbody>
                  {issues.map((g) => (
                    <tr key={`${g.severity}${g.base}${g.code}`} className="border-t border-black/5 align-top">
                      <td className="py-1.5"><span className={`text-[9px] font-black rounded-full px-2 py-0.5 ${sevStyle[g.severity]}`}>{sevLabel[g.severity]}</span></td>
                      <td>{g.base}</td>
                      <td className="font-mono">{g.code}</td>
                      <td className="text-right font-mono pr-3">{g.count}</td>
                      <td className="text-slate-600">{g.example}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="glass-panel rounded-3xl p-5 overflow-x-auto">
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">Estado base por SKU (cajas)</div>
            <p className="text-[11px] text-slate-500 mb-3">Cuántos días alcanza el inventario de cada producto al ritmo de despacho del último mes. Menos de 3 días = naranja, menos de 7 = amarillo.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 mb-3">
              {baseline.skus.map((s) => {
                const cd = s.coverageDays;
                const tone = cd === null ? '#DDCBF5' : cd < 3 ? '#FFA27D' : cd < 7 ? '#FFF87C' : '#7AFFA1';
                return (
                  <div key={s.skuId} className="rounded-2xl bg-white/60 border border-white/80 p-3">
                    <div className="text-xs font-black leading-tight truncate">{skuName(s.skuId).replace(' (sint.)', '')}</div>
                    <div className="mt-1 flex items-baseline gap-1">
                      <span className="text-2xl font-black font-mono">{cd === null ? '—' : fmtDec(cd, 1)}</span>
                      <span className="text-[11px] text-slate-500">días de cobertura</span>
                    </div>
                    <div className="mt-1.5"><ProgressBar value={cd ?? 0} max={14} color={tone} height={7} /></div>
                    <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] text-slate-600">
                      <dt>Stock</dt><dd className="text-right font-mono">{fmtInt(s.stockCommercial)}</dd>
                      <dt>En tránsito</dt><dd className="text-right font-mono">{fmtInt(s.inTransitCommercial)}</dd>
                      <dt>Por despachar</dt><dd className="text-right font-mono">{fmtInt(s.pendingDispatchCommercial)}</dd>
                      <dt className="font-bold">Disponible</dt><dd className="text-right font-mono font-extrabold">{fmtInt(s.availableCommercial)}</dd>
                    </dl>
                  </div>
                );
              })}
            </div>
            <Disclosure title="Ver todas las cifras (tabla)">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] uppercase text-slate-500 text-right">
                  <th className="text-left py-1">SKU</th><th>Stock</th><th>En tránsito</th><th>Pend. despacho 8–14 h</th><th>Pend. fuera de ventana</th><th>Disponible</th><th>Salida del mes</th><th>Cobertura (días)</th>
                </tr>
              </thead>
              <tbody>
                {baseline.skus.map((s) => (
                  <tr key={s.skuId} className="border-t border-black/5 text-right font-mono">
                    <td className="text-left font-sans font-bold py-1.5">{skuName(s.skuId)}</td>
                    <td>{fmtInt(s.stockCommercial)}</td>
                    <td>{fmtInt(s.inTransitCommercial)}</td>
                    <td>{fmtInt(s.pendingDispatchCommercial)}</td>
                    <td className="text-slate-400">{fmtInt(s.pendingOutsideWindowCommercial)}</td>
                    <td className="font-extrabold">{fmtInt(s.availableCommercial)}</td>
                    <td>{fmtInt(s.outflowCommercial)}</td>
                    <td>{s.coverageDays === null ? '—' : fmtDec(s.coverageDays)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </Disclosure>
            <p className="text-[10px] text-slate-500 mt-2">
              Disponible = stock + en tránsito − pendiente de despacho en la ventana (mínimo 0). Esta fórmula es un supuesto pendiente de confirmar con Miguel.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
