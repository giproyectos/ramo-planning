import React from 'react';
import { LayoutGrid, BarChart3, Truck, CalendarRange, Cpu, Boxes, Database, Sparkles, Send } from 'lucide-react';
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
  const { sync, dataset, baseline, forecast, drp, stage, danielView, supplyRisk, pendingRecommendations, serverMode } = useRamoPlan();

  const stockouts = drp?.alerts.filter((a) => a.code === 'STOCKOUT').length ?? 0;
  const overloads = danielView.alerts.length;
  const critical = supplyRisk?.risks.filter((r) => r.status === 'CRITICAL').length ?? 0;
  const stageBadge = { DRAFT: 'Borrador', SENT_TO_MPS: 'En revisión', MPS_FINAL: 'Cerrado', FINAL_ALERTS: 'Cerrado' }[stage];

  const navItems: { id: ProcessStep; code: string; name: string; icon: React.ElementType; badge: string; tone: Tone }[] = [
    { id: 'summary', code: 'Resumen', name: 'Vista general', icon: LayoutGrid, badge: '', tone: 'info' },
    { id: 'sop', code: 'Demanda', name: 'Pronóstico y ajustes', icon: BarChart3, badge: forecast ? 'Pronóstico' : 'Fija', tone: forecast ? 'ok' : 'warn' },
    { id: 'drp', code: 'DRP', name: 'Red de distribución', icon: Truck, badge: !drp ? '—' : stockouts > 0 ? `${stockouts} quiebre(s)` : 'Sin quiebres', tone: !drp ? 'info' : stockouts > 0 ? 'bad' : 'ok' },
    { id: 'mps', code: 'MPS', name: 'MPS final (Daniel)', icon: CalendarRange, badge: stageBadge, tone: stage === 'DRAFT' ? 'info' : stage === 'SENT_TO_MPS' ? 'warn' : 'ok' },
    { id: 'crp', code: 'CRP', name: 'Capacidad (Miguel)', icon: Cpu, badge: overloads > 0 ? `${overloads} en rojo` : 'Factible', tone: overloads > 0 ? 'bad' : 'ok' },
    { id: 'mrp', code: 'MRP', name: 'Materiales', icon: Boxes, badge: !supplyRisk ? '—' : critical > 0 ? `${critical} crítico(s)` : 'Sin críticos', tone: !supplyRisk ? 'info' : critical > 0 ? 'bad' : 'ok' },
    { id: 'data', code: 'Datos', name: 'Bases SAP del lunes', icon: Database, badge: baseline?.usable ? 'SAP' : 'Ejemplo', tone: baseline?.usable ? 'ok' : 'warn' },
    { id: 'ai', code: 'Compras', name: 'Recomendaciones', icon: Sparkles, badge: String(pendingRecommendations.length), tone: pendingRecommendations.length === 0 ? 'ok' : 'info' },
    { id: 'release', code: 'Salida', name: 'Aprobar y publicar', icon: Send, badge: serverMode ? 'Servidor' : 'Local', tone: serverMode ? 'ok' : 'warn' },
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
            <span className="text-xs font-black text-slate-900 tracking-tight leading-none">Ramo Planning</span>
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mt-0.5">Planeación integrada</span>
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
          <div className="px-3 pb-1 text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Proceso de planeación</div>
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
