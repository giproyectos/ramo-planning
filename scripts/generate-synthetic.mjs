// Genera data/synthetic/dataset.json de forma determinista (semilla fija).
// Datos 100% sintéticos: nombres, códigos y cantidades son ficticios; solo se imita la forma
// y el orden de magnitud de los ritmos que se vieron en las reuniones con Ramo.
// Uso: node scripts/generate-synthetic.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../data/synthetic/dataset.json');

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(2026);

const plants = [
  { id: 'P1', name: 'Planta 1 (sint.)', sapCenter: '1000' },
  { id: 'P2', name: 'Planta 2 (sint.)', sapCenter: '2000' },
];

const lines = [
  { id: 'L-PONQ', name: 'Línea Ponqués', plantId: 'P1', crewId: 'C-PONQ', rate: { value: 29000, unit: 'u/h' } },
  { id: 'L-BARR', name: 'Línea Barras', plantId: 'P1', crewId: 'C-BARMINI', rate: { value: 18000, unit: 'u/h' } },
  { id: 'L-MINI', name: 'Línea Mini', plantId: 'P1', crewId: 'C-BARMINI', rate: { value: 24000, unit: 'u/h' } },
  { id: 'L-CRISP', name: 'Línea Crispetas', plantId: 'P2', crewId: 'C-CRISP', rate: { value: 70, unit: 'kg/h' } },
  { id: 'L-MAIZ', name: 'Línea Maicitos', plantId: 'P2', crewId: 'C-MAIZTOST', rate: { value: 620, unit: 'kg/h' } },
  { id: 'L-TOST', name: 'Línea Tostadas', plantId: 'P2', crewId: 'C-MAIZTOST', rate: { value: 500, unit: 'kg/h' } },
];

const crews = [
  { id: 'C-PONQ', name: 'Tripulación Ponqués', lineIds: ['L-PONQ'] },
  { id: 'C-BARMINI', name: 'Tripulación Barras/Mini', lineIds: ['L-BARR', 'L-MINI'] },
  { id: 'C-CRISP', name: 'Tripulación Crispetas', lineIds: ['L-CRISP'] },
  { id: 'C-MAIZTOST', name: 'Tripulación Maicitos/Tostadas', lineIds: ['L-MAIZ', 'L-TOST'] },
];

const holidays = ['2026-10-12', '2026-11-02', '2026-11-16', '2026-12-08', '2026-12-25'];
const calendars = lines.map((l) => ({
  lineId: l.id,
  workingWeekdays: [1, 2, 3, 4, 5],
  baseHoursPerDay: 16,
  exceptions: holidays.map((date) => ({ date, hours: 0, reason: 'HOLIDAY' })),
}));
const cal = (id) => calendars.find((c) => c.lineId === id).exceptions;
cal('L-BARR').push({ date: '2026-10-20', hours: 8, reason: 'MAINTENANCE', note: 'Mantenimiento preventivo (sint.)' });
cal('L-CRISP').push({ date: '2026-11-10', hours: 0, reason: 'MAINTENANCE', note: 'Parada de mantenimiento (sint.)' });
for (const id of ['L-CRISP', 'L-MAIZ', 'L-TOST']) {
  cal(id).push({ date: '2026-11-24', hours: 6, reason: 'PLANT_STOP', note: 'Parada de planta avisada con pocos días (sint.)' });
}
calendars.forEach((c) => c.exceptions.sort((a, b) => a.date.localeCompare(b.date)));

