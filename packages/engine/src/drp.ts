import { DemandRecord, DistributionNode, NodePriority, RamoDataset } from '@ramo/domain';

/**
 * DRP semanal de dos niveles: agencias → CEDI → planta.
 *  1. Cada agencia consume su participación de la demanda CEDI del SKU, mantiene un stock de seguridad y pide recepciones
 *     para no bajar de él; la orden se libera `leadTimeWeeks` antes. Dentro del plazo no se puede recibir nada nuevo (horizonte
 *     congelado): el stock proyectado puede bajar del de seguridad o agotarse, se avisa, y la primera recepción factible lo recupera.
 *  2. Las liberaciones de las agencias son demanda del CEDI (más la propia). El CEDI hace lo mismo contra la planta.
 *  3. Las liberaciones del CEDI a planta son la **necesidad de producción** que entra al MPS (el DRP es insumo del MPS).
 * Hard Discount y Exportaciones no pasan por aquí (son bajo pedido): solo se procesa el flujo CEDI que se le pase.
 */
export type SafetyPolicy = 'DYNAMIC' | 'STATIC';

/** Factores z de nivel de servicio por prioridad del canal (97,5 %, 95 % y 90 %). */
export const DEFAULT_SERVICE_Z: Record<NodePriority, number> = { HIGH: 1.96, NORMAL: 1.645, LOW: 1.28 };

export interface DrpOptions {
  /** DYNAMIC: z × σ × √(plazo + revisión), con σ del error real de pronóstico. STATIC: X días fijos de demanda promedio. */
  policy?: SafetyPolicy;
  staticDays?: number;
  serviceZ?: Partial<Record<NodePriority, number>>;
  /**
   * Desviación del error de pronóstico a 1 semana, por SKU, de toda la demanda CEDI (cajas). A cada agencia se le asigna
   * σ × √participación (errores independientes entre nodos, más conservador que σ × participación). Es un supuesto:
   * con historia por nodo se reemplaza por el σ real de cada uno.
   */
  sigmaBySku?: Record<string, number>;
  /** Cada cuántas semanas se revisa y reabastece (por defecto 1). */
  reviewWeeks?: number;
  /**
   * Qué hay en camino durante el plazo congelado. STEADY_STATE (por defecto): se supone que lo liberado antes del horizonte
   * trae el consumo promedio del nodo (una operación en marcha ya tiene su pipeline). NONE: no hay nada en camino.
   * Es un supuesto mientras no se cargue el inventario en tránsito y las órdenes abiertas reales de cada nodo.
   */
  pipeline?: 'STEADY_STATE' | 'NONE';
}

export interface SafetyInput {
  policy: SafetyPolicy;
  z: number;
  /** σ semanal del nodo; si falta en modo dinámico se cae a la política estática. */
  sigmaWeek: number | undefined;
  leadWeeks: number;
  reviewWeeks: number;
  avgWeeklyDemand: number;
  staticDays: number;
}

export function safetyStock(i: SafetyInput): { units: number; fallback: boolean } {
  const stat = (i.avgWeeklyDemand * i.staticDays) / 7;
  if (i.policy === 'STATIC') return { units: stat, fallback: false };
  if (i.sigmaWeek === undefined) return { units: stat, fallback: true };
  return { units: i.z * i.sigmaWeek * Math.sqrt(i.leadWeeks + i.reviewWeeks), fallback: false };
}

export interface DrpCell {
  weekStart: string;
  gross: number;
  safetyStock: number;
  projectedOnHand: number;
  /** Cajas que ya venían en camino (liberadas antes del horizonte). */
  scheduledReceipt: number;
  /** Recepción planeada que el nodo necesita esta semana. */
  plannedReceipt: number;
  /** Orden que hay que liberar esta semana (la recepción de `leadTimeWeeks` más adelante). */
  plannedRelease: number;
}

export interface DrpRow {
  nodeId: string;
  skuId: string;
  initialOnHand: number;
  cells: DrpCell[];
}

export interface PlantRequirement {
  skuId: string;
  weekStart: string;
  qty: number;
}

