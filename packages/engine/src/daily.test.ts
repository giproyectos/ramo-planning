import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DailyAdjustment, ProductionTemplate, RamoDataset, TemplateOverride, validateDataset } from '@ramo/domain';
import {
  AllocationRule, NetPlanRow, buildDailySchedule, computeNetProduction, dailyMovesToAdjustments, demandForHorizon, effectiveTemplate, suggestDailyBalance, weekdayOf,
} from './index';

const W1 = '2026-10-05'; // lunes
const W2 = '2026-10-12';
const W3 = '2026-10-19';
const MON = '2026-10-05';
const TUE = '2026-10-06';
const WED = '2026-10-07';

/** Dos líneas de 1.000 u/h (misma tripulación), tres productos de 1 unidad por caja: 1.000 cajas = 1 hora. */
function mini(template: Partial<ProductionTemplate> = {}, exceptions: { date: string; hours: number; reason: 'HOLIDAY' | 'MAINTENANCE' | 'PLANT_STOP' | 'EXTENDED' }[] = []): RamoDataset {
  const sku = (id: string, lineId: string) => ({ id, sapMaterial: id, name: id, family: 'F', businessUnit: 'BU', brand: 'B', lineId, commercialUnit: 'caja', productiveUnit: 'u' as const, productiveUnitsPerCommercial: 1, kgPerCommercial: 1, costPerCommercial: 1 });
  const t: ProductionTemplate = { id: 'T', name: 'T', crewId: 'CR', lineIds: ['L1'], days: { 1: ['A'], 2: ['A'] }, shifts: { 1: 1, 2: 1 }, hoursPerShift: 8, changeoverHours: 0, ...template };
  return {
    synthetic: true, plants: [{ id: 'P', name: 'P' }], crews: [{ id: 'CR', name: 'CR', lineIds: ['L1', 'L2'] }],
    lines: [
      { id: 'L1', name: 'L1', plantId: 'P', crewId: 'CR', rate: { value: 1000, unit: 'u/h' } },
      { id: 'L2', name: 'L2', plantId: 'P', crewId: 'CR', rate: { value: 1000, unit: 'u/h' } },
    ],
    calendars: [
      { lineId: 'L1', workingWeekdays: [1, 2, 3, 4, 5], baseHoursPerDay: 8, exceptions },
      { lineId: 'L2', workingWeekdays: [1, 2, 3, 4, 5], baseHoursPerDay: 8, exceptions: [] },
    ],
    skus: [sku('A', 'L1'), sku('B', 'L1'), sku('C', 'L2')],
    versions: [], demand: [], buildingBlocks: [], inventory: [], openOrders: [], templates: [t],
  };
}
const row = (skuId: string, weekStart: string, netProduction: number): NetPlanRow => ({ skuId, weekStart, grossCedi: netProduction, grossMto: 0, netProduction });
const cell = (r: ReturnType<typeof buildDailySchedule>, date: string, lineId = 'L1') => r.weeks.flatMap((w) => w.cells).find((c) => c.date === date && c.lineId === lineId);
const adj = (skuId: string, date: string, delta: number): DailyAdjustment => ({ id: `${skuId}${date}${delta}`, skuId, date, deltaCommercialQty: delta, reason: 't', author: 't', createdAt: '' });
const ovr = (o: Partial<TemplateOverride>): TemplateOverride => ({ id: 'o', templateId: 'T', scope: 'WEEK', weekStart: W1, days: { 1: ['A'] }, shifts: { 1: 1 }, reason: 't', author: 't', createdAt: '2026-01-01', ...o });

