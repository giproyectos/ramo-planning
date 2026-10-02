import React, { useMemo, useState } from 'react';
import { MeasureView, Role, convertCommercialQty } from '@ramo/domain';
import { FC_N1_ID, FC_PBO_ID, MODEL_LABELS, filterSkus, weeklyTotals } from '@ramo/engine';
import { summarizeIssues } from '@ramo/ingest';
import { buildMd61 } from '@ramo/sap-out';
import { useRamoPlan } from '../../ramo/store';
import { useAuth } from '../../ramo/auth';
import { SAMPLE_HISTORY_LIMPIO, SAMPLE_HISTORY_SUCIO } from '../../ramo/samples';
import { MEASURE_LABELS, fmtDec, fmtInt, weekLabel } from '../../ramo/format';
import { DemandChart } from './DemandChart';
import { Disclosure, ProgressBar } from './ui';
import { SERIES_COLORS } from './charts';

const pct = (n: number, d = 1) => `${fmtDec(n * 100, d)}%`;
const signed = (n: number, d = 1) => `${n > 0 ? '+' : ''}${fmtDec(n * 100, d)}%`;
const sevStyle = { error: 'bg-[#FFA27D]', warning: 'bg-[#FFF87C]', info: 'bg-[#DDCBF5]' } as const;
const ROLES: { id: Role; label: string }[] = [
  { id: 'demand', label: 'Demanda' },
  { id: 'distribution', label: 'Distribución' },
  { id: 'production', label: 'Producción' },
];
type ScopeKind = 'sku' | 'family' | 'businessUnit' | 'all';

