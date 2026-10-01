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
  { id: 'P1', name: 'Planta 1 (sint.)' },
  { id: 'P2', name: 'Planta 2 (sint.)' },
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

const dataset = { synthetic: true, plants, crews, lines, calendars, skus, versions, demand, buildingBlocks };
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(dataset, null, 2) + '\n');
console.log(`dataset.json: ${skus.length} SKUs, ${lines.length} líneas, ${demand.length} filas de demanda`);
