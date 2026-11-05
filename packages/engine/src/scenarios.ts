import { RamoDataset, toProductiveQty } from '@ramo/domain';
import { DailyResult } from './daily';

/** Cifras para comparar escenarios de programación (el plan vigente, el borrador y los escenarios guardados). */
export interface ScheduleMetrics {
  /** Horas que faltan en todo el horizonte (suma de los días sobre capacidad); son las horas extra que habría que pedir. */
  excessHours: number;
  /** Horas de cajas que no tienen día de producción (producto fuera del esquema o con todos sus días cerrados). */
  unscheduledHours: number;
  /** Días-línea sobre el 100 % de su capacidad. */
  overDays: number;
  /** Horas perdidas en cambios de producto. */
  changeoverHours: number;
  crewConflicts: number;
  ruleViolations: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function scheduleMetrics(ds: RamoDataset, result: DailyResult): ScheduleMetrics {
  const cells = result.weeks.flatMap((w) => w.cells);
  const unscheduled = result.weeks.reduce(
    (a, w) =>
      a +
      w.unscheduled.reduce((b, u) => {
        const s = ds.skus.find((x) => x.id === u.skuId);
        const l = ds.lines.find((x) => x.id === s?.lineId);
        return s && l ? b + toProductiveQty(s, u.qty) / l.rate.value : b;
      }, 0),
    0,
  );
  return {
    excessHours: round1(cells.reduce((a, c) => a + c.excessHours, 0)),
    unscheduledHours: round1(unscheduled),
    overDays: cells.filter((c) => c.excessHours > 0.05).length,
    changeoverHours: round1(cells.reduce((a, c) => a + c.changeoverHours, 0)),
    crewConflicts: result.alerts.filter((a) => a.code === 'CREW_CONFLICT').length,
    ruleViolations: result.alerts.filter((a) => a.code === 'RULE_VIOLATION').length,
  };
}
