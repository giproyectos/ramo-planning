import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LineDayHistory, ProductionTemplate, RamoDataset, validateDataset } from '@ramo/domain';
import {
  EXTRA_HOUR_WEIGHT, NetPlanRow, UNMET_HOUR_WEIGHT, buildDailySchedule, computeNetProduction, dailyAlternatives, dayConfidence, demandForHorizon, fitAllLines, fitLineEfficiency,
  LineEfficiency, WeekCapacity, computeCrp, crpConfidence, recommendTemplates, weeklyAlternatives, weeklyConfidence,
} from './index';

const ds: RamoDataset = JSON.parse(readFileSync(new URL('../../../data/synthetic/dataset.json', import.meta.url), 'utf8'));
const latest = (kind: 'WEEKLY_N1' | 'PBO_MONTHLY') => ds.versions.filter((v) => v.kind === kind).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0].id;
const net = computeNetProduction(ds, demandForHorizon(ds, latest('WEEKLY_N1'), latest('PBO_MONTHLY')));

describe('capacidad real (historial)', () => {
  // 14 días seguidos desde un lunes: los lunes rinden 0,8 y el resto 0,9 (de 8 h programadas).
  const days = Array.from({ length: 14 }, (_, i) => new Date(Date.UTC(2026, 8, 7 + i)).toISOString().slice(0, 10)); // 2026-09-07 es lunes
  const history: LineDayHistory[] = days.map((date, i) => ({ lineId: 'L', date, scheduledHours: 8, effectiveHours: i % 7 === 0 ? 6.4 : 7.2, stoppageHours: 0 }));
  const eff = fitLineEfficiency(history, 'L')!;

  it('estima el rendimiento por día de la semana con encogimiento hacia el promedio de la línea', () => {
    const mean = 12.4 / 14;
    expect(eff.days).toBe(14);
    expect(eff.mean).toBeCloseTo(mean, 6);
    // lunes: 2 días de 0,8 y peso 5 del promedio → (2·0,8 + 5·media) / 7
    expect(eff.byWeekday[1]).toBeCloseTo((2 * 0.8 + 5 * mean) / 7, 6);
    expect(eff.byWeekday[2]).toBeCloseTo((2 * 0.9 + 5 * mean) / 7, 6);
  });

  it('sin historial suficiente no hay estimado', () => {
    expect(fitLineEfficiency(history.slice(0, 5), 'L')).toBeNull();
    expect(fitLineEfficiency(history, 'OTRA')).toBeNull();
  });

  it('la confianza de un día es la fracción de residuos del historial que alcanza la carga', () => {
    // Un lunes pide 6,8 h de 8 (0,85). Estimado del lunes 0,8612; los 12 residuos positivos (+0,0102) alcanzan y los 2 de lunes (−0,0612) no.
    expect(dayConfidence(eff, 1, 6.8, 8)).toBeCloseTo(12 / 14, 10);
    expect(dayConfidence(eff, 1, 0, 8)).toBe(1);
    expect(dayConfidence(eff, 1, 5, 0)).toBe(0);
    // Pedir todo lo programado nunca alcanza; pedir la mitad siempre.
    expect(dayConfidence(eff, 1, 8, 8)).toBe(0);
    expect(dayConfidence(eff, 1, 4, 8)).toBe(1);
  });

  it('el historial sintético es válido y cada línea rinde por debajo de su ritmo nominal', () => {
    expect(validateDataset(ds).filter((i) => i.code === 'BAD_HISTORY_HOURS' || i.code === 'UNKNOWN_LINE')).toEqual([]);
    const all = fitAllLines(ds);
    expect(Object.keys(all).sort()).toEqual(ds.lines.map((l) => l.id).sort());
    for (const e of Object.values(all)) {
      expect(e.mean).toBeGreaterThan(0.7);
      expect(e.mean).toBeLessThan(1);
    }
  });
});