describe('reparto de la cantidad semanal entre los días de producción', () => {
  it('EVEN: partes iguales cuando los días tienen las mismas horas, y conserva las cajas', () => {
    const r = buildDailySchedule(mini(), [row('A', W1, 12000)], { rule: 'EVEN' });
    expect(cell(r, MON)!.qty.A).toBeCloseTo(6000, 6);
    expect(cell(r, TUE)!.qty.A).toBeCloseTo(6000, 6);
    expect(cell(r, MON)!.requiredHours).toBeCloseTo(6, 9);
    expect(cell(r, MON)!.availableHours).toBe(8);
    expect(cell(r, MON)!.saturationPct).toBeCloseTo(75, 6);
    expect(r.alerts).toEqual([]);
  });

  it('EVEN: reparte en proporción a las horas de cada día (un día con 2 turnos recibe el doble)', () => {
    const r = buildDailySchedule(mini({ shifts: { 1: 2, 2: 1 } }), [row('A', W1, 24000)]);
    expect(cell(r, MON)!.qty.A).toBeCloseTo(16000, 6);
    expect(cell(r, TUE)!.qty.A).toBeCloseTo(8000, 6);
    // la saturación queda igual en los dos días: la carga es pareja
    expect(cell(r, MON)!.saturationPct).toBeCloseTo(cell(r, TUE)!.saturationPct, 9);
  });

  it('EVEN: si dos productos de la línea comparten un día, las horas de ese día se reparten entre ambos', () => {
    // A produce lunes y martes; B solo el lunes. Lunes: 8 h entre dos productos (4 h cada uno), martes: 8 h para A.
    const r = buildDailySchedule(mini({ days: { 1: ['A', 'B'], 2: ['A'] }, shifts: { 1: 1, 2: 1 } }), [row('A', W1, 12000), row('B', W1, 4000)]);
    expect(cell(r, MON)!.qty.A).toBeCloseTo(4000, 6); // A: pesos 4 y 8 → 1/3 el lunes
    expect(cell(r, TUE)!.qty.A).toBeCloseTo(8000, 6);
    expect(cell(r, MON)!.qty.B).toBeCloseTo(4000, 6);
    expect(cell(r, MON)!.requiredHours).toBeCloseTo(8, 9);
    expect(cell(r, MON)!.saturationPct).toBeCloseTo(100, 6);
    expect(cell(r, TUE)!.saturationPct).toBeCloseTo(100, 6);
    expect(r.alerts).toEqual([]);
  });

  it('COVER: cada día de producción cubre la necesidad hasta la próxima producción (lunes cubre 1 día, martes los 6 restantes)', () => {
    const r = buildDailySchedule(mini(), [row('A', W1, 14000)], { rule: 'COVER' });
    expect(cell(r, MON)!.qty.A).toBeCloseTo(2000, 6); // 14000 × 1/7
    expect(cell(r, TUE)!.qty.A).toBeCloseTo(12000, 6); // 14000 × 6/7
    expect(cell(r, TUE)!.requiredHours).toBeCloseTo(12, 9);
    expect(cell(r, TUE)!.excessHours).toBeCloseTo(4, 9);
    const alert = r.alerts.find((a) => a.code === 'OVER_CAPACITY')!;
    expect(alert).toMatchObject({ date: TUE, lineId: 'L1', value: 4 });
  });

  it('COVER con días no consecutivos: lunes y miércoles cubren 2 y 5 días (ejemplo de la reunión)', () => {
    const r = buildDailySchedule(mini({ days: { 1: ['A'], 3: ['A'] }, shifts: { 1: 3, 3: 3 } }), [row('A', W1, 7000)], { rule: 'COVER' });
    expect(cell(r, MON)!.qty.A).toBeCloseTo(2000, 6);
    expect(cell(r, WED)!.qty.A).toBeCloseTo(5000, 6);
  });

  it('el total por producto y semana se conserva con cualquiera de las dos reglas', () => {
    for (const rule of ['EVEN', 'COVER'] as AllocationRule[]) {
      const r = buildDailySchedule(mini({ days: { 1: ['A'], 2: ['A'], 4: ['A'] }, shifts: { 1: 1, 2: 2, 4: 1 } }), [row('A', W1, 9876)], { rule });
      const total = r.weeks[0].cells.reduce((a, c) => a + (c.qty.A ?? 0), 0);
      expect(total).toBeCloseTo(9876, 6);
    }
  });
});

