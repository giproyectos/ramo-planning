import { RamoDataset } from '@ramo/domain';
import { DrpResult } from './drp';

/**
 * Riesgo de quiebre por punto de la red: probabilidad de que la demanda acumulada supere el inventario proyectado dentro del plazo de
 * entrega, cuando todavía no se puede recibir nada nuevo. Usa la incertidumbre real del pronóstico (σ semanal por SKU, escalada a cada
 * punto por √su participación) y asume errores normales e independientes entre semanas: es una aproximación, no un modelo exacto.
 */

export interface StockoutRisk {
  nodeId: string;
  skuId: string;
  /** Mayor probabilidad (0–1) dentro del plazo congelado. */
  probability: number;
  weekStart: string;
  /** Inventario proyectado esa semana y la incertidumbre acumulada usada (cajas). */
  projected: number;
  sigma: number;
}

/** Φ(x): distribución normal estándar (aproximación de Abramowitz–Stegun). */
export function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x >= 0 ? 1 - p : p;
}

export function stockoutRisks(ds: RamoDataset, drp: DrpResult, sigmaBySku: Record<string, number> | undefined): StockoutRisk[] {
  if (!sigmaBySku) return [];
  const nodes = ds.nodes ?? [];
  const out: StockoutRisk[] = [];
  for (const row of drp.rows) {
    const node = nodes.find((n) => n.id === row.nodeId);
    const sku = sigmaBySku[row.skuId];
    if (!node || sku === undefined) continue;
    const sigmaWeek = sku * Math.sqrt(node.demandShare);
    const frozen = Math.max(1, node.leadTimeWeeks);
    let best: StockoutRisk | null = null;
    for (let t = 0; t < Math.min(frozen, row.cells.length); t++) {
      const cell = row.cells[t];
      const sigma = sigmaWeek * Math.sqrt(t + 1);
      const p = sigma > 0 ? normalCdf(-cell.projectedOnHand / sigma) : cell.projectedOnHand < 0 ? 1 : 0;
      if (!best || p > best.probability) best = { nodeId: row.nodeId, skuId: row.skuId, probability: p, weekStart: cell.weekStart, projected: cell.projectedOnHand, sigma };
    }
    if (best) out.push(best);
  }
  return out.sort((a, b) => b.probability - a.probability);
}
