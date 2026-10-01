import React from 'react';
import { ProcessStep, PlanningScenario } from '../types/demand';
import { RefreshCw, Download, Layers, Search, Bell } from 'lucide-react';
import { useTranslation } from '../i18n/i18n';

interface HeaderProps {
  currentStep: ProcessStep;
  onSelectStep: (step: ProcessStep) => void;
  scenario: PlanningScenario;
  onScenarioChange: (scenario: PlanningScenario) => void;
  onRunRegeneration: () => void;
  onExport: () => void;
  isRegenerating: boolean;
  onOpenCommandPalette: () => void;
  onOpenAlertsDrawer: () => void;
  onOpenScenarioModal: () => void;
  alertCount: number;
}

export const Header: React.FC<HeaderProps> = ({
  currentStep,
  scenario,
  onRunRegeneration,
  onExport,
  isRegenerating,
  onOpenCommandPalette,
  onOpenAlertsDrawer,
  onOpenScenarioModal,
  alertCount,
}) => {
  const { t, lang, setLang } = useTranslation();

  const stepTitles: Record<ProcessStep, string> = {
    process_map: t('common.stepTitles.process_map'),
    sop: t('common.stepTitles.sop'),
    drp: t('common.stepTitles.drp'),
    mps: t('common.stepTitles.mps'),
    crp: t('common.stepTitles.crp'),
    mrp: t('common.stepTitles.mrp'),
  };

  return (
    <header className="px-5 lg:px-6 py-3.5 flex items-center justify-between gap-3 border-b border-white/70 glass-panel sticky top-0 z-20">
      {/* Left Stage Breadcrumb Capsule */}
      <div className="flex items-center min-w-0">
        <div className="flex items-center glass-pill rounded-full px-3.5 py-1.5 gap-2 min-w-0 max-w-xs md:max-w-md">
          <div className="w-5 h-5 rounded-full bg-slate-100 flex items-center justify-center text-slate-700 font-bold text-[10px] shrink-0">
            ::
          </div>
          <span className="text-xs font-black text-slate-900 tracking-tight truncate">
            {stepTitles[currentStep]}
          </span>
          <span className="text-slate-300 shrink-0 hidden sm:inline">·</span>
          <span className="text-[10px] font-extrabold text-emerald-950 bg-[#7AFFA1]/60 px-2 py-0.5 rounded-full shrink-0 border border-[#7AFFA1]/70 hidden lg:inline-block">
            {t('common.header.live')}
          </span>
        </div>
      </div>

      {/* Center Search Pill matching the glass capsule style */}
      <button
        onClick={onOpenCommandPalette}
        className="hidden md:flex items-center justify-between w-56 lg:w-80 px-4 py-1.5 rounded-full glass-pill hover:bg-white text-xs text-slate-500 hover:text-slate-800 transition-all cursor-pointer group shrink-0"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Search className="w-3.5 h-3.5 text-slate-400 group-hover:text-black transition-colors shrink-0" />
          <span className="font-semibold text-slate-400 text-xs truncate">{t('common.header.searchPlaceholder')}</span>
        </div>
        <kbd className="px-2 py-0.5 text-[10px] font-mono font-bold text-slate-400 bg-slate-100/80 rounded-full border border-slate-200 shrink-0">
          ⌘K
        </kbd>
      </button>

      {/* Right Top Action Pills */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Language Toggle Pill */}
        <div className="flex items-center gap-0.5 p-0.5 rounded-full glass-pill" title={t('common.language.toggleLabel')}>
          <button
            onClick={() => setLang('en')}
            className={`px-2.5 py-1 text-[11px] font-bold rounded-full transition-all cursor-pointer ${
              lang === 'en' ? 'bg-slate-950 text-white' : 'text-slate-500 hover:text-black'
            }`}
          >
            EN
          </button>
          <button
            onClick={() => setLang('es')}
            className={`px-2.5 py-1 text-[11px] font-bold rounded-full transition-all cursor-pointer ${
              lang === 'es' ? 'bg-slate-950 text-white' : 'text-slate-500 hover:text-black'
            }`}
          >
            ES
          </button>
        </div>

        {/* Scenario Pill */}
        <button
          onClick={onOpenScenarioModal}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-800 glass-pill hover:bg-white rounded-full transition-all cursor-pointer"
        >
          <Layers className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          <span className="text-slate-500 font-medium hidden sm:inline">{t('common.header.scenarioLabel')}</span>
          <span className="capitalize text-black font-extrabold">{t(`common.scenarios.${scenario}`)}</span>
        </button>

        {/* Alerts Pill */}
        <button
          onClick={onOpenAlertsDrawer}
          className="relative w-8 h-8 rounded-full glass-pill hover:bg-white flex items-center justify-center text-slate-600 hover:text-black transition-all cursor-pointer"
          title={t('common.header.alertsTitle')}
        >
          <Bell className="w-3.5 h-3.5" />
          {alertCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-[#FFA27D] text-black text-[9px] font-black rounded-full flex items-center justify-center shadow-xs">
              {alertCount}
            </span>
          )}
        </button>

        {/* Export Pill */}
        <button
          onClick={onExport}
          className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-700 glass-pill hover:bg-white rounded-full transition-all cursor-pointer"
        >
          <Download className="w-3.5 h-3.5 text-slate-500" />
          <span>{t('common.header.export')}</span>
        </button>

        {/* Primary Action Button (Pure Black Pill) */}
        <button
          onClick={onRunRegeneration}
          disabled={isRegenerating}
          className="px-4 py-1.5 text-xs font-bold text-white bg-slate-950 hover:bg-black active:scale-95 rounded-full shadow-sm transition-all flex items-center gap-2 cursor-pointer disabled:opacity-60"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${isRegenerating ? 'animate-spin text-[#7AFFA1]' : 'text-[#7AFFA1]'}`}
          />
          <span className="whitespace-nowrap">{isRegenerating ? t('common.header.running') : t('common.header.regenerate')}</span>
        </button>
      </div>
    </header>
  );
};