describe('festivos, paradas y días sin producción', () => {
  it('un festivo (0 h) pasa la producción a los demás días del producto y la carga sube', () => {
    const r = buildDailySchedule(mini({}, [{ date: TUE, hours: 0, reason: 'HOLIDAY' }]), [row('A', W1, 12000)]);
    expect(cell(r, TUE)?.qty.A ?? 0).toBe(0);
    expect(cell(r, MON)!.qty.A).toBeCloseTo(12000, 6);
    expect(cell(r, MON)!.saturationPct).toBeCloseTo(150, 6);
    expect(cell(r, MON)!.excessHours).toBeCloseTo(4, 9);
    expect(r.weeks[0].days.find((d) => d.date === TUE)).toMatchObject({ closed: true, hours: 0 });
  });

  it('una parada parcial limita las horas del día', () => {
    const r = buildDailySchedule(mini({}, [{ date: MON, hours: 5, reason: 'MAINTENANCE' }]), [row('A', W1, 6000)]);
    expect(cell(r, MON)!.availableHours).toBe(5);
  });

  it('un turno extendido suma las horas extra del calendario', () => {
    const r = buildDailySchedule(mini({}, [{ date: MON, hours: 12, reason: 'EXTENDED' }]), [row('A', W1, 6000)]);
    expect(cell(r, MON)!.availableHours).toBe(12); // 8 de la plantilla + (12 − 8) del calendario
  });

  it('si todos los días del producto están cerrados, la cantidad queda sin programar y se avisa', () => {
    const r = buildDailySchedule(mini({}, [{ date: MON, hours: 0, reason: 'HOLIDAY' }, { date: TUE, hours: 0, reason: 'HOLIDAY' }]), [row('A', W1, 12000)]);
    expect(r.weeks[0].unscheduled).toEqual([{ skuId: 'A', qty: 12000, reason: 'NO_PRODUCTION_DAY' }]);
    expect(r.alerts).toContainEqual({ code: 'NO_PRODUCTION_DAY', weekStart: W1, templateId: 'T', skuId: 'A', value: 12000 });
  });

  it('un producto de la línea que no está en la plantilla se avisa como fuera de plantilla', () => {
    const r = buildDailySchedule(mini(), [row('B', W1, 5000)]);
    expect(r.weeks[0].unscheduled).toEqual([{ skuId: 'B', qty: 5000, reason: 'NOT_IN_TEMPLATE' }]);
  });

  it('sin turnos un día no se puede producir aunque la plantilla lo nombre', () => {
    const r = buildDailySchedule(mini({ shifts: { 1: 2, 2: 0 } }), [row('A', W1, 12000)]);
    expect(cell(r, MON)!.qty.A).toBeCloseTo(12000, 6);
    expect(cell(r, MON)!.availableHours).toBe(16);
  });
});

