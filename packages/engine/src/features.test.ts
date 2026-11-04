import { describe, expect, it } from 'vitest';
import { CalendarEdit, PlantConfirmation, PlantDelivery, PlantRule, PlantRuleSpec, ProductionTemplate, RamoDataset, TemplateOverride } from '@ramo/domain';
import {
  NetPlanRow, applyCalendarEdits, buildDailySchedule, dailyAlternatives, suggestDailyBalance, dayAvailableHours, effectiveTemplate, lineAvailableHours, plantFollowUp, recommendTemplates, rulesToConstraints, summarizePlants,
} from './index';

const W1 = '2026-10-05'; // lunes
const W2 = '2026-10-12';
const W3 = '2026-10-19';

const sku = (id: string, lineId: string) => ({ id, sapMaterial: id, name: id, family: 'F', businessUnit: 'BU', brand: 'B', lineId, commercialUnit: 'caja', productiveUnit: 'u' as const, productiveUnitsPerCommercial: 1, kgPerCommercial: 1, costPerCommercial: 1 });
const row = (skuId: string, weekStart: string, netProduction: number): NetPlanRow => ({ skuId, weekStart, grossCedi: netProduction, grossMto: 0, netProduction });

/** Dos líneas de 1.000 u/h en dos plantas, tripulación compartida; A y B en L1, C en L2. */
function ds(template: Partial<ProductionTemplate> = {}): RamoDataset {
  const t: ProductionTemplate = { id: 'T', name: 'T', crewId: 'CR', lineIds: ['L1', 'L2'], days: { 1: ['A'], 2: ['C'] }, shifts: { 1: 1, 2: 1, 3: 1 }, hoursPerShift: 8, changeoverHours: 1, ...template };
  return {
    synthetic: true, plants: [{ id: 'P1', name: 'P1' }, { id: 'P2', name: 'P2' }], crews: [{ id: 'CR', name: 'CR', lineIds: ['L1', 'L2'] }],
    lines: [
      { id: 'L1', name: 'L1', plantId: 'P1', crewId: 'CR', rate: { value: 1000, unit: 'u/h' } },
      { id: 'L2', name: 'L2', plantId: 'P2', crewId: 'CR', rate: { value: 1000, unit: 'u/h' } },
    ],
    calendars: [
      { lineId: 'L1', workingWeekdays: [1, 2, 3, 4, 5], baseHoursPerDay: 8, exceptions: [] },
      { lineId: 'L2', workingWeekdays: [1, 2, 3, 4, 5], baseHoursPerDay: 8, exceptions: [] },
    ],
    skus: [sku('A', 'L1'), sku('B', 'L1'), sku('C', 'L2')],
    versions: [], demand: [], buildingBlocks: [], inventory: [], openOrders: [], templates: [t],
  };
}
const base = (d: RamoDataset) => d.templates![0];
const ovr = (o: Partial<TemplateOverride>): TemplateOverride => ({ id: 'o', templateId: 'T', scope: 'FROM', weekStart: W1, days: { 1: ['B'] }, shifts: { 1: 1 }, reason: 't', author: 't', createdAt: '2026-01-01', ...o });

describe('vigencia del esquema (desde–hasta)', () => {
  const t = base(ds());
  it('un cambio «desde» con semana final rige solo hasta ella (inclusive)', () => {
    const o = ovr({ weekStart: W1, untilWeek: W2 });
    expect(effectiveTemplate(t, [o], W1).overridden).toBe(true);
    expect(effectiveTemplate(t, [o], W2).overridden).toBe(true);
    expect(effectiveTemplate(t, [o], W3).overridden).toBe(false);
    expect(effectiveTemplate(t, [o], W3).template).toEqual(t);
  });
  it('sin semana final rige para siempre', () => {
    expect(effectiveTemplate(t, [ovr({})], '2027-03-01').overridden).toBe(true);
  });
  it('después de la vigencia puede entrar otro cambio «desde» y manda ese', () => {
    const first = ovr({ id: 'a', weekStart: W1, untilWeek: W2, days: { 1: ['B'] } });
    const second = ovr({ id: 'b', weekStart: W3, days: { 1: ['C'] } });
    expect(effectiveTemplate(t, [first, second], W2).template.days).toEqual({ 1: ['B'] });
    expect(effectiveTemplate(t, [first, second], W3).template.days).toEqual({ 1: ['C'] });
  });
  it('el cambio de una sola semana sigue mandando sobre el que está vigente', () => {
    const range = ovr({ id: 'a', weekStart: W1, untilWeek: W3, days: { 1: ['B'] } });
    const one = ovr({ id: 'b', scope: 'WEEK', weekStart: W2, days: { 1: ['C'] } });
    expect(effectiveTemplate(t, [range, one], W2).template.days).toEqual({ 1: ['C'] });
    expect(effectiveTemplate(t, [range, one], W3).template.days).toEqual({ 1: ['B'] });
  });
});

