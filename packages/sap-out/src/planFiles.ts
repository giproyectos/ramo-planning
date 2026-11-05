import { RamoDataset } from '@ramo/domain';
import { DailyResult, PlantRow, weekdayOf } from '@ramo/engine';

/** Archivos de lectura del plan oficial (no entran a SAP): la programación diaria por planta y la confirmación de plantas. Separador «;», decimal con coma. */

const txt = (v: string) => v.replace(/[;\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
const num1 = (n: number) => (Math.round(n * 10) / 10).toString().replace('.', ',');
const WD = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];

export const DAILY_PLAN_HEADER = ['fecha', 'dia', 'semana', 'planta', 'linea', 'producto', 'material', 'cajas', 'horas', 'turnos'].join(';');

export function dailyPlanCsv(ds: RamoDataset, daily: DailyResult, plantId?: string): string {
  const rows: string[] = [DAILY_PLAN_HEADER];
  const sorted = daily.weeks.flatMap((w) => w.cells.map((c) => ({ w, c }))).sort((a, b) => a.c.date.localeCompare(b.c.date) || a.c.lineId.localeCompare(b.c.lineId));
  for (const { w, c } of sorted) {
    const line = ds.lines.find((l) => l.id === c.lineId);
    if (!line || (plantId && line.plantId !== plantId)) continue;
    for (const [skuId, qty] of Object.entries(c.qty).sort(([a], [b]) => a.localeCompare(b))) {
      const q = Math.round(qty);
      if (q <= 0) continue;
      const sku = ds.skus.find((s) => s.id === skuId);
      if (!sku) continue;
      const hours = (qty * sku.productiveUnitsPerCommercial) / line.rate.value;
      rows.push([c.date, WD[weekdayOf(c.date) - 1], w.weekStart, line.plantId, line.id, txt(sku.name.replace(' (sint.)', '')), sku.sapMaterial, q, num1(hours), w.template.shifts[weekdayOf(c.date)] ?? 0].join(';'));
    }
  }
  return rows.join('\n') + '\n';
}

export const CONFIRMATIONS_HEADER = ['planta', 'semana', 'producto', 'pide_mps', 'confirmado', 'estado', 'motivo', 'autor', 'fecha_confirmacion', 'entregado'].join(';');
const STATE: Record<PlantRow['status'], string> = { PENDING: 'pendiente', CONFIRMED: 'confirmado', PARTIAL: 'parcial', CANNOT: 'no puede' };

export function confirmationsCsv(ds: RamoDataset, rows: PlantRow[], plantId?: string): string {
  const out: string[] = [CONFIRMATIONS_HEADER];
  for (const r of rows) {
    if (plantId && r.plantId !== plantId) continue;
    const sku = ds.skus.find((s) => s.id === r.skuId);
    out.push([r.plantId, r.weekStart, txt(sku?.name.replace(' (sint.)', '') ?? r.skuId), r.plannedNow, r.current ? r.confirmedQty : '', STATE[r.status], txt(r.current?.reason ?? ''), txt(r.current?.author ?? ''), r.current?.createdAt.slice(0, 16).replace('T', ' ') ?? '', r.delivered].join(';'));
  }
  return out.join('\n') + '\n';
}
