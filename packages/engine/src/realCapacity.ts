import { LineDayHistory, RamoDataset } from '@ramo/domain';
import { DailyResult, weekdayOf } from './daily';
import { WeekCapacity } from './crp';

/**
 * Capacidad real y confiabilidad del plan.
 *
 * El ritmo de SAP es el nominal; en planta casi nunca se logra. Con el historial de producción por línea y día se estima cuánto
 * rinde de verdad cada línea (por día de la semana, con encogimiento hacia el promedio de la línea cuando hay pocos datos) y cuánto
 * varía ese rendimiento. Con eso cada día y cada semana tienen una probabilidad de que la carga programada alcance.
 *
 * No es un modelo caja negra: es una regresión por línea y día de la semana (media encogida) más los residuos observados, y cada
 * cifra se puede recalcular a mano. Con datos sintéticos solo demuestra el mecanismo; con el registro real de Ramo se valida
 * (error del estimado contra lo logrado en semanas que el modelo no vio). Ver ADR 0011.
 */

export interface LineEfficiency {
  lineId: string;
  /** Días de historial usados. */
  days: number;
  /** Rendimiento medio de la línea (horas productivas logradas / horas programadas). */
  mean: number;
  sd: number;
  /** Rendimiento estimado por día de la semana (1 = lunes … 7), ya con encogimiento. */
  byWeekday: Record<number, number>;
  /** Cuántos días de historial hay por día de la semana. */
  nByWeekday: Record<number, number>;
  /** Fracción de días con paradas no programadas y horas perdidas promedio cuando ocurren. */
  stoppageRate: number;
  stoppageAvgHours: number;
  /** Diferencias (rendimiento observado − estimado del día de la semana); base de la variación simulada. */
  residuals: number[];
}

/** Peso del promedio de la línea al estimar un día de la semana: equivale a k días "virtuales" de historial. */
const SHRINK_K = 5;

export function fitLineEfficiency(history: LineDayHistory[], lineId: string): LineEfficiency | null {
  const rows = history.filter((h) => h.lineId === lineId && h.scheduledHours > 0);
  if (rows.length < 10) return null;
  const ratio = (h: LineDayHistory) => h.effectiveHours / h.scheduledHours;
  const mean = rows.reduce((a, h) => a + ratio(h), 0) / rows.length;
  const sd = Math.sqrt(rows.reduce((a, h) => a + (ratio(h) - mean) ** 2, 0) / Math.max(1, rows.length - 1));
  const byWeekday: Record<number, number> = {};
  const nByWeekday: Record<number, number> = {};
  for (let wd = 1; wd <= 7; wd++) {
    const r = rows.filter((h) => weekdayOf(h.date) === wd);
    nByWeekday[wd] = r.length;
    const m = r.length ? r.reduce((a, h) => a + ratio(h), 0) / r.length : mean;
    byWeekday[wd] = (r.length * m + SHRINK_K * mean) / (r.length + SHRINK_K);
  }
  const stopped = rows.filter((h) => h.stoppageHours > 0);
  return {
    lineId,
    days: rows.length,
    mean,
    sd,
    byWeekday,
    nByWeekday,
    stoppageRate: stopped.length / rows.length,
    stoppageAvgHours: stopped.length ? stopped.reduce((a, h) => a + h.stoppageHours, 0) / stopped.length : 0,
    residuals: rows.map((h) => ratio(h) - byWeekday[weekdayOf(h.date)]),
  };
}

export function fitAllLines(ds: RamoDataset): Record<string, LineEfficiency> {
  const out: Record<string, LineEfficiency> = {};
  for (const l of ds.lines) {
    const f = fitLineEfficiency(ds.lineHistory ?? [], l.id);
    if (f) out[l.id] = f;
  }
  return out;
}

/** Probabilidad de que un día con `requiredHours` de carga (a ritmo nominal) y `availableHours` programadas se cumpla. */
export function dayConfidence(eff: LineEfficiency, weekday: number, requiredHours: number, availableHours: number): number {
  if (requiredHours <= 1e-6) return 1;
  if (availableHours <= 1e-6) return 0;
  const need = requiredHours / availableHours;
  const base = eff.byWeekday[weekday] ?? eff.mean;
  const ok = eff.residuals.filter((r) => base + r >= need).length;
  return ok / eff.residuals.length;
}

export interface WeekConfidence {
  weekStart: string;
  templateId: string;
  /** Horas de carga y horas programadas de la semana (nominales). */
  requiredHours: number;
  nominalHours: number;
  /** Horas productivas que se esperan lograr (mediana) y rango (P10–P90) según el historial. */
  realisticHours: number;
  realisticP10: number;
  realisticP90: number;
  /** Probabilidad de que la semana logre la carga entera (0–1). */
  pCovers: number;
  /** Días rojos o amarillos "por probabilidad": días con menos del 80 % de confianza. */
  riskyDays: { date: string; lineId: string; p: number }[];
}

