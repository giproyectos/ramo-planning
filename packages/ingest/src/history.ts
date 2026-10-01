import { DemandFlow, DemandHistoryRow } from '@ramo/domain';
import { parseDate, parseNumber } from './csv';
import { ColumnSpec, IngestContext, IngestIssue, ParseResult, cell, dateOf, minusYears, normalizeHeader, normalizeMaterial, readTable, skuIndex, toCommercial } from './common';

type HistField = 'material' | 'semana' | 'flujo' | 'cantidad' | 'unidad' | 'pronostico';
const HIST_SPECS: ColumnSpec<HistField>[] = [
  { field: 'material', aliases: ['Material', 'Código material', 'MATNR'], required: true },
  { field: 'semana', aliases: ['Semana', 'Inicio semana', 'Fecha', 'Semana (lunes)'], required: true },
  { field: 'flujo', aliases: ['Flujo', 'Canal', 'Tipo demanda'], required: false },
  { field: 'cantidad', aliases: ['Cantidad', 'Venta', 'Demanda', 'Cantidad real'], required: true },
  { field: 'unidad', aliases: ['UM', 'Unidad'], required: true },
  { field: 'pronostico', aliases: ['Pronóstico vigente', 'Pronostico', 'Pronóstico', 'Forecast', 'Pronóstico anterior'], required: false },
];

const FLOW_ALIASES: Record<string, DemandFlow> = {
  cedi: 'CEDI',
  hd: 'HARD_DISCOUNT',
  harddiscount: 'HARD_DISCOUNT',
  export: 'EXPORT',
  exportacion: 'EXPORT',
  exportaciones: 'EXPORT',
};

const isMonday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay() === 1;
const addWeeks = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n * 7);
  return x.toISOString().slice(0, 10);
};

/** Histórico de demanda semanal (venta real y, si viene, el pronóstico que emitió el proceso vigente). */
export function parseDemandHistory(text: string, ctx: IngestContext): ParseResult<DemandHistoryRow> {
  const m = readTable('historico', text, HIST_SPECS);
  const issues: IngestIssue[] = [...m.issues];
  const rows: DemandHistoryRow[] = [];
  if (!m.ok) return { rows, issues, ok: false };

  const skus = skuIndex(ctx.dataset);
  const staleBefore = minusYears(dateOf(ctx.cutAt), ctx.staleYears ?? 2);
  const seen = new Set<string>();
  const warn = (severity: IngestIssue['severity'], code: string, line: number, message: string) =>
    issues.push({ severity, base: 'historico', code, line, message });

  for (const { line, cells } of m.table.rows) {
    const sku = skus.get(normalizeMaterial(cell(m, cells, 'material')));
    if (!sku) { warn('warning', 'UNKNOWN_MATERIAL', line, `Material fuera del catálogo del piloto: ${cell(m, cells, 'material')}`); continue; }

    const weekStart = parseDate(cell(m, cells, 'semana'));
    if (!weekStart) { warn('error', 'BAD_DATE', line, `Semana inválida: "${cell(m, cells, 'semana')}"`); continue; }
    if (!isMonday(weekStart)) { warn('error', 'WEEK_NOT_MONDAY', line, `La semana debe empezar en lunes: ${weekStart}`); continue; }
    if (weekStart < staleBefore) { warn('warning', 'STALE_ROW', line, `Semana ${weekStart}, anterior al recorte de ${ctx.staleYears ?? 2} años`); continue; }
    if (weekStart >= dateOf(ctx.cutAt)) { warn('warning', 'FUTURE_ROW', line, `Semana ${weekStart} no cerrada al corte`); continue; }

    const rawFlow = cell(m, cells, 'flujo');
    const flow = rawFlow ? FLOW_ALIASES[normalizeHeader(rawFlow)] : 'CEDI';
    if (!flow) { warn('error', 'BAD_FLOW', line, `Flujo desconocido: "${rawFlow}"`); continue; }

    const qty = parseNumber(cell(m, cells, 'cantidad'), ctx.decimal);
    if (qty === null) { warn('error', 'BAD_NUMBER', line, `Cantidad no numérica: "${cell(m, cells, 'cantidad')}"`); continue; }
    if (qty < 0) { warn('error', 'NEGATIVE_QTY', line, `Venta negativa (${qty}) en ${sku.id}`); continue; }
    const unit = cell(m, cells, 'unidad');
    const commercialQty = toCommercial(sku, qty, unit);
    if (commercialQty === null) { warn('error', 'UNKNOWN_UNIT', line, `Unidad "${unit}" no convertible para ${sku.id}`); continue; }

    let priorForecast: number | null = null;
    const rawPrior = cell(m, cells, 'pronostico');
    if (rawPrior) {
      const p = parseNumber(rawPrior, ctx.decimal);
      const pc = p === null ? null : toCommercial(sku, p, unit);
      if (pc === null) { warn('warning', 'BAD_FORECAST', line, `Pronóstico vigente ilegible: "${rawPrior}" (se ignora ese dato)`); } else priorForecast = pc;
    }

    const key = `${sku.id}|${weekStart}|${flow}`;
    if (seen.has(key)) { warn('error', 'DUPLICATE_HISTORY_ROW', line, `Semana repetida: ${sku.id} / ${weekStart} / ${flow}`); continue; }
    seen.add(key);
    rows.push({ skuId: sku.id, weekStart, flow, commercialQty, priorForecast });
  }

  // Huecos en la serie CEDI de cada SKU: el motor los interpola, pero hay que avisarlo.
  const bySku = new Map<string, string[]>();
  for (const r of rows) if (r.flow === 'CEDI') bySku.set(r.skuId, [...(bySku.get(r.skuId) ?? []), r.weekStart]);
  for (const [skuId, weeks] of bySku) {
    weeks.sort();
    const have = new Set(weeks);
    let missing = 0;
    for (let w = weeks[0]; w <= weeks[weeks.length - 1]; w = addWeeks(w, 1)) if (!have.has(w)) missing++;
    if (missing > 0) issues.push({ severity: 'warning', base: 'historico', code: 'MISSING_WEEKS', message: `${skuId}: faltan ${missing} semana(s) en la serie; se interpolan al pronosticar` });
    if (weeks.length < 60) issues.push({ severity: 'warning', base: 'historico', code: 'SHORT_HISTORY', message: `${skuId}: solo ${weeks.length} semanas de historia; los modelos estacionales necesitan al menos 60` });
  }

  if (rows.length === 0) issues.push({ severity: 'error', base: 'historico', code: 'NO_VALID_ROWS', message: 'Ninguna fila de histórico quedó válida' });
  return { rows, issues, ok: rows.length > 0 };
}