// [id, nombre, familia, UN, marca, línea, unidad productiva, prod/comercial, kg/comercial, costo/comercial, peso en la línea]
const skuRows = [
  ['SK-001', 'Ponqué Chocolate 40g (sint.)', 'Ponqués', 'Panadería', 'Marca A', 'L-PONQ', 'u', 24, 0.96, 18000, 0.6],
  ['SK-002', 'Ponqué Vainilla 40g (sint.)', 'Ponqués', 'Panadería', 'Marca A', 'L-PONQ', 'u', 24, 0.96, 17500, 0.4],
  ['SK-003', 'Barra Cereal 25g (sint.)', 'Barras', 'Snacks', 'Marca B', 'L-BARR', 'u', 24, 0.6, 21000, 0.55],
  ['SK-004', 'Barra Avena 25g (sint.)', 'Barras', 'Snacks', 'Marca B', 'L-BARR', 'u', 24, 0.6, 21500, 0.45],
  ['SK-005', 'Mini Chocolate 20g (sint.)', 'Mini', 'Panadería', 'Marca A', 'L-MINI', 'u', 30, 0.6, 16000, 1],
  ['SK-006', 'Crispetas Mantequilla 100g (sint.)', 'Crispetas', 'Snacks', 'Marca C', 'L-CRISP', 'kg', 1.2, 1.2, 30000, 1],
  ['SK-007', 'Maicitos Sal 45g (sint.)', 'Maicitos', 'Snacks', 'Marca C', 'L-MAIZ', 'kg', 1.08, 1.08, 19000, 1],
  ['SK-008', 'Tostadas 80g (sint.)', 'Tostadas', 'Snacks', 'Marca D', 'L-TOST', 'kg', 1.6, 1.6, 24000, 1],
];
const skus = skuRows.map(([id, name, family, businessUnit, brand, lineId, productiveUnit, ppc, kgpc, cost]) => ({
  id, sapMaterial: `9${id.slice(3).padStart(6, '0')}`, name, family, businessUnit, brand, lineId,
  commercialUnit: 'caja', productiveUnit, productiveUnitsPerCommercial: ppc, kgPerCommercial: kgpc, costPerCommercial: cost,
}));
const weightOf = Object.fromEntries(skuRows.map((r) => [r[0], r[10]]));

// Utilización objetivo de cada línea sobre 80 h nominales/semana (Barras queda sobrecargada a propósito).
const targetUtil = { 'L-PONQ': 0.78, 'L-BARR': 1.1, 'L-MINI': 0.55, 'L-CRISP': 0.7, 'L-MAIZ': 0.62, 'L-TOST': 0.45 };
const NOMINAL_WEEK_HOURS = 80;
const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

const weeks = [];
for (let i = 0; i < 13; i++) {
  const d = new Date(Date.UTC(2026, 9, 5 + i * 7));
  weeks.push(d.toISOString().slice(0, 10));
}

const versions = [
  { id: 'V-PBO-2026-10', kind: 'PBO_MONTHLY', label: 'PBO octubre 2026 (sint.)', createdAt: '2026-09-28T14:00:00Z', createdByRole: 'demand' },
  { id: 'V-N1-2026-W40', kind: 'WEEKLY_N1', label: 'Recálculo semanal N+1 sem. 40 (sint.)', createdAt: '2026-09-30T14:00:00Z', createdByRole: 'demand', basedOn: 'V-PBO-2026-10' },
];

const baseQty = (sku, weekIdx) => {
  const line = lines.find((l) => l.id === sku.lineId);
  const lineProdPerWeek = targetUtil[line.id] * NOMINAL_WEEK_HOURS * line.rate.value;
  const ramp = weekIdx >= 8 ? 1.12 : 1; // rampa de temporada desde diciembre
  return (lineProdPerWeek * weightOf[sku.id] * ramp) / sku.productiveUnitsPerCommercial;
};

const demand = [];
const push = (versionId, skuId, weekStart, flow, qty) =>
  demand.push({ versionId, skuId, weekStart, flow, commercialQty: Math.round(qty) });

skus.forEach((sku) => {
  weeks.forEach((w, i) => {
    const base = baseQty(sku, i);
    push('V-PBO-2026-10', sku.id, w, 'CEDI', base);
    if (i < 8) push('V-N1-2026-W40', sku.id, w, 'CEDI', base * (0.92 + rnd() * 0.16));
    // Hard Discount (make-to-order): ponqué chocolate y maicitos, semanas alternas, ~6 % de la base.
    if (['SK-001', 'SK-007'].includes(sku.id) && i % 2 === 1) {
      push('V-PBO-2026-10', sku.id, w, 'HARD_DISCOUNT', base * 0.06);
      if (i < 8) push('V-N1-2026-W40', sku.id, w, 'HARD_DISCOUNT', base * 0.06 * (0.9 + rnd() * 0.2));
    }
    // Exportaciones (make-to-order): ponqué vainilla y crispetas, cada 4 semanas, ~5 %.
    if (['SK-002', 'SK-006'].includes(sku.id) && i % 4 === 2) {
      push('V-PBO-2026-10', sku.id, w, 'EXPORT', base * 0.05);
      if (i < 8) push('V-N1-2026-W40', sku.id, w, 'EXPORT', base * 0.05);
    }
  });
});

