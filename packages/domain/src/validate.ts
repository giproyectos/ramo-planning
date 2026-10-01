import { RamoDataset } from './types';

export interface ValidationIssue {
  code: string;
  path: string;
  message: string;
}

const isIsoDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
const isMonday = (d: string) => isIsoDate(d) && new Date(`${d}T00:00:00Z`).getUTCDay() === 1;

function duplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const id of ids) (seen.has(id) ? dup : seen).add(id);
  return [...dup];
}

/** Reglas de integridad del dataset. No lanza: devuelve la lista de problemas. */
export function validateDataset(ds: RamoDataset): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (code: string, path: string, message: string) => issues.push({ code, path, message });

  const idLists: [string, { id: string }[]][] = [
    ['plants', ds.plants],
    ['crews', ds.crews],
    ['lines', ds.lines],
    ['skus', ds.skus],
    ['versions', ds.versions],
    ['buildingBlocks', ds.buildingBlocks],
  ];
  for (const [name, list] of idLists) {
    for (const id of duplicates(list.map((x) => x.id))) add('DUPLICATE_ID', name, `id repetido: ${id}`);
  }

  const plants = new Set(ds.plants.map((p) => p.id));
  const crews = new Map(ds.crews.map((c) => [c.id, c]));
  const lines = new Map(ds.lines.map((l) => [l.id, l]));
  const skus = new Map(ds.skus.map((s) => [s.id, s]));
  const versions = new Set(ds.versions.map((v) => v.id));

  for (const l of ds.lines) {
    const p = `lines.${l.id}`;
    if (!plants.has(l.plantId)) add('UNKNOWN_PLANT', p, `planta inexistente: ${l.plantId}`);
    const crew = crews.get(l.crewId);
    if (!crew) add('UNKNOWN_CREW', p, `tripulación inexistente: ${l.crewId}`);
    else if (!crew.lineIds.includes(l.id)) add('CREW_LINE_MISMATCH', p, `la tripulación ${crew.id} no lista la línea ${l.id}`);
    if (!(l.rate.value > 0)) add('INVALID_RATE', p, 'el ritmo debe ser > 0');
  }
  for (const c of ds.crews) {
    for (const lid of c.lineIds) {
      const l = lines.get(lid);
      if (!l) add('UNKNOWN_LINE', `crews.${c.id}`, `línea inexistente: ${lid}`);
      else if (l.crewId !== c.id) add('CREW_LINE_MISMATCH', `crews.${c.id}`, `la línea ${lid} pertenece a ${l.crewId}`);
    }
  }

  const calendarLines = ds.calendars.map((c) => c.lineId);
  for (const id of duplicates(calendarLines)) add('DUPLICATE_ID', 'calendars', `calendario repetido para la línea ${id}`);
  for (const l of ds.lines) {
    if (!calendarLines.includes(l.id)) add('MISSING_CALENDAR', `lines.${l.id}`, 'la línea no tiene calendario');
  }
  for (const cal of ds.calendars) {
    const p = `calendars.${cal.lineId}`;
    if (!lines.has(cal.lineId)) add('UNKNOWN_LINE', p, `línea inexistente: ${cal.lineId}`);
    if (cal.baseHoursPerDay < 0 || cal.baseHoursPerDay > 24) add('INVALID_HOURS', p, 'baseHoursPerDay fuera de 0–24');
    if (cal.workingWeekdays.some((d) => d < 1 || d > 7)) add('INVALID_WEEKDAY', p, 'workingWeekdays debe estar en 1–7');
    for (const e of cal.exceptions) {
      if (!isIsoDate(e.date)) add('INVALID_DATE', p, `fecha inválida: ${e.date}`);
      if (e.hours < 0 || e.hours > 24) add('INVALID_HOURS', p, `horas fuera de 0–24 el ${e.date}`);
    }
  }

  for (const s of ds.skus) {
    const p = `skus.${s.id}`;
    const line = lines.get(s.lineId);
    if (!line) add('UNKNOWN_LINE', p, `línea inexistente (perfil general): ${s.lineId}`);
    else {
      const expected = line.rate.unit === 'u/h' ? 'u' : 'kg';
      if (s.productiveUnit !== expected) {
        add('UNIT_MISMATCH', p, `la línea ${line.id} trabaja en ${line.rate.unit} pero el SKU en ${s.productiveUnit}`);
      }
    }
    if (!(s.productiveUnitsPerCommercial > 0)) add('INVALID_CONVERSION', p, 'productiveUnitsPerCommercial debe ser > 0');
    if (!(s.kgPerCommercial > 0)) add('INVALID_CONVERSION', p, 'kgPerCommercial debe ser > 0');
  }

  for (const v of ds.versions) {
    if (v.basedOn && !versions.has(v.basedOn)) add('UNKNOWN_VERSION', `versions.${v.id}`, `basedOn inexistente: ${v.basedOn}`);
  }

  ds.demand.forEach((d, i) => {
    const p = `demand[${i}]`;
    if (!versions.has(d.versionId)) add('UNKNOWN_VERSION', p, `versión inexistente: ${d.versionId}`);
    if (!skus.has(d.skuId)) add('UNKNOWN_SKU', p, `SKU inexistente: ${d.skuId}`);
    if (!isMonday(d.weekStart)) add('WEEK_NOT_MONDAY', p, `weekStart debe ser un lunes válido: ${d.weekStart}`);
    if (d.commercialQty < 0) add('NEGATIVE_QTY', p, 'cantidad negativa');
  });

  // Una sola fila por (versión, sku, semana, flujo).
  const keys = ds.demand.map((d) => `${d.versionId}|${d.skuId}|${d.weekStart}|${d.flow}`);
  for (const k of duplicates(keys)) add('DUPLICATE_DEMAND', 'demand', `fila de demanda repetida: ${k}`);

  for (const b of ds.buildingBlocks) {
    const p = `buildingBlocks.${b.id}`;
    if (!versions.has(b.versionId)) add('UNKNOWN_VERSION', p, `versión inexistente: ${b.versionId}`);
    if (!b.reason.trim()) add('MISSING_REASON', p, 'un building block exige motivo');
    if (!b.author.trim()) add('MISSING_AUTHOR', p, 'un building block exige autor');
    if (b.scope.skuId && !skus.has(b.scope.skuId)) add('UNKNOWN_SKU', p, `SKU inexistente: ${b.scope.skuId}`);
    if (b.scope.weekStart && !isMonday(b.scope.weekStart)) add('WEEK_NOT_MONDAY', p, `weekStart debe ser un lunes válido: ${b.scope.weekStart}`);
  }

  return issues;
}
