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

export type NodeType = 'CEDI' | 'AGENCY';
/** Prioridad del canal: define el nivel de servicio del stock de seguridad y el orden de los mínimos de cobertura en escasez. */
export type NodePriority = 'HIGH' | 'NORMAL' | 'LOW';

/** Nodo de la red de distribución (planta → CEDI → agencias). */
export interface DistributionNode {
  id: string;
  name: string;
  type: NodeType;
  /** Nodo que lo abastece (las agencias cuelgan del CEDI; el CEDI se abastece de planta). */
  parentId?: string;
  /** Semanas entre liberar la orden y recibir (0 = misma semana). El CEDI lo cuenta desde la planta. */
  leadTimeWeeks: number;
  /** Fracción de la demanda CEDI del SKU que consume el propio nodo (la suma sobre todos los nodos es 1). */
  demandShare: number;
  /** Fracción del inventario de la red que se asume en este nodo (la suma es 1). Supuesto hasta tener MD04/MD5A por nodo. */
  inventoryShare: number;
  priority: NodePriority;
  /** Días de demanda que se protegen primero cuando la producción no alcanza. */
  minCoverDays: number;
  /** Capacidad de almacenamiento del nodo, en cajas (todos los SKUs). */
  storageCapacity: number;
}

export type MaterialType = 'RAW' | 'PACKAGING' | 'MIX';
export type MaterialUnit = 'kg' | 'u' | 'l';

export interface SupplierShare {
  supplier: string;
  /** Cuota reguladora: fracción de cada pedido que se asigna a este proveedor (la suma es 1). */
  share: number;
}

/**
 * Insumo, empaque o mezcla. Las mezclas (`MIX`, p. ej. las de la planta secreta) son ítems de paso: se explotan hacia sus
 * componentes y no llevan inventario ni proveedor propios en este modelo.
 */
export interface Material {
  id: string;
  name: string;
  type: MaterialType;
  unit: MaterialUnit;
  /** Inventario al corte (en `unit`). */
  stock: number;
  /** Plazo de entrega planeado en SAP, en días. */
  leadTimeDays: number;
  /** Días de consumo que se quiere mantener como colchón. */
  safetyDays: number;
  /** Cantidad mínima / múltiplo de pedido. */
  moq: number;
  suppliers: SupplierShare[];
}

/** Línea de la lista de materiales: `quantityPer` unidades del componente por cada unidad del padre (caja si el padre es un SKU). */
export interface BomLine {
  parentId: string;
  componentId: string;
  quantityPer: number;
  /** Merma del componente, en % (la necesidad bruta es quantityPer × (1 + scrapPct/100)). */
  scrapPct: number;
}

/** Orden de compra abierta: recepción programada de un insumo. */
export interface PurchaseOrderLine {
  materialId: string;
  supplier: string;
  dueDate: string;
  qty: number;
}

/** Orden de compra ya recibida: base del plazo real por proveedor y de la cuota efectivamente usada. */
export interface OrderHistoryRow {
  materialId: string;
  supplier: string;
  orderDate: string;
  /** Fecha prometida de entrega (orderDate + el plazo planeado en SAP). */
  promisedDate: string;
  receivedDate: string;
  qty: number;
}

/** Solicitud de pedido (sol.ped.) abierta, aún sin convertirse en orden de compra. */
export interface PurchaseRequisition {
  id: string;
  materialId: string;
  qty: number;
  neededDate: string;
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
  /** Red de distribución; opcional para datasets que no usan DRP. */
  nodes?: DistributionNode[];
  /** Materiales, lista de materiales y órdenes de compra; opcionales para datasets que no usan el tablero de abastecimiento. */
  materials?: Material[];
  bom?: BomLine[];
  purchaseOrders?: PurchaseOrderLine[];
  /** Historial de órdenes recibidas y solicitudes de pedido abiertas (capa de recomendaciones). */
  orderHistory?: OrderHistoryRow[];
  requisitions?: PurchaseRequisition[];
}
