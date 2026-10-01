import React, { ReactNode, createContext, useCallback, useContext, useMemo, useState } from 'react';
import { CapacityDecision, MpsAdjustment, RamoDataset, validateDataset } from '@ramo/domain';
import {
  CYCLE_ORDER,
  CrewMode,
  CycleSnapshot,
  CycleStage,
  NetPlanRow,
  computeNetProduction,
  demandForHorizon,
  snapshotCycle,
} from '@ramo/engine';
import { Baseline, IngestTexts, applyBaseline, ingestBaseline } from '@ramo/ingest';
import raw from '../../../../data/synthetic/dataset.json';

export interface LogEntry {
  at: string;
  actor: string;
  text: string;
}

interface RamoPlanState {
  /** Dataset activo: el sintético, o el mismo con el inventario de la línea base SAP si hay una cargada. */
  dataset: RamoDataset;
  baseline: Baseline | null;
  baselineCutAt: string;
  loadBaseline: (texts: IngestTexts, cutAt: string) => Baseline;
  clearBaseline: () => void;
  weeks: string[];
  baseNet: NetPlanRow[];
  stage: CycleStage;
  crewMode: CrewMode;
  decisions: CapacityDecision[];
  adjustments: MpsAdjustment[];
  log: LogEntry[];
  /** Vista de Miguel: sus decisiones y, solo desde el MPS final, los ajustes de Daniel. */
  miguelView: CycleSnapshot;
  /** Vista de Daniel: decisiones de Miguel más sus propios ajustes en vivo. */
  danielView: CycleSnapshot;
  setCrewMode: (m: CrewMode) => void;
  addDecision: (d: Omit<CapacityDecision, 'id' | 'createdAt'>) => void;
  removeDecision: (id: string) => void;
  addAdjustment: (a: Omit<MpsAdjustment, 'id' | 'createdAt'>) => void;
  removeAdjustment: (id: string) => void;
  advance: (to: CycleStage, actor: string, text: string) => void;
  reset: () => void;
}

const Ctx = createContext<RamoPlanState | null>(null);

const baseDataset = raw as unknown as RamoDataset;
const issues = validateDataset(baseDataset);
if (issues.length > 0) console.warn('[ramo] dataset con problemas de integridad', issues);

export const DEFAULT_CUT_AT = '2026-10-05T08:00';

const now = () => new Date().toISOString();
let seq = 0;
const nextId = (p: string) => `${p}-${Date.now().toString(36)}-${seq++}`;

export function RamoPlanProvider({ children }: { children: ReactNode }) {
  const [stage, setStage] = useState<CycleStage>('DRAFT');
  const [crewMode, setCrewMode] = useState<CrewMode>('POOLED');
  const [decisions, setDecisions] = useState<CapacityDecision[]>([]);
  const [adjustments, setAdjustments] = useState<MpsAdjustment[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const [baselineCutAt, setBaselineCutAt] = useState(DEFAULT_CUT_AT);

  const dataset = useMemo(() => (baseline?.usable ? applyBaseline(baseDataset, baseline) : baseDataset), [baseline]);

  const { baseNet, weeks } = useMemo(() => {
    const n1 = baseDataset.versions.filter((v) => v.kind === 'WEEKLY_N1').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    const pbo = baseDataset.versions.filter((v) => v.kind === 'PBO_MONTHLY').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    const net = computeNetProduction(dataset, demandForHorizon(dataset, n1.id, pbo.id));
    return { baseNet: net, weeks: [...new Set(net.map((r) => r.weekStart))].sort() };
  }, [dataset]);

  const miguelView = useMemo(
    () =>
      snapshotCycle(dataset, baseNet, {
        decisions,
        adjustments: CYCLE_ORDER.indexOf(stage) >= CYCLE_ORDER.indexOf('MPS_FINAL') ? adjustments : [],
      }, { crewMode }),
    [dataset, baseNet, decisions, adjustments, stage, crewMode],
  );
  const danielView = useMemo(() => snapshotCycle(dataset, baseNet, { decisions, adjustments }, { crewMode }), [dataset, baseNet, decisions, adjustments, crewMode]);

  const addLog = useCallback((actor: string, text: string) => setLog((l) => [{ at: now(), actor, text }, ...l]), []);

  const addDecision = useCallback<RamoPlanState['addDecision']>(
    (d) => {
      setDecisions((prev) => [...prev, { ...d, id: nextId('dec'), createdAt: now() }]);
      addLog(d.author, `+${d.extraHours} h extra en ${d.crewId} (sem. ${d.weekStart}): ${d.reason}`);
    },
    [addLog],
  );
  const addAdjustment = useCallback<RamoPlanState['addAdjustment']>(
    (a) => {
      setAdjustments((prev) => [...prev, { ...a, id: nextId('adj'), createdAt: now() }]);
      addLog(a.author, `Ajuste ${a.deltaCommercialQty > 0 ? '+' : ''}${a.deltaCommercialQty} cajas de ${a.skuId} (sem. ${a.weekStart}): ${a.reason}`);
    },
    [addLog],
  );

  const loadBaseline = useCallback((texts: IngestTexts, cutAt: string) => {
    const b = ingestBaseline({ dataset: baseDataset, cutAt }, texts);
    setBaseline(b);
    setBaselineCutAt(cutAt);
    const errors = b.issues.filter((i) => i.severity === 'error').length;
    const warnings = b.issues.filter((i) => i.severity === 'warning').length;
    addLog('Sistema', b.usable
      ? `Bases SAP cargadas (corte ${cutAt.replace('T', ' ')}): inventario disponible actualizado; ${errors} error(es), ${warnings} advertencia(s)`
      : `Bases SAP rechazadas: ${errors} error(es); se mantiene el inventario sintético`);
    return b;
  }, [addLog]);

  const value: RamoPlanState = {
    dataset,
    baseline,
    baselineCutAt,
    loadBaseline,
    clearBaseline: () => {
      setBaseline(null);
      addLog('Sistema', 'Bases SAP retiradas: se vuelve al inventario sintético');
    },
    weeks,
    baseNet,
    stage,
    crewMode,
    decisions,
    adjustments,
    log,
    miguelView,
    danielView,
    setCrewMode,
    addDecision,
    removeDecision: (id) => setDecisions((p) => p.filter((d) => d.id !== id)),
    addAdjustment,
    removeAdjustment: (id) => setAdjustments((p) => p.filter((a) => a.id !== id)),
    advance: (to, actor, text) => {
      setStage(to);
      addLog(actor, text);
    },
    reset: () => {
      setStage('DRAFT');
      setDecisions([]);
      setAdjustments([]);
      setLog([]);
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRamoPlan(): RamoPlanState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useRamoPlan debe usarse dentro de RamoPlanProvider');
  return v;
}
