import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BomLine, Material, PurchaseOrderLine, RamoDataset, validateDataset } from '@ramo/domain';
import { NetPlanRow, computeNetProduction, consumptionBySku, dailyProduction, demandForHorizon, explodeBom, runSupplyRisk, splitByQuota } from './index';

const W = ['2026-10-05', '2026-10-12', '2026-10-19'];
const net = (qty = 50, weeks = W): NetPlanRow[] => weeks.map((w) => ({ skuId: 'A', weekStart: w, grossCedi: qty, grossMto: 0, netProduction: qty }));

const mat = (id: string, over: Partial<Material> = {}): Material => ({
  id, name: id, type: 'RAW', unit: 'kg', stock: 100, leadTimeDays: 10, safetyDays: 0, moq: 10, suppliers: [{ supplier: 'S1', share: 0.6 }, { supplier: 'S2', share: 0.4 }], ...over,
});

/** Un SKU A que consume 1 kg de R por caja; línea L de lunes a viernes, 8 h/día. */
function mini(over: { materials?: Material[]; bom?: BomLine[]; purchaseOrders?: PurchaseOrderLine[]; exceptions?: { date: string; hours: number }[] } = {}): RamoDataset {
  return {
    synthetic: true,
    plants: [{ id: 'P', name: 'P' }],
    crews: [{ id: 'C', name: 'C', lineIds: ['L'] }],
    lines: [{ id: 'L', name: 'L', plantId: 'P', crewId: 'C', rate: { value: 1000, unit: 'u/h' } }],
    calendars: [{ lineId: 'L', workingWeekdays: [1, 2, 3, 4, 5], baseHoursPerDay: 8, exceptions: (over.exceptions ?? []).map((e) => ({ ...e, reason: 'MAINTENANCE' as const })) }],
    skus: [{ id: 'A', sapMaterial: 'A', name: 'A', family: 'F', businessUnit: 'BU', brand: 'B', lineId: 'L', commercialUnit: 'caja', productiveUnit: 'u', productiveUnitsPerCommercial: 1, kgPerCommercial: 1, costPerCommercial: 1 }],
    versions: [], demand: [], buildingBlocks: [], inventory: [], openOrders: [],
    materials: over.materials ?? [mat('R')],
    bom: over.bom ?? [{ parentId: 'A', componentId: 'R', quantityPer: 1, scrapPct: 0 }],
    purchaseOrders: over.purchaseOrders ?? [],
  };
}
const riskOf = (ds: RamoDataset, id = 'R', rows = net()) => runSupplyRisk(ds, rows).risks.find((r) => r.materialId === id)!;

describe('explosión de la lista de materiales', () => {
  const bom: BomLine[] = [
    { parentId: 'A', componentId: 'MX', quantityPer: 0.5, scrapPct: 0 },
    { parentId: 'A', componentId: 'P', quantityPer: 2, scrapPct: 0 },
    { parentId: 'MX', componentId: 'R1', quantityPer: 0.6, scrapPct: 10 },
    { parentId: 'MX', componentId: 'R2', quantityPer: 0.4, scrapPct: 0 },
  ];
  const ds = mini({ materials: [mat('MX', { type: 'MIX', stock: 0, suppliers: [] }), mat('R1'), mat('R2'), mat('P', { type: 'PACKAGING', unit: 'u' })], bom });

  it('baja por la mezcla de paso, con merma, y no deja la mezcla como material', () => {
    const c = explodeBom(ds).coefficients.get('A')!;
    expect(c.get('R1')).toBeCloseTo(0.5 * 0.6 * 1.1, 10);
    expect(c.get('R2')).toBeCloseTo(0.2, 10);
    expect(c.get('P')).toBe(2);
    expect(c.has('MX')).toBe(false);
    expect(explodeBom(ds).paths.get('A|R1')).toEqual([['A', 'MX', 'R1']]);
  });

  it('un ciclo entre mezclas no cuelga el cálculo y se reporta (también en la validación)', () => {
    const cyc = mini({
      materials: [mat('M1', { type: 'MIX', stock: 0, suppliers: [] }), mat('M2', { type: 'MIX', stock: 0, suppliers: [] })],
      bom: [{ parentId: 'A', componentId: 'M1', quantityPer: 1, scrapPct: 0 }, { parentId: 'M1', componentId: 'M2', quantityPer: 1, scrapPct: 0 }, { parentId: 'M2', componentId: 'M1', quantityPer: 1, scrapPct: 0 }],
    });
    expect(explodeBom(cyc).issues.length).toBeGreaterThan(0);
    expect(validateDataset(cyc).map((i) => i.code)).toContain('BOM_CYCLE');
  });
});

