import { NodePriority, RamoDataset } from '@ramo/domain';
import { WeekCapacity } from './crp';
import { DrpResult } from './drp';
import { NetPlanRow } from './mps';

/**
 * Regla de escasez (descrita por Diana, pendiente de validación comercial):
 *  1. Overrides manuales del planeador (se respetan primero, hasta lo pedido y lo disponible).
 *  2. Mínimos de cobertura por canal prioritario: cada nodo recibe `minCoverDays` de su demanda, por niveles HIGH → NORMAL → LOW;
 *     si un nivel no alcanza, se reparte a prorrata de sus mínimos.
 *  3. El resto se reparte a prorrata del pronóstico, sin pasar de lo pedido ("fair share").
 */
export interface ScarcityRequest {
  nodeId: string;
  /** Cajas que el nodo necesita recibir. */
  requested: number;
  /** Demanda semanal del nodo (base del prorrateo y de los días de cobertura). */
  weeklyForecast: number;
  priority: NodePriority;
  minCoverDays: number;
  /** Cantidad fijada a mano por el planeador. */
  override?: number;
}

export type AllocationReason = 'FULL' | 'OVERRIDE' | 'MINIMUM' | 'PRO_RATA';

export interface ScarcityAllocation {
  nodeId: string;
  requested: number;
  allocated: number;
  shortfall: number;
  fillRate: number;
  /** Mínimo de cobertura protegido (cajas). */
  minimum: number;
  reason: AllocationReason;
}

export interface ScarcityResult {
  supply: number;
  requestedTotal: number;
  allocatedTotal: number;
  scarce: boolean;
  allocations: ScarcityAllocation[];
}

const TIERS: NodePriority[] = ['HIGH', 'NORMAL', 'LOW'];
const EPS = 1e-9;

export function allocateScarcity(supply: number, requests: ScarcityRequest[]): ScarcityResult {
  const requestedTotal = requests.reduce((a, r) => a + r.requested, 0);
  const alloc = new Map(requests.map((r) => [r.nodeId, 0]));
  const minimum = new Map(requests.map((r) => [r.nodeId, 0]));
  const reasons = new Map<string, AllocationReason>(requests.map((r) => [r.nodeId, 'PRO_RATA']));
  let remaining = Math.max(0, supply);
  const scarce = requestedTotal > supply + EPS;

  if (!scarce) {
    for (const r of requests) { alloc.set(r.nodeId, r.requested); reasons.set(r.nodeId, 'FULL'); }
    return build(supply, requestedTotal, requests, alloc, minimum, reasons, false);
  }

  // 1) Overrides
  for (const r of requests) {
    if (r.override === undefined) continue;
    const give = Math.min(Math.max(0, r.override), r.requested, remaining);
    alloc.set(r.nodeId, give);
    reasons.set(r.nodeId, 'OVERRIDE');
    remaining -= give;
  }
  const open = requests.filter((r) => r.override === undefined);

  // 2) Mínimos de cobertura por nivel de prioridad
  for (const tier of TIERS) {
    const group = open.filter((r) => r.priority === tier);
    const wants = group.map((r) => Math.min(r.requested, (r.weeklyForecast / 7) * r.minCoverDays));
    const total = wants.reduce((a, b) => a + b, 0);
    if (total <= EPS) continue;
    const factor = Math.min(1, remaining / total);
    group.forEach((r, i) => {
      const give = wants[i] * factor;
      alloc.set(r.nodeId, (alloc.get(r.nodeId) ?? 0) + give);
      minimum.set(r.nodeId, give);
      reasons.set(r.nodeId, 'MINIMUM');
      remaining -= give;
    });
  }

  // 3) Resto a prorrata del pronóstico, sin pasar de lo pedido (se repite hasta repartir todo o saturar a todos)
  let guard = 0;
  while (remaining > EPS && guard++ < 50) {
    const hungry = open.filter((r) => r.requested - (alloc.get(r.nodeId) ?? 0) > EPS);
    const weight = hungry.reduce((a, r) => a + r.weeklyForecast, 0);
    if (hungry.length === 0) break;
    let given = 0;
    for (const r of hungry) {
      const share = weight > EPS ? r.weeklyForecast / weight : 1 / hungry.length;
      const give = Math.min(remaining * share, r.requested - (alloc.get(r.nodeId) ?? 0));
      alloc.set(r.nodeId, (alloc.get(r.nodeId) ?? 0) + give);
      if (give > EPS && reasons.get(r.nodeId) !== 'MINIMUM') reasons.set(r.nodeId, 'PRO_RATA');
      given += give;
    }
    remaining -= given;
    if (given <= EPS) break;
  }

  return build(supply, requestedTotal, requests, alloc, minimum, reasons, true);
}

