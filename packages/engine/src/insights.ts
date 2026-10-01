import { DemandHistoryRow, Material, OrderHistoryRow, PurchaseOrderLine, PurchaseRequisition, RamoDataset } from '@ramo/domain';
import { Explosion, MaterialRisk, OrderSuggestion } from './supplyRisk';

/**
 * Análisis de la capa de recomendaciones. Todo es estadística y reglas determinísticas (mediana, MAD, percentiles, prorrata):
 * se puede auditar, reproducir y explicar. No hay modelos de lenguaje aquí; los textos "por qué" se arman con las cifras calculadas.
 */

const MS_DAY = 86_400_000;
export const daysBetween = (a: string, b: string): number => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / MS_DAY);
export const addDaysIso = (d: string, n: number): string => new Date(Date.parse(`${d}T00:00:00Z`) + n * MS_DAY).toISOString().slice(0, 10);

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
export function median(a: number[]): number {
  if (a.length === 0) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
/** Desviación absoluta mediana: robusta a valores extremos. */
export function mad(a: number[]): number {
  const m = median(a);
  return median(a.map((x) => Math.abs(x - m)));
}
/** Percentil por rango más cercano (p entre 0 y 1). */
export function percentile(a: number[], p: number): number {
  if (a.length === 0) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))];
}

// ---------------------------------------------------------------------------------------------- plazos reales
export interface SupplierLeadTime {
  materialId: string;
  supplier: string;
  n: number;
  /** Plazo prometido (mediana de fecha prometida − pedido). */
  plannedDays: number;
  p50: number;
  p80: number;
  meanDelay: number;
  onTimeRate: number;
}

const leadStats = (rows: OrderHistoryRow[]) => {
  const actual = rows.map((r) => daysBetween(r.orderDate, r.receivedDate));
  const planned = rows.map((r) => daysBetween(r.orderDate, r.promisedDate));
  const delays = rows.map((r) => daysBetween(r.promisedDate, r.receivedDate));
  return {
    n: rows.length,
    plannedDays: median(planned),
    p50: median(actual),
    p80: percentile(actual, 0.8),
    meanDelay: sum(delays) / (rows.length || 1),
    onTimeRate: rows.filter((r) => r.receivedDate <= r.promisedDate).length / (rows.length || 1),
  };
};

/** Plazo real por material y proveedor frente al prometido. */
export function leadTimeStats(history: OrderHistoryRow[]): SupplierLeadTime[] {
  const groups = new Map<string, OrderHistoryRow[]>();
  for (const h of history) groups.set(`${h.materialId}|${h.supplier}`, [...(groups.get(`${h.materialId}|${h.supplier}`) ?? []), h]);
  return [...groups.entries()]
    .map(([k, rows]) => ({ materialId: k.split('|')[0], supplier: k.split('|')[1], ...leadStats(rows) }))
    .sort((a, b) => a.materialId.localeCompare(b.materialId) || a.supplier.localeCompare(b.supplier));
}

export interface SupplierPerformance {
  supplier: string;
  n: number;
  onTimeRate: number;
  meanDelayDays: number;
  materials: number;
}

export function supplierPerformance(history: OrderHistoryRow[]): SupplierPerformance[] {
  const groups = new Map<string, OrderHistoryRow[]>();
  for (const h of history) groups.set(h.supplier, [...(groups.get(h.supplier) ?? []), h]);
  return [...groups.entries()]
    .map(([supplier, rows]) => ({ supplier, n: rows.length, onTimeRate: leadStats(rows).onTimeRate, meanDelayDays: leadStats(rows).meanDelay, materials: new Set(rows.map((r) => r.materialId)).size }))
    .sort((a, b) => a.onTimeRate - b.onTimeRate || b.meanDelayDays - a.meanDelayDays);
}

export interface LeadTimeRecommendation {
  materialId: string;
  currentDays: number;
  proposedDays: number;
  direction: 'INCREASE' | 'DECREASE';
  n: number;
  p50: number;
  onTimeRate: number;
  meanDelay: number;
  bySupplier: SupplierLeadTime[];
}

export interface LeadTimeOptions {
  minOrders?: number;
  minIncreaseDays?: number;
  minIncreasePct?: number;
}

/**
 * Plazo dinámico: el P80 del plazo real del **proveedor principal** (mayor cuota, porque a él va la mayor parte de los pedidos) frente al
 * fijo de SAP; si el principal no tiene evidencia suficiente se usan todas las órdenes del material. Mezclar proveedores con
 * comportamientos muy distintos daría un número que no describe a ninguno. Se propone subirlo
 * si lo supera en ≥ 2 días y ≥ 10 %; bajarlo solo con mucha evidencia (≥ 12 órdenes, ≤ 70 % del fijo y ≥ 3 días menos).
 */