const buildingBlocks = [
  { id: 'BB-001', versionId: 'V-N1-2026-W40', scope: { skuId: 'SK-001', weekStart: '2026-10-19', flow: 'CEDI' }, deltaCommercialQty: 3000, reason: 'Promoción de temporada en canal tradicional (sint.)', author: 'Planeador Demanda (sint.)', role: 'demand', createdAt: '2026-09-30T15:10:00Z' },
  { id: 'BB-002', versionId: 'V-N1-2026-W40', scope: { family: 'Barras', weekStart: '2026-10-26' }, deltaCommercialQty: -1500, reason: 'Cliente pospone pedido al siguiente mes (sint.)', author: 'Planeador Distribución (sint.)', role: 'distribution', createdAt: '2026-09-30T16:00:00Z' },
  { id: 'BB-003', versionId: 'V-N1-2026-W40', scope: { skuId: 'SK-008', weekStart: '2026-11-02' }, deltaCommercialQty: 800, reason: 'Reposición por quiebre de inventario en agencias (sint.)', author: 'Planeador Demanda (sint.)', role: 'demand', createdAt: '2026-10-01T09:00:00Z' },
];

// Inventario al corte: ~1 semana de demanda base (Barras casi sin colchón, para mantener su sobrecarga). Órdenes abiertas: ponqués y maicitos en las 2 primeras semanas.
const inventory = skus.map((s) => ({ skuId: s.id, onHandCommercial: Math.round(baseQty(s, 0) * (['SK-003', 'SK-004'].includes(s.id) ? 0.03 : 1.0)) }));
const openOrders = [];
for (const id of ['SK-001', 'SK-002', 'SK-007']) {
  const s = skus.find((x) => x.id === id);
  weeks.slice(0, 2).forEach((w, i) => openOrders.push({ skuId: id, weekStart: w, commercialQty: Math.round(baseQty(s, i) * 0.2) }));
}

// Red de distribución: planta → CEDI → 4 agencias. Participaciones y capacidades inventadas (se afinan con datos reales de Diana).
const nodes = [
  { id: 'N-CEDI', name: 'CEDI principal (sint.)', type: 'CEDI', leadTimeWeeks: 1, demandShare: 0.3, inventoryShare: 0.4, priority: 'NORMAL', minCoverDays: 0, storageCapacity: 400000 },
  { id: 'N-A1', name: 'Agencia 1 · canal moderno (sint.)', type: 'AGENCY', parentId: 'N-CEDI', leadTimeWeeks: 0, demandShare: 0.25, inventoryShare: 0.15, priority: 'HIGH', minCoverDays: 4, storageCapacity: 90000 },
  { id: 'N-A2', name: 'Agencia 2 (sint.)', type: 'AGENCY', parentId: 'N-CEDI', leadTimeWeeks: 0, demandShare: 0.18, inventoryShare: 0.15, priority: 'NORMAL', minCoverDays: 2, storageCapacity: 70000 },
  { id: 'N-A3', name: 'Agencia 3 · ciudad lejana (sint.)', type: 'AGENCY', parentId: 'N-CEDI', leadTimeWeeks: 1, demandShare: 0.15, inventoryShare: 0.15, priority: 'NORMAL', minCoverDays: 2, storageCapacity: 60000 },
  { id: 'N-A4', name: 'Agencia 4 · canal tradicional (sint.)', type: 'AGENCY', parentId: 'N-CEDI', leadTimeWeeks: 1, demandShare: 0.12, inventoryShare: 0.15, priority: 'LOW', minCoverDays: 1, storageCapacity: 45000 },
];

