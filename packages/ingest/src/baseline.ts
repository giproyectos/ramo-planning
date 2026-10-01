import { RamoDataset } from '@ramo/domain';
import { BaseName, IngestContext, IngestIssue } from './common';
import { inDispatchWindow, parseDispatch } from './dispatch';
import { parseMovements, parseStock } from './inventory';
import { analyzeSupply, parseSupply } from './supply';

export interface IngestTexts {
  stock?: string;
  movimientos?: string;
  abastecimiento?: string;
  despachos?: string;
}

export interface SkuBaseline {
  skuId: string;
  stockCommercial: number;
  /** Envíos de triangulación que aún no llegan a un destino final. */
  inTransitCommercial: number;
  /** Pedidos por entregar dentro de la ventana de la consulta Z (8 am–2 pm por defecto). */
  pendingDispatchCommercial: number;
  /** Pedidos por entregar fuera de esa ventana (informativo). */
  pendingOutsideWindowCommercial: number;
  /** Salidas netas del último mes (cajas, positivo). */
  outflowCommercial: number;
  /** Días de cobertura = stock ÷ salida diaria promedio; null si no hay salidas. */
  coverageDays: number | null;
  /** Lo que el planeador puede considerar disponible: stock + en tránsito − pendiente de despacho (mín. 0). */
  availableCommercial: number;
}

export type BaseStatus = 'ok' | 'missing' | 'failed';

export interface Baseline {
  cutAt: string;
  skus: SkuBaseline[];
  status: Record<BaseName, BaseStatus>;
  rowCounts: Record<BaseName, number>;
  issues: IngestIssue[];
  /** true si ninguna base obligatoria falló. Las bases ausentes aportan cero y se avisan. */
  usable: boolean;
}

const BASES: BaseName[] = ['stock', 'movimientos', 'abastecimiento', 'despachos'];
const round = (n: number) => Math.round(n * 10) / 10;

/** Lee las bases del lunes, las valida y arma el estado base por SKU. */
export function ingestBaseline(ctx: IngestContext, texts: IngestTexts): Baseline {
  const issues: IngestIssue[] = [];
  const status = {} as Record<BaseName, BaseStatus>;
  const rowCounts = {} as Record<BaseName, number>;
  for (const b of BASES) { status[b] = 'missing'; rowCounts[b] = 0; }

  const stock = texts.stock !== undefined ? parseStock(texts.stock, ctx) : null;
  const movs = texts.movimientos !== undefined ? parseMovements(texts.movimientos, ctx) : null;
  const supply = texts.abastecimiento !== undefined ? parseSupply(texts.abastecimiento, ctx) : null;
  const disp = texts.despachos !== undefined ? parseDispatch(texts.despachos, ctx) : null;

  const record = <T>(base: BaseName, r: { rows: T[]; issues: IngestIssue[]; ok: boolean } | null) => {
    if (!r) {
      issues.push({ severity: base === 'stock' ? 'error' : 'warning', base, code: 'MISSING_BASE', message: `No se cargó la base "${base}"` });
      return;
    }
    status[base] = r.ok ? 'ok' : 'failed';
    rowCounts[base] = r.rows.length;
    issues.push(...r.issues);
  };
  record('stock', stock);
  record('movimientos', movs);
  record('abastecimiento', supply);
  record('despachos', disp);

  const finals = ctx.finalDestinations ?? ['0060', 'CUSTOMER'];
  const analysis = supply?.ok ? analyzeSupply(supply.rows, finals) : null;
  if (analysis) issues.push(...analysis.issues);

  // Conciliación: stock al corte − Σ movimientos de la ventana = stock implícito de apertura (no puede ser negativo).
  const movBySku = new Map<string, number>();
  const outflowBySku = new Map<string, number>();
  for (const r of movs?.ok ? movs.rows : []) {
    movBySku.set(r.skuId, (movBySku.get(r.skuId) ?? 0) + r.commercialQty);
    if (r.commercialQty < 0) outflowBySku.set(r.skuId, (outflowBySku.get(r.skuId) ?? 0) - r.commercialQty);
  }
  const stockBySku = new Map<string, number>();
  for (const r of stock?.ok ? stock.rows : []) stockBySku.set(r.skuId, (stockBySku.get(r.skuId) ?? 0) + r.commercialQty);

  if (stock?.ok && movs?.ok) {
    for (const [skuId, moved] of movBySku) {
      const opening = (stockBySku.get(skuId) ?? 0) - moved;
      if (opening < -0.5) {
        issues.push({ severity: 'warning', base: 'movimientos', code: 'IMPLIED_NEGATIVE_OPENING', message: `${skuId}: el stock al corte menos los movimientos del mes deja un inventario inicial negativo (${Math.round(opening)} cajas). Revisa si faltan movimientos o hay stock mal cargado.` });
      }
    }
  }

  const pendingIn = new Map<string, number>();
  const pendingOut = new Map<string, number>();
  for (const r of disp?.ok ? disp.rows : []) {
    const target = inDispatchWindow(r.time, ctx.dispatchWindow) ? pendingIn : pendingOut;
    target.set(r.skuId, (target.get(r.skuId) ?? 0) + r.pendingCommercial);
  }

  const days = ctx.movementWindowDays ?? 31;
  const skus: SkuBaseline[] = ctx.dataset.skus.map((s) => {
    const st = stockBySku.get(s.id) ?? 0;
    const tr = analysis?.inTransitBySku[s.id] ?? 0;
    const pd = pendingIn.get(s.id) ?? 0;
    const po = pendingOut.get(s.id) ?? 0;
    const out = outflowBySku.get(s.id) ?? 0;
    return {
      skuId: s.id,
      stockCommercial: round(st),
      inTransitCommercial: round(tr),
      pendingDispatchCommercial: round(pd),
      pendingOutsideWindowCommercial: round(po),
      outflowCommercial: round(out),
      coverageDays: out > 0 ? round(st / (out / days)) : null,
      availableCommercial: Math.max(0, Math.round(st + tr - pd)),
    };
  });

  const usable = status.stock === 'ok' && !issues.some((i) => i.severity === 'error' && i.code === 'MISSING_COLUMN');
  return { cutAt: ctx.cutAt, skus, status, rowCounts, issues, usable };
}

/** Devuelve un dataset cuyo inventario es el disponible de la línea base (insumo del neto del MPS). */
export function applyBaseline(ds: RamoDataset, baseline: Baseline): RamoDataset {
  return {
    ...ds,
    inventory: baseline.skus.map((s) => ({ skuId: s.skuId, onHandCommercial: s.availableCommercial })),
  };
}

/** Cuenta los problemas por severidad y código (para mostrarlos agrupados). */
export function summarizeIssues(issues: IngestIssue[]): { severity: IngestIssue['severity']; base: BaseName; code: string; count: number; example: string }[] {
  const map = new Map<string, { severity: IngestIssue['severity']; base: BaseName; code: string; count: number; example: string }>();
  for (const i of issues) {
    const k = `${i.severity}|${i.base}|${i.code}`;
    const cur = map.get(k);
    if (cur) cur.count++;
    else map.set(k, { severity: i.severity, base: i.base, code: i.code, count: 1, example: i.message });
  }
  const order = { error: 0, warning: 1, info: 2 } as const;
  return [...map.values()].sort((a, b) => order[a.severity] - order[b.severity] || b.count - a.count);
}