describe('confiabilidad semanal', () => {
  const daily = buildDailySchedule(ds, net);
  const eff = fitAllLines(ds);
  const weeks = weeklyConfidence(ds, daily, eff);

  it('la capacidad realista es menor que la nominal y el rango está ordenado', () => {
    for (const w of weeks.filter((x) => x.nominalHours > 0)) {
      expect(w.realisticHours).toBeLessThan(w.nominalHours);
      expect(w.realisticP10).toBeLessThanOrEqual(w.realisticHours);
      expect(w.realisticP90).toBeGreaterThanOrEqual(w.realisticHours);
    }
  });

  it('una semana que pide más que su capacidad nominal casi nunca se cumple, y una holgada sí', () => {
    const over = weeks.filter((w) => w.requiredHours > w.nominalHours * 1.05);
    expect(over.length).toBeGreaterThan(0);
    for (const w of over) expect(w.pCovers).toBeLessThan(0.05);
    const roomy = weeks.filter((w) => w.requiredHours > 0 && w.requiredHours < w.realisticP10 * 0.9);
    expect(roomy.length).toBeGreaterThan(0);
    for (const w of roomy) expect(w.pCovers).toBeGreaterThan(0.95);
  });

  it('hay semanas que el CRP nominal da por cumplidas y la confiabilidad advierte (el valor de usar el historial)', () => {
    const hidden = weeks.filter((w) => w.requiredHours <= w.nominalHours && w.pCovers < 0.9);
    expect(hidden.length).toBeGreaterThan(0);
  });

  it('es determinista: misma semilla, mismo resultado', () => {
    expect(weeklyConfidence(ds, daily, eff)).toEqual(weeks);
    expect(weeklyConfidence(ds, daily, eff, { seed: 12 })).not.toEqual(weeks);
  });

  it('una línea sin historial se toma como nominal (sin inventar rendimiento)', () => {
    const w = weeklyConfidence(ds, daily, {});
    for (const x of w.filter((r) => r.nominalHours > 0)) expect(x.realisticHours).toBeCloseTo(x.nominalHours, 0);
  });
});

describe('alternativas semanales y diarias', () => {
  const weekly = weeklyAlternatives(ds, net);
  const daily = buildDailySchedule(ds, net);
  const dayAlt = dailyAlternatives(ds, daily);

  it('hay tres alternativas con una sola recomendada, la de menor costo', () => {
    expect(weekly.map((a) => a.id)).toEqual(['MIN_INVENTORY', 'BALANCED', 'NO_OVERTIME']);
    expect(weekly.filter((a) => a.recommended)).toHaveLength(1);
    const best = Math.min(...weekly.map((a) => a.metrics.cost));
    expect(weekly.find((a) => a.recommended)!.metrics.cost).toBe(best);
  });

  it('el costo semanal es horas adelantadas × semanas + horas extra × peso + horas sin cubrir × peso', () => {
    for (const a of weekly) {
      const m = a.metrics;
      expect(m.cost).toBeCloseTo(m.advanceHourPeriods + m.extraHours * EXTRA_HOUR_WEIGHT + m.unmetHours * UNMET_HOUR_WEIGHT, 1);
    }
  });

  it('adelantar menos obliga a más horas extra, y la alternativa sin horas extra no pide ninguna', () => {
    const [min, bal, none] = weekly;
    expect(min.metrics.extraHours).toBeGreaterThanOrEqual(bal.metrics.extraHours);
    expect(bal.metrics.extraHours).toBeGreaterThanOrEqual(none.metrics.extraHours);
    expect(none.metrics.extraHours).toBe(0);
    expect(none.plan.extraHours).toEqual([]);
    expect(min.plan.moves.every((m) => (new Date(m.fromWeek).getTime() - new Date(m.toWeek).getTime()) / 604800000 <= 1)).toBe(true);
    expect(min.metrics.advanceHourPeriods).toBeLessThanOrEqual(bal.metrics.advanceHourPeriods);
  });

  it('las horas movidas coinciden con la suma de los movimientos', () => {
    for (const a of weekly) expect(a.metrics.movedHours).toBeCloseTo(a.plan.moves.reduce((s, m) => s + m.hours, 0), 0);
  });

  it('diario: "solo días de producción" no abre días nuevos y "solo horas extra" no mueve nada', () => {
    const [prod, free, extra] = dayAlt;
    expect(prod.plan.moves.every((m) => m.kind === 'PRODUCTION_DAY')).toBe(true);
    expect(extra.plan.moves).toEqual([]);
    // Las horas extra se piden en medias horas por cada día-línea: nunca menos que el exceso ni más de media hora de redondeo por día.
    expect(extra.metrics.extraHours).toBeGreaterThanOrEqual(extra.plan.excessBefore - 0.05);
    expect(extra.metrics.extraHours).toBeLessThanOrEqual(extra.plan.excessBefore + 0.5 * extra.plan.overloaded);
    expect(free.metrics.extraHours).toBeLessThanOrEqual(prod.metrics.extraHours);
    expect(prod.metrics.extraHours).toBeLessThanOrEqual(extra.metrics.extraHours);
    expect(dayAlt.filter((a) => a.recommended)).toHaveLength(1);
  });
});

