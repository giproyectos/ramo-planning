import { CapacityDecision, RamoDataset, toProductiveQty } from '@ramo/domain';
import { lineAvailableHours } from './calendar';
import { CrewMode, requiredLineHours } from './crp';
import { NetPlanRow } from './mps';

/**
 * Optimizador de capacidad (sugerencia, no decisión): cuando una tripulación queda sobre su capacidad en una semana, primero intenta
 * ADELANTAR producción a semanas anteriores con holgura (la que menos inventario extra genera: la más cercana) y, lo que no se
 * pueda mover, lo propone como horas extra. No toca el flujo bajo pedido (Hard Discount y Exportaciones no se adelantan).
 *
 * Es una heurística voraz, no un óptimo matemático: se lee y se corrige a mano. Ver ADR 0009.
 */

export interface RebalanceMove {
  skuId: string;
  fromWeek: string;
  toWeek: string;
  /** Cajas que se adelantan. */
  qty: number;
  hours: number;
}

export interface RebalanceExtra {
  crewId: string;
  weekStart: string;
  hours: number;
}

export interface RebalancePlan {
  moves: RebalanceMove[];
  extraHours: RebalanceExtra[];
  /** Horas que faltaban antes de la sugerencia (suma de excesos). */
  excessBefore: number;
  /** Horas que se resuelven moviendo producción. */
  movedHours: number;
  /** Horas que quedan para horas extra. */
  extraTotal: number;
  /** Semanas/tripulaciones sobre capacidad. */
  overloaded: number;
}

export interface RebalanceOptions {
  crewMode?: CrewMode;
  /** Cuántas semanas hacia atrás se puede adelantar producción (por defecto 3). */
  maxShiftWeeks?: number;
  /** Se llena cada semana receptora hasta este % de su capacidad (por defecto 98 %: deja un margen). */
  fillToPct?: number;
  /** Horas extra ya decididas (descuentan del faltante). */
  decisions?: CapacityDecision[];
}

const EPS = 1e-6;
const round1 = (n: number) => Math.round(n * 10) / 10;

interface Resource {
  id: string;
  crewId: string;
  lineIds: string[];
}

