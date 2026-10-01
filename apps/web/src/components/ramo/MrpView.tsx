import React, { useMemo, useState } from 'react';
import { MaterialType } from '@ramo/domain';
import { RiskReason, RiskStatus, consumptionBySku } from '@ramo/engine';
import { useRamoPlan } from '../../ramo/store';
import { fmtDec, fmtInt, weekLabel } from '../../ramo/format';
import { StockChart } from './StockChart';

const STATUS: Record<RiskStatus, { label: string; chip: string }> = {
  CRITICAL: { label: 'Ruptura dentro del plazo', chip: 'bg-[#FFA27D]' },
  ORDER: { label: 'Pedir ya', chip: 'bg-[#FFF87C]' },
  WATCH: { label: 'Vigilar', chip: 'bg-[#DDCBF5]' },
  OK: { label: 'Sin riesgo cercano', chip: 'bg-[#7AFFA1]' },
};
const REASON: Record<RiskReason, string> = {
  NONE: 'Sin ruptura que exija decidir en el horizonte.',
  SAFETY: 'Sin ruptura, pero el inventario baja del colchón de seguridad.',
  RUPTURE_LATE: 'Se rompe más allá del plazo: hay tiempo, pero hay que pedir antes de la fecha límite.',
  ORDER_SOON: 'La fecha límite para pedir cae esta semana.',
  RUPTURE_IN_LEAD_TIME: 'Se rompe antes de que llegue un pedido hecho hoy: solo se salva con una orden ya en camino o con acuerdos de urgencia.',
};
const TYPE_LABEL: Record<MaterialType, string> = { RAW: 'Insumo', PACKAGING: 'Empaque', MIX: 'Mezcla' };

