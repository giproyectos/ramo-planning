import { RamoDataset } from '@ramo/domain';
import { dayHours, weekDays } from './calendar';
import { NetPlanRow } from './mps';

/**
 * Tablero de riesgo de abastecimiento ("MRP liviano", de solo lectura): la producción del MPS se baja a días según el calendario
 * de cada línea, se explota a insumos y empaques con la lista de materiales (las mezclas de la planta secreta son ítems de paso),
 * se proyecta el inventario día a día con las órdenes de compra abiertas y se compara la fecha de ruptura con el plazo de entrega.
 * No genera ni modifica pedidos: sirve para ver el riesgo y para contrastar contra la simulación nativa de SAP.
 */

export interface Explosion {
  /** SKU → material → cantidad del material por caja del SKU (incluye mermas y mezclas). */
  coefficients: Map<string, Map<string, number>>;
  /** Rutas SKU → … → material para explicar de dónde sale cada necesidad. */
  paths: Map<string, string[][]>;
  issues: string[];
}

const MAX_DEPTH = 8;

export function explodeBom(ds: RamoDataset): Explosion {
  const bom = ds.bom ?? [];
  const types = new Map((ds.materials ?? []).map((m) => [m.id, m.type]));
  const coefficients = new Map<string, Map<string, number>>();
  const paths = new Map<string, string[][]>();
  const issues: string[] = [];

  for (const sku of ds.skus) {
    const acc = new Map<string, number>();
    const walk = (parent: string, mult: number, trail: string[], depth: number) => {
      if (depth > MAX_DEPTH) { issues.push(`Profundidad excesiva (¿ciclo?) al explotar ${sku.id}: ${trail.join(' → ')}`); return; }
      for (const line of bom.filter((b) => b.parentId === parent)) {
        const q = mult * line.quantityPer * (1 + line.scrapPct / 100);
        const next = [...trail, line.componentId];
        if (types.get(line.componentId) === 'MIX') walk(line.componentId, q, next, depth + 1);
        else {
          acc.set(line.componentId, (acc.get(line.componentId) ?? 0) + q);
          const key = `${sku.id}|${line.componentId}`;
          paths.set(key, [...(paths.get(key) ?? []), next]);
        }
      }
    };
    walk(sku.id, 1, [sku.id], 0);
    coefficients.set(sku.id, acc);
  }
  return { coefficients, paths, issues };
}

export interface DailyPlan {
  dates: string[];
  /** Cajas a producir por día y SKU (índice = día). */
  bySku: Map<string, number[]>;
}

/** Baja la producción semanal a días en proporción a las horas disponibles de la línea de cada SKU (parejo de lunes a viernes si la semana no tiene horas). */
export function dailyProduction(ds: RamoDataset, net: NetPlanRow[]): DailyPlan {
  const weeks = [...new Set(net.map((r) => r.weekStart))].sort();
  const dates = weeks.flatMap((w) => weekDays(w));
  const index = new Map(dates.map((d, i) => [d, i]));
  const bySku = new Map<string, number[]>();

  for (const row of net) {
    if (row.netProduction <= 0) continue;
    const sku = ds.skus.find((s) => s.id === row.skuId);
    const cal = ds.calendars.find((c) => c.lineId === sku?.lineId);
    const days = weekDays(row.weekStart);
    let hours = days.map((d) => (cal ? dayHours(cal, d) : 0));
    if (hours.every((h) => h === 0)) hours = days.map((_, i) => (i < 5 ? 1 : 0));
    const total = hours.reduce((a, b) => a + b, 0);
    const arr = bySku.get(row.skuId) ?? Array(dates.length).fill(0);
    days.forEach((d, i) => { arr[index.get(d)!] += (row.netProduction * hours[i]) / total; });
    bySku.set(row.skuId, arr);
  }
  return { dates, bySku };
}

export type RiskStatus = 'OK' | 'WATCH' | 'ORDER' | 'CRITICAL';
export type RiskReason = 'NONE' | 'SAFETY' | 'RUPTURE_LATE' | 'ORDER_SOON' | 'RUPTURE_IN_LEAD_TIME';