export type DrpAlertCode = 'SPACE' | 'BELOW_SAFETY' | 'STOCKOUT';
export interface DrpAlert {
  code: DrpAlertCode;
  nodeId: string;
  skuId?: string;
  weekStart: string;
  /** SPACE: cajas sobre la capacidad. BELOW_SAFETY: cajas que faltan para el stock de seguridad. STOCKOUT: cajas de demanda sin cubrir (stock proyectado negativo). */
  value: number;
}

export interface SafetyRow {
  nodeId: string;
  skuId: string;
  /** Stock de seguridad de la política activa y el de la estática de referencia (cajas). */
  activeUnits: number;
  staticUnits: number;
  fallback: boolean;
}

export interface DrpResult {
  weeks: string[];
  rows: DrpRow[];
  plantRequirements: PlantRequirement[];
  alerts: DrpAlert[];
  safety: SafetyRow[];
  policy: SafetyPolicy;
}

const EPS = 1e-6;
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const EMPTY: DrpResult = { weeks: [], rows: [], plantRequirements: [], alerts: [], safety: [], policy: 'DYNAMIC' };

/** Corre el DRP para el flujo CEDI de `demand` (cajas por SKU y semana) sobre la red `ds.nodes`. */
export function runDrp(ds: RamoDataset, demand: DemandRecord[], options: DrpOptions = {}): DrpResult {
  const nodes = ds.nodes ?? [];
  const cedi = nodes.find((n) => n.type === 'CEDI');
  if (!cedi) return EMPTY;
  const policy = options.policy ?? 'DYNAMIC';
  const staticDays = options.staticDays ?? 3;
  const reviewWeeks = options.reviewWeeks ?? 1;
  const pipeline = options.pipeline ?? 'STEADY_STATE';
  const z = (p: NodePriority) => options.serviceZ?.[p] ?? DEFAULT_SERVICE_Z[p];
  const agencies = nodes.filter((n) => n.type === 'AGENCY' && n.parentId === cedi.id);

  const cediDemand = demand.filter((d) => d.flow === 'CEDI');
  const weeks = [...new Set(cediDemand.map((d) => d.weekStart))].sort();
  const n = weeks.length;
  // Para que las últimas semanas del horizonte también pidan lo que se recibe después de él, se calcula `ext` semanas más
  // (el plazo acumulado de la red) repitiendo la última demanda; solo se informa el horizonte original.
  const ext = cedi.leadTimeWeeks + Math.max(0, ...agencies.map((a) => a.leadTimeWeeks));
  const m = n + ext;
  const rows: DrpRow[] = [];
  const plant: PlantRequirement[] = [];
  const alerts: DrpAlert[] = [];
  const safety: SafetyRow[] = [];

  for (const sku of ds.skus) {
    const base = weeks.map((w) => sum(cediDemand.filter((d) => d.skuId === sku.id && d.weekStart === w).map((d) => d.commercialQty)));
    if (sum(base) === 0) continue;
    const D = [...base, ...Array(ext).fill(base[n - 1])] as number[];
    const inv = ds.inventory.find((i) => i.skuId === sku.id)?.onHandCommercial ?? 0;
    const sigma = options.sigmaBySku?.[sku.id];

    const ssFor = (node: DistributionNode, avgWeekly: number, sigmaNode: number | undefined) => {
      const base = { z: z(node.priority), sigmaWeek: sigmaNode, leadWeeks: node.leadTimeWeeks, reviewWeeks, avgWeeklyDemand: avgWeekly, staticDays };
      const active = safetyStock({ ...base, policy });
      const stat = safetyStock({ ...base, policy: 'STATIC' });
      safety.push({ nodeId: node.id, skuId: sku.id, activeUnits: active.units, staticUnits: stat.units, fallback: active.fallback });
      return active.units;
    };

    /** Reposición hacia un nodo: recibe lo necesario para no bajar del stock de seguridad. */
    const replenish = (node: DistributionNode, gross: number[], ss: number, onHand0: number) => {
      const cells: DrpCell[] = [];
      const receipts: number[] = [];
      let onHand = onHand0;
      const avgGross = sum(gross) / m;
      for (let t = 0; t < m; t++) {
        // Horizonte congelado: antes de `leadTimeWeeks` no puede llegar nada nuevo, solo lo que ya estaba en camino.
        const inTransit = t < node.leadTimeWeeks && pipeline === 'STEADY_STATE' ? avgGross : 0;
        const receipt = t < node.leadTimeWeeks ? 0 : Math.max(0, ss + gross[t] - onHand);
        onHand = onHand + inTransit + receipt - gross[t];
        receipts.push(receipt);
        cells.push({ weekStart: weeks[t] ?? '', gross: gross[t], safetyStock: ss, projectedOnHand: onHand, scheduledReceipt: inTransit, plannedReceipt: receipt, plannedRelease: 0 });
        if (t >= n) continue;
        if (onHand < -EPS) alerts.push({ code: 'STOCKOUT', nodeId: node.id, skuId: sku.id, weekStart: weeks[t], value: -onHand });
        else if (onHand < ss - EPS) alerts.push({ code: 'BELOW_SAFETY', nodeId: node.id, skuId: sku.id, weekStart: weeks[t], value: ss - onHand });
      }
      // La liberación cae `leadTimeWeeks` antes de la recepción (siempre dentro del horizonte, porque t >= leadTimeWeeks).
      const releases = Array(m).fill(0) as number[];
      for (let t = node.leadTimeWeeks; t < m; t++) {
        if (receipts[t] <= 0) continue;
        cells[t - node.leadTimeWeeks].plannedRelease += receipts[t];
        releases[t - node.leadTimeWeeks] += receipts[t];
      }
      return { cells, releases };
    };

    // 1) Agencias
    const agencyReleases = Array(m).fill(0) as number[];
    for (const a of agencies) {
      const gross = D.map((d) => d * a.demandShare);
      const ss = ssFor(a, sum(gross) / m, sigma === undefined ? undefined : sigma * Math.sqrt(a.demandShare));
      const { cells, releases } = replenish(a, gross, ss, inv * a.inventoryShare);
      rows.push({ nodeId: a.id, skuId: sku.id, initialOnHand: inv * a.inventoryShare, cells: cells.slice(0, n) });
      releases.forEach((r, t) => { agencyReleases[t] += r; });
    }

    // 2) CEDI: demanda propia + lo que despacha a las agencias; el CEDI se protege contra la variabilidad de toda la demanda.
    const cediGross = D.map((d, t) => d * cedi.demandShare + agencyReleases[t]);
    const cediSs = ssFor(cedi, sum(D) / m, sigma);
    const { cells, releases } = replenish(cedi, cediGross, cediSs, inv * cedi.inventoryShare);
    rows.push({ nodeId: cedi.id, skuId: sku.id, initialOnHand: inv * cedi.inventoryShare, cells: cells.slice(0, n) });

    // 3) Liberaciones del CEDI = necesidad de producción para el MPS.
    releases.slice(0, n).forEach((r, t) => {
      if (r > 0) plant.push({ skuId: sku.id, weekStart: weeks[t], qty: r });
    });
  }

  // Espacio: el stock proyectado de todos los SKUs de un nodo no puede pasar de su capacidad.
  for (const node of nodes) {
    for (let t = 0; t < n; t++) {
      const total = sum(rows.filter((r) => r.nodeId === node.id).map((r) => r.cells[t].projectedOnHand));
      if (total > node.storageCapacity) alerts.push({ code: 'SPACE', nodeId: node.id, weekStart: weeks[t], value: total - node.storageCapacity });
    }
  }

  return { weeks, rows, plantRequirements: plant, alerts, safety, policy };
}

/** Necesidad de producción del DRP como registros de demanda CEDI (entrada del neto del MPS). */
export function plantRequirementRecords(result: DrpResult, versionId = 'DRP'): DemandRecord[] {
  return result.plantRequirements.map((p) => ({ versionId, skuId: p.skuId, weekStart: p.weekStart, flow: 'CEDI' as const, commercialQty: Math.round(p.qty) }));
}
