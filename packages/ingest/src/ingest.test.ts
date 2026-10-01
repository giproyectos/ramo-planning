import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RamoDataset, validateDataset } from '@ramo/domain';
import {
  IngestContext, IngestTexts, applyBaseline, ingestBaseline, parseCsv, parseDate, parseNumber, parseTime, parseStock, summarizeIssues,
} from './index';
import { computeNetProduction, demandForHorizon } from '@ramo/engine';

const read = (path: string) => readFileSync(new URL(`../../../data/synthetic/${path}`, import.meta.url), 'utf8');
const dataset: RamoDataset = JSON.parse(read('dataset.json'));
const ctx: IngestContext = { dataset, cutAt: '2026-10-05T08:00' };

const files = (dir: 'limpio' | 'sucio'): IngestTexts => ({
  stock: read(`sap/${dir}/inventarios_stock.csv`),
  movimientos: read(`sap/${dir}/inventarios_movimientos.csv`),
  abastecimiento: read(`sap/${dir}/abastecimiento.csv`),
  despachos: read(`sap/${dir}/despachos.csv`),
});
const codes = (issues: { code: string }[]) => new Set(issues.map((i) => i.code));

describe('CSV y conversiones', () => {
  it('detecta delimitador, quita BOM y respeta comillas', () => {
    const t = parseCsv('﻿a;b;c\r\n1;"x;y";"he said ""hi"""\r\n\r\n2;3;4\r\n');
    expect(t.delimiter).toBe(';');
    expect(t.headers).toEqual(['a', 'b', 'c']);
    expect(t.rows.map((r) => r.cells)).toEqual([['1', 'x;y', 'he said "hi"'], ['2', '3', '4']]);
    expect(parseCsv('a,b\n1,2').delimiter).toBe(',');
    expect(parseCsv('a\tb\n1\t2').delimiter).toBe('\t');
  });

  it('números: coma decimal (por defecto), punto decimal y signo final de SAP', () => {
    expect(parseNumber('1.234,56')).toBe(1234.56);
    expect(parseNumber('7.917')).toBe(7917);
    expect(parseNumber('-3,5')).toBe(-3.5);
    expect(parseNumber('1.234-')).toBe(-1234);
    expect(parseNumber('1,234.56', 'dot')).toBe(1234.56);
    expect(parseNumber('abc')).toBeNull();
    expect(parseNumber('')).toBeNull();
  });

  it('fechas y horas: formatos SAP/ISO y fechas imposibles', () => {
    expect(parseDate('05.10.2026')).toBe('2026-10-05');
    expect(parseDate('2026-10-05')).toBe('2026-10-05');
    expect(parseDate('20261005')).toBe('2026-10-05');
    expect(parseDate('5/10/2026')).toBeNull();
    expect(parseDate('31.02.2026')).toBeNull();
    expect(parseTime('9:05')).toBe('09:05');
    expect(parseTime('140000')).toBe('14:00');
    expect(parseTime('25:00')).toBeNull();
  });
});

