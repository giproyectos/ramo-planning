import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DemandRecord, RamoDataset } from '@ramo/domain';
import { buildMd61 } from './index';

const ds: RamoDataset = JSON.parse(readFileSync(new URL('../../../data/synthetic/dataset.json', import.meta.url), 'utf8'));
const records = ds.demand.filter((d) => d.versionId === 'V-N1-2026-W40');
const cedi = records.filter((r) => r.flow === 'CEDI');

describe('archivo de demanda para MD61', () => {
  const out = buildMd61(ds, records);

  it('genera una fila por SKU y semana con solo el flujo CEDI', () => {
    expect(out.issues).toEqual([]);
    expect(out.rows).toHaveLength(cedi.length);
    expect(out.totalCommercial).toBe(cedi.reduce((a, r) => a + Math.round(r.commercialQty), 0));
  });

  it('Hard Discount y Exportaciones no se cargan, salvo que se pida', () => {
    const withMto = buildMd61(ds, records, { flows: ['CEDI', 'HARD_DISCOUNT', 'EXPORT'] });
    expect(withMto.totalCommercial).toBeGreaterThan(out.totalCommercial);
  });

  it('mapea la planta de la línea al centro SAP y rellena el material a 18 dígitos', () => {
    const sk1 = out.rows.find((r) => r.material.endsWith('9000001'))!;
    const sk6 = out.rows.find((r) => r.material.endsWith('9000006'))!;
    expect(sk1.centro).toBe('1000');
    expect(sk6.centro).toBe('2000');
    expect(sk1.material).toHaveLength(18);
  });

  it('formato del archivo: encabezado, fechas DD.MM.YYYY y valores por defecto', () => {
    const lines = out.csv.trim().split('\n');
    expect(lines[0]).toBe('Material;Centro;Tipo_req;Version;Periodo;Fecha;Cantidad;UM');
    expect(lines).toHaveLength(out.rows.length + 1);
    const first = out.rows[0];
    expect(first).toMatchObject({ tipoReq: 'LSF', version: '00', periodo: 'W', unidad: 'CJ' });
    expect(first.fecha).toMatch(/^\d{2}\.\d{2}\.\d{4}$/);
  });

  it('suma las filas repetidas de un mismo SKU y semana (p. ej. dos versiones)', () => {
    const r: DemandRecord = { versionId: 'V', skuId: 'SK-001', weekStart: '2026-10-05', flow: 'CEDI', commercialQty: 100 };
    const res = buildMd61(ds, [r, { ...r, commercialQty: 50.4 }]);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].cantidad).toBe(150);
  });

  it('omite cantidades en cero y avisa si no queda nada', () => {
    const res = buildMd61(ds, [{ versionId: 'V', skuId: 'SK-001', weekStart: '2026-10-05', flow: 'CEDI', commercialQty: 0.2 }]);
    expect(res.rows).toHaveLength(0);
    expect(res.issues[0]).toMatchObject({ code: 'EMPTY_FILE', severity: 'warning' });
  });

  it('error si la planta no tiene centro SAP, SKU desconocido o cantidad negativa', () => {
    const noCenter = { ...ds, plants: ds.plants.map((p) => ({ ...p, sapCenter: undefined })) };
    expect(buildMd61(noCenter, cedi.slice(0, 3)).issues.some((i) => i.code === 'MISSING_CENTER' && i.severity === 'error')).toBe(true);
    const bad: DemandRecord[] = [
      { versionId: 'V', skuId: 'SK-999', weekStart: '2026-10-05', flow: 'CEDI', commercialQty: 10 },
      { versionId: 'V', skuId: 'SK-001', weekStart: '2026-10-12', flow: 'CEDI', commercialQty: -10 },
    ];
    const codes = buildMd61(ds, bad).issues.map((i) => i.code);
    expect(codes).toContain('UNKNOWN_SKU');
    expect(codes).toContain('NEGATIVE_QTY');
  });

  it('opciones de versión, tipo de requerimiento y unidad', () => {
    const res = buildMd61(ds, cedi.slice(0, 2), { version: '01', requirementType: 'VSF', unit: 'UN' });
    expect(res.rows[0]).toMatchObject({ version: '01', tipoReq: 'VSF', unidad: 'UN' });
  });
});