// Materiales, lista de materiales y órdenes de compra (todo ficticio). Las mezclas (MX-*) son ítems de paso de la "planta secreta".
const L = (parentId, componentId, quantityPer, scrapPct = 0) => ({ parentId, componentId, quantityPer, scrapPct });
const bom = [
  // Ponqués (por caja de 24 u)
  L('SK-001', 'MX-PONQ', 0.55), L('SK-001', 'MT-HUEVO', 0.12), L('SK-001', 'MT-ACEITE', 0.05), L('SK-001', 'MT-CACAO', 0.08), L('SK-001', 'MT-FILM-P', 24), L('SK-001', 'MT-CAJA-A', 1),
  L('SK-002', 'MX-PONQ', 0.55), L('SK-002', 'MT-HUEVO', 0.12), L('SK-002', 'MT-ACEITE', 0.05), L('SK-002', 'MT-VAINILLA', 0.01), L('SK-002', 'MT-FILM-P', 24), L('SK-002', 'MT-CAJA-A', 1),
  // Barras (por caja de 24 u)
  L('SK-003', 'MX-BARRA', 0.3), L('SK-003', 'MT-JARABE', 0.1), L('SK-003', 'MT-FILM-B', 24), L('SK-003', 'MT-CAJA-A', 1),
  L('SK-004', 'MX-BARRA', 0.3), L('SK-004', 'MT-JARABE', 0.12), L('SK-004', 'MT-FILM-B', 24), L('SK-004', 'MT-CAJA-A', 1),
  // Mini (por caja de 30 u)
  L('SK-005', 'MX-PONQ', 0.35), L('SK-005', 'MT-HUEVO', 0.08), L('SK-005', 'MT-CACAO', 0.05), L('SK-005', 'MT-FILM-M', 30), L('SK-005', 'MT-CAJA-B', 1),
  // Snacks (la unidad productiva ya es kg)
  L('SK-006', 'MT-MAIZ', 0.9, 3), L('SK-006', 'MT-ACEITE', 0.12), L('SK-006', 'MT-SAL', 0.02), L('SK-006', 'MT-BOLSA-C', 12), L('SK-006', 'MT-CAJA-B', 1),
  L('SK-007', 'MT-MAIZ', 1.0, 3), L('SK-007', 'MT-ACEITE', 0.1), L('SK-007', 'MT-SAL', 0.03), L('SK-007', 'MT-BOLSA-M', 24), L('SK-007', 'MT-CAJA-B', 1),
  L('SK-008', 'MT-HARINA', 1.0), L('SK-008', 'MT-ACEITE', 0.1), L('SK-008', 'MT-SAL', 0.02), L('SK-008', 'MT-BOLSA-T', 20), L('SK-008', 'MT-CAJA-B', 1),
  // Mezclas (por kg de mezcla)
  L('MX-PONQ', 'MT-HARINA', 0.45), L('MX-PONQ', 'MT-AZUCAR', 0.35, 2), L('MX-PONQ', 'MT-POLVO', 0.02),
  L('MX-BARRA', 'MT-AVENA', 0.5), L('MX-BARRA', 'MT-AZUCAR', 0.3, 2), L('MX-BARRA', 'MT-JARABE', 0.2),
];

