import React from 'react';
import { CYCLE_ORDER } from '@ramo/engine';
import { useRamoPlan } from '../../ramo/store';
import { useAuth } from '../../ramo/auth';
import { fmtDec, fmtInt, weekLabel } from '../../ramo/format';
import { Card, ProgressBar } from './ui';
import { SERIES_COLORS } from './charts';

export type AiKind = 'Estadística' | 'Optimización' | 'Simulación' | 'Reglas';

const KIND_HELP: Record<AiKind, string> = {
  Estadística: 'Cálculo estadístico sobre el histórico. No es un modelo de lenguaje.',
  Optimización: 'Algoritmo que busca la mejor combinación dentro de las restricciones. No es un modelo de lenguaje.',
  Simulación: 'Miles de escenarios simulados con la variabilidad real de los datos. No es un modelo de lenguaje.',
  Reglas: 'Reglas explicables. No es un modelo de lenguaje.',
};

/** Marca de asistente: deja claro qué método hay detrás y que quien decide es una persona. */
export function AiTag({ kind }: { kind: AiKind }) {
  return (
    <span title={`${KIND_HELP[kind]} Sugiere; una persona acepta o descarta.`} className="inline-flex items-center gap-1 text-[10px] font-black rounded-full px-2.5 py-1 bg-[#DDCBF5] text-black cursor-help">
      <span aria-hidden="true">✦</span> Asistente · {kind}
    </span>
  );
}

