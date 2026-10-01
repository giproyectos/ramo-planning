import React from 'react';
import { Download, FileSpreadsheet, X } from 'lucide-react';
import {
  PlanningScenario,
  SOPFamilyPlan,
  DRPReplenishmentRow,
  MPSSkuRow,
  WorkCenterCRP,
  MRPRecord,
  MRPActionMessage,
} from '../../types/demand';
import { useTranslation } from '../../i18n/i18n';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  scenario: PlanningScenario;
  sopPlans: Record<string, SOPFamilyPlan>;
  drpRows: DRPReplenishmentRow[];
  mpsSkus: MPSSkuRow[];
  workCenters: WorkCenterCRP[];
  mrpRecords: MRPRecord[];
  actionMessages: MRPActionMessage[];
}

function csvEscape(value: string | number): string {
  const str = String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function toCsvRow(values: (string | number)[]): string {
  return values.map(csvEscape).join(',');
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  scenario,
  sopPlans,
  drpRows,
  mpsSkus,
  workCenters,
  mrpRecords,
  actionMessages,
}) => {
  const { t } = useTranslation();
  if (!isOpen) return null;

  const buildCsv = (): string => {
    const lines: string[] = [];
    lines.push(toCsvRow(['Ramo Planning']));
    lines.push(toCsvRow(['Scenario', scenario]));
    lines.push(toCsvRow(['Generated', new Date().toISOString()]));
    lines.push('');

    lines.push(toCsvRow(['SECTION 1: S&OP']));
    lines.push(toCsvRow(['Family', 'Period', 'Consensus Demand', 'Operations Capacity', 'Gap', 'Projected Revenue ($K)']));
    Object.values(sopPlans).forEach((plan) => {
      plan.periods.forEach((p) => {
        lines.push(toCsvRow([plan.familyName, p.period, p.consensusDemand, p.operationsCapacity, p.gap, p.projectedRevenue]));
      });
    });
    lines.push('');

    lines.push(toCsvRow(['SECTION 2: DRP']));
    lines.push(toCsvRow(['Depot', 'SKU', 'Week', 'Gross Requirement', 'Projected On Hand', 'Net Requirement', 'Planned Order Release']));
    drpRows.forEach((row) => {
      row.periods.forEach((p) => {
        lines.push(toCsvRow([row.depotName, row.skuName, p.week, p.grossRequirement, p.projectedOnHand, p.netRequirement, p.plannedOrderRelease]));
      });
    });
    lines.push('');

    lines.push(toCsvRow(['SECTION 3: MPS']));
    lines.push(toCsvRow(['SKU', 'Week', 'Zone', 'Forecast Demand', 'Customer Orders', 'Planned Build', 'Projected Available Balance', 'Discrete ATP', 'Cumulative ATP']));
    mpsSkus.forEach((sku) => {
      sku.periods.forEach((p) => {
        lines.push(toCsvRow([sku.skuName, p.week, p.zone, p.forecastDemand, p.customerOrders, p.mpsPlannedBuild, p.projectedAvailableBalance, p.discreteATP, p.cumulativeATP]));
      });
    });
    lines.push('');

    lines.push(toCsvRow(['SECTION 4: CRP']));
    lines.push(toCsvRow(['Work Center', 'Week', 'Planned Load Hours', 'Effective Capacity Hours', 'Utilization %', 'Status']));
    workCenters.forEach((wc) => {
      wc.loadByWeek.forEach((l) => {
        lines.push(toCsvRow([wc.workCenter.name, l.week, l.mpsPlannedLoadHours, l.effectiveCapacityHours, l.utilizationPct, l.status]));
      });
    });
    lines.push('');

    lines.push(toCsvRow(['SECTION 5: MRP']));
    lines.push(toCsvRow(['Part Number', 'Component', 'Week', 'Gross Requirements', 'Projected On Hand', 'Net Requirements', 'Planned Order Receipts', 'Planned Order Releases']));
    mrpRecords.forEach((rec) => {
      rec.periods.forEach((p) => {
        lines.push(toCsvRow([rec.component.partNumber, rec.component.name, p.week, p.grossRequirements, p.projectedOnHand, p.netRequirements, p.plannedOrderReceipts, p.plannedOrderReleases]));
      });
    });
    lines.push('');

    lines.push(toCsvRow(['SECTION 6: MRP ACTION ORDERS']));
    lines.push(toCsvRow(['Part Number', 'Type', 'Urgency', 'Week Required', 'Quantity', 'Supplier', 'Executed']));
    actionMessages.forEach((a) => {
      lines.push(toCsvRow([a.partNumber, a.type, a.urgency, a.weekRequired, a.quantity, a.supplier, a.executed ? 'Yes' : 'No']));
    });

    return lines.join('\n');
  };

  const buildJson = (): string =>
    JSON.stringify(
      {
        scenario,
        generatedAt: new Date().toISOString(),
        sop: sopPlans,
        drp: drpRows,
        mps: mpsSkus,
        crp: workCenters,
        mrp: mrpRecords,
        mrpActionOrders: actionMessages,
      },
      null,
      2
    );

  const handleDownload = (format: 'csv' | 'json') => {
    const content = format === 'csv' ? buildCsv() : buildJson();
    const mime = format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8';
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `ramo_planning_report_${scenario}_${Date.now()}.${format}`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-md p-4">
      <div className="bg-white/95 backdrop-blur-2xl border border-white/90 rounded-[32px] max-w-md w-full p-6 sm:p-7 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-slate-100 flex items-center justify-center text-black font-bold">
              <Download className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-black text-slate-900">{t('modals.exportModal.title')}</h3>
              <p className="text-xs text-slate-500 font-medium">{t('modals.exportModal.scenario')} <span className="capitalize font-bold text-black">{t(`common.scenarios.${scenario}`)}</span></p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-700 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-slate-600 leading-relaxed font-medium">
          {t('modals.exportModal.description')}
        </p>

        <div className="space-y-2.5 text-xs">
          <button
            onClick={() => handleDownload('csv')}
            className="w-full flex items-center justify-between p-4 rounded-2xl border border-slate-200/80 bg-slate-50/70 hover:bg-white hover:shadow-xs transition-all text-left cursor-pointer group"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-2xl bg-[#dbfced] flex items-center justify-center text-black">
                <FileSpreadsheet className="w-4.5 h-4.5" />
              </div>
              <div>
                <div className="font-black text-slate-900 group-hover:text-black">
                  {t('modals.exportModal.csvTitle')}
                </div>
                <div className="text-[11px] text-slate-500 font-medium">
                  {t('modals.exportModal.csvSubtitle')}
                </div>
              </div>
            </div>
            <span className="text-[11px] font-mono font-bold text-slate-600 bg-slate-200/60 px-2 py-0.5 rounded-full">
              .csv
            </span>
          </button>

          <button
            onClick={() => handleDownload('json')}
            className="w-full flex items-center justify-between p-4 rounded-2xl border border-slate-200/80 bg-slate-50/70 hover:bg-white hover:shadow-xs transition-all text-left cursor-pointer group"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-2xl bg-[#DDCBF5] flex items-center justify-center text-black">
                <Download className="w-4.5 h-4.5" />
              </div>
              <div>
                <div className="font-black text-slate-900 group-hover:text-black">
                  {t('modals.exportModal.jsonTitle')}
                </div>
                <div className="text-[11px] text-slate-500 font-medium">
                  {t('modals.exportModal.jsonSubtitle')}
                </div>
              </div>
            </div>
            <span className="text-[11px] font-mono font-bold text-slate-600 bg-slate-200/60 px-2 py-0.5 rounded-full">
              .json
            </span>
          </button>
        </div>

        <div className="flex justify-end pt-2">
          <button
            onClick={onClose}
            className="px-5 py-2 text-xs font-bold text-slate-700 hover:text-black rounded-full hover:bg-slate-100 transition-colors cursor-pointer"
          >
            {t('modals.exportModal.close')}
          </button>
        </div>
      </div>
    </div>
  );
};