describe('cambios de calendario hechos en la aplicación', () => {
  const edit = (e: Partial<CalendarEdit>): CalendarEdit => ({ id: 'e', lineIds: ['L1'], date: '2026-10-06', hours: 0, reason: 'PLANT_STOP', note: 'parada', author: 't', createdAt: '2026-01-01', ...e });

  it('una parada de 0 h cierra el día de esa línea y no toca la otra ni el conjunto original', () => {
    const d = ds();
    const e = applyCalendarEdits(d, [edit({})]);
    expect(dayAvailableHours(e, base(e), 'L1', '2026-10-06')).toBe(0);
    expect(dayAvailableHours(e, base(e), 'L2', '2026-10-06')).toBe(8);
    expect(d.calendars[0].exceptions).toEqual([]);
    expect(lineAvailableHours(e.calendars[0], W1)).toBe(32); // 5 días hábiles de 8 h menos el martes
  });
  it('una parcial limita las horas y una extendida suma las horas extra del día', () => {
    const e = applyCalendarEdits(ds(), [edit({ date: '2026-10-05', hours: 5, reason: 'MAINTENANCE' })]);
    expect(dayAvailableHours(e, base(e), 'L1', '2026-10-05')).toBe(5);
    const ext = applyCalendarEdits(ds(), [edit({ date: '2026-10-05', hours: 12, reason: 'EXTENDED' })]);
    expect(dayAvailableHours(ext, base(ext), 'L1', '2026-10-05')).toBe(8 + (12 - 8));
  });
  it('un cambio reemplaza la excepción que ya hubiera ese día, y entre dos del mismo día gana el más reciente', () => {
    const d = ds();
    d.calendars[0].exceptions = [{ date: '2026-10-06', hours: 4, reason: 'MAINTENANCE' }];
    const e = applyCalendarEdits(d, [edit({ id: 'a', hours: 0, createdAt: '2026-02-01' }), edit({ id: 'b', hours: 6, createdAt: '2026-03-01' })]);
    expect(e.calendars[0].exceptions).toEqual([{ date: '2026-10-06', hours: 6, reason: 'PLANT_STOP', note: 'parada' }]);
  });
  it('sin cambios devuelve el mismo conjunto de datos', () => {
    const d = ds();
    expect(applyCalendarEdits(d, [])).toBe(d);
  });
  it('un día cerrado manda la producción a los demás días del producto', () => {
    const d = ds({ lineIds: ['L1'], days: { 1: ['A'], 2: ['A'] } });
    const closed = applyCalendarEdits(d, [edit({ date: '2026-10-05' })]); // cierra el lunes de L1
    const r = buildDailySchedule(closed, [row('A', W1, 4000)]);
    const cells = r.weeks[0].cells;
    expect(cells.find((c) => c.date === '2026-10-05')?.qty.A ?? 0).toBe(0);
    expect(cells.find((c) => c.date === '2026-10-06')?.qty.A).toBe(4000);
  });
});

