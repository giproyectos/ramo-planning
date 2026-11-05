import { describe, expect, it } from 'vitest';
import { DemandRecord, PlantRule, ProductionTemplate, RamoDataset } from '@ramo/domain';
import {
  NetPlanRow, buildDailySchedule, computeNetProduction, cutsToAdjustments, explainNet, parseSchemesCsv, prioritizeCuts, scheduleMetrics, schemesToCsv,
} from './index';

const W1 = '2026-10-05';
const W2 = '2026-10-12';
const sku = (id: string, lineId: string, cost = 1) => ({ id, sapMaterial: id, name: `Prod ${id}`, family: 'F', businessUnit: 'BU', brand: 'B', lineId, commercialUnit: 'caja', productiveUnit: 'u' as const, productiveUnitsPerCommercial: 1, kgPerCommercial: 1, costPerCommercial: cost });
const row = (skuId: string, weekStart: string, netProduction: number, grossMto = 0): NetPlanRow => ({ skuId, weekStart, grossCedi: netProduction - grossMto, grossMto, netProduction });
const dem = (skuId: string, weekStart: string, flow: DemandRecord['flow'], commercialQty: number): DemandRecord => ({ versionId: 'v', skuId, weekStart, flow, commercialQty });

/** Una línea de 1.000 u/h con 8 h × 5 días = 40 h por semana; A cuesta 1 y B cuesta 5 por caja. */
function oneLine(): RamoDataset {
  const t: ProductionTemplate = { id: 'T', name: 'Esquema T', crewId: 'CR', lineIds: ['L1'], days: { 1: ['A'], 2: ['A'], 3: ['B'], 4: ['B'], 5: ['B'] }, shifts: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 }, hoursPerShift: 8, changeoverHours: 0 };
  return {
    synthetic: true, plants: [{ id: 'P', name: 'P', sapCenter: '1000' }], crews: [{ id: 'CR', name: 'CR', lineIds: ['L1'] }],
    lines: [{ id: 'L1', name: 'L1', plantId: 'P', crewId: 'CR', rate: { value: 1000, unit: 'u/h' } }],
    calendars: [{ lineId: 'L1', workingWeekdays: [1, 2, 3, 4, 5], baseHoursPerDay: 8, exceptions: [] }],
    skus: [sku('A', 'L1', 1), sku('B', 'L1', 5)], versions: [], demand: [], buildingBlocks: [], inventory: [{ skuId: 'A', onHandCommercial: 5000 }], openOrders: [{ skuId: 'A', weekStart: W2, commercialQty: 3000 }], templates: [t],
  };
}

describe('de dónde sale la cifra del MPS (explainNet)', () => {
  const ds = oneLine();
  const demand = [dem('A', W1, 'CEDI', 10000), dem('A', W1, 'EXPORT', 2000), dem('A', W2, 'CEDI', 4000), dem('A', W2, 'HARD_DISCOUNT', 1000)];

  it('la semana 1 usa el inventario y suma lo bajo pedido completo', () => {
    const e = explainNet(ds, demand, 'A', W1)!;
    expect(e).toMatchObject({ grossCedi: 10000, grossMto: 2000, startInventory: 5000, openOrders: 0, netCedi: 5000, netProduction: 7000, endInventory: 0 });
    expect(e.mtoByFlow).toEqual({ EXPORT: 2000 });
  });
  it('la semana 2 arrastra el inventario final de la anterior y descuenta la orden en curso', () => {
    const e = explainNet(ds, demand, 'A', W2)!;
    expect(e).toMatchObject({ startInventory: 0, openOrders: 3000, netCedi: 1000, netProduction: 2000, endInventory: 0 });
    expect(e.mtoByFlow).toEqual({ HARD_DISCOUNT: 1000 });
  });
  it('coincide con computeNetProduction en todas las semanas y si sobra inventario lo muestra', () => {
    const rows = computeNetProduction(ds, demand);
    for (const r of rows.filter((x) => x.skuId === 'A')) expect(explainNet(ds, demand, 'A', r.weekStart)!.netProduction).toBe(r.netProduction);
    const sobra = [dem('A', W1, 'CEDI', 1000), dem('A', W2, 'CEDI', 1000)];
    // semana 1: 5.000 de inventario cubren 1.000 → quedan 4.000; semana 2: + 3.000 de la orden − 1.000 = 6.000, sin producir
    expect(explainNet(ds, sobra, 'A', W2)).toMatchObject({ startInventory: 4000, netCedi: 0, endInventory: 6000 });
  });
  it('una semana sin demanda o un producto inexistente no tienen explicación', () => {
    expect(explainNet(ds, demand, 'A', '2026-11-02')).toBeNull();
    expect(explainNet(ds, demand, 'Z', W1)).toBeNull();
  });
});