// [id, nombre, tipo, unidad, días de stock al corte, plazo (d), colchón (d), múltiplo de pedido, proveedores]
const matRows = [
  ['MT-HARINA', 'Harina de trigo (sint.)', 'RAW', 'kg', 20, 7, 3, 1000, [['Molino Norte', 0.7], ['Molino Sur', 0.3]]],
  ['MT-AZUCAR', 'Azúcar (sint.)', 'RAW', 'kg', 6, 5, 3, 1000, [['Ingenio A', 1]]],
  ['MT-CACAO', 'Cacao importado (sint.)', 'RAW', 'kg', 14, 30, 5, 500, [['Cacao Import 1', 0.6], ['Cacao Import 2', 0.4]]],
  ['MT-HUEVO', 'Huevo líquido (sint.)', 'RAW', 'kg', 3, 2, 1, 200, [['Avícola A', 1]]],
  ['MT-ACEITE', 'Aceite vegetal (sint.)', 'RAW', 'kg', 25, 7, 3, 500, [['Aceites S.A.', 1]]],
  ['MT-VAINILLA', 'Esencia de vainilla (sint.)', 'RAW', 'kg', 40, 20, 5, 25, [['Sabores B', 1]]],
  ['MT-AVENA', 'Avena (sint.)', 'RAW', 'kg', 12, 10, 3, 500, [['Cereales C', 1]]],
  ['MT-JARABE', 'Jarabe de glucosa (sint.)', 'RAW', 'kg', 9, 8, 3, 500, [['Jarabes D', 1]]],
  ['MT-MAIZ', 'Maíz para snacks (sint.)', 'RAW', 'kg', 35, 21, 5, 1000, [['Maíz Import 1', 1]]],
  ['MT-SAL', 'Sal (sint.)', 'RAW', 'kg', 60, 5, 3, 500, [['Salinas E', 1]]],
  ['MT-POLVO', 'Polvo de hornear (sint.)', 'RAW', 'kg', 30, 14, 3, 25, [['Química F', 1]]],
  ['MT-FILM-P', 'Película ponqué (sint.)', 'PACKAGING', 'u', 20, 28, 7, 20000, [['Empaques G', 1]]],
  ['MT-FILM-B', 'Película barra (sint.)', 'PACKAGING', 'u', 45, 28, 7, 20000, [['Empaques G', 1]]],
  ['MT-FILM-M', 'Película mini (sint.)', 'PACKAGING', 'u', 60, 28, 7, 20000, [['Empaques G', 1]]],
  ['MT-BOLSA-C', 'Bolsa crispetas (sint.)', 'PACKAGING', 'u', 10, 21, 7, 10000, [['Plásticos H', 1]]],
  ['MT-BOLSA-M', 'Bolsa maicitos (sint.)', 'PACKAGING', 'u', 40, 21, 7, 10000, [['Plásticos H', 1]]],
  ['MT-BOLSA-T', 'Bolsa tostadas (sint.)', 'PACKAGING', 'u', 26, 21, 7, 10000, [['Plásticos H', 1]]],
  ['MT-CAJA-A', 'Caja corrugada A (sint.)', 'PACKAGING', 'u', 15, 12, 5, 5000, [['Cartones I', 0.5], ['Cartones J', 0.5]]],
  ['MT-CAJA-B', 'Caja corrugada B (sint.)', 'PACKAGING', 'u', 30, 12, 5, 5000, [['Cartones I', 1]]],
  ['MX-PONQ', 'Premezcla ponqué · planta secreta (sint.)', 'MIX', 'kg', 0, 0, 0, 1, []],
  ['MX-BARRA', 'Premezcla barra · planta secreta (sint.)', 'MIX', 'kg', 0, 0, 0, 1, []],
];

// Consumo promedio por día calendario de cada material con la demanda base semanal (para dimensionar el inventario en días de cobertura).
const coefOf = (parent, mult = 1, acc = {}) => {
  for (const b of bom.filter((x) => x.parentId === parent)) {
    const q = mult * b.quantityPer * (1 + b.scrapPct / 100);
    if (b.componentId.startsWith('MX-')) coefOf(b.componentId, q, acc);
    else acc[b.componentId] = (acc[b.componentId] ?? 0) + q;
  }
  return acc;
};
const weeklyUse = {};
skus.forEach((s) => {
  const w = baseQty(s, 0);
  Object.entries(coefOf(s.id)).forEach(([m, q]) => { weeklyUse[m] = (weeklyUse[m] ?? 0) + w * q; });
});
const roundTo = (v, step) => Math.round(v / step) * step;
const materials = matRows.map(([id, name, type, unit, days, leadTimeDays, safetyDays, moq, sup]) => ({
  id, name, type, unit,
  stock: type === 'MIX' ? 0 : roundTo(((weeklyUse[id] ?? 0) / 7) * days, Math.max(1, moq / 10)),
  leadTimeDays, safetyDays, moq,
  suppliers: sup.map(([supplier, share]) => ({ supplier, share })),
}));

// Órdenes de compra abiertas: [material, proveedor, día de llegada desde el corte, días de consumo que cubre]
const poRows = [
  ['MT-CACAO', 'Cacao Import 1', 22, 20], ['MT-MAIZ', 'Maíz Import 1', 18, 21], ['MT-HARINA', 'Molino Norte', 14, 14],
  ['MT-FILM-P', 'Empaques G', 35, 28], ['MT-CAJA-A', 'Cartones I', 9, 10], ['MT-AZUCAR', 'Ingenio A', 5, 7], ['MT-JARABE', 'Jarabes D', 12, 14],
];
const purchaseOrders = poRows.map(([materialId, supplier, offset, cover]) => {
  const m = materials.find((x) => x.id === materialId);
  return { materialId, supplier, dueDate: addDays(weeks[0], offset), qty: roundTo(((weeklyUse[materialId] ?? 0) / 7) * cover, m.moq) };
});