describe('reglas de planta en el cálculo diario', () => {
  const rule = (r: PlantRuleSpec): PlantRule => ({ id: 'r', reason: 't', author: 't', createdAt: '', ...r });
  const together = (d: RamoDataset) => buildDailySchedule(d, [row('A', W1, 1000), row('B', W1, 1000)], { rules: [rule({ kind: 'NO_TOGETHER', skuA: 'A', skuB: 'B' })] });

  it('sin reglas no hay alertas de reglas', () => {
    const d = ds({ lineIds: ['L1'], days: { 1: ['A', 'B'] } });
    expect(buildDailySchedule(d, [row('A', W1, 1000), row('B', W1, 1000)]).alerts.filter((a) => a.code === 'RULE_VIOLATION')).toEqual([]);
  });
  it('«no pueden ir el mismo día» avisa el día en que coinciden y la regla en palabras', () => {
    const d = ds({ lineIds: ['L1'], days: { 1: ['A', 'B'], 2: ['A'] } });
    const v = together(d).alerts.filter((a) => a.code === 'RULE_VIOLATION');
    expect(v).toHaveLength(1);
    expect(v[0].date).toBe('2026-10-05');
    expect(v[0].detail).toBe('A y B no pueden ir el mismo día (lunes)');
    // Si van en días distintos ya no hay alerta.
    const ok = ds({ lineIds: ['L1'], days: { 1: ['A'], 2: ['B'] } });
    expect(together(ok).alerts.filter((a) => a.code === 'RULE_VIOLATION')).toEqual([]);
  });
  it('«no se puede producir ese día» avisa solo si el producto está programado ese día', () => {
    const d = ds({ lineIds: ['L1'], days: { 1: ['A'], 3: ['A'] } });
    const r = buildDailySchedule(d, [row('A', W1, 1000)], { rules: [rule({ kind: 'NO_WEEKDAY', skuId: 'A', weekday: 3 })] });
    const v = r.alerts.filter((a) => a.code === 'RULE_VIOLATION');
    expect(v.map((a) => a.date)).toEqual(['2026-10-07']);
    expect(v[0].detail).toBe('A no se puede producir el miércoles');
  });
  it('«mínimo de días» avisa cuando el esquema tiene menos días de producción', () => {
    const d = ds({ lineIds: ['L1'], days: { 1: ['A'] } });
    const r = buildDailySchedule(d, [row('A', W1, 1000)], { rules: [rule({ kind: 'MIN_DAYS', skuId: 'A', days: 2 })] });
    expect(r.alerts.filter((a) => a.code === 'RULE_VIOLATION').map((a) => a.detail)).toEqual(['A necesita al menos 2 días de producción y tiene 1']);
    const ok = buildDailySchedule(ds({ lineIds: ['L1'], days: { 1: ['A'], 2: ['A'] } }), [row('A', W1, 1000)], { rules: [rule({ kind: 'MIN_DAYS', skuId: 'A', days: 2 })] });
    expect(ok.alerts.filter((a) => a.code === 'RULE_VIOLATION')).toEqual([]);
  });
  it('una regla de cambio por par reemplaza el tiempo del esquema (1 h) por el del par (3 h)', () => {
    const d = ds(); // lunes A (L1) y martes C (L2), cambio de 1 h
    const net = [row('A', W1, 1000), row('C', W1, 1000)];
    const sin = buildDailySchedule(d, net).weeks[0].cells;
    expect(sin.find((c) => c.date === '2026-10-06')!.changeoverHours).toBe(1);
    const con = buildDailySchedule(d, net, { rules: [rule({ kind: 'CHANGEOVER', skuA: 'A', skuB: 'C', hours: 3 })] }).weeks[0].cells;
    expect(con.find((c) => c.date === '2026-10-06')!.changeoverHours).toBe(3);
    expect(con.find((c) => c.date === '2026-10-06')!.availableHours).toBe(5); // 8 h − 3 h
    // Una regla de otro par no cambia nada.
    const otra = buildDailySchedule(d, net, { rules: [rule({ kind: 'CHANGEOVER', skuA: 'A', skuB: 'B', hours: 3 })] }).weeks[0].cells;
    expect(otra.find((c) => c.date === '2026-10-06')!.changeoverHours).toBe(1);
  });
  it('una regla de cambio de 0 h quita el cambio aunque el esquema tenga 1 h', () => {
    const net = [row('A', W1, 1000), row('C', W1, 1000)];
    const con = buildDailySchedule(ds(), net, { rules: [rule({ kind: 'CHANGEOVER', skuA: 'A', skuB: 'C', hours: 0 })] }).weeks[0].cells;
    expect(con.every((c) => c.changeoverHours === 0)).toBe(true);
  });
});

