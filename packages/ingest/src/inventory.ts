import { parseDate, parseNumber, parseTime } from './csv';
import {
  ColumnSpec, IngestContext, IngestIssue, ParseResult, cell, dateOf, minusDays, minusYears, readTable, skuIndex, stamp, toCommercial,
  normalizeMaterial,
} from './common';

export interface StockRow {
  line: number;
  skuId: string;
  centro: string;
  almacen: string;
  qty: number;
  unit: string;
  commercialQty: number;
}

export interface MovementRow {
  line: number;
  skuId: string;
  date: string;
  time: string | null;
  centro: string;
  almacen: string;
  movementClass: string;
  documento: string;
  /** Con signo: entradas positivas, salidas negativas. */
  commercialQty: number;
}

type StockField = 'material' | 'centro' | 'almacen' | 'unidad' | 'cantidad' | 'fecha';
const STOCK_SPECS: ColumnSpec<StockField>[] = [
  { field: 'material', aliases: ['Material', 'Código material', 'MATNR', 'Nº material'], required: true },
  { field: 'centro', aliases: ['Centro', 'WERKS'], required: false },
  { field: 'almacen', aliases: ['Almacén', 'Almacen', 'LGORT'], required: false },
  { field: 'unidad', aliases: ['UM', 'Unidad', 'Unidad medida', 'UMB', 'MEINS'], required: true },
  { field: 'cantidad', aliases: ['Libre utilización', 'Stock', 'Cantidad', 'Stock libre', 'LABST'], required: true },
  { field: 'fecha', aliases: ['Fecha corte', 'Fecha', 'Fecha de stock'], required: false },
];

/** Base 1a — Inventarios: foto de stock al corte (lunes ~8 am). */
export function parseStock(text: string, ctx: IngestContext): ParseResult<StockRow> {
  const m = readTable('stock', text, STOCK_SPECS);
  const issues: IngestIssue[] = [...m.issues];
  const rows: StockRow[] = [];
  if (!m.ok) return { rows, issues, ok: false };

  const skus = skuIndex(ctx.dataset);
  const seen = new Set<string>();
  const cutDate = dateOf(ctx.cutAt);
  const warn = (severity: IngestIssue['severity'], code: string, line: number, message: string) =>
    issues.push({ severity, base: 'stock', code, line, message });

  for (const { line, cells } of m.table.rows) {
    const sku = skus.get(normalizeMaterial(cell(m, cells, 'material')));
    if (!sku) { warn('warning', 'UNKNOWN_MATERIAL', line, `Material fuera del catálogo del piloto: ${cell(m, cells, 'material')}`); continue; }

    const centro = cell(m, cells, 'centro');
    if (ctx.plantCenters && centro && !ctx.plantCenters.includes(centro)) continue;

    const qty = parseNumber(cell(m, cells, 'cantidad'), ctx.decimal);
    if (qty === null) { warn('error', 'BAD_NUMBER', line, `Cantidad no numérica: "${cell(m, cells, 'cantidad')}"`); continue; }
    if (qty < 0) { warn('error', 'NEGATIVE_STOCK', line, `Stock negativo (${qty}) en ${sku.id}`); continue; }

    const unit = cell(m, cells, 'unidad');
    const commercialQty = toCommercial(sku, qty, unit);
    if (commercialQty === null) { warn('error', 'UNKNOWN_UNIT', line, `Unidad "${unit}" no convertible para ${sku.id}`); continue; }

    const fecha = cell(m, cells, 'fecha');
    if (fecha) {
      const d = parseDate(fecha);
      if (!d) { warn('error', 'BAD_DATE', line, `Fecha inválida: "${fecha}"`); continue; }
      if (d !== cutDate) warn('warning', 'SNAPSHOT_DATE_MISMATCH', line, `La foto de stock es del ${d} pero el corte es ${cutDate}`);
    }

    const almacen = cell(m, cells, 'almacen');
    const key = `${sku.id}|${centro}|${almacen}`;
    if (seen.has(key)) { warn('error', 'DUPLICATE_STOCK_ROW', line, `Fila repetida de stock: ${sku.id} / ${centro || '—'} / ${almacen || '—'}`); continue; }
    seen.add(key);

    rows.push({ line, skuId: sku.id, centro, almacen, qty, unit, commercialQty });
  }
  if (rows.length === 0) issues.push({ severity: 'error', base: 'stock', code: 'NO_VALID_ROWS', message: 'Ninguna fila de stock quedó válida' });
  return { rows, issues, ok: rows.length > 0 };
}

