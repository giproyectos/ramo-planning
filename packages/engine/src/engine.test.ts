import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CapacityDecision, DemandRecord, MpsAdjustment, RamoDataset, validateDataset } from '@ramo/domain';
import {
  applyBuildingBlocks,
  demandForHorizon,
  applyMpsAdjustments,
  computeCrp,
  computeNetProduction,
  lineAvailableHours,
  overloadAlerts,
  snapshotCycle,
  weekDays,
} from './index';

const W = '2026-10-05'; // lunes

/** Mini-planta para casos a mano: dos líneas de 1.000 u/h que comparten tripulación, 8 h × 5 días = 40 h por línea. */
function mini(): RamoDataset {
  const sku = (id: string, lineId: string) => ({
    id, sapMaterial: id, name: id, family: 'F', businessUnit: 'BU', brand: 'B', lineId,
    commercialUnit: 'caja', productiveUnit: 'u' as const, productiveUnitsPerCommercial: 1, kgPerCommercial: 1, costPerCommercial: 1,
  });
  return {
    synthetic: true,
    plants: [{ id: 'P', name: 'P' }],
    crews: [{ id: 'C', name: 'C', lineIds: ['LA', 'LB'] }],
    lines: [
      { id: 'LA', name: 'LA', plantId: 'P', crewId: 'C', rate: { value: 1000, unit: 'u/h' } },
      { id: 'LB', name: 'LB', plantId: 'P', crewId: 'C', rate: { value: 1000, unit: 'u/h' } },
    ],
    calendars: ['LA', 'LB'].map((lineId) => ({ lineId, workingWeekdays: [1, 2, 3, 4, 5], baseHoursPerDay: 8, exceptions: [] })),
    skus: [sku('A', 'LA'), sku('B', 'LB')],
    versions: [{ id: 'V', kind: 'WEEKLY_N1', label: 'v', createdAt: '2026-10-01T00:00:00Z', createdByRole: 'demand' }],
    demand: [],
    buildingBlocks: [],
    inventory: [],
    openOrders: [],
  };
}
const row = (skuId: string, qty: number, flow: DemandRecord['flow'] = 'CEDI', weekStart = W): DemandRecord => ({
  versionId: 'V', skuId, weekStart, flow, commercialQty: qty,
});

describe('calendario', () => {
  it('suma horas base de días hábiles y respeta excepciones', () => {
    const ds = mini();
    const cal = ds.calendars[0];
    expect(weekDays(W)).toHaveLength(7);
    expect(lineAvailableHours(cal, W)).toBe(40);
    cal.exceptions.push({ date: '2026-10-05', hours: 0, reason: 'HOLIDAY' }, { date: '2026-10-06', hours: 4, reason: 'MAINTENANCE' });
    expect(lineAvailableHours(cal, W)).toBe(40 - 8 - 4);
    cal.exceptions.push({ date: '2026-10-10', hours: 8, reason: 'EXTENDED' }); // sábado, no hábil
    expect(lineAvailableHours(cal, W)).toBe(28 + 8);
  });
});

describe('MPS: neto de demanda', () => {
  it('descuenta inventario y órdenes en curso y arrastra el sobrante', () => {
    const ds = mini();
    ds.inventory = [{ skuId: 'A', onHandCommercial: 300 }];
    ds.openOrders = [{ skuId: 'A', weekStart: '2026-10-12', commercialQty: 200 }];
    const demand = [row('A', 100), row('A', 500, 'CEDI', '2026-10-12'), row('A', 400, 'CEDI', '2026-10-19')];
    const net = computeNetProduction(ds, demand).filter((r) => r.skuId === 'A');
    // sem1: 300 cubre 100 → neto 0, arrastre 200 · sem2: 200+200 cubre 500 → neto 100, arrastre 0 · sem3: neto 400
    expect(net.map((r) => r.netProduction)).toEqual([0, 100, 400]);
  });

  it('los flujos make-to-order no se netean contra inventario', () => {
    const ds = mini();
    ds.inventory = [{ skuId: 'A', onHandCommercial: 10_000 }];
    const net = computeNetProduction(ds, [row('A', 100), row('A', 700, 'HARD_DISCOUNT'), row('A', 50, 'EXPORT')]);
    const a = net.find((r) => r.skuId === 'A')!;
    expect(a).toMatchObject({ grossCedi: 100, grossMto: 750, netProduction: 750 });
  });

  it('los ajustes de Daniel suman, no dejan negativos y crean filas faltantes', () => {
    const net = [{ skuId: 'A', weekStart: W, grossCedi: 100, grossMto: 0, netProduction: 100 }];
    const adj = (skuId: string, delta: number): MpsAdjustment => ({
      id: skuId + delta, skuId, weekStart: W, deltaCommercialQty: delta, reason: 'r', author: 'a', createdAt: '',
    });
    const out = applyMpsAdjustments(net, [adj('A', -30), adj('A', -500), adj('B', 40)]);
    expect(out.find((r) => r.skuId === 'A')!.netProduction).toBe(0);
    expect(out.find((r) => r.skuId === 'B')!.netProduction).toBe(40);
    expect(net[0].netProduction).toBe(100); // no muta la entrada
  });
});

