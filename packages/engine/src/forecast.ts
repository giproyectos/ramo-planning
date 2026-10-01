import { DemandFlow, DemandHistoryRow } from '@ramo/domain';

/**
 * Pronóstico estadístico semanal, sin dependencias. Cuatro modelos de complejidad creciente; se elige uno por SKU
 * con un backtest de origen móvil (se pronostica con los datos hasta cada semana y se mide contra lo que pasó).
 * Es la "línea base estadística" de la Fase 4; el ML más pesado (LightGBM, etc.) solo se justifica con datos reales.
 */
export type ModelId = 'MA4' | 'SES' | 'SEASONAL_NAIVE' | 'HOLT_WINTERS';

export const MODEL_LABELS: Record<ModelId, string> = {
  MA4: 'Promedio móvil 4 sem.',
  SES: 'Suavizamiento exponencial',
  SEASONAL_NAIVE: 'Estacional (mismo periodo del año anterior)',
  HOLT_WINTERS: 'Holt-Winters multiplicativo',
};

const MODEL_ORDER: ModelId[] = ['MA4', 'SES', 'SEASONAL_NAIVE', 'HOLT_WINTERS'];
const PERIOD = 52;
const MIN_SEASONAL = 60;

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const mean = (a: number[]) => (a.length ? sum(a) / a.length : 0);
const addWeeks = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n * 7);
  return x.toISOString().slice(0, 10);
};
const weeksBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / (7 * 86_400_000));

export interface WeeklySeries {
  weeks: string[];
  values: number[];
  /** Semanas que no venían en el histórico y se interpolaron. */
  filled: number;
}

/** Serie semanal continua de un SKU y flujo, interpolando linealmente los huecos. Solo usa semanas < `before`, si se indica. */
export function toWeeklySeries(history: DemandHistoryRow[], skuId: string, flow: DemandFlow = 'CEDI', before?: string): WeeklySeries {
  const rows = history.filter((r) => r.skuId === skuId && r.flow === flow && (!before || r.weekStart < before)).sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  if (rows.length === 0) return { weeks: [], values: [], filled: 0 };
  const byWeek = new Map(rows.map((r) => [r.weekStart, r.commercialQty]));
  const first = rows[0].weekStart;
  const total = weeksBetween(first, rows[rows.length - 1].weekStart) + 1;
  const weeks: string[] = [];
  const values: (number | null)[] = [];
  for (let i = 0; i < total; i++) {
    const w = addWeeks(first, i);
    weeks.push(w);
    values.push(byWeek.get(w) ?? null);
  }
  let filled = 0;
  for (let i = 0; i < values.length; i++) {
    if (values[i] !== null) continue;
    let lo = i - 1;
    while (lo >= 0 && values[lo] === null) lo--;
    let hi = i + 1;
    while (hi < values.length && values[hi] === null) hi++;
    const a = values[lo] as number;
    const b = values[hi] as number;
    values[i] = a + ((b - a) * (i - lo)) / (hi - lo);
    filled++;
  }
  return { weeks, values: values as number[], filled };
}

function fitSES(y: number[]): { level: number } {
  let best = { sse: Infinity, level: y[y.length - 1] };
  for (let a = 0.1; a <= 0.91; a += 0.1) {
    let level = y[0];
    let sse = 0;
    for (let t = 1; t < y.length; t++) {
      sse += (y[t] - level) ** 2;
      level = a * y[t] + (1 - a) * level;
    }
    if (sse < best.sse) best = { sse, level };
  }
  return { level: best.level };
}

function fitHoltWinters(y: number[]): { level: number; trend: number; seasonal: number[] } | null {
  const n = y.length;
  if (n < MIN_SEASONAL) return null;
  const level0 = mean(y.slice(0, PERIOD));
  if (!(level0 > 0)) return null;
  let best: { sse: number; level: number; trend: number; seasonal: number[] } | null = null;

  for (const alpha of [0.1, 0.2, 0.4]) {
    for (const beta of [0, 0.05]) {
      for (const gamma of [0.1, 0.3]) {
        const s = y.slice(0, PERIOD).map((v) => v / level0);
        let level = level0;
        let trend = 0;
        let sse = 0;
        let ok = true;
        for (let t = PERIOD; t < n; t++) {
          const si = t % PERIOD;
          const pred = (level + trend) * s[si];
          sse += (y[t] - pred) ** 2;
          const prevLevel = level;
          level = alpha * (y[t] / s[si]) + (1 - alpha) * (level + trend);
          if (!(level > 0)) { ok = false; break; }
          trend = beta * (level - prevLevel) + (1 - beta) * trend;
          s[si] = gamma * (y[t] / level) + (1 - gamma) * s[si];
        }
        if (ok && (!best || sse < best.sse)) best = { sse, level, trend, seasonal: s };
      }
    }
  }
  return best;
}

