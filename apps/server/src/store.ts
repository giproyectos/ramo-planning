import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Actor, AuditEntry, EMPTY_RELEASE_STATE, GovRole, ReleaseState, Workspace, appendEntry, verifyChain } from '@ramo/governance';
import { sha256 } from './crypto';

export interface UserRecord {
  id: string;
  name: string;
  role: GovRole;
  passwordHash: string;
  createdAt: string;
  disabled?: boolean;
}

export interface WorkspaceRecord {
  revision: number;
  data: Workspace;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface ServerState {
  users: UserRecord[];
  workspace: WorkspaceRecord;
  releaseState: ReleaseState;
  /** Secreto de firma de tokens: se genera una vez y vive solo en el directorio de datos (nunca en el repo). */
  secret: string;
}

export const EMPTY_WORKSPACE: Workspace = { blocks: [], decisions: [], adjustments: [], stage: 'DRAFT', recDecisions: {}, leadTimeOverrides: {}, log: [] };

/**
 * Persistencia en archivos: `state.json` (usuarios, espacio de trabajo y propuestas; se reescribe de forma atómica) y
 * `audit.ndjson` (solo se añade, una entrada encadenada por línea). Es suficiente para un piloto de un solo servidor; el mismo
 * contrato se puede mover a una base de datos (PostgreSQL) sin tocar las rutas.
 * Las operaciones se serializan: una a la vez, para que dos peticiones simultáneas no se pisen.
 */
export class FileStore {
  state: ServerState;
  audit: AuditEntry[] = [];
  private readonly statePath: string;
  private readonly auditPath: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(readonly dir: string, secret: string) {
    mkdirSync(dir, { recursive: true });
    this.statePath = join(dir, 'state.json');
    this.auditPath = join(dir, 'audit.ndjson');
    this.state = existsSync(this.statePath)
      ? (JSON.parse(readFileSync(this.statePath, 'utf8')) as ServerState)
      : { users: [], workspace: { revision: 0, data: structuredClone(EMPTY_WORKSPACE), updatedAt: null, updatedBy: null }, releaseState: EMPTY_RELEASE_STATE, secret };
    if (existsSync(this.auditPath)) {
      this.audit = readFileSync(this.auditPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as AuditEntry);
    }
  }

  /** Ejecuta una operación a la vez. */
  exclusive<T>(fn: () => Promise<T> | T): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  save(): void {
    const tmp = `${this.statePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    renameSync(tmp, this.statePath);
  }

  log(actor: Actor | null, type: string, data: Record<string, unknown>, at: string): AuditEntry {
    const entry = appendEntry(this.audit, actor, type, data, at, sha256);
    appendFileSync(this.auditPath, `${JSON.stringify(entry)}\n`);
    this.audit.push(entry);
    return entry;
  }

  verifyAudit() {
    return verifyChain(this.audit, sha256);
  }
}
