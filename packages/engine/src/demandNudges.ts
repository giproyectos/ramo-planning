import { ForecastRun } from './demandPlan';

/**
 * Ajustes de demanda sugeridos por el modelo: si en las últimas 12 semanas el pronóstico a 1 semana se equivocó SIEMPRE hacia el mismo
 * lado (sesgo sistemático, no ruido), se propone corregir el nivel de las próximas semanas. Es una propuesta con su evidencia: la
 * persona la acepta como building block (con su nombre y motivo) o la descarta.
 */

export interface DemandNudge {
  skuId: string;
  /** Cajas por semana a sumar (positivo) o restar (negativo). */
  weeklyDelta: number;
  /** Sesgo reciente del pronóstico (> 0 = sobrepronostica). */
  bias: number;
  wape: number;
  /** Qué tan sistemático es el error (|sesgo| ÷ error): 1 = siempre hacia el mismo lado. */
  consistency: number;
  confidence: 'ALTA' | 'MEDIA';
  evidence: string;
}

export interface NudgeOptions {
  /** Sesgo mínimo para sugerir (por defecto 3 %). */
  minBias?: number;
  /** Consistencia mínima del error (por defecto 0,6). */
  minConsistency?: number;
  /** Tope de la corrección frente al nivel promedio (por defecto 12 %). */
  maxCorrection?: number;
}

const pct = (n: number) => `${(n * 100).toLocaleString('es-CO', { maximumFractionDigits: 1 })} %`;

export function suggestBiasCorrections(run: ForecastRun, options: NudgeOptions = {}): DemandNudge[] {
  const minBias = options.minBias ?? 0.03;
  const minConsistency = options.minConsistency ?? 0.6;
  const cap = options.maxCorrection ?? 0.12;
  const out: DemandNudge[] = [];
  for (const s of run.skus) {
    const r = s.recent;
    if (!r || r.origins < 8 || s.forecast.length === 0) continue;
    const bias = r.bias;
    const wape = r.wape1;
    if (Math.abs(bias) < minBias || wape <= 0) continue;
    const consistency = Math.abs(bias) / wape;
    if (consistency < minConsistency) continue;
    const level = s.forecast.reduce((a, v) => a + v, 0) / s.forecast.length;
    const correction = Math.min(Math.abs(bias), cap) * level;
    const weeklyDelta = -Math.sign(bias) * Math.round(correction / 50) * 50;
    if (weeklyDelta === 0) continue;
    out.push({
      skuId: s.skuId,
      weeklyDelta,
      bias,
      wape,
      consistency,
      confidence: consistency >= 0.85 && Math.abs(bias) >= 0.05 ? 'ALTA' : 'MEDIA',
      evidence: `En las últimas ${r.origins} semanas el pronóstico a 1 semana ${bias > 0 ? 'se pasó' : 'se quedó corto'} ${pct(Math.abs(bias))} en promedio (error total ${pct(wape)}; ${pct(consistency)} del error va siempre hacia el mismo lado).`,
    });
  }
  return out.sort((a, b) => Math.abs(b.bias) - Math.abs(a.bias));
}