export interface MaterialProjection {
  materialId: string;
  consumption: number[];
  receipts: number[];
  /** Inventario al final de cada día (puede ser negativo: necesidad sin cubrir). */
  stock: number[];
}

export interface OrderSuggestion {
  qty: number;
  /** Reparto entre proveedores según la cuota reguladora, en múltiplos del pedido mínimo. */
  split: { supplier: string; qty: number; share: number }[];
  needBy: string | null;
}

/** Orden de compra abierta que llega después de la ruptura: no hace falta pedir más, hace falta adelantarla. */
export interface LateOrder {
  supplier: string;
  dueDate: string;
  qty: number;
  daysAfterRupture: number;
}

export interface MaterialRisk {
  materialId: string;
  status: RiskStatus;
  reason: RiskReason;
  avgDailyConsumption: number;
  /** Días que alcanza el inventario actual al consumo promedio de las primeras 2 semanas. */
  coverageDays: number | null;
  ruptureDate: string | null;
  daysToRupture: number | null;
  /** Última fecha para pedir y que llegue antes de la ruptura (ruptura − plazo). */
  orderByDate: string | null;
  leadTimeDays: number;
  suggestion: OrderSuggestion | null;
  /** Primera orden abierta que llega tras la ruptura (candidata a adelantar con el proveedor). */
  lateOrder: LateOrder | null;
}

export interface SupplyRiskOptions {
  /** Días de cobertura que se piden por encima del plazo de entrega (por defecto 14). */
  coverDays?: number;
  /** Se marca ORDER si la fecha límite para pedir cae dentro de estos días (por defecto 7). */
  orderSoonDays?: number;
  /**
   * Horizonte de decisión (por defecto 28 días): si la fecha límite para pedir queda más lejos, el material figura OK aunque se
   * muestre su fecha de ruptura (con 13 semanas de horizonte casi todo se rompería si nunca se vuelve a pedir; eso no es una alerta).
   */
  watchDays?: number;
}

export interface SupplyRiskResult {
  dates: string[];
  projections: MaterialProjection[];
  risks: MaterialRisk[];
  explosion: Explosion;
  plan: DailyPlan;
  issues: string[];
}

const EPS = 1e-6;
const SEVERITY: Record<RiskStatus, number> = { CRITICAL: 0, ORDER: 1, WATCH: 2, OK: 3 };
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

/** Reparto por mayor residuo en múltiplos del pedido mínimo: respeta la cuota lo mejor que permite el múltiplo. */
export function splitByQuota(qty: number, moq: number, suppliers: { supplier: string; share: number }[]): { supplier: string; qty: number; share: number }[] {
  const units = Math.round(qty / moq);
  const raw = suppliers.map((s) => s.share * units);
  const base = raw.map(Math.floor);
  let left = units - base.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, rem: r - Math.floor(r) })).sort((a, b) => b.rem - a.rem || suppliers[b.i].share - suppliers[a.i].share);
  for (const { i } of order) { if (left <= 0) break; base[i] += 1; left -= 1; }
  return suppliers.map((s, i) => ({ supplier: s.supplier, qty: base[i] * moq, share: s.share }));
}