describe('cambio de producto y tripulación compartida', () => {
  it('se pierde el tiempo de cambio cuando el día no repite el producto del día anterior', () => {
    const r = buildDailySchedule(mini({ days: { 1: ['A'], 2: ['B'] }, changeoverHours: 1 }), [row('A', W1, 4000), row('B', W1, 4000)]);
    expect(cell(r, MON)!.changeoverHours).toBe(1);
    expect(cell(r, MON)!.availableHours).toBe(7);
    expect(cell(r, MON)!.saturationPct).toBeCloseTo((4 / 7) * 100, 6);
    expect(cell(r, TUE)!.availableHours).toBe(7);
  });

  it('no hay cambio si se repite el mismo producto', () => {
    const r = buildDailySchedule(mini({ changeoverHours: 1 }), [row('A', W1, 4000)]);
    expect(cell(r, MON)!.changeoverHours).toBe(0);
    expect(cell(r, MON)!.availableHours).toBe(8);
  });

  it('dos líneas de la misma tripulación el mismo día generan una alerta de conflicto', () => {
    const r = buildDailySchedule(mini({ lineIds: ['L1', 'L2'], days: { 1: ['A', 'C'] }, shifts: { 1: 2 } }), [row('A', W1, 4000), row('C', W1, 4000)]);
    expect(r.alerts).toContainEqual({ code: 'CREW_CONFLICT', weekStart: W1, templateId: 'T', date: MON, value: 2 });
    expect(r.weeks[0].cells.every((c) => c.crewConflict)).toBe(true);
  });

  it('un turno disponible en un día sin productos no cuenta como capacidad de la plantilla, pero el optimizador puede usarlo', () => {
    const ds = mini({ days: { 1: ['A'], 2: ['A'] }, shifts: { 1: 1, 2: 1, 3: 1 } });
    const r = buildDailySchedule(ds, [row('A', W1, 18000)]);
    expect(r.weeks[0].capacityHours).toBe(16); // lunes y martes; el miércoles es holgura opcional
    expect(r.weeks[0].days.find((d) => d.date === WED)!.hours).toBe(8);
  });

  it('turnándose (una línea por día) no hay conflicto y la capacidad de la plantilla es la de una línea a la vez', () => {
    const r = buildDailySchedule(mini({ lineIds: ['L1', 'L2'], days: { 1: ['A'], 2: ['C'] }, shifts: { 1: 1, 2: 1 } }), [row('A', W1, 4000), row('C', W1, 4000)]);
    expect(r.alerts.some((a) => a.code === 'CREW_CONFLICT')).toBe(false);
    expect(r.weeks[0].capacityHours).toBe(16);
  });
});

describe('cambios a la plantilla', () => {
  const base = mini({ days: { 1: ['A'] }, shifts: { 1: 1, 2: 1, 3: 1 } }).templates![0];
  it('"desde" una semana aplica a esa y a las siguientes; "semana" solo a esa y manda sobre "desde"', () => {
    const o = [ovr({ id: 'f', scope: 'FROM', weekStart: W2, days: { 2: ['A'] } }), ovr({ id: 'w', scope: 'WEEK', weekStart: W3, days: { 3: ['A'] }, createdAt: '2026-02-01' })];
    expect(effectiveTemplate(base, o, W1)).toMatchObject({ overridden: false, template: { days: { 1: ['A'] } } });
    expect(effectiveTemplate(base, o, W2).template.days).toEqual({ 2: ['A'] });
    expect(effectiveTemplate(base, o, W3).template.days).toEqual({ 3: ['A'] });
    expect(effectiveTemplate(base, o, '2026-10-26').template.days).toEqual({ 2: ['A'] });
  });

  it('entre dos "desde" gana el de la semana más cercana; entre dos "semana" iguales, el más reciente', () => {
    const o = [ovr({ id: 'a', scope: 'FROM', weekStart: W1, days: { 1: ['A'] } }), ovr({ id: 'b', scope: 'FROM', weekStart: W2, days: { 4: ['A'] } })];
    expect(effectiveTemplate(base, o, W3).template.days).toEqual({ 4: ['A'] });
    const w = [ovr({ id: 'x', days: { 2: ['A'] }, createdAt: '2026-01-01' }), ovr({ id: 'y', days: { 5: ['A'] }, createdAt: '2026-03-01' })];
    expect(effectiveTemplate(base, w, W1).template.days).toEqual({ 5: ['A'] });
  });

  it('el cambio mueve la producción al nuevo día en el cálculo', () => {
    const ds = mini({ days: { 1: ['A'] }, shifts: { 1: 1, 2: 1, 3: 1 } });
    const r = buildDailySchedule(ds, [row('A', W1, 6000), row('A', W2, 6000), row('A', W3, 6000)], { overrides: [ovr({ scope: 'WEEK', weekStart: W2, days: { 3: ['A'] }, shifts: { 1: 1, 2: 1, 3: 1 } })] });
    const days = r.weeks.map((w) => w.cells.filter((c) => (c.qty.A ?? 0) > 0).map((c) => weekdayOf(c.date)));
    expect(days).toEqual([[1], [3], [1]]);
    expect(r.weeks.map((w) => w.overridden)).toEqual([false, true, false]);
  });
});

