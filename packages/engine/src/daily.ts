import { DailyAdjustment, ProductionTemplate, RamoDataset, TemplateOverride, toProductiveQty } from '@ramo/domain';
import { LoadStatus, statusOf } from './crp';
import { NetPlanRow } from './mps';

/**
 * Programación diaria: baja el plan semanal del MPS a días siguiendo la plantilla de cada línea o grupo de líneas con tripulación
 * compartida (qué producto se hace cada día y con cuántos turnos), y compara cada día con su capacidad.
 *
 * Reglas (supuestos a validar con Producción, ver ADR 0010):
 *  - Cada producto se produce solo en los días de su plantilla que tengan horas disponibles (un festivo o una parada de 0 h no cuenta).
 *  - La cantidad semanal se reparte entre esos días en partes proporcionales a las horas disponibles (EVEN) o "acumulando" la necesidad
 *    de cada día hasta la próxima producción del producto (COVER).
 *  - Las horas de un día son turnos × horas por turno; los festivos y paradas del calendario de la línea las reducen.
 *  - Si el conjunto de productos de un día no repite el del día de producción anterior se pierden `changeoverHours` (aseo o cambio).
 *  - Una tripulación que comparte líneas no puede estar en dos líneas el mismo día (alerta).
 */

export type AllocationRule = 'EVEN' | 'COVER';

export interface DailyOptions {
  overrides?: TemplateOverride[];
  adjustments?: DailyAdjustment[];
  rule?: AllocationRule;
}

export interface DailyCell {
  date: string;
  weekday: number;
  templateId: string;
  lineId: string;
  /** Productos programados ese día en la línea (por la plantilla o por ajustes). */
  skuIds: string[];
  /** Cajas por producto ese día. */
  qty: Record<string, number>;
  requiredHours: number;
  /** Horas disponibles ya descontado el cambio de producto. */
  availableHours: number;
  changeoverHours: number;
  saturationPct: number;
  excessHours: number;
  status: LoadStatus;
  adjusted: boolean;
  crewConflict: boolean;
}

export interface DailyDay {
  date: string;
  weekday: number;
  shifts: number;
  /** Horas disponibles ese día (la mayor entre las líneas de la plantilla). */
  hours: number;
  /** Alguna línea tiene un cierre de 0 horas ese día aunque la plantilla lo trabaja. */
  closed: boolean;
  skuIds: string[];
}

export interface DailyUnscheduled {
  skuId: string;
  qty: number;
  reason: 'NO_PRODUCTION_DAY' | 'NOT_IN_TEMPLATE';
}

export interface DailyWeek {
  weekStart: string;
  templateId: string;
  /** Plantilla vigente esa semana (con los cambios aplicados). */
  template: ProductionTemplate;
  overridden: boolean;
  days: DailyDay[];
  cells: DailyCell[];
  unscheduled: DailyUnscheduled[];
  requiredHours: number;
  /** Horas que la plantilla puede dar esa semana (una línea a la vez). */
  capacityHours: number;
  excessHours: number;
}

export type DailyAlertCode = 'OVER_CAPACITY' | 'NO_PRODUCTION_DAY' | 'NOT_IN_TEMPLATE' | 'CREW_CONFLICT';

export interface DailyAlert {
  code: DailyAlertCode;
  weekStart: string;
  templateId: string;
  date?: string;
  lineId?: string;
  skuId?: string;
  /** OVER_CAPACITY: horas que faltan. Sin día / fuera de plantilla: cajas. CREW_CONFLICT: líneas en conflicto. */
  value: number;
}