describe('building blocks', () => {
  it('reparte un ajuste de familia en proporción y no deja negativos', () => {
    const ds = mini();
    ds.demand = [row('A', 300), row('B', 100)];
    ds.buildingBlocks = [
      { id: 'BB', versionId: 'V', scope: { family: 'F', weekStart: W }, deltaCommercialQty: 200, reason: 'x', author: 'y', role: 'demand', createdAt: '' },
    ];
    const out = applyBuildingBlocks(ds, 'V');
    expect(out.find((r) => r.skuId === 'A')!.commercialQty).toBe(450);
    expect(out.find((r) => r.skuId === 'B')!.commercialQty).toBe(150);
    ds.buildingBlocks[0].deltaCommercialQty = -10_000;
    expect(applyBuildingBlocks(ds, 'V').every((r) => r.commercialQty === 0)).toBe(true);
  });

  it('un block por SKU crea la fila si no existía', () => {
    const ds = mini();
    ds.demand = [row('A', 10)];
    ds.buildingBlocks = [
      { id: 'BB', versionId: 'V', scope: { skuId: 'B', weekStart: W }, deltaCommercialQty: 25, reason: 'x', author: 'y', role: 'demand', createdAt: '' },
    ];
    expect(applyBuildingBlocks(ds, 'V').find((r) => r.skuId === 'B')!.commercialQty).toBe(25);
  });
});

describe('horizonte', () => {
  it('el N+1 manda donde existe y el PBO completa las semanas siguientes', () => {
    const ds = mini();
    ds.versions.push({ id: 'PBO', kind: 'PBO_MONTHLY', label: 'p', createdAt: '', createdByRole: 'demand' });
    ds.demand = [row('A', 10, 'CEDI', W), { ...row('A', 99, 'CEDI', W), versionId: 'PBO' }, { ...row('A', 77, 'CEDI', '2026-10-12'), versionId: 'PBO' }];
    const out = demandForHorizon(ds, 'V', 'PBO');
    expect(out.map((r) => [r.weekStart, r.commercialQty])).toEqual([[W, 10], ['2026-10-12', 77]]);
  });
});

