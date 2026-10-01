import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RamoDataset, validateDataset } from '@ramo/domain';
import {
  FC_N1_ID, FC_PBO_ID, applyBuildingBlocks, computeNetProduction, demandForHorizon, runForecast, withForecastVersions,
} from '@ramo/engine';
import { IngestContext, parseDemandHistory } from './index';

const read = (p: string) => readFileSync(new URL(`../../../data/synthetic/${p}`, import.meta.url), 'utf8');
const dataset: RamoDataset = JSON.parse(read('dataset.json'));
const ctx: IngestContext = { dataset, cutAt: '2026-10-05T08:00' };
const clean = parseDemandHistory(read('sap/limpio/historico_demanda.csv'), ctx);
const dirty = parseDemandHistory(read('sap/sucio/historico_demanda.csv'), ctx);
const codes = (r: { issues: { code: string }[] }) => new Set(r.issues.map((i) => i.code));

describe('histórico de demanda', () => {
  it('el archivo limpio se lee sin problemas', () => {
    expect(clean.ok).toBe(true);
    expect(clean.issues).toEqual([]);
    expect(clean.rows).toHaveLength(988);
    expect(new Set(clean.rows.map((r) => r.flow))).toEqual(new Set(['CEDI', 'HARD_DISCOUNT', 'EXPORT']));
  });

  it('cubre 104 semanas por SKU y convierte unidades (UN, KG, CJ) a cajas', () => {
    for (const sku of dataset.skus) {
      const cedi = clean.rows.filter((r) => r.skuId === sku.id && r.flow === 'CEDI');
      expect(cedi).toHaveLength(104);
    }
    // Mini (UN) y Crispetas (KG) quedan en el mismo orden de magnitud que el resto en cajas.
    const first = (id: string) => clean.rows.find((r) => r.skuId === id && r.flow === 'CEDI')!.commercialQty;
    expect(first('SK-005')).toBeGreaterThan(10_000);
    expect(first('SK-005')).toBeLessThan(60_000);
    expect(first('SK-006')).toBeGreaterThan(1_000);
  });

  it('trae el pronóstico del proceso vigente salvo en la primera semana', () => {
    const cedi = clean.rows.filter((r) => r.skuId === 'SK-001' && r.flow === 'CEDI').sort((a, b) => a.weekStart.localeCompare(b.weekStart));
    expect(cedi[0].priorForecast).toBeNull();
    expect(cedi.slice(1).every((r) => r.priorForecast !== null)).toBe(true);
  });

  it('detecta cada defecto inyectado y no deja pasar las filas malas', () => {
    const expected = ['UNKNOWN_MATERIAL', 'WEEK_NOT_MONDAY', 'STALE_ROW', 'BAD_NUMBER', 'BAD_FLOW', 'NEGATIVE_QTY', 'DUPLICATE_HISTORY_ROW', 'FUTURE_ROW', 'MISSING_WEEKS'];
    for (const c of expected) expect(codes(dirty).has(c), `falta ${c}`).toBe(true);
    // Todas las semanas válidas son lunes y anteriores al corte.
    expect(dirty.rows.every((r) => new Date(`${r.weekStart}T00:00:00Z`).getUTCDay() === 1 && r.weekStart < '2026-10-05')).toBe(true);
    // Quedan 3 filas menos de la serie (las quitadas a propósito) y ninguna de las inyectadas.
    expect(dirty.rows.length).toBe(clean.rows.length - 3);
  });

  it('una columna obligatoria faltante rechaza el archivo', () => {
    const r = parseDemandHistory(read('sap/limpio/historico_demanda.csv').replace('Cantidad', 'Otra'), ctx);
    expect(r.ok).toBe(false);
    expect(codes(r).has('MISSING_COLUMN')).toBe(true);
  });
});