/** Tablero de riesgo de abastecimiento: producción del MPS explotada a insumos y empaques, con alertas contra el plazo de entrega. */
export function MrpView() {
  const { dataset, supplyRisk } = useRamoPlan();
  const [statusFilter, setStatusFilter] = useState<RiskStatus | ''>('');
  const [typeFilter, setTypeFilter] = useState<MaterialType | ''>('');
  const [selected, setSelected] = useState('');

  const materials = dataset.materials ?? [];
  const mat = (id: string) => materials.find((m) => m.id === id)!;
  const skuName = (id: string) => dataset.skus.find((s) => s.id === id)?.name ?? id;

  const risks = useMemo(
    () => (supplyRisk?.risks ?? []).filter((r) => (!statusFilter || r.status === statusFilter) && (!typeFilter || mat(r.materialId).type === typeFilter)),
    [supplyRisk, statusFilter, typeFilter],
  );

  if (!supplyRisk) {
    return <div className="glass-panel rounded-3xl p-5 text-xs"><h1 className="text-xl font-black">Riesgo de abastecimiento</h1><p className="mt-2 text-slate-600">El dataset no define materiales ni lista de materiales.</p></div>;
  }

  const counts = (['CRITICAL', 'ORDER', 'WATCH', 'OK'] as RiskStatus[]).map((s) => ({ s, n: supplyRisk.risks.filter((r) => r.status === s).length }));
  const current = supplyRisk.risks.find((r) => r.materialId === (selected || risks[0]?.materialId)) ?? risks[0];
  const proj = current ? supplyRisk.projections.find((p) => p.materialId === current.materialId) : undefined;
  const m = current ? mat(current.materialId) : undefined;
  const drivers = current ? consumptionBySku(supplyRisk, current.materialId) : [];
  const orders = (dataset.purchaseOrders ?? []).filter((o) => o.materialId === current?.materialId);
  const totalUse = drivers.reduce((a, d) => a + d.qty, 0);
  const pathsFor = (skuId: string) => (supplyRisk.explosion.paths.get(`${skuId}|${current!.materialId}`) ?? []).map((p) => p.map((id) => materials.find((x) => x.id === id)?.name ?? skuName(id)).join(' → '));

  return (
    <div className="space-y-5">
      <div className="glass-panel rounded-3xl p-5">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
          <span className="w-2 h-2 rounded-full bg-[#FFA27D]"></span>
          <span className="text-black font-extrabold">MRP · Tablero de riesgo de abastecimiento</span>
        </div>
        <h1 className="text-xl sm:text-2xl font-black tracking-tight text-slate-950">¿Qué insumo se rompe, cuándo, y alcanza a llegar a tiempo?</h1>
        <p className="text-xs text-slate-500 mt-0.5 font-medium max-w-4xl">
          La producción del MPS final (con los ajustes de Daniel) se baja a días según el calendario de cada línea, se explota con la lista de materiales (las mezclas de la planta secreta
          son ítems de paso) y se proyecta el inventario día a día con las órdenes de compra abiertas. Es de solo lectura: no crea pedidos. Materiales, listas y órdenes son sintéticos.
        </p>
        <p className="text-[11px] text-slate-500 mt-1.5 max-w-4xl">
          <span className="font-bold">Fuente de cálculo:</span> explosión propia. La alternativa es la simulación nativa del MRP de SAP (sin tocar el plan firme) una vez el MPS+CRP llegue a SAP como órdenes provisionales; este tablero está pensado para contrastar contra ella. Decisión pendiente (ver ADR 0006).
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {counts.map(({ s, n }) => (
          <button key={s} onClick={() => setStatusFilter(statusFilter === s ? '' : s)} className={`glass-panel rounded-2xl p-4 text-left cursor-pointer ${statusFilter === s ? 'ring-2 ring-black' : ''}`}>
            <span className={`text-[9px] font-black rounded-full px-2 py-0.5 text-black ${STATUS[s].chip}`}>{STATUS[s].label}</span>
            <div className="text-2xl font-black font-mono mt-2">{n}</div>
          </button>
        ))}
      </div>

      <div className="glass-panel rounded-3xl p-5 space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Materiales por riesgo ({risks.length})</div>
          <label className="text-[11px] font-bold text-slate-600">Tipo
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as MaterialType | '')} className="block mt-1 rounded-xl border border-black/10 bg-white/80 px-2.5 py-1.5 text-xs font-bold">
              <option value="">Todos</option><option value="RAW">Insumos</option><option value="PACKAGING">Empaques</option>
            </select>
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] uppercase text-slate-500 text-right">
                <th className="text-left py-1">Material</th><th className="text-left">Estado</th><th>Inventario</th><th>Cobertura (días)</th><th>Plazo (días)</th><th>Ruptura</th><th>Pedir antes de</th><th>Pedido sugerido</th>
              </tr>
            </thead>
            <tbody>
              {risks.map((r) => {
                const mm = mat(r.materialId);
                return (
                  <tr key={r.materialId} onClick={() => setSelected(r.materialId)} className={`border-t border-black/5 text-right font-mono cursor-pointer hover:bg-white/50 ${current?.materialId === r.materialId ? 'bg-white/60' : ''}`}>
                    <td className="text-left font-sans py-1.5"><span className="font-bold">{mm.name}</span> <span className="text-slate-400">· {TYPE_LABEL[mm.type]}</span></td>
                    <td className="text-left font-sans"><span className={`text-[9px] font-black rounded-full px-2 py-0.5 text-black ${STATUS[r.status].chip}`}>{STATUS[r.status].label}</span></td>
                    <td>{fmtInt(mm.stock)} {mm.unit}</td>
                    <td>{r.coverageDays === null ? '—' : fmtDec(r.coverageDays)}</td>
                    <td>{r.leadTimeDays}</td>
                    <td>{r.ruptureDate ? weekLabel(r.ruptureDate) : '—'}</td>
                    <td>{r.orderByDate ? (r.orderByDate.startsWith('antes') ? <span className="text-[#c2410c] font-bold">ya pasó</span> : weekLabel(r.orderByDate)) : '—'}</td>
                    <td>{r.suggestion ? `${fmtInt(r.suggestion.qty)} ${mm.unit}` : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] text-slate-500">Cobertura = inventario ÷ consumo diario de las 2 primeras semanas. "Sin riesgo cercano" incluye materiales que se rompen más adelante pero cuya fecha límite para pedir queda a más de 28 días.</p>
      </div>

      {current && m && proj && (
        <div className="grid grid-cols-1 xl:grid-cols-[1.4fr_1fr] gap-5 items-start">
          <div className="glass-panel rounded-3xl p-5 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-black">{m.name}</h2>
              <span className={`text-[9px] font-black rounded-full px-2 py-0.5 text-black ${STATUS[current.status].chip}`}>{STATUS[current.status].label}</span>
            </div>
            <p className="text-xs text-slate-600">{REASON[current.reason]}</p>
            <StockChart dates={supplyRisk.dates} stock={proj.stock} receipts={proj.receipts} safety={m.safetyDays * current.avgDailyConsumption} leadTimeDays={m.leadTimeDays} ruptureIndex={current.daysToRupture} unit={m.unit} />
            <p className="text-[10px] text-slate-500">Línea negra = inventario proyectado ({m.unit}) · punto verde = llega una orden de compra · morado = hasta aquí no llega un pedido hecho hoy · naranja punteado = colchón de seguridad ({m.safetyDays} días).</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
              {[
                ['Inventario', `${fmtInt(m.stock)} ${m.unit}`],
                ['Consumo diario (2 sem.)', `${fmtInt(current.avgDailyConsumption)} ${m.unit}`],
                ['Plazo de entrega', `${m.leadTimeDays} días`],
                ['Pedido mínimo', `${fmtInt(m.moq)} ${m.unit}`],
              ].map(([k, v]) => (
                <div key={k} className="rounded-xl bg-white/60 border border-white/80 px-3 py-2"><div className="text-[10px] uppercase font-bold text-slate-500">{k}</div><div className="font-mono font-bold">{v}</div></div>
              ))}
            </div>
          </div>

          <div className="space-y-5">
            <div className="glass-panel rounded-3xl p-5 space-y-2">
              <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Pedido sugerido y cuota de proveedores</div>
              {current.suggestion ? (
                <>
                  <p className="text-xs text-slate-600">Cubre hasta el plazo + 14 días más el colchón, descontando inventario y órdenes abiertas. Es una sugerencia de lectura; no genera pedidos.</p>
                  <table className="w-full text-xs">
                    <tbody>
                      {current.suggestion.split.map((s) => (
                        <tr key={s.supplier} className="border-t border-black/5 font-mono">
                          <td className="font-sans py-1">{s.supplier} <span className="text-slate-400">· cuota {fmtDec(s.share * 100, 0)}%</span></td>
                          <td className="text-right font-bold">{fmtInt(s.qty)} {m.unit}</td>
                        </tr>
                      ))}
                      <tr className="border-t font-mono font-black"><td className="font-sans py-1">Total</td><td className="text-right">{fmtInt(current.suggestion.qty)} {m.unit}</td></tr>
                    </tbody>
                  </table>
                  {m.suppliers.length > 1 && <p className="text-[10px] text-slate-500">Reparto por cuota reguladora, en múltiplos del pedido mínimo. La IA que avisa cuándo conviene romper la cuota por riesgo de plazo llega en la Fase 7.</p>}
                </>
              ) : <p className="text-xs text-slate-500">{current.lateOrder ? 'Un pedido nuevo no ayuda: el problema es el momento de llegada de la orden abierta.' : 'No hace falta pedir dentro del horizonte con el inventario y las órdenes abiertas actuales.'}</p>}
              {current.lateOrder && (
                <div className="rounded-xl bg-[#FFA27D]/30 border border-[#FFA27D] px-3 py-2 text-xs">
                  <span className="font-black">Adelantar orden abierta:</span> {current.lateOrder.supplier} entrega {fmtInt(current.lateOrder.qty)} {m.unit} el {weekLabel(current.lateOrder.dueDate)}, {current.lateOrder.daysAfterRupture} día(s) después de la ruptura ({current.ruptureDate ? weekLabel(current.ruptureDate) : ''}). Hay que acordar con el proveedor una entrega anterior.
                </div>
              )}
              {orders.length > 0 && (
                <div className="pt-1">
                  <div className="text-[10px] font-bold uppercase text-slate-500">Órdenes de compra abiertas</div>
                  <ul className="text-xs">{orders.map((o, i) => <li key={i} className="font-mono">{weekLabel(o.dueDate)} · {fmtInt(o.qty)} {m.unit} <span className="font-sans text-slate-400">({o.supplier})</span></li>)}</ul>
                </div>
              )}
            </div>

            <div className="glass-panel rounded-3xl p-5 space-y-2">
              <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Qué productos lo consumen</div>
              <table className="w-full text-xs">
                <tbody>
                  {drivers.slice(0, 6).map((d) => (
                    <React.Fragment key={d.skuId}>
                      <tr className="border-t border-black/5 font-mono">
                        <td className="font-sans py-1 font-bold">{skuName(d.skuId)}</td>
                        <td className="text-right">{fmtInt(d.qty)} {m.unit}</td>
                        <td className="text-right text-slate-400 w-14">{totalUse > 0 ? fmtDec((d.qty / totalUse) * 100, 0) : 0}%</td>
                      </tr>
                      {pathsFor(d.skuId).filter((p) => p.split(' → ').length > 2).slice(0, 1).map((p) => (
                        <tr key={p}><td colSpan={3} className="text-[10px] text-slate-500 pb-1 pl-2">vía {p}</td></tr>
                      ))}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
              <p className="text-[10px] text-slate-500">Consumo del horizonte de 13 semanas. Las mezclas de la planta secreta se explotan hacia sus insumos el día en que se produce el SKU (no se modela su inventario).</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
