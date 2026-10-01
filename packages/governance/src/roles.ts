/**
 * Roles por capa del proceso y los permisos que se derivan de ellos. Es la única fuente de verdad: el servidor la usa para
 * autorizar y la interfaz para habilitar o deshabilitar acciones (la interfaz nunca es la barrera de seguridad).
 */
export type GovRole = 'admin' | 'demand' | 'distribution' | 'production' | 'purchasing' | 'viewer';

export type Permission =
  | 'demand.edit'
  | 'capacity.edit'
  | 'mps.edit'
  | 'procurement.decide'
  | 'release.propose'
  | 'release.approve.capacity'
  | 'release.approve.mps'
  | 'release.publish'
  | 'users.manage'
  | 'audit.read';

export const ROLE_LABELS: Record<GovRole, string> = {
  admin: 'Administración',
  demand: 'Demanda',
  distribution: 'Distribución (MPS final)',
  production: 'Producción (capacidad)',
  purchasing: 'Compras',
  viewer: 'Consulta',
};

export const ROLE_PERMISSIONS: Record<GovRole, Permission[]> = {
  admin: ['users.manage', 'audit.read'],
  demand: ['demand.edit', 'audit.read'],
  production: ['capacity.edit', 'release.propose', 'release.approve.capacity', 'release.publish', 'audit.read'],
  distribution: ['mps.edit', 'release.propose', 'release.approve.mps', 'release.publish', 'audit.read'],
  purchasing: ['procurement.decide', 'audit.read'],
  viewer: ['audit.read'],
};

export const ROLES = Object.keys(ROLE_PERMISSIONS) as GovRole[];

export const isRole = (v: unknown): v is GovRole => typeof v === 'string' && (ROLES as string[]).includes(v);

export function can(role: GovRole | null | undefined, permission: Permission): boolean {
  return !!role && ROLE_PERMISSIONS[role].includes(permission);
}

export interface Actor {
  id: string;
  name: string;
  role: GovRole;
}

/**
 * Secciones del espacio de trabajo compartido y quién puede modificarlas (basta con uno de los permisos).
 * `log` es solo de añadir: cualquiera con sesión puede registrar, nadie puede borrar ni reescribir.
 */
export const SECTION_PERMISSIONS: Record<string, Permission[] | 'any'> = {
  blocks: ['demand.edit'],
  decisions: ['capacity.edit'],
  adjustments: ['mps.edit'],
  stage: ['capacity.edit', 'mps.edit'],
  recDecisions: ['procurement.decide'],
  leadTimeOverrides: ['procurement.decide'],
  log: 'any',
};

export type Workspace = Record<string, unknown>;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Secciones cuyo contenido cambió entre dos versiones del espacio de trabajo. */
export function changedSections(prev: Workspace, next: Workspace): string[] {
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  return [...keys].filter((k) => !same(prev[k], next[k]));
}

export type StageName = 'DRAFT' | 'SENT_TO_MPS' | 'MPS_FINAL' | 'FINAL_ALERTS';
/** Quién puede llevar el ciclo de una etapa a la siguiente: Miguel envía y emite alertas, Daniel cierra el MPS final. */
const STAGE_PERMISSION: Record<string, Permission> = {
  'DRAFT>SENT_TO_MPS': 'capacity.edit',
  'SENT_TO_MPS>MPS_FINAL': 'mps.edit',
  'MPS_FINAL>FINAL_ALERTS': 'capacity.edit',
};

export interface WorkspaceCheck {
  ok: boolean;
  /** Primera razón de rechazo, lista para mostrar. */
  message?: string;
  changed: string[];
}

/**
 * Autoriza un cambio de espacio de trabajo sección por sección: cada sección modificada exige su permiso, el registro solo puede
 * crecer y la etapa del ciclo solo avanza por la transición que le corresponde al rol (o vuelve a borrador con "reiniciar").
 */
export function checkWorkspaceChange(role: GovRole, prev: Workspace, next: Workspace): WorkspaceCheck {
  const changed = changedSections(prev, next);
  for (const section of changed) {
    const rule = SECTION_PERMISSIONS[section];
    if (rule === undefined) return { ok: false, changed, message: `La sección «${section}» no existe en el espacio de trabajo.` };
    if (rule !== 'any' && !rule.some((p) => can(role, p))) {
      return { ok: false, changed, message: `Tu rol (${ROLE_LABELS[role]}) no puede modificar «${section}».` };
    }
  }
  if (changed.includes('log')) {
    const p = (prev.log as unknown[] | undefined) ?? [];
    const n = (next.log as unknown[] | undefined) ?? [];
    // El registro nuevo conserva al final (más antiguas) todas las entradas anteriores: solo se añaden entradas nuevas al principio.
    if (n.length < p.length || !same(n.slice(n.length - p.length), p)) {
      return { ok: false, changed, message: 'El registro es de solo añadir: no se pueden borrar ni reescribir entradas.' };
    }
  }
  if (changed.includes('stage')) {
    const from = String(prev.stage ?? 'DRAFT');
    const to = String(next.stage ?? 'DRAFT');
    if (to !== 'DRAFT') {
      const needed = STAGE_PERMISSION[`${from}>${to}`];
      if (!needed) return { ok: false, changed, message: `Transición de etapa no permitida: ${from} → ${to}.` };
      if (!can(role, needed)) return { ok: false, changed, message: `Tu rol (${ROLE_LABELS[role]}) no puede pasar el ciclo de ${from} a ${to}.` };
    } else if (!can(role, 'capacity.edit') && !can(role, 'mps.edit')) {
      return { ok: false, changed, message: 'Solo Producción o Distribución pueden reiniciar el ciclo.' };
    }
  }
  return { ok: true, changed };
}
