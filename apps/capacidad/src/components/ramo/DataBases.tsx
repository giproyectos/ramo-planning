import React, { useState } from 'react';
import { BaseName, IngestTexts, summarizeIssues } from '@ramo/ingest';
import { DEFAULT_CUT_AT, useRamoPlan } from '../../ramo/store';
import { Disclosure, ProgressBar } from './ui';
import { SAMPLE_LIMPIO, SAMPLE_SUCIO } from '../../ramo/samples';
import { fmtDec, fmtInt } from '../../ramo/format';

const BASES: { key: keyof IngestTexts; base: BaseName; title: string; hint: string }[] = [
  { key: 'stock', base: 'stock', title: 'Stock al corte', hint: 'Foto del lunes ~8 am' },
  { key: 'movimientos', base: 'movimientos', title: 'Movimientos', hint: 'Último mes, cantidad con signo' },
  { key: 'abastecimiento', base: 'abastecimiento', title: 'Abastecimiento', hint: 'Triangulación zona franca (0004 → 0060)' },
  { key: 'despachos', base: 'despachos', title: 'Trazabilidad de despachos', hint: 'Consulta Z: falta por entregar 8 am–2 pm' },
];
const sev = { error: ['bg-[#FFA27D]', 'Error'], warning: ['bg-[#FFF87C]', 'Aviso'], info: ['bg-[#DDCBF5]', 'Nota'] } as const;
const status = { ok: ['bg-[#7AFFA1]', 'Cargada'], missing: ['bg-slate-200', 'Sin cargar'], failed: ['bg-[#FFA27D]', 'Rechazada'] } as const;

