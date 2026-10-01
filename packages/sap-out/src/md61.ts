import { DemandRecord, RamoDataset } from '@ramo/domain';

export interface Md61Options {
  /** Versión de planificación de SAP (por defecto '00'). */
  version?: string;
  /** Tipo de requerimiento planificado (por defecto 'LSF', fabricación contra stock). Supuesto: confirmar con Ramo. */
  requirementType?: string;
  /** Unidad con la que se carga (por defecto 'CJ': el material se mantiene en cajas). Supuesto: confirmar. */
  unit?: string;
  /** Solo se cargan estos flujos. Hard Discount y Exportaciones son bajo pedido y no entran a Gestión de Demanda. */
  flows?: DemandRecord['flow'][];
}

export interface Md61Row {
  material: string;
  centro: string;
  tipoReq: string;
  version: string;
  periodo: 'W';
  fecha: string;
  cantidad: number;
  unidad: string;
}

export interface Md61Issue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
}

export interface Md61Result {
  header: string[];
  rows: Md61Row[];
  csv: string;
  issues: Md61Issue[];
  totalCommercial: number;
}

const HEADER = ['Material', 'Centro', 'Tipo_req', 'Version', 'Periodo', 'Fecha', 'Cantidad', 'UM'];
const ddmmyyyy = (iso: string) => iso.split('-').reverse().join('.');
const pad18 = (m: string) => m.padStart(18, '0');

/**
 * Archivo plano para cargar demanda semanal a Gestión de Demanda (MD61 / LSMW), una fila por SKU y semana.
 * El formato de columnas es un SUPUESTO (ver docs/formatos-bases-sap.md): lo que importa aquí es que el contenido sea correcto
 * y revisable antes de cargarlo; la plantilla exacta de LSMW se ajusta con el equipo SAP de Ramo.
 * Solo se cargan las filas con cantidad > 0 del flujo CEDI; las cantidades se redondean a enteros (cajas).
 */
export function buildMd61(ds: RamoDataset, records: DemandRecord[], options: Md61Options = {}): Md61Result {
  const version = options.version ?? '00';
  const tipoReq = options.requirementType ?? 'LSF';
  const unidad = options.unit ?? 'CJ';
  const flows = options.flows ?? ['CEDI'];
  const issues: Md61Issue[] = [];
  const rows: Md61Row[] = [];

  const skus = new Map(ds.skus.map((s) => [s.id, s]));
  const lines = new Map(ds.lines.map((l) => [l.id, l]));
  const plants = new Map(ds.plants.map((p) => [p.id, p]));

  // Una fila por SKU-semana (si hay varias versiones/filas del mismo flujo se suman).
  const grouped = new Map<string, number>();
  for (const r of records) {
    if (!flows.includes(r.flow)) continue;
    const k = `${r.skuId}|${r.weekStart}`;
    grouped.set(k, (grouped.get(k) ?? 0) + r.commercialQty);
  }

  const missingCenter = new Set<string>();
  for (const [k, qty] of [...grouped].sort((a, b) => a[0].localeCompare(b[0]))) {
    const [skuId, week] = k.split('|');
    const sku = skus.get(skuId);
    if (!sku) { issues.push({ severity: 'error', code: 'UNKNOWN_SKU', message: `SKU inexistente: ${skuId}` }); continue; }
    const center = plants.get(lines.get(sku.lineId)?.plantId ?? '')?.sapCenter;
    if (!center) {
      if (!missingCenter.has(skuId)) issues.push({ severity: 'error', code: 'MISSING_CENTER', message: `${skuId}: la planta de su línea no tiene código de centro SAP` });
      missingCenter.add(skuId);
      continue;
    }
    if (qty < 0) { issues.push({ severity: 'error', code: 'NEGATIVE_QTY', message: `${skuId} ${week}: cantidad negativa` }); continue; }
    const cantidad = Math.round(qty);
    if (cantidad === 0) continue;
    rows.push({ material: pad18(sku.sapMaterial), centro: center, tipoReq, version, periodo: 'W', fecha: ddmmyyyy(week), cantidad, unidad });
  }

  if (rows.length === 0 && issues.length === 0) issues.push({ severity: 'warning', code: 'EMPTY_FILE', message: 'No hay cantidades > 0 para cargar' });

  const csv = [HEADER.join(';'), ...rows.map((r) => [r.material, r.centro, r.tipoReq, r.version, r.periodo, r.fecha, r.cantidad, r.unidad].join(';'))].join('\n') + '\n';
  return { header: HEADER, rows, csv, issues, totalCommercial: rows.reduce((a, r) => a + r.cantidad, 0) };
}