describe('CRP con tripulación compartida', () => {
  // A: 55.000 u → 55 h sobre 40 h (137,5 %). B: 29.000 u → 29 h (72,5 %). Juntas: 84 h sobre 80 h (105 %).
  const demand = [row('A', 55_000), row('B', 29_000)];
  const crewOf = (ds: RamoDataset, mode: 'POOLED' | 'INDEPENDENT', decisions: CapacityDecision[] = []) => {
    const net = computeNetProduction(ds, demand);
    return computeCrp(ds, net, { crewMode: mode, decisions })[0];
  };

  it('por línea: A queda al 137,5 %, B al 72,5 %', () => {
    const w = crewOf(mini(), 'POOLED');
    expect(w.lines.find((l) => l.lineId === 'LA')).toMatchObject({ requiredHours: 55, availableHours: 40, saturationPct: 137.5, status: 'CRITICAL' });
    expect(w.lines.find((l) => l.lineId === 'LB')!.saturationPct).toBe(72.5);
  });

  it('agrupado: la tripulación queda al 105 % con 4 h de exceso (el 37 % baja a 5 %)', () => {
    const c = crewOf(mini(), 'POOLED').crews[0];
    expect(c).toMatchObject({ requiredHours: 84, availableHours: 80, saturationPct: 105, excessHours: 4, status: 'OVER' });
  });

  it('independiente: no se pueden prestar horas, el exceso es el de la línea A (15 h)', () => {
    const c = crewOf(mini(), 'INDEPENDENT').crews[0];
    expect(c.excessHours).toBe(15);
  });

  it('las horas extra decididas reducen el exceso hasta cerrarlo', () => {
    const d = (h: number): CapacityDecision => ({ id: 'd' + h, crewId: 'C', weekStart: W, extraHours: h, reason: 'turno extendido', author: 'Miguel', createdAt: '' });
    expect(crewOf(mini(), 'POOLED', [d(2)]).crews[0]).toMatchObject({ excessHours: 2, extraHours: 2 });
    expect(crewOf(mini(), 'POOLED', [d(4)]).crews[0]).toMatchObject({ excessHours: 0, status: 'OK' });
  });

  it('sin horas disponibles y con carga, la saturación se marca como 999', () => {
    const ds = mini();
    ds.calendars[0].exceptions = weekDays(W).map((date) => ({ date, hours: 0, reason: 'PLANT_STOP' as const }));
    const w = computeCrp(ds, computeNetProduction(ds, [row('A', 1000)]))[0];
    expect(w.lines.find((l) => l.lineId === 'LA')!.saturationPct).toBe(999);
  });
});

describe('ciclo Miguel ↔ Daniel', () => {
  it('Daniel puede resolver el rojo de Miguel con un ajuste negativo trazado', () => {
    const ds = mini();
    const base = computeNetProduction(ds, [row('A', 55_000), row('B', 29_000)]);
    const before = snapshotCycle(ds, base, { decisions: [], adjustments: [] });
    expect(before.alerts).toEqual([{ weekStart: W, crewId: 'C', excessHours: 4, saturationPct: 105 }]);

    const adj: MpsAdjustment = { id: 'a1', skuId: 'A', weekStart: W, deltaCommercialQty: -5_000, reason: 'Se mueve a la semana siguiente', author: 'Daniel', createdAt: '' };
    const after = snapshotCycle(ds, base, { decisions: [], adjustments: [adj] });
    expect(after.alerts).toEqual([]);
    expect(overloadAlerts(after.capacity)).toHaveLength(0);
  });
});

describe('dataset sintético completo', () => {
  const ds: RamoDataset = JSON.parse(readFileSync(new URL('../../../data/synthetic/dataset.json', import.meta.url), 'utf8'));
  const v = 'V-N1-2026-W40';
  const net = computeNetProduction(ds, applyBuildingBlocks(ds, v));

  it('el dataset sigue siendo válido', () => {
    expect(validateDataset(ds)).toEqual([]);
  });

  it('en la semana del festivo (12-oct) Barras sola pasa de 130 % y la tripulación Barras/Mini queda en rojo agrupada', () => {
    const w = computeCrp(ds, net).find((x) => x.weekStart === '2026-10-12')!;
    expect(w.lines.find((l) => l.lineId === 'L-BARR')!.saturationPct).toBeGreaterThan(130);
    const crew = w.crews.find((c) => c.crewId === 'C-BARMINI')!;
    expect(crew.saturationPct).toBeGreaterThan(100);
    expect(crew.saturationPct).toBeLessThan(w.lines.find((l) => l.lineId === 'L-BARR')!.saturationPct);
    expect(crew.excessHours).toBeGreaterThan(0);
  });

  it('el calendario de la semana del festivo tiene 64 h por línea', () => {
    const cal = ds.calendars.find((c) => c.lineId === 'L-BARR')!;
    expect(lineAvailableHours(cal, '2026-10-12')).toBe(64);
  });

  it('con el neto, la primera semana es más liviana que sin inventario', () => {
    const gross = ds.demand.filter((d) => d.versionId === v && d.weekStart === '2026-10-05').reduce((a, d) => a + d.commercialQty, 0);
    const netW1 = net.filter((r) => r.weekStart === '2026-10-05').reduce((a, r) => a + r.netProduction, 0);
    expect(netW1).toBeLessThan(gross);
  });
});