describe('validación de materiales', () => {
  const codes = (ds: RamoDataset) => validateDataset(ds).map((i) => i.code);
  it('el caso base es válido', () => expect(validateDataset(mini())).toEqual([]));
  it('detecta componente inexistente, cuota que no suma 1, material con lista que no es mezcla y OC sobre mezcla', () => {
    expect(codes(mini({ bom: [{ parentId: 'A', componentId: 'X', quantityPer: 1, scrapPct: 0 }] }))).toContain('BOM_UNKNOWN_COMPONENT');
    expect(codes(mini({ materials: [mat('R', { suppliers: [{ supplier: 'S1', share: 0.5 }] })] }))).toContain('MATERIAL_QUOTA_SUM');
    expect(codes(mini({ bom: [{ parentId: 'R', componentId: 'R', quantityPer: 1, scrapPct: 0 }] }))).toContain('BOM_PARENT_NOT_MIX');
    expect(codes(mini({ materials: [mat('M', { type: 'MIX', stock: 0, suppliers: [] })], bom: [{ parentId: 'A', componentId: 'M', quantityPer: 1, scrapPct: 0 }], purchaseOrders: [{ materialId: 'M', supplier: 'S', dueDate: '2026-10-06', qty: 1 }] }))).toContain('PO_ON_MIX');
  });
});

describe('producción diaria', () => {
  it('reparte la semana en partes iguales entre los días hábiles', () => {
    const p = dailyProduction(mini(), net(100, [W[0]]));
    expect(p.dates).toHaveLength(7);
    expect(p.bySku.get('A')!.map((x) => Math.round(x * 100) / 100)).toEqual([20, 20, 20, 20, 20, 0, 0]);
  });

  it('un festivo sin horas mueve la producción a los demás días, y las horas parciales pesan menos', () => {
    const holiday = dailyProduction(mini({ exceptions: [{ date: '2026-10-07', hours: 0 }] }), net(100, [W[0]]));
    expect(holiday.bySku.get('A')!.slice(0, 5)).toEqual([25, 25, 0, 25, 25]);
    const half = dailyProduction(mini({ exceptions: [{ date: '2026-10-07', hours: 0 }, { date: '2026-10-08', hours: 4 }] }), net(100, [W[0]]));
    expect(half.bySku.get('A')![3]).toBeCloseTo((100 * 4) / 28, 8);
    expect(half.bySku.get('A')!.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 8); // se conserva el total
  });

  it('sin producción neta no hay filas', () => {
    expect(dailyProduction(mini(), net(0)).bySku.size).toBe(0);
  });
});