/** Ajustes de demanda sugeridos cuando el pronóstico se equivoca siempre hacia el mismo lado. */
export function NudgesCard() {
  const { dataset, demandNudges, acceptNudge, dismissNudge, can, weeks } = useRamoPlan();
  const { user } = useAuth();
  const name = (id: string) => dataset.skus.find((s) => s.id === id)?.name.replace(' (sint.)', '') ?? id;
  if (demandNudges.length === 0) return null;
  return (
    <Card
      title="Ajustes sugeridos por el modelo"
      hint="Estos productos llevan semanas con el pronóstico equivocado siempre hacia el mismo lado. Si aceptas, se registra como building block con tu nombre y la evidencia como motivo."
      action={<AiTag kind="Estadística" />}
    >
      <ul className="space-y-3">
        {demandNudges.map((n) => (
          <li key={n.skuId} className="rounded-2xl bg-white/60 border border-white/80 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-black">{name(n.skuId)}</span>
                <span className={`text-[10px] font-black rounded-full px-2 py-0.5 text-black ${n.confidence === 'ALTA' ? 'bg-[#7AFFA1]' : 'bg-[#FFF87C]'}`}>Confianza {n.confidence.toLowerCase()}</span>
              </div>
              <div className="text-xs font-mono">
                <span className="font-extrabold">{n.weeklyDelta > 0 ? '+' : ''}{fmtInt(n.weeklyDelta)}</span> cajas por semana
                <span className="text-slate-500"> · {fmtInt(n.weeklyDelta * weeks.length)} en {weeks.length} sem.</span>
              </div>
            </div>
            <p className="text-[11px] text-slate-600 mt-1">{n.evidence}</p>
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => acceptNudge(n, user?.name ?? 'Planeador Demanda')}
                disabled={!can('demand.edit')}
                title={can('demand.edit') ? undefined : 'Tu rol no puede registrar building blocks'}
                className="px-3.5 py-1.5 text-[11px] font-bold text-white bg-slate-950 rounded-full disabled:opacity-40 cursor-pointer"
              >
                Aceptar como building block
              </button>
              <button onClick={() => dismissNudge(n.skuId)} className="px-3.5 py-1.5 text-[11px] font-bold bg-white/80 border border-black/10 rounded-full cursor-pointer">Descartar</button>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Optimizador de capacidad: qué adelantar y cuántas horas extra quedan. La misma sugerencia se aplica por partes según el rol. */
export function RebalanceCard({ view }: { view: 'capacity' | 'mps' }) {
  const { dataset, rebalanceMiguel, rebalanceDaniel, applyRebalanceMoves, applyRebalanceExtra, stage, can } = useRamoPlan();
  const { user } = useAuth();
  const plan = view === 'capacity' ? rebalanceMiguel : rebalanceDaniel;
  if (!plan) return null;
  const sku = (id: string) => dataset.skus.find((s) => s.id === id)?.name.replace(' (sint.)', '') ?? id;
  const crew = (id: string) => dataset.crews.find((c) => c.id === id)?.name.replace('Tripulación ', '') ?? id;
  const author = user?.name ?? (view === 'capacity' ? 'Producción' : 'Distribución');
  const stageIdx = CYCLE_ORDER.indexOf(stage);

  if (plan.overloaded === 0) {
    return (
      <Card title="Optimizador de capacidad" action={<AiTag kind="Optimización" />}>
        <p className="text-xs text-emerald-800 font-bold">No hay semanas sobre capacidad: no hay nada que rebalancear.</p>
      </Card>
    );
  }

  const canMoves = stage === 'SENT_TO_MPS' && can('mps.edit');
  const canExtra = (stage === 'DRAFT' || stage === 'FINAL_ALERTS') && can('capacity.edit');
  const movesReason = !can('mps.edit') ? 'Tu rol no puede ajustar el MPS.' : stage !== 'SENT_TO_MPS' ? (stageIdx < 1 ? 'Los movimientos los aplica Distribución cuando Producción le envía el plan.' : 'El MPS ya está cerrado.') : '';
  const extraReason = !can('capacity.edit') ? 'Tu rol no puede decidir horas extra.' : stage === 'DRAFT' || stage === 'FINAL_ALERTS' ? '' : 'El plan está en manos de Distribución.';

  const grouped = plan.moves.reduce<Record<string, { skuId: string; from: string; to: string; qty: number; hours: number }>>((acc, m) => {
    const k = `${m.skuId}|${m.fromWeek}|${m.toWeek}`;
    acc[k] = acc[k] ? { ...acc[k], qty: acc[k].qty + m.qty, hours: acc[k].hours + m.hours } : { skuId: m.skuId, from: m.fromWeek, to: m.toWeek, qty: m.qty, hours: m.hours };
    return acc;
  }, {});
  const list = Object.values(grouped);

  return (
    <Card
      title="Optimizador de capacidad"
      hint="Antes de pagar horas extra, intenta adelantar producción a semanas anteriores con holgura (la semana más cercana primero, sin tocar lo que es bajo pedido). Es una sugerencia: se revisa y se aplica por partes."
      action={<AiTag kind="Optimización" />}
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3 text-xs">
        {[
          ['Tripulación-semana sobre capacidad', String(plan.overloaded)],
          ['Horas que faltan', fmtDec(plan.excessBefore, 1)],
          ['Se resuelven adelantando', `${fmtDec(plan.movedHours, 1)} h`],
          ['Quedan como horas extra', `${fmtDec(plan.extraTotal, 1)} h`],
        ].map(([k, v]) => (
          <div key={k} className="rounded-xl bg-white/60 border border-white/80 px-3 py-2">
            <div className="text-[10px] uppercase font-bold text-slate-500">{k}</div>
            <div className="font-mono font-black text-lg">{v}</div>
          </div>
        ))}
      </div>
      <div className="mb-3">
        <ProgressBar value={plan.movedHours} max={Math.max(plan.excessBefore, 0.1)} color={SERIES_COLORS[2]} height={10} />
        <p className="text-[10px] text-slate-500 mt-1">La barra es la parte de las horas faltantes que se resuelve sin horas extra.</p>
      </div>

      {list.length > 0 && (
        <div className="mb-3">
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Adelantar producción ({list.length} movimiento{list.length > 1 ? 's' : ''}) · lo aplica Distribución en el MPS</div>
          <ul className="text-xs space-y-1">
            {list.slice(0, 6).map((m) => (
              <li key={`${m.skuId}${m.from}${m.to}`} className="flex flex-wrap items-center gap-x-2">
                <span className="font-bold">{sku(m.skuId)}</span>
                <span className="font-mono">{fmtInt(m.qty)} cajas</span>
                <span className="text-slate-500">de la semana del {weekLabel(m.from)} a la del {weekLabel(m.to)} ({fmtDec(m.hours, 1)} h)</span>
              </li>
            ))}
            {list.length > 6 && <li className="text-slate-500">… y {list.length - 6} movimiento(s) más</li>}
          </ul>
          {view === 'mps' && (
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <button onClick={() => applyRebalanceMoves(plan, author)} disabled={!canMoves} className="px-4 py-2 text-xs font-bold text-white bg-slate-950 rounded-full disabled:opacity-40 cursor-pointer">Aplicar los movimientos como ajustes al MPS</button>
              {!canMoves && <span className="text-[11px] text-slate-500">{movesReason}</span>}
            </div>
          )}
        </div>
      )}

      {plan.extraHours.length > 0 && (
        <div>
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Horas extra para lo que no se pueda adelantar · lo decide Producción</div>
          <div className="flex flex-wrap gap-2">
            {plan.extraHours.map((e) => (
              <span key={`${e.crewId}${e.weekStart}`} className="text-[11px] font-bold rounded-full px-2.5 py-1 bg-[#FFF87C] text-black">{crew(e.crewId)} · {weekLabel(e.weekStart)} · {fmtDec(e.hours, 1)} h</span>
            ))}
          </div>
          {view === 'capacity' && (
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <button onClick={() => applyRebalanceExtra(plan, author)} disabled={!canExtra} className="px-4 py-2 text-xs font-bold text-white bg-slate-950 rounded-full disabled:opacity-40 cursor-pointer">Registrar estas horas extra</button>
              {!canExtra && <span className="text-[11px] text-slate-500">{extraReason}</span>}
            </div>
          )}
        </div>
      )}
      <p className="text-[10px] text-slate-500 mt-3">Heurística voraz, no un óptimo matemático: no considera el costo de la hora extra frente al de mantener más inventario, ni la canasta o la rotación..</p>
    </Card>
  );
}

/** Riesgo de quiebre por punto de la red (probabilidad), para el DRP. */
export function StockoutRiskCard({ onPick }: { onPick?: (nodeId: string, skuId: string) => void }) {
  const { dataset, stockoutRiskList } = useRamoPlan();
  const nodeName = (id: string) => dataset.nodes?.find((n) => n.id === id)?.name.replace(' (sint.)', '') ?? id;
  const skuName = (id: string) => dataset.skus.find((s) => s.id === id)?.name.replace(' (sint.)', '') ?? id;
  const top = stockoutRiskList.filter((r) => r.probability >= 0.1).slice(0, 6);
  return (
    <Card
      title="Riesgo de quiebre en el plazo de entrega"
      hint="Probabilidad de que la demanda supere el inventario antes de que pueda llegar una nueva reposición, usando la incertidumbre real del pronóstico. Complementa a las alertas, que solo miran el caso esperado."
      action={<AiTag kind="Estadística" />}
    >
      {stockoutRiskList.length === 0 ? (
        <p className="text-xs text-slate-500">Se calcula cuando hay pronóstico con histórico suficiente.</p>
      ) : top.length === 0 ? (
        <p className="text-xs text-emerald-800 font-bold">Ningún punto supera el 10 % de riesgo de quiebre.</p>
      ) : (
        <ul className="space-y-1">
          {top.map((r) => (
            <li key={`${r.nodeId}${r.skuId}`}>
              <button
                onClick={() => onPick?.(r.nodeId, r.skuId)}
                disabled={!onPick}
                title={onPick ? 'Ver el inventario de este producto en este punto' : undefined}
                className={`w-full text-left grid grid-cols-[1.4fr_2fr_auto] items-center gap-3 text-xs rounded-xl px-2 py-1 ${onPick ? 'hover:bg-white/70 cursor-pointer' : ''}`}
              >
                <div className="min-w-0">
                  <div className="font-bold truncate">{nodeName(r.nodeId)}</div>
                  <div className="text-[10px] text-slate-500 truncate">{skuName(r.skuId)} · sem. {weekLabel(r.weekStart)}</div>
                </div>
                <ProgressBar value={r.probability} max={1} color={r.probability >= 0.5 ? '#FFA27D' : '#FFF87C'} height={10} />
                <span className="font-mono font-extrabold w-12 text-right">{fmtDec(r.probability * 100, 0)} %</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[10px] text-slate-500 mt-2">Supone errores normales e independientes entre semanas y que el inventario por punto es el supuesto de ejemplo. Aproximación, no un modelo exacto.</p>
    </Card>
  );
}

/** Dónde ayuda hoy la IA/ML en el plan y qué falta para el siguiente paso. */
export function AiMapPanel() {
  const rows: { area: string; what: string; method: AiKind | 'Pendiente'; state: 'Activo' | 'Necesita datos' | 'Necesita autorización'; need?: string }[] = [
    { area: 'Demanda', what: 'Pronóstico con 4 modelos, selección por backtest e intervalos p10–p90', method: 'Estadística', state: 'Activo' },
    { area: 'Demanda', what: 'Ajustes sugeridos cuando el pronóstico se equivoca siempre hacia el mismo lado', method: 'Estadística', state: 'Activo' },
    { area: 'Distribución', what: 'Stock de seguridad dinámico y probabilidad de quiebre por punto', method: 'Estadística', state: 'Activo' },
    { area: 'MPS / Capacidad', what: 'Optimizador: adelantar producción antes de pagar horas extra', method: 'Optimización', state: 'Activo' },
    { area: 'Materiales', what: 'Simulación del riesgo de quedarse sin material con retrasos reales del proveedor', method: 'Simulación', state: 'Activo' },
    { area: 'Compras', what: 'Cantidades, plazos dinámicos, cuota, anomalías y consolidación', method: 'Estadística', state: 'Activo' },
    { area: 'Demanda', what: 'Pronóstico con promociones, festivos y precio (modelo con variables externas)', method: 'Pendiente', state: 'Necesita datos', need: 'Calendario de promociones y precios históricos (área de Demanda)' },
    { area: 'Demanda', what: 'Corregir ventas por quiebres (demanda no vendida por falta de producto)', method: 'Pendiente', state: 'Necesita datos', need: 'Inventario o quiebres históricos por producto' },
    { area: 'Capacidad', what: 'Ritmo real de línea y paradas no planeadas (en vez del ritmo estándar)', method: 'Pendiente', state: 'Necesita datos', need: 'Producción real por hora y registro de paradas (área de Producción)' },
    { area: 'Materiales', what: 'Rendimiento y merma reales de la lista de materiales', method: 'Pendiente', state: 'Necesita datos', need: 'Consumo real de materiales por orden de producción' },
    { area: 'Compras', what: 'Riesgo de incumplimiento por proveedor (modelo de clasificación)', method: 'Pendiente', state: 'Necesita datos', need: 'Más historial por proveedor y causas de retraso' },
    { area: 'Todas', what: 'Explicar el plan en lenguaje natural y redactar correos a proveedores', method: 'Pendiente', state: 'Necesita autorización', need: 'Decisión de Ramo sobre usar un modelo de lenguaje' },
  ];
  const chip = { Activo: 'bg-[#7AFFA1]', 'Necesita datos': 'bg-[#FFF87C]', 'Necesita autorización': 'bg-[#DDCBF5]' } as const;
  return (
    <Card
      title="Dónde ayuda la IA y el ML"
      hint="Todo lo activo es estadística, optimización o simulación explicable: sugiere, muestra su evidencia y una persona decide. Lo pendiente depende de datos o de una autorización."
    >
      <ul className="divide-y divide-black/5">
        {rows.map((r) => (
          <li key={r.what} className="py-2 grid grid-cols-1 md:grid-cols-[110px_1fr_auto] gap-1 md:gap-3 items-start text-xs">
            <span className="font-black">{r.area}</span>
            <span>
              {r.what}
              {r.need && <span className="block text-[10px] text-slate-500">Falta: {r.need}</span>}
            </span>
            <span className="flex items-center gap-1.5">
              {r.method !== 'Pendiente' && <span className="text-[10px] text-slate-500">{r.method}</span>}
              <span className={`text-[10px] font-black rounded-full px-2 py-0.5 text-black ${chip[r.state]}`}>{r.state}</span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Resumen escrito de la semana, armado con reglas sobre las cifras calculadas (listo para que un modelo de lenguaje lo redacte si Ramo lo autoriza). */
export function BriefingCard() {
  const { dataset, danielView, drp, supplyRisk, supplySim, rebalanceDaniel, stockoutRiskList, demandNudges, pendingRecommendations, baseline } = useRamoPlan();
  const mat = (id: string) => dataset.materials?.find((m) => m.id === id)?.name.replace(' (sint.)', '') ?? id;
  const sku = (id: string) => dataset.skus.find((s) => s.id === id)?.name.replace(' (sint.)', '') ?? id;
  const crew = (id: string) => dataset.crews.find((c) => c.id === id)?.name.replace('Tripulación ', '') ?? id;
  const lines: string[] = [];

  const alerts = danielView.alerts;
  if (alerts.length === 0) lines.push('La capacidad alcanza en todo el horizonte con las horas extra decididas.');
  else {
    const worst = [...alerts].sort((a, b) => b.excessHours - a.excessHours)[0];
    lines.push(`Hay ${alerts.length} combinación(es) tripulación-semana con capacidad insuficiente; la peor es ${crew(worst.crewId)} la semana del ${weekLabel(worst.weekStart)} (faltan ${fmtDec(worst.excessHours, 1)} h).`);
    if (rebalanceDaniel && rebalanceDaniel.movedHours > 0) lines.push(`El optimizador resolvería ${fmtDec(rebalanceDaniel.movedHours, 1)} h adelantando producción y dejaría ${fmtDec(rebalanceDaniel.extraTotal, 1)} h como horas extra.`);
  }
  const stockouts = drp?.alerts.filter((a) => a.code === 'STOCKOUT') ?? [];
  if (stockouts.length > 0) lines.push(`El DRP proyecta ${stockouts.length} quiebre(s) en la red; el primero es ${sku(stockouts[0].skuId ?? '')} en la semana del ${weekLabel(stockouts[0].weekStart)}.`);
  const risky = stockoutRiskList.filter((r) => r.probability >= 0.3 && r.projected >= 0);
  if (risky.length > 0) lines.push(`Aunque el caso esperado no falle, ${risky.length} combinación(es) punto-producto tienen 30 % o más de probabilidad de quedarse sin inventario antes de la próxima reposición.`);
  const danger = supplySim.filter((s) => s.pRuptureBeforeArrival >= 0.5);
  if (danger.length > 0) {
    const names = danger.slice(0, 3).map((s) => `${mat(s.materialId)} (${fmtDec(s.pRuptureBeforeArrival * 100, 0)} %)`).join(', ');
    lines.push(`${danger.length} material(es) tienen 50 % o más de probabilidad de acabarse antes de que llegue un pedido hecho hoy: ${names}${danger.length > 3 ? '…' : ''}.`);
  } else if (supplyRisk) lines.push('Ningún material supera el 50 % de probabilidad de acabarse antes de que llegue un pedido hecho hoy.');
  if (demandNudges.length > 0) lines.push(`${demandNudges.length} producto(s) tienen el pronóstico sesgado de forma sistemática; hay ajustes de demanda sugeridos para revisar.`);
  if (pendingRecommendations.length > 0) lines.push(`Hay ${pendingRecommendations.length} recomendación(es) de compras por decidir (${pendingRecommendations.filter((r) => r.urgency === 'CRITICAL').length} críticas).`);
  if (!baseline?.usable) lines.push('Recuerda que el inventario es el de ejemplo: carga las bases SAP del lunes para que estas cifras sean reales.');

  return (
    <Card title="Resumen de la semana" hint="Escrito automáticamente con reglas sobre las cifras de arriba; cada frase sale de un cálculo, no de una opinión." action={<AiTag kind="Reglas" />}>
      <ul className="space-y-2 text-[13px] text-slate-800">
        {lines.map((l, i) => (
          <li key={i} className="flex gap-2"><span className="text-slate-400">•</span><span>{l}</span></li>
        ))}
      </ul>
    </Card>
  );
}

