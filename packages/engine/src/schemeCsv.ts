import { ProductionTemplate, RamoDataset } from '@ramo/domain';

/**
 * Esquemas de producción en CSV (se abre y se edita en Excel; guardar como «CSV delimitado por punto y coma»).
 *
 *   esquema;producto;lun;mar;mie;jue;vie;sab;dom
 *   T-BARMINI;SK-005;X;X;;;;;
 *   T-BARMINI;SK-003;;;X;X;;;
 *   T-BARMINI;TURNOS;3;3;3;3;3;3;
 *
 * El esquema y el producto se pueden escribir con el código o con el nombre. Una celda marcada (X, 1, sí) es un día en que el producto
 * se produce; la fila TURNOS (opcional) trae los turnos de cada día. El formato es una propuesta: se ajusta al Excel real de Producción.
 */
export const SCHEME_COLUMNS = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'] as const;
export const SCHEME_HEADER = ['esquema', 'producto', ...SCHEME_COLUMNS].join(';');

const clean = (v: string) => v.replace(/[;\r\n]+/g, ' ').trim();
const plain = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
const TRUE = new Set(['x', '1', 'si', 's', 'v', 'true', 'ok', 'verde']);

export function schemesToCsv(ds: RamoDataset, templates: ProductionTemplate[]): string {
  const rows: string[] = [SCHEME_HEADER];
  for (const t of templates) {
    for (const sku of ds.skus.filter((s) => t.lineIds.includes(s.lineId))) {
      rows.push([clean(t.id), clean(sku.id), ...[1, 2, 3, 4, 5, 6, 7].map((d) => ((t.days[d] ?? []).includes(sku.id) ? 'X' : ''))].join(';'));
    }
    rows.push([clean(t.id), 'TURNOS', ...[1, 2, 3, 4, 5, 6, 7].map((d) => (t.shifts[d] ? String(t.shifts[d]) : ''))].join(';'));
  }
  return rows.join('\n') + '\n';
}

export interface ParsedScheme {
  templateId: string;
  days: Record<number, string[]>;
  /** Solo si el archivo trae la fila TURNOS de ese esquema. */
  shifts?: Record<number, number>;
}

export interface SchemeIssue {
  severity: 'error' | 'warning';
  line: number;
  message: string;
}

export interface ParsedSchemes {
  schemes: ParsedScheme[];
  issues: SchemeIssue[];
}

export function parseSchemesCsv(text: string, ds: RamoDataset): ParsedSchemes {
  const issues: SchemeIssue[] = [];
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const first = lines.findIndex((l) => l.trim() !== '');
  if (first < 0) return { schemes: [], issues: [{ severity: 'error', line: 1, message: 'El archivo está vacío.' }] };
  const sep = lines[first].includes(';') ? ';' : ',';
  const header = lines[first].split(sep).map(plain);
  const expected = ['esquema', 'producto', ...SCHEME_COLUMNS];
  const dayCol = header.map((h) => (h === 'mie' ? 'mie' : h)); // «mié» ya sin tilde
  if (dayCol[0] !== 'esquema' || dayCol[1] !== 'producto' || SCHEME_COLUMNS.some((c, i) => dayCol[2 + i] !== c)) {
    return { schemes: [], issues: [{ severity: 'error', line: first + 1, message: `Encabezado inesperado: se esperaba «${expected.join(sep)}».` }] };
  }
  const templates = ds.templates ?? [];
  const findTemplate = (v: string) => templates.find((t) => plain(t.id) === plain(v)) ?? templates.find((t) => plain(t.name) === plain(v)) ?? templates.find((t) => plain(t.name).startsWith(plain(v)) && plain(v).length >= 4);
  const findSku = (v: string) => ds.skus.find((s) => plain(s.id) === plain(v)) ?? ds.skus.find((s) => plain(s.name) === plain(v)) ?? ds.skus.find((s) => plain(s.name.replace(' (sint.)', '')) === plain(v));

  const byTemplate = new Map<string, { days: Record<number, string[]>; shifts?: Record<number, number>; bad: boolean; rows: number }>();
  for (let i = first + 1; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim() === '') continue;
    const n = i + 1;
    const cells = raw.split(sep);
    const t = findTemplate(cells[0] ?? '');
    if (!t) { issues.push({ severity: 'error', line: n, message: `Esquema «${cells[0] ?? ''}» no existe.` }); continue; }
    const acc = byTemplate.get(t.id) ?? { days: {}, bad: false, rows: 0 };
    byTemplate.set(t.id, acc);
    acc.rows += 1;
    const product = (cells[1] ?? '').trim();
    if (plain(product) === 'turnos') {
      const shifts: Record<number, number> = {};
      for (let d = 1; d <= 7; d++) {
        const v = (cells[1 + d] ?? '').trim();
        if (v === '') continue;
        const num = Number(v.replace(',', '.'));
        if (!Number.isInteger(num) || num < 0 || num > 4) { issues.push({ severity: 'error', line: n, message: `Turnos «${v}» no válidos (enteros de 0 a 4).` }); acc.bad = true; continue; }
        if (num > 0) shifts[d] = num;
      }
      acc.shifts = shifts;
      continue;
    }
    const sku = findSku(product);
    if (!sku) { issues.push({ severity: 'error', line: n, message: `Producto «${product}» no existe.` }); acc.bad = true; continue; }
    if (!t.lineIds.includes(sku.lineId)) { issues.push({ severity: 'error', line: n, message: `${sku.name.replace(' (sint.)', '')} no es de las líneas del esquema ${t.id}.` }); acc.bad = true; continue; }
    for (let d = 1; d <= 7; d++) {
      const v = plain(cells[1 + d] ?? '');
      if (v === '') continue;
      if (!TRUE.has(v)) { issues.push({ severity: 'warning', line: n, message: `Marca «${cells[1 + d]}» no reconocida: se toma como vacía (usa X o 1).` }); continue; }
      (acc.days[d] ??= []).push(sku.id);
    }
  }

  const schemes: ParsedScheme[] = [];
  for (const [templateId, acc] of byTemplate) {
    if (acc.bad) { issues.push({ severity: 'warning', line: 0, message: `El esquema ${templateId} no se importa porque tiene errores.` }); continue; }
    if (acc.shifts) {
      for (const d of Object.keys(acc.days).map(Number)) {
        if (!acc.shifts[d]) issues.push({ severity: 'warning', line: 0, message: `${templateId}: hay producción el día ${SCHEME_COLUMNS[d - 1]} pero con 0 turnos.` });
      }
    }
    if (Object.keys(acc.days).length === 0) issues.push({ severity: 'warning', line: 0, message: `${templateId}: no tiene ningún día de producción marcado.` });
    schemes.push({ templateId, days: acc.days, shifts: acc.shifts });
  }
  return { schemes, issues };
}