describe('el recomendador respeta las reglas de planta', () => {
  // Una línea; A y B. Vigente: A lun-mar, B mié. A pide 8 h y B 16 h.
  const d = ds({ lineIds: ['L1'], days: { 1: ['A'], 2: ['A'], 3: ['B'] } });
  const net = [row('A', W1, 8000), row('B', W1, 16000)];
  const rules: PlantRule[] = [{ id: 'r', kind: 'NO_WEEKDAY', skuId: 'B', weekday: 3, reason: 't', author: 't', createdAt: '' }];

  it('rulesToConstraints traduce cada regla', () => {
    const c = rulesToConstraints([
      { id: '1', kind: 'NO_TOGETHER', skuA: 'A', skuB: 'B', reason: '', author: '', createdAt: '' },
      { id: '2', kind: 'NO_WEEKDAY', skuId: 'B', weekday: 3, reason: '', author: '', createdAt: '' },
      { id: '3', kind: 'NO_WEEKDAY', skuId: 'B', weekday: 4, reason: '', author: '', createdAt: '' },
      { id: '4', kind: 'MIN_DAYS', skuId: 'A', days: 2, reason: '', author: '', createdAt: '' },
      { id: '5', kind: 'MIN_DAYS', skuId: 'A', days: 3, reason: '', author: '', createdAt: '' },
      { id: '6', kind: 'CHANGEOVER', skuA: 'A', skuB: 'B', hours: 2, reason: '', author: '', createdAt: '' },
    ]);
    expect(c.forbiddenTogether).toEqual([['A', 'B']]);
    expect(c.blockedBySku).toEqual({ B: [3, 4] });
    expect(c.minDaysBySku).toEqual({ A: 3 });
  });
  it('ningún esquema recomendado usa un día prohibido, y el vigente (que lo viola) puntúa peor', () => {
    const r = recommendTemplates(d, net, 'T', { fromWeek: W1, weeks: 1, constraints: rulesToConstraints(rules), rules });
    const cur = r.find((e) => e.current)!;
    expect(cur.ruleViolations).toBe(1);
    const others = r.filter((e) => !e.current);
    expect(others.length).toBeGreaterThan(0);
    for (const e of others) {
      expect(e.ruleViolations).toBe(0);
      expect((e.days[3] ?? []).includes('B')).toBe(false);
    }
    expect(r[0].current).toBe(false);
    expect(r[0].versusCurrent).toContain('respeta más reglas de planta');
  });
  it('violar una regla pesa en el puntaje aunque la capacidad sobre: con demanda holgada igual se recomienda cambiar', () => {
    const holgado = ds({ lineIds: ['L1'], days: { 1: ['A'], 2: ['B'] } });
    const small = [row('A', W1, 1000), row('B', W1, 1000)];
    const reglas: PlantRule[] = [{ id: 'r', kind: 'NO_WEEKDAY', skuId: 'B', weekday: 2, reason: 't', author: 't', createdAt: '' }];
    const r = recommendTemplates(holgado, small, 'T', { fromWeek: W1, weeks: 1, constraints: rulesToConstraints(reglas), rules: reglas });
    const cur = r.find((e) => e.current)!;
    expect(cur.excessHours).toBe(0);
    // 1 violación × 100 + 2 h de cambio de producto (1 h cada día, el esquema alterna) × 2
    expect(cur.score).toBe(104);
    expect(r[0].current).toBe(false);
    expect(r[0].score).toBeLessThan(cur.score);
  });
  it('sin reglas el esquema vigente no tiene violaciones', () => {
    const r = recommendTemplates(d, net, 'T', { fromWeek: W1, weeks: 1 });
    expect(r.every((e) => e.ruleViolations === 0)).toBe(true);
  });
  it('el mínimo de días por producto filtra los esquemas con menos días', () => {
    const r = recommendTemplates(d, net, 'T', { fromWeek: W1, weeks: 1, constraints: { minDaysBySku: { B: 2 } } });
    for (const e of r.filter((x) => !x.current && x.id.startsWith('combo-'))) {
      expect(Object.values(e.days).filter((l) => l.includes('B')).length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('confirmación de plantas y seguimiento', () => {
  const d = ds();
  const net = [row('A', W1, 10000), row('B', W1, 6000), row('C', W1, 4000), row('A', W2, 0)];
  const conf = (id: string, skuId: string, plannedQty: number, confirmedQty: number, createdAt: string, weekStart = W1): PlantConfirmation => ({ id, skuId, weekStart, plannedQty, confirmedQty, reason: 'r', author: 'Producción', createdAt });
  const del = (id: string, skuId: string, qty: number, createdAt: string): PlantDelivery => ({ id, skuId, weekStart: W1, qty, note: '', author: 'Producción', createdAt });

  it('sin confirmaciones todo está pendiente y las semanas sin producción no generan fila', () => {
    const rows = plantFollowUp(d, net, [], []);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.status === 'PENDING' && r.shortfall === 0 && r.coverage === 0)).toBe(true);
    expect(rows.map((r) => `${r.plantId}:${r.skuId}`)).toEqual(['P1:A', 'P1:B', 'P2:C']);
  });
  it('estado y cobertura según lo confirmado frente a lo que pide el MPS', () => {
    const rows = plantFollowUp(d, net, [conf('1', 'A', 10000, 7000, '2026-10-01'), conf('2', 'B', 6000, 6000, '2026-10-01'), conf('3', 'C', 4000, 0, '2026-10-01')], []);
    const a = rows.find((r) => r.skuId === 'A')!;
    expect(a.status).toBe('PARTIAL');
    expect(a.coverage).toBeCloseTo(0.7, 10);
    expect(a.shortfall).toBe(3000);
    expect(rows.find((r) => r.skuId === 'B')!.status).toBe('CONFIRMED');
    const c = rows.find((r) => r.skuId === 'C')!;
    expect(c.status).toBe('CANNOT');
    expect(c.shortfall).toBe(4000);
  });
  it('confirmar más de lo pedido cuenta como confirmado y no genera faltante', () => {
    const r = plantFollowUp(d, net, [conf('1', 'A', 10000, 11000, '2026-10-01')], []).find((x) => x.skuId === 'A')!;
    expect(r.status).toBe('CONFIRMED');
    expect(r.shortfall).toBe(0);
  });
  it('la confirmación vigente es la más reciente y las anteriores quedan en el historial', () => {
    const r = plantFollowUp(d, net, [conf('1', 'A', 10000, 7000, '2026-10-01'), conf('2', 'A', 10000, 10000, '2026-10-03'), conf('0', 'A', 10000, 5000, '2026-09-30')], []).find((x) => x.skuId === 'A')!;
    expect(r.current!.id).toBe('2');
    expect(r.status).toBe('CONFIRMED');
    expect(r.history.map((h) => h.id)).toEqual(['2', '1', '0']);
  });
  it('si el MPS cambió después de confirmar, la fila lo marca y el estado usa la cantidad de hoy', () => {
    const cambiado = [row('A', W1, 12000)];
    const r = plantFollowUp(d, cambiado, [conf('1', 'A', 10000, 10000, '2026-10-01')], [])[0];
    expect(r.planChanged).toBe(true);
    expect(r.status).toBe('PARTIAL');
    expect(r.shortfall).toBe(2000);
    expect(plantFollowUp(d, net, [conf('1', 'A', 10000, 10000, '2026-10-01')], []).find((x) => x.skuId === 'A')!.planChanged).toBe(false);
  });
  it('lo entregado se suma y se compara con lo confirmado', () => {
    const r = plantFollowUp(d, net, [conf('1', 'A', 10000, 7000, '2026-10-01')], [del('1', 'A', 4000, '2026-10-06'), del('2', 'A', 2000, '2026-10-07'), del('3', 'B', 999, '2026-10-07')]).find((x) => x.skuId === 'A')!;
    expect(r.delivered).toBe(6000);
    expect(r.deliveries).toHaveLength(2);
    expect(r.fulfillment).toBeCloseTo(6000 / 7000, 10);
    expect(r.deliveryGap).toBe(1000);
  });
  it('sin confirmación no hay cumplimiento (lo entregado se ve pero no se compara)', () => {
    const r = plantFollowUp(d, net, [], [del('1', 'A', 4000, '2026-10-06')]).find((x) => x.skuId === 'A')!;
    expect(r.delivered).toBe(4000);
    expect(r.fulfillment).toBe(0);
    expect(r.deliveryGap).toBe(0);
  });
  it('el resumen cuenta estados, faltante, cobertura y cumplimiento', () => {
    const rows = plantFollowUp(d, net, [conf('1', 'A', 10000, 7000, '2026-10-01'), conf('3', 'C', 4000, 0, '2026-10-01')], [del('1', 'A', 3500, '2026-10-06')]);
    const s = summarizePlants(rows);
    expect(s).toMatchObject({ rows: 3, pending: 1, confirmed: 0, partial: 1, cannot: 1, planned: 20000, shortfall: 7000, delivered: 3500 });
    // Cobertura sobre lo ya confirmado: (7000 + 0) ÷ (10000 + 4000)
    expect(s.coverage).toBeCloseTo(7000 / 14000, 10);
    expect(s.fulfillment).toBeCloseTo(3500 / 7000, 10);
    expect(summarizePlants(plantFollowUp(d, net, [], [])).coverage).toBeNull();
  });
});

describe('el balanceo diario respeta las reglas de planta', () => {
  const rule = (r: PlantRuleSpec): PlantRule => ({ id: 'r', reason: 't', author: 't', createdAt: '', ...r });
  // Lunes con 12 h pedidas para 8 h: sobran 4 h. Martes y miércoles tienen turno y holgura.
  const d = ds({ lineIds: ['L1'], days: { 1: ['A'] }, changeoverHours: 0 });
  const result = (rules: PlantRule[] = []) => buildDailySchedule(d, [row('A', W1, 12000)], { rules });

  it('sin reglas pasa lo que sobra al día más cercano con holgura (el martes)', () => {
    const plan = suggestDailyBalance(d, result());
    expect(plan.moves.map((m) => m.toDate)).toEqual(['2026-10-06']);
  });
  it('un día prohibido para el producto se salta y se usa el siguiente', () => {
    const rules = [rule({ kind: 'NO_WEEKDAY', skuId: 'A', weekday: 2 })];
    const plan = suggestDailyBalance(d, result(rules), { rules });
    expect(plan.moves.map((m) => m.toDate)).toEqual(['2026-10-07']);
  });
  it('si todos los días con holgura están prohibidos no mueve nada y deja horas extra', () => {
    const rules = [rule({ kind: 'NO_WEEKDAY', skuId: 'A', weekday: 2 }), rule({ kind: 'NO_WEEKDAY', skuId: 'A', weekday: 3 })];
    const plan = suggestDailyBalance(d, result(rules), { rules });
    expect(plan.moves).toEqual([]);
    expect(plan.extraTotal).toBe(4);
  });
  it('no se mueve a un día en que ya se produce un producto con el que no puede ir', () => {
    const dd = ds({ lineIds: ['L1'], days: { 1: ['A'], 2: ['B'] }, changeoverHours: 0 });
    const rules = [rule({ kind: 'NO_TOGETHER', skuA: 'A', skuB: 'B' })];
    const res = buildDailySchedule(dd, [row('A', W1, 12000), row('B', W1, 1000)], { rules });
    const plan = suggestDailyBalance(dd, res, { rules });
    expect(plan.moves.map((m) => m.toDate)).toEqual(['2026-10-07']);
    // Sin la regla sí iría al martes con B.
    expect(suggestDailyBalance(dd, buildDailySchedule(dd, [row('A', W1, 12000), row('B', W1, 1000)])).moves.map((m) => m.toDate)).toEqual(['2026-10-06']);
  });
  it('las alternativas diarias también respetan las reglas', () => {
    const rules = [rule({ kind: 'NO_WEEKDAY', skuId: 'A', weekday: 2 })];
    const alts = dailyAlternatives(d, result(rules), { rules });
    for (const a of alts) for (const m of a.plan.moves) expect(m.toDate).not.toBe('2026-10-06');
  });
});
