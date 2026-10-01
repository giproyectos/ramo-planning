import React, { useState, useEffect } from 'react';
import { Search, ArrowRight, BarChart3, Truck, CalendarRange, Cpu, Boxes, RefreshCw, Download, Layers, ShieldCheck, X } from 'lucide-react';
import { ProcessStep, PlanningScenario } from '../../types/demand';
import { useTranslation } from '../../i18n/i18n';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectStep: (step: ProcessStep) => void;
  onTriggerRegeneration: () => void;
  onTriggerExport: () => void;
  onSelectScenario: (scenario: PlanningScenario) => void;
}

interface CommandItem {
  id: string;
  category: 'Navigation' | 'Actions' | 'Entities' | 'Scenarios';
  title: string;
  subtitle: string;
  icon: React.ElementType;
  accentBg: string;
  action: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  onSelectStep,
  onTriggerRegeneration,
  onTriggerExport,
  onSelectScenario,
}) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (isOpen) onClose();
      } else if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const items: CommandItem[] = [
    {
      id: 'step-sop',
      category: 'Navigation',
      title: t('modals.commandPalette.items.sop.title'),
      subtitle: t('modals.commandPalette.items.sop.subtitle'),
      icon: BarChart3,
      accentBg: 'bg-[#dbfced]',
      action: () => {
        onSelectStep('sop');
        onClose();
      },
    },
    {
      id: 'step-drp',
      category: 'Navigation',
      title: t('modals.commandPalette.items.drp.title'),
      subtitle: t('modals.commandPalette.items.drp.subtitle'),
      icon: Truck,
      accentBg: 'bg-[#fffde3]',
      action: () => {
        onSelectStep('drp');
        onClose();
      },
    },
    {
      id: 'step-mps',
      category: 'Navigation',
      title: t('modals.commandPalette.items.mps.title'),
      subtitle: t('modals.commandPalette.items.mps.subtitle'),
      icon: CalendarRange,
      accentBg: 'bg-[#dbfced]',
      action: () => {
        onSelectStep('mps');
        onClose();
      },
    },
    {
      id: 'step-crp',
      category: 'Navigation',
      title: t('modals.commandPalette.items.crp.title'),
      subtitle: t('modals.commandPalette.items.crp.subtitle'),
      icon: Cpu,
      accentBg: 'bg-[#ffefe8]',
      action: () => {
        onSelectStep('crp');
        onClose();
      },
    },
    {
      id: 'step-mrp',
      category: 'Navigation',
      title: t('modals.commandPalette.items.mrp.title'),
      subtitle: t('modals.commandPalette.items.mrp.subtitle'),
      icon: Boxes,
      accentBg: 'bg-[#f5effe]',
      action: () => {
        onSelectStep('mrp');
        onClose();
      },
    },
    {
      id: 'act-regen',
      category: 'Actions',
      title: t('modals.commandPalette.items.regen.title'),
      subtitle: t('modals.commandPalette.items.regen.subtitle'),
      icon: RefreshCw,
      accentBg: 'bg-[#dbfced]',
      action: () => {
        onTriggerRegeneration();
        onClose();
      },
    },
    {
      id: 'act-export',
      category: 'Actions',
      title: t('modals.commandPalette.items.exportItem.title'),
      subtitle: t('modals.commandPalette.items.exportItem.subtitle'),
      icon: Download,
      accentBg: 'bg-slate-100',
      action: () => {
        onTriggerExport();
        onClose();
      },
    },
    {
      id: 'scen-baseline',
      category: 'Scenarios',
      title: t('modals.commandPalette.items.scenBaseline.title'),
      subtitle: t('modals.commandPalette.items.scenBaseline.subtitle'),
      icon: Layers,
      accentBg: 'bg-slate-100',
      action: () => {
        onSelectScenario('baseline');
        onClose();
      },
    },
    {
      id: 'scen-surge',
      category: 'Scenarios',
      title: t('modals.commandPalette.items.scenSurge.title'),
      subtitle: t('modals.commandPalette.items.scenSurge.subtitle'),
      icon: Layers,
      accentBg: 'bg-[#ffefe8]',
      action: () => {
        onSelectScenario('surge');
        onClose();
      },
    },
    {
      id: 'entity-sku1',
      category: 'Entities',
      title: t('modals.commandPalette.items.skuEntity.title'),
      subtitle: t('modals.commandPalette.items.skuEntity.subtitle'),
      icon: Boxes,
      accentBg: 'bg-[#f5effe]',
      action: () => {
        onSelectStep('mps');
        onClose();
      },
    },
    {
      id: 'entity-wc101',
      category: 'Entities',
      title: t('modals.commandPalette.items.wcEntity.title'),
      subtitle: t('modals.commandPalette.items.wcEntity.subtitle'),
      icon: Cpu,
      accentBg: 'bg-[#ffefe8]',
      action: () => {
        onSelectStep('crp');
        onClose();
      },
    },
  ];

  const filtered = items.filter(
    (item) =>
      item.title.toLowerCase().includes(query.toLowerCase()) ||
      item.subtitle.toLowerCase().includes(query.toLowerCase()) ||
      item.category.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 bg-slate-900/40 backdrop-blur-md p-4">
      <div className="bg-white/95 backdrop-blur-2xl border border-white/80 rounded-[32px] max-w-2xl w-full shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Search Input Bar */}
        <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-700 shrink-0">
            <Search className="w-4 h-4" />
          </div>
          <input
            type="text"
            autoFocus
            placeholder={t('modals.commandPalette.placeholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full bg-transparent text-sm text-slate-900 placeholder-slate-400 font-medium focus:outline-none"
          />
          <kbd className="px-2.5 py-1 text-[11px] font-mono font-bold text-slate-600 bg-slate-100 rounded-full border border-slate-200">
            ESC
          </kbd>
        </div>

        {/* Results List */}
        <div className="max-h-[380px] overflow-y-auto p-3 divide-y divide-slate-100">
          {filtered.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500 font-medium">
              {t('modals.commandPalette.noResults', { query })}
            </div>
          ) : (
            filtered.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={item.action}
                  className="w-full flex items-center justify-between p-3 rounded-2xl hover:bg-slate-50 transition-all text-left group cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-2xl ${item.accentBg} flex items-center justify-center text-black font-bold group-hover:bg-black group-hover:text-[#7AFFA1] transition-all shrink-0`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-900 group-hover:text-black flex items-center gap-2">
                        <span>{item.title}</span>
                        <span className="text-[10px] font-bold text-slate-600 px-2 py-0.5 bg-slate-100 rounded-full">
                          {t(`modals.commandPalette.categories.${item.category}`)}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 font-medium mt-0.5">
                        {item.subtitle}
                      </div>
                    </div>
                  </div>
                  <div className="w-7 h-7 rounded-full bg-slate-100 group-hover:bg-black group-hover:text-[#7AFFA1] flex items-center justify-center text-slate-500 transition-all">
                    <ArrowRight className="w-3.5 h-3.5" />
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Footer shortcuts */}
        <div className="px-5 py-3 bg-slate-50/80 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500 font-medium">
          <div className="flex items-center gap-4">
            <span>{t('modals.commandPalette.navigate')} <kbd className="font-bold text-slate-800">↑</kbd> <kbd className="font-bold text-slate-800">↓</kbd></span>
            <span>{t('modals.commandPalette.select')} <kbd className="font-bold text-slate-800">↵</kbd></span>
          </div>
          <span className="font-extrabold text-black">{t('modals.commandPalette.footerBrand')}</span>
        </div>
      </div>
    </div>
  );
};
