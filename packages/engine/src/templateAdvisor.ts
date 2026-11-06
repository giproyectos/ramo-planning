import { DailyAdjustment, PlantRule, RamoDataset, TemplateOverride, toProductiveQty } from '@ramo/domain';
import { AllocationRule, DailyResult, buildDailySchedule } from './daily';
import { NetPlanRow } from './mps';

/**
 * Recomendador de esquema: dado el plan de las próximas semanas, arma varios esquemas posibles para una plantilla (días por producto en la
 * línea), simula cada uno con el motor diario y los ordena. Es optimización por simulación: no hay nada oculto, cada esquema se puede abrir
 * y revisar. Las reglas de qué combinaciones son válidas en planta las define Producción (`constraints`); sin ellas el recomendador puede
 * sugerir esquemas que no se pueden ejecutar. Ver ADR 0011.
 */

export interface TemplateConstraints {
  /** Productos que no pueden producirse el mismo día en la línea. */
  forbiddenTogether?: [string, string][];
  /** Días que no se pueden usar (1 = lunes … 7 = domingo). */
  blockedWeekdays?: number[];
  /** Mínimo de días de producción por producto en la semana. */
  minDaysPerSku?: number;
  /** Días en que un producto no se puede producir (1 = lunes … 7 = domingo), por producto. */
  blockedBySku?: Record<string, number[]>;
  /** Mínimo de días de producción por producto (manda sobre `minDaysPerSku`). */
  minDaysBySku?: Record<string, number>;
}

/** Reglas de planta convertidas en las restricciones que entiende el recomendador. Los tiempos de cambio por par no restringen: cambian el costo. */
export function rulesToConstraints(rules: PlantRule[]): TemplateConstraints {
  const out: TemplateConstraints = { forbiddenTogether: [], blockedBySku: {}, minDaysBySku: {} };
  for (const r of rules) {
    if (r.kind === 'NO_TOGETHER') out.forbiddenTogether!.push([r.skuA, r.skuB]);
    else if (r.kind === 'NO_WEEKDAY') out.blockedBySku![r.skuId] = [...(out.blockedBySku![r.skuId] ?? []), r.weekday];
    else if (r.kind === 'MIN_DAYS') out.minDaysBySku![r.skuId] = Math.max(out.minDaysBySku![r.skuId] ?? 0, r.days);
  }
  return out;
}

export interface TemplateEvaluation {
  id: string;
  label: string;
  description: string;
  days: Record<number, string[]>;
  shifts: Record<number, number>;
  current: boolean;
  /** Sumas sobre las semanas evaluadas. */
  excessHours: number;
  unscheduledHours: number;
  changeoverHours: number;
  crewConflicts: number;
  /** Días-línea sobre el 100 % de su capacidad. */
  overDays: number;
  /** Reglas de planta que el esquema viola en las semanas evaluadas. */
  ruleViolations: number;
  /** Cuántos días de la semana cambian de producto frente al esquema vigente. */
  changedDays: number;
  /** Cuántas combinaciones se evaluaron en total para llegar a este ranking. */
  evaluated: number;
  /** Menor es mejor. */
  score: number;
  rank: number;
  /** Lo que cambia frente al esquema vigente. */
  versusCurrent: string[];
  result: DailyResult;
}