type MovField = 'fecha' | 'hora' | 'material' | 'centro' | 'almacen' | 'clase' | 'cantidad' | 'unidad' | 'documento';
const MOV_SPECS: ColumnSpec<MovField>[] = [
  { field: 'fecha', aliases: ['Fecha contabilización', 'Fecha contab', 'Fecha', 'BUDAT'], required: true },
  { field: 'hora', aliases: ['Hora', 'Hora entrada', 'CPUTM'], required: false },
  { field: 'material', aliases: ['Material', 'Código material', 'MATNR'], required: true },
  { field: 'centro', aliases: ['Centro', 'WERKS'], required: false },
  { field: 'almacen', aliases: ['Almacén', 'Almacen', 'LGORT'], required: false },
  { field: 'clase', aliases: ['Clase movimiento', 'Clase mov', 'CMv', 'BWART'], required: false },
  { field: 'cantidad', aliases: ['Cantidad', 'Cantidad con signo', 'MENGE'], required: true },
  { field: 'unidad', aliases: ['UM', 'Unidad', 'UMB', 'MEINS'], required: true },
  { field: 'documento', aliases: ['Documento material', 'Doc material', 'Documento', 'MBLNR'], required: false },
];

/** Base 1b — Inventarios: movimientos del último mes (cantidad con signo: entradas +, salidas −). */
export function parseMovements(text: string, ctx: IngestContext): ParseResult<MovementRow> {
  const m = readTable('movimientos', text, MOV_SPECS);
  const issues: IngestIssue[] = [...m.issues];
  const rows: MovementRow[] = [];
  if (!m.ok) return { rows, issues, ok: false };

  const skus = skuIndex(ctx.dataset);
  const cutDate = dateOf(ctx.cutAt);
  const staleBefore = minusYears(cutDate, ctx.staleYears ?? 2);
  const windowStart = minusDays(cutDate, ctx.movementWindowDays ?? 31);
  const seen = new Set<string>();
  const warn = (severity: IngestIssue['severity'], code: string, line: number, message: string) =>
    issues.push({ severity, base: 'movimientos', code, line, message });

  for (const { line, cells } of m.table.rows) {
    const sku = skus.get(normalizeMaterial(cell(m, cells, 'material')));
    if (!sku) { warn('warning', 'UNKNOWN_MATERIAL', line, `Material fuera del catálogo del piloto: ${cell(m, cells, 'material')}`); continue; }

    const date = parseDate(cell(m, cells, 'fecha'));
    if (!date) { warn('error', 'BAD_DATE', line, `Fecha inválida: "${cell(m, cells, 'fecha')}"`); continue; }
    const rawTime = cell(m, cells, 'hora');
    const time = rawTime ? parseTime(rawTime) : null;
    if (rawTime && !time) { warn('error', 'BAD_TIME', line, `Hora inválida: "${rawTime}"`); continue; }

    if (date < staleBefore) { warn('warning', 'STALE_ROW', line, `Movimiento de ${date}, anterior al recorte de ${ctx.staleYears ?? 2} años`); continue; }
    if (stamp(date, time) > ctx.cutAt) { warn('warning', 'FUTURE_ROW', line, `Movimiento posterior al corte (${date} ${time ?? ''})`.trim()); continue; }
    if (date < windowStart) { warn('warning', 'OUT_OF_WINDOW', line, `Movimiento de ${date} fuera de la ventana de ${ctx.movementWindowDays ?? 31} días`); continue; }

    const qty = parseNumber(cell(m, cells, 'cantidad'), ctx.decimal);
    if (qty === null) { warn('error', 'BAD_NUMBER', line, `Cantidad no numérica: "${cell(m, cells, 'cantidad')}"`); continue; }
    const unit = cell(m, cells, 'unidad');
    const commercialQty = toCommercial(sku, qty, unit);
    if (commercialQty === null) { warn('error', 'UNKNOWN_UNIT', line, `Unidad "${unit}" no convertible para ${sku.id}`); continue; }

    const documento = cell(m, cells, 'documento');
    const movementClass = cell(m, cells, 'clase');
    if (documento) {
      const key = `${documento}|${sku.id}|${movementClass}|${qty}|${date}`;
      if (seen.has(key)) { warn('warning', 'DUPLICATE_MOVEMENT', line, `Movimiento repetido (doc. ${documento}, ${sku.id})`); continue; }
      seen.add(key);
    }

    rows.push({ line, skuId: sku.id, date, time, centro: cell(m, cells, 'centro'), almacen: cell(m, cells, 'almacen'), movementClass, documento, commercialQty });
  }
  if (rows.length === 0) issues.push({ severity: 'error', base: 'movimientos', code: 'NO_VALID_ROWS', message: 'Ningún movimiento quedó válido' });
  return { rows, issues, ok: rows.length > 0 };
}
