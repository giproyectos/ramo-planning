import { parseDate, parseNumber, parseTime } from './csv';
import {
  ColumnSpec, IngestContext, IngestIssue, ParseResult, cell, dateOf, minusYears, normalizeMaterial, readTable, skuIndex, toCommercial,
} from './common';

export interface DispatchRow {
  line: number;
  pedido: string;
  posicion: string;
  skuId: string;
  cliente: string;
  date: string;
  time: string | null;
  orderedCommercial: number;
  deliveredCommercial: number;
  pendingCommercial: number;
}

type DispField = 'pedido' | 'posicion' | 'material' | 'cliente' | 'pedida' | 'entregada' | 'unidad' | 'fecha' | 'hora';
const DISP_SPECS: ColumnSpec<DispField>[] = [
  { field: 'pedido', aliases: ['Pedido', 'Doc ventas', 'Nº pedido', 'VBELN'], required: true },
  { field: 'posicion', aliases: ['Posición', 'Posicion', 'Pos', 'POSNR'], required: false },
  { field: 'material', aliases: ['Material', 'Código material', 'MATNR'], required: true },
  { field: 'cliente', aliases: ['Cliente', 'Destinatario', 'KUNNR'], required: false },
  { field: 'pedida', aliases: ['Cantidad pedida', 'Pedida', 'Cant pedida', 'KWMENG'], required: true },
  { field: 'entregada', aliases: ['Cantidad entregada', 'Entregada', 'Cant entregada', 'LFIMG'], required: true },
  { field: 'unidad', aliases: ['UM', 'Unidad', 'VRKME'], required: true },
  { field: 'fecha', aliases: ['Fecha entrega', 'Fecha', 'LFDAT'], required: true },
  { field: 'hora', aliases: ['Hora entrega', 'Hora', 'LFUHR'], required: false },
];

/** Base 3 — Trazabilidad de despachos (consulta Z de solo lectura): qué falta por entregar. */
export function parseDispatch(text: string, ctx: IngestContext): ParseResult<DispatchRow> {
  const m = readTable('despachos', text, DISP_SPECS);
  const issues: IngestIssue[] = [...m.issues];
  const rows: DispatchRow[] = [];
  if (!m.ok) return { rows, issues, ok: false };

  const skus = skuIndex(ctx.dataset);
  const staleBefore = minusYears(dateOf(ctx.cutAt), ctx.staleYears ?? 2);
  const seen = new Set<string>();
  const warn = (severity: IngestIssue['severity'], code: string, line: number, message: string) =>
    issues.push({ severity, base: 'despachos', code, line, message });

  for (const { line, cells } of m.table.rows) {
    const sku = skus.get(normalizeMaterial(cell(m, cells, 'material')));
    if (!sku) { warn('warning', 'UNKNOWN_MATERIAL', line, `Material fuera del catálogo del piloto: ${cell(m, cells, 'material')}`); continue; }
    const date = parseDate(cell(m, cells, 'fecha'));
    if (!date) { warn('error', 'BAD_DATE', line, `Fecha inválida: "${cell(m, cells, 'fecha')}"`); continue; }
    const rawTime = cell(m, cells, 'hora');
    const time = rawTime ? parseTime(rawTime) : null;
    if (rawTime && !time) { warn('error', 'BAD_TIME', line, `Hora inválida: "${rawTime}"`); continue; }
    if (date < staleBefore) { warn('warning', 'STALE_ROW', line, `Pedido con entrega ${date}, anterior al recorte`); continue; }

    const ordered = parseNumber(cell(m, cells, 'pedida'), ctx.decimal);
    const delivered = parseNumber(cell(m, cells, 'entregada'), ctx.decimal);
    if (ordered === null || delivered === null || ordered < 0 || delivered < 0) {
      warn('error', 'BAD_NUMBER', line, `Cantidades inválidas: pedida "${cell(m, cells, 'pedida')}", entregada "${cell(m, cells, 'entregada')}"`);
      continue;
    }
    const unit = cell(m, cells, 'unidad');
    const o = toCommercial(sku, ordered, unit);
    const d = toCommercial(sku, delivered, unit);
    if (o === null || d === null) { warn('error', 'UNKNOWN_UNIT', line, `Unidad "${unit}" no convertible para ${sku.id}`); continue; }
    if (d > o) warn('warning', 'OVER_DELIVERED', line, `Entregado (${delivered}) mayor que lo pedido (${ordered}) en el pedido ${cell(m, cells, 'pedido')}`);

    const pedido = cell(m, cells, 'pedido');
    const posicion = cell(m, cells, 'posicion');
    const key = `${pedido}|${posicion}`;
    if (seen.has(key)) { warn('error', 'DUPLICATE_ORDER_LINE', line, `Posición repetida: pedido ${pedido} / ${posicion || '—'}`); continue; }
    seen.add(key);

    rows.push({ line, pedido, posicion, skuId: sku.id, cliente: cell(m, cells, 'cliente'), date, time, orderedCommercial: o, deliveredCommercial: d, pendingCommercial: Math.max(0, o - d) });
  }
  if (rows.length === 0) issues.push({ severity: 'error', base: 'despachos', code: 'NO_VALID_ROWS', message: 'Ninguna posición de despacho quedó válida' });
  return { rows, issues, ok: rows.length > 0 };
}

/** ¿La hora cae en la ventana de la consulta Z (por defecto 08:00–14:00)? Sin hora se asume dentro. */
export function inDispatchWindow(time: string | null, window = { from: '08:00', to: '14:00' }): boolean {
  if (!time) return true;
  return time >= window.from && time < window.to;
}
