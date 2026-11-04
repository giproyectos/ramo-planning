import { CapacityDecision, RamoDataset } from '@ramo/domain';
import { CrewMode } from './crp';
import { NetPlanRow } from './mps';
import { RebalancePlan, suggestRebalance } from './rebalance';
import { DailyBalancePlan, DailyResult, suggestDailyBalance } from './daily';

/**
 * Alternativas para resolver una sobrecarga: en vez de una sola sugerencia, varias formas de resolverla con lo que cuesta cada una.
 * Sigue siendo una sugerencia que decide una persona. Ver ADR 0011.
 *
 * Costo comparable: 1 hora extra pesa EXTRA_HOUR_WEIGHT horas-semana de producción adelantada; 1 hora que queda sin cubrir pesa
 * UNMET_HOUR_WEIGHT. Son pesos declarados (se discuten con Producción), no una verdad.
 */
export const EXTRA_HOUR_WEIGHT = 3;
export const UNMET_HOUR_WEIGHT = 12;

export type AlternativeId = 'MIN_INVENTORY' | 'BALANCED' | 'NO_OVERTIME';

export interface AlternativeMetrics {
  /** Horas de producción que se mueven a otra semana/día. */
  movedHours: number;
  /** Cajas movidas. */
  movedQty: number;
  /** Horas extra que hay que pedir. */
  extraHours: number;
  /** Horas que quedan sin cubrir (solo la alternativa "sin horas extra"). */
  unmetHours: number;
  /** Horas movidas × semanas (o días) de anticipación: cuánto inventario extra se genera. */
  advanceHourPeriods: number;
  /** Costo relativo (menor es mejor) con los pesos declarados. */
  cost: number;
}

export interface Alternative<P> {
  id: AlternativeId;
  label: string;
  description: string;
  plan: P;
  metrics: AlternativeMetrics;
  recommended: boolean;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const weeksBetween = (a: string, b: string) => Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 604800000);
const daysBetween = (a: string, b: string) => Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86400000);

function mark<P>(list: Omit<Alternative<P>, 'recommended'>[]): Alternative<P>[] {
  const best = list.reduce((a, b) => (b.metrics.cost < a.metrics.cost ? b : a));
  return list.map((x) => ({ ...x, recommended: x.id === best.id }));
}

export interface WeeklyAlternativeOptions {
  crewMode?: CrewMode;
  decisions?: CapacityDecision[];
}

/** Tres formas de resolver las semanas sobre capacidad: adelantar poco, adelantar lo razonable, o no pedir horas extra. */
export function weeklyAlternatives(ds: RamoDataset, net: NetPlanRow[], options: WeeklyAlternativeOptions = {}): Alternative<RebalancePlan>[] {
  const base = { crewMode: options.crewMode, decisions: options.decisions };
  const defs: { id: AlternativeId; label: string; description: string; plan: RebalancePlan; noOvertime: boolean }[] = [
    {
      id: 'MIN_INVENTORY',
      label: 'Poco inventario extra',
      description: 'Adelanta producción máximo una semana; lo demás se resuelve con horas extra.',
      plan: suggestRebalance(ds, net, { ...base, maxShiftWeeks: 1 }),
      noOvertime: false,
    },
    {
      id: 'BALANCED',
      label: 'Equilibrada',
      description: 'Adelanta producción hasta tres semanas, llenando las semanas con holgura; lo que no cabe va a horas extra.',
      plan: suggestRebalance(ds, net, { ...base, maxShiftWeeks: 3 }),
      noOvertime: false,
    },
    {
      id: 'NO_OVERTIME',
      label: 'Sin horas extra',
      description: 'Adelanta hasta seis semanas y llena la capacidad al 100 %. Lo que no quepa queda sin cubrir y hay que decidir qué hacer.',
      plan: suggestRebalance(ds, net, { ...base, maxShiftWeeks: 6, fillToPct: 100 }),
      noOvertime: true,
    },
  ];
  return mark(
    defs.map((d) => {
      const moved = d.plan.moves.reduce((a, m) => a + m.hours, 0);
      const advance = d.plan.moves.reduce((a, m) => a + m.hours * weeksBetween(m.toWeek, m.fromWeek), 0);
      const extra = d.noOvertime ? 0 : d.plan.extraTotal;
      const unmet = d.noOvertime ? d.plan.extraTotal : 0;
      return {
        id: d.id,
        label: d.label,
        description: d.description,
        // En "sin horas extra" no se pide nada: el resto queda como faltante y no se aplica como decisión de horas extra.
        plan: d.noOvertime ? { ...d.plan, extraHours: [], extraTotal: 0 } : d.plan,
        metrics: {
          movedHours: round1(moved),
          movedQty: Math.round(d.plan.moves.reduce((a, m) => a + m.qty, 0)),
          extraHours: round1(extra),
          unmetHours: round1(unmet),
          advanceHourPeriods: round1(advance),
          cost: round1(advance + extra * EXTRA_HOUR_WEIGHT + unmet * UNMET_HOUR_WEIGHT),
        },
      };
    }),
  );
}

/** Tres formas de resolver los días sobre capacidad: solo días en que ya se produce, usar también días libres, o solo horas extra. */
export function dailyAlternatives(ds: RamoDataset, result: DailyResult): Alternative<DailyBalancePlan>[] {
  const defs: { id: AlternativeId; label: string; description: string; plan: DailyBalancePlan }[] = [
    {
      id: 'MIN_INVENTORY',
      label: 'Solo días de producción',
      description: 'Pasa producción únicamente a días en que el producto ya se fabrica según el esquema; el resto va a horas extra.',
      plan: suggestDailyBalance(ds, result, { allowNewDays: false }),
    },
    {
      id: 'BALANCED',
      label: 'Usar también días libres',
      description: 'Además de los días del esquema, abre días libres en que la tripulación no esté en otra línea.',
      plan: suggestDailyBalance(ds, result, { allowNewDays: true }),
    },
    {
      id: 'NO_OVERTIME',
      label: 'Solo horas extra',
      description: 'No mueve nada: deja el esquema como está y cubre el exceso con horas extra.',
      plan: suggestDailyBalance(ds, result, { fillToPct: 0 }),
    },
  ];
  return mark(
    defs.map((d) => {
      const advance = d.plan.moves.reduce((a, m) => a + m.hours * Math.max(0, daysBetween(m.toDate, m.fromDate)), 0);
      return {
        id: d.id,
        label: d.label,
        description: d.description,
        plan: d.plan,
        metrics: {
          movedHours: d.plan.movedHours,
          movedQty: Math.round(d.plan.moves.reduce((a, m) => a + m.qty, 0)),
          extraHours: d.plan.extraTotal,
          unmetHours: 0,
          advanceHourPeriods: round1(advance),
          // Los días de anticipación se pasan a semanas (÷7) para que el costo sea comparable; abrir un día nuevo suma un pequeño costo fijo.
          cost: round1(advance / 7 + d.plan.extraTotal * EXTRA_HOUR_WEIGHT + d.plan.moves.filter((m) => m.kind === 'NEW_DAY').length * 0.5),
        },
      };
    }),
  );
}
