import { describe, expect, it } from 'vitest';
import { PlantConfirmation, ProductionTemplate, RamoDataset } from '@ramo/domain';
import { NetPlanRow, buildDailySchedule, plantFollowUp } from '@ramo/engine';
import { CONFIRMATIONS_HEADER, DAILY_PLAN_HEADER, confirmationsCsv, dailyPlanCsv } from './planFiles';

const W1 = '2026-10-05'; // lunes
const sku = (id: string, lineId: string) => ({ id, sapMaterial: `M${id}`, name: `Prod ${id} (sint.)`, family: 'F', businessUnit: 'BU', brand: 'B', lineId, commercialUnit: 'caja', productiveUnit: 'u' as const, productiveUnitsPerCommercial: 2, kgPerCommercial: 1, costPerCommercial: 1 });
const row = (skuId: string, netProduction: number): NetPlanRow => ({ skuId, weekStart: W1, grossCedi: netProduction, grossMto: 0, netProduction });

/** Dos plantas, una línea de 1.000 u/h en cada una; cada caja trae 2 unidades (500 cajas = 1 h). */
function ds(): RamoDataset {
  const t: ProductionTemplate = { id: 'T', name: 'T', crewId: 'CR', lineIds: ['L1', 'L2'], days: { 1: ['A'], 2: ['B'] }, shifts: { 1: 2, 2: 1 }, hoursPerShift: 8, changeoverHours: 0 };
  return {
    synthetic: true, plants: [{ id: 'P1', name: 'P1', sapCenter: '1000' }, { id: 'P2', name: 'P2', sapCenter: '2000' }], crews: [{ id: 'CR', name: 'CR', lineIds: ['L1', 'L2'] }],
    lines: [
      { id: 'L1', name: 'L1', plantId: 'P1', crewId: 'CR', rate: { value: 1000, unit: 'u/h' } },
      { id: 'L2', name: 'L2', plantId: 'P2', crewId: 'CR', rate: { value: 1000, unit: 'u/h' } },
    ],
    calendars: [
      { lineId: 'L1', workingWeekdays: [1, 2, 3, 4, 5], baseHoursPerDay: 8, exceptions: [] },
      { lineId: 'L2', workingWeekdays: [1, 2, 3, 4, 5], baseHoursPerDay: 8, exceptions: [] },
    ],
    skus: [sku('A', 'L1'), sku('B', 'L2')], versions: [], demand: [], buildingBlocks: [], inventory: [], openOrders: [], templates: [t],
  };
}

describe('programación diaria por planta (CSV)', () => {
  const d = ds();
  const daily = buildDailySchedule(d, [row('A', 3000), row('B', 1000)]);

  it('trae una fila por día, línea y producto con las cajas, las horas y los turnos', () => {
    const lines = dailyPlanCsv(d, daily).trim().split('\n');
    expect(lines[0]).toBe(DAILY_PLAN_HEADER);
    expect(lines).toHaveLength(3);
    // A: 3.000 cajas × 2 u ÷ 1.000 u/h = 6 h el lunes con 2 turnos; B: 1.000 × 2 ÷ 1.000 = 2 h el martes con 1 turno
    expect(lines[1]).toBe('2026-10-05;lun;2026-10-05;P1;L1;Prod A;MA;3000;6;2');
    expect(lines[2]).toBe('2026-10-06;mar;2026-10-05;P2;L2;Prod B;MB;1000;2;1');
  });
  it('filtra por planta y no escribe filas sin producción', () => {
    const p2 = dailyPlanCsv(d, daily, 'P2').trim().split('\n');
    expect(p2).toHaveLength(2);
    expect(p2[1]).toContain(';P2;');
    expect(dailyPlanCsv(d, buildDailySchedule(d, [row('A', 0)])).trim().split('\n')).toEqual([DAILY_PLAN_HEADER]);
  });
  it('usa coma decimal para las horas y no deja que un punto y coma del nombre rompa las columnas', () => {
    const raro = ds();
    raro.skus[0] = { ...raro.skus[0], name: 'Prod; con;punto (sint.)' };
    const csv = dailyPlanCsv(raro, buildDailySchedule(raro, [row('A', 1250)]));
    const fila = csv.trim().split('\n')[1].split(';');
    expect(fila).toHaveLength(DAILY_PLAN_HEADER.split(';').length);
    expect(fila[5]).toBe('Prod con punto');
    expect(fila[8]).toBe('2,5'); // 1.250 × 2 ÷ 1.000
  });
});

describe('confirmación de plantas (CSV)', () => {
  const d = ds();
  const conf: PlantConfirmation = { id: 'c', skuId: 'A', weekStart: W1, plannedQty: 3000, confirmedQty: 2100, reason: 'Equipo; dañado', author: 'Producción', createdAt: '2026-10-01T10:30:00.000Z' };
  const rows = plantFollowUp(d, [row('A', 3000), row('B', 1000)], [conf], [{ id: 'x', skuId: 'A', weekStart: W1, qty: 1500, note: '', author: 'P', createdAt: '2026-10-07T00:00:00Z' }]);

  it('lista cada producto con lo pedido, lo confirmado, el estado y lo entregado', () => {
    const lines = confirmationsCsv(d, rows).trim().split('\n');
    expect(lines[0]).toBe(CONFIRMATIONS_HEADER);
    expect(lines[1]).toBe('P1;2026-10-05;Prod A;3000;2100;parcial;Equipo dañado;Producción;2026-10-01 10:30;1500');
    expect(lines[2]).toBe('P2;2026-10-05;Prod B;1000;;pendiente;;;;0');
  });
  it('filtra por planta', () => {
    expect(confirmationsCsv(d, rows, 'P2').trim().split('\n')).toHaveLength(2);
  });
});
