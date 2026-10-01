// Genera archivos sintéticos con la FORMA SUPUESTA de las 3 bases SAP del lunes (ver docs/formatos-bases-sap.md).
// Salida: data/synthetic/sap/limpio/*.csv (sin defectos) y data/synthetic/sap/sucio/*.csv (con defectos inyectados).
// Formato supuesto: separador ';', decimal con coma, fechas DD.MM.YYYY, material con ceros a la izquierda.
// Uso: node scripts/generate-synthetic-sap.mjs   (requiere data/synthetic/dataset.json: npm run synthetic)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ds = JSON.parse(readFileSync(resolve(root, 'data/synthetic/dataset.json'), 'utf8'));

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(7);

const CUT_DATE = '2026-10-05';
const pad = (m) => m.padStart(18, '0');
const ddmmyyyy = (iso) => iso.split('-').reverse().join('.');
const num = (n, dec = 0) => {
  const [i, d] = Math.abs(n).toFixed(dec).split('.');
  return (n < 0 ? '-' : '') + i.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (d ? ',' + d : '');
};
const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// Cada SKU se reporta en la unidad que usaría SAP: la mayoría en cajas, Mini en unidades y Crispetas en kg (prueba de conversión).
const unitOf = (s) => (s.id === 'SK-005' ? 'UN' : s.id === 'SK-006' ? 'KG' : 'CJ');
const toUnit = (s, cajas) => (unitOf(s) === 'UN' ? cajas * s.productiveUnitsPerCommercial : unitOf(s) === 'KG' ? cajas * s.kgPerCommercial : cajas);
const dec = (s) => (unitOf(s) === 'KG' ? 2 : 0);
const centro = (s) => (ds.lines.find((l) => l.id === s.lineId).plantId === 'P1' ? '1000' : '2000');

const invBy = Object.fromEntries(ds.inventory.map((i) => [i.skuId, i.onHandCommercial]));
const weekDemand = (s) => ds.demand.filter((d) => d.versionId === 'V-PBO-2026-10' && d.skuId === s.id && d.weekStart === '2026-10-05' && d.flow === 'CEDI').reduce((a, d) => a + d.commercialQty, 0);

const SEP = ';';
const line = (cells) => cells.join(SEP);

// ---------- Inventarios: foto de stock ----------
const stockHeader = line(['Material', 'Centro', 'Almacén', 'UM', 'Libre utilización', 'Fecha corte']);
const stock = [];
ds.skus.forEach((s) => {
  const total = invBy[s.id];
  const parts = ['SK-001', 'SK-007'].includes(s.id) ? [['0001', 0.7], ['0002', 0.3]] : [['0001', 1]];
  parts.forEach(([alm, p]) => stock.push([pad(s.sapMaterial), centro(s), alm, unitOf(s), num(toUnit(s, total * p), dec(s)), ddmmyyyy(CUT_DATE)]));
});

// ---------- Inventarios: movimientos del último mes (cantidad con signo) ----------
const movHeader = line(['Fecha contabilización', 'Hora', 'Material', 'Centro', 'Almacén', 'Clase movimiento', 'Cantidad', 'UM', 'Documento material']);
const movs = [];
let doc = 4900000000;
const workdays = [];
for (let d = addDays(CUT_DATE, -28); d < CUT_DATE; d = addDays(d, 1)) {
  const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
  if (wd >= 1 && wd <= 5) workdays.push(d);
}
ds.skus.forEach((s) => {
  const daily = weekDemand(s) / 5;
  workdays.forEach((d) => {
    const prod = daily * (0.9 + rnd() * 0.2);
    const out = prod * 1.02; // salen un poco más de lo que entra → el stock inicial implícito es mayor que el del corte
    movs.push([ddmmyyyy(d), '06:30', pad(s.sapMaterial), centro(s), '0001', '101', num(toUnit(s, prod), dec(s)), unitOf(s), String(doc++)]);
    movs.push([ddmmyyyy(d), '15:10', pad(s.sapMaterial), centro(s), '0001', '601', num(-toUnit(s, out), dec(s)), unitOf(s), String(doc++)]);
  });
});

// ---------- Abastecimiento: triangulación en zona franca ----------
const supHeader = line(['Fecha', 'Hora', 'Material', 'Centro origen', 'Centro destino', 'Cantidad', 'UM', 'Referencia']);
const sup = [];
let ref = 8100000;
for (const id of ['SK-002', 'SK-006']) {
  const s = ds.skus.find((x) => x.id === id);
  [[-9, true], [-7, true], [-2, false], [-1, false]].forEach(([off, completed], i) => {
    const q = toUnit(s, 800 + i * 150);
    const r = String(ref++);
    const d = addDays(CUT_DATE, off);
    sup.push([ddmmyyyy(d), '10:00', pad(s.sapMaterial), centro(s), '0004', num(q, dec(s)), unitOf(s), r]);
    // Mismo movimiento registrado de nuevo al nacionalizar: se cuenta dos veces si no se netea.
    if (completed) sup.push([ddmmyyyy(addDays(d, 1)), '09:00', pad(s.sapMaterial), '0004', '0060', num(q, dec(s)), unitOf(s), r]);
  });
}

