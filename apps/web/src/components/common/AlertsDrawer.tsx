import React from 'react';
import { AlertTriangle, ShieldCheck, Clock, X, ArrowRight, Zap, CheckCircle2, Truck, Cpu, Boxes } from 'lucide-react';
import { ProcessStep } from '../../types/demand';
import { useTranslation } from '../../i18n/i18n';

interface AlertsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (step: ProcessStep) => void;
  onResolveBottleneck: () => void;
  onResolveShortage: () => void;
}

export interface OperationalAlert {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  category: string;
  title: string;
  description: string;
  stage: ProcessStep;
  actionLabel: string;
  accentBg: string;
  accentPill: string;
  actionFn: () => void;
}

export const AlertsDrawer: React.FC<AlertsDrawerProps> = ({
  isOpen,
  onClose,
  onNavigate,
  onResolveBottleneck,
  onResolveShortage,
}) => {
  const { t } = useTranslation();
  if (!isOpen) return null;

  const alerts: OperationalAlert[] = [
    {
      id: 'al-crp-1',
      severity: 'critical',
      category: t('modals.alerts.items.crpCategory'),
      title: t('modals.alerts.items.crpTitle'),
      description: t('modals.alerts.items.crpDescription'),
      stage: 'crp',
      actionLabel: t('modals.alerts.items.crpAction'),
      accentBg: 'bg-[#ffefe8]',
      accentPill: 'bg-[#FFA27D]',
      actionFn: onResolveBottleneck,
    },
    {
      id: 'al-mrp-1',
      severity: 'critical',
      category: t('modals.alerts.items.mrpCategory'),
      title: t('modals.alerts.items.mrpTitle'),
      description: t('modals.alerts.items.mrpDescription'),
      stage: 'mrp',
      actionLabel: t('modals.alerts.items.mrpAction'),
      accentBg: 'bg-[#ffefe8]',
      accentPill: 'bg-[#FFA27D]',
      actionFn: onResolveShortage,
    },
    {
      id: 'al-drp-1',
      severity: 'warning',
      category: t('modals.alerts.items.drpCategory'),
      title: t('modals.alerts.items.drpTitle'),
      description: t('modals.alerts.items.drpDescription'),
      stage: 'drp',
      actionLabel: t('modals.alerts.items.drpAction'),
      accentBg: 'bg-[#fffde3]',
      accentPill: 'bg-[#FFF87C]',
      actionFn: () => onNavigate('drp'),
    },
    {
      id: 'al-sop-1',
      severity: 'info',
      category: t('modals.alerts.items.sopCategory'),
      title: t('modals.alerts.items.sopTitle'),
      description: t('modals.alerts.items.sopDescription'),
      stage: 'sop',
      actionLabel: t('modals.alerts.items.sopAction'),
      accentBg: 'bg-[#dbfced]',
      accentPill: 'bg-[#7AFFA1]',
      actionFn: () => onNavigate('sop'),
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/30 backdrop-blur-xs">
      <div className="w-full max-w-md bg-white/95 backdrop-blur-2xl border-l border-white/90 shadow-2xl h-full flex flex-col animate-in slide-in-from-right duration-200">
        {/* Drawer Header */}
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-2xl bg-[#ffefe8] border border-[#FFA27D]/40 flex items-center justify-center text-black font-bold">
              <AlertTriangle className="w-4.5 h-4.5" />
            </div>
            <div>
              <h2 className="text-sm font-black text-slate-900">{t('modals.alerts.title')}</h2>
              <p className="text-xs text-slate-500 font-medium">
                {t('modals.alerts.count', { count: alerts.length })}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-700 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Alerts List */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3.5">
          {alerts.map((alert) => (
            <div
              key={alert.id}
              className={`${alert.accentBg}/60 border border-slate-200/80 rounded-3xl p-4.5 transition-all shadow-2xs hover:shadow-xs`}
            >
              <div className="flex items-center justify-between pb-2 border-b border-black/5">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-600">
                  {alert.category}
                </span>
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${alert.accentPill} text-black`}
                >
                  {t(`modals.alerts.severity.${alert.severity}`)}
                </span>
              </div>

              <h4 className="text-xs font-black text-slate-900 mt-2 leading-snug">
                {alert.title}
              </h4>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed font-medium">
                {alert.description}
              </p>

              <div className="mt-4 pt-3 border-t border-black/5 flex items-center justify-between gap-2">
                <button
                  onClick={() => {
                    alert.actionFn();
                    onClose();
                  }}
                  className="px-3.5 py-1.5 text-xs font-bold text-white bg-black hover:bg-slate-900 rounded-full flex items-center gap-1.5 transition-all cursor-pointer shadow-xs active:scale-95"
                >
                  <Zap className="w-3 h-3 text-[#7AFFA1]" />
                  <span>{alert.actionLabel}</span>
                </button>

                <button
                  onClick={() => {
                    onNavigate(alert.stage);
                    onClose();
                  }}
                  className="text-xs text-slate-600 hover:text-black font-bold flex items-center gap-1 transition-colors cursor-pointer"
                >
                  <span>{t('modals.alerts.stage')}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Drawer Footer */}
        <div className="p-5 bg-slate-50/80 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 font-medium">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#7AFFA1]"></span>
            <span>{t('modals.alerts.closedLoopTracking')}</span>
          </div>
          <button
            onClick={onClose}
            className="px-3 py-1 text-slate-600 hover:text-black font-bold cursor-pointer"
          >
            {t('modals.alerts.dismiss')}
          </button>
        </div>
      </div>
    </div>
  );
};