describe('bases limpias', () => {
  const b = ingestBaseline(ctx, files('limpio'));

  it('no producen errores y las 4 bases quedan en ok', () => {
    expect(b.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(b.status).toEqual({ stock: 'ok', movimientos: 'ok', abastecimiento: 'ok', despachos: 'ok' });
    expect(b.usable).toBe(true);
    expect(b.rowCounts.stock).toBe(10);
  });

  it('el stock convertido (UN, KG, CJ) coincide con el inventario del dataset', () => {
    for (const inv of dataset.inventory) {
      const s = b.skus.find((x) => x.skuId === inv.skuId)!;
      expect(Math.abs(s.stockCommercial - inv.onHandCommercial)).toBeLessThanOrEqual(1);
    }
  });

  it('suma varios almacenes del mismo SKU', () => {
    const rows = parseStock(files('limpio').stock!, ctx).rows.filter((r) => r.skuId === 'SK-001');
    expect(rows).toHaveLength(2);
    expect(b.skus.find((s) => s.skuId === 'SK-001')!.stockCommercial).toBeCloseTo(rows[0].commercialQty + rows[1].commercialQty, 0);
  });

  it('abastecimiento: netea el doble conteo y deja solo los envíos sin nacionalizar en tránsito', () => {
    // 2 envíos completados (2 tramos c/u, misma cantidad) y 2 en tránsito (1 tramo) por SKU.
    expect(b.skus.find((s) => s.skuId === 'SK-002')!.inTransitCommercial).toBe(1100 + 1250);
    expect(b.skus.find((s) => s.skuId === 'SK-006')!.inTransitCommercial).toBeCloseTo(1100 + 1250, 0);
    expect(b.issues.filter((i) => i.code === 'DOUBLE_COUNT')).toHaveLength(4);
  });

  it('despachos: separa lo pendiente dentro y fuera de la ventana 8 am–2 pm', () => {
    const inWin = b.skus.reduce((a, s) => a + s.pendingDispatchCommercial, 0);
    const outWin = b.skus.reduce((a, s) => a + s.pendingOutsideWindowCommercial, 0);
    expect(inWin).toBeGreaterThan(0);
    expect(outWin).toBeGreaterThan(0);
  });

  it('disponible = stock + tránsito − pendiente de despacho (mínimo 0) y hay cobertura calculada', () => {
    for (const s of b.skus) {
      expect(s.availableCommercial).toBe(Math.max(0, Math.round(s.stockCommercial + s.inTransitCommercial - s.pendingDispatchCommercial)));
      expect(s.coverageDays).not.toBeNull();
    }
    expect(codes(b.issues).has('IMPLIED_NEGATIVE_OPENING')).toBe(false);
  });
});

describe('bases con defectos', () => {
  const clean = ingestBaseline(ctx, files('limpio'));
  const dirty = ingestBaseline(ctx, files('sucio'));

  it('detecta cada defecto inyectado', () => {
    const expected = [
      'UNKNOWN_MATERIAL', 'BAD_NUMBER', 'NEGATIVE_STOCK', 'DUPLICATE_STOCK_ROW', 'UNKNOWN_UNIT',
      'STALE_ROW', 'FUTURE_ROW', 'OUT_OF_WINDOW', 'DUPLICATE_MOVEMENT', 'IMPLIED_NEGATIVE_OPENING',
      'MISSING_REFERENCE', 'QTY_MISMATCH', 'DUPLICATE_ORDER_LINE', 'OVER_DELIVERED', 'BAD_DATE',
    ];
    const found = codes(dirty.issues);
    for (const code of expected) expect(found.has(code), `falta ${code}`).toBe(true);
    // Y el set limpio no tiene ninguno de los de severidad error.
    expect(clean.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('las filas defectuosas no contaminan el stock ni el tránsito', () => {
    for (const s of clean.skus) {
      const d = dirty.skus.find((x) => x.skuId === s.skuId)!;
      expect(d.stockCommercial).toBe(s.stockCommercial);
    }
    expect(dirty.skus.find((s) => s.skuId === 'SK-006')!.inTransitCommercial).toBe(clean.skus.find((s) => s.skuId === 'SK-006')!.inTransitCommercial);
  });

  it('agrupa los problemas por severidad y código con un ejemplo', () => {
    const summary = summarizeIssues(dirty.issues);
    expect(summary[0].severity).toBe('error');
    expect(summary.find((g) => g.code === 'UNKNOWN_MATERIAL')!.example).toContain('9999999');
  });
});

describe('bases incompletas', () => {
  it('una columna obligatoria faltante bloquea la base y se nombra', () => {
    const noQty = files('limpio').stock!.replace('Libre utilización', 'Otra cosa');
    const r = parseStock(noQty, ctx);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'MISSING_COLUMN' && i.message.includes('cantidad'))).toBe(true);
  });

  it('sin la base de stock no es utilizable; sin despachos sí, con aviso', () => {
    const f = files('limpio');
    expect(ingestBaseline(ctx, { ...f, stock: undefined }).usable).toBe(false);
    const sinDesp = ingestBaseline(ctx, { ...f, despachos: undefined });
    expect(sinDesp.usable).toBe(true);
    expect(sinDesp.status.despachos).toBe('missing');
    expect(sinDesp.issues.some((i) => i.code === 'MISSING_BASE' && i.severity === 'warning')).toBe(true);
  });

  it('acepta alias de encabezado sin tildes ni mayúsculas', () => {
    const t = 'MATERIAL;centro;ALMACEN;um;stock\n000000000009000001;1000;0001;CJ;100\n';
    expect(parseStock(t, ctx).rows[0]).toMatchObject({ skuId: 'SK-001', commercialQty: 100 });
  });
});

describe('integración con el motor', () => {
  it('applyBaseline reemplaza el inventario y el dataset sigue siendo válido', () => {
    const b = ingestBaseline(ctx, files('limpio'));
    const ds2 = applyBaseline(dataset, b);
    expect(validateDataset(ds2)).toEqual([]);
    const sk = ds2.inventory.find((i) => i.skuId === 'SK-002')!;
    expect(sk.onHandCommercial).toBe(b.skus.find((s) => s.skuId === 'SK-002')!.availableCommercial);

    const net = computeNetProduction(ds2, demandForHorizon(ds2, 'V-N1-2026-W40', 'V-PBO-2026-10'));
    expect(net.length).toBeGreaterThan(0);
  });
});
