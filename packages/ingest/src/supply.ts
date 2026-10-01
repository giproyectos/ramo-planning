import { parseDate, parseNumber, parseTime } from './csv';
import {
  ColumnSpec, IngestContext, IngestIssue, ParseResult, cell, dateOf, minusYears, normalizeMaterial, readTable, skuIndex, stamp, toCommercial,
} from './common';

export interface SupplyRow {
  line: number;
  skuId: string;
  date: string;
  time: string | null;
  origen: string;
  destino: string;
  referencia: string;
  commercialQty: number;
}

export interface Shipment {
  skuId: string;
  referencia: string;
  commercialQty: number;
  /** El envío ya llegó a un destino final (nacionalización / customer). */
  delivered: boolean;
  lastDestino: string;
  legs: number;
}

export interface SupplyAnalysis {
  shipments: Shipment[];
  /** Cajas contadas más de una vez por registrar el mismo movimiento en varios tramos. */
  doubleCountedBySku: Record<string, number>;
  inTransitBySku: Record<string, number>;
  issues: IngestIssue[];
}

type SupField = 'fecha' | 'hora' | 'material' | 'origen' | 'destino' | 'cantidad' | 'unidad' | 'referencia';
const SUP_SPECS: ColumnSpec<SupField>[] = [
  { field: 'fecha', aliases: ['Fecha', 'Fecha contabilización', 'BUDAT'], required: true },
  { field: 'hora', aliases: ['Hora', 'CPUTM'], required: false },
  { field: 'material', aliases: ['Material', 'Código material', 'MATNR'], required: true },
  { field: 'origen', aliases: ['Centro origen', 'Origen', 'Almacén origen', 'Almacen origen'], required: true },
  { field: 'destino', aliases: ['Centro destino', 'Destino', 'Almacén destino', 'Almacen destino'], required: true },
  { field: 'cantidad', aliases: ['Cantidad', 'MENGE'], required: true },
  { field: 'unidad', aliases: ['UM', 'Unidad', 'MEINS'], required: true },
  { field: 'referencia', aliases: ['Referencia', 'Documento', 'Doc referencia', 'Nº envío', 'Envio'], required: true },
];

/** Base 2 — Abastecimiento: movimientos de triangulación en zona franca (producción → recibo logística → nacionalización). */
export function parseSupply(text: string, ctx: IngestContext): ParseResult<SupplyRow> {
  const m = readTable('abastecimiento', text, SUP_SPECS);
  const issues: IngestIssue[] = [...m.issues];
  const rows: SupplyRow[] = [];
  if (!m.ok) return { rows, issues, ok: false };

  const skus = skuIndex(ctx.dataset);
  const cutDate = dateOf(ctx.cutAt);
  const staleBefore = minusYears(cutDate, ctx.staleYears ?? 2);
  const warn = (severity: IngestIssue['severity'], code: string, line: number, message: string) =>
    issues.push({ severity, base: 'abastecimiento', code, line, message });

  for (const { line, cells } of m.table.rows) {
    const sku = skus.get(normalizeMaterial(cell(m, cells, 'material')));
    if (!sku) { warn('warning', 'UNKNOWN_MATERIAL', line, `Material fuera del catálogo del piloto: ${cell(m, cells, 'material')}`); continue; }
    const date = parseDate(cell(m, cells, 'fecha'));
    if (!date) { warn('error', 'BAD_DATE', line, `Fecha inválida: "${cell(m, cells, 'fecha')}"`); continue; }
    const rawTime = cell(m, cells, 'hora');
    const time = rawTime ? parseTime(rawTime) : null;
    if (rawTime && !time) { warn('error', 'BAD_TIME', line, `Hora inválida: "${rawTime}"`); continue; }
    if (date < staleBefore) { warn('warning', 'STALE_ROW', line, `Movimiento de ${date}, anterior al recorte`); continue; }
    if (stamp(date, time) > ctx.cutAt) { warn('warning', 'FUTURE_ROW', line, `Movimiento posterior al corte (${date})`); continue; }

    const qty = parseNumber(cell(m, cells, 'cantidad'), ctx.decimal);
    if (qty === null || qty <= 0) { warn('error', 'BAD_NUMBER', line, `Cantidad inválida: "${cell(m, cells, 'cantidad')}"`); continue; }
    const unit = cell(m, cells, 'unidad');
    const commercialQty = toCommercial(sku, qty, unit);
    if (commercialQty === null) { warn('error', 'UNKNOWN_UNIT', line, `Unidad "${unit}" no convertible para ${sku.id}`); continue; }
    const referencia = cell(m, cells, 'referencia');
    if (!referencia) { warn('error', 'MISSING_REFERENCE', line, 'Movimiento sin referencia: no se puede netear el doble conteo'); continue; }

    rows.push({ line, skuId: sku.id, date, time, origen: cell(m, cells, 'origen'), destino: cell(m, cells, 'destino'), referencia, commercialQty });
  }
  if (rows.length === 0) issues.push({ severity: 'error', base: 'abastecimiento', code: 'NO_VALID_ROWS', message: 'Ningún movimiento de abastecimiento quedó válido' });
  return { rows, issues, ok: rows.length > 0 };
}

/**
 * Agrupa los tramos por (SKU, referencia). Un mismo envío registrado en varios tramos con igual cantidad se cuenta una sola vez
 * (neteo del movimiento contado dos veces). El envío está "en tránsito" mientras ningún tramo llegue a un destino final.
 */
export function analyzeSupply(rows: SupplyRow[], finalDestinations: string[]): SupplyAnalysis {
  const issues: IngestIssue[] = [];
  const groups = new Map<string, SupplyRow[]>();
  for (const r of rows) {
    const k = `${r.skuId}|${r.referencia}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }

  const shipments: Shipment[] = [];
  const doubleCountedBySku: Record<string, number> = {};
  const inTransitBySku: Record<string, number> = {};

  for (const legs of groups.values()) {
    legs.sort((a, b) => stamp(a.date, a.time).localeCompare(stamp(b.date, b.time)));
    const first = legs[0];
    const last = legs[legs.length - 1];
    const sameQty = legs.every((l) => l.commercialQty === first.commercialQty);
    if (!sameQty) {
      issues.push({ severity: 'warning', base: 'abastecimiento', code: 'QTY_MISMATCH', line: first.line, message: `La referencia ${first.referencia} tiene tramos con cantidades distintas; se usa la del primer tramo` });
    } else if (legs.length > 1) {
      doubleCountedBySku[first.skuId] = (doubleCountedBySku[first.skuId] ?? 0) + first.commercialQty * (legs.length - 1);
      issues.push({ severity: 'info', base: 'abastecimiento', code: 'DOUBLE_COUNT', line: first.line, message: `Referencia ${first.referencia}: ${legs.length} tramos con la misma cantidad; se cuenta una sola vez` });
    }
    const delivered = legs.some((l) => finalDestinations.includes(l.destino));
    shipments.push({ skuId: first.skuId, referencia: first.referencia, commercialQty: first.commercialQty, delivered, lastDestino: last.destino, legs: legs.length });
    if (!delivered) inTransitBySku[first.skuId] = (inTransitBySku[first.skuId] ?? 0) + first.commercialQty;
  }
  return { shipments, doubleCountedBySku, inTransitBySku, issues };
}