describe('priorización cuando no alcanza', () => {
  // A pide 30 h y B pide 20 h para 40 h disponibles: faltan 10 h.
  const ds = oneLine();
  const net = [row('A', W1, 30000), row('B', W1, 20000)];

  it('VALUE: se recorta primero lo de menor valor (A cuesta 1, B cuesta 5)', () => {
    const p = prioritizeCuts(ds, net, { rule: 'VALUE' });
    expect(p.overloaded).toBe(1);
    expect(p.cuts).toEqual([{ skuId: 'A', weekStart: W1, crewId: 'CR', qty: 10000, hours: 10 }]);
    expect(p.hoursCut).toBe(10);
    expect(p.qtyCut).toBe(10000);
    expect(p.unresolvedHours).toBe(0);
  });
  it('RISK: se protege lo que tiene más riesgo de quiebre aunque valga menos', () => {
    const p = prioritizeCuts(ds, net, { rule: 'RISK', riskBySku: { A: 0.9, B: 0.1 } });
    expect(p.cuts.map((c) => [c.skuId, c.qty])).toEqual([['B', 10000]]);
    const otra = prioritizeCuts(ds, net, { rule: 'RISK', riskBySku: { A: 0.1, B: 0.9 } });
    expect(otra.cuts.map((c) => [c.skuId, c.qty])).toEqual([['A', 10000]]);
  });
  it('EVEN: recorta en proporción a las horas de cada producto (6 h de A y 4 h de B)', () => {
    const p = prioritizeCuts(ds, net, { rule: 'EVEN' });
    expect(p.cuts.map((c) => [c.skuId, c.qty])).toEqual([['A', 6000], ['B', 4000]]);
    expect(p.hoursCut).toBe(10);
  });
  it('lo bajo pedido nunca se recorta: si no alcanza con lo demás queda sin resolver', () => {
    // B es todo bajo pedido; A solo tiene 5 h recortables → se recortan esas 5 h y faltan 5 h
    const dura = [row('A', W1, 25000, 20000), row('B', W1, 25000, 25000)];
    const p = prioritizeCuts(ds, dura, { rule: 'VALUE' });
    expect(p.cuts).toEqual([{ skuId: 'A', weekStart: W1, crewId: 'CR', qty: 5000, hours: 5 }]);
    expect(p.unresolvedHours).toBe(10 - 5);
  });
  it('una semana que cabe no genera recortes y los recortes se vuelven ajustes negativos', () => {
    expect(prioritizeCuts(ds, [row('A', W1, 10000)], { rule: 'VALUE' }).cuts).toEqual([]);
    const p = prioritizeCuts(ds, net, { rule: 'VALUE' });
    expect(cutsToAdjustments(p.cuts)).toEqual([{ skuId: 'A', weekStart: W1, deltaCommercialQty: -10000 }]);
  });
  it('las horas extra decididas bajan lo que hay que recortar', () => {
    const p = prioritizeCuts(ds, net, { rule: 'VALUE', decisions: [{ id: 'd', crewId: 'CR', weekStart: W1, extraHours: 4, reason: 't', author: 't', createdAt: '' }] });
    expect(p.hoursCut).toBe(6);
  });
  it('el efecto es real: con los recortes aplicados la semana cabe', () => {
    const p = prioritizeCuts(ds, net, { rule: 'EVEN' });
    const recortado = net.map((r) => ({ ...r, netProduction: r.netProduction - p.cuts.filter((c) => c.skuId === r.skuId).reduce((a, c) => a + c.qty, 0) }));
    expect(prioritizeCuts(ds, recortado, { rule: 'EVEN' }).overloaded).toBe(0);
  });
});

describe('cifras para comparar escenarios', () => {
  const ds = oneLine();
  it('cuenta exceso, días en rojo, cambios, choques y reglas', () => {
    // A solo el lunes con 12 h pedidas para 8 h: sobran 4 h en un día
    const d = { ...ds, templates: [{ ...ds.templates![0], days: { 1: ['A'] } }] };
    const r = buildDailySchedule(d, [row('A', W1, 12000)]);
    expect(scheduleMetrics(d, r)).toEqual({ excessHours: 4, unscheduledHours: 0, overDays: 1, changeoverHours: 0, crewConflicts: 0, ruleViolations: 0 });
  });
  it('un producto sin día de producción cuenta como horas sin día y una regla violada se cuenta', () => {
    const d = { ...ds, templates: [{ ...ds.templates![0], days: { 1: ['A'] } }] };
    const rules: PlantRule[] = [{ id: 'r', kind: 'NO_WEEKDAY', skuId: 'A', weekday: 1, reason: 't', author: 't', createdAt: '' }];
    const r = buildDailySchedule(d, [row('A', W1, 2000), row('B', W1, 3000)], { rules });
    const m = scheduleMetrics(d, r);
    expect(m.unscheduledHours).toBe(3); // 3.000 cajas de B a 1.000 u/h
    expect(m.ruleViolations).toBe(1);
    expect(m.excessHours).toBe(0);
  });
  it('un plan sin problemas da todo en cero', () => {
    const r = buildDailySchedule(ds, [row('A', W1, 8000)]);
    expect(scheduleMetrics(ds, r)).toEqual({ excessHours: 0, unscheduledHours: 0, overDays: 0, changeoverHours: 0, crewConflicts: 0, ruleViolations: 0 });
  });
});

