import type { AuditEntry, GovRole, ReleasePackage } from '@ramo/governance';

/** Cliente del servidor de gobernanza. El token vive en memoria y en sessionStorage (se borra al cerrar la pestaña). */
const TOKEN_KEY = 'ramo.token';
let token: string | null = (() => {
  try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
})();

export function setToken(t: string | null) {
  token = t;
  try { if (t) sessionStorage.setItem(TOKEN_KEY, t); else sessionStorage.removeItem(TOKEN_KEY); } catch { /* sin almacenamiento: solo en memoria */ }
}
export const hasToken = () => token !== null;

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError(0, 'NETWORK', 'No se pudo contactar al servidor.');
  }
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* no es JSON */ }
  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(res.status, err?.code ?? 'ERROR', err?.message ?? `Error ${res.status}`);
  }
  return json as T;
}

export interface PublicUser { id: string; name: string; role: GovRole; roleLabel: string; disabled: boolean }
export interface WorkspaceDoc { revision: number; data: Record<string, unknown>; updatedAt: string | null; updatedBy: string | null }
export interface ReleaseList { releases: ReleasePackage[]; nextId: string }
export interface OrderRow { accion: 'CREAR' | 'BORRAR'; centro: string; material: string; tipoOrden: string; cantidad: number; unidad: string; fechaFin: string; linea: string; referencia: string }

export const api = {
  health: () => request<{ ok: boolean; users: number }>('GET', '/api/health'),
  login: (username: string, password: string) => request<{ token: string; expiresAt: string; user: PublicUser }>('POST', '/api/login', { username, password }),
  me: () => request<{ user: PublicUser }>('GET', '/api/me'),
  users: () => request<{ users: PublicUser[] }>('GET', '/api/users'),
  createUser: (u: { id: string; name: string; role: GovRole }) => request<{ user: PublicUser; password: string }>('POST', '/api/users', u),
  workspace: () => request<WorkspaceDoc>('GET', '/api/workspace'),
  saveWorkspace: (baseRevision: number, data: Record<string, unknown>) => request<WorkspaceDoc>('PUT', '/api/workspace', { baseRevision, data }),
  releases: () => request<ReleaseList>('GET', '/api/releases'),
  release: (id: string) => request<ReleasePackage>('GET', `/api/releases/${id}`),
  priorOrders: () => request<{ releaseId: string | null; orders: OrderRow[] }>('GET', '/api/releases/prior-orders'),
  propose: (body: unknown) => request<ReleasePackage>('POST', '/api/releases', body),
  approve: (id: string, as: 'capacity' | 'mps', comment: string) => request<ReleasePackage>('POST', `/api/releases/${id}/approve`, { as, comment }),
  reject: (id: string, reason: string) => request<ReleasePackage>('POST', `/api/releases/${id}/reject`, { reason }),
  publish: (id: string) => request<ReleasePackage>('POST', `/api/releases/${id}/publish`),
  audit: (limit = 100) => request<{ total: number; entries: AuditEntry[] }>('GET', `/api/audit?limit=${limit}`),
  verifyAudit: () => request<{ ok: boolean; entries: number; brokenAt?: number; reason?: string }>('GET', '/api/audit/verify'),
};

/** Descarga un archivo de una propuesta (con la sesión, por eso no es un simple enlace). */
export async function downloadArtifact(releaseId: string, name: string): Promise<void> {
  const res = await fetch(`/api/releases/${releaseId}/artifacts/${name}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new ApiError(res.status, 'DOWNLOAD', 'No se pudo descargar el archivo.');
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
