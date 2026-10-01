import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DemandRecord, DistributionNode, RamoDataset, validateDataset } from '@ramo/domain';
import {
  DEFAULT_SERVICE_Z, ScarcityRequest, WeekCapacity, allocateScarcity, computeNetProduction, plantRequirementRecords, runDrp, safetyStock,
  scarcityRequests, supplyGaps,
} from './index';

const WEEKS = ['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26'];

const cedi: DistributionNode = { id: 'C', name: 'CEDI', type: 'CEDI', leadTimeWeeks: 1, demandShare: 0.4, inventoryShare: 0.5, priority: 'NORMAL', minCoverDays: 0, storageCapacity: 1_000_000 };
const agency: DistributionNode = { id: 'A', name: 'Agencia', type: 'AGENCY', parentId: 'C', leadTimeWeeks: 0, demandShare: 0.6, inventoryShare: 0.5, priority: 'HIGH', minCoverDays: 3, storageCapacity: 1_000_000 };

/** Un SKU, una línea de 1.000 u/h y 40 h/semana; red CEDI + 1 agencia; demanda 1.000 por semana. */
function mini(nodes: DistributionNode[] = [cedi, agency], inventory = 2400): RamoDataset {
  return {
    synthetic: true,
    plants: [{ id: 'P', name: 'P' }],
    crews: [{ id: 'CR', name: 'CR', lineIds: ['L'] }],
    lines: [{ id: 'L', name: 'L', plantId: 'P', crewId: 'CR', rate: { value: 1000, unit: 'u/h' } }],
    calendars: [{ lineId: 'L', workingWeekdays: [1, 2, 3, 4, 5], baseHoursPerDay: 8, exceptions: [] }],
    skus: [{ id: 'A', sapMaterial: 'A', name: 'A', family: 'F', businessUnit: 'BU', brand: 'B', lineId: 'L', commercialUnit: 'caja', productiveUnit: 'u', productiveUnitsPerCommercial: 1, kgPerCommercial: 1, costPerCommercial: 1 }],
    versions: [{ id: 'V', kind: 'WEEKLY_N1', label: 'v', createdAt: '', createdByRole: 'demand' }],
    demand: [],
    buildingBlocks: [],
    inventory: [{ skuId: 'A', onHandCommercial: inventory }],
    openOrders: [],
    nodes,
  };
}
const demand = (qty = 1000): DemandRecord[] => WEEKS.map((w) => ({ versionId: 'V', skuId: 'A', weekStart: w, flow: 'CEDI', commercialQty: qty }));
const cell = (r: ReturnType<typeof runDrp>, nodeId: string, t: number) => r.rows.find((x) => x.nodeId === nodeId)!.cells[t];

describe('stock de seguridad', () => {
  it('dinámico = z × σ × √(plazo + revisión); estático = días × demanda promedio', () => {
    const base = { z: 1.645, sigmaWeek: 100, leadWeeks: 1, reviewWeeks: 1, avgWeeklyDemand: 700, staticDays: 3 };
    expect(safetyStock({ ...base, policy: 'DYNAMIC' }).units).toBeCloseTo(1.645 * 100 * Math.sqrt(2), 6);
    expect(safetyStock({ ...base, policy: 'STATIC' }).units).toBeCloseTo(300, 6);
  });

  it('sin σ en modo dinámico cae a la política estática y lo avisa', () => {
    const r = safetyStock({ policy: 'DYNAMIC', z: 1.645, sigmaWeek: undefined, leadWeeks: 1, reviewWeeks: 1, avgWeeklyDemand: 700, staticDays: 3 });
    expect(r).toEqual({ units: 300, fallback: true });
  });

  it('más prioridad y más variabilidad exigen más stock', () => {
    const s = (z: number, sigma: number) => safetyStock({ policy: 'DYNAMIC', z, sigmaWeek: sigma, leadWeeks: 1, reviewWeeks: 1, avgWeeklyDemand: 0, staticDays: 0 }).units;
    expect(s(DEFAULT_SERVICE_Z.HIGH, 100)).toBeGreaterThan(s(DEFAULT_SERVICE_Z.LOW, 100));
    expect(s(1.645, 200)).toBeGreaterThan(s(1.645, 100));
  });
});