export interface TemplateAdvisorOptions {
  fromWeek: string;
  weeks?: number;
  overrides?: TemplateOverride[];
  adjustments?: DailyAdjustment[];
  rule?: AllocationRule;
  constraints?: TemplateConstraints;
  /** Reglas de planta: se aplican al simular cada esquema (los que las violan puntúan peor). */
  rules?: PlantRule[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;
/** Número con coma decimal para los textos (es-CO). */
const es = (n: number) => String(n).replace('.', ',');
const WD_SHORT = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

export const weekdayShort = (n: number) => WD_SHORT[n] ?? String(n);

/** Tope de combinaciones que se prueban una por una; por encima de esto solo se evalúan las familias de esquemas. */
const MAX_COMBINATIONS = 4000;

const signature = (days: Record<number, string[]>) =>
  JSON.stringify(
    Object.entries(days)
      .filter(([, l]) => l.length)
      .map(([d, l]) => [Number(d), [...l].sort()])
      .sort((a, b) => (a[0] as number) - (b[0] as number)),
  );

/** "Lun–Mié Mini · Jue Barras": días seguidos con los mismos productos se agrupan. */
function compactLabel(days: Record<number, string[]>, nameOf: (id: string) => string): string {
  const ds = Object.keys(days).map(Number).filter((d) => (days[d] ?? []).length > 0).sort((a, b) => a - b);
  const groups: { from: number; to: number; key: string; names: string }[] = [];
  for (const d of ds) {
    const key = [...days[d]].sort().join(',');
    const last = groups[groups.length - 1];
    if (last && last.key === key && last.to === d - 1) last.to = d;
    else groups.push({ from: d, to: d, key, names: days[d].map(nameOf).join(' + ') });
  }
  return groups.map((g) => `${g.from === g.to ? WD_SHORT[g.from] : `${WD_SHORT[g.from]}–${WD_SHORT[g.to]}`} ${g.names}`).join(' · ');
}

/** Reparte `total` días entre productos en proporción a su necesidad (mínimo `min` cada uno) por el método del mayor residuo. */
function proportionalDays(total: number, needs: number[], min = 1): number[] {
  const n = needs.length;
  if (total < n * min) return [];
  const sum = needs.reduce((a, b) => a + b, 0);
  const spare = total - n * min;
  const raw = needs.map((x) => spare * (sum > 0 ? x / sum : 1 / n));
  const base = raw.map((r) => Math.floor(r));
  let left = spare - base.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => b.f - a.f);
  for (const o of order) {
    if (left <= 0) break;
    base[o.i] += 1;
    left -= 1;
  }
  return base.map((b) => b + min);
}

export function recommendTemplates(ds: RamoDataset, net: NetPlanRow[], templateId: string, options: TemplateAdvisorOptions): TemplateEvaluation[] {
  const base = ds.templates?.find((t) => t.id === templateId);
  if (!base) return [];
  const c = options.constraints ?? {};
  const blocked = new Set(c.blockedWeekdays ?? []);
  const blockedBySku = c.blockedBySku ?? {};
  const minDaysOf = (id: string) => Math.max(1, c.minDaysPerSku ?? 1, c.minDaysBySku?.[id] ?? 0);
  const weeks = [...new Set(net.map((r) => r.weekStart))].sort().filter((w) => w >= options.fromWeek).slice(0, options.weeks ?? 4);
  if (weeks.length === 0) return [];
  const netW = net.filter((r) => weeks.includes(r.weekStart));
  const skuById = new Map(ds.skus.map((s) => [s.id, s]));
  const lineById = new Map(ds.lines.map((l) => [l.id, l]));
  const hoursOfQty = (skuId: string, qty: number) => {
    const s = skuById.get(skuId)!;
    return toProductiveQty(s, qty) / lineById.get(s.lineId)!.rate.value;
  };

  // Esquema vigente en la primera semana (con los cambios ya hechos).
  const priorOverrides = options.overrides ?? [];
  const only = { ...ds, templates: [base] };
  const current = buildDailySchedule(only, netW.filter((r) => r.weekStart === weeks[0]), { overrides: priorOverrides, rule: options.rule, rules: options.rules }).weeks[0]?.template ?? base;

  const skus = ds.skus.filter((s) => base.lineIds.includes(s.lineId));
  const hoursNeed = skus.map((s) => hoursOfQty(s.id, netW.filter((r) => r.skuId === s.id).reduce((a, r) => a + r.netProduction, 0) / weeks.length));
  const worked = [1, 2, 3, 4, 5, 6, 7].filter((d) => (current.shifts[d] ?? 0) > 0 && !blocked.has(d));
  const withProducts = worked.filter((d) => (current.days[d] ?? []).length > 0);
  const singleLine = base.lineIds.length === 1;

  type Cand = { id: string; label: string; description: string; days: Record<number, string[]> };
  const cands: Cand[] = [{ id: 'current', label: 'Esquema vigente', description: 'El que está configurado hoy.', days: current.days }];
  const add = (id: string, label: string, description: string, days: Record<number, string[]>) => cands.push({ id, label, description, days });

  const blocks = (dayset: number[], order: number[]): Record<number, string[]> | null => {
    const counts = proportionalDays(dayset.length, order.map((i) => hoursNeed[i]), Math.max(1, ...order.map((i) => minDaysOf(skus[i].id))));
    if (counts.length === 0) return null;
    const out: Record<number, string[]> = {};
    let k = 0;
    order.forEach((idx, j) => {
      for (let n = 0; n < counts[j]; n++) out[dayset[k++]] = [skus[idx].id];
    });
    return out;
  };
  const idx = skus.map((_, i) => i);
  const byNeedDesc = [...idx].sort((a, b) => hoursNeed[b] - hoursNeed[a]);
  const firstDay = (i: number) => withProducts.find((d) => (current.days[d] ?? []).includes(skus[i].id)) ?? 99;
  const byCurrent = [...idx].sort((a, b) => firstDay(a) - firstDay(b));

  if (skus.length > 1) {
    const sets: [string, number[], string][] = [
      ['A', withProducts, 'los días con producción actuales'],
      ['B', worked, 'todos los días con turno'],
    ];
    for (const [tag, dayset, text] of sets) {
      if (dayset.length === 0) continue;
      const b1 = blocks([...dayset], byCurrent);
      if (b1) add(`blocks-${tag}`, 'Bloques por producto', `Cada producto en días seguidos, en proporción a lo que necesita (${text}).`, b1);
      const b2 = blocks([...dayset], byNeedDesc);
      if (b2) add(`blocks-need-${tag}`, 'Primero el de mayor volumen', `Bloques seguidos con el producto más grande al inicio de la semana (${text}).`, b2);
      const alt: Record<number, string[]> = {};
      dayset.forEach((d, i) => {
        alt[d] = [skus[byCurrent[i % skus.length]].id];
      });
      add(`alt-${tag}`, 'Alternado', `Un producto distinto cada día, rotando (${text}); más cambios de producto.`, alt);
    }
    if (singleLine) {
      const all: Record<number, string[]> = {};
      for (const d of withProducts) all[d] = skus.map((s) => s.id);
      add('all-days', 'Todos los productos todos los días', 'Sin cambios de producto entre días; las horas del día se reparten entre los productos.', all);
    }
  } else if (skus.length === 1 && worked.length > withProducts.length) {
    const all: Record<number, string[]> = {};
    for (const d of worked) all[d] = [skus[0].id];
    add('use-optional', 'Usar también los turnos opcionales', 'Programa el producto en todos los días que tienen turno, incluidos los opcionales (p. ej. sábado).', all);
  }

  // Búsqueda exhaustiva: un producto por día (o ninguno en los días opcionales), todas las combinaciones que respetan las restricciones.
  const skuName = (id: string) => (skuById.get(id)?.name ?? id).replace(/\s*\(sint\.\)/, '');
  const optional = worked.filter((d) => !withProducts.includes(d));
  let combos = 0;
  if (skus.length > 1 && worked.length > 0) {
    const options = worked.map((d) => [...skus.map((s) => s.id).filter((id) => !(blockedBySku[id] ?? []).includes(d)), ...(optional.includes(d) ? [''] : [])]);
    const total = options.reduce((a, o) => a * o.length, 1);
    if (total > 0 && total <= MAX_COMBINATIONS) {
      const pick: string[] = [];
      const walk = (i: number) => {
        if (i === worked.length) {
          if (skus.every((s) => pick.filter((p) => p === s.id).length >= minDaysOf(s.id))) {
            const days: Record<number, string[]> = {};
            worked.forEach((d, k) => { if (pick[k]) days[d] = [pick[k]]; });
            combos += 1;
            add(`combo-${combos}`, compactLabel(days, skuName), 'Combinación evaluada entre todas las posibles.', days);
          }
          return;
        }
        for (const o of options[i]) { pick[i] = o; walk(i + 1); }
      };
      walk(0);
    }
  }

  // Fuera los que rompen restricciones o la regla de una línea por día, y los repetidos.
  const valid = cands.filter((cd) => {
    // El esquema vigente siempre se muestra (aunque viole una regla: así se ve cuánto mejora el recomendado).
    if (cd.id === 'current') return true;
    for (const [wd, list] of Object.entries(cd.days)) {
      if (list.some((id) => (blockedBySku[id] ?? []).includes(Number(wd)))) return false;
      for (const [a, b] of c.forbiddenTogether ?? []) if (list.includes(a) && list.includes(b)) return false;
      if (!singleLine && new Set(list.map((id) => skuById.get(id)?.lineId)).size > 1) return false;
    }
    return true;
  });
  const seen = new Set<string>();
  const unique = valid.filter((cd) => {
    const k = signature(cd.days);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const curSig = signature(current.days);
  const changedFrom = (days: Record<number, string[]>) => {
    let n = 0;
    for (let d = 1; d <= 7; d++) if (JSON.stringify([...(days[d] ?? [])].sort()) !== JSON.stringify([...(current.days[d] ?? [])].sort())) n += 1;
    return n;
  };

  const evals = unique.map((cd): TemplateEvaluation => {
    const shifts = { ...current.shifts };
    const override: TemplateOverride = { id: `adv-${cd.id}`, templateId, scope: 'FROM', weekStart: weeks[0], days: cd.days, shifts, reason: '', author: '', createdAt: '9999' };
    const result = buildDailySchedule(only, netW, { overrides: [...priorOverrides, override], adjustments: options.adjustments, rule: options.rule, rules: options.rules });
    const cells = result.weeks.flatMap((w) => w.cells);
    const excessHours = cells.reduce((a, x) => a + x.excessHours, 0);
    const unscheduledHours = result.weeks.reduce((a, w) => a + w.unscheduled.reduce((b, u) => b + hoursOfQty(u.skuId, u.qty), 0), 0);
    const changeoverHours = cells.reduce((a, x) => a + x.changeoverHours, 0);
    const crewConflicts = result.alerts.filter((a) => a.code === 'CREW_CONFLICT').length;
    const overDays = cells.filter((x) => x.excessHours > 0.05).length;
    const ruleViolations = result.alerts.filter((a) => a.code === 'RULE_VIOLATION').length;
    const score = (excessHours + unscheduledHours) * 10 + changeoverHours * 2 + crewConflicts * 50 + ruleViolations * 100;
    return {
      id: cd.id, label: cd.label, description: cd.description, days: cd.days, shifts, current: signature(cd.days) === curSig,
      excessHours: round1(excessHours), unscheduledHours: round1(unscheduledHours), changeoverHours: round1(changeoverHours), crewConflicts, overDays, ruleViolations,
      changedDays: changedFrom(cd.days), evaluated: unique.length, score: round1(score), rank: 0, versusCurrent: [], result,
    };
  });

  evals.sort((a, b) => a.score - b.score || a.changedDays - b.changedDays || Number(b.current) - Number(a.current));
  // Se muestran el vigente, las mejoras (hasta 5) y, si no hay ninguna mejor, hasta 2 equivalentes; lo peor solo cuenta en "evaluadas".
  const cur0 = evals.find((e) => e.current);
  const curScore = cur0?.score ?? Infinity;
  const better = evals.filter((e) => !e.current && e.score < curScore - 0.05).slice(0, 5);
  const equal = evals.filter((e) => !e.current && Math.abs(e.score - curScore) <= 0.05).slice(0, better.length > 0 ? 0 : 2);
  const keep = new Set([...better, ...equal, ...evals.filter((e) => e.current)]);
  evals.splice(0, evals.length, ...evals.filter((e) => keep.has(e)));
  evals.forEach((e, i) => {
    e.rank = i + 1;
  });
  const cur = evals.find((e) => e.current);
  if (cur) {
    for (const e of evals) {
      if (e.current) continue;
      const lines: string[] = [];
      const ex = round1(e.excessHours + e.unscheduledHours - (cur.excessHours + cur.unscheduledHours));
      if (Math.abs(ex) >= 0.1) lines.push(ex < 0 ? `${es(-ex)} h menos de exceso de capacidad` : `${es(ex)} h más de exceso de capacidad`);
      const co = round1(e.changeoverHours - cur.changeoverHours);
      if (Math.abs(co) >= 0.1) lines.push(co < 0 ? `${es(-co)} h menos en cambios de producto` : `${es(co)} h más en cambios de producto`);
      const od = e.overDays - cur.overDays;
      if (od !== 0) lines.push(od < 0 ? `${-od} día(s) menos con sobrecarga` : `${od} día(s) más con sobrecarga`);
      if (e.ruleViolations !== cur.ruleViolations) lines.push(e.ruleViolations < cur.ruleViolations ? 'respeta más reglas de planta' : 'viola reglas de planta');
      if (e.crewConflicts !== cur.crewConflicts) lines.push(e.crewConflicts > cur.crewConflicts ? 'genera choques de tripulación' : 'elimina choques de tripulación');
      if (lines.length === 0) lines.push('mismo resultado en horas; cambia solo la forma del esquema');
      e.versusCurrent = lines;
    }
  }
  return evals;
}
