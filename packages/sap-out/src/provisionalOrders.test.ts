import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RamoDataset } from '@ramo/domain';
import { computeNetProduction, demandForHorizon } from '@ramo/engine';
import { PlanRow, ProvisionalOrderRow, buildProvisionalOrders, lastProductionDay, ordersToCsv, parseOrdersCsv, validateOrdersFile } from './index';

/** Dos plantas (centros 1000 y 2000), un SKU en cada una; líneas de lunes a viernes, 8 h/día. */
function mini(exceptions: { date: string; hours: number }[] = [], centers: [string | undefined, string | undefined] = ['1000', '2000']): RamoDataset {
  const line = (id: string, plantId: string) => ({ id, name: id, plantId, crewId: 'C', rate: { value: 1000, unit: 'u/h' as const } });
  const sku = (id: string, lineId: string, mat: string) => ({
    id, sapMaterial: mat, name: id, family: 'F', businessUnit: 'BU', brand: 'B', lineId,
    commercialUnit: 'caja', productiveUnit: 'u' as const, productiveUnitsPerCommercial: 1, kgPerCommercial: 1, costPerCommercial: 1,
  });
  return {
    synthetic: true,
    plants: [{ id: 'P1', name: 'P1', sapCenter: centers[0] }, { id: 'P2', name: 'P2', sapCenter: centers[1] }],
    crews: [{ id: 'C', name: 'C', lineIds: ['L1', 'L2'] }],
    lines: [line('L1', 'P1'), line('L2', 'P2')],
    calendars: ['L1', 'L2'].map((lineId) => ({ lineId, workingWeekdays: [1, 2, 3, 4, 5], baseHoursPerDay: 8, exceptions: exceptions.map((e) => ({ ...e, reason: 'HOLIDAY' as const })) })),
    skus: [sku('A', 'L1', '9000001'), sku('B', 'L2', '9000002')],
    versions: [], demand: [], buildingBlocks: [], inventory: [], openOrders: [],
  };
}
const plan: PlanRow[] = [
  { skuId: 'A', weekStart: '2026-10-05', netProduction: 1000.4 },
  { skuId: 'B', weekStart: '2026-10-05', netProduction: 500 },
  { skuId: 'A', weekStart: '2026-10-12', netProduction: 700 },
  { skuId: 'B', weekStart: '2026-10-12', netProduction: 0 },
];

