import { CapacityDecision, MpsAdjustment, PlanVersionKind, RamoDataset } from '@ramo/domain';
import { CrpOptions, WeekCapacity, computeCrp } from './crp';
import { NetPlanRow, applyMpsAdjustments } from './mps';

/**
 * Ciclo semanal Miguel (CRP) ↔ Daniel (MPS final):
 *   DRAFT → SENT_TO_MPS → MPS_FINAL → FINAL_ALERTS
 * La necesidad llega a Miguel, él calcula capacidad y decide horas extra, se la envía a Daniel,
 * Daniel ajusta con el negocio y cierra el MPS final, y Miguel recalcula las alertas finales.
 */
export type CycleStage = 'DRAFT' | 'SENT_TO_MPS' | 'MPS_FINAL' | 'FINAL_ALERTS';

export const CYCLE_ORDER: CycleStage[] = ['DRAFT', 'SENT_TO_MPS', 'MPS_FINAL', 'FINAL_ALERTS'];

/** Versión de plan que produce cada etapa (para trazabilidad en PlanVersion). */
export const STAGE_VERSION_KIND: Record<CycleStage, PlanVersionKind | null> = {
  DRAFT: null,
  SENT_TO_MPS: 'CRP_PROPOSAL',
  MPS_FINAL: 'MPS_FINAL',
  FINAL_ALERTS: null,
};

export interface OverloadAlert {
  weekStart: string;
  crewId: string;
  excessHours: number;
  saturationPct: number;
}

export function overloadAlerts(capacity: WeekCapacity[]): OverloadAlert[] {
  return capacity.flatMap((w) =>
    w.crews
      .filter((c) => c.excessHours > 0)
      .map((c) => ({ weekStart: w.weekStart, crewId: c.crewId, excessHours: c.excessHours, saturationPct: c.saturationPct })),
  );
}

export interface CycleSnapshot {
  net: NetPlanRow[];
  capacity: WeekCapacity[];
  alerts: OverloadAlert[];
}

/** Estado del plan dadas las decisiones de Miguel y los ajustes de Daniel. */
export function snapshotCycle(
  ds: RamoDataset,
  baseNet: NetPlanRow[],
  inputs: { decisions: CapacityDecision[]; adjustments: MpsAdjustment[] },
  options: Omit<CrpOptions, 'decisions'> = {},
): CycleSnapshot {
  const net = applyMpsAdjustments(baseNet, inputs.adjustments);
  const capacity = computeCrp(ds, net, { ...options, decisions: inputs.decisions });
  return { net, capacity, alerts: overloadAlerts(capacity) };
}
