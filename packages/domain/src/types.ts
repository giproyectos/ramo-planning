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

/** Ajuste de Distribución (MPS final) sobre la producción neta de un SKU en una semana. */
export interface MpsAdjustment {
  id: string;
  skuId: string;
  weekStart: string;
  deltaCommercialQty: number;
  reason: string;
  author: string;
  createdAt: string;
}

/** Decisión de capacidad (Producción): horas extra en una tripulación una semana. */
export interface CapacityDecision {
  id: string;
  crewId: string;
  weekStart: string;
  extraHours: number;
  reason: string;
  author: string;
  createdAt: string;
}

/**
 * Plantilla semanal de programación: qué producto se produce cada día de la semana en una línea (o en varias líneas que comparten
 * tripulación y se turnan) y con cuántos turnos. Es el "esquema de producción" que hoy se maneja a mano en Excel.
 */
export interface ProductionTemplate {
  id: string;
  name: string;
  /** Tripulación que ejecuta la plantilla. */
  crewId: string;
  /** Líneas de la plantilla. Si hay más de una, la tripulación se turna entre ellas (una por día). */
  lineIds: string[];
  /** 1 = lunes … 7 = domingo → productos (SKU) que se producen ese día. Un día sin entrada no se produce. */
  days: Record<number, string[]>;
  /** 1 = lunes … 7 = domingo → turnos ese día (0 = no se trabaja). */
  shifts: Record<number, number>;
  hoursPerShift: number;
  /** Horas que se pierden (aseo, cambio de sabor o de producto) cuando el día no repite lo que se produjo el día de producción anterior. */
  changeoverHours: number;
}

/** Cambio a una plantilla: para una sola semana o desde una semana en adelante (siempre). El más reciente que aplique manda. */
export interface TemplateOverride {
  id: string;
  templateId: string;
  /** 'WEEK' = solo la semana `weekStart`; 'FROM' = desde `weekStart` en adelante (hasta `untilWeek` si se indica). */
  scope: 'WEEK' | 'FROM';
  weekStart: string;
  /** Solo con 'FROM': última semana (lunes, inclusive) en que rige el cambio. Sin ella rige hasta que otro cambio lo reemplace. */
  untilWeek?: string;
  days: Record<number, string[]>;
  shifts: Record<number, number>;
  /** Por qué cambia el esquema (para poder analizar las causas más frecuentes). */
  cause?: ChangeCause;
  reason: string;
  author: string;
  createdAt: string;
}

export type ChangeCause = 'PACKAGING' | 'STAFF' | 'EQUIPMENT' | 'FOCUS' | 'OTHER';

/** Ajuste manual de cajas de un producto en un día concreto de la programación diaria (positivo suma, negativo resta). */
export interface DailyAdjustment {
  id: string;
  skuId: string;
  date: string;
  deltaCommercialQty: number;
  reason: string;
  author: string;
  createdAt: string;
}

/** Historial de un día de una línea: horas programadas, horas productivas logradas (a ritmo nominal) y horas perdidas por paradas. */
export interface LineDayHistory {
  lineId: string;
  date: string;
  scheduledHours: number;
  /** Producción lograda expresada en horas a ritmo nominal. */
  effectiveHours: number;
  stoppageHours: number;
}

/** Confirmación de Producción de lo que cada planta puede fabricar de un producto en una semana. Solo se añade: la vigente es la más reciente. */
export interface PlantConfirmation {
  id: string;
  skuId: string;
  weekStart: string;
  /** Cajas que pedía el MPS cuando se confirmó. */
  plannedQty: number;
  /** Cajas que Producción confirma que sí puede fabricar. */
  confirmedQty: number;
  reason: string;
  author: string;
  createdAt: string;
}

/** Cajas entregadas (producidas) de un producto en una semana, para el seguimiento contra lo confirmado. Se suman. */
export interface PlantDelivery {
  id: string;
  skuId: string;
  weekStart: string;
  qty: number;
  note: string;
  author: string;
  createdAt: string;
}

/** Cambio de calendario hecho en la aplicación: festivo, mantenimiento, parada no programada, cierre o turno extendido en una o varias líneas. */
export interface CalendarEdit {
  id: string;
  lineIds: string[];
  date: string;
  /** Horas disponibles ese día (0 = cerrado). Para EXTENDED, el total del día. */
  hours: number;
  reason: CalendarExceptionReason;
  note: string;
  author: string;
  createdAt: string;
}

/** Regla de planta que el esquema debe respetar. */
export type PlantRuleSpec =
  | { kind: 'NO_TOGETHER'; skuA: string; skuB: string }
  | { kind: 'NO_WEEKDAY'; skuId: string; weekday: number }
  | { kind: 'MIN_DAYS'; skuId: string; days: number }
  | { kind: 'CHANGEOVER'; skuA: string; skuB: string; hours: number };

export type PlantRule = PlantRuleSpec & { id: string; reason: string; author: string; createdAt: string };

/** Escenario de programación guardado: los cambios de un borrador de la mesa con nombre, para compararlos con el plan vigente y con otros. */
export interface ScenarioRecord {
  id: string;
  name: string;
  author: string;
  createdAt: string;
  scope: 'WEEK' | 'FROM';
  /** Semanas de vigencia de los cambios de esquema «desde» (null = sin fin). */
  until: number | null;
  moves: { id: string; skuId: string; fromDate: string; toDate: string; qty: number }[];
  schemes: { templateId: string; weekStart: string; days: Record<number, string[]>; shifts: Record<number, number>; source: string }[];
  calendar: { id: string; lineIds: string[]; date: string; hours: number; reason: CalendarExceptionReason; note: string }[];
}

export interface ReleaseFile {
  name: string;
  kind: 'DAILY_PLAN' | 'CONFIRMATIONS' | 'PROVISIONAL_ORDERS' | 'ORDER_DELETIONS';
  plantId?: string;
  csv: string;
}

/** Plan oficial liberado: una versión numerada con los archivos tal como salieron, quién lo liberó y cómo estaba el plan en ese momento. */
export interface ReleaseRecord {
  id: string;
  version: number;
  author: string;
  note: string;
  createdAt: string;
  weekFrom: string;
  weekTo: string;
  /** Cómo estaba el plan al liberarlo. */
  summary: { mpsQty: number; pendingPlants: number; shortfall: number; redWeeks: number; dailyRedWeeks: number; ruleViolations: number; adjustments: number };
  /** Se liberó con pendientes y se justificó. */
  justified: boolean;
  files: ReleaseFile[];
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
  /** Plantillas semanales de programación diaria; opcionales para datasets que no usan la programación diaria. */
  templates?: ProductionTemplate[];
  /** Historial de producción por línea y día (para estimar la capacidad real); opcional. */
  lineHistory?: LineDayHistory[];
}