describe('DRP: caso calculado a mano (política estática de 7 días)', () => {
  // Agencia (60 %): bruto 600, SS 600, inventario 1.200 → recibe 0, 600, 600, 600. CEDI: bruto 400 + liberaciones de la agencia.
  const r = runDrp(mini(), demand(), { policy: 'STATIC', staticDays: 7, pipeline: 'NONE' });

  it('agencia: repone para no bajar del stock de seguridad', () => {
    expect(r.rows.find((x) => x.nodeId === 'A')!.cells.map((c) => c.plannedReceipt)).toEqual([0, 600, 600, 600]);
    expect(cell(r, 'A', 0).projectedOnHand).toBe(600);
  });

  it('CEDI: demanda propia + despachos a la agencia, y necesidad hacia planta con el plazo descontado', () => {
    expect(r.rows.find((x) => x.nodeId === 'C')!.cells.map((c) => c.gross)).toEqual([400, 1000, 1000, 1000]);
    // Plazo de 1 semana: en la semana 0 no puede llegar nada nuevo; el stock baja a 800 (< 1.000 de seguridad) y la semana 1 lo recupera.
    expect(r.rows.find((x) => x.nodeId === 'C')!.cells.map((c) => c.plannedReceipt)).toEqual([0, 1200, 1000, 1000]);
    expect(r.rows.find((x) => x.nodeId === 'C')!.cells.map((c) => c.projectedOnHand)).toEqual([800, 1000, 1000, 1000]);
    // Lo que se recibe en t se libera en t−1, así que toda la necesidad hacia planta cae dentro del horizonte.
    expect(r.plantRequirements.map((p) => [p.weekStart, p.qty])).toEqual([
      ['2026-10-05', 1200],
      ['2026-10-12', 1000],
      ['2026-10-19', 1000],
      ['2026-10-26', 1000], // la última semana también pide lo que se recibe después del horizonte
    ]);
    expect(r.alerts.filter((a) => a.code === 'BELOW_SAFETY')).toEqual([{ code: 'BELOW_SAFETY', nodeId: 'C', skuId: 'A', weekStart: '2026-10-05', value: 200 }]);
    expect(r.alerts.some((a) => a.code === 'STOCKOUT')).toBe(false);
  });

  it('balance por nodo: inicial + recepciones − bruto = final', () => {
    for (const row of r.rows) {
      const received = row.cells.reduce((a, c) => a + c.plannedReceipt + c.scheduledReceipt, 0);
      const gross = row.cells.reduce((a, c) => a + c.gross, 0);
      expect(row.initialOnHand + received - gross).toBeCloseTo(row.cells[3].projectedOnHand, 6);
    }
  });

  it('fuera del plazo congelado nunca baja del stock de seguridad', () => {
    for (const row of r.rows) {
      const lead = mini().nodes!.find((n) => n.id === row.nodeId)!.leadTimeWeeks;
      row.cells.slice(lead).forEach((c) => expect(c.projectedOnHand).toBeGreaterThanOrEqual(c.safetyStock - 1e-9));
    }
  });

  it('si el inventario no cubre la demanda dentro del plazo, hay quiebre y la primera recepción factible lo recupera', () => {
    const empty = runDrp(mini([cedi, agency], 0), demand(), { policy: 'STATIC', staticDays: 7, pipeline: 'NONE' });
    const c = empty.rows.find((x) => x.nodeId === 'C')!.cells;
    // Sin inventario, la agencia (plazo 0) recibe 600 + 600 de seguridad y le pide 1.200 al CEDI, que además tiene su propia demanda de 400.
    expect(c[0].gross).toBe(1600);
    expect(c[0].projectedOnHand).toBe(-1600); // el CEDI no tiene stock y no puede recibir en la semana 0
    expect(empty.alerts.some((a) => a.code === 'STOCKOUT' && a.nodeId === 'C' && a.weekStart === '2026-10-05' && a.value === 1600)).toBe(true);
    expect(c[1].plannedReceipt).toBe(1000 + 1000 + 1600); // seguridad + demanda de la semana + lo que quedó sin servir
    expect(c[1].projectedOnHand).toBe(1000);
  });

  it('los registros para el MPS salen redondeados y como flujo CEDI', () => {
    const recs = plantRequirementRecords(r, 'DRP-X');
    expect(recs).toHaveLength(4);
    expect(recs.every((x) => x.flow === 'CEDI' && x.versionId === 'DRP-X')).toBe(true);
  });
});