describe('proyección y clasificación del riesgo', () => {
  // 50 cajas por semana = 10 por día hábil: el inventario de 100 llega a 0 el viernes de la semana 2 y se rompe el lunes de la semana 3 (día 14).
  const base = (m: Partial<Material> = {}, pos: PurchaseOrderLine[] = []) => mini({ materials: [mat('R', m)], purchaseOrders: pos });

  it('proyecta el inventario día a día y encuentra la fecha de ruptura', () => {
    const r = runSupplyRisk(base(), net());
    expect(r.projections[0].stock.slice(0, 5)).toEqual([90, 80, 70, 60, 50]);
    expect(r.projections[0].stock[11]).toBeCloseTo(0, 8);
    const risk = r.risks[0];
    expect(risk).toMatchObject({ ruptureDate: '2026-10-19', daysToRupture: 14 });
    expect(risk.coverageDays).toBeCloseTo(14, 6);
  });

  it('compara la ruptura con el plazo de entrega: crítico, pedir ya, vigilar', () => {
    expect(riskOf(base({ leadTimeDays: 20 }))).toMatchObject({ status: 'CRITICAL', reason: 'RUPTURE_IN_LEAD_TIME' });
    expect(riskOf(base({ leadTimeDays: 14 })).status).toBe('CRITICAL'); // el borde también es crítico: llega el mismo día de la ruptura
    expect(riskOf(base({ leadTimeDays: 10 }))).toMatchObject({ status: 'ORDER', reason: 'ORDER_SOON', orderByDate: '2026-10-09' });
    const watch = riskOf(base({ leadTimeDays: 2 }));
    expect(watch).toMatchObject({ status: 'WATCH', reason: 'RUPTURE_LATE', orderByDate: '2026-10-17' });
  });

  it('si la fecha límite para pedir queda fuera del horizonte de decisión, no es una alerta (aunque haya ruptura)', () => {
    const far = runSupplyRisk(base({ leadTimeDays: 2 }), net(), { watchDays: 5 }).risks[0]; // pedir antes del 17 oct, a 12 días: fuera de 5
    expect(far).toMatchObject({ status: 'OK', ruptureDate: '2026-10-19', suggestion: null });
    expect(runSupplyRisk(base({ leadTimeDays: 2 }), net(), { watchDays: 12 }).risks[0].status).toBe('WATCH');
  });

  it('las órdenes de compra abiertas evitan la ruptura; las atrasadas cuentan desde el día 0', () => {
    expect(riskOf(base({}, [{ materialId: 'R', supplier: 'S1', dueDate: '2026-10-12', qty: 100 }])).status).toBe('OK');
    const late = runSupplyRisk(base({}, [{ materialId: 'R', supplier: 'S1', dueDate: '2026-09-30', qty: 100 }]), net());
    expect(late.projections[0].receipts[0]).toBe(100);
    expect(late.risks[0].status).toBe('OK');
  });

  it('una orden abierta que llega después de la ruptura se señala para adelantarla', () => {
    const r = riskOf(base({ leadTimeDays: 20 }, [{ materialId: 'R', supplier: 'S1', dueDate: '2026-10-20', qty: 100 }]));
    expect(r.ruptureDate).toBe('2026-10-19'); // la orden llega un día después
    expect(r.lateOrder).toEqual({ supplier: 'S1', dueDate: '2026-10-20', qty: 100, daysAfterRupture: 1 });
    expect(riskOf(base({ leadTimeDays: 20 })).lateOrder).toBeNull(); // sin orden abierta no hay a quién adelantar
    expect(riskOf(base({}, [{ materialId: 'R', supplier: 'S1', dueDate: '2026-10-12', qty: 100 }])).lateOrder).toBeNull(); // sin ruptura tampoco
  });

  it('sin ruptura pero por debajo del colchón de seguridad: vigilar', () => {
    const r = riskOf(base({ safetyDays: 20 }, [{ materialId: 'R', supplier: 'S1', dueDate: '2026-10-05', qty: 100 }]));
    expect(r).toMatchObject({ status: 'WATCH', reason: 'SAFETY', ruptureDate: null });
  });

  it('el pedido sugerido cubre hasta el plazo + cobertura, en múltiplos del pedido mínimo y con la cuota reguladora', () => {
    const r = riskOf(base({ leadTimeDays: 10 }));
    // Horizonte de 21 días: consumo 150 − inventario 100 = 50 → 5 múltiplos de 10, 60/40 → 3 y 2.
    expect(r.suggestion).toEqual({ qty: 50, needBy: '2026-10-19', split: [{ supplier: 'S1', qty: 30, share: 0.6 }, { supplier: 'S2', qty: 20, share: 0.4 }] });
    expect(riskOf(base({}, [{ materialId: 'R', supplier: 'S1', dueDate: '2026-10-12', qty: 100 }])).suggestion).toBeNull();
  });

  it('ordena por severidad y luego por fecha de ruptura', () => {
    const ds = mini({ materials: [mat('R', { leadTimeDays: 2 }), mat('S', { leadTimeDays: 20 }), mat('T', { stock: 10_000 })], bom: [
      { parentId: 'A', componentId: 'R', quantityPer: 1, scrapPct: 0 }, { parentId: 'A', componentId: 'S', quantityPer: 1, scrapPct: 0 }, { parentId: 'A', componentId: 'T', quantityPer: 1, scrapPct: 0 }] });
    expect(runSupplyRisk(ds, net()).risks.map((x) => [x.materialId, x.status])).toEqual([['S', 'CRITICAL'], ['R', 'WATCH'], ['T', 'OK']]);
  });

  it('las mezclas no se proyectan; sus insumos se consumen el día de la producción', () => {
    const ds = mini({
      materials: [mat('MX', { type: 'MIX', stock: 0, suppliers: [] }), mat('R1', { stock: 10_000 })],
      bom: [{ parentId: 'A', componentId: 'MX', quantityPer: 0.5, scrapPct: 0 }, { parentId: 'MX', componentId: 'R1', quantityPer: 0.6, scrapPct: 0 }],
    });
    const r = runSupplyRisk(ds, net(100, [W[0]]));
    expect(r.projections.map((p) => p.materialId)).toEqual(['R1']);
    expect(r.projections[0].consumption.slice(0, 5)).toEqual([6, 6, 6, 6, 6]); // 20 cajas/día × 0,5 × 0,6
  });

  it('el consumo por SKU suma el consumo total del material', () => {
    const r = runSupplyRisk(base(), net());
    const total = r.projections[0].consumption.reduce((a, b) => a + b, 0);
    expect(consumptionBySku(r, 'R').reduce((a, x) => a + x.qty, 0)).toBeCloseTo(total, 8);
  });
});

