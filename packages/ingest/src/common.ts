import { RamoDataset, Sku } from '@ramo/domain';
import { CsvTable, DecimalSeparator, parseCsv } from './csv';

export type Severity = 'error' | 'warning' | 'info';
export type BaseName = 'stock' | 'movimientos' | 'abastecimiento' | 'despachos';

export interface IngestIssue {
  severity: Severity;
  base: BaseName;
  code: string;
  line?: number;
  message: string;
}

export interface IngestContext {
  dataset: RamoDataset;
  /** Corte de las bases: 'YYYY-MM-DDTHH:MM' (lunes 8:00 en el proceso de Miguel). */
  cutAt: string;
  /** Filas más viejas que esto se descartan (recorte de 2 años pedido por Marlon). */
  staleYears?: number;
  /** Ventana de movimientos de inventario (1 mes). */
  movementWindowDays?: number;
  decimal?: DecimalSeparator;
  /** Destinos finales de la triangulación (nacionalización / customer). */
  finalDestinations?: string[];
  /** Ventana horaria que cubre la consulta Z de despachos. */
  dispatchWindow?: { from: string; to: string };
  /** Si se indica, solo se cuentan estos centros en inventario. */
  plantCenters?: string[];
}

export interface ParseResult<T> {
  rows: T[];
  issues: IngestIssue[];
  /** false si faltan columnas obligatorias o no quedó ninguna fila válida. */
  ok: boolean;
}

export interface ColumnSpec<F extends string> {
  field: F;
  aliases: string[];
  required: boolean;
}

export const normalizeHeader = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Código de material comparable: sin espacios ni ceros a la izquierda ("000000000900001" ≡ "900001"). */
export const normalizeMaterial = (s: string): string => s.trim().replace(/^0+/, '').toUpperCase();

export function skuIndex(ds: RamoDataset): Map<string, Sku> {
  return new Map(ds.skus.map((s) => [normalizeMaterial(s.sapMaterial), s]));
}

export interface MappedTable<F extends string> {
  table: CsvTable;
  index: Record<F, number>;
  issues: IngestIssue[];
  ok: boolean;
}

/** Lee el CSV y mapea los encabezados a campos canónicos usando alias (sin tildes ni mayúsculas). */
export function readTable<F extends string>(base: BaseName, text: string, specs: ColumnSpec<F>[]): MappedTable<F> {
  const table = parseCsv(text);
  const issues: IngestIssue[] = [];
  const normalized = table.headers.map(normalizeHeader);
  const index = {} as Record<F, number>;
  let ok = true;

  for (const spec of specs) {
    const i = normalized.findIndex((h) => spec.aliases.map(normalizeHeader).includes(h));
    index[spec.field] = i;
    if (i < 0 && spec.required) {
      ok = false;
      issues.push({ severity: 'error', base, code: 'MISSING_COLUMN', message: `Falta la columna obligatoria "${spec.field}" (alias aceptados: ${spec.aliases.join(', ')})` });
    }
  }
  if (table.rows.length === 0) {
    ok = false;
    issues.push({ severity: 'error', base, code: 'EMPTY_BASE', message: 'El archivo no tiene filas de datos' });
  }
  return { table, index, issues, ok };
}

export const cell = <F extends string>(m: MappedTable<F>, cells: string[], field: F): string => {
  const i = m.index[field];
  return i >= 0 ? (cells[i] ?? '').trim() : '';
};

/** Resta `years` años a 'YYYY-MM-DD'. */
export function minusYears(date: string, years: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
}

export function minusDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Convierte una cantidad en la unidad de SAP a cajas (unidad comercial). null si no se puede convertir. */
export function toCommercial(sku: Sku, qty: number, unit: string): number | null {
  const u = unit.trim().toUpperCase();
  if (['CJ', 'CAJ', 'CAJA', 'BOX'].includes(u)) return qty;
  if (['UN', 'ST', 'U', 'PZ', 'EA'].includes(u)) return sku.productiveUnit === 'u' ? qty / sku.productiveUnitsPerCommercial : null;
  if (['KG', 'KGM'].includes(u)) return qty / sku.kgPerCommercial;
  if (['G', 'GR'].includes(u)) return qty / 1000 / sku.kgPerCommercial;
  if (['TO', 'T', 'TON'].includes(u)) return (qty * 1000) / sku.kgPerCommercial;
  return null;
}

/** Marca de fecha+hora comparable: 'YYYY-MM-DDTHH:MM'. */
export const stamp = (date: string, time: string | null): string => `${date}T${time ?? '00:00'}`;

export const hhmm = (cutAt: string): string => cutAt.slice(11, 16);
export const dateOf = (cutAt: string): string => cutAt.slice(0, 10);
