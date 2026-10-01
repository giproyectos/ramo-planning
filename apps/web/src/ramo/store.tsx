import React, { ReactNode, createContext, useCallback, useContext, useMemo, useState } from 'react';
import { BuildingBlock, CapacityDecision, DemandHistoryRow, DemandRecord, MpsAdjustment, RamoDataset, validateDataset } from '@ramo/domain';
import {
  CYCLE_ORDER,
  CrewMode,
  CycleSnapshot,
  FC_N1_ID,
  FC_PBO_ID,
  DrpResult,
  ForecastRun,
  SafetyPolicy,
  CycleStage,
  NetPlanRow,
  applyBuildingBlocks,
  computeNetProduction,
  demandForHorizon,
  plantRequirementRecords,
  runDrp,
  runForecast,
  snapshotCycle,
  withForecastVersions,
} from '@ramo/engine';
import { Baseline, IngestTexts, ParseResult, applyBaseline, ingestBaseline, parseDemandHistory } from '@ramo/ingest';
import { SAMPLE_HISTORY_LIMPIO } from './samples';
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
  /** Histórico de demanda leído y validado. */
  history: ParseResult<DemandHistoryRow>;
  historyLabel: string;
  loadHistory: (text: string, label: string) => ParseResult<DemandHistoryRow>;
  /** Primera semana pronosticada (lunes). */
  targetStart: string;
  /** Pronósticos PBO (mensual) y N+1 (semanal); null si el histórico no se pudo usar. */
  forecast: { pbo: ForecastRun; n1: ForecastRun } | null;
  /** Dataset con las versiones generadas por el pronóstico (PBO y N+1) y los building blocks. */
  forecastDs: RamoDataset | null;
  /** Demanda de consenso: N+1 con los building blocks aplicados. */
  consensus: DemandRecord[];
  /** Si es true, el MPS y el CRP usan el plan de demanda generado en vez de la demanda sintética fija. */
  useForecast: boolean;
  setUseForecast: (v: boolean) => void;
  /** DRP de la red (agencias → CEDI → planta); null si el dataset no define red. */
  drp: DrpResult | null;
  /** Si es true, la necesidad de producción del DRP es la entrada del MPS (y el inventario ya lo neteó el DRP). */
  useDrp: boolean;
  setUseDrp: (v: boolean) => void;
  drpPolicy: SafetyPolicy;
  setDrpPolicy: (p: SafetyPolicy) => void;
  staticDays: number;
  setStaticDays: (d: number) => void;
  /** Suponer que el flujo en camino durante el plazo es el de régimen (hasta cargar tránsito y órdenes abiertas reales). */
  drpPipeline: boolean;
  setDrpPipeline: (v: boolean) => void;
  /** Registra una decisión en el registro del ciclo (p. ej. el reparto de escasez aprobado). */
  logEvent: (actor: string, text: string) => void;
  userBlocks: BuildingBlock[];
  addBlock: (b: Omit<BuildingBlock, 'id' | 'versionId' | 'createdAt'>) => void;
  removeBlock: (id: string) => void;
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

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** Primer lunes en o después de la fecha (el plan siempre arranca en lunes). */
const nextMonday = (iso: string) => {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return addDays(iso, (8 - (dow === 0 ? 7 : dow)) % 7);
};

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

  const [historyText, setHistoryText] = useState(SAMPLE_HISTORY_LIMPIO);
  const [historyLabel, setHistoryLabel] = useState('ejemplo sintético limpio');
  const [useForecast, setUseForecast] = useState(true);
  const [userBlocks, setUserBlocks] = useState<BuildingBlock[]>([]);
  const [useDrpFlag, setUseDrp] = useState(true);
  const [drpPolicy, setDrpPolicy] = useState<SafetyPolicy>('DYNAMIC');
  const [staticDays, setStaticDays] = useState(3);
  const [drpPipeline, setDrpPipeline] = useState(true);

  const history = useMemo(() => parseDemandHistory(historyText, { dataset: baseDataset, cutAt: baselineCutAt }), [historyText, baselineCutAt]);
  const targetStart = useMemo(() => nextMonday(baselineCutAt.slice(0, 10)), [baselineCutAt]);

  const forecast = useMemo(() => {
    if (!history.ok) return null;
    const n1 = runForecast(baseDataset.skus, history.rows, { targetStart, horizonWeeks: 13 });
    // El PBO mensual se corrió 4 semanas antes: con menos historia y a mayor distancia.
    const pbo = runForecast(baseDataset.skus, history.rows, { targetStart, horizonWeeks: 13, trainedBefore: addDays(targetStart, -28) });
    return n1.skus.length > 0 ? { n1, pbo } : null;
  }, [history, targetStart]);

  const forecastDs = useMemo(
    () => (forecast ? withForecastVersions(baseDataset, { n1: forecast.n1, pbo: forecast.pbo, extraBlocks: userBlocks }) : null),
    [forecast, userBlocks],
  );
  const consensus = useMemo(() => (forecastDs ? applyBuildingBlocks(forecastDs, FC_N1_ID) : []), [forecastDs]);

  const usingForecast = useForecast && forecastDs !== null;
  const source = usingForecast ? forecastDs! : baseDataset;
  const dataset = useMemo(() => (baseline?.usable ? applyBaseline(source, baseline) : source), [source, baseline]);

  // Demanda del horizonte (N+1 con sus building blocks; el PBO completa si falta): es lo que entra al DRP.
  const horizonDemand = useMemo(() => {
    const latest = (kind: 'WEEKLY_N1' | 'PBO_MONTHLY') => baseDataset.versions.filter((v) => v.kind === kind).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0].id;
    const [n1Id, pboId] = usingForecast ? [FC_N1_ID, FC_PBO_ID] : [latest('WEEKLY_N1'), latest('PBO_MONTHLY')];
    return demandForHorizon(dataset, n1Id, pboId);
  }, [dataset, usingForecast]);

  // σ del error de pronóstico a 1 semana por SKU: base del stock de seguridad dinámico (solo si hay pronóstico).
  const sigmaBySku = useMemo(
    () => (usingForecast && forecast ? Object.fromEntries(forecast.n1.skus.map((s) => [s.skuId, s.backtest.sd[0]])) : undefined),
    [usingForecast, forecast],
  );

  const drp = useMemo(
    () => (dataset.nodes && dataset.nodes.length > 0 ? runDrp(dataset, horizonDemand, { policy: drpPolicy, staticDays, sigmaBySku, pipeline: drpPipeline ? 'STEADY_STATE' : 'NONE' }) : null),
    [dataset, horizonDemand, drpPolicy, staticDays, sigmaBySku, drpPipeline],
  );
  const usingDrp = useDrpFlag && drp !== null && drp.weeks.length > 0;

  const { baseNet, weeks } = useMemo(() => {
    if (!usingDrp || !drp) {
      const net = computeNetProduction(dataset, horizonDemand);
      return { baseNet: net, weeks: [...new Set(net.map((r) => r.weekStart))].sort() };
    }
    // El DRP ya neteó el inventario de la red: el MPS recibe su necesidad de producción (CEDI) más los pedidos bajo pedido,
    // y solo descuenta las órdenes en curso. Se rellenan con 0 las semanas sin necesidad para no perder columnas del horizonte.
    const required = plantRequirementRecords(drp);
    const have = new Set(required.map((r) => `${r.skuId}|${r.weekStart}`));
    const pad = dataset.skus.flatMap((s) => (drp.rows.some((r) => r.skuId === s.id) ? drp.weeks.filter((w) => !have.has(`${s.id}|${w}`)).map((w) => ({ versionId: 'DRP', skuId: s.id, weekStart: w, flow: 'CEDI' as const, commercialQty: 0 })) : []));
    const mto = horizonDemand.filter((d) => d.flow !== 'CEDI');
    const net = computeNetProduction({ ...dataset, inventory: [] }, [...required, ...pad, ...mto]);
    return { baseNet: net, weeks: [...new Set(net.map((r) => r.weekStart))].sort() };
  }, [dataset, horizonDemand, drp, usingDrp]);

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

  const loadHistory = useCallback((text: string, label: string) => {
    const parsed = parseDemandHistory(text, { dataset: baseDataset, cutAt: baselineCutAt });
    setHistoryText(text);
    setHistoryLabel(label);
    const errors = parsed.issues.filter((i) => i.severity === 'error').length;
    addLog('Sistema', parsed.ok
      ? `Histórico de demanda cargado (${label}): ${parsed.rows.length} filas válidas, ${errors} error(es); el pronóstico se recalcula`
      : `Histórico rechazado (${label}): ${errors} error(es); se mantiene el plan de demanda sintético`);
    return parsed;
  }, [addLog, baselineCutAt]);

  const addBlock = useCallback<RamoPlanState['addBlock']>(
    (b) => {
      setUserBlocks((prev) => [...prev, { ...b, id: nextId('bb'), versionId: FC_N1_ID, createdAt: now() }]);
      const scope = b.scope.skuId ?? b.scope.family ?? b.scope.businessUnit ?? 'todos los SKUs';
      addLog(b.author, `Building block ${b.deltaCommercialQty > 0 ? '+' : ''}${b.deltaCommercialQty} cajas · ${scope}${b.scope.weekStart ? ` (sem. ${b.scope.weekStart})` : ' (todas las semanas)'}: ${b.reason}`);
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
    history,
    historyLabel,
    loadHistory,
    targetStart,
    forecast,
    forecastDs,
    consensus,
    useForecast: usingForecast,
    setUseForecast,
    drp,
    useDrp: usingDrp,
    setUseDrp,
    drpPolicy,
    setDrpPolicy,
    staticDays,
    setStaticDays,
    drpPipeline,
    setDrpPipeline,
    logEvent: addLog,
    userBlocks,
    addBlock,
    removeBlock: (id) => setUserBlocks((p) => p.filter((b) => b.id !== id)),
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
