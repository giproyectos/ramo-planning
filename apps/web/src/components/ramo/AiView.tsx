import React, { useState } from 'react';
import { RecKind, Recommendation, SUGGESTED_QUESTIONS, Urgency, answerQuestion } from '@ramo/engine';
import { useRamoPlan } from '../../ramo/store';
import { fmtDec, fmtInt, weekLabel } from '../../ramo/format';

type Tab = 'recs' | 'suppliers' | 'anomalies' | 'copilot';
const URGENCY: Record<Urgency, { label: string; chip: string }> = {
  CRITICAL: { label: 'Crítico', chip: 'bg-[#FFA27D]' },
  NORMAL: { label: 'Normal', chip: 'bg-[#FFF87C]' },
  WAIT: { label: 'Puede esperar', chip: 'bg-[#7AFFA1]' },
};
const KIND: Record<RecKind, string> = { ORDER: 'Pedido', LEAD_TIME: 'Plazo dinámico', QUOTA: 'Cuota', ANOMALY: 'Anomalía', CONSOLIDATION: 'Consolidación' };
const pct = (n: number, d = 0) => `${fmtDec(n * 100, d)}%`;

/** Capa de recomendaciones: cada una explica su porqué y solo se aplica cuando el planeador la aprueba, con motivo y autor. */
export function AiView() {
  const { dataset, supplyRisk, insights, pendingRecommendations, decisions_rec, decideRecommendation, undoRecommendation, consolidationDays, setConsolidationDays } = useRamoPlan();
  const [tab, setTab] = useState<Tab>('recs');
  const [kindFilter, setKindFilter] = useState<RecKind | ''>('');
  const [open, setOpen] = useState<string>('');
  const [author, setAuthor] = useState('Planeador Compras (demo)');
  const [reason, setReason] = useState('');
  const [chat, setChat] = useState<{ q: string; lines: string[] }[]>([]);
  const [question, setQuestion] = useState('');

  const materials = dataset.materials ?? [];
  const name = (id: string) => materials.find((m) => m.id === id)?.name ?? id;

  if (!insights || !supplyRisk) {
    return <div className="glass-panel rounded-3xl p-5 text-xs"><h1 className="text-xl font-black">Recomendaciones</h1><p className="mt-2 text-slate-600">No hay tablero de abastecimiento (el dataset no define materiales).</p></div>;
  }

  const shown = pendingRecommendations.filter((r) => !kindFilter || r.kind === kindFilter);
  const decided = Object.values(decisions_rec).sort((a, b) => b.at.localeCompare(a.at));
  const counts = (['CRITICAL', 'NORMAL', 'WAIT'] as Urgency[]).map((u) => ({ u, n: pendingRecommendations.filter((r) => r.urgency === u).length }));

  const ask = (q: string) => {
    if (!q.trim()) return;
    const a = answerQuestion(q, { ...dataset }, supplyRisk, insights);
    setChat((c) => [...c, { q, lines: a.lines }]);
    setQuestion('');
  };

  const decide = (rec: Recommendation, status: 'APPROVED' | 'REJECTED') => {
    if (!author.trim() || (status === 'REJECTED' && !reason.trim())) return;
    decideRecommendation(rec, status, author.trim(), reason.trim());
    setOpen('');
    setReason('');
  };

  const tabBtn = (t: Tab, label: string) => (
    <button key={t} onClick={() => setTab(t)} className={`px-4 py-2 rounded-full text-xs font-bold cursor-pointer ${tab === t ? 'bg-slate-950 text-white' : 'bg-white/70 text-slate-600'}`}>{label}</button>
  );

  return (
    <div className="space-y-5">
      <div className="glass-panel rounded-3xl p-5">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
          <span className="w-2 h-2 rounded-full bg-[#DDCBF5]"></span>
          <span className="text-black font-extrabold">Recomendaciones · Planeación asistida</span>
        </div>
        <h1 className="text-xl sm:text-2xl font-black tracking-tight text-slate-950">SAP propone, el sistema refina, el planeador decide</h1>
        <p className="text-xs text-slate-500 mt-0.5 font-medium max-w-4xl">
          Sobre la salida del MRP: prioriza (crítico &lt; 5 días), ajusta cantidades por la variabilidad de la demanda, recalcula plazos con las entregas reales de cada proveedor, vigila la cuota reguladora, detecta anomalías y junta pedidos.
          Todo es estadística y reglas explicables, <span className="font-bold">sin modelo de lenguaje</span>: cada recomendación muestra las cifras que la sustentan. Nada se aplica sin aprobación; los datos son sintéticos.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {tabBtn('recs', `Recomendaciones (${pendingRecommendations.length})`)}
        {tabBtn('suppliers', 'Proveedores y cuota')}
        {tabBtn('anomalies', `Anomalías (${insights.anomalies.length + insights.spikes.length})`)}
        {tabBtn('copilot', 'Copiloto')}
      </div>

      {tab === 'recs' && (
        <div className="space-y-4">
          <div className="glass-panel rounded-3xl p-4 flex flex-wrap items-end gap-4">
            {counts.map(({ u, n }) => (
              <span key={u} className="text-xs font-bold"><span className={`text-[9px] font-black rounded-full px-2 py-0.5 text-black mr-1.5 ${URGENCY[u].chip}`}>{URGENCY[u].label}</span><span className="font-mono">{n}</span></span>
            ))}
            <label className="text-[11px] font-bold text-slate-600 ml-auto">Tipo
              <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value as RecKind | '')} className="block mt-1 rounded-xl border border-black/10 bg-white/80 px-2.5 py-1.5 text-xs font-bold">
                <option value="">Todas</option>
                {(Object.keys(KIND) as RecKind[]).map((k) => <option key={k} value={k}>{KIND[k]}</option>)}
              </select>
            </label>
            <label className="text-[11px] font-bold text-slate-600">Ventana de consolidación
              <select value={consolidationDays} onChange={(e) => setConsolidationDays(Number(e.target.value))} className="block mt-1 rounded-xl border border-black/10 bg-white/80 px-2.5 py-1.5 text-xs font-bold">
                {[3, 7, 14, 21].map((d) => <option key={d} value={d}>{d} días</option>)}
              </select>
            </label>
          </div>

          {shown.length === 0 && <div className="glass-panel rounded-3xl p-5 text-xs text-slate-600">No hay recomendaciones pendientes con este filtro.</div>}
          {shown.map((r) => (
            <div key={r.id} className="glass-panel rounded-3xl p-5 space-y-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`text-[9px] font-black rounded-full px-2 py-0.5 text-black ${URGENCY[r.urgency].chip}`}>{URGENCY[r.urgency].label}</span>
                <span className="text-[9px] font-black rounded-full px-2 py-0.5 bg-white/80 border border-black/10">{KIND[r.kind]}</span>
                <h3 className="text-sm font-black">{r.title}</h3>
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Por qué</div>
                <ul className="text-xs text-slate-700 space-y-0.5 list-disc pl-4">{r.why.map((w, i) => <li key={i}>{w}</li>)}</ul>
              </div>
              {r.impact && <p className="text-xs"><span className="font-bold">Efecto:</span> {r.impact}</p>}
              {open === r.id ? (
                <div className="flex flex-wrap items-end gap-2 pt-1">
                  <input value={author} onChange={(e) => setAuthor(e.target.value)} aria-label="Autor de la decisión" className="rounded-xl border border-black/10 bg-white/80 px-2.5 py-2 text-xs" />
                  <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo (obligatorio si rechazas)" aria-label="Motivo de la decisión" className="flex-1 min-w-48 rounded-xl border border-black/10 bg-white/80 px-2.5 py-2 text-xs" />
                  <button onClick={() => decide(r, 'APPROVED')} className="px-4 py-2 text-xs font-bold text-white bg-slate-950 rounded-full cursor-pointer">Aprobar</button>
                  <button onClick={() => decide(r, 'REJECTED')} disabled={!reason.trim()} className="px-4 py-2 text-xs font-bold bg-white/80 border border-black/10 rounded-full disabled:opacity-40 cursor-pointer">Rechazar</button>
                  <button onClick={() => setOpen('')} className="text-[11px] text-slate-500 underline cursor-pointer">Cancelar</button>
                </div>
              ) : (
                <button onClick={() => setOpen(r.id)} className="px-4 py-2 text-xs font-bold text-white bg-slate-950 rounded-full cursor-pointer">Revisar y decidir</button>
              )}
            </div>
          ))}

          {decided.length > 0 && (
            <div className="glass-panel rounded-3xl p-5 space-y-2">
              <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Decididas (quién · qué · por qué)</div>
              <ul className="text-xs space-y-1.5">
                {decided.map((d) => (
                  <li key={d.recId} className="flex items-start justify-between gap-3">
                    <span><span className={`text-[9px] font-black rounded-full px-2 py-0.5 text-black mr-1.5 ${d.status === 'APPROVED' ? 'bg-[#7AFFA1]' : 'bg-[#FFA27D]'}`}>{d.status === 'APPROVED' ? 'Aprobada' : 'Rechazada'}</span>{d.title} <span className="text-slate-400">— {d.by}{d.reason ? `: ${d.reason}` : ''}</span></span>
                    <button onClick={() => undoRecommendation(d.recId)} className="text-[11px] text-slate-500 underline cursor-pointer shrink-0">Deshacer</button>
                  </li>
                ))}
              </ul>
              <p className="text-[10px] text-slate-500">Aprobar un plazo dinámico hace que el tablero MRP use el plazo real; el dato maestro de SAP no se modifica (pendiente definir la resincronización). Las demás decisiones quedan registradas en el ciclo.</p>
            </div>
          )}
        </div>
      )}

      {tab === 'suppliers' && (
        <div className="space-y-5">
          <div className="glass-panel rounded-3xl p-5 overflow-x-auto">
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">Puntualidad de entrega por proveedor</div>
            <table className="w-full text-xs">
              <thead><tr className="text-[10px] uppercase text-slate-500 text-right"><th className="text-left py-1">Proveedor</th><th>Órdenes</th><th>A tiempo</th><th>Retraso medio (días)</th><th>Materiales</th></tr></thead>
              <tbody>
                {insights.performance.map((p) => (
                  <tr key={p.supplier} className="border-t border-black/5 text-right font-mono">
                    <td className="text-left font-sans font-bold py-1.5">{p.supplier}</td><td>{p.n}</td>
                    <td className={p.onTimeRate < 0.5 ? 'text-[#c2410c] font-bold' : ''}>{pct(p.onTimeRate)}</td><td>{fmtDec(p.meanDelayDays, 1)}</td><td>{p.materials}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="glass-panel rounded-3xl p-5 overflow-x-auto">
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">Plazo real frente al fijo de SAP</div>
            <table className="w-full text-xs">
              <thead><tr className="text-[10px] uppercase text-slate-500 text-right"><th className="text-left py-1">Material</th><th className="text-left">Proveedor</th><th>Órdenes</th><th>Plazo SAP</th><th>P50 real</th><th>P80 real</th><th>A tiempo</th></tr></thead>
              <tbody>
                {insights.leadTimes.flatMap((l) => l.bySupplier.map((s, i) => (
                  <tr key={`${l.materialId}${s.supplier}`} className="border-t border-black/5 text-right font-mono">
                    <td className="text-left font-sans font-bold py-1.5">{i === 0 ? name(l.materialId) : ''}</td><td className="text-left font-sans">{s.supplier}</td>
                    <td>{s.n}</td><td>{s.plannedDays}</td><td>{s.p50}</td><td className="font-bold">{s.p80}</td><td>{pct(s.onTimeRate)}</td>
                  </tr>
                )))}
              </tbody>
            </table>
            <p className="text-[10px] text-slate-500 mt-2">Solo materiales con ≥ 8 órdenes y un P80 que supera al plazo fijo en ≥ 2 días y ≥ 10 %.</p>
          </div>

          <div className="glass-panel rounded-3xl p-5 space-y-3">
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Cuota reguladora: negociada vs usada</div>
            {insights.quota.map((q) => (
              <div key={q.materialId} className="space-y-1">
                <div className="flex items-center gap-2 text-xs font-bold">{name(q.materialId)}
                  <span className={`text-[9px] font-black rounded-full px-2 py-0.5 text-black ${q.broken ? 'bg-[#FFA27D]' : 'bg-[#7AFFA1]'}`}>{q.broken ? 'Rota' : 'Respetada'}</span>
                  <span className="font-normal text-slate-400">{q.orders} órdenes · desviación máx. {fmtDec(q.maxDeviationPp, 0)} pp</span>
                </div>
                {q.rows.map((r) => (
                  <div key={r.supplier} className="grid grid-cols-[150px_1fr_110px] items-center gap-2 text-[11px]">
                    <span>{r.supplier}</span>
                    <div className="relative h-3 rounded-full bg-black/5">
                      <div className="absolute inset-y-0 left-0 rounded-full bg-[#7c3aed]/70" style={{ width: pct(r.actual) }} />
                      <div className="absolute -top-0.5 -bottom-0.5 w-0.5 bg-black" style={{ left: pct(r.quota) }} title={`Cuota negociada ${pct(r.quota)}`} />
                    </div>
                    <span className="font-mono text-right">{pct(r.actual)} <span className="text-slate-400">/ {pct(r.quota)}</span></span>
                  </div>
                ))}
              </div>
            ))}
            <p className="text-[10px] text-slate-500">Barra = cantidad real pedida a cada proveedor; raya negra = cuota negociada. Una desviación de 10 puntos o más se marca como rota.</p>
          </div>
        </div>
      )}

      {tab === 'anomalies' && (
        <div className="space-y-5">
          <div className="glass-panel rounded-3xl p-5 overflow-x-auto">
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">Solicitudes y órdenes de compra</div>
            {insights.anomalies.length === 0 ? <p className="text-xs text-emerald-800 font-bold">Sin anomalías.</p> : (
              <table className="w-full text-xs">
                <thead><tr className="text-[10px] uppercase text-slate-500 text-left"><th className="py-1">Tipo</th><th>Referencia</th><th>Material</th><th className="text-right">Cantidad</th><th className="pl-4">Detalle</th></tr></thead>
                <tbody>
                  {insights.anomalies.map((a) => (
                    <tr key={`${a.kind}${a.ref}`} className="border-t border-black/5">
                      <td className="py-1.5"><span className={`text-[9px] font-black rounded-full px-2 py-0.5 text-black ${a.kind === 'DUPLICATE_REQUISITION' ? 'bg-[#FFA27D]' : 'bg-[#FFF87C]'}`}>{a.kind === 'DUPLICATE_REQUISITION' ? 'Posible duplicado' : 'Cantidad atípica'}</span></td>
                      <td className="font-mono">{a.ref}</td><td>{name(a.materialId)}</td><td className="text-right font-mono">{fmtInt(a.qty)}</td><td className="pl-4 text-slate-600">{a.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="glass-panel rounded-3xl p-5 overflow-x-auto">
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">Ventas atípicas (últimas 26 semanas)</div>
            {insights.spikes.length === 0 ? <p className="text-xs text-emerald-800 font-bold">Sin ventas atípicas.</p> : (
              <table className="w-full text-xs">
                <thead><tr className="text-[10px] uppercase text-slate-500 text-right"><th className="text-left py-1">SKU</th><th>Semana</th><th>Vendido</th><th>Esperado</th><th>Veces</th></tr></thead>
                <tbody>
                  {insights.spikes.map((s) => (
                    <tr key={`${s.skuId}${s.weekStart}`} className="border-t border-black/5 text-right font-mono">
                      <td className="text-left font-sans font-bold py-1.5">{dataset.skus.find((k) => k.id === s.skuId)?.name}</td><td>{weekLabel(s.weekStart)}</td><td>{fmtInt(s.value)}</td><td>{fmtInt(s.expected)}</td><td>{fmtDec(s.ratio, 2)}×</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="text-[10px] text-slate-500 mt-2">Si no se explican (promoción, quiebre, error de captura), contaminan el pronóstico de las semanas siguientes.</p>
          </div>
        </div>
      )}

      {tab === 'copilot' && (
        <div className="glass-panel rounded-3xl p-5 space-y-3">
          <p className="text-xs text-slate-600 max-w-3xl">Preguntas guiadas sobre resultados ya calculados. <span className="font-bold">No genera texto libre ni usa un modelo de lenguaje</span>: cada respuesta cita las cifras del tablero y del historial de órdenes. Puedes nombrar un material (por ejemplo «cacao») para ver su explicación completa.</p>
          <div className="flex flex-wrap gap-2">
            {SUGGESTED_QUESTIONS.map((q) => <button key={q} onClick={() => ask(q)} className="px-3 py-1.5 text-[11px] font-bold bg-white/80 border border-black/10 rounded-full cursor-pointer">{q}</button>)}
          </div>
          <div className="flex gap-2">
            <input value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ask(question)} placeholder="Escribe una pregunta, p. ej. «¿por qué el cacao está en riesgo?»" aria-label="Pregunta al copiloto" className="flex-1 rounded-xl border border-black/10 bg-white/80 px-3 py-2 text-xs" />
            <button onClick={() => ask(question)} className="px-4 py-2 text-xs font-bold text-white bg-slate-950 rounded-full cursor-pointer">Preguntar</button>
          </div>
          <div className="space-y-3">
            {chat.map((m, i) => (
              <div key={i} className="space-y-1">
                <div className="text-xs font-bold text-slate-900">› {m.q}</div>
                <div className="rounded-2xl bg-white/60 border border-white/80 p-3 text-xs text-slate-700 space-y-0.5">{m.lines.map((l, k) => <p key={k} className={l.startsWith('   ') ? 'pl-4 text-slate-500' : ''}>{l.trim()}</p>)}</div>
              </div>
            ))}
            {chat.length === 0 && <p className="text-xs text-slate-400">Aún no hay preguntas.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
