import { describe, expect, it } from 'vitest';
import { DemandHistoryRow } from '@ramo/domain';
import { backtest, currentProcessAccuracy, fitAndForecast, forecastSku, toWeeklySeries } from './forecast';

const startWeek = '2024-10-07'; // lunes
const addWeeks = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n * 7);
  return x.toISOString().slice(0, 10);
};
const rows = (values: number[], skuId = 'A'): DemandHistoryRow[] =>
  values.map((v, i) => ({ skuId, weekStart: addWeeks(startWeek, i), flow: 'CEDI', commercialQty: v, priorForecast: null }));

/** Serie con estacionalidad anual (pico en la semana ~50) y ruido determinista pequeño. */
const seasonal = (n: number) =>
  Array.from({ length: n }, (_, t) => {
    const noise = 1 + 0.02 * Math.sin(t * 12.9898);
    return 1000 * (1 + 0.25 * Math.cos(((t - 50) / 52) * 2 * Math.PI)) * noise;
  });

describe('serie semanal', () => {
  it('interpola los huecos y los cuenta', () => {
    const h = rows([100, 100, 100, 100, 100]);
    h.splice(2, 2); // faltan las semanas 3 y 4 de 5
    h[2] = { ...h[2], commercialQty: 400 }; // la quinta semana vale 400
    const s = toWeeklySeries(h, 'A');
    expect(s.values).toEqual([100, 100, 200, 300, 400]);
    expect(s.filled).toBe(2);
    expect(s.weeks).toHaveLength(5);
  });

  it('respeta el corte (solo semanas anteriores) y el flujo', () => {
    const h = [...rows([1, 2, 3, 4]), { skuId: 'A', weekStart: addWeeks(startWeek, 1), flow: 'EXPORT' as const, commercialQty: 99, priorForecast: null }];
    expect(toWeeklySeries(h, 'A', 'CEDI', addWeeks(startWeek, 3)).values).toEqual([1, 2, 3]);
    expect(toWeeklySeries(h, 'A', 'EXPORT').values).toEqual([99]);
    expect(toWeeklySeries(h, 'B').values).toEqual([]);
  });
});

describe('modelos', () => {
  it('una serie constante se pronostica exacta con cualquier modelo que aplique', () => {
    const y = Array(104).fill(500);
    for (const m of ['MA4', 'SES', 'SEASONAL_NAIVE', 'HOLT_WINTERS'] as const) {
      const f = fitAndForecast(m, y, 6)!;
      expect(f).toHaveLength(6);
      f.forEach((v) => expect(v).toBeCloseTo(500, 0));
    }
  });

  it('los modelos estacionales no aplican con poca historia', () => {
    const y = Array(30).fill(100);
    expect(fitAndForecast('SEASONAL_NAIVE', y, 4)).toBeNull();
    expect(fitAndForecast('HOLT_WINTERS', y, 4)).toBeNull();
    expect(fitAndForecast('MA4', y, 4)).not.toBeNull();
  });

  it('con estacionalidad anual los modelos estacionales ganan al promedio móvil', () => {
    const y = seasonal(104);
    const ma = backtest('MA4', y)!;
    const sn = backtest('SEASONAL_NAIVE', y)!;
    const hw = backtest('HOLT_WINTERS', y)!;
    expect(sn.wapeAvg).toBeLessThan(ma.wapeAvg);
    expect(hw.wapeAvg).toBeLessThan(ma.wapeAvg);
  });

  it('el backtest pronostica solo con lo anterior al origen (caso calculado a mano)', () => {
    const y = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    // Un origen, 1 semana vista: se entrena con y[0..9), el promedio de las últimas 4 es (60+70+80+90)/4 = 75 y el real es 100.
    const r = backtest('MA4', y, { origins: 1, horizon: 1 })!;
    expect(r.wape1).toBeCloseTo(25 / 100, 10);
    expect(r.bias).toBeCloseTo(-25 / 100, 10);
    // Cambiar el dato que se evalúa no cambia lo pronosticado, solo el error.
    const y2 = [...y.slice(0, 9), 200];
    expect(backtest('MA4', y2, { origins: 1, horizon: 1 })!.wape1).toBeCloseTo(125 / 200, 10);
  });

  it('con 12 orígenes y horizonte 4 mide 4 horizontes por origen', () => {
    const r = backtest('MA4', seasonal(104), { origins: 12, horizon: 4 })!;
    expect(r.origins).toBe(12);
    expect(r.sd).toHaveLength(4);
    expect(r.wape1).toBeGreaterThan(0);
  });
});