describe('de histórico a plan de demanda', () => {
  const target = '2026-10-05';
  const n1 = runForecast(dataset.skus, clean.rows, { targetStart: target, horizonWeeks: 13 });
  const pbo = runForecast(dataset.skus, clean.rows, { targetStart: target, horizonWeeks: 13, trainedBefore: '2026-09-07' });

  it('pronostica los 8 SKUs a 13 semanas, con intervalo y comparación contra el proceso vigente', () => {
    for (const run of [n1, pbo]) {
      expect(run.skipped).toEqual([]);
      expect(run.skus).toHaveLength(8);
      for (const s of run.skus) {
        expect(s.weeks).toHaveLength(13);
        expect(s.weeks[0]).toBe(target);
        expect(s.forecast.every((f) => f > 0)).toBe(true);
        s.forecast.forEach((f, i) => { expect(s.lower[i]).toBeLessThanOrEqual(f); expect(s.upper[i]).toBeGreaterThanOrEqual(f); });
        expect(s.current).not.toBeNull();
        expect(s.recent).not.toBeNull();
        expect(Number.isFinite(s.backtest.wapeAvg)).toBe(true);
      }
    }
  });

  it('el PBO se corre con menos historia y a mayor distancia que el N+1', () => {
    expect(pbo.trainedBefore).toBe('2026-09-07');
    expect(pbo.skus[0].backtest.horizon).toBe(17);
    expect(n1.skus[0].backtest.horizon).toBe(13);
  });

  it('un histórico con huecos igual pronostica e interpola', () => {
    const run = runForecast(dataset.skus, dirty.rows, { targetStart: target, horizonWeeks: 13 });
    expect(run.skus.find((s) => s.skuId === 'SK-001')!.filledWeeks).toBeGreaterThan(0);
  });

  const ds2 = withForecastVersions(dataset, { pbo, n1, createdAt: '2026-10-01T10:00:00Z' });

  it('las versiones generadas son válidas, enlazadas (N+1 basado en el PBO) y conservan los flujos bajo pedido', () => {
    expect(validateDataset(ds2)).toEqual([]);
    expect(ds2.versions.find((v) => v.id === FC_N1_ID)).toMatchObject({ kind: 'WEEKLY_N1', basedOn: FC_PBO_ID });
    const mtoSource = dataset.demand.filter((d) => d.versionId === 'V-N1-2026-W40' && d.flow !== 'CEDI').length;
    expect(ds2.demand.filter((d) => d.versionId === FC_N1_ID && d.flow !== 'CEDI')).toHaveLength(mtoSource);
    expect(ds2.demand.filter((d) => d.versionId === FC_N1_ID && d.flow === 'CEDI')).toHaveLength(8 * 13);
  });

  it('los building blocks sintéticos se aplican sobre el pronóstico y quedan trazados', () => {
    const base = ds2.demand.find((d) => d.versionId === FC_N1_ID && d.skuId === 'SK-001' && d.weekStart === '2026-10-19' && d.flow === 'CEDI')!.commercialQty;
    const withBlocks = applyBuildingBlocks(ds2, FC_N1_ID).find((d) => d.skuId === 'SK-001' && d.weekStart === '2026-10-19' && d.flow === 'CEDI')!.commercialQty;
    expect(withBlocks).toBe(base + 3000); // BB-001: +3.000 cajas, promoción de temporada
    const traced = ds2.buildingBlocks.filter((b) => b.versionId === FC_N1_ID);
    expect(traced.length).toBe(3);
    expect(traced.every((b) => b.reason.trim() && b.author.trim())).toBe(true);
  });

  it('sin building blocks sintéticos solo queda el pronóstico', () => {
    const bare = withForecastVersions(dataset, { pbo, n1, keepDatasetBlocks: false });
    expect(bare.buildingBlocks.filter((b) => b.versionId === FC_N1_ID)).toEqual([]);
  });

  it('el plan generado alimenta el neto del MPS', () => {
    const net = computeNetProduction(ds2, demandForHorizon(ds2, FC_N1_ID, FC_PBO_ID));
    expect(net.length).toBe(8 * 13);
    expect(net.every((r) => r.netProduction >= 0)).toBe(true);
  });
});
