export type ProcessStep = 'sop' | 'drp' | 'mps' | 'crp' | 'mrp' | 'process_map' | 'data' | 'ai';

export type PlanningScenario = 'baseline' | 'surge' | 'constrained';

export interface ProductFamily {
  id: string;
  name: string;
  code: string;
  category: string;
  activeSkus: number;
  revenueWeight: number; // percentage
}

export interface SOPPeriodData {
  period: string; // e.g., 'Oct 26', 'Nov 26'
  statisticalForecast: number;
  salesForecast: number;
  marketingUplift: number;
  consensusDemand: number;
  operationsCapacity: number;
  gap: number; // consensus - operations
  revenueTarget: number; // in $K
  projectedRevenue: number; // in $K
  inventoryTargetDays: number;
}

export interface SOPFamilyPlan {
  familyId: string;
  familyName: string;
  periods: SOPPeriodData[];
  executiveStatus: 'Draft' | 'Approved' | 'Review Required';
  consensusMarginPct: number;
}

// DRP Types
export interface DistributionCenter {
  id: string;
  code: string;
  name: string;
  location: string;
  type: 'Central Plant' | 'Regional DC' | 'Forward Hub';
  transitLeadTimeDays: number;
  currentInventory: number;
  safetyStockTarget: number;
  maxStorageCapacity: number;
}

export interface DRPReplenishmentRow {
  depotId: string;
  depotName: string;
  skuId: string;
  skuName: string;
  periods: {
    week: string;
    grossRequirement: number;
    scheduledReceipts: number;
    projectedOnHand: number;
    netRequirement: number;
    plannedOrderReceipt: number;
    plannedOrderRelease: number;
    containerFillPct: number;
  }[];
}

// MPS Types
export type TimeFenceZone = 'Frozen' | 'Slushy' | 'Liquid';

export interface MPSSkuRow {
  skuId: string;
  skuName: string;
  skuCode: string;
  productFamilyId: string;
  leadTimeWeeks: number;
  lotSize: number;
  currentOnHand: number;
  safetyStock: number;
  timeFenceWeeks: {
    frozenEndWeek: number; // e.g. week 2
    slushyEndWeek: number; // e.g. week 5
  };
  periods: {
    week: string; // 'W1', 'W2', etc.
    weekNum: number;
    zone: TimeFenceZone;
    forecastDemand: number;
    customerOrders: number; // committed firm orders
    mpsPlannedBuild: number;
    projectedAvailableBalance: number;
    discreteATP: number;
    cumulativeATP: number;
    isLocked: boolean;
  }[];
}

// CRP Types
export interface WorkCenter {
  id: string;
  code: string;
  name: string;
  department: string;
  standardWeeklyHours: number;
  efficiencyRating: number; // e.g., 0.95
  maxOvertimeHours: number;
  activeShifts: number;
  currentOvertimeAuthorized: number;
}

export interface WorkCenterLoadPeriod {
  week: string;
  weekNum: number;
  ratedCapacityHours: number;
  effectiveCapacityHours: number;
  mpsPlannedLoadHours: number;
  setupHours: number;
  runHours: number;
  utilizationPct: number;
  status: 'Normal' | 'Overload' | 'Critical' | 'Underutilized';
}

export interface WorkCenterCRP {
  workCenter: WorkCenter;
  loadByWeek: WorkCenterLoadPeriod[];
  mitigationStrategy?: 'Overtime Added' | 'Subcontracted' | 'Alternate Route' | 'None';
}

// MRP Types
export interface BOMComponent {
  id: string;
  partNumber: string;
  name: string;
  level: number;
  parentSkuId: string;
  quantityPerParent: number;
  unit: string;
  leadTimeWeeks: number;
  lotSizingRule: 'Lot-for-Lot' | 'Fixed Order Qty' | 'EOQ';
  lotSizeQty: number;
  currentStock: number;
  safetyStock: number;
  standardCostUSD: number;
  supplier: string;
  supplierReliabilityPct: number;
}

export interface MRPRecord {
  component: BOMComponent;
  periods: {
    week: string;
    weekNum: number;
    grossRequirements: number;
    scheduledReceipts: number;
    projectedOnHand: number;
    netRequirements: number;
    plannedOrderReceipts: number;
    plannedOrderReleases: number;
    actionMessage?: string;
  }[];
}

export interface MRPActionMessage {
  id: string;
  partNumber: string;
  partName: string;
  type: 'Release Order' | 'Expedite' | 'Postpone' | 'Excess Stock';
  urgency: 'High' | 'Medium' | 'Low';
  weekRequired: string;
  quantity: number;
  supplier: string;
  reason: string;
  executed: boolean;
}