/** Bases de SAP del lunes: se eligen los archivos, se validan y el inventario real reemplaza al de ejemplo en el neto del MPS. */
export function DataBases() {
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

  const loadedCount = Object.values(texts).filter((t) => t !== undefined).length;
  const step = baseline ? 3 : loadedCount > 0 ? 2 : 1;
  const issues = baseline ? summarizeIssues(baseline.issues) : [];
  const errorRows = baseline ? baseline.issues.filter((i) => i.severity === 'error' && i.code !== 'MISSING_BASE').length : 0;
  const skuName = (id: string) => dataset.skus.find((s) => s.id === id)?.name.replace(' (sint.)', '') ?? id;
  const counts = { error: issues.filter((g) => g.severity === 'error').length, warning: issues.filter((g) => g.severity === 'warning').length, info: issues.filter((g) => g.severity === 'info').length };

  return (
    <div className="space-y-4">
      <ol className="flex flex-wrap items-center gap-1.5" aria-label="Pasos para cargar las bases">
        {['Elegir los archivos', 'Validar', 'Revisar el estado base'].map((t, i) => (
          <li key={t} className={`rounded-full px-3 py-1.5 text-[11px] font-bold border ${i + 1 === step ? 'bg-slate-950 text-white border-slate-950' : i + 1 < step ? 'bg-[#7AFFA1]/40 border-[#7AFFA1] text-black' : 'bg-white/60 border-white/80 text-slate-500'}`}>
            {i + 1 < step ? '✓ ' : `${i + 1}. `}{t}
          </li>
        ))}
      </ol>

      {baseline && (
        <div className={`rounded-2xl px-4 py-2.5 text-xs font-bold border ${!baseline.usable ? 'bg-[#FFA27D]/30 border-[#FFA27D]' : errorRows > 0 ? 'bg-[#FFF87C]/50 border-[#FFF87C]' : 'bg-[#7AFFA1]/40 border-[#7AFFA1]'}`}>
          {!baseline.usable
            ? 'Las bases no se pudieron usar (falta el stock o una columna obligatoria). El plan sigue con el inventario de ejemplo.'
            : errorRows > 0
            ? `Línea base aplicada con ${errorRows} problema(s) de nivel error: esas filas se descartaron (corte ${baselineCutAt.replace('T', ' ')}). Corrige los archivos antes de confiar en las cifras.`
            : `Línea base aplicada (corte ${baselineCutAt.replace('T', ' ')}): el inventario del plan viene de SAP.`}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-4 items-start">
        <div className="space-y-4 min-w-0">
          <section className="glass-panel rounded-3xl p-4 sm:p-5 space-y-4">
            <div>
              <h2 className="text-sm font-black">Las 4 bases de SAP del lunes</h2>
              <p className="text-[11px] text-slate-500 mt-0.5 max-w-2xl">Se leen en tu navegador (no se envían a ningún servidor). El inventario disponible (stock + en tránsito − pendiente de despacho) pasa a alimentar el neto del MPS. El formato de las columnas es un supuesto: ver docs/formatos-bases-sap.md.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {BASES.map(({ key, base, title, hint }) => {
                const st = baseline?.status[base] ?? 'missing';
                return (
                  <div key={key} className="rounded-2xl bg-white/60 border border-white p-3.5 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-xs font-black">{title}</div>
                      <span className={`text-[9px] font-black rounded-full px-2 py-0.5 text-black ${status[st][0]}`}>{status[st][1]}</span>
                    </div>
                    <div className="text-[11px] text-slate-500">{hint}</div>
                    <div className="flex items-center gap-2">
                      <label className="px-3 py-1.5 text-[11px] font-black rounded-full bg-white border border-black/10 cursor-pointer hover:bg-white/80">
                        Elegir archivo…
                        <input type="file" accept=".csv,text/csv,.txt" aria-label={`Archivo ${title}`} onChange={(e) => onFile(key, e.target.files?.[0])} className="sr-only" />
                      </label>
                      <span className="text-[10px] font-mono text-slate-600 truncate">{names[key] ?? (texts[key] ? 'cargado' : 'sin archivo')}{baseline && st !== 'missing' ? ` · ${fmtInt(baseline.rowCounts[base])} filas` : ''}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-[11px] font-bold text-slate-600">Corte de las bases
                <input type="datetime-local" value={cutAt} onChange={(e) => setCutAt(e.target.value)} className="block mt-1 rounded-xl border border-black/10 bg-white/80 px-2.5 py-2 text-xs font-mono" />
              </label>
              <button onClick={() => loadBaseline(texts, cutAt)} disabled={loadedCount === 0} className="px-5 py-2.5 text-xs font-black text-white bg-slate-950 rounded-full disabled:opacity-40 cursor-pointer">Validar y usar en el plan</button>
              {baseline && <button onClick={clearBaseline} className="text-[11px] font-bold text-slate-500 hover:text-black underline cursor-pointer">Quitar y volver al inventario de ejemplo</button>}
            </div>
            <details className="text-xs">
              <summary className="cursor-pointer font-bold text-slate-500">Probar con un ejemplo</summary>
              <div className="mt-2 flex flex-wrap gap-2">
                <button onClick={() => useSample(SAMPLE_LIMPIO, 'ejemplo sintético limpio')} className="px-3.5 py-1.5 text-[11px] font-bold rounded-full bg-white border border-black/10 cursor-pointer">Ejemplo limpio</button>
                <button onClick={() => useSample(SAMPLE_SUCIO, 'ejemplo sintético con defectos')} className="px-3.5 py-1.5 text-[11px] font-bold rounded-full bg-white border border-black/10 cursor-pointer">Ejemplo con defectos</button>
              </div>
            </details>
          </section>

          {baseline && (
            <section className="glass-panel rounded-3xl p-4 sm:p-5">
              <h2 className="text-sm font-black">Cobertura por producto</h2>
              <p className="text-[11px] text-slate-500 mb-3">Cuántos días alcanza el inventario al ritmo de despacho del último mes. Menos de 3 días: naranja; menos de 7: amarillo.</p>
              <ul className="space-y-2">
                {baseline.skus.map((s) => {
                  const cd = s.coverageDays;
                  const tone = cd === null ? '#DDCBF5' : cd < 3 ? '#FFA27D' : cd < 7 ? '#FFF87C' : '#7AFFA1';
                  return (
                    <li key={s.skuId} className="grid grid-cols-[minmax(0,180px)_1fr_auto] items-center gap-3 text-xs">
                      <span className="font-bold truncate" title={skuName(s.skuId)}>{skuName(s.skuId)}</span>
                      <ProgressBar value={cd ?? 0} max={14} color={tone} height={8} />
                      <span className="font-mono font-black w-24 text-right">{cd === null ? '—' : `${fmtDec(cd, 1)} días`}</span>
                    </li>
                  );
                })}
              </ul>
              <Disclosure title="Ver todas las cifras (tabla)">
                <table className="w-full text-xs">
                  <thead><tr className="text-[10px] uppercase text-slate-500 text-right"><th className="text-left py-1">Producto</th><th>Stock</th><th>En tránsito</th><th>Pend. despacho</th><th>Disponible</th><th>Salida del mes</th></tr></thead>
                  <tbody>
                    {baseline.skus.map((s) => (
                      <tr key={s.skuId} className="border-t border-black/5 text-right font-mono">
                        <td className="text-left font-sans font-bold py-1.5">{skuName(s.skuId)}</td><td>{fmtInt(s.stockCommercial)}</td><td>{fmtInt(s.inTransitCommercial)}</td><td>{fmtInt(s.pendingDispatchCommercial)}</td><td className="font-extrabold">{fmtInt(s.availableCommercial)}</td><td>{fmtInt(s.outflowCommercial)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Disclosure>
              <p className="text-[10px] text-slate-500 mt-2">Disponible = stock + en tránsito − pendiente de despacho en la ventana (mínimo 0). Fórmula pendiente de confirmar con Producción.</p>
            </section>
          )}
        </div>

        <aside className="space-y-3 xl:sticky xl:top-[88px]">
          <section className="glass-panel rounded-3xl p-4">
            <h2 className="text-[11px] font-black uppercase tracking-wider text-slate-500 mb-2">Problemas encontrados</h2>
            {!baseline ? (
              <p className="text-xs text-slate-600">Cuando valides las bases, aquí aparecen los problemas de cada archivo (columnas que faltan, filas descartadas, cantidades raras) agrupados por tipo.</p>
            ) : issues.length === 0 ? (
              <p className="text-xs font-bold text-emerald-800">Sin problemas.</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-1.5 mb-3 text-[10px] font-black">
                  {counts.error > 0 && <span className="rounded-full px-2.5 py-1 bg-[#FFA27D]">{counts.error} error(es)</span>}
                  {counts.warning > 0 && <span className="rounded-full px-2.5 py-1 bg-[#FFF87C]">{counts.warning} aviso(s)</span>}
                  {counts.info > 0 && <span className="rounded-full px-2.5 py-1 bg-[#DDCBF5]">{counts.info} nota(s)</span>}
                </div>
                <ul className="space-y-2 text-xs">
                  {issues.slice(0, 6).map((g) => (
                    <li key={`${g.severity}${g.base}${g.code}`} className="rounded-xl bg-white/60 px-3 py-2">
                      <div className="flex items-center gap-2"><span className={`text-[9px] font-black rounded-full px-2 py-0.5 text-black ${sev[g.severity][0]}`}>{sev[g.severity][1]}</span><b>{g.base}</b><span className="font-mono text-slate-500">{g.code}</span><span className="ml-auto font-mono font-black">{g.count}</span></div>
                      <div className="text-[11px] text-slate-600 mt-0.5">{g.example}</div>
                    </li>
                  ))}
                </ul>
                {issues.length > 6 && <Disclosure title={`Ver los ${issues.length - 6} restantes`}><ul className="space-y-1.5 text-[11px]">{issues.slice(6).map((g) => <li key={`${g.severity}${g.base}${g.code}`}><b>{g.base}</b> · <span className="font-mono">{g.code}</span> · {g.count} fila(s) — {g.example}</li>)}</ul></Disclosure>}
              </>
            )}
          </section>

          <section className="glass-panel rounded-3xl p-4 text-xs space-y-2">
            <h2 className="text-[11px] font-black uppercase tracking-wider text-slate-500">Qué cambia en el plan</h2>
            <p className={baseline?.usable ? 'font-bold text-emerald-800' : 'text-slate-600'}>{baseline?.usable ? 'El inventario inicial del MPS viene de SAP.' : 'Hoy el MPS parte del inventario de ejemplo.'}</p>
            <ul className="list-disc pl-4 space-y-1 text-slate-600">
              <li>Con las bases cargadas, cambia el neto del MPS (demanda − inventario − órdenes en curso) y con él la capacidad.</li>
              <li>Si una base se rechaza, el plan sigue con el inventario de ejemplo y se avisa arriba.</li>
              <li>Las filas con error se descartan: corrige los archivos antes de confiar en las cifras.</li>
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
