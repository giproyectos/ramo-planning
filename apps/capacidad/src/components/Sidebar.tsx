import React from 'react';
import { LayoutGrid, CalendarRange, CalendarClock, Cpu, Factory } from 'lucide-react';
import { ROLE_LABELS } from '@ramo/governance';
import { useAuth } from '../ramo/auth';
import { useRamoPlan } from '../ramo/store';
import { ProcessStep } from '../ramo/steps';

interface SidebarProps {
  currentStep: ProcessStep;
  onSelectStep: (step: ProcessStep) => void;
}

const syncLabel: Record<string, string> = {
  local: 'local', loading: 'cargando…', saving: 'guardando…', saved: 'guardado ✓', conflict: 'conflicto: recarga', denied: 'cambio no permitido', offline: 'sin conexión',
};

const TONE = { ok: 'bg-[#7AFFA1]', warn: 'bg-[#FFF87C]', bad: 'bg-[#FFA27D]', info: 'bg-[#DDCBF5]' } as const;
type Tone = keyof typeof TONE;

export const Sidebar: React.FC<SidebarProps> = ({ currentStep, onSelectStep }) => {
  const { mode, user, logout } = useAuth();
  const { sync, dataset, stage, miguelView, daily, plantRows } = useRamoPlan();
  const plantPending = plantRows.filter((r) => r.status === 'PENDING').length;
  const plantShort = plantRows.filter((r) => r.shortfall > 0 || r.planChanged).length;

  const overloads = miguelView.alerts.length;
  // Semanas con algún día sobre capacidad (no días: un número de días con tres dígitos no dice nada en el menú).
  const dailyOver = new Set(daily?.alerts.filter((a) => a.code === 'OVER_CAPACITY').map((a) => a.weekStart)).size;
  const stageBadge = { DRAFT: 'Borrador', SENT_TO_MPS: 'En revisión', MPS_FINAL: 'Cerrado', FINAL_ALERTS: 'Cerrado' }[stage];

  const navItems: { id: ProcessStep; code: string; name: string; icon: React.ElementType; badge: string; tone: Tone }[] = [
    { id: 'summary', code: 'Resumen', name: 'Vista general', icon: LayoutGrid, badge: '', tone: 'info' },
    { id: 'crp', code: 'CRP', name: 'Capacidad por línea', icon: Cpu, badge: overloads > 0 ? `${overloads} en rojo` : 'Factible', tone: overloads > 0 ? 'bad' : 'ok' },
    { id: 'mps', code: 'MPS', name: 'MPS final', icon: CalendarRange, badge: stageBadge, tone: stage === 'DRAFT' ? 'info' : stage === 'SENT_TO_MPS' ? 'warn' : 'ok' },
    { id: 'plants', code: 'Plantas', name: 'Confirmación de plantas', icon: Factory, badge: plantRows.length === 0 ? '—' : plantPending > 0 ? `${plantPending} por confirmar` : plantShort > 0 ? `${plantShort} bajo el plan` : 'Al día', tone: plantRows.length === 0 ? 'info' : plantPending > 0 ? 'info' : plantShort > 0 ? 'warn' : 'ok' },
    { id: 'daily', code: 'Día a día', name: 'Mesa de programación', icon: CalendarClock, badge: !daily ? '—' : dailyOver > 0 ? `${dailyOver} sem. en rojo` : 'Factible', tone: !daily ? 'info' : dailyOver > 0 ? 'bad' : 'ok' },
  ];

  return (
    <aside className="w-64 lg:w-72 shrink-0 flex flex-col justify-between p-4 lg:p-5 h-screen sticky top-0 glass-panel border-r border-white/70 z-20">
      <div className="space-y-4">
        <div className="flex items-center gap-2 px-2 pt-1">
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              onSelectStep('summary');
            }}
            className="text-3xl font-black tracking-tighter text-slate-950 flex items-center leading-none hover:opacity-80 transition-opacity"
          >
            <span>rp</span>
            <span className="text-[#7AFFA1] font-extrabold text-4xl leading-none">.</span>
          </a>
          <div className="flex flex-col">
            <span className="text-xs font-black text-slate-900 tracking-tight leading-none">Ramo</span>
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mt-0.5">Programación de capacidad</span>
          </div>
        </div>

        <div className="glass-card rounded-2xl p-3 flex items-center gap-2.5 min-w-0">
          <div className="w-2.5 h-2.5 rounded-full bg-[#7AFFA1] shrink-0"></div>
          <div className="min-w-0">
            <div className="text-xs font-black text-slate-900 leading-tight truncate">Ramo</div>
            <div className="text-[10px] text-slate-500 font-semibold truncate">
              {dataset.plants.length} plantas · {dataset.lines.length} líneas · {dataset.skus.length} productos
            </div>
          </div>
        </div>

        <div className="space-y-1">
          <div className="px-3 pb-1 text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Del MPS al día a día</div>
          <nav className="space-y-1.5">
            {navItems.map((item) => {
              const isActive = currentStep === item.id;
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => onSelectStep(item.id)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-2xl transition-all cursor-pointer text-left group overflow-hidden ${
                    isActive ? 'bg-slate-950 text-white shadow-md' : 'hover:bg-white/80 text-slate-700 hover:text-slate-950'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1 mr-2">
                    <div
                      className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 transition-all ${
                        isActive ? 'bg-[#7AFFA1] text-black font-black' : 'bg-white/80 text-slate-600 group-hover:bg-slate-100 group-hover:text-black border border-white/60'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className={`text-xs font-black tracking-tight truncate ${isActive ? 'text-white' : 'text-slate-900'}`}>{item.code}</div>
                      <div className={`text-[11px] font-medium truncate ${isActive ? 'text-slate-300' : 'text-slate-500'}`}>{item.name}</div>
                    </div>
                  </div>
                  {item.badge && (
                    <span className={`text-[9px] font-extrabold px-2 py-0.5 rounded-full shrink-0 text-black leading-tight text-center ${isActive ? 'bg-[#7AFFA1]' : TONE[item.tone]}`}>
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      <div className="pt-2 border-t border-black/5">
        <div className="flex items-center justify-between p-2 rounded-2xl glass-pill">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-[#FFA27D] to-[#FFF87C] p-0.5 shrink-0">
              <div className="w-full h-full rounded-full bg-white flex items-center justify-center font-black text-[11px] text-slate-900">
                {user ? user.name.slice(0, 2).toUpperCase() : 'RP'}
              </div>
            </div>
            <div className="min-w-0">
              <div className="text-xs font-black text-slate-900 leading-tight truncate">{user ? user.name : 'Modo local'}</div>
              <div className="text-[9px] text-slate-500 font-medium truncate" title={sync.message}>
                {user ? `${ROLE_LABELS[user.role]} · ${syncLabel[sync.state]}` : mode === 'local' ? 'Sin servidor: todo permitido, nada se guarda' : ''}
              </div>
            </div>
          </div>
          {user && (
            <button onClick={logout} className="text-[10px] font-bold text-slate-500 hover:text-black underline cursor-pointer shrink-0">Salir</button>
          )}
        </div>
      </div>
    </aside>
  );
};
