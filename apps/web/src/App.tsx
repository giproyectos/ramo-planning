import React, { useState, useEffect } from 'react';
import {
  ProcessStep,
  PlanningScenario,
  ProductFamily,
  SOPFamilyPlan,
  DistributionCenter,
  DRPReplenishmentRow,
  MPSSkuRow,
  WorkCenterCRP,
  WorkCenterLoadPeriod,
  MRPRecord,
  MRPActionMessage,
} from './types/demand';
import {
  productFamilies,
  initialSOPPlans,
  distributionCenters,
  initialDRPRows,
  initialMPSSkus,
  initialWorkCenters,
  initialMRPRecords,
  initialActionMessages,
} from './data/mockData';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { GlassAtmosphere } from './components/common/GlassAtmosphere';
import { ProcessMapModule } from './components/pipeline/ProcessMapModule';
import { DemandView } from './components/ramo/DemandView';
import { DrpView } from './components/ramo/DrpView';
import { MpsView } from './components/ramo/MpsView';
import { CrpView } from './components/ramo/CrpView';
import { DataView } from './components/ramo/DataView';
import { RamoPlanProvider, useRamoPlan } from './ramo/store';
import { MRPModule } from './components/mrp/MRPModule';
import { ExportModal } from './components/common/ExportModal';
import { CommandPalette } from './components/common/CommandPalette';
import { AlertsDrawer } from './components/common/AlertsDrawer';
import { ScenarioDiffModal } from './components/common/ScenarioDiffModal';
import { OperationsActivitySidebar } from './components/common/OperationsActivitySidebar';
import { LanguageProvider, useTranslation } from './i18n/i18n';
import {
  CheckCircle2,
  AlertCircle,
  Sparkles,
} from 'lucide-react';

export default function App() {
  return (
    <LanguageProvider>
      <RamoPlanProvider>
        <AppContent />
      </RamoPlanProvider>
    </LanguageProvider>
  );
}

