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
import raw from '../../../../data/synthetic/dataset.json';

export interface LogEntry {
  at: string;
  actor: string;
  text: string;
}

interface RamoPlanState {
  dataset: RamoDataset;
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

const dataset = raw as unknown as RamoDataset;
const issues = validateDataset(dataset);
if (issues.length > 0) console.warn('[ramo] dataset con problemas de integridad', issues);

const now = () => new Date().toISOString();
let seq = 0;
const nextId = (p: string) => `${p}-${Date.now().toString(36)}-${seq++}`;

export function RamoPlanProvider({ children }: { children: ReactNode }) {
  const [stage, setStage] = useState<CycleStage>('DRAFT');
  const [crewMode, setCrewMode] = useState<CrewMode>('POOLED');
  const [decisions, setDecisions] = useState<CapacityDecision[]>([]);
  const [adjustments, setAdjustments] = useState<MpsAdjustment[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);

  const { baseNet, weeks } = useMemo(() => {
    const n1 = dataset.versions.filter((v) => v.kind === 'WEEKLY_N1').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    const pbo = dataset.versions.filter((v) => v.kind === 'PBO_MONTHLY').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    const net = computeNetProduction(dataset, demandForHorizon(dataset, n1.id, pbo.id));
    return { baseNet: net, weeks: [...new Set(net.map((r) => r.weekStart))].sort() };
  }, []);

  const miguelView = useMemo(
    () =>
      snapshotCycle(dataset, baseNet, {
        decisions,
        adjustments: CYCLE_ORDER.indexOf(stage) >= CYCLE_ORDER.indexOf('MPS_FINAL') ? adjustments : [],
      }, { crewMode }),
    [baseNet, decisions, adjustments, stage, crewMode],
  );
  const danielView = useMemo(() => snapshotCycle(dataset, baseNet, { decisions, adjustments }, { crewMode }), [baseNet, decisions, adjustments, crewMode]);

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

  const value: RamoPlanState = {
    dataset,
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
