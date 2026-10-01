import React, { useState } from 'react';
import { useAuth } from '../../ramo/auth';

/** Pantalla de acceso del modo servidor. */
export function LoginScreen() {
  const { login, error } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await login(username, password);
    setBusy(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <form onSubmit={submit} className="glass-panel rounded-3xl p-7 w-full max-w-sm space-y-4">
        <div>
          <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">Ramo Planning</div>
          <h1 className="text-xl font-black tracking-tight text-slate-950 mt-1">Entrar</h1>
          <p className="text-xs text-slate-500 mt-1">Cada persona entra con su usuario: lo que puede hacer depende de su rol, y todo queda en la auditoría.</p>
        </div>
        <label className="block text-[11px] font-bold text-slate-600">Usuario
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus className="block mt-1 w-full rounded-xl border border-black/10 bg-white/80 px-3 py-2 text-sm" />
        </label>
        <label className="block text-[11px] font-bold text-slate-600">Contraseña
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" className="block mt-1 w-full rounded-xl border border-black/10 bg-white/80 px-3 py-2 text-sm" />
        </label>
        {error && <p role="alert" className="text-xs font-bold text-[#c2410c]">{error}</p>}
        <button type="submit" disabled={busy || !username || !password} className="w-full px-4 py-2.5 text-xs font-bold text-white bg-slate-950 rounded-full disabled:opacity-40 cursor-pointer">
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
        <p className="text-[10px] text-slate-400">Entorno de desarrollo: las contraseñas iniciales las genera el servidor al arrancar por primera vez y quedan en <span className="font-mono">data/private/server/dev-credentials.json</span> (no se versiona).</p>
      </form>
    </div>
  );
}