function AppContent() {
  const { t } = useTranslation();
  const { baseline } = useRamoPlan();
  const [currentStep, setCurrentStep] = useState<ProcessStep>('process_map');
  const [scenario, setScenario] = useState<PlanningScenario>('baseline');
  const [isRegenerating, setIsRegenerating] = useState<boolean>(false);
  const [isExportOpen, setIsExportOpen] = useState<boolean>(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState<boolean>(false);
  const [isAlertsDrawerOpen, setIsAlertsDrawerOpen] = useState<boolean>(false);
  const [isScenarioModalOpen, setIsScenarioModalOpen] = useState<boolean>(false);

  // Core Enterprise Data States
  const [families] = useState<ProductFamily[]>(productFamilies);
  const [sopPlans, setSopPlans] = useState<Record<string, SOPFamilyPlan>>(initialSOPPlans);
  const [depots] = useState<DistributionCenter[]>(distributionCenters);
  const [drpRows, setDrpRows] = useState<DRPReplenishmentRow[]>(initialDRPRows);
  const [mpsSkus, setMpsSkus] = useState<MPSSkuRow[]>(initialMPSSkus);
  const [workCenters, setWorkCenters] = useState<WorkCenterCRP[]>(initialWorkCenters);
  const [mrpRecords, setMrpRecords] = useState<MRPRecord[]>(initialMRPRecords);
  const [actionMessages, setActionMessages] = useState<MRPActionMessage[]>(initialActionMessages);

  // Toast Notification State
  const [toastMessage, setToastMessage] = useState<{
    text: string;
    type: 'success' | 'info' | 'warning';
  } | null>(null);

  const showToast = (text: string, type: 'success' | 'info' | 'warning' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => {
      setToastMessage(null);
    }, 4500);
  };

  // Keyboard shortcut listener for Cmd+K and direct step switching
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Scenario Switcher Effects
  useEffect(() => {
    if (scenario === 'surge') {
      const surgeSOP: Record<string, SOPFamilyPlan> = {};
      Object.keys(initialSOPPlans).forEach((key) => {
        const plan = initialSOPPlans[key];
        surgeSOP[key] = {
          ...plan,
          periods: plan.periods.map((p) => ({
            ...p,
            salesForecast: Math.round(p.salesForecast * 1.18),
            consensusDemand: Math.round((p.salesForecast * 1.18) + p.marketingUplift),
            projectedRevenue: Math.round(((p.salesForecast * 1.18) + p.marketingUplift) * 1.5),
            gap: p.operationsCapacity - Math.round((p.salesForecast * 1.18) + p.marketingUplift),
          })),
        };
      });
      setSopPlans(surgeSOP);

      // Surge DRP Requirements
      const surgedDRP = initialDRPRows.map((row) => ({
        ...row,
        periods: row.periods.map((p) => ({
          ...p,
          grossRequirement: Math.round(p.grossRequirement * 1.18),
          netRequirement: Math.max(0, Math.round(p.grossRequirement * 1.18) - p.projectedOnHand - p.scheduledReceipts),
          plannedOrderRelease: Math.max(0, Math.round(p.grossRequirement * 1.18) - p.projectedOnHand),
        })),
      }));
      setDrpRows(surgedDRP);

      // Overload Work Centers
      const surgedWC = initialWorkCenters.map((wc) => ({
        ...wc,
        loadByWeek: wc.loadByWeek.map((l) => {
          const newHours = Math.round(l.mpsPlannedLoadHours * 1.18);
          const util = Math.round((newHours / l.effectiveCapacityHours) * 100);
          return {
            ...l,
            mpsPlannedLoadHours: newHours,
            utilizationPct: util,
            status: (util > 100 ? 'Overload' : 'Normal') as WorkCenterLoadPeriod['status'],
          };
        }),
      }));
      setWorkCenters(surgedWC);
      showToast(t('common.toasts.surgeApplied'), 'warning');
    } else if (scenario === 'constrained') {
      const constrainedWC = initialWorkCenters.map((wc) => ({
        ...wc,
        workCenter: { ...wc.workCenter, efficiencyRating: 0.78 },
        loadByWeek: wc.loadByWeek.map((l) => {
          const reducedCap = (wc.workCenter.standardWeeklyHours) * 0.78;
          const util = Math.round((l.mpsPlannedLoadHours / reducedCap) * 100);
          return {
            ...l,
            effectiveCapacityHours: Math.round(reducedCap * 10) / 10,
            utilizationPct: util,
            status: (util > 100 ? 'Overload' : 'Normal') as WorkCenterLoadPeriod['status'],
          };
        }),
      }));
      setWorkCenters(constrainedWC);
      showToast(t('common.toasts.constrainedApplied'), 'warning');
    } else {
      setSopPlans(initialSOPPlans);
      setDrpRows(initialDRPRows);
      setMpsSkus(initialMPSSkus);
      setWorkCenters(initialWorkCenters);
      setMrpRecords(initialMRPRecords);
      setActionMessages(initialActionMessages);
      showToast(t('common.toasts.baselineRestored'), 'info');
    }
  }, [scenario]);

  // Full-Horizon Regeneration (Recomputing the full closed-loop thread)
  const handleRunRegeneration = () => {
    setIsRegenerating(true);
    showToast(t('common.toasts.regenRunning'), 'info');

    setTimeout(() => {
      // Cascade S&OP consensus to DRP
      const activeSOP = sopPlans['fam-pmd'] || initialSOPPlans['fam-pmd'];
      const totalSOPUnits = activeSOP.periods.slice(0, 4).reduce((sum, p) => sum + p.consensusDemand, 0);

      // Update DRP East Coast with scaled requirement
      setDrpRows((prev) =>
        prev.map((row) => {
          if (row.depotId === 'rdc-east') {
            const updatedPeriods = row.periods.map((p, idx) => ({
              ...p,
              grossRequirement: Math.round(totalSOPUnits * 0.12 * (1 + idx * 0.05)),
            }));
            return { ...row, periods: updatedPeriods };
          }
          return row;
        })
      );

      // Recompute MPS discrete ATP and projected available balance
      setMpsSkus((prev) =>
        prev.map((sku) => {
          let runningBalance = sku.currentOnHand;
          const updatedPeriods = sku.periods.map((p) => {
            const effDemand = p.zone === 'Frozen' ? p.customerOrders : Math.max(p.forecastDemand, p.customerOrders);
            runningBalance = runningBalance + p.mpsPlannedBuild - effDemand;
            return {
              ...p,
              projectedAvailableBalance: runningBalance,
              discreteATP: Math.max(0, p.mpsPlannedBuild - p.customerOrders),
            };
          });
          return { ...sku, periods: updatedPeriods };
        })
      );

      setIsRegenerating(false);
      showToast(t('common.toasts.regenComplete'), 'success');
    }, 1400);
  };

  // Promotion from S&OP to DRP
  const handlePromoteSOPtoDRP = () => {
    setCurrentStep('drp');
    showToast(t('common.toasts.sopApproved'), 'success');
  };

  // Promotion from DRP to MPS
  const handlePromoteDRPtoMPS = () => {
    setCurrentStep('mps');
    showToast(t('common.toasts.drpAggregated'), 'success');
  };

  // Promotion from MPS to CRP
  const handlePromoteMPStoCRP = () => {
    setCurrentStep('crp');
    showToast(t('common.toasts.mpsReleased'), 'success');
  };

  // Promotion from CRP to MRP
  const handlePromoteCRPtoMRP = () => {
    setCurrentStep('mrp');
    showToast(t('common.toasts.crpValidated'), 'success');
  };

  // Action Order Execution
  const handleExecuteAction = (actionId: string) => {
    setActionMessages((prev) =>
      prev.map((a) => (a.id === actionId ? { ...a, executed: true } : a))
    );
    showToast(t('common.toasts.poTransmitted'), 'success');
  };

  const handleExecuteAllActions = () => {
    setActionMessages((prev) => prev.map((a) => ({ ...a, executed: true })));
    showToast(t('common.toasts.allPosReleased'), 'success');
  };

  // Fast Alert Resolution Handlers
  const handleResolveBottleneck = () => {
    const updated = workCenters.map((wcItem) => {
      if (wcItem.workCenter.id === 'wc-101') {
        const overtimeHours = 16;
        const newCap = (wcItem.workCenter.standardWeeklyHours + overtimeHours) * wcItem.workCenter.efficiencyRating;
        const newLoads = wcItem.loadByWeek.map((period) => {
          const util = Math.round((period.mpsPlannedLoadHours / newCap) * 100);
          return {
            ...period,
            effectiveCapacityHours: Math.round(newCap * 10) / 10,
            utilizationPct: util,
            status: (util > 100 ? 'Overload' : 'Normal') as WorkCenterLoadPeriod['status'],
          };
        });
        return {
          ...wcItem,
          workCenter: { ...wcItem.workCenter, currentOvertimeAuthorized: overtimeHours },
          loadByWeek: newLoads,
          mitigationStrategy: 'Overtime Added' as const,
        };
      }
      return wcItem;
    });
    setWorkCenters(updated);
    showToast(t('common.toasts.overtimeAuthorized'), 'success');
  };

  const handleResolveShortage = () => {
    setActionMessages((prev) =>
      prev.map((a) => (a.id === 'act-002' ? { ...a, executed: true } : a))
    );
    showToast(t('common.toasts.poExpedited'), 'success');
  };

  // Dynamic Status Badges for Sidebar
  const activeSOPPlan = sopPlans['fam-pmd'] || initialSOPPlans['fam-pmd'];
  const sopStatusText = activeSOPPlan.executiveStatus;
  const drpStatusText = 'Balanced (3 DCs)';
  const mpsStatusText = 'Frozen Locked (W40-W41)';
  const maxWcUtil = Math.max(
    ...workCenters.flatMap((wc) => wc.loadByWeek.map((l) => l.utilizationPct))
  );
  const crpStatusText = maxWcUtil > 100 ? `Bottleneck (${maxWcUtil}%)` : 'Feasible (Under 100%)';
  const pendingActionCount = actionMessages.filter((a) => !a.executed).length;

  return (
    <div className="min-h-screen text-slate-900 flex antialiased selection:bg-[#7AFFA1]/40 selection:text-black relative">
      {/* Ambient diffuse glass lighting in background */}
      <GlassAtmosphere />

      {/* Left Navigation Sidebar */}
      <Sidebar
        currentStep={currentStep}
        onSelectStep={setCurrentStep}
        scenario={scenario}
        onScenarioChange={setScenario}
        sopStatus={sopStatusText}
        drpStatus={drpStatusText}
        mpsStatus={mpsStatusText}
        crpStatus={crpStatusText}
        mrpPendingCount={pendingActionCount}
        dataBadge={baseline?.usable ? 'SAP' : 'Mock'}
        alertCount={pendingActionCount + (maxWcUtil > 100 ? 1 : 0)}
        onOpenScenarioModal={() => setIsScenarioModalOpen(true)}
      />

      {/* Main Workspace Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-x-hidden relative z-10">
        {/* Top Header */}
        <Header
          currentStep={currentStep}
          onSelectStep={setCurrentStep}
          scenario={scenario}
          onScenarioChange={setScenario}
          onRunRegeneration={handleRunRegeneration}
          onExport={() => setIsExportOpen(true)}
          isRegenerating={isRegenerating}
          onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
          onOpenAlertsDrawer={() => setIsAlertsDrawerOpen(true)}
          onOpenScenarioModal={() => setIsScenarioModalOpen(true)}
          alertCount={pendingActionCount + (maxWcUtil > 100 ? 1 : 0)}
        />

        {/* Toast Notification Banner */}
        {toastMessage && (
          <div className="fixed bottom-6 right-6 z-50 max-w-md animate-in fade-in slide-in-from-bottom-2 duration-200">
            <div
              className={`p-4 rounded-3xl glass-panel shadow-xl flex items-start gap-3 backdrop-blur-2xl ${
                toastMessage.type === 'success'
                  ? 'border-emerald-500/40 text-emerald-950'
                  : toastMessage.type === 'warning'
                  ? 'border-amber-500/40 text-amber-950'
                  : 'border-purple-500/40 text-slate-900'
              }`}
            >
              {toastMessage.type === 'success' ? (
                <div className="w-7 h-7 rounded-full bg-[#7AFFA1] flex items-center justify-center text-black shrink-0 shadow-2xs">
                  <CheckCircle2 className="w-4 h-4" />
                </div>
              ) : toastMessage.type === 'warning' ? (
                <div className="w-7 h-7 rounded-full bg-[#FFA27D] flex items-center justify-center text-black shrink-0 shadow-2xs">
                  <AlertCircle className="w-4 h-4" />
                </div>
              ) : (
                <div className="w-7 h-7 rounded-full bg-[#DDCBF5] flex items-center justify-center text-black shrink-0 shadow-2xs">
                  <Sparkles className="w-4 h-4" />
                </div>
              )}
              <div className="text-xs leading-relaxed font-bold text-slate-800 pt-0.5">
                {toastMessage.text}
              </div>
            </div>
          </div>
        )}

        {/* Main Stage Component (Without any big static banner on every page!) */}
        <main className="flex-1 px-6 py-6 pb-16">
          {currentStep === 'process_map' && (
            <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-5 items-start">
              <ProcessMapModule
                onSelectStep={setCurrentStep}
                sopStatus={sopStatusText}
                drpStatus={drpStatusText}
                mpsStatus={mpsStatusText}
                crpStatus={crpStatusText}
                mrpActionCount={pendingActionCount}
                sopPlans={sopPlans}
                drpRows={drpRows}
                mpsSkus={mpsSkus}
                workCenters={workCenters}
                mrpRecords={mrpRecords}
                actionMessages={actionMessages}
                scenario={scenario}
                onOpenScenarioModal={() => setIsScenarioModalOpen(true)}
                onRunRegeneration={handleRunRegeneration}
              />
              <OperationsActivitySidebar
                onSelectStep={setCurrentStep}
                onResolveBottleneck={handleResolveBottleneck}
                onResolveShortage={handleResolveShortage}
              />
            </div>
          )}

          {currentStep === 'sop' && <DemandView />}

          {currentStep === 'drp' && <DrpView />}

          {currentStep === 'mps' && <MpsView />}

          {currentStep === 'crp' && <CrpView />}

          {currentStep === 'data' && <DataView />}

          {currentStep === 'mrp' && (
            <MRPModule
              records={mrpRecords}
              actionMessages={actionMessages}
              onExecuteAction={handleExecuteAction}
              onExecuteAllActions={handleExecuteAllActions}
            />
          )}
        </main>

        {/* Enterprise Status Footer */}
        <footer className="px-6 py-4 text-xs text-slate-500 flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-white/60 glass-panel">
          <div className="flex items-center gap-2.5">
            <span className="w-2 h-2 rounded-full bg-[#7AFFA1] animate-pulse"></span>
            <span className="font-extrabold text-black">{t('common.footer.brand')}</span>
            <span className="text-slate-300">·</span>
            <span>{t('common.footer.flow')}</span>
          </div>
          <div className="flex items-center gap-4 text-slate-500 font-mono text-[11px]">
            <span>{t('common.footer.horizon')}</span>
            <span>·</span>
            <span>{t('common.footer.atp')}</span>
            <span>·</span>
            <span>{t('common.footer.serviceLevel')}</span>
          </div>
        </footer>
      </div>

      {/* Command Palette Modal */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        onSelectStep={setCurrentStep}
        onTriggerRegeneration={handleRunRegeneration}
        onTriggerExport={() => setIsExportOpen(true)}
        onSelectScenario={setScenario}
      />

      {/* Operational Alerts Drawer */}
      <AlertsDrawer
        isOpen={isAlertsDrawerOpen}
        onClose={() => setIsAlertsDrawerOpen(false)}
        onNavigate={setCurrentStep}
        onResolveBottleneck={handleResolveBottleneck}
        onResolveShortage={handleResolveShortage}
      />

      {/* Scenario Compare Modal */}
      <ScenarioDiffModal
        isOpen={isScenarioModalOpen}
        onClose={() => setIsScenarioModalOpen(false)}
        activeScenario={scenario}
        onApplyScenario={setScenario}
      />

      {/* Export Report Modal */}
      <ExportModal
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
        scenario={scenario}
        sopPlans={sopPlans}
        drpRows={drpRows}
        mpsSkus={mpsSkus}
        workCenters={workCenters}
        mrpRecords={mrpRecords}
        actionMessages={actionMessages}
      />
    </div>
  );
}
