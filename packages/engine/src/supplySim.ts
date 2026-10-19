import { RamoDataset } from '@ramo/domain';
import { SupplyRiskResult } from './supplyRisk';

/**
 * Simulación de riesgo de abastecimiento (Monte Carlo): repite el cálculo del tablero miles de veces con variación realista y cuenta
 * cuántas veces el material se acaba antes de que llegue un pedido hecho hoy.
 *
 *  - Consumo: cada semana se multiplica por un factor aleatorio con la variabilidad (σ/media) del pronóstico de los productos que
 *    usan el material (ponderada por cuánto consume cada uno; conservador: no supone que los errores se compensen).
 *  - Entregas: el plazo de un pedido nuevo y la llegada de cada orden abierta se desplazan con retrasos tomados al azar del
 *    historial real del proveedor principal (retraso = recibido − prometido).
 *
 * Es una aproximación declarada, determinista (misma semilla = mismo resultado). Ver ADR 0009.
 */

export interface MaterialSim {
  materialId: string;
  sims: number;
  /** Probabilidad de que el inventario se acabe antes de que llegue un pedido hecho hoy. */
  pRuptureBeforeArrival: number;
  /** Probabilidad de que se acabe dentro del horizonte de decisión (28 días). Con 13 semanas sin reponer casi todo se acaba alguna vez: no es la cifra útil. */
  pRuptureIn28Days: number;
  /** Día de ruptura (0 = hoy) en el 10 %, 50 % y 90 % de los casos con ruptura; null si casi nunca ocurre. */
  ruptureDayP10: number | null;
  ruptureDayP50: number | null;
  ruptureDayP90: number | null;
  /** Qué se usó: muestras de retraso del historial y variabilidad del consumo. */
  delaySamples: number;
  consumptionCv: number;
  /** Plazo efectivo (mediana de lo simulado) frente al de SAP. */
  leadTimeP50: number;
}

export interface SupplySimOptions {
  sims?: number;
  seed?: number;
  /** σ semanal del error de pronóstico por SKU (cajas); base de la variabilidad del consumo. */
  sigmaBySku?: Record<string, number>;
  /** Variabilidad por defecto si no hay pronóstico (por defecto 12 %). */
  defaultCv?: number;
}

/** Generador pseudoaleatorio determinista (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const normal = (r: () => number) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
const hash = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);
const diffDays = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);
const pctile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))];

export function simulateSupplyRisk(ds: RamoDataset, risk: SupplyRiskResult, options: SupplySimOptions = {}): MaterialSim[] {
  const sims = options.sims ?? 400;
  const defaultCv = options.defaultCv ?? 0.12;
  const H = risk.dates.length;
  if (H === 0) return [];
  const weeks = Math.ceil(H / 7);
  const history = ds.orderHistory ?? [];
  const pos = ds.purchaseOrders ?? [];
  const out: MaterialSim[] = [];

  // Retrasos reales (días) por proveedor y material.
  const delays = (materialId: string, supplier: string) =>
    history.filter((h) => h.materialId === materialId && h.supplier === supplier).map((h) => diffDays(h.receivedDate, h.promisedDate));

  for (const m of (ds.materials ?? []).filter((x) => x.type !== 'MIX')) {
    const proj = risk.projections.find((p) => p.materialId === m.id);
    if (!proj) continue;
    const r = rng(hash(m.id) ^ (options.seed ?? 20260101));

    // Variabilidad del consumo del material: media ponderada del CV de los SKUs que lo usan.
    let wsum = 0;
    let cvsum = 0;
    for (const [skuId, perDay] of risk.plan.bySku) {
      const coef = risk.explosion.coefficients.get(skuId)?.get(m.id);
      if (!coef) continue;
      const weight = perDay.reduce((a, b) => a + b, 0) * coef;
      if (weight <= 0) continue;
      const meanWeekly = perDay.reduce((a, b) => a + b, 0) / weeks;
      const sig = options.sigmaBySku?.[skuId];
      const cv = sig !== undefined && meanWeekly > 0 ? Math.min(0.5, sig / meanWeekly) : defaultCv;
      wsum += weight;
      cvsum += weight * cv;
    }
    const cv = wsum > 0 ? cvsum / wsum : defaultCv;

    const main = [...m.suppliers].sort((a, b) => b.share - a.share)[0]?.supplier;
    const mainDelays = main ? delays(m.id, main) : [];
    const sample = (supplier: string) => {
      const d = supplier === main ? mainDelays : delays(m.id, supplier);
      const pool = d.length > 0 ? d : mainDelays;
      return pool.length > 0 ? pool[Math.floor(r() * pool.length)] : 0;
    };

    const myPos = pos.filter((p) => p.materialId === m.id);
    let beforeArrival = 0;
    let in28 = 0;
    const ruptureDays: number[] = [];
    const leadTimes: number[] = [];

    for (let s = 0; s < sims; s++) {
      const factor = Array.from({ length: weeks }, () => Math.max(0.2, 1 + cv * normal(r)));
      const receipts = Array(H).fill(0) as number[];
      for (const p of myPos) {
        const base = p.dueDate <= risk.dates[0] ? 0 : risk.dates.indexOf(p.dueDate);
        if (base < 0) continue;
        const d = Math.min(H - 1, Math.max(0, base + sample(p.supplier)));
        receipts[d] += p.qty;
      }
      const lead = Math.max(1, m.leadTimeDays + (main ? sample(main) : 0));
      leadTimes.push(lead);

      let stock = m.stock;
      let rupture = -1;
      for (let d = 0; d < H; d++) {
        stock += receipts[d] - proj.consumption[d] * factor[Math.floor(d / 7)];
        if (stock < -1e-6) { rupture = d; break; }
      }
      if (rupture >= 0) {
        if (rupture <= 28) in28 += 1;
        ruptureDays.push(rupture);
        if (rupture <= lead) beforeArrival += 1;
      }
    }

    ruptureDays.sort((a, b) => a - b);
    leadTimes.sort((a, b) => a - b);
    const enough = ruptureDays.length >= Math.max(5, sims * 0.02);
    out.push({
      materialId: m.id,
      sims,
      pRuptureBeforeArrival: beforeArrival / sims,
      pRuptureIn28Days: in28 / sims,
      ruptureDayP10: enough ? pctile(ruptureDays, 0.1) : null,
      ruptureDayP50: enough ? pctile(ruptureDays, 0.5) : null,
      ruptureDayP90: enough ? pctile(ruptureDays, 0.9) : null,
      delaySamples: mainDelays.length,
      consumptionCv: cv,
      leadTimeP50: pctile(leadTimes, 0.5),
    });
  }
  return out;
}
