import { DemandHistoryRow, RamoDataset } from '@ramo/domain';
import {
  AdjustedOrder, ConsolidatedOrder, DemandSpike, LeadTimeRecommendation, OrderAnomaly, QuotaCompliance, QuotaException, SupplierPerformance, Urgency,
  adjustOrderForVariability, consolidateOrders, detectDemandSpikes, detectOrderAnomalies, materialWeeklySigma, quotaCompliance, quotaExceptions,
  recommendLeadTimes, supplierPerformance, urgencyOf,
} from './insights';
import { NetPlanRow } from './mps';
import { MaterialRisk, SupplyRiskResult, runSupplyRisk, splitByQuota } from './supplyRisk';

/**
 * Capa de recomendaciones sobre la salida del MRP. Cada recomendación trae su "por qué" (las cifras que la sustentan) y una acción
 * propuesta; ninguna se ejecuta sola: el planeador la aprueba, la modifica o la rechaza con justificación (ver el estado de la web).
 * Los cálculos son estadística y reglas determinísticas; no se usa ningún modelo de lenguaje.
 */
export type RecKind = 'ORDER' | 'LEAD_TIME' | 'QUOTA' | 'ANOMALY' | 'CONSOLIDATION';

export type RecAction =
  | { type: 'PLACE_ORDER'; materialId: string; qty: number; split: { supplier: string; qty: number }[] }
  | { type: 'ADVANCE_ORDER'; materialId: string; supplier: string; dueDate: string }
  | { type: 'SET_LEAD_TIME'; materialId: string; days: number }
  | { type: 'QUOTA_EXCEPTION'; materialId: string; supplier: string; qty: number }
  | { type: 'CONSOLIDATE'; supplier: string; orderDate: string; lines: { materialId: string; qty: number }[] }
  | { type: 'REVIEW'; ref: string };

export interface Recommendation {
  id: string;
  kind: RecKind;
  urgency: Urgency;
  title: string;
  /** Las cifras que sustentan la recomendación, una por línea. */
  why: string[];
  materialId?: string;
  action: RecAction;
  /** Qué cambia si se aprueba (cuando se puede calcular). */
  impact?: string;
}

export interface InsightsInput {
  /** Dataset con los plazos vigentes (incluye los ajustes ya aprobados). */
  ds: RamoDataset;
  net: NetPlanRow[];
  risk: SupplyRiskResult;
  /** σ semanal del error de pronóstico por SKU (cajas); base del ajuste por variabilidad. */
  sigmaBySku?: Record<string, number>;
  demandHistory?: DemandHistoryRow[];
  today: string;
  /** Ventana (días) para juntar pedidos al mismo proveedor; por defecto 7 (ciclo semanal de compras). */
  consolidationDays?: number;
}

export interface InsightsResult {
  recommendations: Recommendation[];
  leadTimes: LeadTimeRecommendation[];
  performance: SupplierPerformance[];
  quota: QuotaCompliance[];
  quotaExceptions: QuotaException[];
  anomalies: OrderAnomaly[];
  spikes: DemandSpike[];
  consolidated: ConsolidatedOrder[];
  adjusted: Map<string, AdjustedOrder>;
}

const URGENCY_ORDER: Record<Urgency, number> = { CRITICAL: 0, NORMAL: 1, WAIT: 2 };
const KIND_ORDER: Record<RecKind, number> = { ORDER: 0, QUOTA: 1, LEAD_TIME: 2, CONSOLIDATION: 3, ANOMALY: 4 };
const fmt = (n: number) => Math.round(n).toLocaleString('es-CO');
const pct = (n: number) => `${Math.round(n * 100)} %`;
const STATUS_LABEL = { CRITICAL: 'ruptura dentro del plazo', ORDER: 'pedir ya', WATCH: 'vigilar', OK: 'sin riesgo cercano' } as const;

/** Copia del dataset con los plazos de entrega reemplazados (plazos dinámicos aprobados). */
export function withLeadTimes(ds: RamoDataset, overrides: Record<string, number>): RamoDataset {
  if (Object.keys(overrides).length === 0) return ds;
  return { ...ds, materials: (ds.materials ?? []).map((m) => (overrides[m.id] !== undefined ? { ...m, leadTimeDays: overrides[m.id] } : m)) };
}