describe('DRP: flujo en camino (pipeline)', () => {
  it('con el flujo de régimen en camino, el CEDI no entra en déficit y la semana 0 pide solo lo necesario', () => {
    const r = runDrp(mini(), demand(), { policy: 'STATIC', staticDays: 7, pipeline: 'STEADY_STATE' });
    const c = r.rows.find((x) => x.nodeId === 'C')!.cells;
    // Bruto del CEDI [400, 1.000 × 4] (horizonte extendido 1 semana) → promedio 880 en camino la semana 0: 1.200 + 880 − 400 = 1.680 (≥ 1.000 de seguridad).
    expect(c[0].scheduledReceipt).toBeCloseTo(880, 6);
    expect(c[0].projectedOnHand).toBeCloseTo(1680, 6);
    expect(r.alerts.some((a) => a.code === 'BELOW_SAFETY' || a.code === 'STOCKOUT')).toBe(false);
    expect(r.plantRequirements.map((p) => [p.weekStart, Math.round(p.qty)])).toEqual([
      ['2026-10-05', 320],
      ['2026-10-12', 1000],
      ['2026-10-19', 1000],
      ['2026-10-26', 1000],
    ]);
    expect(c[1].scheduledReceipt).toBe(0); // el flujo en camino solo cubre el plazo congelado
  });

  it('es el valor por defecto y se puede apagar', () => {
    const def = runDrp(mini(), demand(), { policy: 'STATIC', staticDays: 7 });
    const on = runDrp(mini(), demand(), { policy: 'STATIC', staticDays: 7, pipeline: 'STEADY_STATE' });
    const off = runDrp(mini(), demand(), { policy: 'STATIC', staticDays: 7, pipeline: 'NONE' });
    expect(def.plantRequirements).toEqual(on.plantRequirements);
    expect(off.plantRequirements[0].qty).toBeGreaterThan(on.plantRequirements[0].qty);
  });

  it('los nodos sin plazo no tienen flujo en camino', () => {
    const r = runDrp(mini(), demand(), { policy: 'STATIC', pipeline: 'STEADY_STATE' });
    expect(r.rows.find((x) => x.nodeId === 'A')!.cells.every((c) => c.scheduledReceipt === 0)).toBe(true);
  });
});

describe('DRP: otras reglas', () => {
  it('Hard Discount y Exportaciones no pasan por el DRP', () => {
    const extra: DemandRecord[] = [...demand(), { versionId: 'V', skuId: 'A', weekStart: WEEKS[0], flow: 'HARD_DISCOUNT', commercialQty: 9999 }];
    const a = runDrp(mini(), extra, { policy: 'STATIC' });
    const b = runDrp(mini(), demand(), { policy: 'STATIC' });
    expect(a.plantRequirements).toEqual(b.plantRequirements);
  });

  it('política dinámica usa σ por SKU y reparte σ por √participación; sin σ avisa la caída a estática', () => {
    const dyn = runDrp(mini(), demand(), { policy: 'DYNAMIC', sigmaBySku: { A: 100 } });
    const agencySs = dyn.safety.find((s) => s.nodeId === 'A')!;
    expect(agencySs.activeUnits).toBeCloseTo(DEFAULT_SERVICE_Z.HIGH * 100 * Math.sqrt(0.6) * Math.sqrt(0 + 1), 6);
    const ceSs = dyn.safety.find((s) => s.nodeId === 'C')!;
    expect(ceSs.activeUnits).toBeCloseTo(DEFAULT_SERVICE_Z.NORMAL * 100 * Math.sqrt(1 + 1), 6);
    expect(dyn.safety.every((s) => !s.fallback)).toBe(true);
    const fb = runDrp(mini(), demand(), { policy: 'DYNAMIC' });
    expect(fb.safety.every((s) => s.fallback)).toBe(true);
  });

  it('más variabilidad ⇒ más producción requerida (el stock de seguridad se construye)', () => {
    const total = (sigma: number) => runDrp(mini(), demand(), { policy: 'DYNAMIC', sigmaBySku: { A: sigma } }).plantRequirements.reduce((a, p) => a + p.qty, 0);
    expect(total(300)).toBeGreaterThan(total(50));
  });

  it('alerta de espacio cuando el stock proyectado del nodo supera su capacidad', () => {
    const tight = mini([cedi, { ...agency, storageCapacity: 500 }]);
    const r = runDrp(tight, demand(), { policy: 'STATIC', staticDays: 7 });
    const space = r.alerts.filter((a) => a.code === 'SPACE' && a.nodeId === 'A');
    expect(space).toHaveLength(4);
    expect(space[0].value).toBeCloseTo(100, 6); // 600 proyectado − 500
  });

  it('sin red definida devuelve un resultado vacío', () => {
    expect(runDrp(mini([]), demand()).rows).toEqual([]);
    const noNodes = { ...mini(), nodes: undefined };
    expect(runDrp(noNodes, demand()).plantRequirements).toEqual([]);
  });

  it('un SKU sin demanda no genera filas', () => {
    expect(runDrp(mini(), []).rows).toEqual([]);
  });
});