/** Pronóstico de `horizon` semanas desde el final de `y`. null si el modelo no aplica (poca historia). */
export function fitAndForecast(model: ModelId, y: number[], horizon: number, startStep = 1): number[] | null {
  const n = y.length;
  if (n < 4) return null;
  const steps = Array.from({ length: horizon }, (_, i) => startStep + i);
  switch (model) {
    case 'MA4': {
      const m = mean(y.slice(-4));
      return steps.map(() => m);
    }
    case 'SES': {
      const { level } = fitSES(y);
      return steps.map(() => level);
    }
    case 'SEASONAL_NAIVE': {
      if (n < MIN_SEASONAL) return null;
      const recent = sum(y.slice(-8));
      const yearAgo = sum(y.slice(n - 8 - PERIOD, n - PERIOD));
      const ratio = yearAgo > 0 ? Math.min(1.4, Math.max(0.7, recent / yearAgo)) : 1;
      return steps.map((h) => {
        const idx = n + h - 1 - PERIOD;
        return idx >= 0 && idx < n ? y[idx] * ratio : y[n - 1];
      });
    }
    case 'HOLT_WINTERS': {
      const fit = fitHoltWinters(y);
      if (!fit) return null;
      return steps.map((h) => Math.max(0, (fit.level + h * fit.trend) * fit.seasonal[(n + h - 1) % PERIOD]));
    }
  }
}

export interface BacktestResult {
  model: ModelId;
  /** WAPE (Σ|error| / Σ real) a 1 semana vista, al horizonte más lejano evaluado y promedio de todos los horizontes. */
  wape1: number;
  wapeLast: number;
  wapeAvg: number;
  /** Horizonte máximo evaluado (semanas). */
  horizon: number;
  /** Sesgo = Σ(pronóstico − real) / Σ real (> 0 sobrepronostica). */
  bias: number;
  /** Desviación del error por horizonte h = 1..horizon (insumo de los intervalos). */
  sd: number[];
  origins: number;
}

export interface BacktestOptions {
  /** Cuántas semanas consecutivas terminales se usan como origen (por defecto 12). */
  origins?: number;
  horizon?: number;
  /** Largo de entrenamiento de cada origen, si se quiere fijar explícitamente (anula `origins`). */
  originIndices?: number[];
}

/** Backtest de origen móvil: para cada una de las últimas `origins` semanas pronostica solo con lo anterior y compara. */
export function backtest(model: ModelId, y: number[], options: BacktestOptions = {}): BacktestResult | null {
  const origins = options.origins ?? 12;
  const horizon = options.horizon ?? 4;
  const n = y.length;
  const errors: number[][] = Array.from({ length: horizon }, () => []);
  const actuals: number[][] = Array.from({ length: horizon }, () => []);

  const indices = options.originIndices ?? Array.from({ length: origins }, (_, k) => n - horizon - origins + 1 + k);
  for (const t of indices) {
    if (t < 8 || t + horizon > n) return null;
    const f = fitAndForecast(model, y.slice(0, t), horizon);
    if (!f) return null;
    for (let h = 0; h < horizon; h++) {
      errors[h].push(f[h] - y[t + h]);
      actuals[h].push(y[t + h]);
    }
  }
  const wape = (h: number) => sum(errors[h].map(Math.abs)) / (sum(actuals[h]) || 1);
  const allErr = errors.flat();
  const allAct = actuals.flat();
  const sdOf = (e: number[]) => {
    const m = mean(e);
    return Math.sqrt(mean(e.map((x) => (x - m) ** 2)));
  };
  return {
    model,
    wape1: wape(0),
    wapeLast: wape(horizon - 1),
    horizon,
    wapeAvg: sum(allErr.map(Math.abs)) / (sum(allAct) || 1),
    bias: sum(allErr) / (sum(allAct) || 1),
    sd: errors.map(sdOf),
    origins: indices.length,
  };
}

/**
 * Orígenes para elegir modelo: una de cada 4 semanas hacia atrás (t = n−4, n−8, …), hasta 12, y nunca con menos entrenamiento
 * del que exigen los modelos estacionales (60 semanas) cuando la serie lo permite. Así el backtest cubre todo el año, incluido
 * el pico de diciembre, y no solo un tramo plano reciente que favorecería siempre al suavizamiento simple.
 */
