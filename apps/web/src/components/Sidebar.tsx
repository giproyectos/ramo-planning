import React from 'react';
import { ProcessStep, PlanningScenario } from '../types/demand';
import {
  LayoutGrid,
  BarChart3,
  Truck,
  CalendarRange,
  Cpu,
  Boxes,
  Database,
  Sparkles,
  Send,
} from 'lucide-react';
import { ROLE_LABELS } from '@ramo/governance';
import { useAuth } from '../ramo/auth';
import { useRamoPlan } from '../ramo/store';
import { useTranslation } from '../i18n/i18n';

interface SidebarProps {
  currentStep: ProcessStep;
  onSelectStep: (step: ProcessStep) => void;
  scenario: PlanningScenario;
  onScenarioChange: (scenario: PlanningScenario) => void;
  sopStatus: string;
  drpStatus: string;
  mpsStatus: string;
  crpStatus: string;
  mrpPendingCount: number;
  dataBadge: string;
  aiBadge: string;
  releaseBadge: string;
  alertCount: number;
  onOpenScenarioModal: () => void;
}

const syncLabel: Record<string, string> = {
  local: 'local', loading: 'cargando…', saving: 'guardando…', saved: 'guardado ✓', conflict: 'conflicto: recarga', denied: 'cambio no permitido', offline: 'sin conexión',
};

