import { CapacityDecision, RamoDataset, toProductiveQty } from '@ramo/domain';
import { lineAvailableHours } from './calendar';
import { NetPlanRow } from './mps';

export type LoadStatus = 'OK' | 'OVER' | 'CRITICAL';

/** POOLED: las líneas que comparten tripulación suman horas requeridas y disponibles (supuesto provisional, ver ADR 0001).
 *  INDEPENDENT: cada línea responde sola; sobra en una no cubre a la otra. */
export type CrewMode = 'POOLED' | 'INDEPENDENT';

export interface LineLoad {
  lineId: string;
  requiredHours: number;
  availableHours: number;
  saturationPct: number;
  status: LoadStatus;
}

export interface CrewLoad {
  crewId: string;
  lineIds: string[];
  requiredHours: number;
  availableHours: number;
  /** Horas extra ya decididas para esta tripulación y semana. */
  extraHours: number;
  saturationPct: number;
  /** Horas que faltan después de aplicar las horas extra decididas. */
  excessHours: number;
  status: LoadStatus;
}

export interface WeekCapacity {
  weekStart: string;
  lines: LineLoad[];
  crews: CrewLoad[];
}

export interface CrpOptions {
  crewMode?: CrewMode;
  decisions?: CapacityDecision[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function statusOf(saturationPct: number): LoadStatus {
  return saturationPct > 110 ? 'CRITICAL' : saturationPct > 100 ? 'OVER' : 'OK';
}

function saturation(required: number, available: number): number {
  if (available > 0) return (required / available) * 100;
  return required > 0 ? 999 : 0;
}

/** Horas de línea que exige la producción neta: unidades productivas ÷ ritmo. */
export function requiredLineHours(ds: RamoDataset, net: NetPlanRow[], lineId: string, weekStart: string): number {
  const line = ds.lines.find((l) => l.id === lineId);
  if (!line) return 0;
  let hours = 0;
  for (const row of net) {
    if (row.weekStart !== weekStart) continue;
    const sku = ds.skus.find((s) => s.id === row.skuId);
    if (!sku || sku.lineId !== lineId) continue;
    hours += toProductiveQty(sku, row.netProduction) / line.rate.value;
  }
  return hours;
}

/** CRP: saturación por línea y por tripulación, semana a semana. */
export function computeCrp(ds: RamoDataset, net: NetPlanRow[], options: CrpOptions = {}): WeekCapacity[] {
  const mode = options.crewMode ?? 'POOLED';
  const decisions = options.decisions ?? [];
  const weeks = [...new Set(net.map((r) => r.weekStart))].sort();

  return weeks.map((weekStart) => {
    const lineLoads = ds.lines.map((line) => {
      const cal = ds.calendars.find((c) => c.lineId === line.id);
      const available = cal ? lineAvailableHours(cal, weekStart) : 0;
      const required = requiredLineHours(ds, net, line.id, weekStart);
      const pct = saturation(required, available);
      return { lineId: line.id, requiredHours: required, availableHours: available, pct };
    });

    const lines: LineLoad[] = lineLoads.map((l) => ({
      lineId: l.lineId,
      requiredHours: round1(l.requiredHours),
      availableHours: round1(l.availableHours),
      saturationPct: round1(l.pct),
      status: statusOf(l.pct),
    }));

    const crews: CrewLoad[] = ds.crews.map((crew) => {
      const own = lineLoads.filter((l) => crew.lineIds.includes(l.lineId));
      const required = own.reduce((a, l) => a + l.requiredHours, 0);
      const available = own.reduce((a, l) => a + l.availableHours, 0);
      const extra = decisions
        .filter((d) => d.crewId === crew.id && d.weekStart === weekStart)
        .reduce((a, d) => a + d.extraHours, 0);

      const rawExcess =
        mode === 'POOLED'
          ? Math.max(0, required - available)
          : own.reduce((a, l) => a + Math.max(0, l.requiredHours - l.availableHours), 0);
      const excess = Math.max(0, rawExcess - extra);
      const pct = saturation(required, available + extra);

      return {
        crewId: crew.id,
        lineIds: crew.lineIds,
        requiredHours: round1(required),
        availableHours: round1(available),
        extraHours: extra,
        saturationPct: round1(pct),
        excessHours: round1(excess),
        status: excess > 0 ? statusOf(Math.max(pct, 100.1)) : 'OK',
      };
    });

    return { weekStart, lines, crews };
  });
}