// Historial de órdenes recibidas (12 meses) y solicitudes de pedido abiertas. Todo ficticio.
// Perfiles de entrega: [días extra sobre el plazo planeado (media, desviación), factor de cantidad por orden, nº de órdenes].
// Hay proveedores sistemáticamente tarde (cacao, maíz, películas), un proveedor rápido infrautilizado (Cacao Import 2) y una cuota rota (cacao 60/40 → ~85/15).
const rndH = mulberry32(99);
const gauss = () => (rndH() + rndH() + rndH() - 1.5) * 2;
const profiles = {
  'MT-CACAO|Cacao Import 1': [7, 3, 1, 14], 'MT-CACAO|Cacao Import 2': [-17, 2, 0.5, 5], // proveedor regional rápido (llega en ~13 días aunque SAP promete 30), infrautilizado
  'MT-MAIZ|Maíz Import 1': [5, 2, 1, 12],
  'MT-FILM-P|Empaques G': [6, 3, 1, 10], 'MT-FILM-B|Empaques G': [6, 3, 1, 10], 'MT-FILM-M|Empaques G': [6, 3, 1, 10],
  'MT-HARINA|Molino Norte': [1, 1, 1, 10], 'MT-HARINA|Molino Sur': [0, 1, 0.45, 8],
  'MT-CAJA-A|Cartones I': [0.5, 1, 1, 8], 'MT-CAJA-A|Cartones J': [1, 1, 1, 8],
};
const orderHistory = [];
const CUT = weeks[0];
for (const m of materials.filter((x) => x.type !== 'MIX')) {
  const typical = roundTo(((weeklyUse[m.id] ?? 0) / 7) * 14, m.moq);
  for (const s of m.suppliers) {
    const [extraMean, extraSd, qf, n] = profiles[`${m.id}|${s.supplier}`] ?? [0.3, 1, s.share, Math.max(5, Math.round(12 * s.share))];
    for (let i = 0; i < n; i++) {
      const orderDate = addDays(CUT, -380 + Math.round(((i + 0.5) / n) * 320 + (rndH() - 0.5) * 6));
      const extra = Math.round(extraMean + extraSd * gauss());
      const actual = Math.max(Math.round(m.leadTimeDays * 0.4), m.leadTimeDays + extra);
      orderHistory.push({
        materialId: m.id, supplier: s.supplier, orderDate,
        promisedDate: addDays(orderDate, m.leadTimeDays), receivedDate: addDays(orderDate, actual),
        qty: Math.max(m.moq, roundTo(typical * qf * (0.8 + rndH() * 0.4), m.moq)),
      });
    }
  }
}
orderHistory.sort((a, b) => a.orderDate.localeCompare(b.orderDate) || a.materialId.localeCompare(b.materialId));
const typicalOf = (id) => roundTo(((weeklyUse[id] ?? 0) / 7) * 14, materials.find((x) => x.id === id).moq);
const requisitions = [
  { id: 'SP-1001', materialId: 'MT-CAJA-A', qty: 195000, neededDate: addDays(CUT, 10), createdAt: addDays(CUT, -3) }, // posible duplicado de la OC de 200.000 del 14 oct
  { id: 'SP-1002', materialId: 'MT-SAL', qty: typicalOf('MT-SAL') * 12, neededDate: addDays(CUT, 25), createdAt: addDays(CUT, -2) }, // cantidad atípica
  { id: 'SP-1003', materialId: 'MT-ACEITE', qty: typicalOf('MT-ACEITE'), neededDate: addDays(CUT, 20), createdAt: addDays(CUT, -1) }, // normal
  { id: 'SP-1004', materialId: 'MT-VAINILLA', qty: typicalOf('MT-VAINILLA'), neededDate: addDays(CUT, 30), createdAt: addDays(CUT, -1) }, // normal
];

const dataset = { synthetic: true, plants, crews, lines, calendars, skus, versions, demand, buildingBlocks, inventory, openOrders, nodes, materials, bom, purchaseOrders, orderHistory, requisitions };
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(dataset, null, 2) + '\n');
console.log(`dataset.json: ${skus.length} SKUs, ${lines.length} líneas, ${demand.length} filas de demanda`);