export const Sidebar: React.FC<SidebarProps> = ({
  currentStep,
  onSelectStep,
  scenario,
  sopStatus,
  drpStatus,
  mpsStatus,
  crpStatus,
  mrpPendingCount,
  dataBadge,
  aiBadge,
  releaseBadge,
  onOpenScenarioModal,
}) => {
  const { t } = useTranslation();
  const { mode, user, logout } = useAuth();
  const { sync } = useRamoPlan();

  const navItems: {
    id: ProcessStep;
    stepNumber: string;
    code: string;
    name: string;
    icon: React.ElementType;
    badge: string;
    badgeBg: string;
  }[] = [
    {
      id: 'process_map',
      stepNumber: '00',
      code: 'FLOW',
      name: t('common.sidebar.nav.process_map.name'),
      icon: LayoutGrid,
      badge: t('common.sidebar.nav.process_map.badge'),
      badgeBg: 'bg-[#DDCBF5]',
    },
    {
      id: 'sop',
      stepNumber: '01',
      code: 'S&OP',
      name: t('common.sidebar.nav.sop.name'),
      icon: BarChart3,
      badge: sopStatus === 'Approved' ? t('common.sidebar.badges.approved') : t('common.sidebar.badges.draft'),
      badgeBg: sopStatus === 'Approved' ? 'bg-[#7AFFA1]' : 'bg-[#FFF87C]',
    },
    {
      id: 'drp',
      stepNumber: '02',
      code: 'DRP',
      name: t('common.sidebar.nav.drp.name'),
      icon: Truck,
      badge: t('common.sidebar.badges.balanced'),
      badgeBg: 'bg-[#FFF87C]',
    },
    {
      id: 'mps',
      stepNumber: '03',
      code: 'MPS',
      name: t('common.sidebar.nav.mps.name'),
      icon: CalendarRange,
      badge: t('common.sidebar.badges.locked'),
      badgeBg: 'bg-[#7AFFA1]',
    },
    {
      id: 'crp',
      stepNumber: '04',
      code: 'CRP',
      name: t('common.sidebar.nav.crp.name'),
      icon: Cpu,
      badge: crpStatus.includes('Bottleneck') ? t('common.sidebar.badges.alert') : t('common.sidebar.badges.feasible'),
      badgeBg: crpStatus.includes('Bottleneck') ? 'bg-[#FFA27D]' : 'bg-[#7AFFA1]',
    },
    {
      id: 'mrp',
      stepNumber: '05',
      code: 'MRP',
      name: t('common.sidebar.nav.mrp.name'),
      icon: Boxes,
      badge: t('common.sidebar.nav.mrp.badge', { count: mrpPendingCount }),
      badgeBg: 'bg-[#DDCBF5]',
    },
    {
      id: 'data',
      stepNumber: 'SAP',
      code: 'DATA',
      name: t('common.sidebar.nav.data.name'),
      icon: Database,
      badge: dataBadge,
      badgeBg: dataBadge === 'SAP' ? 'bg-[#7AFFA1]' : 'bg-[#FFF87C]',
    },
    {
      id: 'ai',
      stepNumber: 'IA',
      code: 'RECS',
      name: t('common.sidebar.nav.ai.name'),
      icon: Sparkles,
      badge: aiBadge,
      badgeBg: aiBadge === '0' ? 'bg-[#7AFFA1]' : 'bg-[#DDCBF5]',
    },
    {
      id: 'release',
      stepNumber: 'OUT',
      code: 'SAP',
      name: t('common.sidebar.nav.release.name'),
      icon: Send,
      badge: releaseBadge,
      badgeBg: releaseBadge === 'Local' ? 'bg-[#FFF87C]' : 'bg-[#7AFFA1]',
    },
  ];

  return (
    <aside className="w-64 lg:w-72 shrink-0 flex flex-col justify-between p-4 lg:p-5 h-screen sticky top-0 glass-panel border-r border-white/70 z-20">
      <div className="space-y-4">
        {/* Brand Header */}
        <div className="flex items-center justify-between px-2 pt-1">
          <div className="flex items-center gap-2">
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                onSelectStep('process_map');
              }}
              className="text-3xl font-black tracking-tighter text-slate-950 flex items-center leading-none hover:opacity-80 transition-opacity"
            >
              <span>rp</span>
              <span className="text-[#7AFFA1] font-extrabold text-4xl leading-none">.</span>
            </a>
            <div className="flex flex-col">
              <span className="text-xs font-black text-slate-900 tracking-tight leading-none">
                Ramo Planning
              </span>
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mt-0.5">
                {t('common.sidebar.operationsSuite')}
              </span>
            </div>
          </div>

          <div className="w-7 h-7 rounded-full glass-pill flex items-center justify-center text-slate-600 font-black text-[11px]">
            ::
          </div>
        </div>

        {/* Plant Hub Capsule */}
        <div className="glass-card rounded-2xl p-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-2.5 h-2.5 rounded-full bg-[#7AFFA1] animate-pulse shrink-0"></div>
            <div className="min-w-0">
              <div className="text-xs font-black text-slate-900 leading-tight truncate">
                {t('common.sidebar.plantName')}
              </div>
              <div className="text-[10px] text-slate-500 font-semibold truncate">
                {t('common.sidebar.plantSubtitle')}
              </div>
            </div>
          </div>
          <span className="text-[10px] font-mono font-bold bg-white/80 px-2 py-0.5 rounded-full text-slate-600 shrink-0 border border-white/60">
            FY26
          </span>
        </div>

        {/* Navigation Section */}
        <div className="space-y-1">
          <div className="px-3 pb-1 text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
            {t('common.sidebar.planningStages')}
          </div>

          <nav className="space-y-1.5">
            {navItems.map((item) => {
              const isActive = currentStep === item.id;
              const Icon = item.icon;

              return (
                <button
                  key={item.id}
                  onClick={() => onSelectStep(item.id)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-2xl transition-all cursor-pointer text-left group overflow-hidden ${
                    isActive
                      ? 'bg-slate-950 text-white shadow-md'
                      : 'hover:bg-white/80 text-slate-700 hover:text-slate-950'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1 mr-2">
                    <div
                      className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 transition-all ${
                        isActive
                          ? 'bg-[#7AFFA1] text-black font-black'
                          : 'bg-white/80 text-slate-600 group-hover:bg-slate-100 group-hover:text-black border border-white/60'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className={`text-xs font-black tracking-tight shrink-0 ${isActive ? 'text-white' : 'text-slate-900'}`}>
                          {item.code}
                        </span>
                        <span className="text-slate-400 font-normal shrink-0">·</span>
                        <span className={`text-[11px] font-medium truncate min-w-0 ${isActive ? 'text-slate-300' : 'text-slate-500'}`}>
                          {item.name}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono mt-0.5 truncate">
                        {t('common.sidebar.stage', { num: item.stepNumber })}
                      </div>
                    </div>
                  </div>

                  {/* Clean, micro-status bubble that never wraps or collides */}
                  <span
                    className={`text-[9px] font-extrabold px-2 py-0.5 rounded-full shrink-0 text-black leading-tight text-center ${
                      isActive ? 'bg-[#7AFFA1] text-black shadow-xs' : `${item.badgeBg} text-black`
                    }`}
                  >
                    {item.badge}
                  </span>
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Sidebar Footer Controls */}
      <div className="space-y-2.5 pt-2 border-t border-black/5">
        {/* Scenario Switcher Card */}
        <div
          onClick={onOpenScenarioModal}
          className="glass-card rounded-2xl p-2.5 cursor-pointer transition-all hover:bg-white/90 group"
        >
          <div className="flex items-center justify-between text-xs">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              {t('common.sidebar.planningScenario')}
            </span>
            <span className="text-[10px] font-bold text-slate-500 group-hover:text-black">
              {t('common.sidebar.switch')}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <div className="w-2 h-2 rounded-full bg-[#FFF87C] shrink-0"></div>
            <span className="text-xs font-black text-slate-900 capitalize truncate">
              {t(`common.scenarios.${scenario}`)} {t('common.sidebar.plan')}
            </span>
          </div>
        </div>

        {/* User Profile Pill */}
        <div className="flex items-center justify-between p-2 rounded-2xl glass-pill">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-[#FFA27D] to-[#FFF87C] p-0.5 shadow-2xs shrink-0">
              <div className="w-full h-full rounded-full bg-white flex items-center justify-center font-black text-[11px] text-slate-900">
                {user ? user.name.slice(0, 2).toUpperCase() : 'RS'}
              </div>
            </div>
            <div className="min-w-0">
              <div className="text-xs font-black text-slate-900 leading-tight truncate">
                {user ? user.name : t('common.sidebar.userName')}
              </div>
              <div className="text-[9px] text-slate-500 font-medium truncate" title={sync.message}>
                {user ? `${ROLE_LABELS[user.role]} · ${syncLabel[sync.state]}` : mode === 'local' ? 'Modo local (sin servidor): todo permitido, nada se guarda' : t('common.sidebar.userRole')}
              </div>
            </div>
          </div>
          {user ? (
            <button onClick={logout} className="text-[10px] font-bold text-slate-500 hover:text-black underline cursor-pointer shrink-0">Salir</button>
          ) : (
            <div className="w-2 h-2 rounded-full bg-[#FFF87C] shrink-0" title={t('common.sidebar.erpConnected')}></div>
          )}
        </div>
      </div>
    </aside>
  );
};