describe('órdenes provisionales por planta', () => {
  const r = buildProvisionalOrders(mini(), plan, { releaseId: 'REL-0001' });

  it('genera un archivo por planta con una orden por SKU y semana (sin cantidades en cero)', () => {
    expect(r.issues).toEqual([]);
    expect(r.files.map((f) => [f.center, f.kind, f.name, f.rows.length])).toEqual([
      ['1000', 'PROVISIONAL_ORDERS', 'ordenes_previsionales_1000_REL-0001.csv', 2],
      ['2000', 'PROVISIONAL_ORDERS', 'ordenes_previsionales_2000_REL-0001.csv', 1],
    ]);
    expect(r.summary).toMatchObject({ createdRows: 3, deletedRows: 0, firstWeek: '2026-10-05', lastWeek: '2026-10-12' });
    expect(r.summary.perPlant).toEqual([{ plantId: 'P1', center: '1000', rows: 2, commercial: 1700 }, { plantId: 'P2', center: '2000', rows: 1, commercial: 500 }]);
  });

  it('cada fila lleva centro, material a 18 dígitos, tipo de orden, cantidad redondeada, fecha fin y referencia trazable', () => {
    const row = r.files[0].rows[0];
    expect(row).toEqual({
      accion: 'CREAR', centro: '1000', material: '000000000009000001', tipoOrden: 'LA', cantidad: 1000, unidad: 'CJ',
      fechaFin: '2026-10-09', linea: 'L1', referencia: 'REL-0001|1000|A|2026-10-05',
    });
    expect(r.files[0].csv.split('\n')[0]).toBe('Accion;Centro;Material;Tipo_orden;Cantidad;UM;Fecha_fin;Linea;Referencia');
    expect(r.files[0].csv).toContain('CREAR;1000;000000000009000001;LA;1000;CJ;09.10.2026;L1;REL-0001|1000|A|2026-10-05');
  });

  it('reconcilia el plan con lo escrito: la diferencia es solo redondeo', () => {
    expect(r.summary.plannedCommercial).toBeCloseTo(2200.4, 6);
    expect(r.summary.writtenCommercial).toBe(2200);
    expect(Math.abs(r.summary.plannedCommercial - r.summary.writtenCommercial)).toBeLessThanOrEqual(r.summary.createdRows * 0.5);
  });

  it('el factor de cantidad se aplica antes de redondear', () => {
    const f = buildProvisionalOrders(mini(), plan, { releaseId: 'REL-0001', quantityFactor: 1.1 });
    expect(f.files[0].rows.map((x) => x.cantidad)).toEqual([1100, 770]);
  });

  it('la orden se fecha el último día con horas de la línea: un festivo el viernes la pasa al jueves', () => {
    const ds = mini([{ date: '2026-10-09', hours: 0 }]);
    expect(lastProductionDay(ds, 'L1', '2026-10-05')).toBe('2026-10-08');
    expect(buildProvisionalOrders(ds, plan, { releaseId: 'R' }).files[0].rows[0].fechaFin).toBe('2026-10-08');
  });

  it('una semana sin horas en la línea no se puede fechar: error, y esa orden no se escribe', () => {
    const all = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'].map((date) => ({ date, hours: 0 }));
    const res = buildProvisionalOrders(mini(all), plan, { releaseId: 'R' });
    expect(res.issues.filter((i) => i.code === 'ZERO_CAPACITY_WEEK').length).toBeGreaterThan(0);
    expect(res.files.flatMap((f) => f.rows).some((x) => x.referencia.endsWith('2026-10-05'))).toBe(false);
  });

  it('una planta sin centro SAP es un error y no genera archivo para ella', () => {
    const res = buildProvisionalOrders(mini([], ['1000', undefined]), plan, { releaseId: 'R' });
    expect(res.issues).toEqual([{ severity: 'error', code: 'MISSING_CENTER', message: 'La planta P2 no tiene código de centro SAP.' }]);
    expect(res.files.map((f) => f.center)).toEqual(['1000']);
  });

  it('un SKU desconocido se reporta', () => {
    const res = buildProvisionalOrders(mini(), [{ skuId: 'Z', weekStart: '2026-10-05', netProduction: 5 }], { releaseId: 'R' });
    expect(res.issues[0].code).toBe('UNKNOWN_SKU_OR_LINE');
  });
});

describe('reemplazo de la publicación anterior (borrado)', () => {
  const prior: ProvisionalOrderRow[] = [
    { accion: 'CREAR', centro: '1000', material: '000000000009000001', tipoOrden: 'LA', cantidad: 900, unidad: 'CJ', fechaFin: '2026-09-25', linea: 'L1', referencia: 'REL-0001|1000|A|2026-09-21' },
    { accion: 'CREAR', centro: '1000', material: '000000000009000001', tipoOrden: 'LA', cantidad: 950, unidad: 'CJ', fechaFin: '2026-10-09', linea: 'L1', referencia: 'REL-0001|1000|A|2026-10-05' },
    { accion: 'CREAR', centro: '2000', material: '000000000009000002', tipoOrden: 'LA', cantidad: 400, unidad: 'CJ', fechaFin: '2026-10-16', linea: 'L2', referencia: 'REL-0001|2000|B|2026-10-12' },
  ];

  it('borra solo lo que cae desde la primera semana del nuevo plan; lo anterior (ya producido) se conserva', () => {
    const res = buildProvisionalOrders(mini(), plan, { releaseId: 'REL-0002', priorOrders: prior });
    const del = res.files.filter((f) => f.kind === 'ORDER_DELETIONS');
    expect(del.map((f) => [f.center, f.name, f.rows.map((x) => x.referencia)])).toEqual([
      ['1000', 'borrar_previsionales_1000_REL-0002.csv', ['REL-0001|1000|A|2026-10-05']],
      ['2000', 'borrar_previsionales_2000_REL-0002.csv', ['REL-0001|2000|B|2026-10-12']],
    ]);
    expect(del.every((f) => f.rows.every((x) => x.accion === 'BORRAR'))).toBe(true);
    expect(res.summary.deletedRows).toBe(2);
  });

  it('los archivos de borrado y de creación salen separados (se cargan con grabaciones distintas)', () => {
    const res = buildProvisionalOrders(mini(), plan, { releaseId: 'REL-0002', priorOrders: prior });
    for (const f of res.files) expect(new Set(f.rows.map((x) => x.accion)).size).toBe(1);
    expect(res.files.some((f) => f.kind === 'PROVISIONAL_ORDERS')).toBe(true);
  });

  it('sin publicación anterior no hay borrados', () => {
    expect(buildProvisionalOrders(mini(), plan, { releaseId: 'REL-0001' }).files.every((f) => f.kind === 'PROVISIONAL_ORDERS')).toBe(true);
  });
});

