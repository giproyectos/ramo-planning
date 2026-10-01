import { RamoDataset } from '@ramo/domain';
import { dayHours, weekDays } from '@ramo/engine';

/**
 * Órdenes provisionales (previsionales) por planta para cargar con LSMW, y el archivo de borrado de las de la publicación anterior.
 * Reemplaza el cargue manual por planta desde Excel (el automático por archivo plano se rompió con una migración de SAP).
 *
 * IMPORTANTE: el formato de columnas, el tipo de orden (`LA`) y la unidad (`CJ`) son SUPUESTOS. Esto genera archivos para revisión;
 * no se conecta a SAP ni se ha probado contra el cargue real.
 *
 * Una publicación nueva reemplaza a la anterior: se borran las órdenes previas desde la primera semana del nuevo plan, para no
 * duplicar necesidad (la solución de Daniel Rangel era borrar las provisionales cuando entraban las órdenes en firme).
 */
export const ORDERS_HEADER = ['Accion', 'Centro', 'Material', 'Tipo_orden', 'Cantidad', 'UM', 'Fecha_fin', 'Linea', 'Referencia'] as const;
export const ORDER_COLUMNS = ORDERS_HEADER.length;

export type OrderAction = 'CREAR' | 'BORRAR';

export interface ProvisionalOrderRow {
  accion: OrderAction;
  centro: string;
  material: string;
  tipoOrden: string;
  cantidad: number;
  unidad: string;
  /** ISO YYYY-MM-DD (en el archivo sale DD.MM.YYYY). */
  fechaFin: string;
  linea: string;
  referencia: string;
}

export interface PlanRow {
  skuId: string;
  weekStart: string;
  netProduction: number;
}

export interface ProvisionalOrdersOptions {
  releaseId: string;
  /** Tipo de orden (supuesto: 'LA', orden previsional). */
  orderType?: string;
  unit?: string;
  /** Factor sobre la cantidad del plan (Miguel mencionó un "factor de cantidad" por línea); 1 por defecto. */
  quantityFactor?: number;
  /** Órdenes creadas por la publicación anterior; se borran las de fecha ≥ inicio del nuevo plan. */
  priorOrders?: ProvisionalOrderRow[];
}

export interface PlantFile {
  plantId: string;
  center: string;
  kind: 'PROVISIONAL_ORDERS' | 'ORDER_DELETIONS';
  name: string;
  rows: ProvisionalOrderRow[];
  csv: string;
}

export interface OrdersIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
}

export interface ProvisionalOrdersResult {
  files: PlantFile[];
  issues: OrdersIssue[];
  summary: {
    createdRows: number;
    deletedRows: number;
    /** Cajas del plan (con el factor) y cajas realmente escritas; la diferencia es solo redondeo. */
    plannedCommercial: number;
    writtenCommercial: number;
    firstWeek: string | null;
    lastWeek: string | null;
    perPlant: { plantId: string; center: string; rows: number; commercial: number }[];
  };
}

const ddmmyyyy = (iso: string) => iso.split('-').reverse().join('.');
const fromDdmmyyyy = (s: string) => s.split('.').reverse().join('-');
const pad18 = (m: string) => m.padStart(18, '0');

/** DD.MM.YYYY real (Date.parse acepta "31.02" y lo corre a marzo, así que se compara el ida y vuelta). */
function isRealDate(ddmmyyyyText: string): boolean {
  const m = ddmmyyyyText.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) return false;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

export function ordersToCsv(rows: ProvisionalOrderRow[]): string {
  return [ORDERS_HEADER.join(';'), ...rows.map((r) => [r.accion, r.centro, r.material, r.tipoOrden, r.cantidad, r.unidad, ddmmyyyy(r.fechaFin), r.linea, r.referencia].join(';'))].join('\n') + '\n';
}

/** Último día con horas de producción de la línea en esa semana (donde se fecha la orden); null si la semana no tiene capacidad. */
export function lastProductionDay(ds: RamoDataset, lineId: string, weekStart: string): string | null {
  const cal = ds.calendars.find((c) => c.lineId === lineId);
  if (!cal) return null;
  return [...weekDays(weekStart)].reverse().find((d) => dayHours(cal, d) > 0) ?? null;
}