describe('reparto por cuota reguladora', () => {
  const s = (a: number, b: number) => [{ supplier: 'A', share: a }, { supplier: 'B', share: b }];
  it('respeta la cuota cuando el múltiplo lo permite', () => {
    expect(splitByQuota(1000, 100, s(0.6, 0.4)).map((x) => x.qty)).toEqual([600, 400]);
  });
  it('con un solo múltiplo, todo va al proveedor de mayor cuota; el total nunca cambia', () => {
    expect(splitByQuota(100, 100, s(0.6, 0.4)).map((x) => x.qty)).toEqual([100, 0]);
    for (const q of [100, 300, 700, 1300]) expect(splitByQuota(q, 100, s(0.5, 0.5)).reduce((a, x) => a + x.qty, 0)).toBe(q);
  });
});

describe('dataset sintético completo', () => {
  const ds: RamoDataset = JSON.parse(readFileSync(new URL('../../../data/synthetic/dataset.json', import.meta.url), 'utf8'));
  const dem = demandForHorizon(ds, 'V-N1-2026-W40', 'V-PBO-2026-10');
  const rows = computeNetProduction(ds, dem);
  const r = runSupplyRisk(ds, rows);

  it('materiales, lista de materiales y órdenes de compra son válidos', () => {
    expect(validateDataset(ds)).toEqual([]);
    expect(r.issues).toEqual([]);
  });

  it('proyecta los 19 insumos y empaques (no las 2 mezclas) a 13 semanas', () => {
    expect(r.projections).toHaveLength(19);
    expect(r.dates).toHaveLength(7 * 13);
    expect(r.projections.every((p) => p.stock.length === r.dates.length)).toBe(true);
  });

  it('conserva la masa: lo consumido de cada material = producción de cada SKU × su coeficiente', () => {
    for (const p of r.projections) {
      const expected = ds.skus.reduce((acc, s) => acc + (rows.filter((x) => x.skuId === s.id).reduce((a, x) => a + x.netProduction, 0)) * (r.explosion.coefficients.get(s.id)?.get(p.materialId) ?? 0), 0);
      expect(p.consumption.reduce((a, b) => a + b, 0)).toBeCloseTo(expected, 4);
    }
  });

  it('tiene riesgos de todos los niveles, por construcción del ejemplo (cacao importado crítico, sal sin riesgo)', () => {
    const by = (id: string) => r.risks.find((x) => x.materialId === id)!;
    expect(by('MT-CACAO').status).toBe('CRITICAL');
    expect(by('MT-SAL').status).toBe('OK');
    expect(new Set(r.risks.map((x) => x.status)).size).toBeGreaterThanOrEqual(3);
    expect(r.risks[0].status).toBe('CRITICAL');
  });

  it('el cacao respeta la cuota 60/40 en el pedido sugerido', () => {
    const s = r.risks.find((x) => x.materialId === 'MT-CACAO')!.suggestion!;
    expect(s.split.map((x) => x.share)).toEqual([0.6, 0.4]);
    expect(s.split[0].qty).toBeGreaterThan(s.split[1].qty);
    expect(s.split.reduce((a, x) => a + x.qty, 0)).toBe(s.qty);
  });
});