export function runSupplyRisk(ds: RamoDataset, net: NetPlanRow[], options: SupplyRiskOptions = {}): SupplyRiskResult {
  const coverDays = options.coverDays ?? 14;
  const orderSoonDays = options.orderSoonDays ?? 7;
  const watchDays = options.watchDays ?? 28;
  const explosion = explodeBom(ds);
  const plan = dailyProduction(ds, net);
  const H = plan.dates.length;
  const projections: MaterialProjection[] = [];
  const risks: MaterialRisk[] = [];
  const pos = ds.purchaseOrders ?? [];

  for (const m of (ds.materials ?? []).filter((x) => x.type !== 'MIX')) {
    const consumption = Array(H).fill(0) as number[];
    for (const [skuId, perDay] of plan.bySku) {
      const coef = explosion.coefficients.get(skuId)?.get(m.id);
      if (!coef) continue;
      for (let d = 0; d < H; d++) consumption[d] += perDay[d] * coef;
    }
    const receipts = Array(H).fill(0) as number[];
    for (const o of pos.filter((p) => p.materialId === m.id)) {
      const d = o.dueDate <= plan.dates[0] ? 0 : plan.dates.indexOf(o.dueDate);
      if (d >= 0) receipts[d] += o.qty;
    }
    const stock: number[] = [];
    let prev = m.stock;
    for (let d = 0; d < H; d++) { prev = prev + receipts[d] - consumption[d]; stock.push(prev); }
    projections.push({ materialId: m.id, consumption, receipts, stock });

    const avg14 = mean(consumption.slice(0, 14));
    const avgAll = mean(consumption);
    const rIdx = stock.findIndex((s) => s < -EPS);
    const L = m.leadTimeDays;
    let status: RiskStatus = 'OK';
    let reason: RiskReason = 'NONE';
    let orderBy: number | null = null;

    if (rIdx >= 0) {
      orderBy = rIdx - L;
      if (rIdx <= L) { status = 'CRITICAL'; reason = 'RUPTURE_IN_LEAD_TIME'; }
      else if (orderBy <= orderSoonDays) { status = 'ORDER'; reason = 'ORDER_SOON'; }
      else if (orderBy <= watchDays) { status = 'WATCH'; reason = 'RUPTURE_LATE'; }
    } else if (m.safetyDays > 0 && avgAll > 0 && stock.some((s) => s < m.safetyDays * avgAll - EPS)) {
      status = 'WATCH';
      reason = 'SAFETY';
    }

    let suggestion: OrderSuggestion | null = null;
    if (status !== 'OK') {
      const W = Math.min(H, L + coverDays);
      const need = consumption.slice(0, W).reduce((a, b) => a + b, 0) + m.safetyDays * avgAll - (m.stock + receipts.slice(0, W).reduce((a, b) => a + b, 0));
      if (need > EPS) {
        const qty = Math.ceil(need / m.moq - 1e-9) * m.moq;
        suggestion = { qty, split: splitByQuota(qty, m.moq, m.suppliers), needBy: rIdx >= 0 ? plan.dates[rIdx] : null };
      }
    }

    let lateOrder: LateOrder | null = null;
    if (rIdx >= 0) {
      const after = pos
        .filter((o) => o.materialId === m.id)
        .map((o) => ({ o, idx: o.dueDate <= plan.dates[0] ? 0 : plan.dates.indexOf(o.dueDate) }))
        .filter(({ idx }) => idx > rIdx)
        .sort((a, b) => a.idx - b.idx)[0];
      if (after) lateOrder = { supplier: after.o.supplier, dueDate: after.o.dueDate, qty: after.o.qty, daysAfterRupture: after.idx - rIdx };
    }

    risks.push({
      materialId: m.id,
      status,
      reason,
      avgDailyConsumption: avg14,
      coverageDays: avg14 > 0 ? m.stock / avg14 : null,
      ruptureDate: rIdx >= 0 ? plan.dates[rIdx] : null,
      daysToRupture: rIdx >= 0 ? rIdx : null,
      orderByDate: orderBy === null ? null : orderBy >= 0 ? plan.dates[orderBy] : `antes del ${plan.dates[0]}`,
      leadTimeDays: L,
      suggestion,
      lateOrder,
    });
  }

  risks.sort((a, b) => SEVERITY[a.status] - SEVERITY[b.status] || (a.daysToRupture ?? 1e9) - (b.daysToRupture ?? 1e9) || a.materialId.localeCompare(b.materialId));
  return { dates: plan.dates, projections, risks, explosion, plan, issues: explosion.issues };
}

/** Consumo total del horizonte de un material, por SKU (para explicar qué productos lo mueven). */
export function consumptionBySku(result: SupplyRiskResult, materialId: string): { skuId: string; qty: number }[] {
  const out: { skuId: string; qty: number }[] = [];
  for (const [skuId, perDay] of result.plan.bySku) {
    const coef = result.explosion.coefficients.get(skuId)?.get(materialId);
    if (coef) out.push({ skuId, qty: perDay.reduce((a, b) => a + b, 0) * coef });
  }
  return out.sort((a, b) => b.qty - a.qty);
}