describe('ajustes manuales del día', () => {
  it('suman o restan cajas en el día y marcan la celda; nunca dejan cantidades negativas', () => {
    const r = buildDailySchedule(mini(), [row('A', W1, 12000)], { adjustments: [adj('A', TUE, -1000), adj('A', MON, -99999)] });
    expect(cell(r, TUE)!.qty.A).toBeCloseTo(5000, 6);
    expect(cell(r, TUE)!.adjusted).toBe(true);
    expect(cell(r, MON)!.qty.A).toBe(0);
  });

  it('un ajuste en un día sin turnos deja la celda sin capacidad y se avisa', () => {
    const r = buildDailySchedule(mini(), [row('A', W1, 12000)], { adjustments: [adj('A', WED, 2000)] });
    expect(cell(r, WED)!.availableHours).toBe(0);
    expect(r.alerts).toContainEqual({ code: 'OVER_CAPACITY', weekStart: W1, templateId: 'T', date: WED, lineId: 'L1', value: 2 });
  });
});

describe('optimizador diario', () => {
  const overloaded = (extra: Partial<ProductionTemplate> = {}, q = 18000) => {
    const ds = mini({ days: { 1: ['A'], 2: ['A'] }, shifts: { 1: 1, 2: 1, 3: 1 }, ...extra });
    return { ds, net: [row('A', W1, q)] };
  };
  const apply = (ds: RamoDataset, net: NetPlanRow[], plan: ReturnType<typeof suggestDailyBalance>) =>
    buildDailySchedule(ds, net, { adjustments: dailyMovesToAdjustments(plan.moves).map((a, i) => ({ id: `m${i}`, ...a, reason: 't', author: 't', createdAt: '' })) });

  it('pasa el exceso de los dos días a un día libre de la semana (valores calculados a mano)', () => {
    const { ds, net } = overloaded();
    const r = buildDailySchedule(ds, net);
    // 18.000 cajas = 18 h en dos días de 8 h → 9 h cada uno: faltan 1 h por día
    expect(cell(r, MON)!.excessHours).toBeCloseTo(1, 6);
    const plan = suggestDailyBalance(ds, r);
    expect(plan.overloaded).toBe(2);
    expect(plan.excessBefore).toBe(2);
    expect(plan.moves.map((m) => [m.fromDate, m.toDate, m.kind])).toEqual([[MON, WED, 'NEW_DAY'], [TUE, WED, 'NEW_DAY']]);
    for (const m of plan.moves) expect(m.qty).toBeGreaterThanOrEqual(999);
    expect(plan.extra).toEqual([]);
    expect(plan.movedHours).toBeCloseTo(2, 1);
  });

  it('aplicar la sugerencia deja la semana sin sobrecapacidad y conserva las cajas', () => {
    const { ds, net } = overloaded();
    const plan = suggestDailyBalance(ds, buildDailySchedule(ds, net));
    const after = apply(ds, net, plan);
    expect(after.alerts.filter((a) => a.code === 'OVER_CAPACITY')).toEqual([]);
    expect(after.weeks[0].cells.reduce((a, c) => a + (c.qty.A ?? 0), 0)).toBeCloseTo(18000, 6);
    for (const s of ['A']) expect(dailyMovesToAdjustments(plan.moves).filter((m) => m.skuId === s).reduce((a, m) => a + m.deltaCommercialQty, 0)).toBe(0);
  });

  it('es idempotente: tras aplicar no vuelve a proponer movimientos', () => {
    const { ds, net } = overloaded();
    const after = apply(ds, net, suggestDailyBalance(ds, buildDailySchedule(ds, net)));
    expect(suggestDailyBalance(ds, after)).toMatchObject({ moves: [], extra: [], overloaded: 0 });
  });

  it('prefiere pasar a un día en que el producto ya se produce antes que abrir un día nuevo', () => {
    // El miércoles también está libre y con turno: aun así debe preferir el martes, donde el producto ya se produce
    const ds = mini({ days: { 1: ['A'], 2: ['A'] }, shifts: { 1: 1, 2: 1, 3: 1 } });
    // Lunes cargado con ajustes (10 h en 8 h), martes vacío: el exceso de 2 h va al martes, no a un día nuevo
    const r = buildDailySchedule(ds, [row('A', W1, 8000)], { adjustments: [adj('A', MON, 6000), adj('A', TUE, -4000)] });
    expect(cell(r, MON)!.excessHours).toBeGreaterThan(0);
    const plan = suggestDailyBalance(ds, r);
    expect(plan.moves.length).toBeGreaterThan(0);
    expect(plan.moves.every((m) => m.kind === 'PRODUCTION_DAY' && m.toDate === TUE)).toBe(true);
    expect(plan.moves.some((m) => m.toDate === WED)).toBe(false);
  });

  it('respeta el 98 % de la capacidad del día receptor y deja el resto como horas extra', () => {
    const { ds, net } = overloaded({ days: { 1: ['A'] }, shifts: { 1: 1, 3: 1 } }, 20000);
    const plan = suggestDailyBalance(ds, buildDailySchedule(ds, net));
    // lunes: 20 h en 8 h → faltan 12 h; el miércoles solo admite 7,84 h (98 % de 8) → quedan 4,16 h → 4,5 h extra
    expect(plan.movedHours).toBeCloseTo(7.84, 1);
    expect(plan.extra).toEqual([{ templateId: 'T', lineId: 'L1', date: MON, hours: 4.5 }]);
  });

  it('no pasa producción a un día en que la tripulación está ocupada con otra línea', () => {
    const ds = mini({ lineIds: ['L1', 'L2'], days: { 1: ['A'], 2: ['C'] }, shifts: { 1: 1, 2: 1, 3: 1 } });
    const net = [row('A', W1, 12000), row('C', W1, 4000)];
    const plan = suggestDailyBalance(ds, buildDailySchedule(ds, net));
    expect(plan.moves.length).toBeGreaterThan(0);
    expect(plan.moves.every((m) => m.toDate !== TUE)).toBe(true);
    expect(plan.moves.every((m) => m.toDate === WED)).toBe(true);
  });

  it('sin sobrecapacidad no propone nada', () => {
    const ds = mini();
    expect(suggestDailyBalance(ds, buildDailySchedule(ds, [row('A', W1, 4000)]))).toMatchObject({ moves: [], extra: [], overloaded: 0, excessBefore: 0 });
  });
});