function rng(seed: number) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))];
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Confiabilidad semanal: simula 400 semanas tomando, para cada día-línea, el rendimiento del día de la semana más un residuo al azar
 * del historial de la línea. La semana "cubre" si las horas productivas logradas alcanzan la carga total (se puede reacomodar dentro de la semana).
 */
export function weeklyConfidence(ds: RamoDataset, daily: DailyResult, eff: Record<string, LineEfficiency>, options: { sims?: number; seed?: number } = {}): WeekConfidence[] {
  const sims = options.sims ?? 400;
  const out: WeekConfidence[] = [];
  for (const w of daily.weeks) {
    const rand = rng((options.seed ?? 11) + Number(w.weekStart.replace(/-/g, '')) % 100000);
    const cells = w.cells.filter((c) => c.requiredHours > 1e-6 || c.availableHours > 1e-6);
    const nominal = cells.reduce((a, c) => a + c.availableHours, 0);
    const required = cells.reduce((a, c) => a + c.requiredHours, 0);
    const results: number[] = [];
    for (let i = 0; i < sims; i++) {
      let total = 0;
      for (const c of cells) {
        const e = eff[c.lineId];
        if (!e) { total += c.availableHours; continue; }
        const base = e.byWeekday[c.weekday] ?? e.mean;
        const r = e.residuals[Math.floor(rand() * e.residuals.length)];
        total += c.availableHours * Math.max(0, base + r);
      }
      results.push(total);
    }
    results.sort((a, b) => a - b);
    const risky = cells
      .filter((c) => c.requiredHours > 1e-6 && eff[c.lineId])
      .map((c) => ({ date: c.date, lineId: c.lineId, p: dayConfidence(eff[c.lineId], c.weekday, c.requiredHours, c.availableHours) }))
      .filter((x) => x.p < 0.8);
    out.push({
      weekStart: w.weekStart,
      templateId: w.templateId,
      requiredHours: round1(required),
      nominalHours: round1(nominal),
      realisticHours: round1(pct(results, 0.5)),
      realisticP10: round1(pct(results, 0.1)),
      realisticP90: round1(pct(results, 0.9)),
      pCovers: required <= 1e-6 ? 1 : results.filter((t) => t >= required).length / sims,
      riskyDays: risky,
    });
  }
  return out;
}

export interface CrewWeekConfidence {
  weekStart: string;
  crewId: string;
  requiredHours: number;
  /** Horas disponibles según el CRP (nominales, con las horas extra decididas). */
  nominalHours: number;
  realisticHours: number;
  realisticP10: number;
  realisticP90: number;
  /** Probabilidad de alcanzar la carga de la semana (0–1). */
  pCovers: number;
}

/**
 * Confiabilidad por tripulación y semana sobre el CRP semanal (mismas horas que ve el CRP): cada línea rinde su promedio histórico más el
 * promedio de cinco residuos tomados al azar (una semana de trabajo). Las horas disponibles de la tripulación se reparten entre sus
 * líneas en la proporción en que el CRP las calcula.
 */
export function crpConfidence(capacity: WeekCapacity[], eff: Record<string, LineEfficiency>, options: { sims?: number; seed?: number } = {}): CrewWeekConfidence[] {
  const sims = options.sims ?? 400;
  const out: CrewWeekConfidence[] = [];
  for (const w of capacity) {
    for (const crew of w.crews) {
      const rand = rng((options.seed ?? 23) + (Number(w.weekStart.replace(/-/g, '')) % 100000) + crew.crewId.length * 7);
      const lines = w.lines.filter((l) => crew.lineIds.includes(l.lineId));
      const availSum = lines.reduce((a, l) => a + l.availableHours, 0);
      const results: number[] = [];
      for (let i = 0; i < sims; i++) {
        let total = 0;
        for (const l of lines) {
          const share = availSum > 0 ? l.availableHours / availSum : 1 / Math.max(1, lines.length);
          const e = eff[l.lineId];
          if (!e) { total += crew.availableHours * share; continue; }
          let r = 0;
          for (let k = 0; k < 5; k++) r += e.residuals[Math.floor(rand() * e.residuals.length)];
          total += crew.availableHours * share * Math.max(0, e.mean + r / 5);
        }
        results.push(total);
      }
      results.sort((a, b) => a - b);
      out.push({
        weekStart: w.weekStart,
        crewId: crew.crewId,
        requiredHours: round1(crew.requiredHours),
        nominalHours: round1(crew.availableHours),
        realisticHours: round1(pct(results, 0.5)),
        realisticP10: round1(pct(results, 0.1)),
        realisticP90: round1(pct(results, 0.9)),
        pCovers: crew.requiredHours <= 1e-6 ? 1 : results.filter((t) => t >= crew.requiredHours).length / sims,
      });
    }
  }
  return out;
}