/** Paso Demanda: línea base estadística, PBO vs N+1, building blocks trazables y archivo de salida para SAP. */
export function DemandView() {
  const {
    dataset, history, historyLabel, loadHistory, forecast, forecastDs, consensus, targetStart,
    useForecast, setUseForecast, userBlocks, addBlock, removeBlock,
    can,
  } = useRamoPlan();

  const [bu, setBu] = useState('');
  const [brand, setBrand] = useState('');
  const [family, setFamily] = useState('');
  const [skuId, setSkuId] = useState('');
  const [measure, setMeasure] = useState<MeasureView>('commercial_units');

  const [scopeKind, setScopeKind] = useState<ScopeKind>('sku');
  const [scopeValue, setScopeValue] = useState(dataset.skus[0].id);
  const [blockWeek, setBlockWeek] = useState('');
  const [delta, setDelta] = useState('3000');
  const [reason, setReason] = useState('');
  const { user: authUser } = useAuth();
  const [author, setAuthor] = useState(authUser?.name ?? 'Planeador Demanda');
  const [role, setRole] = useState<Role>('demand');
  const [downloaded, setDownloaded] = useState(false);

  const uniq = (f: (s: (typeof dataset.skus)[number]) => string) => [...new Set(dataset.skus.map(f))].sort();
  const selected = useMemo(() => filterSkus(dataset.skus, { businessUnit: bu, brand, family, skuId }), [dataset.skus, bu, brand, family, skuId]);
  const ids = useMemo(() => new Set(selected.map((s) => s.id)), [selected]);
  const unitLabel = MEASURE_LABELS[measure];
  const fmt = (n: number) => (measure === 'tons' ? fmtDec(n, 1) : fmtInt(n));
  const conv = (skuIdArg: string, q: number) => convertCommercialQty(dataset.skus.find((s) => s.id === skuIdArg)!, q, measure);

  const horizon = useMemo(() => forecast?.n1.skus[0]?.weeks ?? [], [forecast]);
  const histWeeks = useMemo(() => [...new Set(history.rows.filter((r) => r.flow === 'CEDI').map((r) => r.weekStart))].sort().slice(-52), [history.rows]);

  const series = useMemo(() => {
    if (!forecast) return null;
    const sumBySku = (get: (skuId: string, i: number) => number) => horizon.map((_, i) => selected.reduce((a, s) => a + conv(s.id, get(s.id, i)), 0));
    // PBO y N+1 se leen de las versiones generadas (cantidades ya redondeadas, las mismas que van a SAP) para que las diferencias sean exactas.
    const recordsOf = (versionId: string) => (forecastDs?.demand ?? []).filter((d) => d.versionId === versionId);
    const pboRecords = recordsOf(FC_PBO_ID);
    const n1Records = recordsOf(FC_N1_ID);
    const n1 = (id: string, i: number) => weeklyTotals(n1Records, new Set([id]), [horizon[i]])[0];
    const pbo = (id: string, i: number) => weeklyTotals(pboRecords, new Set([id]), [horizon[i]])[0];
    const cons = (id: string, i: number) => weeklyTotals(consensus, new Set([id]), [horizon[i]])[0];
    const one = selected.length === 1 ? forecast.n1.skus.find((s) => s.skuId === selected[0].id) : undefined;
    return {
      pbo: sumBySku(pbo),
      n1: sumBySku(n1),
      cons: sumBySku(cons),
      low: one ? one.lower.map((v) => conv(one.skuId, v)) : undefined,
      high: one ? one.upper.map((v) => conv(one.skuId, v)) : undefined,
      hist: histWeeks.map((w) => history.rows.filter((r) => r.flow === 'CEDI' && r.weekStart === w && ids.has(r.skuId)).reduce((a, r) => a + conv(r.skuId, r.commercialQty), 0)),
    };
  }, [forecast, forecastDs, consensus, selected, measure, horizon, histWeeks, history.rows, ids, dataset.skus]);

  const md61 = useMemo(() => (forecastDs ? buildMd61(dataset, consensus) : null), [forecastDs, dataset, consensus]);
  const issueGroups = summarizeIssues(history.issues);
  const blocks = forecastDs?.buildingBlocks.filter((b) => b.versionId === FC_N1_ID) ?? [];
  const userBlockIds = new Set(userBlocks.map((b) => b.id));

  const submitBlock = () => {
    const d = Number(delta);
    if (!d || !reason.trim() || !author.trim()) return;
    const scope = scopeKind === 'all' ? {} : { [scopeKind]: scopeValue };
    addBlock({ scope: { ...scope, ...(blockWeek ? { weekStart: blockWeek } : {}) }, deltaCommercialQty: d, reason: reason.trim(), author: author.trim(), role });
    setReason('');
  };

  const scopeOptions = scopeKind === 'sku' ? dataset.skus.map((s) => ({ v: s.id, l: s.name })) : scopeKind === 'family' ? uniq((s) => s.family).map((v) => ({ v, l: v })) : scopeKind === 'businessUnit' ? uniq((s) => s.businessUnit).map((v) => ({ v, l: v })) : [];

  const download = () => {
    if (!md61) return;
    const url = URL.createObjectURL(new Blob([md61.csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `demanda_md61_${targetStart}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setDownloaded(true);
  };

  const onFile = async (file: File | undefined) => file && loadHistory(await file.text(), file.name);

  const select = (value: string, set: (v: string) => void, label: string, options: string[]) => (
    <label className="text-[11px] font-bold text-slate-600">
      {label}
      <select value={value} onChange={(e) => set(e.target.value)} className="block mt-1 rounded-xl border border-black/10 bg-white/80 px-2.5 py-1.5 text-xs font-bold">
        <option value="">Todos</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );

  return (
    <div className="space-y-5">
      <div className="glass-panel rounded-3xl p-5">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
          <span className="w-2 h-2 rounded-full bg-[#DDCBF5]"></span>
          <span className="text-black font-extrabold">Demanda · PBO mensual y recálculo semanal N+1</span>
        </div>
        <h1 className="text-xl sm:text-2xl font-black tracking-tight text-slate-950">Línea base estadística + ajustes trazables</h1>
        <p className="text-xs text-slate-500 mt-0.5 font-medium max-w-3xl">
          Se pronostica la demanda CEDI de cada SKU con 4 modelos simples y se elige el mejor por backtest. Hard Discount y Exportaciones no se pronostican (son pedidos).
          Datos sintéticos: el "proceso vigente" del histórico de ejemplo lo definimos nosotros, así que la comparación de exactitud no es evidencia hasta usar el histórico real de Ramo.
        </p>
      </div>

      <div className="glass-panel rounded-3xl p-5 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="text-xs">
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Histórico de demanda</div>
            <div className="font-mono mt-0.5">{historyLabel} · {fmtInt(history.rows.length)} filas válidas</div>
          </div>
          <input type="file" accept=".csv,text/csv,.txt" aria-label="Archivo de histórico de demanda" onChange={(e) => onFile(e.target.files?.[0])} className="text-[11px]" />
          <button onClick={() => loadHistory(SAMPLE_HISTORY_LIMPIO, 'ejemplo sintético limpio')} className="px-3.5 py-2 text-xs font-bold text-white bg-slate-950 rounded-full cursor-pointer">Ejemplo limpio</button>
          <button onClick={() => loadHistory(SAMPLE_HISTORY_SUCIO, 'ejemplo sintético con defectos')} className="px-3.5 py-2 text-xs font-bold bg-white/80 border border-black/10 rounded-full cursor-pointer">Ejemplo con defectos</button>
        </div>
        {issueGroups.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {issueGroups.map((g) => (
              <span key={`${g.severity}${g.code}`} title={g.example} className={`text-[10px] font-bold rounded-full px-2 py-0.5 text-black ${sevStyle[g.severity]}`}>
                {g.code} · {g.count}
              </span>
            ))}
          </div>
        )}
      </div>

      {!forecast || !series ? (
        <div className="rounded-3xl px-5 py-3 text-xs font-bold bg-[#FFA27D]/30 border border-[#FFA27D]">
          No se pudo generar el pronóstico: el histórico no tiene filas válidas. El MPS y el CRP siguen con la demanda sintética fija.
        </div>
      ) : (
        <>
          <div className="glass-panel rounded-3xl p-5 space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              {select(bu, setBu, 'Unidad de negocio', uniq((s) => s.businessUnit))}
              {select(brand, setBrand, 'Marca', uniq((s) => s.brand))}
              {select(family, setFamily, 'Familia', uniq((s) => s.family))}
              <label className="text-[11px] font-bold text-slate-600">
                SKU
                <select value={skuId} onChange={(e) => setSkuId(e.target.value)} className="block mt-1 rounded-xl border border-black/10 bg-white/80 px-2.5 py-1.5 text-xs font-bold">
                  <option value="">Todos</option>
                  {dataset.skus.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
              <label className="text-[11px] font-bold text-slate-600">
                Unidad de medida
                <select value={measure} onChange={(e) => setMeasure(e.target.value as MeasureView)} className="block mt-1 rounded-xl border border-black/10 bg-white/80 px-2.5 py-1.5 text-xs font-bold">
                  {(Object.keys(MEASURE_LABELS) as MeasureView[]).map((m) => <option key={m} value={m}>{MEASURE_LABELS[m]}</option>)}
                </select>
              </label>
              <span className="text-[11px] text-slate-500 pb-2">{selected.length} SKU(s) · flujo CEDI · {unitLabel}</span>
            </div>

            {selected.length === 0 ? (
              <p className="text-xs text-slate-500">Ningún SKU cumple los filtros.</p>
            ) : (
              <>
                <DemandChart histWeeks={histWeeks} histValues={series.hist} fcWeeks={horizon} fcValues={series.n1} low={series.low} high={series.high} consensus={series.cons} unitLabel={unitLabel} />
                <p className="text-[10px] text-slate-500">
                  Negro = venta real (52 semanas) · morado discontinuo = pronóstico N+1{series.low ? ' con banda p10–p90' : ' (la banda p10–p90 solo se muestra para un SKU)'} · naranja = consenso con building blocks.
                </p>
              </>
            )}
          </div>

          {selected.length > 0 && (
            <div className="glass-panel rounded-3xl p-5 overflow-x-auto">
              <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">PBO vs N+1 vs consenso ({unitLabel})</div>
              {(() => {
                const tot = (a: number[]) => a.reduce((x, v) => x + v, 0);
                const pbo = tot(series.pbo), n1 = tot(series.n1), cons = tot(series.cons);
                const tiles = [
                  { t: 'PBO (plan mensual)', v: pbo, note: 'Pronóstico de hace 4 semanas', color: '#94a3b8' },
                  { t: 'N+1 (recálculo semanal)', v: n1, note: pbo ? `${signed(n1 / pbo - 1)} frente al PBO` : '', color: SERIES_COLORS[0] },
                  { t: 'Consenso', v: cons, note: n1 ? `${signed(cons / n1 - 1)} frente al N+1 (ajustes humanos)` : '', color: SERIES_COLORS[1] },
                ];
                const mx = Math.max(pbo, n1, cons, 1);
                return (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                    {tiles.map((x) => (
                      <div key={x.t} className="rounded-2xl bg-white/60 border border-white/80 p-3">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{x.t}</div>
                        <div className="text-2xl font-black font-mono mt-0.5">{fmt(x.v)}</div>
                        <div className="mt-1.5"><ProgressBar value={x.v} max={mx} color={x.color} height={6} /></div>
                        <div className="text-[11px] text-slate-500 mt-1">{x.note}</div>
                      </div>
                    ))}
                  </div>
                );
              })()}
              <Disclosure title="Ver semana a semana (tabla)">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] uppercase text-slate-500 text-right">
                    <th className="text-left py-1">Semana</th><th>PBO</th><th>N+1</th><th>Δ N+1 vs PBO</th><th>Consenso</th><th>Δ consenso vs N+1</th>
                  </tr>
                </thead>
                <tbody>
                  {horizon.map((w, i) => (
                    <tr key={w} className="border-t border-black/5 text-right font-mono">
                      <td className="text-left font-sans font-bold py-1">{weekLabel(w)}</td>
                      <td>{fmt(series.pbo[i])}</td>
                      <td>{fmt(series.n1[i])}</td>
                      <td className={series.pbo[i] ? '' : 'text-slate-300'}>{series.pbo[i] ? signed(series.n1[i] / series.pbo[i] - 1) : '—'}</td>
                      <td className="font-extrabold">{fmt(series.cons[i])}</td>
                      <td className={Math.round(series.cons[i]) === Math.round(series.n1[i]) ? 'text-slate-300' : 'text-[#c2410c] font-bold'}>
                        {series.n1[i] ? signed(series.cons[i] / series.n1[i] - 1) : '—'}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t text-right font-mono font-black">
                    <td className="text-left font-sans py-1.5">Total 13 sem.</td>
                    <td>{fmt(series.pbo.reduce((a, v) => a + v, 0))}</td>
                    <td>{fmt(series.n1.reduce((a, v) => a + v, 0))}</td>
                    <td>{signed(series.n1.reduce((a, v) => a + v, 0) / (series.pbo.reduce((a, v) => a + v, 0) || 1) - 1)}</td>
                    <td>{fmt(series.cons.reduce((a, v) => a + v, 0))}</td>
                    <td>{signed(series.cons.reduce((a, v) => a + v, 0) / (series.n1.reduce((a, v) => a + v, 0) || 1) - 1)}</td>
                  </tr>
                </tbody>
              </table>
              </Disclosure>
              <p className="text-[10px] text-slate-500 mt-2">El PBO se corrió 4 semanas antes (menos historia, más distancia); el N+1 usa todo el histórico hasta la semana anterior.</p>
            </div>
          )}

          <div className="glass-panel rounded-3xl p-5 overflow-x-auto">
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">¿Qué tan bien habría acertado? Modelo vs proceso vigente</div>
            <p className="text-[11px] text-slate-500 mb-3">Error en las últimas 12 semanas pronosticando la semana siguiente. Barra corta = acierta más. El "proceso vigente" de este ejemplo es simulado, no el Excel real de Ramo.</p>
            <ul className="space-y-3 mb-3">
              {forecast.n1.skus.filter((s) => ids.has(s.skuId)).map((s) => {
                const rec = s.recent?.wape1;
                const cur = s.current?.wape;
                const verdict = rec === undefined || cur === undefined ? '—' : rec < cur * 0.95 ? 'Mejor' : rec > cur * 1.05 ? 'Peor' : 'Similar';
                const mx = Math.max(rec ?? 0, cur ?? 0, 0.01);
                return (
                  <li key={s.skuId} className="grid grid-cols-1 md:grid-cols-[1.2fr_2fr_auto] items-center gap-2 md:gap-4">
                    <div>
                      <div className="text-xs font-black">{dataset.skus.find((k) => k.id === s.skuId)?.name.replace(' (sint.)', '')}</div>
                      <div className="text-[10px] text-slate-500">{MODEL_LABELS[s.model]}{s.recent ? ` · ${s.recent.bias < -0.005 ? 'tiende a quedarse corto' : s.recent.bias > 0.005 ? 'tiende a pasarse' : 'sin sesgo'}` : ''}</div>
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2"><span className="w-20 text-[10px] text-slate-500">Modelo</span><div className="flex-1"><ProgressBar value={rec ?? 0} max={mx} color={SERIES_COLORS[0]} height={7} /></div><span className="w-12 text-right font-mono text-[11px]">{rec === undefined ? '—' : pct(rec)}</span></div>
                      <div className="flex items-center gap-2"><span className="w-20 text-[10px] text-slate-500">Proceso vigente</span><div className="flex-1"><ProgressBar value={cur ?? 0} max={mx} color="#94a3b8" height={7} /></div><span className="w-12 text-right font-mono text-[11px]">{cur === undefined ? '—' : pct(cur)}</span></div>
                    </div>
                    <span className={`text-[10px] font-black rounded-full px-2.5 py-1 text-black justify-self-start ${verdict === 'Mejor' ? 'bg-[#7AFFA1]' : verdict === 'Peor' ? 'bg-[#FFA27D]' : 'bg-[#DDCBF5]'}`}>{verdict}</span>
                  </li>
                );
              })}
            </ul>
            <Disclosure title="Ver todas las cifras del backtest (tabla)">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] uppercase text-slate-500 text-right">
                  <th className="text-left py-1">SKU</th><th className="text-left">Modelo elegido</th><th>Error selección (13 sem.)</th><th>Error últimas 12 sem. (1 sem.)</th><th>Error proceso vigente</th><th>Sesgo reciente</th><th>Veredicto</th>
                </tr>
              </thead>
              <tbody>
                {forecast.n1.skus.filter((s) => ids.has(s.skuId)).map((s) => {
                  const rec = s.recent?.wape1;
                  const cur = s.current?.wape;
                  const verdict = rec === undefined || cur === undefined ? '—' : rec < cur * 0.95 ? 'Mejor' : rec > cur * 1.05 ? 'Peor' : 'Similar';
                  return (
                    <tr key={s.skuId} className="border-t border-black/5 text-right font-mono">
                      <td className="text-left font-sans font-bold py-1.5">{dataset.skus.find((k) => k.id === s.skuId)?.name}</td>
                      <td className="text-left font-sans">{MODEL_LABELS[s.model]}</td>
                      <td>{pct(s.backtest.wapeAvg)}</td>
                      <td>{rec === undefined ? '—' : pct(rec)}</td>
                      <td>{cur === undefined ? '—' : pct(cur)}</td>
                      <td>{s.recent ? signed(s.recent.bias) : '—'}</td>
                      <td className={`font-sans font-bold ${verdict === 'Mejor' ? 'text-emerald-800' : verdict === 'Peor' ? 'text-[#c2410c]' : 'text-slate-600'}`}>{verdict}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </Disclosure>
            <p className="text-[10px] text-slate-500 mt-2">
              Error = WAPE (Σ|error| ÷ Σ venta). El modelo se elige evaluando a las mismas 13 semanas que usa el plan, con orígenes repartidos en el año (incluye diciembre);
              se prefiere un modelo estacional si no es peor que el mejor en más de 10 % (supuesto de negocio a calibrar con datos reales).
            </p>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[1fr_1fr] gap-5 items-start">
            <div className="glass-panel rounded-3xl p-5 space-y-3">
              <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Building block (ajuste colaborativo)</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                <select value={scopeKind} onChange={(e) => { const k = e.target.value as ScopeKind; setScopeKind(k); setScopeValue(k === 'sku' ? dataset.skus[0].id : k === 'family' ? uniq((s) => s.family)[0] : uniq((s) => s.businessUnit)[0]); }} aria-label="Alcance" className="rounded-xl border border-black/10 bg-white/80 px-2.5 py-2">
                  <option value="sku">Un SKU</option><option value="family">Una familia</option><option value="businessUnit">Unidad de negocio</option><option value="all">Todos los SKUs</option>
                </select>
                <select value={scopeValue} onChange={(e) => setScopeValue(e.target.value)} disabled={scopeKind === 'all'} aria-label="Valor del alcance" className="rounded-xl border border-black/10 bg-white/80 px-2.5 py-2 disabled:opacity-40">
                  {scopeOptions.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
                </select>
                <select value={blockWeek} onChange={(e) => setBlockWeek(e.target.value)} aria-label="Semana" className="rounded-xl border border-black/10 bg-white/80 px-2.5 py-2">
                  <option value="">Todas las semanas</option>
                  {horizon.map((w) => <option key={w} value={w}>{weekLabel(w)}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-[110px_1fr] gap-2 text-xs">
                <input type="number" step="100" value={delta} onChange={(e) => setDelta(e.target.value)} aria-label="Cajas por semana" className="rounded-xl border border-black/10 bg-white/80 px-2.5 py-2 font-mono" />
                <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo (obligatorio)" aria-label="Motivo" className="rounded-xl border border-black/10 bg-white/80 px-2.5 py-2" />
              </div>
              <div className="grid grid-cols-[1fr_150px] gap-2 text-xs">
                <input value={author} onChange={(e) => setAuthor(e.target.value)} aria-label="Autor" className="rounded-xl border border-black/10 bg-white/80 px-2.5 py-2" />
                <select value={role} onChange={(e) => setRole(e.target.value as Role)} aria-label="Rol" className="rounded-xl border border-black/10 bg-white/80 px-2.5 py-2">
                  {ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
              </div>
              <p className="text-[10px] text-slate-500">Las cajas se suman a cada semana del alcance y se reparten entre los SKUs en proporción a su pronóstico. Nunca quedan cantidades negativas.</p>
              <button onClick={submitBlock} disabled={!can('demand.edit') || !Number(delta) || !reason.trim()} title={can('demand.edit') ? undefined : 'Tu rol no puede registrar building blocks'} className="px-4 py-2 text-xs font-bold text-white bg-slate-950 rounded-full disabled:opacity-40 cursor-pointer">
                Registrar building block
              </button>
              <ul className="text-xs space-y-1.5 pt-1">
                {blocks.map((b) => (
                  <li key={b.id} className="flex items-start justify-between gap-2">
                    <span>
                      <span className="font-mono font-bold">{b.deltaCommercialQty > 0 ? '+' : ''}{fmtInt(b.deltaCommercialQty)}</span>{' '}
                      {b.scope.skuId ? dataset.skus.find((s) => s.id === b.scope.skuId)?.name : b.scope.family ?? b.scope.businessUnit ?? 'Todos'} · {b.scope.weekStart ? weekLabel(b.scope.weekStart) : 'todas las semanas'} — {b.reason}{' '}
                      <span className="text-slate-400">({b.author}, {ROLES.find((r) => r.id === b.role)?.label}{userBlockIds.has(b.id) ? '' : ', ejemplo'})</span>
                    </span>
                    {userBlockIds.has(b.id) && <button onClick={() => removeBlock(b.id)} aria-label="Quitar" className="text-slate-400 hover:text-black cursor-pointer">✕</button>}
                  </li>
                ))}
              </ul>
            </div>

            <div className="glass-panel rounded-3xl p-5 space-y-3">
              <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Del plan de demanda a SAP y al MPS</div>
              <label className="flex items-start gap-2 text-xs font-bold cursor-pointer">
                <input type="checkbox" checked={useForecast} onChange={(e) => setUseForecast(e.target.checked)} className="mt-0.5" />
                <span>Usar este plan de demanda (consenso) en el MPS y el CRP
                  <span className="block font-medium text-slate-500">Si lo apagas, el MPS vuelve a la demanda sintética fija del ejemplo.</span></span>
              </label>
              {md61 && (
                <>
                  <p className="text-xs text-slate-600">
                    Archivo MD61: <span className="font-mono font-bold">{fmtInt(md61.rows.length)}</span> filas · <span className="font-mono font-bold">{fmtInt(md61.totalCommercial)}</span> cajas CEDI (13 semanas, consenso).
                    Hard Discount y Exportaciones no se cargan.
                  </p>
                  {md61.issues.length > 0 && (
                    <ul className="text-xs text-[#c2410c] font-bold">{md61.issues.map((i, k) => <li key={k}>{i.code}: {i.message}</li>)}</ul>
                  )}
                  <table className="w-full text-[11px] font-mono">
                    <thead><tr className="text-[10px] text-slate-500 text-left font-sans uppercase">{md61.header.map((h) => <th key={h} className="pr-2">{h}</th>)}</tr></thead>
                    <tbody>
                      {md61.rows.slice(0, 5).map((r, i) => (
                        <tr key={i} className="border-t border-black/5">
                          <td className="pr-2">{r.material.slice(-7)}</td><td className="pr-2">{r.centro}</td><td className="pr-2">{r.tipoReq}</td><td className="pr-2">{r.version}</td>
                          <td className="pr-2">{r.periodo}</td><td className="pr-2">{r.fecha}</td><td className="pr-2">{fmtInt(r.cantidad)}</td><td>{r.unidad}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="text-[10px] text-slate-500">Vista previa (5 filas). El formato de columnas es un supuesto: se revisa el archivo antes de cargarlo; esta app no escribe en SAP.</p>
                  <button onClick={download} disabled={md61.rows.length === 0} className="px-4 py-2 text-xs font-bold text-white bg-slate-950 rounded-full disabled:opacity-40 cursor-pointer">
                    Descargar archivo para revisión
                  </button>
                  {downloaded && <p className="text-[11px] font-bold text-emerald-800">Archivo generado. Revísalo antes de cargarlo con LSMW.</p>}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
