import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RamoDataset, validateDataset } from '@ramo/domain';
import { answerQuestion, buildInsights, computeNetProduction, demandForHorizon, runForecast, runSupplyRisk, withLeadTimes } from '@ramo/engine';
import { parseDemandHistory } from './index';

const read = (p: string) => readFileSync(new URL(`../../../data/synthetic/${p}`, import.meta.url), 'utf8');
const ds: RamoDataset = JSON.parse(read('dataset.json'));
const history = parseDemandHistory(read('sap/limpio/historico_demanda.csv'), { dataset: ds, cutAt: '2026-10-05T08:00' });
const forecast = runForecast(ds.skus, history.rows, { targetStart: '2026-10-05', horizonWeeks: 13 });
const sigma = Object.fromEntries(forecast.skus.map((s) => [s.skuId, s.backtest.sd[0]]));
const net = computeNetProduction(ds, demandForHorizon(ds, 'V-N1-2026-W40', 'V-PBO-2026-10'));

const run = (d: RamoDataset, extra: { consolidationDays?: number } = {}) => {
  const risk = runSupplyRisk(d, net);
  return { risk, ins: buildInsights({ ds: d, net, risk, sigmaBySku: sigma, demandHistory: history.rows, today: '2026-10-05', ...extra }) };
};
const { risk, ins } = run(ds);
const rec = (id: string) => ins.recommendations.find((r) => r.id === id);

describe('capa de recomendaciones sobre el ejemplo sintético', () => {
  it('el dataset con historial de órdenes y solicitudes es válido', () => {
    expect(validateDataset(ds)).toEqual([]);
    expect(ds.orderHistory!.length).toBeGreaterThan(200);
  });

  it('cada recomendación trae su porqué y tiene un id único', () => {
    expect(ins.recommendations.length).toBeGreaterThan(10);
    expect(ins.recommendations.every((r) => r.why.length > 0)).toBe(true);
    expect(new Set(ins.recommendations.map((r) => r.id)).size).toBe(ins.recommendations.length);
  });

  it('plazos dinámicos: los proveedores sistemáticamente tarde (cacao, maíz, películas) piden un plazo mayor', () => {
    for (const id of ['MT-CACAO', 'MT-MAIZ', 'MT-FILM-P']) {
      const lt = ins.leadTimes.find((l) => l.materialId === id)!;
      expect(lt.direction).toBe('INCREASE');
      expect(lt.proposedDays).toBeGreaterThan(lt.currentDays + 2);
    }
    expect(ins.leadTimes.some((l) => l.materialId === 'MT-SAL')).toBe(false); // puntual: sin cambio
    expect(rec('LEAD_TIME|MT-CACAO')!.impact).toBeTruthy();
  });

  it('cuota rota: el cacao negociado 60/40 se pide ~85/15; la harina y las cajas respetan la suya', () => {
    const q = (id: string) => ins.quota.find((x) => x.materialId === id)!;
    expect(q('MT-CACAO').broken).toBe(true);
    expect(q('MT-CACAO').rows[0].actual).toBeGreaterThan(0.8);
    expect(q('MT-HARINA').broken).toBe(false);
    expect(q('MT-CAJA-A').broken).toBe(false);
    expect(rec('QUOTA|MT-CACAO')).toBeDefined();
  });

  it('excepción a la cuota por riesgo de plazo: el cacao se salva solo pidiéndole al proveedor regional rápido', () => {
    const exc = ins.quotaExceptions.find((e) => e.materialId === 'MT-CACAO')!;
    expect(exc).toMatchObject({ mainSupplier: 'Cacao Import 1', fastSupplier: 'Cacao Import 2' });
    expect(exc.fastP80).toBeLessThanOrEqual(exc.daysToRupture);
    expect(exc.mainP80).toBeGreaterThan(exc.daysToRupture);
    expect(rec('QUOTA_EXC|MT-CACAO')!.why.join(' ')).toContain('excepción');
  });

  it('anomalías: detecta el duplicado de la caja A y la cantidad atípica de la sal, y no marca las normales', () => {
    const refs = ins.anomalies.map((a) => `${a.kind}:${a.ref}`);
    expect(refs).toContain('DUPLICATE_REQUISITION:SP-1001');
    expect(refs).toContain('QUANTITY_OUTLIER:SP-1002');
    expect(ins.anomalies.some((a) => a.ref === 'SP-1003' || a.ref === 'SP-1004')).toBe(false);
  });

  it('órdenes abiertas tardías: se propone adelantar la del cacao y la de la película de ponqué', () => {
    expect(rec('ORDER_ADV|MT-CACAO')).toBeDefined();
    expect(rec('ORDER_ADV|MT-FILM-P')).toBeDefined();
  });

  it('el ajuste por variabilidad sube cada pedido sugerido', () => {
    const withSuggestion = risk.risks.filter((r) => r.suggestion);
    expect(withSuggestion.length).toBeGreaterThan(3);
    for (const r of withSuggestion) {
      const adj = ins.adjusted.get(r.materialId)!;
      expect(adj.buffer).toBeGreaterThan(0);
      expect(adj.qty).toBe(adj.baseQty + adj.buffer);
    }
  });

  it('consolidación: con una ventana de 7 días no hay grupos; con 14, se juntan las bolsas de Plásticos H', () => {
    expect(ins.consolidated).toEqual([]);
    const wide = run(ds, { consolidationDays: 14 }).ins.consolidated.find((c) => c.supplier === 'Plásticos H')!;
    expect(wide.lines.map((l) => l.materialId).sort()).toEqual(['MT-BOLSA-C', 'MT-BOLSA-T']);
    expect(wide.ordersBefore).toBe(2);
  });

  it('cierra el ciclo: al aprobar el plazo del cacao la recomendación desaparece y el riesgo ya usa el plazo real', () => {
    const lt = ins.leadTimes.find((l) => l.materialId === 'MT-CACAO')!;
    const approved = withLeadTimes(ds, { 'MT-CACAO': lt.proposedDays });
    const after = run(approved);
    expect(after.ins.recommendations.some((r) => r.id === 'LEAD_TIME|MT-CACAO')).toBe(false);
    expect(after.risk.risks.find((r) => r.materialId === 'MT-CACAO')!.leadTimeDays).toBe(lt.proposedDays);
  });

  it('ventas atípicas del histórico: se señalan como baja urgencia', () => {
    expect(ins.spikes.length).toBeGreaterThan(0);
    expect(ins.recommendations.filter((r) => r.id.startsWith('ANOMALY|SPIKE')).every((r) => r.urgency === 'WAIT')).toBe(true);
  });

  it('el copiloto explica el cacao con cifras del tablero y del historial', () => {
    const a = answerQuestion('¿Por qué el cacao está en riesgo?', ds, risk, ins);
    expect(a.topic).toBe('material:MT-CACAO');
    const text = a.lines.join('\n');
    expect(text).toContain('Cacao importado');
    expect(text).toContain('Cuota rota');
    expect(text).toContain('Excepción a la cuota');
  });
});