describe('selección por SKU e intervalos', () => {
  it('elige un modelo estacional con estacionalidad y entrega intervalos coherentes', () => {
    const y = seasonal(104);
    const r = forecastSku(y, 13)!;
    expect(['SEASONAL_NAIVE', 'HOLT_WINTERS']).toContain(r.model);
    expect(r.candidates).toHaveLength(4);
    r.forecast.forEach((f, i) => {
      expect(r.lower[i]).toBeLessThanOrEqual(f);
      expect(r.upper[i]).toBeGreaterThanOrEqual(f);
      expect(r.lower[i]).toBeGreaterThanOrEqual(0);
    });
    // El intervalo no se estrecha al alejarse en el tiempo.
    const width = (i: number) => r.upper[i] - r.lower[i];
    expect(width(12)).toBeGreaterThanOrEqual(width(0));
  });

  it('con una serie corta usa solo los modelos simples', () => {
    const y = Array.from({ length: 30 }, (_, i) => 100 + (i % 3));
    const r = forecastSku(y, 4)!;
    expect(['MA4', 'SES']).toContain(r.model);
    expect(r.candidates.map((c) => c.model)).toEqual(['MA4', 'SES']);
  });

  it('startStep desplaza el pronóstico estacional hacia el periodo correcto', () => {
    const y = seasonal(104);
    const next = fitAndForecast('SEASONAL_NAIVE', y, 1, 1)![0];
    const fifth = fitAndForecast('SEASONAL_NAIVE', y, 1, 5)![0];
    expect(next).not.toBeCloseTo(fifth, 3);
  });

  it('prefiere el modelo estacional dentro de la tolerancia y respeta tolerancia 0', () => {
    // Serie plana con ruido: el mejor es uno simple; con tolerancia amplia se fuerza al estacional.
    const flat = Array.from({ length: 104 }, (_, t) => 1000 * (1 + 0.03 * Math.sin(t * 7.77)));
    const strict = forecastSku(flat, 13, 1, { seasonalTolerance: 0 })!;
    const lenient = forecastSku(flat, 13, 1, { seasonalTolerance: 10 })!;
    expect(['SEASONAL_NAIVE', 'HOLT_WINTERS']).toContain(lenient.model);
    expect(strict.backtest.wapeAvg).toBeLessThanOrEqual(lenient.backtest.wapeAvg + 1e-9);
  });

  it('el intervalo nunca se estrecha con el horizonte', () => {
    const r = forecastSku(seasonal(104), 13)!;
    for (let i = 1; i < 13; i++) expect(r.upper[i] - r.lower[i]).toBeGreaterThanOrEqual(r.upper[i - 1] - r.lower[i - 1] - 1e-6);
  });

  it('devuelve null si no hay historia suficiente para ningún modelo', () => {
    expect(forecastSku([1, 2, 3], 4)).toBeNull();
  });
});

describe('exactitud del proceso vigente', () => {
  it('WAPE y sesgo sobre las últimas semanas con pronóstico', () => {
    const h = rows([100, 100, 100, 100]).map((r, i) => ({ ...r, priorForecast: [null, 110, 90, 130][i] }));
    const c = currentProcessAccuracy(h, 'A', 12)!;
    // errores: +10, −10, +30 sobre venta 300 → WAPE 50/300, sesgo 30/300
    expect(c.weeks).toBe(3);
    expect(c.wape).toBeCloseTo(50 / 300, 6);
    expect(c.bias).toBeCloseTo(30 / 300, 6);
  });

  it('null si el histórico no trae pronóstico del proceso vigente', () => {
    expect(currentProcessAccuracy(rows([1, 2, 3]), 'A')).toBeNull();
  });
});
