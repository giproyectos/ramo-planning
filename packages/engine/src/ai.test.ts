import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RamoDataset } from '@ramo/domain';
import {
  ForecastRun, computeCrp, computeNetProduction, demandForHorizon, hoursAfterMoves, movesToAdjustments, normalCdf, overloadAlerts, plantRequirementRecords,
  runDrp, runSupplyRisk, simulateSupplyRisk, snapshotCycle, stockoutRisks, suggestBiasCorrections, suggestRebalance,
} from './index';

const ds: RamoDataset = JSON.parse(readFileSync(new URL('../../../data/synthetic/dataset.json', import.meta.url), 'utf8'));
const latest = (kind: 'WEEKLY_N1' | 'PBO_MONTHLY') => ds.versions.filter((v) => v.kind === kind).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0].id;
const demand = demandForHorizon(ds, latest('WEEKLY_N1'), latest('PBO_MONTHLY'));
const net = computeNetProduction(ds, demand);

describe('optimizador de capacidad (rebalanceo)', () => {
  const capacity = computeCrp(ds, net);
  const alertsBefore = overloadAlerts(capacity);
  const plan = suggestRebalance(ds, net);

  it('el escenario sintético tiene exceso que resolver', () => {
    expect(alertsBefore.length).toBeGreaterThan(0);
    expect(plan.overloaded).toBeGreaterThan(0);
    expect(plan.excessBefore).toBeGreaterThan(0);
  });

  it('mover producción realmente baja las horas extra necesarias', () => {
    expect(plan.moves.length).toBeGreaterThan(0);
    expect(plan.movedHours).toBeGreaterThan(0);
    const sinMover = suggestRebalance(ds, net, { maxShiftWeeks: 0 });
    expect(sinMover.moves).toEqual([]);
    expect(plan.extraTotal).toBeLessThan(sinMover.extraTotal);
    expect(plan.extraTotal).toBeLessThan(plan.excessBefore);
  });

  it('adelantar producción conserva las cajas totales por producto', () => {
    const adj = movesToAdjustments(plan.moves);
    for (const s of ds.skus) {
      const delta = adj.filter((a) => a.skuId === s.id).reduce((a, x) => a + x.deltaCommercialQty, 0);
      expect(delta).toBe(0);
    }
  });

  it('solo adelanta (nunca pospone) y respeta el máximo de semanas', () => {
    for (const m of plan.moves) {
      expect(m.toWeek < m.fromWeek).toBe(true);
      const gap = (Date.parse(m.fromWeek) - Date.parse(m.toWeek)) / (7 * 86400000);
      expect(gap).toBeLessThanOrEqual(3);
      expect(m.qty).toBeGreaterThan(0);
    }
  });

  it('no mueve producción bajo pedido (Hard Discount / Exportaciones)', () => {
    for (const m of plan.moves) {
      const row = net.find((r) => r.skuId === m.skuId && r.weekStart === m.fromWeek)!;
      const movedFromWeek = plan.moves.filter((x) => x.skuId === m.skuId && x.fromWeek === m.fromWeek).reduce((a, x) => a + x.qty, 0);
      expect(movedFromWeek).toBeLessThanOrEqual(Math.max(0, row.netProduction - row.grossMto) + 1e-6);
    }
  });

  it('aplicar la sugerencia (movimientos + horas extra) deja menos horas faltantes', () => {
    const adjusted = snapshotCycle(ds, net, {
      decisions: plan.extraHours.map((e, i) => ({ id: `d${i}`, crewId: e.crewId, weekStart: e.weekStart, extraHours: e.hours, reason: 't', author: 't', createdAt: '' })),
      adjustments: movesToAdjustments(plan.moves).map((a, i) => ({ id: `a${i}`, ...a, reason: 't', author: 't', createdAt: '' })),
    });
    const totalBefore = alertsBefore.reduce((a, x) => a + x.excessHours, 0);
    const totalAfter = adjusted.alerts.reduce((a, x) => a + x.excessHours, 0);
    expect(totalAfter).toBeLessThan(totalBefore);
    // con horas extra para el remanente, no debe quedar exceso
    expect(totalAfter).toBeLessThan(0.5);
  });

  it('mover producción no crea sobrecarga nueva en las semanas receptoras', () => {
    const adjusted = snapshotCycle(ds, net, { decisions: [], adjustments: movesToAdjustments(plan.moves).map((a, i) => ({ id: `a${i}`, ...a, reason: 't', author: 't', createdAt: '' })) });
    const before = new Map(alertsBefore.map((a) => [`${a.crewId}|${a.weekStart}`, a.excessHours]));
    for (const a of adjusted.alerts) {
      const prev = before.get(`${a.crewId}|${a.weekStart}`) ?? 0;
      expect(a.excessHours).toBeLessThanOrEqual(prev + 0.05);
    }
  });

  it('reduce las horas de la línea origen justo en lo movido', () => {
    const m = plan.moves[0];
    const line = ds.skus.find((s) => s.id === m.skuId)!.lineId;
    const before = computeCrp(ds, net)
      .find((w) => w.weekStart === m.fromWeek)!
      .lines.find((l) => l.lineId === line)!.requiredHours;
    expect(hoursAfterMoves(ds, net, plan.moves, line, m.fromWeek)).toBeLessThan(before);
  });

  it('tras aplicar la sugerencia completa, el optimizador ya no ve sobrecarga (coincide con el CRP)', () => {
    const adjustedNet = net.map((r) => ({ ...r }));
    for (const a of movesToAdjustments(plan.moves)) {
      const row = adjustedNet.find((r) => r.skuId === a.skuId && r.weekStart === a.weekStart)!;
      row.netProduction += a.deltaCommercialQty;
    }
    const decisions = plan.extraHours.map((e, i) => ({ id: `d${i}`, crewId: e.crewId, weekStart: e.weekStart, extraHours: e.hours, reason: 't', author: 't', createdAt: '' }));
    const again = suggestRebalance(ds, adjustedNet, { decisions });
    expect(again.overloaded).toBe(0);
    expect(again.moves).toEqual([]);
    expect(overloadAlerts(computeCrp(ds, adjustedNet, { decisions }))).toEqual([]);
  });

  it('sin exceso no sugiere nada', () => {
    const light = net.map((r) => ({ ...r, netProduction: r.netProduction * 0.1, grossMto: 0 }));
    const p = suggestRebalance(ds, light);
    expect(p.moves).toEqual([]);
    expect(p.extraHours).toEqual([]);
  });
});