export function buildProvisionalOrders(ds: RamoDataset, plan: PlanRow[], options: ProvisionalOrdersOptions): ProvisionalOrdersResult {
  const orderType = options.orderType ?? 'LA';
  const unit = options.unit ?? 'CJ';
  const factor = options.quantityFactor ?? 1;
  const issues: OrdersIssue[] = [];
  const created: ProvisionalOrderRow[] = [];
  let planned = 0;

  const sorted = [...plan].filter((p) => p.netProduction > 0).sort((a, b) => a.weekStart.localeCompare(b.weekStart) || a.skuId.localeCompare(b.skuId));
  const missingCenter = new Set<string>();
  for (const p of sorted) {
    const sku = ds.skus.find((s) => s.id === p.skuId);
    const line = ds.lines.find((l) => l.id === sku?.lineId);
    const plant = ds.plants.find((x) => x.id === line?.plantId);
    if (!sku || !line || !plant) { issues.push({ severity: 'error', code: 'UNKNOWN_SKU_OR_LINE', message: `${p.skuId}: sin línea o planta en el modelo.` }); continue; }
    if (!plant.sapCenter) {
      if (!missingCenter.has(plant.id)) issues.push({ severity: 'error', code: 'MISSING_CENTER', message: `La planta ${plant.id} no tiene código de centro SAP.` });
      missingCenter.add(plant.id);
      continue;
    }
    const qty = Math.round(p.netProduction * factor);
    planned += p.netProduction * factor;
    if (qty <= 0) continue;
    const date = lastProductionDay(ds, line.id, p.weekStart);
    if (!date) { issues.push({ severity: 'error', code: 'ZERO_CAPACITY_WEEK', message: `${p.skuId} semana ${p.weekStart}: la línea ${line.id} no tiene horas ese día, no se puede fechar la orden.` }); continue; }
    created.push({
      accion: 'CREAR', centro: plant.sapCenter, material: pad18(sku.sapMaterial), tipoOrden: orderType, cantidad: qty, unidad: unit, fechaFin: date, linea: line.id,
      referencia: `${options.releaseId}|${plant.sapCenter}|${sku.id}|${p.weekStart}`.toUpperCase(),
    });
  }

  const firstWeek = sorted[0]?.weekStart ?? null;
  const lastWeek = sorted[sorted.length - 1]?.weekStart ?? null;
  const deletions: ProvisionalOrderRow[] = firstWeek
    ? (options.priorOrders ?? []).filter((o) => o.fechaFin >= firstWeek).map((o) => ({ ...o, accion: 'BORRAR' as const }))
    : [];

  const centers = [...new Set([...created.map((r) => r.centro), ...deletions.map((r) => r.centro)])].sort();
  const files: PlantFile[] = [];
  const plantOf = (center: string) => ds.plants.find((p) => p.sapCenter === center)?.id ?? center;
  for (const center of centers) {
    const del = deletions.filter((r) => r.centro === center);
    const cre = created.filter((r) => r.centro === center);
    if (del.length) files.push({ plantId: plantOf(center), center, kind: 'ORDER_DELETIONS', name: `borrar_previsionales_${center}_${options.releaseId}.csv`, rows: del, csv: ordersToCsv(del) });
    if (cre.length) files.push({ plantId: plantOf(center), center, kind: 'PROVISIONAL_ORDERS', name: `ordenes_previsionales_${center}_${options.releaseId}.csv`, rows: cre, csv: ordersToCsv(cre) });
  }

  const perPlant = centers.map((center) => {
    const rows = created.filter((r) => r.centro === center);
    return { plantId: plantOf(center), center, rows: rows.length, commercial: rows.reduce((a, r) => a + r.cantidad, 0) };
  }).filter((p) => p.rows > 0);

  return {
    files, issues,
    summary: { createdRows: created.length, deletedRows: deletions.length, plannedCommercial: planned, writtenCommercial: created.reduce((a, r) => a + r.cantidad, 0), firstWeek, lastWeek, perPlant },
  };
}

export interface ParsedOrders {
  rows: ProvisionalOrderRow[];
  errors: string[];
}

/** Lee un archivo de órdenes (para validar lo que llega al servidor y para reconstruir las órdenes de la publicación anterior). */
export function parseOrdersCsv(content: string): ParsedOrders {
  const lines = content.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  const errors: string[] = [];
  const rows: ProvisionalOrderRow[] = [];
  if (lines.length === 0) return { rows, errors: ['El archivo está vacío.'] };
  if (lines[0] !== ORDERS_HEADER.join(';')) errors.push(`Encabezado inesperado: se esperaba «${ORDERS_HEADER.join(';')}».`);
  const seen = new Set<string>();
  lines.slice(1).forEach((line, i) => {
    const n = i + 2;
    const c = line.split(';');
    if (c.length !== ORDER_COLUMNS) { errors.push(`Fila ${n}: ${c.length} columnas en vez de ${ORDER_COLUMNS}.`); return; }
    const [accion, centro, material, tipoOrden, cantidad, unidad, fecha, linea, referencia] = c;
    const qty = Number(cantidad);
    if (accion !== 'CREAR' && accion !== 'BORRAR') errors.push(`Fila ${n}: acción «${accion}» no válida.`);
    if (!/^\d{4}$/.test(centro)) errors.push(`Fila ${n}: centro «${centro}» no válido.`);
    if (!/^\d{18}$/.test(material)) errors.push(`Fila ${n}: material «${material}» debe tener 18 dígitos.`);
    if (!Number.isInteger(qty) || qty <= 0) errors.push(`Fila ${n}: cantidad «${cantidad}» debe ser un entero > 0.`);
    if (!isRealDate(fecha)) errors.push(`Fila ${n}: fecha «${fecha}» no válida.`);
    if (!referencia) errors.push(`Fila ${n}: falta la referencia.`);
    else if (seen.has(referencia)) errors.push(`Fila ${n}: referencia repetida (${referencia}).`);
    seen.add(referencia);
    rows.push({ accion: accion as OrderAction, centro, material, tipoOrden, cantidad: qty, unidad, fechaFin: fromDdmmyyyy(fecha), linea, referencia });
  });
  return { rows, errors };
}

/** Valida un archivo de órdenes contra su tipo: las creaciones solo CREAR y los borrados solo BORRAR, un único centro por archivo. */
export function validateOrdersFile(content: string, kind: 'PROVISIONAL_ORDERS' | 'ORDER_DELETIONS'): { rows: ProvisionalOrderRow[]; errors: string[] } {
  const parsed = parseOrdersCsv(content);
  const expected: OrderAction = kind === 'PROVISIONAL_ORDERS' ? 'CREAR' : 'BORRAR';
  const errors = [...parsed.errors];
  if (parsed.rows.length === 0 && errors.length === 0) errors.push('El archivo no tiene filas.');
  if (parsed.rows.some((r) => r.accion !== expected)) errors.push(`Un archivo de ${kind === 'PROVISIONAL_ORDERS' ? 'creación' : 'borrado'} solo puede tener filas ${expected}.`);
  if (new Set(parsed.rows.map((r) => r.centro)).size > 1) errors.push('Un archivo debe tener un solo centro (se carga por planta).');
  return { rows: parsed.rows, errors };
}