function build(
  supply: number, requestedTotal: number, requests: ScarcityRequest[], alloc: Map<string, number>, minimum: Map<string, number>,
  reasons: Map<string, AllocationReason>, scarce: boolean,
): ScarcityResult {
  const allocations = requests.map((r) => {
    const allocated = alloc.get(r.nodeId) ?? 0;
    return {
      nodeId: r.nodeId,
      requested: r.requested,
      allocated,
      shortfall: Math.max(0, r.requested - allocated),
      fillRate: r.requested > 0 ? allocated / r.requested : 1,
      minimum: minimum.get(r.nodeId) ?? 0,
      reason: reasons.get(r.nodeId) ?? 'PRO_RATA',
    };
  });
  return { supply, requestedTotal, allocatedTotal: allocations.reduce((a, x) => a + x.allocated, 0), scarce, allocations };
}

export interface SupplyGap {
  skuId: string;
  weekStart: string;
  required: number;
  supply: number;
  shortfall: number;
  /** Fracción de la necesidad que la capacidad alcanza a cubrir (1 = sin faltante). */
  factor: number;
}

/**
 * Faltantes de producción por SKU y semana según el CRP: si la tripulación queda con horas de exceso, solo se alcanza a producir
 * la fracción (requeridas − exceso) / requeridas de lo programado. Es una aproximación lineal (no decide qué SKU se sacrifica).
 */
export function supplyGaps(ds: RamoDataset, net: NetPlanRow[], capacity: WeekCapacity[]): SupplyGap[] {
  const gaps: SupplyGap[] = [];
  for (const row of net) {
    const sku = ds.skus.find((s) => s.id === row.skuId);
    const crewId = ds.lines.find((l) => l.id === sku?.lineId)?.crewId;
    const crew = capacity.find((w) => w.weekStart === row.weekStart)?.crews.find((c) => c.crewId === crewId);
    if (!crew || crew.requiredHours <= 0 || row.netProduction <= 0) continue;
    const factor = Math.max(0, (crew.requiredHours - crew.excessHours) / crew.requiredHours);
    if (factor >= 1 - EPS) continue;
    gaps.push({ skuId: row.skuId, weekStart: row.weekStart, required: row.netProduction, supply: row.netProduction * factor, shortfall: row.netProduction * (1 - factor), factor });
  }
  return gaps;
}

/**
 * Pedidos de los nodos para un SKU y semana a partir del DRP: lo que cada agencia necesita que se le despache (su liberación)
 * y la demanda propia del CEDI. La cantidad disponible para repartir es lo pedido menos el faltante de producción de esa semana.
 */
export function scarcityRequests(ds: RamoDataset, drp: DrpResult, skuId: string, weekStart: string): ScarcityRequest[] {
  const nodes = ds.nodes ?? [];
  const t = drp.weeks.indexOf(weekStart);
  if (t < 0) return [];
  return nodes.flatMap((node) => {
    const row = drp.rows.find((r) => r.nodeId === node.id && r.skuId === skuId);
    if (!row) return [];
    const cell = row.cells[t];
    if (node.type === 'CEDI') {
      // Para el CEDI se pide su propia demanda (la que no es de agencias).
      const own = cell.gross - drp.rows.filter((r) => r.skuId === skuId && r.nodeId !== node.id).reduce((a, r) => a + r.cells[t].plannedRelease, 0);
      return [{ nodeId: node.id, requested: Math.max(0, own), weeklyForecast: Math.max(0, own), priority: node.priority, minCoverDays: node.minCoverDays }];
    }
    return [{ nodeId: node.id, requested: cell.plannedRelease, weeklyForecast: cell.gross, priority: node.priority, minCoverDays: node.minCoverDays }];
  });
}