export function buildInsights(input: InsightsInput): InsightsResult {
  const { ds, net, risk, today } = input;
  const materials = ds.materials ?? [];
  const history = ds.orderHistory ?? [];
  const name = (id: string) => materials.find((m) => m.id === id)?.name ?? id;
  const unit = (id: string) => materials.find((m) => m.id === id)?.unit ?? '';
  const skuName = (id: string) => ds.skus.find((s) => s.id === id)?.name ?? id;

  const sigma = input.sigmaBySku ? materialWeeklySigma(risk.explosion, input.sigmaBySku) : new Map<string, number>();
  const leadTimes = recommendLeadTimes(materials, history);
  const performance = supplierPerformance(history);
  const quota = quotaCompliance(materials, history);
  const exceptions = quotaExceptions(materials, risk.risks, history);
  const anomalies = detectOrderAnomalies(ds);
  const spikes = input.demandHistory ? detectDemandSpikes(input.demandHistory) : [];
  const consolidated = consolidateOrders(risk.risks, today, input.consolidationDays);
  const adjusted = new Map<string, AdjustedOrder>();
  const recs: Recommendation[] = [];

  // ----- Pedidos (con ajuste por variabilidad) y órdenes tardías por adelantar
  for (const r of risk.risks) {
    const m = materials.find((x) => x.id === r.materialId)!;
    const urgency = urgencyOf(r);
    const why: string[] = [];
    if (r.ruptureDate) why.push(`Se rompe el ${r.ruptureDate} (en ${r.daysToRupture} días); plazo de entrega planeado: ${r.leadTimeDays} días.`);
    else why.push(`Cae por debajo del colchón de seguridad (${m.safetyDays} días de consumo).`);
    if (urgency === 'CRITICAL') why.push('Menos de 5 días hasta la ruptura: es la prioridad más alta.');

    if (r.suggestion) {
      const covered = Math.min(risk.dates.length, r.leadTimeDays + 14);
      const adj = adjustOrderForVariability(r.suggestion, m.moq, sigma.get(m.id), covered);
      adjusted.set(m.id, adj);
      const split = splitByQuota(adj.qty, m.moq, m.suppliers);
      why.push(`Cantidad base ${fmt(adj.baseQty)} ${m.unit}: cubre plazo + 14 días + colchón, descontando inventario y órdenes abiertas.`);
      if (adj.buffer > 0) why.push(`+${fmt(adj.buffer)} ${m.unit} por variabilidad de la demanda (σ semanal del consumo ${fmt(sigma.get(m.id) ?? 0)} ${m.unit}, confianza 95 %) → total ${fmt(adj.qty)} ${m.unit}.`);
      else why.push('Sin ajuste por variabilidad: no hay σ del pronóstico disponible para este material.');
      if (m.suppliers.length > 1) why.push(`Reparto por cuota reguladora: ${split.map((s) => `${s.supplier} ${fmt(s.qty)} (${pct(s.share)})`).join(' · ')}.`);
      recs.push({
        id: `ORDER|${m.id}`, kind: 'ORDER', urgency, materialId: m.id,
        title: `Pedir ${name(m.id)}: ${fmt(adj.qty)} ${m.unit}`, why,
        action: { type: 'PLACE_ORDER', materialId: m.id, qty: adj.qty, split: split.map((s) => ({ supplier: s.supplier, qty: s.qty })) },
        impact: r.orderByDate ? `Pedir antes de ${r.orderByDate.startsWith('antes') ? 'hoy (la fecha límite ya pasó)' : r.orderByDate}.` : undefined,
      });
    }
    if (r.lateOrder) {
      recs.push({
        id: `ORDER_ADV|${m.id}`, kind: 'ORDER', urgency: urgency === 'WAIT' ? 'NORMAL' : urgency, materialId: m.id,
        title: `Adelantar la orden de ${name(m.id)} (${r.lateOrder.supplier})`,
        why: [
          `La orden abierta de ${fmt(r.lateOrder.qty)} ${m.unit} llega el ${r.lateOrder.dueDate}, ${r.lateOrder.daysAfterRupture} día(s) después de la ruptura (${r.ruptureDate}).`,
          'Un pedido nuevo no llega antes: lo que resuelve es acordar una entrega anterior con el proveedor.',
        ],
        action: { type: 'ADVANCE_ORDER', materialId: m.id, supplier: r.lateOrder.supplier, dueDate: r.ruptureDate ?? r.lateOrder.dueDate },
      });
    }
  }

  // ----- Plazos dinámicos (con el efecto en el riesgo)
  for (const lt of leadTimes) {
    const before = risk.risks.find((x) => x.materialId === lt.materialId);
    const after = runSupplyRisk(withLeadTimes(ds, { [lt.materialId]: lt.proposedDays }), net).risks.find((x) => x.materialId === lt.materialId);
    const worse = lt.direction === 'INCREASE' && after?.status === 'CRITICAL' && before?.status !== 'CRITICAL';
    const why = [
      `${lt.n} órdenes recibidas: el plazo real es P50 ${lt.p50} y P80 ${lt.proposedDays} días frente a ${lt.currentDays} fijos en SAP.`,
      `Puntualidad: ${pct(lt.onTimeRate)} de las órdenes llegó a tiempo; retraso medio ${lt.meanDelay.toFixed(1)} días.`,
      ...lt.bySupplier.map((s) => `${s.supplier}: ${s.n} órdenes, P80 ${s.p80} días, ${pct(s.onTimeRate)} puntual.`),
      'Pendiente definir cómo se resincroniza el dato maestro de SAP: si no se recarga, el MRP sigue planificando con el valor fijo.',
    ];
    recs.push({
      id: `LEAD_TIME|${lt.materialId}`, kind: 'LEAD_TIME', urgency: worse ? 'CRITICAL' : 'NORMAL', materialId: lt.materialId,
      title: `${lt.direction === 'INCREASE' ? 'Subir' : 'Bajar'} el plazo de ${name(lt.materialId)}: ${lt.currentDays} → ${lt.proposedDays} días`, why,
      action: { type: 'SET_LEAD_TIME', materialId: lt.materialId, days: lt.proposedDays },
      impact: before && after && before.status !== after.status ? `Con el plazo real el estado pasa de «${STATUS_LABEL[before.status]}» a «${STATUS_LABEL[after.status]}».` : before ? `El estado se mantiene en «${STATUS_LABEL[before.status]}».` : undefined,
    });
  }

  // ----- Cuota reguladora: rota en el historial y excepciones por riesgo de plazo
  for (const q of quota.filter((x) => x.broken)) {
    const over = [...q.rows].sort((a, b) => b.deviationPp - a.deviationPp)[0];
    const under = [...q.rows].sort((a, b) => a.deviationPp - b.deviationPp)[0];
    const perf = (s: string) => performance.find((p) => p.supplier === s);
    const why = [
      `Negociado: ${q.rows.map((r) => `${r.supplier} ${pct(r.quota)}`).join(' / ')}. Real en los últimos ${q.windowDays} días (${q.orders} órdenes): ${q.rows.map((r) => `${r.supplier} ${pct(r.actual)}`).join(' / ')}.`,
      `${over.supplier} recibe ${Math.round(over.deviationPp)} puntos más de lo acordado y ${under.supplier} ${Math.round(Math.abs(under.deviationPp))} menos: probablemente ajustes manuales que no quedaron trazados.`,
    ];
    if (perf(over.supplier) && perf(under.supplier)) why.push(`Puntualidad: ${over.supplier} ${pct(perf(over.supplier)!.onTimeRate)} vs ${under.supplier} ${pct(perf(under.supplier)!.onTimeRate)}.`);
    recs.push({ id: `QUOTA|${q.materialId}`, kind: 'QUOTA', urgency: 'NORMAL', materialId: q.materialId, title: `Cuota rota en ${name(q.materialId)}: ${Math.round(q.maxDeviationPp)} puntos de desviación`, why, action: { type: 'REVIEW', ref: q.materialId } });
  }
  for (const e of exceptions) {
    const r = risk.risks.find((x) => x.materialId === e.materialId)!;
    recs.push({
      id: `QUOTA_EXC|${e.materialId}`, kind: 'QUOTA', urgency: urgencyOf(r), materialId: e.materialId,
      title: `Excepción a la cuota: pedir ${name(e.materialId)} a ${e.fastSupplier}`,
      why: [
        `Se rompe en ${e.daysToRupture} días. ${e.mainSupplier} (mayor cuota) tarda P80 ${e.mainP80} días y no llega a tiempo; ${e.fastSupplier} tarda P80 ${e.fastP80}.`,
        'La cuota se respeta salvo riesgo de plazo: esta es la excepción, justificada y trazable. El resto de los pedidos sigue la cuota negociada.',
      ],
      action: { type: 'QUOTA_EXCEPTION', materialId: e.materialId, supplier: e.fastSupplier, qty: e.qty },
    });
  }

  // ----- Anomalías
  for (const a of anomalies) {
    recs.push({
      id: `ANOMALY|${a.kind}|${a.ref}`, kind: 'ANOMALY', urgency: 'NORMAL', materialId: a.materialId,
      title: a.kind === 'DUPLICATE_REQUISITION' ? `Posible duplicado: ${a.ref} de ${name(a.materialId)} vs orden abierta` : `Cantidad atípica en ${a.ref}: ${name(a.materialId)}`,
      why: [a.detail, a.kind === 'DUPLICATE_REQUISITION' ? 'Si ambas se ejecutan se compraría el doble.' : `Cantidad ${fmt(a.qty)} ${unit(a.materialId)}; revisar si es un error de captura.`],
      action: { type: 'REVIEW', ref: a.ref },
    });
  }
  for (const s of spikes) {
    recs.push({
      id: `ANOMALY|SPIKE|${s.skuId}|${s.weekStart}`, kind: 'ANOMALY', urgency: 'WAIT',
      title: `Venta atípica: ${skuName(s.skuId)} semana del ${s.weekStart}`,
      why: [`Vendió ${fmt(s.value)} cajas frente a ~${fmt(s.expected)} esperadas (${s.ratio.toFixed(2)}×).`, 'Puede ser promoción, quiebre o error de captura; si no se explica, contamina el pronóstico de las próximas semanas.'],
      action: { type: 'REVIEW', ref: `${s.skuId}|${s.weekStart}` },
    });
  }

  // ----- Consolidación
  for (const c of consolidated) {
    recs.push({
      id: `CONS|${c.supplier}|${c.orderDate}`, kind: 'CONSOLIDATION', urgency: 'NORMAL',
      title: `Consolidar ${c.ordersBefore} pedidos a ${c.supplier} el ${c.orderDate}`,
      why: [...c.lines.map((l) => `${name(l.materialId)}: ${fmt(l.qty)} ${unit(l.materialId)} (pedir antes de ${l.orderBy}).`), `${c.ordersBefore} pedidos separados pasan a 1: menos órdenes, un solo despacho.`],
      action: { type: 'CONSOLIDATE', supplier: c.supplier, orderDate: c.orderDate, lines: c.lines.map((l) => ({ materialId: l.materialId, qty: l.qty })) },
    });
  }

  recs.sort((a, b) => URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency] || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.title.localeCompare(b.title));
  return { recommendations: recs, leadTimes, performance, quota, quotaExceptions: exceptions, anomalies, spikes, consolidated, adjusted };
}

