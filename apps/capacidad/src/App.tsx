import React, { useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { GlassAtmosphere } from './components/common/GlassAtmosphere';
import { MpsView } from './components/ramo/MpsView';
import { CrpView } from './components/ramo/CrpView';
import { DeskView } from './components/ramo/DeskView';
import { PlantsView } from './components/ramo/PlantsView';
import { ReleaseView } from './components/ramo/ReleaseView';
import { DataScreen } from './components/ramo/DataScreen';
import { FocusSummary } from './components/ramo/FocusSummary';
import { LoginScreen } from './components/ramo/LoginScreen';
import { AuthProvider, useAuth } from './ramo/auth';
import { RamoPlanProvider } from './ramo/store';
import { ProcessStep } from './ramo/steps';

export default function App() {
  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  );
}

/** En modo servidor, nadie ve el plan sin entrar; en modo local (sin servidor) pasa directo. */
function AuthGate() {
  const { mode } = useAuth();
  if (mode === 'checking') return <div className="min-h-screen flex items-center justify-center text-xs text-slate-500">Conectando…</div>;
  if (mode === 'anonymous') return <LoginScreen />;
  return (
    <RamoPlanProvider>
      <AppContent />
    </RamoPlanProvider>
  );
}

function AppContent() {
  const [currentStep, setCurrentStep] = useState<ProcessStep>('summary');

  return (
    <div className="min-h-screen text-slate-900 flex antialiased selection:bg-[#7AFFA1]/40 selection:text-black relative">
      <GlassAtmosphere />
      <Sidebar currentStep={currentStep} onSelectStep={setCurrentStep} />

      <div className="flex-1 flex flex-col min-w-0 overflow-x-hidden relative z-10">
        <Header currentStep={currentStep} />

        <main className="flex-1 px-6 py-6 pb-16">
          {currentStep === 'summary' && <FocusSummary onSelectStep={setCurrentStep} />}
          {currentStep === 'mps' && <MpsView />}
          {currentStep === 'crp' && <CrpView />}
          {currentStep === 'plants' && <PlantsView onSelectStep={setCurrentStep} />}
          {currentStep === 'daily' && <DeskView />}
          {currentStep === 'release' && <ReleaseView onSelectStep={setCurrentStep} />}
          {currentStep === 'data' && <DataScreen />}
        </main>

        <footer className="px-6 py-4 text-xs text-slate-500 flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-white/60 glass-panel">
          <div className="flex items-center gap-2.5">
            <span className="w-2 h-2 rounded-full bg-[#7AFFA1]"></span>
            <span className="font-extrabold text-black">Ramo · Programación de capacidad</span>
            <span className="text-slate-300">·</span>
            <span>CRP ⇄ MPS → Plantas → Día a día → Plan oficial</span>
          </div>
          <div className="text-slate-500 font-mono text-[11px]">Piloto GI Proyectos</div>
        </footer>
      </div>
    </div>
  );
}
