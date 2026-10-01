import { Actor, can } from './roles';

/**
 * Flujo de salida a SAP: propuesta → aprobación de Producción (capacidad) y de Distribución (MPS final), con doble control →
 * publicación. Quien propone aprueba, al proponer, la capa de su propio rol (Miguel propone = capacidad; Daniel propone = MPS) y la
 * otra capa la aprueba otra persona; publica una persona distinta de quien propuso (así bastan dos personas y siempre hay dos distintas). Solo lo aprobado se publica y el contenido aprobado es exactamente el publicado (los archivos llevan hash y no
 * se pueden modificar: cualquier cambio exige una propuesta nueva). Funciones puras: devuelven el estado nuevo o el motivo del rechazo.
 */
export type ReleaseStatus = 'PROPOSED' | 'APPROVED' | 'REJECTED' | 'RELEASED' | 'SUPERSEDED';
export type ApprovalKind = 'capacity' | 'mps';
export type ArtifactKind = 'PROVISIONAL_ORDERS' | 'ORDER_DELETIONS' | 'DEMAND_MD61';

export interface Artifact {
  name: string;
  kind: ArtifactKind;
  plantId?: string;
  rows: number;
  sha256: string;
  content: string;
}

export interface ReleaseWarning {
  code: string;
  message: string;
  /** Obligatoria para avisos que exigen justificación explícita. */
  requiresJustification: boolean;
  justification?: string;
}

export interface Approval {
  by: Actor;
  at: string;
  comment: string;
}

export interface ReleasePackage {
  id: string;
  seq: number;
  status: ReleaseStatus;
  proposedBy: Actor;
  proposedAt: string;
  /** Resumen legible del plan que se propone (semanas, cajas, plantas). */
  summary: Record<string, unknown>;
  /** Hash del contenido propuesto (artefactos + resumen): lo aprobado es lo publicado. */
  contentHash: string;
  artifacts: Artifact[];
  warnings: ReleaseWarning[];
  approvals: Partial<Record<ApprovalKind, Approval>>;
  rejection?: { by: Actor; reason: string; at: string };
  releasedBy?: Actor;
  releasedAt?: string;
  supersedes?: string;
}

export interface ReleaseState {
  releases: ReleasePackage[];
}

export const EMPTY_RELEASE_STATE: ReleaseState = { releases: [] };

export type FlowResult = { ok: true; state: ReleaseState; release: ReleasePackage } | { ok: false; code: string; message: string };

const fail = (code: string, message: string): FlowResult => ({ ok: false, code, message });
const MIN_REASON = 10;

export interface ProposalInput {
  summary: Record<string, unknown>;
  artifacts: Artifact[];
  warnings: ReleaseWarning[];
  contentHash: string;
}

const isOpen = (r: ReleasePackage) => r.status === 'PROPOSED' || r.status === 'APPROVED';
const replace = (state: ReleaseState, next: ReleasePackage): ReleaseState => ({ releases: state.releases.map((r) => (r.id === next.id ? next : r)) });
const find = (state: ReleaseState, id: string) => state.releases.find((r) => r.id === id);

export function proposeRelease(state: ReleaseState, actor: Actor, input: ProposalInput, now: string): FlowResult {
  if (!can(actor.role, 'release.propose')) return fail('FORBIDDEN', `Tu rol no puede proponer una salida a SAP.`);
  if (input.artifacts.length === 0) return fail('NO_ARTIFACTS', 'La propuesta no tiene archivos.');
  if (input.artifacts.some((a) => a.rows <= 0)) return fail('EMPTY_ARTIFACT', 'Hay archivos sin filas.');
  const missing = input.warnings.find((w) => w.requiresJustification && (w.justification ?? '').trim().length < MIN_REASON);
  if (missing) return fail('WARNING_NOT_JUSTIFIED', `El aviso «${missing.message}» exige una justificación de al menos ${MIN_REASON} caracteres.`);
  const open = state.releases.find(isOpen);
  if (open) return fail('OPEN_RELEASE_EXISTS', `Ya hay una propuesta abierta (${open.id}); hay que rechazarla o publicarla antes de proponer otra.`);

  const seq = (state.releases[state.releases.length - 1]?.seq ?? 0) + 1;
  const ownLayer: ApprovalKind | null = actor.role === 'production' ? 'capacity' : actor.role === 'distribution' ? 'mps' : null;
  const release: ReleasePackage = {
    id: `REL-${String(seq).padStart(4, '0')}`,
    seq,
    status: 'PROPOSED',
    proposedBy: actor,
    proposedAt: now,
    summary: input.summary,
    contentHash: input.contentHash,
    artifacts: input.artifacts,
    warnings: input.warnings,
    approvals: ownLayer ? { [ownLayer]: { by: actor, at: now, comment: 'Aprobado al proponer (capa del proponente)' } } : {},
    supersedes: [...state.releases].reverse().find((r) => r.status === 'RELEASED')?.id,
  };
  return { ok: true, state: { releases: [...state.releases, release] }, release };
}