describe('dataset sintético con plantillas', () => {
  const ds: RamoDataset = JSON.parse(readFileSync(new URL('../../../data/synthetic/dataset.json', import.meta.url), 'utf8'));
  const latest = (kind: 'WEEKLY_N1' | 'PBO_MONTHLY') => ds.versions.filter((v) => v.kind === kind).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0].id;
  const net = computeNetProduction(ds, demandForHorizon(ds, latest('WEEKLY_N1'), latest('PBO_MONTHLY')));
  const r = buildDailySchedule(ds, net);

  it('el dataset con plantillas es válido y cada producto está en exactamente una plantilla', () => {
    expect(validateDataset(ds)).toEqual([]);
    for (const s of ds.skus) expect(ds.templates!.filter((t) => t.lineIds.includes(s.lineId)).length).toBe(1);
  });

  it('las cajas programadas por día suman el plan semanal de cada producto', () => {
    for (const w of r.weeks) {
      for (const s of ds.skus.filter((x) => w.template.lineIds.includes(x.lineId))) {
        const planned = net.find((n) => n.skuId === s.id && n.weekStart === w.weekStart)?.netProduction ?? 0;
        const unscheduled = w.unscheduled.find((u) => u.skuId === s.id)?.qty ?? 0;
        const scheduled = w.cells.reduce((a, c) => a + (c.qty[s.id] ?? 0), 0);
        expect(scheduled + unscheduled).toBeCloseTo(planned, 4);
      }
    }
  });

  it('el festivo del 12 de octubre cierra el lunes en las plantillas de lunes a viernes y manda ese día a otro', () => {
    const w = r.weeks.find((x) => x.weekStart === W2 && x.templateId === 'T-CRISP')!;
    expect(w.days.find((d) => d.date === W2)).toMatchObject({ closed: true, hours: 0 });
    expect(w.cells.find((c) => c.date === W2)?.qty['SK-006'] ?? 0).toBe(0);
    expect(w.cells.reduce((a, c) => a + (c.qty['SK-006'] ?? 0), 0)).toBeGreaterThan(0);
  });

  it('con Mini solo lunes y martes, el lunes festivo deja a Mini sin su primer día y se ve la sobrecarga', () => {
    const w = r.weeks.find((x) => x.weekStart === W2 && x.templateId === 'T-BARMINI')!;
    const mini = w.cells.filter((c) => c.lineId === 'L-MINI');
    expect(mini.find((c) => c.date === W2)?.qty['SK-005'] ?? 0).toBe(0);
    expect(mini.find((c) => c.date === '2026-10-13')!.saturationPct).toBeGreaterThan(100);
    expect(r.alerts.some((a) => a.code === 'OVER_CAPACITY' && a.weekStart === W2 && a.templateId === 'T-BARMINI')).toBe(true);
  });

  it('en una semana cargada, el optimizador diario usa el sábado opcional de Ponqués como día nuevo', () => {
    const heavy = net.map((n) => (n.skuId === 'SK-001' || n.skuId === 'SK-002' ? { ...n, netProduction: n.netProduction * 1.5 } : n));
    const res = buildDailySchedule(ds, heavy);
    const plan = suggestDailyBalance(ds, { weeks: res.weeks.filter((w) => w.templateId === 'T-PONQ'), alerts: [] });
    expect(plan.overloaded).toBeGreaterThan(0);
    const toSat = plan.moves.filter((m) => m.kind === 'NEW_DAY' && weekdayOf(m.toDate) === 6);
    expect(toSat.length).toBeGreaterThan(0);
    // ningún sábado recibe más del 98 % de sus 8 h
    const bySat = new Map<string, number>();
    for (const m of toSat) bySat.set(m.toDate, (bySat.get(m.toDate) ?? 0) + m.hours);
    for (const h of bySat.values()) expect(h).toBeLessThanOrEqual(8 * 0.98 + 0.1);
  });

  it('sin tripulación en conflicto: las plantillas compartidas se turnan', () => {
    expect(r.alerts.filter((a) => a.code === 'CREW_CONFLICT')).toEqual([]);
  });

  it('el optimizador diario reduce las horas que faltan sobre el calendario real de ejemplo', () => {
    const plan = suggestDailyBalance(ds, r);
    const before = r.weeks.reduce((a, w) => a + w.excessHours, 0);
    const after = buildDailySchedule(ds, net, { adjustments: dailyMovesToAdjustments(plan.moves).map((a, i) => ({ id: `m${i}`, ...a, reason: 't', author: 't', createdAt: '' })) });
    const afterExcess = after.weeks.reduce((a, w) => a + w.excessHours, 0);
    expect(before).toBeGreaterThan(0);
    expect(afterExcess).toBeLessThanOrEqual(before);
    expect(plan.extraTotal).toBeLessThanOrEqual(before);
  });
});