export function selectionOrigins(n: number, horizon: number): number[] {
  const minT = n - horizon >= MIN_SEASONAL ? MIN_SEASONAL : 8;
  const out: number[] = [];
  for (let t = n - horizon; t >= minT && out.length < 12; t -= 4) out.push(t);
  return out.reverse();
}

export interface SkuForecastResult {
  model: ModelId;
  forecast: number[];
  lower: number[];
  upper: number[];
  /** Backtest usado para elegir el modelo (orígenes repartidos en el año). */
  backtest: BacktestResult;
  /** Últimas 12 semanas a 1 semana vista: es la ventana comparable con el proceso vigente. */
  recent: BacktestResult | null;
  candidates: BacktestResult[];
}

const Z80 = 1.2816; // p10–p90

/**
 * Elige el modelo con menor WAPE promedio en el backtest (si hay empate técnico, el más simple) y devuelve el pronóstico
 * con intervalo p10–p90 a partir de la dispersión del error de cada horizonte. `startStep` = cuántas semanas después del
 * último dato empieza el primer periodo a pronosticar (1 = la semana siguiente).
 */
export interface SelectOptions extends BacktestOptions {
  /**
   * Prior de negocio: se prefiere un modelo estacional si su error no supera al del mejor en más de este margen (0,10 = 10 %).
   * Los productos de Ramo tienen temporada (pico de diciembre) y el ruido semanal tapa la señal en un backtest corto.
   * Es un supuesto a calibrar con histórico real; 0 lo desactiva.
   */
  seasonalTolerance?: number;
}

const SEASONAL_MODELS: ModelId[] = ['SEASONAL_NAIVE', 'HOLT_WINTERS'];

export function forecastSku(y: number[], horizon: number, startStep = 1, options: SelectOptions = {}): SkuForecastResult | null {
  // Se evalúa a los mismos horizontes que se van a usar (el PBO corrido unas semanas antes pronostica más lejos).
  const H = Math.max(1, Math.min(startStep + horizon - 1, 26));
  const origins = options.originIndices ?? selectionOrigins(y.length, H);
  if (origins.length === 0) return null;
  const candidates = MODEL_ORDER.map((m) => backtest(m, y, { origins: options.origins, horizon: H, originIndices: origins })).filter((b): b is BacktestResult => b !== null);
  if (candidates.length === 0) return null;
  let best = candidates[0];
  for (const c of candidates) if (c.wapeAvg < best.wapeAvg - 0.0005) best = c;
  if (!SEASONAL_MODELS.includes(best.model)) {
    const seasonal = candidates.filter((c) => SEASONAL_MODELS.includes(c.model)).sort((a, b) => a.wapeAvg - b.wapeAvg)[0];
    if (seasonal && seasonal.wapeAvg <= best.wapeAvg * (1 + (options.seasonalTolerance ?? 0.1))) best = seasonal;
  }

  const forecast = fitAndForecast(best.model, y, horizon, startStep);
  if (!forecast) return null;
  // La incertidumbre nunca se reduce al alejarse en el tiempo: se toma el máximo acumulado de la dispersión observada.
  const sdMono = best.sd.map((_, i) => Math.max(...best.sd.slice(0, i + 1)));
  const sdAt = (h: number) => (h <= sdMono.length ? sdMono[h - 1] : sdMono[sdMono.length - 1] * Math.sqrt(h / sdMono.length));
  const lower = forecast.map((f, i) => Math.max(0, f - Z80 * sdAt(startStep + i)));
  const upper = forecast.map((f, i) => f + Z80 * sdAt(startStep + i));
  return { model: best.model, forecast, lower, upper, backtest: best, recent: backtest(best.model, y, { origins: 12, horizon: 1 }), candidates };
}

export interface CurrentProcessAccuracy {
  wape: number;
  bias: number;
  weeks: number;
}

/** Exactitud del pronóstico que emitió el proceso vigente (Excel) en las últimas `lastN` semanas con dato. */
export function currentProcessAccuracy(history: DemandHistoryRow[], skuId: string, lastN = 12): CurrentProcessAccuracy | null {
  const rows = history
    .filter((r) => r.skuId === skuId && r.flow === 'CEDI' && r.priorForecast !== null)
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
    .slice(-lastN);
  if (rows.length === 0) return null;
  const actual = sum(rows.map((r) => r.commercialQty));
  if (!(actual > 0)) return null;
  return {
    wape: sum(rows.map((r) => Math.abs((r.priorForecast as number) - r.commercialQty))) / actual,
    bias: sum(rows.map((r) => (r.priorForecast as number) - r.commercialQty)) / actual,
    weeks: rows.length,
  };
}