export function suggestRebalance(ds: RamoDataset, net: NetPlanRow[], options: RebalanceOptions = {}): RebalancePlan {
  const mode = options.crewMode ?? 'POOLED';
  const maxShift = options.maxShiftWeeks ?? 3;
  const fill = (options.fillToPct ?? 98) / 100;
  const decisions = options.decisions ?? [];
  const weeks = [...new Set(net.map((r) => r.weekStart))].sort();

  // Recurso = tripulación (horas agrupadas) o línea (independientes).
  const resources: Resource[] =
    mode === 'POOLED'
      ? ds.crews.map((c) => ({ id: c.id, crewId: c.id, lineIds: c.lineIds }))
      : ds.lines.map((l) => ({ id: l.id, crewId: l.crewId, lineIds: [l.id] }));

  // Producción de trabajo (se va modificando al mover) por SKU y semana.
  const work = new Map<string, number>(net.map((r) => [`${r.skuId}|${r.weekStart}`, r.netProduction]));
  const mto = new Map<string, number>(net.map((r) => [`${r.skuId}|${r.weekStart}`, r.grossMto]));
  const sku = (id: string) => ds.skus.find((s) => s.id === id)!;
  const hoursPerCaja = (skuId: string) => {
    const s = sku(skuId);
    const line = ds.lines.find((l) => l.id === s.lineId);
    return line ? toProductiveQty(s, 1) / line.rate.value : 0;
  };

  const required = (r: Resource, w: string) => {
    let h = 0;
    for (const lid of r.lineIds) {
      for (const s of ds.skus.filter((x) => x.lineId === lid)) h += (work.get(`${s.id}|${w}`) ?? 0) * hoursPerCaja(s.id);
    }
    return h;
  };
  const available = (r: Resource, w: string) => {
    let h = 0;
    for (const lid of r.lineIds) {
      const cal = ds.calendars.find((c) => c.lineId === lid);
      if (cal) h += lineAvailableHours(cal, w);
    }
    const extra = r.lineIds.length > 0 ? decisions.filter((d) => d.crewId === r.crewId && d.weekStart === w).reduce((a, d) => a + d.extraHours, 0) : 0;
    // En modo independiente las horas extra de la tripulación se reparten por igual entre sus líneas (aproximación).
    const linesOfCrew = ds.lines.filter((l) => l.crewId === r.crewId).length || 1;
    return h + (mode === 'POOLED' ? extra : extra / linesOfCrew);
  };

  const moves = new Map<string, RebalanceMove>();
  const extraByKey = new Map<string, RebalanceExtra>();
  let excessBefore = 0;
  let movedHours = 0;
  let overloaded = 0;

  for (const r of resources) {
    for (let wi = 0; wi < weeks.length; wi++) {
      const w = weeks[wi];
      let excess = required(r, w) - available(r, w);
      // Mismo umbral que el CRP (que redondea a 0,1 h): restos de milésimas de hora no son una sobrecarga.
      if (excess <= 0.05) continue;
      overloaded += 1;
      excessBefore += excess;

      // Semanas receptoras: las más cercanas hacia atrás primero.
      for (let k = 1; k <= maxShift && excess > EPS && wi - k >= 0; k++) {
        const target = weeks[wi - k];
        const cap = available(r, target) * fill;
        let slack = cap - required(r, target);
        if (slack <= EPS) continue;
        let toMove = Math.min(excess, slack);

        // SKUs de este recurso con producción movible (solo la parte que no es bajo pedido).
        const movable = r.lineIds
          .flatMap((lid) => ds.skus.filter((s) => s.lineId === lid))
          .map((s) => ({ s, qty: Math.max(0, (work.get(`${s.id}|${w}`) ?? 0) - (mto.get(`${s.id}|${w}`) ?? 0)) }))
          .filter((x) => x.qty > EPS && hoursPerCaja(x.s.id) > 0);
        const movableHours = movable.reduce((a, x) => a + x.qty * hoursPerCaja(x.s.id), 0);
        if (movableHours <= EPS) break;
        toMove = Math.min(toMove, movableHours);

        for (const x of movable) {
          const hpc = hoursPerCaja(x.s.id);
          const share = (x.qty * hpc) / movableHours;
          const qty = Math.min(x.qty, Math.floor((toMove * share) / hpc));
          if (qty <= 0) continue;
          work.set(`${x.s.id}|${w}`, (work.get(`${x.s.id}|${w}`) ?? 0) - qty);
          work.set(`${x.s.id}|${target}`, (work.get(`${x.s.id}|${target}`) ?? 0) + qty);
          const key = `${x.s.id}|${w}|${target}`;
          const prev = moves.get(key);
          const h = qty * hpc;
          if (prev) { prev.qty += qty; prev.hours += h; }
          else moves.set(key, { skuId: x.s.id, fromWeek: w, toWeek: target, qty, hours: h });
        }
        const newExcess = required(r, w) - available(r, w);
        movedHours += Math.max(0, excess - Math.max(0, newExcess));
        excess = Math.max(0, newExcess);
        slack = cap - required(r, target);
      }

      if (excess > 0.05) {
        const key = `${r.crewId}|${w}`;
        const prev = extraByKey.get(key);
        const hours = Math.ceil(excess * 2) / 2; // se pide en medias horas
        extraByKey.set(key, { crewId: r.crewId, weekStart: w, hours: (prev?.hours ?? 0) + hours });
      }
    }
  }

  const extraHours = [...extraByKey.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart) || a.crewId.localeCompare(b.crewId));
  const out = [...moves.values()]
    .map((m) => ({ ...m, hours: round1(m.hours) }))
    .sort((a, b) => a.fromWeek.localeCompare(b.fromWeek) || a.skuId.localeCompare(b.skuId));
  return {
    moves: out,
    extraHours,
    excessBefore: round1(excessBefore),
    movedHours: round1(movedHours),
    extraTotal: round1(extraHours.reduce((a, e) => a + e.hours, 0)),
    overloaded,
  };
}

/** Convierte los movimientos en ajustes al MPS (restan en la semana origen y suman en la destino). */
export function movesToAdjustments(moves: RebalanceMove[]): { skuId: string; weekStart: string; deltaCommercialQty: number }[] {
  return moves.flatMap((m) => [
    { skuId: m.skuId, weekStart: m.fromWeek, deltaCommercialQty: -m.qty },
    { skuId: m.skuId, weekStart: m.toWeek, deltaCommercialQty: m.qty },
  ]);
}

/** Horas requeridas de una línea tras aplicar los movimientos (para comprobar el efecto). */
export function hoursAfterMoves(ds: RamoDataset, net: NetPlanRow[], moves: RebalanceMove[], lineId: string, weekStart: string): number {
  const adjusted = net.map((r) => ({ ...r }));
  for (const a of movesToAdjustments(moves)) {
    const row = adjusted.find((r) => r.skuId === a.skuId && r.weekStart === a.weekStart);
    if (row) row.netProduction = Math.max(0, row.netProduction + a.deltaCommercialQty);
  }
  return requiredLineHours(ds, adjusted, lineId, weekStart);
}
