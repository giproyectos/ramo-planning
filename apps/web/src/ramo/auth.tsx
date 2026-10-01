import React, { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Permission, can as canRole } from '@ramo/governance';
import { ApiError, PublicUser, api, hasToken, setToken } from './api';

/**
 * Modo servidor: hay que entrar con usuario y los permisos salen del rol.
 * Modo local: no hay servidor accesible, todo está permitido, nada se guarda y no hay salida a SAP (no hay doble control ni auditoría).
 */
export type AuthMode = 'checking' | 'local' | 'anonymous' | 'authenticated';

interface AuthState {
  mode: AuthMode;
  user: PublicUser | null;
  error: string;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
  can: (permission: Permission) => boolean;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<AuthMode>('checking');
  const [user, setUser] = useState<PublicUser | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await api.health();
      } catch {
        if (!cancelled) setMode('local');
        return;
      }
      if (hasToken()) {
        try {
          const { user: u } = await api.me();
          if (!cancelled) { setUser(u); setMode('authenticated'); }
          return;
        } catch {
          setToken(null);
        }
      }
      if (!cancelled) setMode('anonymous');
    })();
    return () => { cancelled = true; };
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    setError('');
    try {
      const r = await api.login(username, password);
      setToken(r.token);
      setUser(r.user);
      setMode('authenticated');
      return true;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo entrar.');
      return false;
    }
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    setMode('anonymous');
  }, []);

  const can = useCallback((permission: Permission) => (mode === 'local' ? true : canRole(user?.role, permission)), [mode, user]);
  const value = useMemo(() => ({ mode, user, error, login, logout, can }), [mode, user, error, login, logout, can]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return v;
}
