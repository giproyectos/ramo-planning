import { Actor } from './roles';

/**
 * Registro de auditoría encadenado: cada entrada incluye el hash de la anterior, así que modificar, borrar o reordenar una entrada
 * rompe la cadena y se detecta al verificarla. Es evidencia de integridad (a prueba de manipulación casual), no de no-repudio:
 * eso exigiría firmas con llaves de cada usuario.
 */
export type Sha256 = (text: string) => string;

export interface AuditEntry {
  seq: number;
  at: string;
  /** null para eventos del sistema (arranque, creación de usuarios iniciales). */
  actor: Actor | null;
  type: string;
  data: Record<string, unknown>;
  prevHash: string;
  hash: string;
}

export const GENESIS_HASH = '0'.repeat(64);

/** JSON canónico: claves ordenadas, para que el mismo contenido produzca siempre el mismo hash. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).filter((k) => obj[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

type EntryBody = Omit<AuditEntry, 'hash'>;
const hashOf = (body: EntryBody, sha: Sha256) => sha(canonicalJson(body));

export function appendEntry(log: AuditEntry[], actor: Actor | null, type: string, data: Record<string, unknown>, at: string, sha: Sha256): AuditEntry {
  const prev = log[log.length - 1];
  const body: EntryBody = { seq: (prev?.seq ?? 0) + 1, at, actor, type, data, prevHash: prev?.hash ?? GENESIS_HASH };
  return { ...body, hash: hashOf(body, sha) };
}

export interface ChainVerification {
  ok: boolean;
  entries: number;
  /** Primera entrada que no cuadra. */
  brokenAt?: number;
  reason?: string;
}

export function verifyChain(log: AuditEntry[], sha: Sha256): ChainVerification {
  let prevHash = GENESIS_HASH;
  for (let i = 0; i < log.length; i++) {
    const e = log[i];
    if (e.seq !== i + 1) return { ok: false, entries: log.length, brokenAt: e.seq, reason: `La secuencia se interrumpe: se esperaba ${i + 1} y hay ${e.seq}.` };
    if (e.prevHash !== prevHash) return { ok: false, entries: log.length, brokenAt: e.seq, reason: 'El enlace con la entrada anterior no coincide (se borró, insertó o reordenó algo).' };
    const { hash, ...body } = e;
    if (hashOf(body, sha) !== hash) return { ok: false, entries: log.length, brokenAt: e.seq, reason: 'El contenido de la entrada fue modificado.' };
    prevHash = hash;
  }
  return { ok: true, entries: log.length };
}