export function recommendLeadTimes(materials: Material[], history: OrderHistoryRow[], options: LeadTimeOptions = {}): LeadTimeRecommendation[] {
  const minOrders = options.minOrders ?? 8;
  const minDays = options.minIncreaseDays ?? 2;
  const minPct = options.minIncreasePct ?? 0.1;
  const all = leadTimeStats(history);
  const out: LeadTimeRecommendation[] = [];
  for (const m of materials.filter((x) => x.type !== 'MIX')) {
    const ofMaterial = history.filter((h) => h.materialId === m.id);
    const main = [...m.suppliers].sort((a, b) => b.share - a.share)[0]?.supplier;
    const ofMain = ofMaterial.filter((h) => h.supplier === main);
    const rows = ofMain.length >= minOrders ? ofMain : ofMaterial;
    if (rows.length < minOrders) continue;
    const st = leadStats(rows);
    const cur = m.leadTimeDays;
    const direction = st.p80 - cur >= minDays && st.p80 >= cur * (1 + minPct) ? 'INCREASE' : rows.length >= 12 && st.p80 <= cur * 0.7 && cur - st.p80 >= 3 ? 'DECREASE' : null;
    if (direction) out.push({ materialId: m.id, currentDays: cur, proposedDays: st.p80, direction, n: rows.length, p50: st.p50, onTimeRate: st.onTimeRate, meanDelay: st.meanDelay, bySupplier: all.filter((a) => a.materialId === m.id) });
  }
  return out.sort((a, b) => Math.abs(b.proposedDays - b.currentDays) - Math.abs(a.proposedDays - a.currentDays));
}

// ---------------------------------------------------------------------------------------------- cuota reguladora
export interface QuotaCompliance {
  materialId: string;
  windowDays: number;
  orders: number;
  rows: { supplier: string; quota: number; actual: number; deviationPp: number }[];
  maxDeviationPp: number;
  broken: boolean;
}

/** Cuota efectivamente usada (por cantidad) en la ventana frente a la negociada; "rota" si algún proveedor se desvía ≥ `thresholdPp` puntos. */
export function quotaCompliance(materials: Material[], history: OrderHistoryRow[], options: { windowDays?: number; asOf?: string; thresholdPp?: number } = {}): QuotaCompliance[] {
  const windowDays = options.windowDays ?? 365;
  const threshold = options.thresholdPp ?? 10;
  const asOf = options.asOf ?? history.map((h) => h.receivedDate).sort().slice(-1)[0] ?? '1970-01-01';
  const out: QuotaCompliance[] = [];
  for (const m of materials.filter((x) => x.type !== 'MIX' && x.suppliers.length > 1)) {
    const rows = history.filter((h) => h.materialId === m.id && daysBetween(h.orderDate, asOf) <= windowDays);
    if (rows.length === 0) continue;
    const total = sum(rows.map((r) => r.qty));
    const detail = m.suppliers.map((s) => {
      const actual = sum(rows.filter((r) => r.supplier === s.supplier).map((r) => r.qty)) / total;
      return { supplier: s.supplier, quota: s.share, actual, deviationPp: (actual - s.share) * 100 };
    });
    const maxDev = Math.max(...detail.map((d) => Math.abs(d.deviationPp)));
    out.push({ materialId: m.id, windowDays, orders: rows.length, rows: detail, maxDeviationPp: maxDev, broken: maxDev >= threshold });
  }
  return out.sort((a, b) => b.maxDeviationPp - a.maxDeviationPp);
}

export interface QuotaException {
  materialId: string;
  mainSupplier: string;
  fastSupplier: string;
  daysToRupture: number;
  mainP80: number;
  fastP80: number;
  qty: number;
}

/**
 * "Respetar la cuota salvo riesgo de plazo": si el proveedor principal (mayor cuota) no alcanza a llegar antes de la ruptura
 * (según su P80 real) y otro sí, se propone mandar el pedido al más rápido y se explicita la excepción.
 */
