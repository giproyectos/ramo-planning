import {
  SOPFamilyPlan,
  DRPReplenishmentRow,
  DistributionCenter,
  MPSSkuRow,
  WorkCenterCRP,
  WorkCenterLoadPeriod,
  MRPRecord,
} from '../types/demand';

// Recomputes SOP dependent fields from their inputs, matching the exact formula
// SOPModule.tsx uses when a planner edits a cell (handleCellChange), so the
// static seed data never contradicts what the live edit path would produce.
export function deriveSOPPlan(plan: SOPFamilyPlan): SOPFamilyPlan {
  return {
    ...plan,
    periods: plan.periods.map((p) => {
      const consensusDemand = p.salesForecast + p.marketingUplift;
      const gap = p.operationsCapacity - consensusDemand;
      const projectedRevenue = Math.round(consensusDemand * 1.5);
      return { ...p, consensusDemand, gap, projectedRevenue };
    }),
  };
}

// Recomputes DRP projected on-hand and net requirement sequentially per depot/SKU row.
// grossRequirement and scheduledReceipts stay as authored (they represent demand and
// already-placed receipts, not derived values). Formula verified against the existing
// dataset: onHand(t) = onHand(t-1) + scheduledReceipts(t) - grossRequirement(t);
// netRequirement(t) = max(0, safetyStockTarget - onHand(t)).
export function deriveDRPRow(row: DRPReplenishmentRow, depots: DistributionCenter[]): DRPReplenishmentRow {
  const depot = depots.find((d) => d.id === row.depotId);
  const safetyTarget = depot?.safetyStockTarget ?? 100;

  let onHand = row.periods[0]
    ? row.periods[0].projectedOnHand + row.periods[0].grossRequirement - row.periods[0].scheduledReceipts
    : 0;

  const periods = row.periods.map((p, idx) => {
    onHand = idx === 0 ? row.periods[0].projectedOnHand : onHand + p.scheduledReceipts - p.grossRequirement;
    const netRequirement = Math.max(0, safetyTarget - onHand);
    return { ...p, projectedOnHand: onHand, netRequirement };
  });

  return { ...row, periods };
}

// Recomputes CRP utilization/status from load vs effective capacity, matching the
// exact thresholds CRPModule.tsx already applies when authorizing overtime or
// running the surge/constrained scenarios.
export function deriveCRPWorkCenter(entry: WorkCenterCRP): WorkCenterCRP {
  const loadByWeek: WorkCenterLoadPeriod[] = entry.loadByWeek.map((l) => {
    const utilizationPct = Math.round((l.mpsPlannedLoadHours / l.effectiveCapacityHours) * 1000) / 10;
    const status: WorkCenterLoadPeriod['status'] =
      utilizationPct > 110 ? 'Critical' : utilizationPct > 100 ? 'Overload' : 'Normal';
    return { ...l, utilizationPct, status };
  });
  return { ...entry, loadByWeek };
}

// Recomputes MPS projected available balance and discrete/cumulative ATP, using the
// identical recurrence MPSModule.tsx runs on every build-quantity edit
// (handleBuildQtyChange), so the seed data can never contradict a live recompute.
export function deriveMPSSku(sku: MPSSkuRow): MPSSkuRow {
  const periods = sku.periods.map((p) => ({ ...p }));

  let runningBalance = sku.currentOnHand;
  for (let i = 0; i < periods.length; i++) {
    const p = periods[i];
    const effectiveDemand = p.zone === 'Frozen' ? p.customerOrders : Math.max(p.forecastDemand, p.customerOrders);
    runningBalance = runningBalance + p.mpsPlannedBuild - effectiveDemand;
    p.projectedAvailableBalance = runningBalance;

    if (p.mpsPlannedBuild > 0 || i === 0) {
      const buildAmt = i === 0 ? sku.currentOnHand + p.mpsPlannedBuild : p.mpsPlannedBuild;
      let bookedOrders = p.customerOrders;
      for (let j = i + 1; j < periods.length; j++) {
        if (periods[j].mpsPlannedBuild > 0) break;
        bookedOrders += periods[j].customerOrders;
      }
      p.discreteATP = Math.max(0, buildAmt - bookedOrders);
    } else {
      p.discreteATP = 0;
    }
  }

  let cumulative = 0;
  for (let i = 0; i < periods.length; i++) {
    cumulative += periods[i].discreteATP;
    periods[i].cumulativeATP = cumulative;
  }

  return { ...sku, periods };
}

// Recomputes MRP projected on-hand, net requirements, and planned orders sequentially
// per component using standard MRP netting: each week's planned order receipt is
// sized to keep on-hand from dropping below safety stock, and (unlike a snapshot
// DRP row) actually lands in the same week's balance — otherwise a component with
// gross requirements exceeding its already-scheduled receipts would run away to an
// ever-more-negative balance with no way to recover.
//   availableBeforeReceipt(t) = onHand(t-1) + scheduledReceipts(t)
//   netRequirements(t) = max(0, grossRequirements(t) + safetyStock - availableBeforeReceipt(t))
//   plannedOrderReceipts(t) = netRequirements(t) rounded up to the lot-sizing rule
//   onHand(t) = availableBeforeReceipt(t) + plannedOrderReceipts(t) - grossRequirements(t)
// Planned order releases are offset backward by the component's lead time so a
// receipt in week t+leadTime is triggered by a release in week t.
export function deriveMRPRecord(record: MRPRecord): MRPRecord {
  const { component } = record;
  const n = record.periods.length;

  let onHand = component.currentStock;
  const netByWeek: number[] = new Array(n);
  const receiptByWeek: number[] = new Array(n);
  const onHandByWeek: number[] = new Array(n);

  for (let i = 0; i < n; i++) {
    const p = record.periods[i];
    const availableBeforeReceipt = onHand + p.scheduledReceipts;
    const net = Math.max(0, p.grossRequirements + component.safetyStock - availableBeforeReceipt);
    const receipt =
      net <= 0
        ? 0
        : component.lotSizingRule === 'Lot-for-Lot'
        ? net
        : Math.ceil(net / component.lotSizeQty) * component.lotSizeQty;

    onHand = availableBeforeReceipt + receipt - p.grossRequirements;
    netByWeek[i] = net;
    receiptByWeek[i] = receipt;
    onHandByWeek[i] = onHand;
  }

  const periods = record.periods.map((p, i) => ({
    ...p,
    projectedOnHand: onHandByWeek[i],
    netRequirements: netByWeek[i],
    plannedOrderReceipts: receiptByWeek[i],
    plannedOrderReleases: i + component.leadTimeWeeks < n ? receiptByWeek[i + component.leadTimeWeeks] : 0,
  }));

  return { ...record, periods };
}