describe('riesgo de quiebre', () => {
  it('Φ(x) tiene los valores conocidos', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.645)).toBeCloseTo(0.95, 3);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3);
  });

  const drp = runDrp(ds, demand, { policy: 'DYNAMIC' });
  const sigma = Object.fromEntries(ds.skus.map((s) => [s.id, 3000]));

  it('sin σ no hay estimación', () => {
    expect(stockoutRisks(ds, drp, undefined)).toEqual([]);
  });

  it('las probabilidades están entre 0 y 1 y vienen ordenadas de mayor a menor', () => {
    const r = stockoutRisks(ds, drp, sigma);
    expect(r.length).toBeGreaterThan(0);
    for (const x of r) { expect(x.probability).toBeGreaterThanOrEqual(0); expect(x.probability).toBeLessThanOrEqual(1); }
    for (let i = 1; i < r.length; i++) expect(r[i - 1].probability).toBeGreaterThanOrEqual(r[i].probability);
  });

  it('un inventario proyectado negativo da más de 50 % y uno muy holgado casi 0', () => {
    const r = stockoutRisks(ds, drp, sigma);
    for (const x of r) {
      if (x.projected < 0) expect(x.probability).toBeGreaterThan(0.5);
      if (x.projected > 6 * x.sigma) expect(x.probability).toBeLessThan(0.001);
    }
  });

  it('la incertidumbre se acumula con √(semanas) dentro del plazo (valor calculado a mano)', () => {
    const slow = { ...ds, nodes: ds.nodes!.map((n) => (n.type === 'CEDI' ? { ...n, leadTimeWeeks: 3 } : n)) };
    const d = runDrp(slow, demand, { policy: 'DYNAMIC' });
    const cedi = slow.nodes!.find((n) => n.type === 'CEDI')!;
    let checked = 0;
    for (const x of stockoutRisks(slow, d, sigma).filter((r) => r.nodeId === cedi.id)) {
      const t = d.weeks.indexOf(x.weekStart);
      const sd = sigma[x.skuId] * Math.sqrt(cedi.demandShare) * Math.sqrt(t + 1);
      expect(x.probability).toBeCloseTo(normalCdf(-x.projected / sd), 9);
      if (t > 0) checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('más incertidumbre = más riesgo para el mismo inventario', () => {
    const low = stockoutRisks(ds, drp, Object.fromEntries(ds.skus.map((s) => [s.id, 500])));
    const high = stockoutRisks(ds, drp, Object.fromEntries(ds.skus.map((s) => [s.id, 8000])));
    const key = (x: { nodeId: string; skuId: string }) => `${x.nodeId}|${x.skuId}`;
    const lm = new Map(low.map((x) => [key(x), x]));
    // solo donde hay holgura (inventario positivo) más σ implica más riesgo
    for (const h of high) {
      const l = lm.get(key(h));
      if (l && l.projected > 0 && l.weekStart === h.weekStart) expect(h.probability).toBeGreaterThanOrEqual(l.probability - 1e-9);
    }
  });
});

describe('ajustes de demanda sugeridos', () => {
  const sku = (bias: number, wape: number, origins = 12) => ({
    skuId: 'S1', model: 'SES', weeks: [], forecast: Array(13).fill(10000), lower: [], upper: [],
    backtest: { bias: 0 }, recent: { bias, wape1: wape, origins }, candidates: [], current: null, interpolated: 0,
  });
  const run = (...skus: unknown[]) => ({ targetStart: '2026-10-05', horizonWeeks: 13, trainedBefore: '2026-10-05', skus, skipped: [] }) as unknown as ForecastRun;

  it('sobrepronóstico sistemático sugiere restar; subpronóstico sugiere sumar', () => {
    const over = suggestBiasCorrections(run(sku(0.08, 0.09)))[0];
    expect(over.weeklyDelta).toBeLessThan(0);
    const under = suggestBiasCorrections(run(sku(-0.08, 0.09)))[0];
    expect(under.weeklyDelta).toBeGreaterThan(0);
    expect(Math.abs(under.weeklyDelta)).toBe(Math.abs(over.weeklyDelta));
  });

  it('el error que cambia de signo (ruido) no genera sugerencia', () => {
    expect(suggestBiasCorrections(run(sku(0.01, 0.1)))).toEqual([]);
  });

  it('un sesgo pequeño no genera sugerencia', () => {
    expect(suggestBiasCorrections(run(sku(0.02, 0.021)))).toEqual([]);
  });

  it('topa la corrección al 12 % del nivel', () => {
    const n = suggestBiasCorrections(run(sku(0.4, 0.4)))[0];
    expect(Math.abs(n.weeklyDelta)).toBeLessThanOrEqual(0.12 * 10000 + 50);
  });

  it('con pocas semanas de evidencia no sugiere', () => {
    expect(suggestBiasCorrections(run(sku(0.1, 0.1, 4)))).toEqual([]);
  });
});

describe('simulación de riesgo de abastecimiento (Monte Carlo)', () => {
  const plant = computeNetProduction(ds, demand);
  const rd = runDrp(ds, demand, { policy: 'DYNAMIC' });
  const required = plantRequirementRecords(rd);
  const risk = runSupplyRisk(ds, computeNetProduction({ ...ds, inventory: [] }, [...required, ...demand.filter((d) => d.flow !== 'CEDI')]));
  const sims = simulateSupplyRisk(ds, risk, { sims: 300 });

  it('hay una simulación por material y las probabilidades son válidas', () => {
    expect(plant.length).toBeGreaterThan(0);
    expect(sims.length).toBe(risk.risks.length);
    for (const s of sims) {
      expect(s.pRuptureBeforeArrival).toBeGreaterThanOrEqual(0);
      expect(s.pRuptureIn28Days).toBeLessThanOrEqual(1);
      expect(s.pRuptureBeforeArrival).toBeLessThanOrEqual(1);
    }
  });

  it('es determinista: misma semilla, mismo resultado', () => {
    expect(simulateSupplyRisk(ds, risk, { sims: 300 })).toEqual(sims);
  });

  it('coincide con el tablero determinista en los extremos', () => {
    for (const r of risk.risks) {
      const s = sims.find((x) => x.materialId === r.materialId)!;
      if (r.status === 'CRITICAL') expect(s.pRuptureBeforeArrival).toBeGreaterThan(0.5);
      if (r.status === 'OK' && r.ruptureDate === null) expect(s.pRuptureBeforeArrival).toBeLessThan(0.2);
    }
  });

  it('más variabilidad del consumo no baja la probabilidad de ruptura', () => {
    const lowCv = simulateSupplyRisk(ds, risk, { sims: 300, defaultCv: 0.02 });
    const highCv = simulateSupplyRisk(ds, risk, { sims: 300, defaultCv: 0.4 });
    const avg = (a: typeof sims) => a.reduce((x, s) => x + s.pRuptureIn28Days, 0) / a.length;
    expect(avg(highCv)).toBeGreaterThanOrEqual(avg(lowCv) - 0.02);
  });

  it('si el proveedor se atrasa más, sube la probabilidad de quedarse sin material antes de que llegue el pedido', () => {
    const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
    const late = { ...ds, orderHistory: ds.orderHistory!.map((h) => ({ ...h, receivedDate: addDays(h.promisedDate, 25) })) };
    const lateSims = simulateSupplyRisk(late, risk, { sims: 300 });
    const avg = (a: typeof sims) => a.reduce((x, s) => x + s.pRuptureBeforeArrival, 0) / a.length;
    expect(avg(lateSims)).toBeGreaterThan(avg(sims) + 0.05);
    expect(lateSims.every((s, i) => s.leadTimeP50 >= sims[i].leadTimeP50)).toBe(true);
  });

  it('usa el historial de entregas del proveedor principal', () => {
    expect(sims.some((s) => s.delaySamples > 0)).toBe(true);
  });
});
