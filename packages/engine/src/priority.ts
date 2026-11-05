import { CapacityDecision, RamoDataset, toProductiveQty } from '@ramo/domain';
import { CrewMode, computeCrp } from './crp';
import { NetPlanRow } from './mps';

/**
 * Priorización cuando no alcanza: si ni las horas extra ni adelantar producción resuelven una semana, hay que decidir qué producto se
 * deja de producir. Para cada tripulación-semana sobre su capacidad se recorta producción hasta que quepa, empezando por lo menos
 * prioritario. Lo bajo pedido (Hard Discount y Exportaciones) nunca se recorta. Es una sugerencia que decide una persona. Ver ADR 0011.
 *
 *  - RISK: se protege lo que tiene más riesgo de quiebre en la red; se recorta primero lo de menor riesgo.
 *  - VALUE: se protege lo de mayor valor (costo por caja × cajas); se recorta primero lo de menor valor.
 *  - EVEN: se recorta parejo, en proporción a las horas que pide cada producto.
 */
export type PriorityRule = 'RISK' | 'VALUE' | 'EVEN';

export interface PriorityCut {
  skuId: string;
  weekStart: string;
  crewId: string;
  /** Cajas que se dejan de producir. */
  qty: number;
  hours: number;
}

export interface PriorityPlan {
  rule: PriorityRule;
  cuts: PriorityCut[];
  /** Tripulación-semanas sobre capacidad antes de recortar. */
  overloaded: number;
  hoursCut: number;
  qtyCut: number;
  /** Horas que siguen faltando porque lo que queda es bajo pedido (no se recorta). */
  unresolvedHours: number;
  bySku: { skuId: string; qty: number; hours: number }[];
}

export interface PriorityOptions {
  rule: PriorityRule;
  /** Probabilidad de quiebre (0–1) por producto; solo la usa la regla RISK. */
  riskBySku?: Record<string, number>;
  crewMode?: CrewMode;
  decisions?: CapacityDecision[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function prioritizeCuts(ds: RamoDataset, net: NetPlanRow[], options: PriorityOptions): PriorityPlan {
  const capacity = computeCrp(ds, net, { crewMode: options.crewMode, decisions: options.decisions });
  const hpc = (skuId: string) => {
    const s = ds.skus.find((x) => x.id === skuId);
    const l = ds.lines.find((x) => x.id === s?.lineId);
    return s && l ? toProductiveQty(s, 1) / l.rate.value : 0;
  };
  const cuts: PriorityCut[] = [];
  let overloaded = 0;
  let unresolved = 0;

  for (const week of capacity) {
    for (const crew of week.crews) {
      if (crew.excessHours <= 0.05) continue;
      overloaded += 1;
      const cands = ds.skus
        .filter((s) => crew.lineIds.includes(s.lineId))
        .map((s) => {
          const row = net.find((r) => r.skuId === s.id && r.weekStart === week.weekStart);
          const cuttable = Math.max(0, (row?.netProduction ?? 0) - (row?.grossMto ?? 0));
          return { sku: s, cuttable, h: hpc(s.id) };
        })
        .filter((c) => c.cuttable > 0 && c.h > 0);
      let remaining = crew.excessHours;

      if (options.rule === 'EVEN') {
        const totalH = cands.reduce((a, c) => a + c.cuttable * c.h, 0);
        for (const c of cands) {
          if (totalH <= 0) break;
          const wantH = crew.excessHours * ((c.cuttable * c.h) / totalH);
          const qty = Math.min(c.cuttable, Math.ceil(wantH / c.h - 1e-9));
          if (qty > 0) { cuts.push({ skuId: c.sku.id, weekStart: week.weekStart, crewId: crew.crewId, qty, hours: qty * c.h }); remaining -= qty * c.h; }
        }
      } else {
        const score = (c: (typeof cands)[number]) => (options.rule === 'RISK' ? options.riskBySku?.[c.sku.id] ?? 0 : c.sku.costPerCommercial * c.cuttable);
        const tie = (c: (typeof cands)[number]) => c.sku.costPerCommercial * c.cuttable;
        const ordered = [...cands].sort((a, b) => score(a) - score(b) || tie(a) - tie(b) || a.sku.id.localeCompare(b.sku.id));
        for (const c of ordered) {
          if (remaining <= 0.05) break;
          const qty = Math.min(c.cuttable, Math.ceil(remaining / c.h - 1e-9));
          if (qty > 0) { cuts.push({ skuId: c.sku.id, weekStart: week.weekStart, crewId: crew.crewId, qty, hours: qty * c.h }); remaining -= qty * c.h; }
        }
      }
      if (remaining > 0.05) unresolved += remaining;
    }
  }

  const bySku = [...new Set(cuts.map((c) => c.skuId))].map((skuId) => {
    const mine = cuts.filter((c) => c.skuId === skuId);
    return { skuId, qty: mine.reduce((a, c) => a + c.qty, 0), hours: round1(mine.reduce((a, c) => a + c.hours, 0)) };
  }).sort((a, b) => b.hours - a.hours);
  return {
    rule: options.rule,
    cuts: cuts.map((c) => ({ ...c, hours: round1(c.hours) })).sort((a, b) => a.weekStart.localeCompare(b.weekStart) || a.skuId.localeCompare(b.skuId)),
    overloaded,
    hoursCut: round1(cuts.reduce((a, c) => a + c.hours, 0)),
    qtyCut: cuts.reduce((a, c) => a + c.qty, 0),
    unresolvedHours: round1(unresolved),
    bySku,
  };
}

/** Convierte los recortes en ajustes negativos al MPS. */
export function cutsToAdjustments(cuts: PriorityCut[]): { skuId: string; weekStart: string; deltaCommercialQty: number }[] {
  return cuts.map((c) => ({ skuId: c.skuId, weekStart: c.weekStart, deltaCommercialQty: -c.qty }));
}