describe('lectura y validación de archivos', () => {
  const good = buildProvisionalOrders(mini(), plan, { releaseId: 'REL-0001' }).files[0];

  it('ida y vuelta: lo que se escribe se vuelve a leer igual', () => {
    expect(parseOrdersCsv(good.csv)).toEqual({ rows: good.rows, errors: [] });
    expect(parseOrdersCsv(ordersToCsv(good.rows)).rows).toEqual(good.rows);
  });

  it('un archivo correcto valida sin errores', () => {
    expect(validateOrdersFile(good.csv, 'PROVISIONAL_ORDERS').errors).toEqual([]);
  });

  it('detecta encabezado, columnas, cantidades, fechas, materiales y referencias repetidas', () => {
    const row = good.csv.split('\n')[1];
    const bad = (content: string) => validateOrdersFile(content, 'PROVISIONAL_ORDERS').errors.join(' | ');
    const header = good.csv.split('\n')[0];
    expect(bad(`Otra;cosa\n${row}\n`)).toContain('Encabezado inesperado');
    expect(bad(`${header}\nCREAR;1000;1\n`)).toContain('columnas');
    expect(bad(`${header}\n${row.replace(';1000;CJ;', ';0;CJ;')}\n`)).toContain('entero > 0');
    expect(bad(`${header}\n${row.replace('09.10.2026', '31.02.2026')}\n`)).toContain('fecha');
    expect(bad(`${header}\n${row.replace('000000000009000001', '9000001')}\n`)).toContain('18 dígitos');
    expect(bad(`${header}\n${row}\n${row}\n`)).toContain('referencia repetida');
    expect(bad('')).toContain('vacío');
  });

  it('creación y borrado no se mezclan, y un archivo tiene un solo centro', () => {
    const del = good.csv.replaceAll('CREAR', 'BORRAR');
    expect(validateOrdersFile(del, 'PROVISIONAL_ORDERS').errors.join(' ')).toContain('solo puede tener filas CREAR');
    expect(validateOrdersFile(del, 'ORDER_DELETIONS').errors).toEqual([]);
    const twoCenters = `${good.csv}${good.csv.split('\n')[1].replace(';1000;', ';2000;').replace('|1000|', '|2000|X')}\n`;
    expect(validateOrdersFile(twoCenters, 'PROVISIONAL_ORDERS').errors.join(' ')).toContain('un solo centro');
  });
});

describe('con el plan completo del ejemplo sintético', () => {
  const ds: RamoDataset = JSON.parse(readFileSync(new URL('../../../data/synthetic/dataset.json', import.meta.url), 'utf8'));
  const net = computeNetProduction(ds, demandForHorizon(ds, 'V-N1-2026-W40', 'V-PBO-2026-10'));
  const res = buildProvisionalOrders(ds, net, { releaseId: 'REL-0001' });

  it('genera las 2 plantas sin errores y una orden por cada SKU-semana con producción', () => {
    expect(res.issues).toEqual([]);
    expect(res.files.map((f) => f.center)).toEqual(['1000', '2000']);
    expect(res.summary.createdRows).toBe(net.filter((n) => n.netProduction >= 0.5).length);
  });

  it('cada archivo valida y las cajas escritas coinciden con el plan salvo redondeo', () => {
    for (const f of res.files) expect(validateOrdersFile(f.csv, 'PROVISIONAL_ORDERS').errors).toEqual([]);
    expect(Math.abs(res.summary.plannedCommercial - res.summary.writtenCommercial)).toBeLessThanOrEqual(res.summary.createdRows * 0.5);
  });

  it('los SKUs de snacks (Planta 2) van al centro 2000 y los de panadería al 1000', () => {
    const byCenter = (c: string) => res.files.find((f) => f.center === c)!.rows.map((r) => r.linea);
    expect(new Set(byCenter('1000'))).toEqual(new Set(['L-PONQ', 'L-BARR', 'L-MINI']));
    expect(new Set(byCenter('2000'))).toEqual(new Set(['L-CRISP', 'L-MAIZ', 'L-TOST']));
  });

  it('ninguna orden cae en un día festivo (todas en un día con horas)', () => {
    for (const row of res.files.flatMap((f) => f.rows)) expect(['2026-10-12', '2026-11-02', '2026-11-16', '2026-12-08', '2026-12-25']).not.toContain(row.fechaFin);
  });
});