describe('red válida', () => {
  it('detecta participaciones que no suman 1, dos CEDI y agencias sin padre', () => {
    const codes = (nodes: DistributionNode[]) => validateDataset(mini(nodes)).map((i) => i.code);
    expect(codes([cedi, { ...agency, demandShare: 0.5 }])).toContain('NODE_SHARE_SUM');
    expect(codes([cedi, { ...cedi, id: 'C2', demandShare: 0, inventoryShare: 0 }, agency])).toContain('NODE_CEDI_COUNT');
    expect(codes([cedi, { ...agency, parentId: 'NOPE' }])).toContain('NODE_PARENT');
    expect(codes([cedi, { ...agency, leadTimeWeeks: 1.5 }])).toContain('NODE_LEAD_TIME');
    expect(codes([cedi, agency])).toEqual([]);
  });
});

describe('escasez: reparto proporcional con mínimos y override', () => {
  const req = (nodeId: string, priority: ScarcityRequest['priority'], requested: number, minCoverDays: number, override?: number): ScarcityRequest => ({
    nodeId, priority, requested, weeklyForecast: requested, minCoverDays, override,
  });
  const base = [req('A', 'HIGH', 600, 4), req('B', 'NORMAL', 600, 2), req('C', 'LOW', 400, 1)];
  const by = (r: ReturnType<typeof allocateScarcity>, id: string) => r.allocations.find((a) => a.nodeId === id)!;

  it('sin escasez, todos reciben lo pedido', () => {
    const r = allocateScarcity(2000, base);
    expect(r.scarce).toBe(false);
    expect(r.allocations.every((a) => a.reason === 'FULL' && a.allocated === a.requested)).toBe(true);
  });

  it('con escasez protege los mínimos y reparte el resto a prorrata del pronóstico', () => {
    const r = allocateScarcity(1000, base);
    // Mínimos: 600/7×4 = 342,86 · 600/7×2 = 171,43 · 400/7×1 = 57,14; el resto (428,57) se reparte 600:600:400.
    expect(by(r, 'A').minimum).toBeCloseTo(342.857, 2);
    expect(by(r, 'A').allocated).toBeCloseTo(342.857 + 428.571 * 0.375, 2);
    expect(by(r, 'B').allocated).toBeCloseTo(171.429 + 428.571 * 0.375, 2);
    expect(by(r, 'C').allocated).toBeCloseTo(57.143 + 428.571 * 0.25, 2);
    expect(r.allocatedTotal).toBeCloseTo(1000, 6);
    expect(r.scarce).toBe(true);
  });

  it('si no alcanza ni para los mínimos, manda la prioridad: primero HIGH, luego NORMAL', () => {
    const r = allocateScarcity(400, base);
    expect(by(r, 'A').allocated).toBeCloseTo(342.857, 2);
    expect(by(r, 'B').allocated).toBeCloseTo(57.143, 2); // lo que queda para el nivel NORMAL, a prorrata de sus mínimos
    expect(by(r, 'C').allocated).toBeCloseTo(0, 6);
    const tiny = allocateScarcity(200, base);
    expect(by(tiny, 'A').allocated).toBeCloseTo(200, 6);
    expect(by(tiny, 'B').allocated).toBe(0);
  });

  it('el override manual se respeta primero, con tope en lo pedido y lo disponible', () => {
    const r = allocateScarcity(1000, [req('A', 'HIGH', 600, 4), req('B', 'NORMAL', 600, 2, 100), req('C', 'LOW', 400, 1)]);
    expect(by(r, 'B')).toMatchObject({ allocated: 100, reason: 'OVERRIDE' });
    expect(r.allocatedTotal).toBeCloseTo(1000, 6); // lo liberado se redistribuye a los demás
    const capped = allocateScarcity(1000, [req('A', 'HIGH', 600, 4, 900), req('B', 'NORMAL', 600, 2)]);
    expect(by(capped, 'A').allocated).toBe(600); // no pasa de lo pedido
    const noSupply = allocateScarcity(50, [req('A', 'HIGH', 600, 4, 500), req('B', 'NORMAL', 600, 2)]);
    expect(by(noSupply, 'A').allocated).toBe(50); // ni de lo disponible
  });

  it('invariantes: nunca reparte más de lo disponible ni de lo pedido', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let k = 0; k < 200; k++) {
      const rs = Array.from({ length: 2 + Math.floor(rnd() * 4) }, (_, i) =>
        req(`N${i}`, (['HIGH', 'NORMAL', 'LOW'] as const)[Math.floor(rnd() * 3)], Math.round(rnd() * 1000), Math.floor(rnd() * 6), rnd() < 0.2 ? Math.round(rnd() * 800) : undefined));
      const supply = Math.round(rnd() * 2500);
      const r = allocateScarcity(supply, rs);
      expect(r.allocatedTotal).toBeLessThanOrEqual(supply + 1e-6);
      r.allocations.forEach((a) => {
        expect(a.allocated).toBeLessThanOrEqual(a.requested + 1e-6);
        expect(a.allocated).toBeGreaterThanOrEqual(-1e-9);
      });
    }
  });
});