export function approveRelease(state: ReleaseState, actor: Actor, id: string, kind: ApprovalKind, comment: string, now: string): FlowResult {
  const r = find(state, id);
  if (!r) return fail('NOT_FOUND', 'La propuesta no existe.');
  const permission = kind === 'capacity' ? 'release.approve.capacity' : 'release.approve.mps';
  if (!can(actor.role, permission)) return fail('FORBIDDEN', `Tu rol no puede aprobar ${kind === 'capacity' ? 'la capacidad (Producción)' : 'el MPS final (Distribución)'}.`);
  if (r.status !== 'PROPOSED') return fail('BAD_STATE', `La propuesta está en estado ${r.status}: ya no admite aprobaciones.`);
  if (actor.id === r.proposedBy.id) return fail('FOUR_EYES', 'Quien propone no puede aprobar su propia propuesta (doble control).');
  if (r.approvals[kind]) return fail('ALREADY_APPROVED', 'Esa aprobación ya está registrada.');
  const approvals = { ...r.approvals, [kind]: { by: actor, at: now, comment: comment.trim() } };
  const next: ReleasePackage = { ...r, approvals, status: approvals.capacity && approvals.mps ? 'APPROVED' : 'PROPOSED' };
  return { ok: true, state: replace(state, next), release: next };
}

export function rejectRelease(state: ReleaseState, actor: Actor, id: string, reason: string, now: string): FlowResult {
  const r = find(state, id);
  if (!r) return fail('NOT_FOUND', 'La propuesta no existe.');
  const allowed = can(actor.role, 'release.approve.capacity') || can(actor.role, 'release.approve.mps') || actor.id === r.proposedBy.id;
  if (!allowed) return fail('FORBIDDEN', 'Tu rol no puede rechazar esta propuesta.');
  if (!isOpen(r)) return fail('BAD_STATE', `La propuesta está en estado ${r.status}: no se puede rechazar.`);
  if (reason.trim().length < MIN_REASON) return fail('REASON_REQUIRED', `El rechazo exige un motivo de al menos ${MIN_REASON} caracteres.`);
  const next: ReleasePackage = { ...r, status: 'REJECTED', rejection: { by: actor, reason: reason.trim(), at: now } };
  return { ok: true, state: replace(state, next), release: next };
}

export function publishRelease(state: ReleaseState, actor: Actor, id: string, now: string): FlowResult {
  const r = find(state, id);
  if (!r) return fail('NOT_FOUND', 'La propuesta no existe.');
  if (!can(actor.role, 'release.publish')) return fail('FORBIDDEN', 'Tu rol no puede publicar la salida.');
  if (r.status !== 'APPROVED') return fail('NOT_APPROVED', r.status === 'PROPOSED' ? 'Faltan aprobaciones: se necesitan Producción (capacidad) y Distribución (MPS final).' : `La propuesta está en estado ${r.status}: no se puede publicar.`);
  if (actor.id === r.proposedBy.id) return fail('FOUR_EYES', 'Quien propone no puede publicar su propia propuesta (doble control).');
  const next: ReleasePackage = { ...r, status: 'RELEASED', releasedBy: actor, releasedAt: now };
  const releases = state.releases.map((x) => (x.id === r.id ? next : x.status === 'RELEASED' ? { ...x, status: 'SUPERSEDED' as const } : x));
  return { ok: true, state: { releases }, release: next };
}
