// Modelo de dominio de Ramo (Fase 1). Las cantidades de demanda se expresan en unidades comerciales.
// Fechas: 'YYYY-MM-DD'. Una semana se identifica por su lunes (weekStart).

export type Role = 'demand' | 'distribution' | 'production';

/** Flujos de demanda que entran al plan. HD y EXPORT son make-to-order y rompen el algoritmo del DRP. */
export type DemandFlow = 'CEDI' | 'HARD_DISCOUNT' | 'EXPORT';
export const MAKE_TO_ORDER_FLOWS: ReadonlySet<DemandFlow> = new Set<DemandFlow>(['HARD_DISCOUNT', 'EXPORT']);

export type ProductiveUnit = 'u' | 'kg';
export type RateUnit = 'u/h' | 'kg/h';

export interface Plant {
  id: string;
  name: string;
  /** Código de centro en SAP (para generar archivos de salida). */
  sapCenter?: string;
}

/** Línea de producción completa. SAP solo conoce puestos de trabajo; la línea es un dato nuevo (ver docs/mapeo-sap.md). */
export interface Line {
  id: string;
  name: string;
  plantId: string;
  crewId: string;
  rate: { value: number; unit: RateUnit };
}

/** Tripulación. Varias líneas pueden compartirla (p. ej. maicitos y tostadas). */
export interface Crew {
  id: string;
  name: string;
  lineIds: string[];
}

export type CalendarExceptionReason = 'HOLIDAY' | 'MAINTENANCE' | 'PLANT_STOP' | 'EXTENDED';

export interface CalendarException {
  date: string;
  /** Horas disponibles ese día (0 = sin producción). Para EXTENDED, el total del día. */
  hours: number;
  reason: CalendarExceptionReason;
  note?: string;
}

export interface LineCalendar {
  lineId: string;
  /** 1 = lunes … 7 = domingo */
  workingWeekdays: number[];
  baseHoursPerDay: number;
  exceptions: CalendarException[];
}

export interface Sku {
  id: string;
  /** Código de material en SAP (en sintéticos, ficticio). */
  sapMaterial: string;
  name: string;
  family: string;
  businessUnit: string;
  brand: string;
  /** "Perfil general" de SAP: amarra el producto a su línea. */
  lineId: string;
  commercialUnit: string;
  productiveUnit: ProductiveUnit;
  /** Unidades productivas (u o kg) por unidad comercial. */
  productiveUnitsPerCommercial: number;
  kgPerCommercial: number;
  costPerCommercial: number;
}

export type PlanVersionKind = 'PBO_MONTHLY' | 'WEEKLY_N1' | 'CRP_PROPOSAL' | 'MPS_FINAL';

export interface PlanVersion {
  id: string;
  kind: PlanVersionKind;
  label: string;
  createdAt: string;
  createdByRole: Role;
  /** Versión de la que se deriva (trazabilidad del ciclo CRP ↔ MPS). */
  basedOn?: string;
}

export interface DemandRecord {
  versionId: string;
  skuId: string;
  weekStart: string;
  flow: DemandFlow;
  commercialQty: number;
}

export interface BuildingBlockScope {
  skuId?: string;
  family?: string;
  businessUnit?: string;
  weekStart?: string;
  flow?: DemandFlow;
}

/** Ajuste colaborativo trazable sobre una versión de demanda. */
export interface BuildingBlock {
  id: string;
  versionId: string;
  scope: BuildingBlockScope;
  deltaCommercialQty: number;
  reason: string;
  author: string;
  role: Role;
  createdAt: string;
}

/** Venta histórica semanal por SKU y flujo (cajas). `priorForecast` es el pronóstico que el proceso vigente emitió para esa semana. */
export interface DemandHistoryRow {
  skuId: string;
  weekStart: string;
  flow: DemandFlow;
  commercialQty: number;
  priorForecast: number | null;
}

/** Inventario disponible al corte (en unidades comerciales). */
export interface InventoryPosition {
  skuId: string;
  onHandCommercial: number;
}

/** Orden de producción abierta / en curso que ya cubre demanda futura. */
export interface OpenOrder {
  skuId: string;
  weekStart: string;
  commercialQty: number;
}

/** Ajuste de Daniel (MPS final) sobre la producción neta de un SKU en una semana. */
export interface MpsAdjustment {
  id: string;
  skuId: string;
  weekStart: string;
  deltaCommercialQty: number;
  reason: string;
  author: string;
  createdAt: string;
}

/** Decisión de capacidad de Miguel/Alejandro: horas extra en una tripulación una semana. */
export interface CapacityDecision {
  id: string;
  crewId: string;
  weekStart: string;
  extraHours: number;
  reason: string;
  author: string;
  createdAt: string;
}

export interface RamoDataset {
  synthetic: boolean;
  plants: Plant[];
  crews: Crew[];
  lines: Line[];
  calendars: LineCalendar[];
  skus: Sku[];
  versions: PlanVersion[];
  demand: DemandRecord[];
  buildingBlocks: BuildingBlock[];
  inventory: InventoryPosition[];
  openOrders: OpenOrder[];
}
