import { describe, expect, it } from 'vitest';
import { BomLine, Material, OrderHistoryRow, RamoDataset } from '@ramo/domain';
import { NetPlanRow, answerQuestion, buildInsights, runSupplyRisk, withLeadTimes } from './index';

const W = ['2026-10-05', '2026-10-12', '2026-10-19'];
const net: NetPlanRow[] = W.map((w) => ({ skuId: 'A', weekStart: w, grossCedi: 50, grossMto: 0, netProduction: 50 }));
const day = (base: string, n: number) => new Date(Date.parse(`${base}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const mat = (id: string, name: string, over: Partial<Material> = {}): Material => ({
  id, name, type: 'RAW', unit: 'kg', stock: 100, leadTimeDays: 10, safetyDays: 0, moq: 10, suppliers: [{ supplier: 'A', share: 0.6 }, { supplier: 'B', share: 0.4 }], ...over,
});
const order = (supplier: string, actual: number, i: number): OrderHistoryRow => {
  const orderDate = day('2026-01-01', i * 5);
  return { materialId: 'R', supplier, orderDate, promisedDate: day(orderDate, 10), receivedDate: day(orderDate, actual), qty: 100 };
};

/** SKU A que consume 1 kg de R (stock 100, plazo 10 días): se rompe el día 14 y hay que pedir el 9 de octubre (estado «pedir ya»). */
function mini(history: OrderHistoryRow[] = [], bom: BomLine[] = [{ parentId: 'A', componentId: 'R', quantityPer: 1, scrapPct: 0 }]): RamoDataset {
  return {
    synthetic: true,
    plants: [{ id: 'P', name: 'P' }],
    crews: [{ id: 'C', name: 'C', lineIds: ['L'] }],
    lines: [{ id: 'L', name: 'L', plantId: 'P', crewId: 'C', rate: { value: 1000, unit: 'u/h' } }],
    calendars: [{ lineId: 'L', workingWeekdays: [1, 2, 3, 4, 5], baseHoursPerDay: 8, exceptions: [] }],
    skus: [{ id: 'A', sapMaterial: 'A', name: 'A', family: 'F', businessUnit: 'BU', brand: 'B', lineId: 'L', commercialUnit: 'caja', productiveUnit: 'u', productiveUnitsPerCommercial: 1, kgPerCommercial: 1, costPerCommercial: 1 }],
    versions: [], demand: [], buildingBlocks: [], inventory: [], openOrders: [],
    materials: [mat('R', 'Cacao importado')], bom, purchaseOrders: [], orderHistory: history, requisitions: [],
  };
}
const insights = (ds: RamoDataset, sigma?: Record<string, number>) => buildInsights({ ds, net, risk: runSupplyRisk(ds, net), sigmaBySku: sigma, today: '2026-10-05' });

describe('recomendación de pedido con ajuste por variabilidad', () => {
  it('sin σ: cantidad base, partida por la cuota, y lo dice', () => {
    const rec = insights(mini()).recommendations.find((r) => r.id === 'ORDER|R')!;
    expect(rec.action).toEqual({ type: 'PLACE_ORDER', materialId: 'R', qty: 50, split: [{ supplier: 'A', qty: 30 }, { supplier: 'B', qty: 20 }] });
    expect(rec.why.some((w) => w.includes('Sin ajuste por variabilidad'))).toBe(true);
    expect(rec.urgency).toBe('NORMAL'); // se rompe en 14 días, no en menos de 5
  });

  it('con σ: sube la cantidad por la variabilidad y explica la cifra', () => {
    const result = insights(mini(), { A: 20 });
    const rec = result.recommendations.find((r) => r.id === 'ORDER|R')!;
    // σ semanal del material 20 · 1,645 · √(21 días / 7) = 57 → 60 kg extra al múltiplo de 10 → 110 kg; 11 múltiplos 60/40 → 7 y 4.
    expect(result.adjusted.get('R')).toMatchObject({ baseQty: 50, buffer: 60, qty: 110 });
    expect(rec.action).toEqual({ type: 'PLACE_ORDER', materialId: 'R', qty: 110, split: [{ supplier: 'A', qty: 70 }, { supplier: 'B', qty: 40 }] });
    expect(rec.why.some((w) => w.includes('+60 kg por variabilidad'))).toBe(true);
    expect(rec.impact).toContain('2026-10-');
  });
});

describe('plazo dinámico con efecto en el riesgo', () => {
  const hist = [...Array(5).fill(0).map((_, i) => order('A', 14, i)), ...Array(5).fill(0).map((_, i) => order('B', 14, i + 5))];

  it('propone 10 → 14 días y muestra que cambia el estado de «pedir ya» a «ruptura dentro del plazo»', () => {
    const rec = insights(mini(hist)).recommendations.find((r) => r.id === 'LEAD_TIME|R')!;
    expect(rec.action).toEqual({ type: 'SET_LEAD_TIME', materialId: 'R', days: 14 });
    expect(rec.title).toContain('10 → 14 días');
    expect(rec.impact).toBe('Con el plazo real el estado pasa de «pedir ya» a «ruptura dentro del plazo».');
    expect(rec.urgency).toBe('CRITICAL'); // empeora hasta crítico
    expect(rec.why.some((w) => w.includes('resincroniza'))).toBe(true);
  });

  it('aplicar el plazo aprobado cierra el ciclo: la recomendación desaparece y el riesgo ya lo usa', () => {
    const ds = mini(hist);
    const approved = withLeadTimes(ds, { R: 14 });
    expect(ds.materials![0].leadTimeDays).toBe(10); // no muta el original
    expect(approved.materials![0].leadTimeDays).toBe(14);
    expect(insights(approved).recommendations.some((r) => r.id === 'LEAD_TIME|R')).toBe(false);
    expect(runSupplyRisk(approved, net).risks[0].status).toBe('CRITICAL');
    expect(withLeadTimes(ds, {})).toBe(ds);
  });
});

describe('orden de las recomendaciones y trazabilidad', () => {
  it('cada recomendación trae su porqué, ids únicos y orden por urgencia', () => {
    const hist = [...Array(5).fill(0).map((_, i) => order('A', 14, i)), ...Array(5).fill(0).map((_, i) => order('B', 14, i + 5))];
    const recs = insights(mini(hist), { A: 20 }).recommendations;
    expect(recs.length).toBeGreaterThanOrEqual(2);
    expect(recs.every((r) => r.why.length > 0 && r.title.length > 0)).toBe(true);
    expect(new Set(recs.map((r) => r.id)).size).toBe(recs.length);
    const rank = { CRITICAL: 0, NORMAL: 1, WAIT: 2 } as const;
    expect(recs.map((r) => rank[r.urgency])).toEqual([...recs.map((r) => rank[r.urgency])].sort((a, b) => a - b));
  });

  it('sin riesgos ni historial no hay recomendaciones', () => {
    const ds = mini();
    ds.materials = [mat('R', 'Cacao importado', { stock: 100_000 })];
    expect(insights(ds).recommendations).toEqual([]);
  });
});

describe('copiloto de preguntas guiadas', () => {
  const hist = [...Array(5).fill(0).map((_, i) => order('A', 14, i)), ...Array(5).fill(0).map((_, i) => order('B', 14, i + 5))];
  const ds = mini(hist);
  const risk = runSupplyRisk(ds, net);
  const ins = buildInsights({ ds, net, risk, today: '2026-10-05' });
  const ask = (q: string) => answerQuestion(q, ds, risk, ins);

  it('enruta por intención y cita cifras', () => {
    expect(ask('¿Qué debo pedir esta semana?').topic).toBe('orders');
    expect(ask('¿Qué proveedores llegan tarde?')).toMatchObject({ topic: 'suppliers' });
    expect(ask('¿Qué cuotas están rotas?').topic).toBe('quota');
    expect(ask('plazos de entrega').topic).toBe('lead_time');
    expect(ask('hay anomalías o duplicados?').topic).toBe('anomalies');
    expect(ask('se pueden consolidar pedidos').topic).toBe('consolidation');
    expect(ask('materiales críticos').topic).toBe('critical');
  });

  it('si nombras un material, lo explica con su estado, fechas y recomendaciones abiertas', () => {
    const a = ask('¿Por qué el cacao está en riesgo?');
    expect(a.topic).toBe('material:R');
    expect(a.lines[0]).toContain('pedir ya');
    expect(a.lines.join('\n')).toContain('Se rompe el 2026-10-19');
    expect(a.lines.join('\n')).toContain('Recomendaciones abiertas');
  });

  it('con una pregunta que no entiende, ofrece ayuda en vez de inventar', () => {
    const a = ask('cuéntame un chiste');
    expect(a.topic).toBe('help');
    expect(a.lines.join(' ')).toContain('Respondo solo con resultados ya calculados');
  });
});