describe('recomendador de esquema', () => {
  /** Una línea de 1.000 u/h; A y B (1 u por caja). Esquema vigente: A lun-mar, B mié; 8 h por turno, un turno. */
  function mini(): RamoDataset {
    const sku = (id: string) => ({ id, sapMaterial: id, name: id, family: 'F', businessUnit: 'BU', brand: 'B', lineId: 'L1', commercialUnit: 'caja', productiveUnit: 'u' as const, productiveUnitsPerCommercial: 1, kgPerCommercial: 1, costPerCommercial: 1 });
    const t: ProductionTemplate = { id: 'T', name: 'T', crewId: 'CR', lineIds: ['L1'], days: { 1: ['A'], 2: ['A'], 3: ['B'] }, shifts: { 1: 1, 2: 1, 3: 1 }, hoursPerShift: 8, changeoverHours: 0 };
    return {
      synthetic: true, plants: [{ id: 'P', name: 'P' }], crews: [{ id: 'CR', name: 'CR', lineIds: ['L1'] }],
      lines: [{ id: 'L1', name: 'L1', plantId: 'P', crewId: 'CR', rate: { value: 1000, unit: 'u/h' } }],
      calendars: [{ lineId: 'L1', workingWeekdays: [1, 2, 3, 4, 5], baseHoursPerDay: 8, exceptions: [] }],
      skus: [sku('A'), sku('B')], versions: [], demand: [], buildingBlocks: [], inventory: [], openOrders: [], templates: [t],
    };
  }
  const W1 = '2026-10-05';
  const row = (skuId: string, qty: number): NetPlanRow => ({ skuId, weekStart: W1, grossCedi: qty, grossMto: 0, netProduction: qty });
  // A pide 8 h y B 16 h: con A en dos días y B en uno, B queda 8 h por encima de su día.
  const mnet = [row('A', 8000), row('B', 16000)];

  it('encuentra el esquema sin exceso que cambia menos días y explica la diferencia', () => {
    const r = recommendTemplates(mini(), mnet, 'T', { fromWeek: W1, weeks: 1 });
    const cur = r.find((e) => e.current)!;
    expect(cur.excessHours).toBe(8);
    const best = r[0];
    expect(best.current).toBe(false);
    expect(best.excessHours).toBe(0);
    // Entre los esquemas con A un día y B dos, gana el que cambia un solo día: A lunes, B martes y miércoles.
    expect(best.days).toEqual({ 1: ['A'], 2: ['B'], 3: ['B'] });
    expect(best.changedDays).toBe(1);
    expect(best.versusCurrent).toContain('8 h menos de exceso de capacidad');
    expect(best.rank).toBeLessThan(cur.rank);
  });

  it('respeta los días bloqueados', () => {
    const r = recommendTemplates(mini(), mnet, 'T', { fromWeek: W1, weeks: 1, constraints: { blockedWeekdays: [3] } });
    for (const e of r.filter((x) => !x.current)) expect(Object.keys(e.days).map(Number)).not.toContain(3);
  });

  it('respeta los productos que no pueden ir juntos', () => {
    const r = recommendTemplates(mini(), mnet, 'T', { fromWeek: W1, weeks: 1, constraints: { forbiddenTogether: [['A', 'B']] } });
    for (const e of r) for (const list of Object.values(e.days)) expect(list.includes('A') && list.includes('B')).toBe(false);
  });

  it('si el esquema vigente ya es lo mejor no inventa mejoras', () => {
    const r = recommendTemplates(mini(), [row('A', 16000), row('B', 8000)], 'T', { fromWeek: W1, weeks: 1 });
    expect(r.find((e) => e.current)!.rank).toBe(1);
    expect(r.filter((e) => !e.current).every((e) => e.score >= r[0].score)).toBe(true);
  });

  it('con el escenario sintético encuentra una mejora real para Barras y Mini y deja los demás esquemas sin cambio', () => {
    const weeks = [...new Set(net.map((x) => x.weekStart))].sort();
    const bm = recommendTemplates(ds, net, 'T-BARMINI', { fromWeek: weeks[0], weeks: 4 });
    expect(bm[0].current).toBe(false);
    expect(bm[0].excessHours).toBeLessThan(bm.find((e) => e.current)!.excessHours);
    for (const id of ['T-PONQ', 'T-CRISP', 'T-MAIZTOST']) {
      const r = recommendTemplates(ds, net, id, { fromWeek: weeks[0], weeks: 4 });
      expect(r.find((e) => e.current)!.score).toBeLessThanOrEqual(r[0].score + 0.05);
    }
  });

  it('una plantilla inexistente no devuelve nada', () => {
    expect(recommendTemplates(mini(), mnet, 'NO', { fromWeek: W1 })).toEqual([]);
  });
});

