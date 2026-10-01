import { describe, expect, it } from 'vitest';
import { DemandHistoryRow, Material, OrderHistoryRow, RamoDataset } from '@ramo/domain';
import {
  Explosion, MaterialRisk, adjustOrderForVariability, consolidateOrders, daysBetween, detectDemandSpikes, detectOrderAnomalies, leadTimeStats, mad, materialWeeklySigma,
  median, percentile, quotaCompliance, quotaExceptions, recommendLeadTimes, supplierPerformance, urgencyOf,
} from './index';

const day = (base: string, n: number) => new Date(Date.parse(`${base}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const mat = (id: string, over: Partial<Material> = {}): Material => ({
  id, name: id, type: 'RAW', unit: 'kg', stock: 0, leadTimeDays: 10, safetyDays: 0, moq: 100, suppliers: [{ supplier: 'S1', share: 0.6 }, { supplier: 'S2', share: 0.4 }], ...over,
});
/** Orden histórica: pedida el 2026-01-01 con plazo prometido `planned` y recibida tras `actual` días. */
const ord = (materialId: string, supplier: string, actual: number, planned = 10, qty = 100, start = '2026-01-01'): OrderHistoryRow => ({
  materialId, supplier, orderDate: start, promisedDate: day(start, planned), receivedDate: day(start, actual), qty,
});

describe('estadística básica', () => {
  it('mediana, MAD y percentiles por rango más cercano', () => {
    expect(median([1, 3, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBe(0);
    expect(mad([1, 2, 3, 4, 100])).toBe(1); // robusta al valor extremo
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.8)).toBe(8);
    expect(percentile([1, 2, 3, 4, 5, 6, 7], 0.8)).toBe(6); // 0,8 × 7 = 5,6 → el 6.º valor (rango más cercano, hacia arriba)
    expect(percentile([5], 0.8)).toBe(5);
    expect(daysBetween('2026-01-01', '2026-01-11')).toBe(10);
  });
});

describe('plazos reales por proveedor', () => {
  const h = [10, 12, 14, 10, 20].map((a) => ord('M', 'S1', a));

  it('P50, P80, retraso medio y puntualidad frente al plazo prometido', () => {
    const [s] = leadTimeStats(h);
    expect(s).toMatchObject({ materialId: 'M', supplier: 'S1', n: 5, plannedDays: 10, p50: 12, p80: 14 });
    expect(s.meanDelay).toBeCloseTo((0 + 2 + 4 + 0 + 10) / 5, 8);
    expect(s.onTimeRate).toBeCloseTo(0.4, 8);
  });

  it('ordena a los proveedores del menos al más puntual', () => {
    const perf = supplierPerformance([...h, ...[10, 10, 9].map((a) => ord('M', 'S2', a))]);
    expect(perf.map((p) => p.supplier)).toEqual(['S1', 'S2']);
    expect(perf[1].onTimeRate).toBe(1);
  });
});

describe('plazo dinámico', () => {
  const m = [mat('M', { leadTimeDays: 10 })];
  const rows = (actuals: number[]) => actuals.map((a) => ord('M', 'S1', a));

  it('propone subir el plazo cuando el P80 real lo supera en ≥ 2 días y ≥ 10 %', () => {
    const r = recommendLeadTimes(m, rows([10, 11, 12, 12, 13, 14, 14, 15]));
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ materialId: 'M', currentDays: 10, proposedDays: 14, direction: 'INCREASE', n: 8 });
  });

  it('exige evidencia: mínimo de órdenes y una diferencia material', () => {
    expect(recommendLeadTimes(m, rows([10, 11, 12, 12, 13, 14, 14]))).toEqual([]); // 7 órdenes
    expect(recommendLeadTimes(m, rows([10, 10, 10, 10, 10, 10, 10, 11]))).toEqual([]); // P80 = 10
    expect(recommendLeadTimes(m, rows([10, 10, 10, 10, 11, 11, 11, 11]))).toEqual([]); // 1 día no alcanza
  });

  it('solo propone bajarlo con mucha evidencia', () => {
    const slow = [mat('M', { leadTimeDays: 20 })];
    expect(recommendLeadTimes(slow, rows(Array(12).fill(12)).map((o) => ({ ...o, promisedDate: day(o.orderDate, 20) })))[0]).toMatchObject({ direction: 'DECREASE', proposedDays: 12 });
    expect(recommendLeadTimes(slow, rows(Array(10).fill(12)))).toEqual([]); // 10 órdenes no bastan para bajar
  });

  it('usa el proveedor principal, no la mezcla de todos: un proveedor rápido infrautilizado no esconde al lento', () => {
    const two = [mat('M', { leadTimeDays: 10, suppliers: [{ supplier: 'S1', share: 0.7 }, { supplier: 'S2', share: 0.3 }] })];
    const slow = [14, 15, 16, 16, 17, 18, 18, 19].map((a) => ord('M', 'S1', a));
    const fast = [4, 5, 5, 6, 6, 7, 7, 8].map((a) => ord('M', 'S2', a));
    const r = recommendLeadTimes(two, [...slow, ...fast]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ proposedDays: 18, n: 8, direction: 'INCREASE' }); // P80 de S1; mezclados saldría menor
    expect(r[0].bySupplier.map((s) => s.supplier)).toEqual(['S1', 'S2']);
    // Si el principal tiene poca evidencia, se usan todas las órdenes del material.
    const fewMain = [...slow.slice(0, 3), ...fast, ...[16, 17, 18, 19, 20].map((a) => ord('M', 'S1', a))];
    expect(recommendLeadTimes(two, fewMain)[0].n).toBe(8); // el principal ya llega a 8 órdenes con las 5 extra
    expect(recommendLeadTimes(two, [...slow.slice(0, 3), ...fast])[0]?.n).toBe(11); // principal con 3 órdenes: cae a todas
  });

  it('las mezclas no se analizan', () => {
    expect(recommendLeadTimes([mat('MX', { type: 'MIX' })], rows([20, 20, 20, 20, 20, 20, 20, 20]).map((o) => ({ ...o, materialId: 'MX' })))).toEqual([]);
  });
});

describe('cuota reguladora', () => {
  const m = [mat('M')];
  const q = (a: number, b: number, extra: OrderHistoryRow[] = []) => [{ ...ord('M', 'S1', 10), qty: a }, { ...ord('M', 'S2', 10), qty: b }, ...extra];

  it('detecta la cuota rota: 60/40 negociado, 85/15 real', () => {
    const [c] = quotaCompliance(m, q(850, 150));
    expect(c.broken).toBe(true);
    expect(c.rows.map((r) => [r.supplier, Math.round(r.actual * 100), Math.round(r.deviationPp)])).toEqual([['S1', 85, 25], ['S2', 15, -25]]);
    expect(c.maxDeviationPp).toBeCloseTo(25, 6);
  });

  it('una cuota respetada no se marca; el umbral es configurable', () => {
    expect(quotaCompliance(m, q(600, 400))[0].broken).toBe(false);
    expect(quotaCompliance(m, q(680, 320), { thresholdPp: 5 })[0].broken).toBe(true);
    expect(quotaCompliance(m, q(680, 320), { thresholdPp: 10 })[0].broken).toBe(false);
  });

  it('solo cuenta la ventana pedida e ignora materiales de un solo proveedor', () => {
    const old = { ...ord('M', 'S2', 10, 10, 10_000, '2024-01-01') }; // fuera de una ventana de 365 días
    const [c] = quotaCompliance(m, q(600, 400, [old]), { asOf: '2026-02-01', windowDays: 365 });
    expect(c.orders).toBe(2);
    expect(c.broken).toBe(false);
    expect(quotaCompliance([mat('M', { suppliers: [{ supplier: 'S1', share: 1 }] })], q(100, 0))).toEqual([]);
  });
});

describe('excepción a la cuota por riesgo de plazo', () => {
  const m = [mat('M', { suppliers: [{ supplier: 'A', share: 0.6 }, { supplier: 'B', share: 0.4 }] })];
  const risk = (over: Partial<MaterialRisk> = {}): MaterialRisk => ({
    materialId: 'M', status: 'CRITICAL', reason: 'RUPTURE_IN_LEAD_TIME', avgDailyConsumption: 10, coverageDays: 5, ruptureDate: '2026-10-25', daysToRupture: 20, orderByDate: null, leadTimeDays: 30, lateOrder: null,
    suggestion: { qty: 1000, needBy: '2026-10-25', split: [{ supplier: 'A', qty: 600, share: 0.6 }, { supplier: 'B', qty: 400, share: 0.4 }] }, ...over,
  });
  const hist = (pa: number, pb: number) => [...Array(4).fill(pa).map((a) => ord('M', 'A', a)), ...Array(4).fill(pb).map((a) => ord('M', 'B', a))];

  it('si el proveedor principal no llega antes de la ruptura y otro sí, propone mandarle el pedido al rápido', () => {
    expect(quotaExceptions(m, [risk()], hist(35, 12))).toEqual([{ materialId: 'M', mainSupplier: 'A', fastSupplier: 'B', daysToRupture: 20, mainP80: 35, fastP80: 12, qty: 1000 }]);
  });

  it('no hay excepción si el principal alcanza, si ninguno alcanza o si el material no está en riesgo', () => {
    expect(quotaExceptions(m, [risk()], hist(15, 12))).toEqual([]);
    expect(quotaExceptions(m, [risk()], hist(35, 30))).toEqual([]);
    expect(quotaExceptions(m, [risk()], hist(20, 12))).toEqual([]); // el principal llega justo el día de la ruptura: alcanza
    expect(quotaExceptions(m, [risk()], hist(21, 12))).toHaveLength(1); // un día tarde: ya no
    expect(quotaExceptions(m, [risk({ status: 'WATCH' })], hist(35, 12))).toEqual([]);
  });
});

describe('anomalías en pedidos', () => {
  const history: OrderHistoryRow[] = [100, 110, 90, 105, 95, 100, 102, 98].map((qty, i) => ({ ...ord('M', 'S1', 10, 10, qty), orderDate: day('2026-01-01', i) }));
  const ds = (reqs: { id: string; qty: number; needed: string }[], pos: { qty: number; due: string }[] = [], hist = history): RamoDataset => ({
    synthetic: true, plants: [], crews: [], lines: [], calendars: [], skus: [], versions: [], demand: [], buildingBlocks: [], inventory: [], openOrders: [],
    materials: [mat('M')], orderHistory: hist,
    requisitions: reqs.map((r) => ({ id: r.id, materialId: 'M', qty: r.qty, neededDate: r.needed, createdAt: '2026-10-01' })),
    purchaseOrders: pos.map((p) => ({ materialId: 'M', supplier: 'S1', dueDate: p.due, qty: p.qty })),
  });

  it('marca como posible duplicado una solicitud con casi la misma cantidad y fecha que una orden abierta', () => {
    const a = detectOrderAnomalies(ds([{ id: 'SP1', qty: 195, needed: '2026-10-15' }], [{ qty: 200, due: '2026-10-14' }]));
    expect(a.find((x) => x.kind === 'DUPLICATE_REQUISITION')).toMatchObject({ ref: 'SP1', materialId: 'M' });
    expect(a.find((x) => x.kind === 'DUPLICATE_REQUISITION')!.duplicateOf!.dueDate).toBe('2026-10-14');
  });

  it('no marca duplicado si cambia mucho la cantidad o la fecha', () => {
    const none = (q: number, d: string) => detectOrderAnomalies(ds([{ id: 'SP1', qty: q, needed: d }], [{ qty: 200, due: '2026-10-14' }])).filter((x) => x.kind === 'DUPLICATE_REQUISITION');
    expect(none(120, '2026-10-15')).toEqual([]);
    expect(none(195, '2026-10-30')).toEqual([]);
  });

  it('marca cantidades atípicas hacia arriba y hacia abajo con la mediana y la MAD del historial', () => {
    const hi = detectOrderAnomalies(ds([{ id: 'SP2', qty: 1200, needed: '2026-12-01' }])).find((x) => x.kind === 'QUANTITY_OUTLIER')!;
    expect(hi).toMatchObject({ ref: 'SP2', typicalQty: 100 });
    expect(hi.ratio).toBeCloseTo(12, 6);
    expect(detectOrderAnomalies(ds([{ id: 'SP3', qty: 20, needed: '2026-12-01' }])).some((x) => x.kind === 'QUANTITY_OUTLIER' && x.ref === 'SP3')).toBe(true);
    expect(detectOrderAnomalies(ds([{ id: 'SP4', qty: 105, needed: '2026-12-01' }]))).toEqual([]); // dentro de lo habitual
  });

  it('con historial sin variación (MAD = 0) solo marca lo que triplica la mediana; con poco historial no opina', () => {
    const flat = Array(8).fill(null).map((_, i) => ({ ...ord('M', 'S1', 10, 10, 100), orderDate: day('2026-01-01', i) }));
    expect(detectOrderAnomalies(ds([{ id: 'A', qty: 400, needed: '2026-12-01' }], [], flat)).some((x) => x.ref === 'A')).toBe(true);
    expect(detectOrderAnomalies(ds([{ id: 'B', qty: 150, needed: '2026-12-01' }], [], flat))).toEqual([]);
    expect(detectOrderAnomalies(ds([{ id: 'C', qty: 5000, needed: '2026-12-01' }], [], history.slice(0, 4)))).toEqual([]);
  });

  it('también revisa las órdenes de compra abiertas', () => {
    const a = detectOrderAnomalies(ds([], [{ qty: 5000, due: '2026-11-01' }]));
    expect(a).toHaveLength(1);
    expect(a[0].kind).toBe('QUANTITY_OUTLIER');
  });
});

describe('ventas atípicas', () => {
  const series = (spikeAt: number, spike = 200, n = 40): DemandHistoryRow[] =>
    Array.from({ length: n }, (_, i) => ({ skuId: 'A', weekStart: day('2025-01-06', i * 7), flow: 'CEDI' as const, commercialQty: i === spikeAt ? spike : 100 + ((i % 3) - 1) * 2, priorForecast: null }));

  it('detecta una semana reciente con el doble de lo esperado', () => {
    const s = detectDemandSpikes(series(35));
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ skuId: 'A', value: 200 });
    expect(s[0].ratio).toBeGreaterThan(1.9);
  });

  it('ignora lo anterior a la ventana reciente y las series planas', () => {
    expect(detectDemandSpikes(series(3))).toEqual([]); // fuera de las últimas 26 semanas
    expect(detectDemandSpikes(series(-1))).toEqual([]);
    expect(detectDemandSpikes(series(35).slice(0, 8))).toEqual([]); // serie demasiado corta
  });

  it('detecta también un hueco (quiebre) fuerte', () => {
    expect(detectDemandSpikes(series(35, 10)).map((x) => x.value)).toEqual([10]);
  });
});

describe('variabilidad de la demanda sobre el pedido', () => {
  const explosion: Explosion = {
    coefficients: new Map([['A', new Map([['R', 2]])], ['B', new Map([['R', 3]])]]), paths: new Map(), issues: [],
  };

  it('σ del material = raíz de la suma de (coeficiente × σ del SKU)²', () => {
    const s = materialWeeklySigma(explosion, { A: 10, B: 20 });
    expect(s.get('R')).toBeCloseTo(Math.sqrt(400 + 3600), 8);
    expect(materialWeeklySigma(explosion, {}).size).toBe(0);
  });

  it('sube el pedido en z × σ × √semanas, al múltiplo mínimo', () => {
    const base = { qty: 1000, split: [], needBy: null };
    const adj = adjustOrderForVariability(base, 100, 200, 14, 1.645);
    // 1,645 × 200 × √2 = 465,3 → 500
    expect(adj).toMatchObject({ baseQty: 1000, buffer: 500, qty: 1500 });
    expect(adjustOrderForVariability(base, 100, undefined, 14).buffer).toBe(0);
    expect(adjustOrderForVariability(base, 100, 0, 14).qty).toBe(1000);
  });
});

describe('prioridad y consolidación', () => {
  const r = (over: Partial<MaterialRisk>): MaterialRisk => ({
    materialId: 'M', status: 'OK', reason: 'NONE', avgDailyConsumption: 1, coverageDays: 10, ruptureDate: null, daysToRupture: null, orderByDate: null, leadTimeDays: 10, suggestion: null, lateOrder: null, ...over,
  });

  it('crítico si se rompe en menos de 5 días; normal si hay que decidir; puede esperar si no hay riesgo', () => {
    expect(urgencyOf(r({ status: 'CRITICAL', daysToRupture: 3 }))).toBe('CRITICAL');
    expect(urgencyOf(r({ status: 'CRITICAL', daysToRupture: 5 }))).toBe('NORMAL'); // el borde de 5 días no es crítico
    expect(urgencyOf(r({ status: 'ORDER', daysToRupture: 12 }))).toBe('NORMAL');
    expect(urgencyOf(r({ status: 'WATCH' }))).toBe('NORMAL');
    expect(urgencyOf(r({ status: 'OK' }))).toBe('WAIT');
  });

  const line = (materialId: string, supplier: string, qty: number, orderBy: string): MaterialRisk =>
    r({ materialId, status: 'ORDER', orderByDate: orderBy, suggestion: { qty, needBy: null, split: [{ supplier, qty, share: 1 }] } });

  it('junta los pedidos al mismo proveedor dentro de la ventana y deja solos los lejanos', () => {
    const out = consolidateOrders([line('M1', 'S1', 100, '2026-10-06'), line('M2', 'S1', 200, '2026-10-09'), line('M3', 'S1', 50, '2026-10-20'), line('M4', 'S2', 70, '2026-10-06')], '2026-10-05', 5);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ supplier: 'S1', orderDate: '2026-10-06', ordersBefore: 2 });
    expect(out[0].lines.map((l) => l.materialId)).toEqual(['M1', 'M2']);
  });

  it('las fechas ya vencidas se piden hoy y las líneas en cero se ignoran', () => {
    const late = consolidateOrders([line('M1', 'S1', 100, 'antes del 2026-10-05'), line('M2', 'S1', 100, '2026-10-02')], '2026-10-05');
    expect(late[0]).toMatchObject({ orderDate: '2026-10-05' });
    expect(late[0].lines.every((l) => l.orderBy === '2026-10-05')).toBe(true);
    const zero = r({ materialId: 'Z', suggestion: { qty: 0, needBy: null, split: [{ supplier: 'S1', qty: 0, share: 1 }] } });
    expect(consolidateOrders([zero, line('M1', 'S1', 100, '2026-10-06')], '2026-10-05')).toEqual([]);
  });
});