export interface DailyResult {
  weeks: DailyWeek[];
  alerts: DailyAlert[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const EPS = 1e-6;

const addDaysIso = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** 1 = lunes … 7 = domingo */
export const weekdayOf = (iso: string): number => {
  const d = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
};

/** Plantilla vigente en una semana: un cambio de esa semana manda sobre uno "desde" una semana anterior; entre iguales gana el más reciente. */
export function effectiveTemplate(base: ProductionTemplate, overrides: TemplateOverride[], weekStart: string): { template: ProductionTemplate; overridden: boolean } {
  const mine = overrides.filter((o) => o.templateId === base.id);
  const week = mine.filter((o) => o.scope === 'WEEK' && o.weekStart === weekStart).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const from = mine
    .filter((o) => o.scope === 'FROM' && o.weekStart <= weekStart)
    .sort((a, b) => b.weekStart.localeCompare(a.weekStart) || b.createdAt.localeCompare(a.createdAt))[0];
  const o = week ?? from;
  if (!o) return { template: base, overridden: false };
  return { template: { ...base, days: o.days, shifts: o.shifts }, overridden: true };
}

/** Horas disponibles de una línea un día: turnos × horas por turno, reducidas por festivos y paradas del calendario de la línea. */
export function dayAvailableHours(ds: RamoDataset, t: ProductionTemplate, lineId: string, date: string): number {
  const base = (t.shifts[weekdayOf(date)] ?? 0) * t.hoursPerShift;
  if (base <= 0) return 0;
  const cal = ds.calendars.find((c) => c.lineId === lineId);
  const ex = cal?.exceptions.find((e) => e.date === date);
  if (!ex) return base;
  if (ex.hours <= 0) return 0;
  if (ex.reason === 'EXTENDED') return base + Math.max(0, ex.hours - (cal?.baseHoursPerDay ?? 0));
  return Math.min(base, ex.hours);
}

const key = (lineId: string, date: string) => `${lineId}|${date}`;

export function buildDailySchedule(ds: RamoDataset, net: NetPlanRow[], options: DailyOptions = {}): DailyResult {
  const templates = ds.templates ?? [];
  const overrides = options.overrides ?? [];
  const adjustments = options.adjustments ?? [];
  const rule = options.rule ?? 'EVEN';
  const weeks = [...new Set(net.map((r) => r.weekStart))].sort();
  const skuById = new Map(ds.skus.map((s) => [s.id, s]));
  const lineById = new Map(ds.lines.map((l) => [l.id, l]));
  const out: DailyWeek[] = [];
  const alerts: DailyAlert[] = [];

  for (const weekStart of weeks) {
    const dates = Array.from({ length: 7 }, (_, i) => addDaysIso(weekStart, i));
    for (const base of templates) {
      const { template: t, overridden } = effectiveTemplate(base, overrides, weekStart);
      const templateSkus = ds.skus.filter((s) => t.lineIds.includes(s.lineId));
      const cellMap = new Map<string, DailyCell>();
      const unscheduled: DailyUnscheduled[] = [];

      const cellFor = (lineId: string, date: string): DailyCell => {
        const k = key(lineId, date);
        let c = cellMap.get(k);
        if (!c) {
          c = { date, weekday: weekdayOf(date), templateId: t.id, lineId, skuIds: [], qty: {}, requiredHours: 0, availableHours: 0, changeoverHours: 0, saturationPct: 0, excessHours: 0, status: 'OK', adjusted: false, crewConflict: false };
          cellMap.set(k, c);
        }
        return c;
      };

      // 1) Reparto de la cantidad semanal entre los días de producción de cada producto.
      for (const sku of templateSkus) {
        const q = net.find((r) => r.skuId === sku.id && r.weekStart === weekStart)?.netProduction ?? 0;
        const planned = dates.filter((d) => (t.days[weekdayOf(d)] ?? []).includes(sku.id));
        const usable = planned.filter((d) => dayAvailableHours(ds, t, sku.lineId, d) > EPS);
        // Se marcan en la celda aunque la cantidad sea 0, para que la plantilla se vea completa.
        for (const d of planned) {
          const c = cellFor(sku.lineId, d);
          if (!c.skuIds.includes(sku.id)) c.skuIds.push(sku.id);
        }
        if (q <= EPS) continue;
        if (usable.length === 0) {
          unscheduled.push({ skuId: sku.id, qty: q, reason: planned.length === 0 ? 'NOT_IN_TEMPLATE' : 'NO_PRODUCTION_DAY' });
          continue;
        }
        let weights: number[];
        if (rule === 'COVER') {
          const wds = usable.map(weekdayOf);
          weights = wds.map((wd, i) => (i < wds.length - 1 ? wds[i + 1] - wd : wds[0] + 7 - wd));
        } else {
          // Si varios productos de la misma línea comparten un día, las horas de ese día se reparten entre ellos.
          const sharing = (d: string) =>
            Math.max(1, templateSkus.filter((o) => o.lineId === sku.lineId && (t.days[weekdayOf(d)] ?? []).includes(o.id)).length);
          weights = usable.map((d) => dayAvailableHours(ds, t, sku.lineId, d) / sharing(d));
        }
        const total = weights.reduce((a, b) => a + b, 0);
        usable.forEach((d, i) => {
          const c = cellFor(sku.lineId, d);
          c.qty[sku.id] = (c.qty[sku.id] ?? 0) + (q * weights[i]) / total;
        });
      }

      // 2) Ajustes manuales del día.
      for (const a of adjustments) {
        const sku = skuById.get(a.skuId);
        if (!sku || !t.lineIds.includes(sku.lineId) || !dates.includes(a.date)) continue;
        const c = cellFor(sku.lineId, a.date);
        c.qty[sku.id] = Math.max(0, (c.qty[sku.id] ?? 0) + a.deltaCommercialQty);
        c.adjusted = true;
        if (!c.skuIds.includes(sku.id) && (c.qty[sku.id] ?? 0) > 0) c.skuIds.push(sku.id);
      }

      // 3) Cambio de producto: se pierde tiempo cuando el conjunto de productos del día no repite el del día de producción anterior.
      const setOf = (date: string) => {
        const ids = new Set<string>();
        for (const c of cellMap.values()) if (c.date === date) c.skuIds.forEach((s) => ids.add(s));
        return [...ids].sort().join(',');
      };
      const prodDates = dates.filter((d) => setOf(d) !== '' && t.lineIds.some((l) => dayAvailableHours(ds, t, l, d) > EPS));
      const changeover = new Map<string, number>();
      if (t.changeoverHours > 0 && prodDates.length > 1) {
        prodDates.forEach((d, i) => {
          const prev = prodDates[(i + prodDates.length - 1) % prodDates.length];
          if (setOf(d) !== setOf(prev)) changeover.set(d, t.changeoverHours);
        });
      }

      // 4) Carga y capacidad por celda.
      for (const c of cellMap.values()) {
        const line = lineById.get(c.lineId)!;
        c.requiredHours = Object.entries(c.qty).reduce((a, [sid, q]) => a + toProductiveQty(skuById.get(sid)!, q) / line.rate.value, 0);
        const avail = dayAvailableHours(ds, t, c.lineId, c.date);
        c.changeoverHours = avail > EPS && c.skuIds.length > 0 ? Math.min(avail, changeover.get(c.date) ?? 0) : 0;
        c.availableHours = Math.max(0, avail - c.changeoverHours);
        const planned = Object.values(c.qty).some((q) => q > EPS);
        c.saturationPct = c.availableHours > EPS ? (c.requiredHours / c.availableHours) * 100 : planned ? 999 : 0;
        c.excessHours = planned ? Math.max(0, c.requiredHours - c.availableHours) : 0;
        c.status = planned ? statusOf(c.saturationPct) : 'OK';
      }

      // 5) Tripulación en dos líneas el mismo día.
      if (t.lineIds.length > 1) {
        for (const d of dates) {
          const active = [...cellMap.values()].filter((c) => c.date === d && Object.values(c.qty).some((q) => q > EPS));
          const lineSet = new Set(active.map((c) => c.lineId));
          if (lineSet.size > 1) {
            active.forEach((c) => { c.crewConflict = true; });
            alerts.push({ code: 'CREW_CONFLICT', weekStart, templateId: t.id, date: d, value: lineSet.size });
          }
        }
      }

      const cells = [...cellMap.values()].sort((a, b) => a.date.localeCompare(b.date) || a.lineId.localeCompare(b.lineId));
      for (const c of cells) {
        if (c.excessHours > 0.05) alerts.push({ code: 'OVER_CAPACITY', weekStart, templateId: t.id, date: c.date, lineId: c.lineId, value: round1(c.excessHours) });
      }
      for (const u of unscheduled) alerts.push({ code: u.reason, weekStart, templateId: t.id, skuId: u.skuId, value: Math.round(u.qty) });

      const days: DailyDay[] = dates.map((d) => {
        const hours = Math.max(0, ...t.lineIds.map((l) => dayAvailableHours(ds, t, l, d)));
        const baseHours = (t.shifts[weekdayOf(d)] ?? 0) * t.hoursPerShift;
        return { date: d, weekday: weekdayOf(d), shifts: t.shifts[weekdayOf(d)] ?? 0, hours, closed: baseHours > 0 && hours <= EPS, skuIds: [...new Set(cells.filter((c) => c.date === d).flatMap((c) => c.skuIds))] };
      });

      out.push({
        weekStart,
        templateId: t.id,
        template: t,
        overridden,
        days,
        cells,
        unscheduled,
        requiredHours: round1(cells.reduce((a, c) => a + c.requiredHours, 0)),
        // Solo los días con productos en la plantilla; un turno disponible sin producto (p. ej. un sábado opcional) es holgura que el optimizador puede usar.
        capacityHours: round1(days.filter((d) => (t.days[d.weekday] ?? []).length > 0).reduce((a, d) => a + d.hours, 0)),
        excessHours: round1(cells.reduce((a, c) => a + c.excessHours, 0)),
      });
    }
  }
  return { weeks: out, alerts };
}

// ------------------------------------------------------------------------------------------------------------------------
// Optimizador diario (sugerencia, no decisión)
// ------------------------------------------------------------------------------------------------------------------------

export interface DailyMove {
  skuId: string;
  fromDate: string;
  toDate: string;
  qty: number;
  hours: number;
  /** PRODUCTION_DAY: el producto ya se produce ese día. NEW_DAY: se agrega un día de producción que la plantilla no tenía. */
  kind: 'PRODUCTION_DAY' | 'NEW_DAY';
}

export interface DailyExtra {
  templateId: string;
  lineId: string;
  date: string;
  hours: number;
}

export interface DailyBalancePlan {
  moves: DailyMove[];
  extra: DailyExtra[];
  /** Combinaciones línea-día sobre capacidad antes de la sugerencia. */
  overloaded: number;
  excessBefore: number;
  movedHours: number;
  extraTotal: number;
}

export interface DailyBalanceOptions {
  /** Se llena cada día receptor hasta este % de su capacidad (por defecto 98 %). */
  fillToPct?: number;
}

/**
 * Para cada día de una línea sobre su capacidad intenta pasar producción a otro día de la misma semana con holgura: primero a un día en
 * que el producto ya se produce, y si no alcanza a un día nuevo en que la tripulación esté libre; el día anterior más cercano primero
 * (produce antes de que se necesite), luego los posteriores. Lo que no cabe queda como horas extra. Heurística voraz, no un óptimo.
 */
export function suggestDailyBalance(ds: RamoDataset, result: DailyResult, options: DailyBalanceOptions = {}): DailyBalancePlan {
  const fill = (options.fillToPct ?? 98) / 100;
  const skuById = new Map(ds.skus.map((s) => [s.id, s]));
  const lineById = new Map(ds.lines.map((l) => [l.id, l]));
  const hpc = (skuId: string) => {
    const s = skuById.get(skuId)!;
    return toProductiveQty(s, 1) / lineById.get(s.lineId)!.rate.value;
  };
  const moves = new Map<string, DailyMove>();
  const extra: DailyExtra[] = [];
  let overloaded = 0;
  let excessBefore = 0;
  let movedHours = 0;

  for (const w of result.weeks) {
    const t = w.template;
    // Estado de trabajo por celda (línea-día): cajas por producto y horas disponibles.
    const work = new Map<string, { qty: Record<string, number>; avail: number }>(
      w.cells.map((c) => [key(c.lineId, c.date), { qty: { ...c.qty }, avail: c.availableHours }]),
    );
    const hoursOf = (k: string) => Object.entries(work.get(k)?.qty ?? {}).reduce((a, [sid, q]) => a + q * hpc(sid), 0);
    const crewBusy = (lineId: string, date: string) =>
      t.lineIds.some((l) => l !== lineId && Object.values(work.get(key(l, date))?.qty ?? {}).some((q) => q > EPS));

    const over = w.cells.filter((c) => c.excessHours > 0.05).sort((a, b) => a.date.localeCompare(b.date));
    for (const c of over) {
      overloaded += 1;
      excessBefore += c.excessHours;
      const fromKey = key(c.lineId, c.date);
      let excess = hoursOf(fromKey) - (work.get(fromKey)?.avail ?? 0);
      const skus = Object.keys(c.qty).filter((s) => (work.get(fromKey)?.qty[s] ?? 0) > EPS).sort((a, b) => (work.get(fromKey)!.qty[b] * hpc(b)) - (work.get(fromKey)!.qty[a] * hpc(a)));

      for (const sid of skus) {
        if (excess <= 0.05) break;
        const wdFrom = weekdayOf(c.date);
        const dist = (d: string) => Math.abs(weekdayOf(d) - wdFrom);
        const earlier = (d: string) => (d < c.date ? 0 : 1);
        const days = w.days.map((d) => d.date).filter((d) => d !== c.date);
        const productionDays = days.filter((d) => (t.days[weekdayOf(d)] ?? []).includes(sid));
        const freeDays = days.filter((d) => !productionDays.includes(d));
        const order = (list: string[]) => [...list].sort((a, b) => earlier(a) - earlier(b) || dist(a) - dist(b));
        const candidates = [...order(productionDays).map((d) => ({ d, kind: 'PRODUCTION_DAY' as const })), ...order(freeDays).map((d) => ({ d, kind: 'NEW_DAY' as const }))];

        for (const { d, kind } of candidates) {
          if (excess <= 0.05) break;
          const dayAvail = dayAvailableHours(ds, t, c.lineId, d);
          if (dayAvail <= EPS || crewBusy(c.lineId, d)) continue;
          const tk = key(c.lineId, d);
          const existing = work.get(tk);
          const cap = existing ? existing.avail : Math.max(0, dayAvail - (kind === 'NEW_DAY' ? t.changeoverHours : 0));
          const slack = cap * fill - hoursOf(tk);
          if (slack <= EPS) continue;
          const have = work.get(fromKey)!.qty[sid] ?? 0;
          const hours = Math.min(excess, slack, have * hpc(sid));
          const qty = Math.floor(hours / hpc(sid));
          if (qty <= 0) continue;
          work.get(fromKey)!.qty[sid] = have - qty;
          const target = existing ?? { qty: {}, avail: cap };
          target.qty[sid] = (target.qty[sid] ?? 0) + qty;
          work.set(tk, target);
          const mk = `${sid}|${c.date}|${d}`;
          const h = qty * hpc(sid);
          const prev = moves.get(mk);
          if (prev) { prev.qty += qty; prev.hours += h; }
          else moves.set(mk, { skuId: sid, fromDate: c.date, toDate: d, qty, hours: h, kind });
          excess -= h;
          movedHours += h;
        }
      }
      if (excess > 0.05) extra.push({ templateId: t.id, lineId: c.lineId, date: c.date, hours: Math.ceil(excess * 2) / 2 });
    }
  }

  const list = [...moves.values()].map((m) => ({ ...m, hours: round1(m.hours) })).sort((a, b) => a.fromDate.localeCompare(b.fromDate) || a.skuId.localeCompare(b.skuId));
  return { moves: list, extra, overloaded, excessBefore: round1(excessBefore), movedHours: round1(movedHours), extraTotal: round1(extra.reduce((a, e) => a + e.hours, 0)) };
}

/** Convierte los movimientos diarios en ajustes (resta en el día origen, suma en el destino). */
export function dailyMovesToAdjustments(moves: DailyMove[]): { skuId: string; date: string; deltaCommercialQty: number }[] {
  return moves.flatMap((m) => [
    { skuId: m.skuId, date: m.fromDate, deltaCommercialQty: -m.qty },
    { skuId: m.skuId, date: m.toDate, deltaCommercialQty: m.qty },
  ]);
}