// ---------------------------------------------------------------------------------------------- copiloto de preguntas guiadas
export interface CopilotAnswer {
  topic: string;
  lines: string[];
}

export const SUGGESTED_QUESTIONS = [
  '¿Qué materiales son críticos?',
  '¿Qué debo pedir esta semana?',
  '¿Qué proveedores llegan tarde?',
  '¿Qué cuotas están rotas?',
  '¿Qué anomalías hay?',
  '¿Qué pedidos se pueden consolidar?',
];

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const has = (q: string, re: RegExp) => re.test(q);

/**
 * Responde preguntas guiadas sobre resultados ya calculados (no genera texto libre): cada respuesta cita las cifras y de dónde salen.
 * Es el punto de conexión de un modelo de lenguaje futuro: bastaría con pasarle estas mismas cifras como contexto verificado.
 */
export function answerQuestion(question: string, ds: RamoDataset, risk: SupplyRiskResult, insights: InsightsResult): CopilotAnswer {
  const q = norm(question);
  const materials = ds.materials ?? [];
  const name = (id: string) => materials.find((m) => m.id === id)?.name ?? id;
  const top = (arr: Recommendation[], n = 6) => arr.slice(0, n).map((r) => `• ${r.title}`);

  // Material mencionado por nombre
  const tokens = (s: string) => norm(s).replace(/\(sint\.\)|·.*/g, '').split(/[^a-z0-9]+/).filter((t) => t.length >= 4);
  const scored = materials
    .filter((m) => m.type !== 'MIX')
    .map((m) => ({ m, hits: tokens(m.name).filter((t) => q.includes(t)).length }))
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits);
  if (scored.length > 0) {
    const m = scored[0].m;
    const r = risk.risks.find((x) => x.materialId === m.id)!;
    const recs = insights.recommendations.filter((x) => x.materialId === m.id);
    const lines = [
      `${m.name}: estado «${STATUS_LABEL[r.status]}». Inventario ${fmt(m.stock)} ${m.unit}, cobertura ${r.coverageDays === null ? '—' : r.coverageDays.toFixed(1)} días, plazo planeado ${m.leadTimeDays} días.`,
      r.ruptureDate ? `Se rompe el ${r.ruptureDate} (en ${r.daysToRupture} días)${r.orderByDate ? `; fecha límite para pedir: ${r.orderByDate}` : ''}.` : 'No se rompe en el horizonte de 13 semanas con el inventario y las órdenes abiertas actuales.',
      ...(recs.length > 0 ? ['Recomendaciones abiertas:', ...recs.flatMap((x) => [`• ${x.title}`, ...x.why.map((w) => `   ${w}`)])] : ['No hay recomendaciones abiertas para este material.']),
    ];
    return { topic: `material:${m.id}`, lines };
  }

  if (has(q, /critic|urgent|rompe|ruptura|riesgo/)) {
    const crit = risk.risks.filter((r) => r.status === 'CRITICAL');
    return { topic: 'critical', lines: crit.length ? [`${crit.length} materiales se rompen antes de que llegue un pedido hecho hoy:`, ...crit.map((r) => `• ${name(r.materialId)}: ruptura el ${r.ruptureDate}, plazo ${r.leadTimeDays} días${r.lateOrder ? ` (hay una orden que llega ${r.lateOrder.daysAfterRupture} días tarde)` : ''}.`)] : ['Ningún material se rompe dentro de su plazo de entrega.'] };
  }
  if (has(q, /consolid|junt/)) {
    return { topic: 'consolidation', lines: insights.consolidated.length ? insights.consolidated.map((c) => `• ${c.supplier} el ${c.orderDate}: ${c.lines.map((l) => name(l.materialId)).join(', ')} (${c.ordersBefore} pedidos → 1).`) : ['No hay pedidos del mismo proveedor que caigan en la misma ventana.'] };
  }
  if (has(q, /cuota/)) {
    const broken = insights.quota.filter((x) => x.broken);
    return { topic: 'quota', lines: broken.length ? broken.map((x) => `• ${name(x.materialId)}: negociado ${x.rows.map((r) => `${r.supplier} ${pct(r.quota)}`).join('/')}, real ${x.rows.map((r) => `${r.supplier} ${pct(r.actual)}`).join('/')} (${x.orders} órdenes).`) : ['Las cuotas se están respetando dentro del umbral.'] };
  }
  if (has(q, /proveedor|puntual|tarde|incumpl|retras/)) {
    return { topic: 'suppliers', lines: ['Puntualidad de entrega por proveedor (de menos a más):', ...insights.performance.slice(0, 8).map((p) => `• ${p.supplier}: ${pct(p.onTimeRate)} a tiempo, retraso medio ${p.meanDelayDays.toFixed(1)} días (${p.n} órdenes).`)] };
  }
  if (has(q, /plazo|lead/)) {
    return { topic: 'lead_time', lines: insights.leadTimes.length ? insights.leadTimes.map((l) => `• ${name(l.materialId)}: ${l.currentDays} → ${l.proposedDays} días (P80 de ${l.n} órdenes, ${pct(l.onTimeRate)} puntual).`) : ['Los plazos fijos de SAP coinciden con los reales.'] };
  }
  if (has(q, /anomal|duplic|atipic|raro|outlier|error/)) {
    const lines = [...insights.anomalies.map((a) => `• ${a.ref} (${name(a.materialId)}): ${a.detail}`), ...insights.spikes.slice(0, 5).map((s) => `• Venta atípica de ${ds.skus.find((x) => x.id === s.skuId)?.name ?? s.skuId} la semana del ${s.weekStart}: ${fmt(s.value)} vs ~${fmt(s.expected)}.`)];
    return { topic: 'anomalies', lines: lines.length ? lines : ['No se detectaron anomalías.'] };
  }
  if (has(q, /pedir|comprar|orden|ordenar|que debo|esta semana/)) {
    const orders = insights.recommendations.filter((r) => r.kind === 'ORDER');
    return { topic: 'orders', lines: orders.length ? [`${orders.length} pedidos u órdenes por mover, de más a menos urgente:`, ...top(orders, 8)] : ['No hay pedidos que hacer con el inventario y las órdenes abiertas actuales.'] };
  }
  const n = insights.recommendations.length;
  const crit = insights.recommendations.filter((r) => r.urgency === 'CRITICAL').length;
  return { topic: 'help', lines: [`Hay ${n} recomendaciones abiertas (${crit} críticas). Puedes preguntar por materiales críticos, qué pedir, proveedores, cuotas, plazos, anomalías o consolidación, o nombrar un material (por ejemplo «cacao»).`, 'Respondo solo con resultados ya calculados: cada cifra viene del tablero de riesgo o del historial de órdenes.'] };
}