export function quotaExceptions(materials: Material[], risks: MaterialRisk[], history: OrderHistoryRow[]): QuotaException[] {
  const stats = leadTimeStats(history);
  const out: QuotaException[] = [];
  for (const r of risks) {
    if (r.status !== 'CRITICAL' && r.status !== 'ORDER') continue;
    if (r.daysToRupture === null || !r.suggestion) continue;
    const m = materials.find((x) => x.id === r.materialId);
    if (!m || m.suppliers.length < 2) continue;
    const p80Of = (supplier: string) => {
      const s = stats.find((x) => x.materialId === m.id && x.supplier === supplier);
      return s && s.n >= 3 ? s.p80 : m.leadTimeDays;
    };
    const main = [...m.suppliers].sort((a, b) => b.share - a.share)[0].supplier;
    const mainP80 = p80Of(main);
    if (mainP80 <= r.daysToRupture) continue;
    const fast = m.suppliers.filter((s) => s.supplier !== main && p80Of(s.supplier) <= (r.daysToRupture ?? 0)).sort((a, b) => p80Of(a.supplier) - p80Of(b.supplier))[0];
    if (fast) out.push({ materialId: m.id, mainSupplier: main, fastSupplier: fast.supplier, daysToRupture: r.daysToRupture, mainP80, fastP80: p80Of(fast.supplier), qty: r.suggestion.qty });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------- anomalías
export type AnomalyKind = 'DUPLICATE_REQUISITION' | 'QUANTITY_OUTLIER';

export interface OrderAnomaly {
  kind: AnomalyKind;
  materialId: string;
  /** Id de la solicitud o descripción de la orden afectada. */
  ref: string;
  qty: number;
  detail: string;
  /** Mediana histórica de las órdenes del material (para cantidades atípicas). */
  typicalQty?: number;
  ratio?: number;
  /** Orden abierta con la que se podría duplicar. */
  duplicateOf?: PurchaseOrderLine;
}

export interface AnomalyOptions {
  duplicateQtyTolerance?: number;
  duplicateDays?: number;
  minHistory?: number;
  zThreshold?: number;
}

/** Posibles duplicados sol.ped. vs OC y cantidades fuera de lo habitual para el material. */
export function detectOrderAnomalies(ds: RamoDataset, options: AnomalyOptions = {}): OrderAnomaly[] {
  const tol = options.duplicateQtyTolerance ?? 0.1;
  const dupDays = options.duplicateDays ?? 7;
  const minHistory = options.minHistory ?? 6;
  const zThr = options.zThreshold ?? 3.5;
  const pos = ds.purchaseOrders ?? [];
  const reqs: PurchaseRequisition[] = ds.requisitions ?? [];
  const history = ds.orderHistory ?? [];
  const out: OrderAnomaly[] = [];

  for (const r of reqs) {
    const dup = pos.find((o) => o.materialId === r.materialId && Math.abs(o.qty - r.qty) / Math.max(o.qty, r.qty) <= tol && Math.abs(daysBetween(o.dueDate, r.neededDate)) <= dupDays);
    if (dup) out.push({ kind: 'DUPLICATE_REQUISITION', materialId: r.materialId, ref: r.id, qty: r.qty, duplicateOf: dup, detail: `Misma cantidad (±${Math.round(tol * 100)} %) y fecha (±${dupDays} días) que la orden de compra abierta del ${dup.dueDate}` });
  }

  const check = (materialId: string, ref: string, qty: number) => {
    const qs = history.filter((h) => h.materialId === materialId).map((h) => h.qty);
    if (qs.length < minHistory) return;
    const med = median(qs);
    const dev = mad(qs);
    const ratio = qty / med;
    const z = dev > 0 ? (0.6745 * (qty - med)) / dev : ratio > 3 ? Infinity : 0;
    if (Math.abs(z) > zThr && (ratio > 2 || ratio < 0.3)) {
      out.push({ kind: 'QUANTITY_OUTLIER', materialId, ref, qty, typicalQty: med, ratio, detail: `${ratio.toFixed(1)}× la mediana histórica de ${qs.length} órdenes (${Math.round(med)})` });
    }
  };
  for (const r of reqs) check(r.materialId, r.id, r.qty);
  pos.forEach((o, i) => check(o.materialId, `OC ${o.materialId} ${o.dueDate}#${i}`, o.qty));
  return out;
}

export interface DemandSpike {
  skuId: string;
  weekStart: string;
  value: number;
  expected: number;
  ratio: number;
}

/**
 * Semanas de venta atípicas (promoción, quiebre, error de captura) que contaminan el pronóstico: el logaritmo del cociente entre
 * la venta y la mediana de sus vecinas (±4 semanas) se compara con su propia dispersión robusta.
 */
export function detectDemandSpikes(history: DemandHistoryRow[], options: { recentWeeks?: number; zThreshold?: number } = {}): DemandSpike[] {
  const zThr = options.zThreshold ?? 3.5;
  const recent = options.recentWeeks ?? 26;
  const out: DemandSpike[] = [];
  for (const skuId of new Set(history.map((h) => h.skuId))) {
    const s = history.filter((h) => h.skuId === skuId && h.flow === 'CEDI').sort((a, b) => a.weekStart.localeCompare(b.weekStart));
    if (s.length < 12) continue;
    const lr = s.map((row, i) => {
      const neigh = s.slice(Math.max(0, i - 4), i).concat(s.slice(i + 1, i + 5)).map((x) => x.commercialQty);
      const expected = median(neigh);
      return { row, expected, lr: expected > 0 && row.commercialQty > 0 ? Math.log(row.commercialQty / expected) : 0 };
    });
    const m = median(lr.map((x) => x.lr));
    const d = 1.4826 * mad(lr.map((x) => x.lr));
    lr.forEach(({ row, expected, lr: v }, i) => {
      if (i < s.length - recent || d <= 0) return;
      if (Math.abs((v - m) / d) > zThr && Math.abs(v) > 0.1) out.push({ skuId, weekStart: row.weekStart, value: row.commercialQty, expected, ratio: row.commercialQty / expected });
    });
  }
  return out.sort((a, b) => b.weekStart.localeCompare(a.weekStart));
}

// ---------------------------------------------------------------------------------------------- variabilidad
/** σ semanal del consumo de cada material, a partir del error de pronóstico de cada SKU (errores independientes entre SKUs). */
export function materialWeeklySigma(explosion: Explosion, sigmaBySku: Record<string, number>): Map<string, number> {
  const acc = new Map<string, number>();
  for (const [skuId, coefs] of explosion.coefficients) {
    const sigma = sigmaBySku[skuId];
    if (sigma === undefined) continue;
    for (const [materialId, coef] of coefs) acc.set(materialId, (acc.get(materialId) ?? 0) + (coef * sigma) ** 2);
  }
  return new Map([...acc].map(([k, v]) => [k, Math.sqrt(v)]));
}

export interface AdjustedOrder {
  baseQty: number;
  /** Cajas/kg extra para cubrir la variabilidad de la demanda con el nivel de confianza pedido. */
  buffer: number;
  qty: number;
  z: number;
}

/** Sube el pedido sugerido en z × σ × √(semanas cubiertas), redondeado al múltiplo mínimo. */
export function adjustOrderForVariability(s: OrderSuggestion, moq: number, sigmaWeek: number | undefined, coveredDays: number, z = 1.645): AdjustedOrder {
  if (sigmaWeek === undefined || sigmaWeek <= 0) return { baseQty: s.qty, buffer: 0, qty: s.qty, z };
  const buffer = Math.ceil((z * sigmaWeek * Math.sqrt(coveredDays / 7)) / moq) * moq;
  return { baseQty: s.qty, buffer, qty: s.qty + buffer, z };
}

// ---------------------------------------------------------------------------------------------- prioridad y consolidación
export type Urgency = 'CRITICAL' | 'NORMAL' | 'WAIT';

/** Regla validada con Diana: crítico < 5 días hasta la ruptura; normal si hay que decidir; puede esperar si no hay riesgo cercano. */
export function urgencyOf(r: MaterialRisk, criticalDays = 5): Urgency {
  if (r.daysToRupture !== null && r.daysToRupture < criticalDays) return 'CRITICAL';
  return r.status === 'OK' ? 'WAIT' : 'NORMAL';
}

export interface ConsolidatedOrder {
  supplier: string;
  orderDate: string;
  lines: { materialId: string; qty: number; orderBy: string }[];
  /** Pedidos separados que se reemplazan por uno solo. */
  ordersBefore: number;
}

/** Agrupa los pedidos sugeridos al mismo proveedor cuya fecha límite cae dentro de una ventana, para pedirlos juntos. */
export function consolidateOrders(risks: MaterialRisk[], today: string, windowDays = 7): ConsolidatedOrder[] {
  const lines: { supplier: string; materialId: string; qty: number; orderBy: string }[] = [];
  for (const r of risks) {
    if (!r.suggestion) continue;
    const orderBy = !r.orderByDate || r.orderByDate.startsWith('antes') ? today : r.orderByDate < today ? today : r.orderByDate;
    for (const s of r.suggestion.split) if (s.qty > 0) lines.push({ supplier: s.supplier, materialId: r.materialId, qty: s.qty, orderBy });
  }
  const out: ConsolidatedOrder[] = [];
  for (const supplier of new Set(lines.map((l) => l.supplier))) {
    const mine = lines.filter((l) => l.supplier === supplier).sort((a, b) => a.orderBy.localeCompare(b.orderBy));
    let i = 0;
    while (i < mine.length) {
      const start = mine[i].orderBy;
      const group = mine.filter((l, k) => k >= i && daysBetween(start, l.orderBy) <= windowDays);
      if (group.length >= 2) out.push({ supplier, orderDate: start, lines: group.map(({ materialId, qty, orderBy }) => ({ materialId, qty, orderBy })), ordersBefore: group.length });
      i += group.length;
    }
  }
  return out.sort((a, b) => a.orderDate.localeCompare(b.orderDate) || b.lines.length - a.lines.length);
}
