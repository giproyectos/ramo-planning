import { PlantConfirmation, PlantDelivery, RamoDataset } from '@ramo/domain';
import { NetPlanRow } from './mps';

/**
 * Confirmación de plantas: Producción dice cuánto de lo que pide el MPS sí puede fabricar cada planta, con trazabilidad (cada
 * confirmación se añade y nunca se borra) y seguimiento contra lo entregado.
 *
 *  - Una fila por producto y semana con producción en el MPS; la planta sale de la línea del producto.
 *  - La confirmación vigente es la más reciente. Se compara contra lo que pide el MPS **hoy**: si el MPS cambió después de confirmar,
 *    la fila queda marcada (`planChanged`) y el estado se calcula con la cantidad actual.
 *  - Lo entregado se suma (varios registros en la semana) y se compara con lo confirmado.
 */

export type PlantStatus = 'PENDING' | 'CONFIRMED' | 'PARTIAL' | 'CANNOT';

export interface PlantRow {
  skuId: string;
  weekStart: string;
  plantId: string;
  lineId: string;
  /** Cajas que pide el MPS hoy. */
  plannedNow: number;
  /** Confirmación vigente (la más reciente) y todas las anteriores, de la más nueva a la más antigua. */
  current?: PlantConfirmation;
  history: PlantConfirmation[];
  status: PlantStatus;
  confirmedQty: number;
  /** Confirmado ÷ pedido hoy (0–1.x); 0 si no hay confirmación. */
  coverage: number;
  /** Cajas que el MPS pide y la planta no confirmó (solo con confirmación). */
  shortfall: number;
  /** El MPS pedía otra cantidad cuando se confirmó. */
  planChanged: boolean;
  delivered: number;
  deliveries: PlantDelivery[];
  /** Entregado ÷ confirmado (0 si no se confirmó nada). */
  fulfillment: number;
  /** Cajas confirmadas que todavía no se entregan. */
  deliveryGap: number;
}

const byNewest = <T extends { createdAt: string }>(a: T, b: T) => b.createdAt.localeCompare(a.createdAt);

export function plantFollowUp(ds: RamoDataset, net: NetPlanRow[], confirmations: PlantConfirmation[], deliveries: PlantDelivery[]): PlantRow[] {
  const skuById = new Map(ds.skus.map((s) => [s.id, s]));
  const lineById = new Map(ds.lines.map((l) => [l.id, l]));
  const rows: PlantRow[] = [];
  for (const r of net) {
    const planned = Math.round(r.netProduction);
    if (planned <= 0) continue;
    const sku = skuById.get(r.skuId);
    const line = sku ? lineById.get(sku.lineId) : undefined;
    if (!sku || !line) continue;
    // Más reciente primero; entre iguales gana el que se añadió después (el orden del arreglo).
    const history = confirmations
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => c.skuId === r.skuId && c.weekStart === r.weekStart)
      .sort((a, b) => byNewest(a.c, b.c) || b.i - a.i)
      .map(({ c }) => c);
    const current = history[0];
    const mine = deliveries.filter((d) => d.skuId === r.skuId && d.weekStart === r.weekStart).sort(byNewest);
    const delivered = mine.reduce((a, d) => a + d.qty, 0);
    const confirmedQty = current ? Math.round(current.confirmedQty) : 0;
    const status: PlantStatus = !current ? 'PENDING' : confirmedQty >= planned ? 'CONFIRMED' : confirmedQty <= 0 ? 'CANNOT' : 'PARTIAL';
    rows.push({
      skuId: r.skuId,
      weekStart: r.weekStart,
      plantId: line.plantId,
      lineId: line.id,
      plannedNow: planned,
      current,
      history,
      status,
      confirmedQty,
      coverage: current ? confirmedQty / planned : 0,
      shortfall: current ? Math.max(0, planned - confirmedQty) : 0,
      planChanged: !!current && Math.round(current.plannedQty) !== planned,
      delivered,
      deliveries: mine,
      fulfillment: confirmedQty > 0 ? delivered / confirmedQty : 0,
      deliveryGap: Math.max(0, confirmedQty - delivered),
    });
  }
  return rows.sort((a, b) => a.weekStart.localeCompare(b.weekStart) || a.plantId.localeCompare(b.plantId) || a.skuId.localeCompare(b.skuId));
}

export interface PlantSummary {
  rows: number;
  pending: number;
  confirmed: number;
  partial: number;
  cannot: number;
  planChanged: number;
  planned: number;
  confirmedQty: number;
  /** Confirmado ÷ pedido sobre las filas ya confirmadas (null si no hay ninguna). */
  coverage: number | null;
  shortfall: number;
  delivered: number;
  /** Entregado ÷ confirmado sobre las filas confirmadas (null si no hay confirmado). */
  fulfillment: number | null;
}

export function summarizePlants(rows: PlantRow[]): PlantSummary {
  const done = rows.filter((r) => r.current);
  const planned = done.reduce((a, r) => a + r.plannedNow, 0);
  const confirmedQty = done.reduce((a, r) => a + Math.min(r.confirmedQty, r.plannedNow), 0);
  const conf = done.reduce((a, r) => a + r.confirmedQty, 0);
  return {
    rows: rows.length,
    pending: rows.filter((r) => r.status === 'PENDING').length,
    confirmed: rows.filter((r) => r.status === 'CONFIRMED').length,
    partial: rows.filter((r) => r.status === 'PARTIAL').length,
    cannot: rows.filter((r) => r.status === 'CANNOT').length,
    planChanged: rows.filter((r) => r.planChanged).length,
    planned: rows.reduce((a, r) => a + r.plannedNow, 0),
    confirmedQty,
    coverage: planned > 0 ? confirmedQty / planned : null,
    shortfall: rows.reduce((a, r) => a + r.shortfall, 0),
    delivered: done.reduce((a, r) => a + r.delivered, 0),
    fulfillment: conf > 0 ? done.reduce((a, r) => a + r.delivered, 0) / conf : null,
  };
}
