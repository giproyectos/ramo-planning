import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RamoDataset, convertCommercialQty, toProductiveQty, validateDataset } from './index';

const load = (): RamoDataset =>
  JSON.parse(readFileSync(new URL('../../../data/synthetic/dataset.json', import.meta.url), 'utf8'));

const codes = (ds: RamoDataset) => validateDataset(ds).map((i) => i.code);

describe('dataset sintético', () => {
  it('es válido y está marcado como sintético', () => {
    const ds = load();
    expect(ds.synthetic).toBe(true);
    expect(validateDataset(ds)).toEqual([]);
  });

  it('modela tripulaciones compartidas y los 3 flujos de demanda', () => {
    const ds = load();
    expect(ds.crews.filter((c) => c.lineIds.length > 1).map((c) => c.id)).toEqual(['C-BARMINI', 'C-MAIZTOST']);
    expect(new Set(ds.demand.map((d) => d.flow))).toEqual(new Set(['CEDI', 'HARD_DISCOUNT', 'EXPORT']));
  });

  it('todos los lunes de semana caen en lunes', () => {
    const weeks = new Set(load().demand.map((d) => d.weekStart));
    for (const w of weeks) expect(new Date(`${w}T00:00:00Z`).getUTCDay()).toBe(1);
  });
});

describe('validación de integridad', () => {
  it('detecta SKU con línea inexistente (perfil general roto)', () => {
    const ds = load();
    ds.skus[0].lineId = 'L-NOPE';
    expect(codes(ds)).toContain('UNKNOWN_LINE');
  });

  it('detecta incoherencia línea/tripulación', () => {
    const ds = load();
    ds.crews[1].lineIds = ['L-BARR'];
    expect(codes(ds)).toContain('CREW_LINE_MISMATCH');
  });

  it('detecta unidad productiva incompatible con el ritmo de la línea', () => {
    const ds = load();
    ds.skus.find((s) => s.id === 'SK-006')!.productiveUnit = 'u';
    expect(codes(ds)).toContain('UNIT_MISMATCH');
  });

  it('exige lunes, cantidades no negativas y sin filas repetidas', () => {
    const ds = load();
    ds.demand[0].weekStart = '2026-10-06';
    ds.demand[1].commercialQty = -1;
    ds.demand.push({ ...ds.demand[2] });
    expect(codes(ds)).toEqual(expect.arrayContaining(['WEEK_NOT_MONDAY', 'NEGATIVE_QTY', 'DUPLICATE_DEMAND']));
  });

  it('un building block sin motivo o autor es inválido (trazabilidad)', () => {
    const ds = load();
    ds.buildingBlocks[0].reason = '  ';
    ds.buildingBlocks[1].author = '';
    expect(codes(ds)).toEqual(expect.arrayContaining(['MISSING_REASON', 'MISSING_AUTHOR']));
  });

  it('exige calendario por línea', () => {
    const ds = load();
    ds.calendars.pop();
    expect(codes(ds)).toContain('MISSING_CALENDAR');
  });
});

describe('conversión de unidades', () => {
  const sku = load().skus.find((s) => s.id === 'SK-001')!; // 24 u/caja, 0.96 kg/caja, 18.000/caja

  it('cubre las cuatro vistas del tablero', () => {
    expect(convertCommercialQty(sku, 100, 'commercial_units')).toBe(100);
    expect(convertCommercialQty(sku, 100, 'productive_units')).toBe(2400);
    expect(convertCommercialQty(sku, 100, 'tons')).toBeCloseTo(0.096);
    expect(convertCommercialQty(sku, 100, 'cost')).toBe(1_800_000);
  });

  it('toProductiveQty usa kg en líneas de kg/h', () => {
    const crispetas = load().skus.find((s) => s.id === 'SK-006')!;
    expect(toProductiveQty(crispetas, 10)).toBeCloseTo(12);
  });
});