describe('confiabilidad sobre el CRP semanal', () => {
  // Línea que rinde siempre 90 % (sin variación): lo realista es 0,9 × lo nominal.
  const flat: LineEfficiency = { lineId: 'L', days: 100, mean: 0.9, sd: 0, byWeekday: { 1: 0.9, 2: 0.9, 3: 0.9, 4: 0.9, 5: 0.9, 6: 0.9, 7: 0.9 }, nByWeekday: { 1: 15, 2: 15, 3: 15, 4: 15, 5: 15, 6: 15, 7: 10 }, stoppageRate: 0, stoppageAvgHours: 0, residuals: [0] };
  const week = (required: number): WeekCapacity[] => [{
    weekStart: '2026-10-05',
    lines: [{ lineId: 'L', requiredHours: required, availableHours: 100, saturationPct: required, status: 'OK' }],
    crews: [{ crewId: 'C', lineIds: ['L'], requiredHours: required, availableHours: 100, extraHours: 0, saturationPct: required, excessHours: Math.max(0, required - 100), status: 'OK' }],
  }];

  it('con rendimiento fijo del 90 %: 85 h de 100 alcanzan siempre y 95 h nunca', () => {
    const ok = crpConfidence(week(85), { L: flat })[0];
    expect(ok.realisticHours).toBeCloseTo(90, 5);
    expect(ok.pCovers).toBe(1);
    const no = crpConfidence(week(95), { L: flat })[0];
    expect(no.pCovers).toBe(0);
    // justo en el límite del rendimiento (90 h) todavía alcanza
    expect(crpConfidence(week(90), { L: flat })[0].pCovers).toBe(1);
  });

  it('sin historial de la línea usa las horas nominales', () => {
    const r = crpConfidence(week(95), {})[0];
    expect(r.realisticHours).toBe(100);
    expect(r.pCovers).toBe(1);
  });

  it('con el escenario sintético hay semanas verdes en el CRP con menos de 90 % de probabilidad', () => {
    const cap = computeCrp(ds, net);
    const conf = crpConfidence(cap, fitAllLines(ds));
    expect(conf.length).toBe(cap.length * 4);
    const risky = conf.filter((c) => c.requiredHours <= c.nominalHours && c.pCovers < 0.9);
    expect(risky.length).toBeGreaterThan(0);
    for (const c of conf) {
      expect(c.pCovers).toBeGreaterThanOrEqual(0);
      expect(c.pCovers).toBeLessThanOrEqual(1);
    }
  });
});
