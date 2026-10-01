import { BuildingBlock, DemandHistoryRow, DemandRecord, PlanVersion, RamoDataset, Sku } from '@ramo/domain';
import {
  BacktestResult, CurrentProcessAccuracy, ModelId, currentProcessAccuracy, forecastSku, toWeeklySeries,
} from './forecast';

export interface SkuForecast {
  skuId: string;
  model: ModelId;
  /** Semanas objetivo (lunes) y sus valores, en cajas. */
  weeks: string[];
  forecast: number[];
  lower: number[];
  upper: number[];
  backtest: BacktestResult;
  /** Últimas 12 semanas a 1 semana vista (comparable con el proceso vigente). */
  recent: BacktestResult | null;
  candidates: BacktestResult[];
  /** Exactitud del proceso vigente en las mismas últimas semanas, si el histórico trae su pronóstico. */
  current: CurrentProcessAccuracy | null;
  /** Semanas interpoladas por huecos en el histórico. */
  filledWeeks: number;
}

export interface ForecastRun {
  /** Primera semana pronosticada. */
  targetStart: string;
  horizonWeeks: number;
  /** Última semana de historia usada (exclusive: se usó todo lo anterior a esta fecha). */
  trainedBefore: string;
  skus: SkuForecast[];
  /** SKUs sin historia suficiente para pronosticar. */
  skipped: string[];
}

const addWeeks = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n * 7);
  return x.toISOString().slice(0, 10);
};
const weeksBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / (7 * 86_400_000));

export interface RunOptions {
  targetStart: string;
  horizonWeeks: number;
  /** Solo se usa historia anterior a esta fecha (por defecto, `targetStart`). El PBO mensual la corre unas semanas antes. */
  trainedBefore?: string;
}

/** Pronóstico CEDI de cada SKU: modelo elegido por backtest, intervalo p10–p90 y comparación con el proceso vigente. */
export function runForecast(skus: Sku[], history: DemandHistoryRow[], options: RunOptions): ForecastRun {
  const trainedBefore = options.trainedBefore ?? options.targetStart;
  const out: SkuForecast[] = [];
  const skipped: string[] = [];

  for (const sku of skus) {
    const series = toWeeklySeries(history, sku.id, 'CEDI', trainedBefore);
    if (series.values.length === 0) { skipped.push(sku.id); continue; }
    const lastWeek = series.weeks[series.weeks.length - 1];
    const startStep = Math.max(1, weeksBetween(lastWeek, options.targetStart));
    const r = forecastSku(series.values, options.horizonWeeks, startStep);
    if (!r) { skipped.push(sku.id); continue; }
    out.push({
      skuId: sku.id,
      model: r.model,
      weeks: Array.from({ length: options.horizonWeeks }, (_, i) => addWeeks(options.targetStart, i)),
      forecast: r.forecast,
      lower: r.lower,
      upper: r.upper,
      backtest: r.backtest,
      recent: r.recent,
      candidates: r.candidates,
      current: currentProcessAccuracy(history.filter((h) => h.weekStart < trainedBefore), sku.id),
      filledWeeks: series.filled,
    });
  }
  return { targetStart: options.targetStart, horizonWeeks: options.horizonWeeks, trainedBefore, skus: out, skipped };
}

export const FC_PBO_ID = 'V-PBO-FC';
export const FC_N1_ID = 'V-N1-FC';

export interface ForecastDemandInput {
  pbo: ForecastRun;
  n1: ForecastRun;
  /** Building blocks del usuario sobre el N+1; se suman a los del dataset. */
  extraBlocks?: BuildingBlock[];
  /** Si es true (por defecto) se conservan los building blocks sintéticos del dataset, apuntados al N+1 nuevo. */
  keepDatasetBlocks?: boolean;
  createdAt?: string;
}

const toRecords = (run: ForecastRun, versionId: string): DemandRecord[] =>
  run.skus.flatMap((s) =>
    s.weeks.map((w, i) => ({ versionId, skuId: s.skuId, weekStart: w, flow: 'CEDI' as const, commercialQty: Math.max(0, Math.round(s.forecast[i])) })),
  );

/**
 * Dataset con dos versiones nuevas generadas por el pronóstico: PBO mensual (corrido unas semanas antes) y N+1 semanal
 * (con toda la historia, basado en el PBO) más sus building blocks. Los flujos make-to-order (Hard Discount y Exportaciones)
 * no se pronostican: se copian de las versiones vigentes del dataset (son pedidos conocidos).
 */
export function withForecastVersions(ds: RamoDataset, input: ForecastDemandInput): RamoDataset {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const versions: PlanVersion[] = [
    { id: FC_PBO_ID, kind: 'PBO_MONTHLY', label: 'PBO (pronóstico estadístico)', createdAt, createdByRole: 'demand' },
    { id: FC_N1_ID, kind: 'WEEKLY_N1', label: 'Recálculo semanal N+1 (pronóstico + building blocks)', createdAt, createdByRole: 'demand', basedOn: FC_PBO_ID },
  ];
  const latestOf = (kind: PlanVersion['kind']) => ds.versions.filter((v) => v.kind === kind).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const mto = (src: PlanVersion | undefined, target: string) =>
    src ? ds.demand.filter((d) => d.versionId === src.id && d.flow !== 'CEDI').map((d) => ({ ...d, versionId: target })) : [];

  const blocks: BuildingBlock[] = [
    ...(input.keepDatasetBlocks === false ? [] : ds.buildingBlocks.map((b) => ({ ...b, id: `${b.id}-fc`, versionId: FC_N1_ID }))),
    ...(input.extraBlocks ?? []).map((b) => ({ ...b, versionId: FC_N1_ID })),
  ];

  return {
    ...ds,
    versions: [...ds.versions, ...versions],
    demand: [
      ...ds.demand,
      ...toRecords(input.pbo, FC_PBO_ID),
      ...mto(latestOf('PBO_MONTHLY'), FC_PBO_ID),
      ...toRecords(input.n1, FC_N1_ID),
      ...mto(latestOf('WEEKLY_N1'), FC_N1_ID),
    ],
    buildingBlocks: [...ds.buildingBlocks, ...blocks],
  };
}

export interface DemandFilter {
  businessUnit?: string;
  brand?: string;
  family?: string;
  skuId?: string;
}

export function filterSkus(skus: Sku[], f: DemandFilter): Sku[] {
  return skus.filter(
    (s) => (!f.businessUnit || s.businessUnit === f.businessUnit) && (!f.brand || s.brand === f.brand) && (!f.family || s.family === f.family) && (!f.skuId || s.id === f.skuId),
  );
}

/** Cantidades semanales (cajas) de una versión para un conjunto de SKUs y un flujo, ya sumadas. */
export function weeklyTotals(records: DemandRecord[], skuIds: Set<string>, weeks: string[], flow: DemandRecord['flow'] = 'CEDI'): number[] {
  const byWeek = new Map<string, number>();
  for (const r of records) if (skuIds.has(r.skuId) && r.flow === flow) byWeek.set(r.weekStart, (byWeek.get(r.weekStart) ?? 0) + r.commercialQty);
  return weeks.map((w) => byWeek.get(w) ?? 0);
}
