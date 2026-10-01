import { DemandRecord, RamoDataset } from '@ramo/domain';

/**
 * Demanda de una versión con sus building blocks aplicados.
 * Un block suma `deltaCommercialQty` por semana sobre los SKUs que cumplan su alcance (SKU, familia,
 * unidad de negocio o todos) en su flujo (CEDI por defecto), repartido en proporción a la cantidad actual
 * (en partes iguales si es cero). Nunca deja una cantidad negativa.
 */
export function applyBuildingBlocks(ds: RamoDataset, versionId: string): DemandRecord[] {
  const rows = new Map<string, DemandRecord>();
  const key = (skuId: string, week: string, flow: string) => `${skuId}|${week}|${flow}`;
  for (const d of ds.demand) {
    if (d.versionId === versionId) rows.set(key(d.skuId, d.weekStart, d.flow), { ...d });
  }
  const versionWeeks = [...new Set([...rows.values()].map((r) => r.weekStart))].sort();

  for (const b of ds.buildingBlocks) {
    if (b.versionId !== versionId) continue;
    const flow = b.scope.flow ?? 'CEDI';
    const targets = ds.skus.filter(
      (s) =>
        (!b.scope.skuId || s.id === b.scope.skuId) &&
        (!b.scope.family || s.family === b.scope.family) &&
        (!b.scope.businessUnit || s.businessUnit === b.scope.businessUnit),
    );
    if (targets.length === 0) continue;
    const weeks = b.scope.weekStart ? [b.scope.weekStart] : versionWeeks;

    for (const week of weeks) {
      const current = targets.map((s) => rows.get(key(s.id, week, flow))?.commercialQty ?? 0);
      const total = current.reduce((a, c) => a + c, 0);
      targets.forEach((s, i) => {
        const share = total > 0 ? current[i] / total : 1 / targets.length;
        const next = Math.max(0, Math.round(current[i] + b.deltaCommercialQty * share));
        const k = key(s.id, week, flow);
        const existing = rows.get(k);
        if (existing) existing.commercialQty = next;
        else rows.set(k, { versionId, skuId: s.id, weekStart: week, flow, commercialQty: next });
      });
    }
  }

  return [...rows.values()].sort(
    (a, b) => a.weekStart.localeCompare(b.weekStart) || a.skuId.localeCompare(b.skuId) || a.flow.localeCompare(b.flow),
  );
}

/**
 * Demanda del horizonte completo: el recálculo semanal (N+1, con sus building blocks) manda en las semanas
 * que cubre y el PBO mensual completa las semanas posteriores.
 */
export function demandForHorizon(ds: RamoDataset, primaryVersionId: string, fallbackVersionId: string): DemandRecord[] {
  const primary = applyBuildingBlocks(ds, primaryVersionId);
  const covered = new Set(primary.map((r) => r.weekStart));
  const fallback = applyBuildingBlocks(ds, fallbackVersionId).filter((r) => !covered.has(r.weekStart));
  return [...primary, ...fallback].sort((a, b) => a.weekStart.localeCompare(b.weekStart) || a.skuId.localeCompare(b.skuId));
}