describe('escasez: del CRP al reparto', () => {
  const crew = (required: number, excess: number): WeekCapacity => ({
    weekStart: WEEKS[1], lines: [], crews: [{ crewId: 'CR', lineIds: ['L'], requiredHours: required, availableHours: required - excess, extraHours: 0, saturationPct: 100, excessHours: excess, status: 'OK' }],
  });

  it('faltante de producción = necesidad × (exceso ÷ horas requeridas)', () => {
    const ds = mini();
    const net = [{ skuId: 'A', weekStart: WEEKS[1], grossCedi: 0, grossMto: 0, netProduction: 1000 }];
    const gaps = supplyGaps(ds, net, [crew(50, 10)]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ skuId: 'A', required: 1000 });
    expect(gaps[0].factor).toBeCloseTo(0.8, 6);
    expect(gaps[0].shortfall).toBeCloseTo(200, 6);
    expect(supplyGaps(ds, net, [crew(50, 0)])).toEqual([]);
  });

  it('los pedidos de los nodos salen del DRP: liberaciones de agencias y demanda propia del CEDI', () => {
    const ds = mini();
    const r = runDrp(ds, demand(), { policy: 'STATIC', staticDays: 7 });
    const reqs = scarcityRequests(ds, r, 'A', WEEKS[1]);
    expect(reqs.find((x) => x.nodeId === 'A')).toMatchObject({ requested: 600, weeklyForecast: 600, priority: 'HIGH', minCoverDays: 3 });
    expect(reqs.find((x) => x.nodeId === 'C')!.requested).toBeCloseTo(400, 6);
    expect(scarcityRequests(ds, r, 'A', '2030-01-07')).toEqual([]);
  });
});

describe('dataset sintético completo', () => {
  const ds: RamoDataset = JSON.parse(readFileSync(new URL('../../../data/synthetic/dataset.json', import.meta.url), 'utf8'));
  const dem = ds.demand.filter((d) => d.versionId === 'V-N1-2026-W40' || d.versionId === 'V-PBO-2026-10');
  const sigma = Object.fromEntries(ds.skus.map((s) => [s.id, 1500]));

  it('la red sintética es válida y suma 1 en demanda e inventario', () => {
    expect(validateDataset(ds)).toEqual([]);
    expect(ds.nodes!.reduce((a, n) => a + n.demandShare, 0)).toBeCloseTo(1, 9);
    expect(ds.nodes!.reduce((a, n) => a + n.inventoryShare, 0)).toBeCloseTo(1, 9);
  });

  it('el DRP corre para los 8 SKUs y su salida alimenta el neto del MPS', () => {
    const r = runDrp(ds, dem.filter((d) => d.versionId === 'V-PBO-2026-10'), { policy: 'DYNAMIC', sigmaBySku: sigma });
    expect(new Set(r.rows.map((x) => x.skuId)).size).toBe(8);
    expect(r.rows.length).toBe(8 * ds.nodes!.length);
    const records = plantRequirementRecords(r);
    const net = computeNetProduction({ ...ds, inventory: [] }, records);
    expect(net.length).toBeGreaterThan(0);
    expect(net.every((x) => x.netProduction >= 0)).toBe(true);
  });
});
