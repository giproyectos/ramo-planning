import { DemandRecord, MAKE_TO_ORDER_FLOWS, MpsAdjustment, RamoDataset } from '@ramo/domain';

export interface NetPlanRow {
  skuId: string;
  weekStart: string;
  /** Demanda CEDI (neteable contra inventario y órdenes en curso). */
  grossCedi: number;
  /** Demanda make-to-order (Hard Discount + Exportaciones): entra completa, no se netea. */
  grossMto: number;
  /** Producción neta a programar, en unidades comerciales. */
  netProduction: number;
}

/**
 * Paso MPS "puro": demanda − (inventario + órdenes en curso) = neto, SKU por SKU y semana a semana.
 * No mira capacidad (eso es el CRP). Los flujos make-to-order se suman completos al neto.
 *   neto(t) = max(0, cedi(t) − (arrastre(t−1) + abiertas(t))) + mto(t)
 *   arrastre(t) = arrastre(t−1) + abiertas(t) + max(0, cedi(t) − …) − cedi(t)
 */
export function computeNetProduction(ds: RamoDataset, demand: DemandRecord[]): NetPlanRow[] {
  const weeks = [...new Set(demand.map((d) => d.weekStart))].sort();
  const result: NetPlanRow[] = [];

  for (const sku of ds.skus) {
    let carry = ds.inventory.find((i) => i.skuId === sku.id)?.onHandCommercial ?? 0;
    for (const week of weeks) {
      const rows = demand.filter((d) => d.skuId === sku.id && d.weekStart === week);
      const grossCedi = rows.filter((r) => !MAKE_TO_ORDER_FLOWS.has(r.flow)).reduce((a, r) => a + r.commercialQty, 0);
      const grossMto = rows.filter((r) => MAKE_TO_ORDER_FLOWS.has(r.flow)).reduce((a, r) => a + r.commercialQty, 0);
      const open = ds.openOrders.filter((o) => o.skuId === sku.id && o.weekStart === week).reduce((a, o) => a + o.commercialQty, 0);

      const netCedi = Math.max(0, grossCedi - (carry + open));
      carry = carry + open + netCedi - grossCedi;
      result.push({ skuId: sku.id, weekStart: week, grossCedi, grossMto, netProduction: netCedi + grossMto });
    }
  }
  return result;
}

/** Aplica los ajustes de Daniel (MPS final) sobre el neto. Nunca deja producción negativa. */
export function applyMpsAdjustments(net: NetPlanRow[], adjustments: MpsAdjustment[]): NetPlanRow[] {
  const out = net.map((r) => ({ ...r }));
  for (const a of adjustments) {
    const row = out.find((r) => r.skuId === a.skuId && r.weekStart === a.weekStart);
    if (row) row.netProduction = Math.max(0, row.netProduction + a.deltaCommercialQty);
    else out.push({ skuId: a.skuId, weekStart: a.weekStart, grossCedi: 0, grossMto: 0, netProduction: Math.max(0, a.deltaCommercialQty) });
  }
  return out;
}