describe('esquemas en CSV (exportar, editar en Excel e importar)', () => {
  const ds = oneLine();
  const t = ds.templates![0];

  it('ida y vuelta: lo que se exporta se vuelve a leer igual', () => {
    const csv = schemesToCsv(ds, [t]);
    expect(csv.split('\n')[0]).toBe('esquema;producto;lun;mar;mie;jue;vie;sab;dom');
    expect(csv).toContain('T;A;X;X;;;;;');
    expect(csv).toContain('T;TURNOS;1;1;1;1;1;;');
    const p = parseSchemesCsv(csv, ds);
    expect(p.issues).toEqual([]);
    expect(p.schemes).toHaveLength(1);
    expect(p.schemes[0].days).toEqual(t.days);
    expect(p.schemes[0].shifts).toEqual(t.shifts);
  });
  it('acepta nombres en vez de códigos, marcas variadas, coma como separador y BOM', () => {
    const csv = '﻿esquema,producto,lun,mar,mié,jue,vie,sáb,dom\nEsquema T,Prod A,x,1,,,,,\nEsquema T,Prod B,,,sí,,,,\n';
    const p = parseSchemesCsv(csv, ds);
    expect(p.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(p.schemes[0].days).toEqual({ 1: ['A'], 2: ['A'], 3: ['B'] });
    expect(p.schemes[0].shifts).toBeUndefined(); // sin fila TURNOS se conservan los turnos actuales
  });
  it('avisa los errores con su fila y no importa el esquema que los tiene', () => {
    const csv = 'esquema;producto;lun;mar;mie;jue;vie;sab;dom\nT;A;X;;;;;;\nT;ZZZ;;X;;;;;\nT;TURNOS;9;;;;;;\n';
    const p = parseSchemesCsv(csv, ds);
    expect(p.schemes).toEqual([]);
    const errs = p.issues.filter((i) => i.severity === 'error');
    expect(errs.map((e) => e.line)).toEqual([3, 4]);
    expect(errs[0].message).toContain('ZZZ');
    expect(errs[1].message).toContain('9');
    expect(p.issues.some((i) => i.message.includes('no se importa'))).toBe(true);
  });
  it('un producto de una línea que no es del esquema es un error', () => {
    const d2: RamoDataset = { ...ds, lines: [...ds.lines, { id: 'L2', name: 'L2', plantId: 'P', crewId: 'CR', rate: { value: 1000, unit: 'u/h' } }], skus: [...ds.skus, sku('C', 'L2')] };
    const p = parseSchemesCsv('esquema;producto;lun;mar;mie;jue;vie;sab;dom\nT;C;X;;;;;;\n', d2);
    expect(p.schemes).toEqual([]);
    expect(p.issues.find((i) => i.severity === 'error')?.message).toContain('no es de las líneas del esquema T');
  });
  it('esquema inexistente, encabezado raro y archivo vacío', () => {
    expect(parseSchemesCsv('esquema;producto;lun;mar;mie;jue;vie;sab;dom\nNOPE;A;X;;;;;;\n', ds).issues[0].message).toContain('NOPE');
    expect(parseSchemesCsv('a;b;c\n1;2;3\n', ds).issues[0].message).toContain('Encabezado');
    expect(parseSchemesCsv('\n\n', ds).issues[0].message).toContain('vacío');
  });
  it('un día con producción y 0 turnos y una marca rara son avisos, no errores', () => {
    const csv = 'esquema;producto;lun;mar;mie;jue;vie;sab;dom\nT;A;X;?;;;;;\nT;TURNOS;;2;;;;;\n';
    const p = parseSchemesCsv(csv, ds);
    expect(p.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(p.issues.some((i) => i.message.includes('«?»'))).toBe(true);
    expect(p.issues.some((i) => i.message.includes('0 turnos'))).toBe(true);
    expect(p.schemes[0].shifts).toEqual({ 2: 2 });
  });
});