// ---------- Trazabilidad de despachos (consulta Z) ----------
const dispHeader = line(['Pedido', 'Posición', 'Material', 'Cliente', 'Cantidad pedida', 'Cantidad entregada', 'UM', 'Fecha entrega', 'Hora entrega']);
const disp = [];
let ped = 4500001000;
for (let i = 0; i < 24; i++) {
  const s = ds.skus[Math.floor(rnd() * ds.skus.length)];
  const ordered = Math.round(200 + rnd() * 1800);
  const frac = [0, 0.5, 1][Math.floor(rnd() * 3)];
  const hour = 7 + Math.floor(rnd() * 11); // 07:00–17:59: parte cae fuera de la ventana 8 am–2 pm
  disp.push([String(ped + i), '10', pad(s.sapMaterial), `CLI-${100 + (i % 7)}`, num(toUnit(s, ordered), dec(s)), num(toUnit(s, ordered * frac), dec(s)), unitOf(s), ddmmyyyy(CUT_DATE), `${String(hour).padStart(2, '0')}:${i % 2 ? '30' : '00'}`]);
}

const write = (dir, name, header, rows, bom = false) => {
  mkdirSync(resolve(root, 'data/synthetic/sap', dir), { recursive: true });
  writeFileSync(resolve(root, 'data/synthetic/sap', dir, name), (bom ? '﻿' : '') + [header, ...rows.map(line)].join('\n') + '\n');
};

write('limpio', 'inventarios_stock.csv', stockHeader, stock, true);
write('limpio', 'inventarios_movimientos.csv', movHeader, movs);
write('limpio', 'abastecimiento.csv', supHeader, sup);
write('limpio', 'despachos.csv', dispHeader, disp);

// ---------- Versión "sucia": mismos archivos con defectos inyectados ----------
const sk1 = ds.skus[0];
const sk3 = ds.skus[2];
const badStock = [
  ...stock,
  [pad('9999999'), '1000', '0001', 'CJ', '100', ddmmyyyy(CUT_DATE)], // material fuera del catálogo
  [pad(ds.skus[3].sapMaterial), '1000', '0009', 'CJ', 'abc', ddmmyyyy(CUT_DATE)], // cantidad no numérica
  [pad(ds.skus[4].sapMaterial), '1000', '0009', 'CJ', '-50', ddmmyyyy(CUT_DATE)], // stock negativo
  [pad(sk1.sapMaterial), centro(sk1), '0001', 'CJ', '10', ddmmyyyy(CUT_DATE)], // fila repetida
  [pad(ds.skus[7].sapMaterial), '2000', '0009', 'XX', '10', ddmmyyyy(CUT_DATE)], // unidad desconocida
];
const badMovs = [
  ...movs,
  [ddmmyyyy('2023-01-10'), '06:30', pad(sk3.sapMaterial), '1000', '0001', '101', '10', 'CJ', '4000000001'], // anterior al recorte de 2 años
  [ddmmyyyy('2026-10-06'), '06:30', pad(sk3.sapMaterial), '1000', '0001', '101', '10', 'CJ', '4000000002'], // posterior al corte
  [ddmmyyyy('2026-08-01'), '06:30', pad(sk3.sapMaterial), '1000', '0001', '101', '10', 'CJ', '4000000003'], // fuera de la ventana de 1 mes
  movs[0], // documento repetido
  [ddmmyyyy('2026-10-02'), '06:30', pad(sk3.sapMaterial), '1000', '0001', '101', '900.000', 'CJ', '4000000004'], // entrada enorme: apertura implícita negativa
];
const badSup = [
  ...sup,
  [ddmmyyyy('2026-10-02'), '10:00', pad(ds.skus[1].sapMaterial), '1000', '0004', '100', 'CJ', ''], // sin referencia
  [ddmmyyyy('2026-10-01'), '10:00', pad(ds.skus[1].sapMaterial), '1000', '0004', '100', 'CJ', 'MISMATCH'],
  [ddmmyyyy('2026-10-02'), '10:00', pad(ds.skus[1].sapMaterial), '0004', '0060', '90', 'CJ', 'MISMATCH'], // cantidades distintas entre tramos
];
const badDisp = [
  ...disp,
  disp[0], // posición repetida
  ['4500009001', '10', pad(ds.skus[0].sapMaterial), 'CLI-1', '100', '150', 'CJ', ddmmyyyy(CUT_DATE), '09:00'], // entregado > pedido
  ['4500009002', '10', pad(ds.skus[0].sapMaterial), 'CLI-1', '100', '0', 'CJ', '31.02.2026', '09:00'], // fecha imposible
];
write('sucio', 'inventarios_stock.csv', stockHeader, badStock);
write('sucio', 'inventarios_movimientos.csv', movHeader, badMovs);
write('sucio', 'abastecimiento.csv', supHeader, badSup);
write('sucio', 'despachos.csv', dispHeader, badDisp);

console.log(`sap limpio: ${stock.length} stock, ${movs.length} movimientos, ${sup.length} abastecimiento, ${disp.length} despachos`);
