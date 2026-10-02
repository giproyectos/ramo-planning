import React, { useMemo, useState } from 'react';
import { AllocationReason, DrpCell, allocateScarcity, scarcityRequests, supplyGaps } from '@ramo/engine';
import { useRamoPlan } from '../../ramo/store';
import { useAuth } from '../../ramo/auth';
import { fmtDec, fmtInt, weekLabel } from '../../ramo/format';
import { LineChart, SERIES_COLORS } from './charts';
import { Card, Disclosure, ProgressBar, StackedBars } from './ui';

const PRIORITY_LABEL = { HIGH: 'Alta', NORMAL: 'Normal', LOW: 'Baja' } as const;
const REASON_LABEL: Record<AllocationReason, string> = { FULL: 'Completo', OVERRIDE: 'Ajuste manual', MINIMUM: 'Mínimo de cobertura', PRO_RATA: 'Prorrata' };

/** Paso DRP: reposición de la red (agencias → CEDI → planta), stock de seguridad dinámico y regla de escasez. */
export function DrpView() {
  const {
    dataset, drp, useDrp, setUseDrp, drpPolicy, setDrpPolicy, staticDays, setStaticDays, drpPipeline, setDrpPipeline, danielView, logEvent,
    can,
  } = useRamoPlan();
  const nodes = dataset.nodes ?? [];
  const skuIds = useMemo(() => [...new Set((drp?.rows ?? []).map((r) => r.skuId))], [drp]);
  const skuName = (id: string) => dataset.skus.find((s) => s.id === id)?.name ?? id;
  const nodeName = (id: string) => nodes.find((n) => n.id === id)?.name ?? id;

  const [skuId, setSkuId] = useState('');
  const sku = skuId || skuIds[0] || '';
  const [nodeSel, setNodeSel] = useState('');

  const gaps = useMemo(() => supplyGaps(dataset, danielView.net, danielView.capacity), [dataset, danielView]);

  // Escasez
  const [scSku, setScSku] = useState('');
  const [scWeek, setScWeek] = useState('');
  const [gapPctInput, setGapPctInput] = useState('');
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const { user: authUser } = useAuth();
  const [author, setAuthor] = useState(authUser?.name ?? 'Planeador Distribución');
  const [reason, setReason] = useState('');
  const [approved, setApproved] = useState(false);

  if (!drp || drp.weeks.length === 0) {
    return (
      <div className="glass-panel rounded-3xl p-5 text-xs">
        <h1 className="text-xl font-black">DRP</h1>
        <p className="mt-2 text-slate-600">El dataset no define una red de distribución o no hay demanda en el horizonte.</p>
      </div>
    );
  }

  const cediNode = nodes.find((n) => n.type === 'CEDI');
  const agencyNodes = nodes.filter((n) => n.type !== 'CEDI');
  const selNode = nodes.find((n) => n.id === nodeSel) ?? cediNode;
  const selRow = selNode ? drp.rows.find((r) => r.nodeId === selNode.id && r.skuId === sku) : undefined;
  const plantOfSku = (id: string) => dataset.lines.find((l) => l.id === dataset.skus.find((x) => x.id === id)?.lineId)?.plantId;
  const nodeStats = (n: (typeof nodes)[number]): NodeStats => {
    const rows = drp.rows.filter((r) => r.nodeId === n.id);
    const initial = rows.reduce((a, r) => a + r.initialOnHand, 0);
    const weekly = rows.reduce((a, r) => a + (r.cells.length ? r.cells.reduce((x, c) => x + c.gross, 0) / r.cells.length : 0), 0);
    const al = drp.alerts.filter((a) => a.nodeId === n.id);
    return {
      initial,
      coverDays: weekly > 0 ? initial / (weekly / 7) : null,
      occupancy: n.storageCapacity > 0 ? initial / n.storageCapacity : 0,
      stockouts: al.filter((a) => a.code === 'STOCKOUT').length,
      below: al.filter((a) => a.code === 'BELOW_SAFETY').length,
      space: al.filter((a) => a.code === 'SPACE').length,
    };
  };

  const weeks = drp.weeks;
  const firstGap = gaps[0];
  const selSku = scSku || firstGap?.skuId || skuIds[0];
  const selWeek = scWeek || firstGap?.weekStart || weeks[1] || weeks[0];
  const realGap = gaps.find((g) => g.skuId === selSku && g.weekStart === selWeek);
  const gapPct = gapPctInput !== '' ? Math.min(100, Math.max(0, Number(gapPctInput) || 0)) : realGap ? (1 - realGap.factor) * 100 : 20;
  const simulated = !realGap;

  const requests = scarcityRequests(dataset, drp, selSku, selWeek).map((r) => {
    const o = overrides[r.nodeId];
    return o !== undefined && o !== '' ? { ...r, override: Math.max(0, Number(o) || 0) } : r;
  });
  const requestedTotal = requests.reduce((a, r) => a + r.requested, 0);
  const supply = requestedTotal * (1 - gapPct / 100);
  const result = allocateScarcity(supply, requests);

  const total = drp.plantRequirements.reduce((a, p) => a + p.qty, 0);
  const sumSafety = (key: 'activeUnits' | 'staticUnits') => drp.safety.reduce((a, s) => a + s[key], 0);
  const spaceAlerts = drp.alerts.filter((a) => a.code === 'SPACE');
  const belowSafety = drp.alerts.filter((a) => a.code === 'BELOW_SAFETY');
  const stockouts = drp.alerts.filter((a) => a.code === 'STOCKOUT');
  const fallbackCount = drp.safety.filter((s) => s.fallback).length;

  const approve = () => {
    const ov = requests.filter((r) => r.override !== undefined).map((r) => `${nodeName(r.nodeId)}=${fmtInt(r.override ?? 0)}`);
    logEvent(author, `Reparto de escasez aprobado · ${skuName(selSku)} · sem. ${selWeek} · disponible ${fmtInt(supply)} de ${fmtInt(requestedTotal)} cajas${ov.length ? ` · ajustes manuales: ${ov.join(', ')}` : ''}${reason.trim() ? ` · motivo: ${reason.trim()}` : ''}`);
    setApproved(true);
  };
  const overridesActive = requests.some((r) => r.override !== undefined);

  const cellRows: { label: string; get: (c: DrpCell) => number; bold?: boolean }[] = [
    { label: 'Demanda', get: (c) => c.gross },
    { label: 'En camino', get: (c) => c.scheduledReceipt },
    { label: 'Stock proyectado', get: (c) => c.projectedOnHand, bold: true },
    { label: 'Stock de seguridad', get: (c) => c.safetyStock },
    { label: 'Recepción planeada', get: (c) => c.plannedReceipt },
    { label: 'Orden a liberar', get: (c) => c.plannedRelease },
  ];

  return (
    <div className="space-y-5">
      <div className="glass-panel rounded-3xl p-5">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
          <span className="w-2 h-2 rounded-full bg-[#7AFFA1]"></span>
          <span className="text-black font-extrabold">DRP · Red de distribución</span>
        </div>
        <h1 className="text-xl sm:text-2xl font-black tracking-tight text-slate-950">Reposición de agencias y CEDI, y necesidad hacia planta</h1>
        <p className="text-xs text-slate-500 mt-0.5 font-medium max-w-3xl">
          Entra la demanda CEDI del recálculo semanal (N+1). Cada nodo repone para no bajar de su stock de seguridad; lo que el CEDI necesita de planta es la entrada del MPS.
          Hard Discount y Exportaciones no pasan por el DRP. Las participaciones por nodo, el inventario por nodo y las capacidades son sintéticos (supuesto hasta tener MD04/MD5A por nodo).
        </p>
      </div>

      <div className="glass-panel rounded-3xl p-5 space-y-3">
        <div className="flex flex-wrap items-center gap-4">
          <div className="inline-flex rounded-full bg-white/70 border border-white/80 p-0.5 text-[11px] font-bold">
            {(['DYNAMIC', 'STATIC'] as const).map((p) => (
              <button key={p} onClick={() => setDrpPolicy(p)} className={`px-3 py-1.5 rounded-full cursor-pointer ${drpPolicy === p ? 'bg-slate-950 text-white' : 'text-slate-600'}`}>
                {p === 'DYNAMIC' ? 'Stock de seguridad dinámico' : 'Stock de seguridad estático'}
              </button>
            ))}
          </div>
          {drpPolicy === 'STATIC' && (
            <label className="text-[11px] font-bold text-slate-600 flex items-center gap-2">
              Días fijos de cobertura
              <input type="number" min="0" step="0.5" value={staticDays} onChange={(e) => setStaticDays(Math.max(0, Number(e.target.value) || 0))} className="w-20 rounded-xl border border-black/10 bg-white/80 px-2 py-1.5 font-mono text-xs" />
            </label>
          )}
          <label className="flex items-center gap-2 text-xs font-bold cursor-pointer">
            <input type="checkbox" checked={useDrp} onChange={(e) => setUseDrp(e.target.checked)} />
            Usar la necesidad del DRP como entrada del MPS
          </label>
          <label className="flex items-center gap-2 text-xs font-bold cursor-pointer" title="Mientras no se cargue el inventario en tránsito y las órdenes abiertas reales de cada nodo">
            <input type="checkbox" checked={drpPipeline} onChange={(e) => setDrpPipeline(e.target.checked)} />
            Suponer flujo en camino de régimen
          </label>
        </div>
        <p className="text-[11px] text-slate-500">
          Dinámico = z × σ × √(plazo + revisión), con σ el error real del pronóstico (nivel de servicio 97,5 % / 95 % / 90 % según la prioridad del canal). Estático = X días fijos de demanda promedio, como hoy.
          {drpPolicy === 'DYNAMIC' && fallbackCount > 0 && ` Sin pronóstico disponible, ${fallbackCount} combinación(es) nodo-SKU usan días fijos.`}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        {[
          { t: 'Necesidad hacia planta', v: `${fmtInt(total)} cajas`, s: `${weeks.length} semanas, entrada del MPS` },
          { t: `Stock de seguridad (${drpPolicy === 'DYNAMIC' ? 'dinámico' : 'estático'})`, v: `${fmtInt(sumSafety('activeUnits'))} cajas`, s: `vs ${fmtInt(sumSafety('staticUnits'))} con ${staticDays} días fijos (suma de nodos)` },
          { t: 'Alertas de espacio', v: String(spaceAlerts.length), s: `${new Set(spaceAlerts.map((a) => a.nodeId)).size} nodo(s) sobre su capacidad` },
          { t: 'Quiebres y stock bajo el de seguridad', v: `${stockouts.length} · ${belowSafety.length}`, s: 'quiebres · semanas bajo seguridad (plazo congelado)' },
        ].map((k) => (
          <div key={k.t} className="glass-panel rounded-2xl p-4">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{k.t}</div>
            <div className="text-xl font-black font-mono mt-1">{k.v}</div>
            <div className="text-[11px] text-slate-500 mt-0.5">{k.s}</div>
          </div>
        ))}
      </div>

      <Card title="Mapa de la red" hint="Así fluye el producto: la planta abastece al CEDI y el CEDI a las agencias. Haz clic en un punto para ver su inventario semana a semana.">
        <div className="flex flex-col items-center">
          <div className="rounded-2xl bg-[#DDCBF5]/70 px-5 py-2 text-xs font-black text-center">
            Planta · produce lo que pida el MPS
            <div className="font-mono font-bold text-[11px]">{fmtInt(total)} cajas en {weeks.length} semanas</div>
          </div>
          <div className="h-5 w-px bg-slate-300"></div>
          {cediNode && <NodeCard n={cediNode} stats={nodeStats(cediNode)} selected={selNode?.id === cediNode.id} onSelect={() => setNodeSel(cediNode.id)} wide />}
          <div className="h-5 w-px bg-slate-300"></div>
          <div className="relative w-full">
            <div className="absolute left-[12.5%] right-[12.5%] top-0 h-px bg-slate-300 hidden lg:block"></div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 pt-0 lg:pt-3">
              {agencyNodes.map((n) => <NodeCard key={n.id} n={n} stats={nodeStats(n)} selected={selNode?.id === n.id} onSelect={() => setNodeSel(n.id)} />)}
            </div>
          </div>
        </div>
      </Card>

      {selNode && selRow && (
        <Card
          title={`${selNode.name}: inventario y órdenes`}
          hint="El inventario proyectado debe quedarse por encima del stock de seguridad. Dentro del plazo de entrega no se puede recibir nada nuevo, por eso ahí puede aparecer un faltante."
          action={
            <label className="text-[11px] font-bold text-slate-600 flex items-center gap-2">
              Producto
              <select value={sku} onChange={(e) => setSkuId(e.target.value)} className="rounded-xl border border-black/10 bg-white/80 px-2.5 py-1.5 text-xs font-bold">
                {skuIds.map((id) => <option key={id} value={id}>{skuName(id)}</option>)}
              </select>
            </label>
          }
        >
          <div className="grid grid-cols-1 xl:grid-cols-[1.4fr_1fr] gap-6">
            <LineChart
              labels={weeks.map(weekLabel)}
              height={230}
              series={[
                { name: 'Inventario proyectado', color: SERIES_COLORS[0], values: selRow.cells.map((c) => c.projectedOnHand) },
                { name: 'Stock de seguridad', color: SERIES_COLORS[2], values: selRow.cells.map((c) => c.safetyStock), dashed: true },
                { name: 'Demanda', color: SERIES_COLORS[1], values: selRow.cells.map((c) => c.gross) },
              ]}
            />
            <StackedBars
              labels={weeks.map(weekLabel)}
              height={230}
              stacks={[{ name: 'Orden a liberar', color: SERIES_COLORS[0], values: selRow.cells.map((c) => c.plannedRelease) }]}
            />
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
            {drp.alerts.filter((a) => a.nodeId === selNode.id && a.skuId === sku).slice(0, 8).map((a, i) => (
              <span key={i} className={`rounded-full px-2.5 py-1 font-bold text-black ${a.code === 'STOCKOUT' ? 'bg-[#FFA27D]' : 'bg-[#FFF87C]'}`}>
                {a.code === 'STOCKOUT' ? 'Quiebre' : a.code === 'SPACE' ? 'Espacio' : 'Bajo seguridad'} · {weekLabel(a.weekStart)} · {fmtInt(a.value)} cajas
              </span>
            ))}
            {drp.alerts.filter((a) => a.nodeId === selNode.id && a.skuId === sku).length === 0 && <span className="text-emerald-800 font-bold">Sin alertas para este producto en este punto.</span>}
          </div>
          <Disclosure title="Ver el detalle semana a semana (tabla)">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-[10px] uppercase text-slate-500 text-right">
                  <th className="text-left py-1">Concepto</th>
                  {weeks.map((w) => <th key={w} className="font-mono px-1.5">{weekLabel(w)}</th>)}
                </tr>
              </thead>
              <tbody>
                {cellRows.map((cr) => (
                  <tr key={cr.label} className="text-right font-mono">
                    <td className={`text-left font-sans ${cr.bold ? 'font-bold' : 'text-slate-500'}`}>{cr.label}</td>
                    {selRow.cells.map((c) => {
                      const v = cr.get(c);
                      const low = cr.label === 'Stock proyectado' && v < c.safetyStock - 0.5;
                      return <td key={c.weekStart} className={`px-1.5 ${cr.bold ? 'font-extrabold' : ''} ${low ? (v < 0 ? 'bg-[#FFA27D] rounded' : 'bg-[#FFF87C] rounded') : ''} ${v === 0 ? 'text-slate-300' : ''}`}>{fmtInt(v)}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </Disclosure>
        </Card>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[1.3fr_1fr] gap-5 items-start">
        <Card title="Lo que se le pide a la planta" hint="Órdenes que el CEDI libera a la planta cada semana, por planta. Es la entrada del MPS.">
          <StackedBars
            labels={weeks.map(weekLabel)}
            stacks={dataset.plants.map((pl, i) => ({
              name: pl.name,
              color: SERIES_COLORS[i % SERIES_COLORS.length],
              values: weeks.map((w) => drp.plantRequirements.filter((p) => p.weekStart === w && plantOfSku(p.skuId) === pl.id).reduce((a, p) => a + p.qty, 0)),
            }))}
          />
          <Disclosure title="Ver por producto (tabla)">
            <table className="w-full text-[11px]">
              <thead><tr className="text-[10px] uppercase text-slate-500 text-right"><th className="text-left py-1">Producto</th>{weeks.map((w) => <th key={w} className="font-mono px-1.5">{weekLabel(w)}</th>)}</tr></thead>
              <tbody>
                {skuIds.map((id) => (
                  <tr key={id} className="border-t border-black/5 text-right font-mono">
                    <td className="text-left font-sans font-bold py-1">{skuName(id)}</td>
                    {weeks.map((w) => {
                      const p = drp.plantRequirements.find((x) => x.skuId === id && x.weekStart === w);
                      return <td key={w} className={`px-1.5 ${p ? '' : 'text-slate-300'}`}>{p ? fmtInt(p.qty) : '0'}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </Disclosure>
        </Card>

        <Card title="Colchón de seguridad por producto" hint={`Azul: ${drpPolicy === 'DYNAMIC' ? 'dinámico' : 'estático'}. Gris: ${staticDays} días fijos (como se hace hoy).`}>
          <ul className="space-y-2.5">
            {skuIds.map((id) => {
              const rows = drp.safety.filter((s) => s.skuId === id);
              const a = rows.reduce((x, s) => x + s.activeUnits, 0);
              const b = rows.reduce((x, s) => x + s.staticUnits, 0);
              const mx = Math.max(a, b, 1);
              return (
                <li key={id}>
                  <div className="flex items-baseline justify-between text-xs">
                    <span className="font-bold truncate pr-2">{skuName(id).replace(' (sint.)', '')}</span>
                    <span className={`font-mono text-[11px] ${a > b ? 'text-[#c2410c]' : 'text-emerald-800'}`}>{b > 0 ? `${a > b ? '+' : ''}${fmtDec((a / b - 1) * 100, 0)} %` : '—'}</span>
                  </div>
                  <div className="space-y-1 mt-1">
                    <ProgressBar value={a} max={mx} color={SERIES_COLORS[0]} height={7} />
                    <ProgressBar value={b} max={mx} color="#cbd5e1" height={7} />
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      <Disclosure title="Parámetros de la red (prioridad, plazos, capacidad)">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] uppercase text-slate-500 text-right">
              <th className="text-left py-1">Nodo</th><th className="text-left">Tipo</th><th>Plazo (sem.)</th><th>% demanda</th><th>% inventario</th><th>Prioridad</th><th>Mín. cobertura (días)</th><th>Capacidad (cajas)</th>
            </tr>
          </thead>
          <tbody>
            {nodes.map((n) => (
              <tr key={n.id} className="border-t border-black/5 text-right font-mono">
                <td className="text-left font-sans font-bold py-1.5">{n.name}</td>
                <td className="text-left font-sans">{n.type === 'CEDI' ? 'CEDI' : 'Agencia'}</td>
                <td>{n.leadTimeWeeks}</td><td>{fmtDec(n.demandShare * 100, 0)}%</td><td>{fmtDec(n.inventoryShare * 100, 0)}%</td>
                <td className="font-sans">{PRIORITY_LABEL[n.priority]}</td><td>{n.minCoverDays || '—'}</td><td>{fmtInt(n.storageCapacity)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Disclosure>

      <div className="grid grid-cols-1 gap-5 items-start">
        <div className="glass-panel rounded-3xl p-5 space-y-3">
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Alertas de la red</div>
          {drp.alerts.length === 0 ? <p className="text-xs text-emerald-800 font-bold">Sin alertas.</p> : (
            <ul className="text-xs space-y-1 max-h-56 overflow-auto">
              {spaceAlerts.slice(0, 12).map((a, i) => (
                <li key={`s${i}`}><span className="font-black bg-[#FFF87C] rounded-full px-2 py-0.5 text-[9px] mr-1.5">ESPACIO</span>{nodeName(a.nodeId)} · {weekLabel(a.weekStart)}: {fmtInt(a.value)} cajas sobre la capacidad</li>
              ))}
              {spaceAlerts.length > 12 && <li className="text-slate-500">… y {spaceAlerts.length - 12} más</li>}
              {stockouts.slice(0, 10).map((a, i) => (
                <li key={`q${i}`}><span className="font-black bg-[#FFA27D] rounded-full px-2 py-0.5 text-[9px] mr-1.5">QUIEBRE</span>{nodeName(a.nodeId)} · {skuName(a.skuId ?? '')} · {weekLabel(a.weekStart)}: faltan {fmtInt(a.value)} cajas (no puede llegar nada antes del plazo)</li>
              ))}
              {stockouts.length > 10 && <li className="text-slate-500">… y {stockouts.length - 10} quiebres más</li>}
              {belowSafety.slice(0, 10).map((a, i) => (
                <li key={`b${i}`}><span className="font-black bg-[#FFF87C] rounded-full px-2 py-0.5 text-[9px] mr-1.5">BAJO SEGURIDAD</span>{nodeName(a.nodeId)} · {skuName(a.skuId ?? '')} · {weekLabel(a.weekStart)}: {fmtInt(a.value)} cajas por debajo del stock de seguridad</li>
              ))}
              {belowSafety.length > 10 && <li className="text-slate-500">… y {belowSafety.length - 10} más</li>}
            </ul>
          )}
          <p className="text-[10px] text-slate-500">Canasta (que estén todos los SKUs de la canasta), rotación y frecuencias de despacho de Daniel todavía no se modelan.</p>
        </div>
      </div>

      <div className="glass-panel rounded-3xl p-5 space-y-3">
        <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Regla de escasez: reparto cuando producción no alcanza</div>
        <p className="text-xs text-slate-600 max-w-4xl">
          Orden: ajustes manuales → mínimos de cobertura por canal prioritario (alta → normal → baja) → resto a prorrata del pronóstico, sin pasar de lo pedido.
          <span className="font-bold"> Regla provisional descrita por Diana: pendiente de definición comercial.</span>{' '}
          {gaps.length > 0 ? `El CRP actual muestra ${gaps.length} SKU-semana con faltante de producción.` : 'El CRP actual no muestra faltantes; puedes simular uno.'}
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-[11px] font-bold text-slate-600">SKU
            <select value={selSku} onChange={(e) => { setScSku(e.target.value); setGapPctInput(''); setApproved(false); }} className="block mt-1 rounded-xl border border-black/10 bg-white/80 px-2.5 py-1.5 text-xs font-bold">
              {skuIds.map((id) => <option key={id} value={id}>{skuName(id)}</option>)}
            </select>
          </label>
          <label className="text-[11px] font-bold text-slate-600">Semana
            <select value={selWeek} onChange={(e) => { setScWeek(e.target.value); setGapPctInput(''); setApproved(false); }} className="block mt-1 rounded-xl border border-black/10 bg-white/80 px-2.5 py-1.5 text-xs font-bold">
              {weeks.map((w) => <option key={w} value={w}>{weekLabel(w)}{gaps.some((g) => g.skuId === selSku && g.weekStart === w) ? ' ⚠' : ''}</option>)}
            </select>
          </label>
          <label className="text-[11px] font-bold text-slate-600">Faltante de producción (%)
            <input type="number" min="0" max="100" value={gapPctInput !== '' ? gapPctInput : fmtDec(gapPct, 0).replace(',', '.')} onChange={(e) => { setGapPctInput(e.target.value); setApproved(false); }} className="block mt-1 w-24 rounded-xl border border-black/10 bg-white/80 px-2.5 py-1.5 font-mono text-xs" />
          </label>
          <span className={`text-[11px] font-bold rounded-full px-2.5 py-1 ${simulated ? 'bg-[#DDCBF5]' : 'bg-[#FFA27D]'}`}>{simulated && gapPctInput === '' ? 'Simulado' : realGap ? 'Faltante del CRP' : 'Simulado'}</span>
        </div>

        {requests.length === 0 ? <p className="text-xs text-slate-500">Sin pedidos de nodos para esta combinación.</p> : (
          <>
            <p className="text-xs">Pedidos: <span className="font-mono font-bold">{fmtInt(requestedTotal)}</span> cajas · disponibles para repartir: <span className="font-mono font-bold">{fmtInt(supply)}</span> ({result.scarce ? 'hay escasez' : 'alcanza para todos'})</p>
            <ul className="space-y-3">
              {result.allocations.map((a) => {
                const node = nodes.find((n) => n.id === a.nodeId)!;
                const ok = a.shortfall <= 0.5;
                return (
                  <li key={a.nodeId} className="rounded-2xl bg-white/60 border border-white/80 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs font-black truncate">{node.name}</span>
                        <span className="text-[10px] font-bold rounded-full px-2 py-0.5 bg-[#DDCBF5] text-black">{PRIORITY_LABEL[node.priority]}</span>
                        <span className="text-[10px] font-bold rounded-full px-2 py-0.5 bg-white text-slate-600 border border-black/5">{REASON_LABEL[a.reason]}</span>
                      </div>
                      <div className="text-xs font-mono">
                        <span className="font-extrabold">{fmtInt(a.allocated)}</span> de {fmtInt(a.requested)} cajas · <span className={ok ? 'text-emerald-800 font-bold' : 'text-[#c2410c] font-bold'}>{fmtDec(a.fillRate * 100, 0)} %</span>
                      </div>
                    </div>
                    <div className="mt-2 grid grid-cols-[1fr_auto] items-center gap-3">
                      <ProgressBar value={a.allocated} max={a.requested} mark={a.minimum} color={ok ? '#7AFFA1' : '#FFA27D'} height={12} />
                      <label className="text-[10px] font-bold text-slate-500 flex items-center gap-1.5">
                        Fijar a mano
                        <input type="number" min="0" placeholder="—" value={overrides[a.nodeId] ?? ''} onChange={(e) => { setOverrides((o) => ({ ...o, [a.nodeId]: e.target.value })); setApproved(false); }} aria-label={`Ajuste manual ${node.name}`} className="w-24 rounded-lg border border-black/10 bg-white/80 px-2 py-1 text-right font-mono text-xs" />
                      </label>
                    </div>
                    <div className="text-[10px] text-slate-500 mt-1">La marca negra es el mínimo que se protege ({fmtInt(a.minimum)} cajas){a.shortfall > 0.5 ? ` · faltan ${fmtInt(a.shortfall)} cajas` : ''}</div>
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-wrap items-end gap-3">
              <input value={author} onChange={(e) => setAuthor(e.target.value)} aria-label="Autor del reparto" className="rounded-xl border border-black/10 bg-white/80 px-2.5 py-2 text-xs" />
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={overridesActive ? 'Motivo del ajuste manual (obligatorio)' : 'Motivo (opcional)'} aria-label="Motivo del reparto" className="flex-1 min-w-48 rounded-xl border border-black/10 bg-white/80 px-2.5 py-2 text-xs" />
              <button onClick={approve} disabled={!can('mps.edit') || !result.scarce || (overridesActive && !reason.trim())} title={can('mps.edit') ? undefined : 'Tu rol no puede aprobar el reparto de escasez'} className="px-4 py-2 text-xs font-bold text-white bg-slate-950 rounded-full disabled:opacity-40 cursor-pointer">Aprobar reparto</button>
            </div>
            <p className="text-[10px] text-slate-500">
              El reparto aprobado queda en el registro del ciclo (quién, qué, por qué). Es una propuesta de asignación: no modifica el MPS ni escribe en SAP. La aproximación asume que el faltante de producción se reparte en la misma proporción en todo el SKU-semana.
            </p>
            {approved && <p className="text-[11px] font-bold text-emerald-800">Reparto aprobado y registrado.</p>}
          </>
        )}
      </div>
    </div>
  );
}

interface NodeStats { initial: number; coverDays: number | null; occupancy: number; stockouts: number; below: number; space: number }

function NodeCard({ n, stats, selected, onSelect, wide = false }: { n: { name: string; type: string; priority: 'HIGH' | 'NORMAL' | 'LOW'; leadTimeWeeks: number; demandShare: number }; stats: NodeStats; selected: boolean; onSelect: () => void; wide?: boolean }) {
  const tone = stats.stockouts > 0 ? 'bg-[#FFA27D]' : stats.below > 0 || stats.space > 0 ? 'bg-[#FFF87C]' : 'bg-[#7AFFA1]';
  return (
    <button onClick={onSelect} className={`glass-card glass-card-hover rounded-2xl p-3 text-left cursor-pointer ${wide ? 'w-full max-w-md' : ''} ${selected ? 'ring-2 ring-slate-900' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-black leading-tight">{n.name.replace(' (sint.)', '')}</span>
        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${tone}`} title={stats.stockouts > 0 ? `${stats.stockouts} quiebre(s)` : stats.below > 0 ? `${stats.below} semana(s) bajo seguridad` : 'Sin alertas'}></span>
      </div>
      <div className="text-[10px] text-slate-500 mt-0.5">{PRIORITY_LABEL[n.priority]} · {n.type === 'CEDI' ? 'desde planta' : 'desde CEDI'}: {n.leadTimeWeeks} sem.</div>
      <div className="mt-2 space-y-1.5">
        <div>
          <div className="flex justify-between text-[10px] text-slate-500"><span>Parte de la demanda</span><span className="font-mono font-bold">{fmtDec(n.demandShare * 100, 0)} %</span></div>
          <ProgressBar value={n.demandShare} max={1} color={SERIES_COLORS[0]} height={6} />
        </div>
        <div>
          <div className="flex justify-between text-[10px] text-slate-500"><span>Bodega ocupada hoy</span><span className="font-mono font-bold">{fmtDec(stats.occupancy * 100, 0)} %</span></div>
          <ProgressBar value={stats.occupancy} max={1} color={stats.occupancy > 0.9 ? '#FFA27D' : '#9CF5B8'} height={6} />
        </div>
      </div>
      <div className="text-[10px] text-slate-600 mt-1.5">Inventario: <span className="font-mono font-bold">{fmtInt(stats.initial)}</span>{stats.coverDays !== null ? ` cajas · ≈ ${fmtDec(stats.coverDays, 1)} días` : ' cajas'}</div>
      {(stats.stockouts > 0 || stats.below > 0) && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {stats.stockouts > 0 && <span className="text-[9px] font-black rounded-full px-1.5 py-0.5 bg-[#FFA27D]">{stats.stockouts} quiebre(s)</span>}
          {stats.below > 0 && <span className="text-[9px] font-black rounded-full px-1.5 py-0.5 bg-[#FFF87C]">{stats.below} bajo seguridad</span>}
        </div>
      )}
    </button>
  );
}
