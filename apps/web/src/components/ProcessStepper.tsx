import React from 'react';
import { ProcessStep } from '../types/demand';
import { ChevronRight, BarChart3, Truck, CalendarRange, Cpu, Boxes, LayoutGrid } from 'lucide-react';

interface ProcessStepperProps {
  currentStep: ProcessStep;
  onSelectStep: (step: ProcessStep) => void;
  sopStatus: string;
  drpStatus: string;
  mpsStatus: string;
  crpStatus: string;
  mrpPendingCount: number;
}

export const ProcessStepper: React.FC<ProcessStepperProps> = ({
  currentStep,
  onSelectStep,
  sopStatus,
  drpStatus,
  mpsStatus,
  crpStatus,
  mrpPendingCount,
}) => {
  const steps: {
    id: ProcessStep;
    code: string;
    label: string;
    icon: React.ElementType;
    badge: string;
    accentColor: string;
  }[] = [
    {
      id: 'process_map',
      code: 'FLOW',
      label: 'Process Map',
      icon: LayoutGrid,
      badge: '5 Stages',
      accentColor: '#DDCBF5',
    },
    {
      id: 'sop',
      code: 'S&OP',
      label: 'Sales & Operations',
      icon: BarChart3,
      badge: sopStatus,
      accentColor: '#7AFFA1',
    },
    {
      id: 'drp',
      code: 'DRP',
      label: 'Distribution Planning',
      icon: Truck,
      badge: drpStatus,
      accentColor: '#FFF87C',
    },
    {
      id: 'mps',
      code: 'MPS',
      label: 'Master Schedule',
      icon: CalendarRange,
      badge: mpsStatus,
      accentColor: '#7AFFA1',
    },
    {
      id: 'crp',
      code: 'CRP',
      label: 'Capacity Planning',
      icon: Cpu,
      badge: crpStatus,
      accentColor: '#FFA27D',
    },
    {
      id: 'mrp',
      code: 'MRP',
      label: 'Materials Planning',
      icon: Boxes,
      badge: `${mrpPendingCount} Action Orders`,
      accentColor: '#DDCBF5',
    },
  ];

  return (
    <div className="px-6 py-2">
      <div className="flex items-center justify-between gap-3 overflow-x-auto scrollbar-none pb-1">
        <div className="flex items-center gap-2 shrink-0">
          {steps.map((step, idx) => {
            const isActive = currentStep === step.id;
            const Icon = step.icon;

            return (
              <React.Fragment key={step.id}>
                <button
                  onClick={() => onSelectStep(step.id)}
                  className={`flex items-center gap-2.5 px-4 py-2 rounded-full transition-all text-left cursor-pointer border ${
                    isActive
                      ? 'bg-black text-white border-black shadow-sm'
                      : 'bg-white/80 hover:bg-white text-slate-700 border-white/80 shadow-2xs hover:shadow-xs'
                  }`}
                >
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
                      isActive ? 'bg-[#7AFFA1] text-black font-bold' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                  </div>

                  <div>
                    <div className="flex items-center gap-1.5 leading-none">
                      <span className="font-extrabold text-xs tracking-tight">
                        {step.code}
                      </span>
                      <span className="text-slate-400 hidden lg:inline">·</span>
                      <span className={`text-xs hidden lg:inline ${isActive ? 'text-slate-300 font-medium' : 'text-slate-500 font-normal'}`}>
                        {step.label}
                      </span>
                    </div>
                  </div>

                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      isActive
                        ? 'bg-white/20 text-[#7AFFA1]'
                        : 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    {step.badge}
                  </span>
                </button>

                {idx < steps.length - 1 && (
                  <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
};
