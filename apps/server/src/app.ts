import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { join } from 'node:path';
import {
  Actor, Artifact, ArtifactKind, GovRole, Permission, ReleaseWarning, ROLE_LABELS, Workspace, approveRelease, can, canonicalJson, checkWorkspaceChange, isRole,
  proposeRelease, publishRelease, rejectRelease,
} from '@ramo/governance';
import { ProvisionalOrderRow, validateMd61File, validateOrdersFile } from '@ramo/sap-out';
import { hashPassword, randomPassword, sha256, signToken, verifyPassword, verifyToken } from './crypto';
import { FileStore, UserRecord } from './store';

export interface ServerConfig {
  dataDir: string;
  tokenTtlMs?: number;
  now?: () => number;
  /** Solo para pruebas: contraseñas fijas de los usuarios iniciales. Sin esto se generan aleatorias y se guardan en el directorio de datos. */
  seedPasswords?: Record<string, string>;
  loginMaxAttempts?: number;
  loginWindowMs?: number;
  log?: (message: string) => void;
}

export interface App {
  server: http.Server;
  store: FileStore;
  listen(port?: number, host?: string): Promise<number>;
  close(): Promise<void>;
}

const MAX_BODY = 8 * 1024 * 1024;
const MAX_ARTIFACT = 2 * 1024 * 1024;
const NAME_RE = /^[A-Za-z0-9_.-]{1,80}\.csv$/;
const ID_RE = /^[a-z0-9._-]{3,32}$/;
const KINDS: ArtifactKind[] = ['PROVISIONAL_ORDERS', 'ORDER_DELETIONS', 'DEMAND_MD61'];

const SEED_USERS: { id: string; name: string; role: GovRole }[] = [
  { id: 'admin', name: 'Administración', role: 'admin' },
  { id: 'diana', name: 'Diana (Demanda)', role: 'demand' },
  { id: 'miguel', name: 'Miguel (Capacidad)', role: 'production' },
  { id: 'daniel', name: 'Daniel (MPS final)', role: 'distribution' },
  { id: 'compras', name: 'Compras', role: 'purchasing' },
  { id: 'consulta', name: 'Consulta', role: 'viewer' },
];

class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

const STATUS_BY_CODE: Record<string, number> = { FORBIDDEN: 403, NOT_FOUND: 404, BAD_STATE: 409, OPEN_RELEASE_EXISTS: 409, ALREADY_APPROVED: 409, FOUR_EYES: 409, NOT_APPROVED: 409 };

export async function createApp(config: ServerConfig): Promise<App> {
  const now = config.now ?? (() => Date.now());
  const iso = () => new Date(now()).toISOString();
  const log = config.log ?? (() => undefined);
  const ttl = config.tokenTtlMs ?? 8 * 3600 * 1000;
  const store = new FileStore(config.dataDir, randomBytes(32).toString('hex'));
  const secret = store.state.secret;

  // Usuarios iniciales: contraseñas aleatorias que se muestran una sola vez en un archivo local (nunca en el repo).
  if (store.state.users.length === 0) {
    const credentials: Record<string, string> = {};
    for (const u of SEED_USERS) {
      const password = config.seedPasswords?.[u.id] ?? randomPassword();
      credentials[u.id] = password;
      store.state.users.push({ id: u.id, name: u.name, role: u.role, passwordHash: await hashPassword(password), createdAt: iso() });
    }
    store.save();
    store.log(null, 'system.seed', { users: SEED_USERS.map((u) => ({ id: u.id, role: u.role })) }, iso());
    if (!config.seedPasswords) {
      mkdirSync(config.dataDir, { recursive: true });
      const path = join(config.dataDir, 'dev-credentials.json');
      writeFileSync(path, JSON.stringify(credentials, null, 2));
      log(`Usuarios iniciales creados. Contraseñas de desarrollo en ${path} (no se versiona).`);
    }
  } else if (!existsSync(join(config.dataDir, 'state.json'))) store.save();

  const audit = store.verifyAudit();
  log(audit.ok ? `Auditoría íntegra (${audit.entries} entradas).` : `¡ATENCIÓN! La cadena de auditoría está rota en la entrada ${audit.brokenAt}: ${audit.reason}`);

  // Límite de intentos de acceso fallidos por usuario.
  const failures = new Map<string, number[]>();
  const maxAttempts = config.loginMaxAttempts ?? 5;
  const windowMs = config.loginWindowMs ?? 5 * 60 * 1000;
  const recentFailures = (key: string) => (failures.get(key) ?? []).filter((t) => t > now() - windowMs);

  const toActor = (u: UserRecord): Actor => ({ id: u.id, name: u.name, role: u.role });
  const publicUser = (u: UserRecord) => ({ id: u.id, name: u.name, role: u.role, roleLabel: ROLE_LABELS[u.role], disabled: !!u.disabled });

  const readJson = (req: http.IncomingMessage): Promise<Record<string, unknown>> =>
    new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on('data', (c: Buffer) => {
        size += c.length;
        if (size > MAX_BODY) { reject(new HttpError(413, 'TOO_LARGE', 'El cuerpo de la petición es demasiado grande.')); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        if (size === 0) return resolve({});
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('no es un objeto');
          resolve(parsed as Record<string, unknown>);
        } catch {
          reject(new HttpError(400, 'BAD_JSON', 'El cuerpo no es un objeto JSON válido.'));
        }
      });
      req.on('error', reject);
    });

  const send = (res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
    const isText = typeof body === 'string';
    res.writeHead(status, {
      'Content-Type': isText ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    });
    res.end(isText ? body : JSON.stringify(body));
  };

  const authenticate = (req: http.IncomingMessage): UserRecord => {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const payload = token ? verifyToken(token, secret, now()) : null;
    const user = payload ? store.state.users.find((u) => u.id === payload.sub) : undefined;
    if (!user || user.disabled) throw new HttpError(401, 'UNAUTHENTICATED', 'Sesión no válida o vencida: vuelve a entrar.');
    return user;
  };
  const need = (user: UserRecord, permission: Permission) => {
    if (!can(user.role, permission)) throw new HttpError(403, 'FORBIDDEN', `Tu rol (${ROLE_LABELS[user.role]}) no puede hacer esto.`);
  };

  // --------------------------------------------------------------------------- liberaciones
  const releaseView = (r: (typeof store.state.releaseState.releases)[number], withContent: boolean) => ({
    ...r,
    artifacts: r.artifacts.map(({ content, ...rest }) => (withContent ? { ...rest, content } : rest)),
  });
  const nextReleaseId = () => `REL-${String((store.state.releaseState.releases[store.state.releaseState.releases.length - 1]?.seq ?? 0) + 1).padStart(4, '0')}`;
  const lastReleased = () => [...store.state.releaseState.releases].reverse().find((r) => r.status === 'RELEASED');
  const priorOrders = (): ProvisionalOrderRow[] => {
    const prior = lastReleased();
    return prior ? prior.artifacts.filter((a) => a.kind === 'PROVISIONAL_ORDERS').flatMap((a) => validateOrdersFile(a.content, 'PROVISIONAL_ORDERS').rows) : [];
  };

  const buildArtifacts = (releaseId: string, raw: unknown): Artifact[] => {
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > 40) throw new HttpError(422, 'BAD_ARTIFACTS', 'La propuesta debe traer entre 1 y 40 archivos.');
    const names = new Set<string>();
    const artifacts: Artifact[] = [];
    const created: ProvisionalOrderRow[] = [];
    const deletionRefs = new Set<string>();

    for (const a of raw as Record<string, unknown>[]) {
      const { name, kind, content, plantId } = a;
      if (typeof name !== 'string' || !NAME_RE.test(name)) throw new HttpError(422, 'BAD_ARTIFACT_NAME', `Nombre de archivo no válido: ${String(name)}.`);
      if (names.has(name)) throw new HttpError(422, 'DUPLICATE_ARTIFACT', `Archivo repetido: ${name}.`);
      names.add(name);
      if (typeof kind !== 'string' || !KINDS.includes(kind as ArtifactKind)) throw new HttpError(422, 'BAD_ARTIFACT_KIND', `Tipo de archivo no válido: ${String(kind)}.`);
      if (typeof content !== 'string' || content.length === 0 || content.length > MAX_ARTIFACT) throw new HttpError(422, 'BAD_ARTIFACT_CONTENT', `Contenido no válido en ${name}.`);
      let rows = 0;
      if (kind === 'DEMAND_MD61') {
        const v = validateMd61File(content);
        if (v.errors.length) throw new HttpError(422, 'INVALID_ARTIFACT', `${name}: ${v.errors.slice(0, 3).join(' ')}`);
        rows = v.rows;
      } else {
        const v = validateOrdersFile(content, kind as 'PROVISIONAL_ORDERS' | 'ORDER_DELETIONS');
        if (v.errors.length) throw new HttpError(422, 'INVALID_ARTIFACT', `${name}: ${v.errors.slice(0, 3).join(' ')}`);
        rows = v.rows.length;
        if (kind === 'PROVISIONAL_ORDERS') {
          if (v.rows.some((r) => !r.referencia.startsWith(`${releaseId}|`))) throw new HttpError(422, 'WRONG_RELEASE_ID', `${name}: las referencias deben empezar por ${releaseId}.`);
          created.push(...v.rows);
        } else v.rows.forEach((r) => deletionRefs.add(r.referencia));
      }
      artifacts.push({ name, kind: kind as ArtifactKind, plantId: typeof plantId === 'string' ? plantId : undefined, rows, sha256: sha256(content), content });
    }

    // Integridad del reemplazo: las órdenes de la publicación anterior que caen desde la primera semana del plan nuevo se borran, ni más ni menos.
    if (created.length > 0) {
      const planStart = created.map((r) => r.referencia.split('|')[3]).sort()[0];
      const expected = new Set(priorOrders().filter((o) => o.fechaFin >= planStart).map((o) => o.referencia));
      const missing = [...expected].filter((r) => !deletionRefs.has(r));
      const extra = [...deletionRefs].filter((r) => !expected.has(r));
      if (missing.length) throw new HttpError(422, 'MISSING_DELETIONS', `Faltan ${missing.length} órdenes de la publicación anterior por borrar (se duplicaría la necesidad): ${missing.slice(0, 2).join(', ')}…`);
      if (extra.length) throw new HttpError(422, 'UNEXPECTED_DELETIONS', `Hay ${extra.length} borrados que no corresponden a la publicación anterior: ${extra.slice(0, 2).join(', ')}…`);
    } else if (deletionRefs.size > 0) throw new HttpError(422, 'ORPHAN_DELETIONS', 'Hay archivos de borrado sin archivos de creación.');
    return artifacts;
  };

  const contentHashOf = (summary: unknown, artifacts: Artifact[]) => sha256(canonicalJson({ summary, artifacts: artifacts.map((a) => ({ name: a.name, kind: a.kind, sha256: a.sha256 })) }));

  const parseWarnings = (raw: unknown): ReleaseWarning[] => {
    if (raw === undefined) return [];
    if (!Array.isArray(raw) || raw.length > 50) throw new HttpError(422, 'BAD_WARNINGS', 'Avisos no válidos.');
    return raw.map((w: Record<string, unknown>) => {
      if (typeof w?.code !== 'string' || typeof w?.message !== 'string') throw new HttpError(422, 'BAD_WARNINGS', 'Cada aviso necesita código y mensaje.');
      return { code: w.code.slice(0, 60), message: w.message.slice(0, 300), requiresJustification: w.requiresJustification === true, justification: typeof w.justification === 'string' ? w.justification.slice(0, 500) : undefined };
    });
  };

  const flow = (result: ReturnType<typeof proposeRelease>) => {
    if (!result.ok) throw new HttpError(STATUS_BY_CODE[result.code] ?? 422, result.code, result.message);
    return result;
  };

  // --------------------------------------------------------------------------- rutas
  // El usuario autenticado viaja con cada petición (nunca en una variable compartida: con peticiones simultáneas se pisaría).
  type Handler = (ctx: { req: http.IncomingMessage; res: http.ServerResponse; url: URL; params: string[]; user: UserRecord }) => Promise<void>;
  const routes: { method: string; re: RegExp; auth: boolean; fn: Handler }[] = [];
  const route = (method: string, path: string, auth: boolean, fn: Handler) => routes.push({ method, re: new RegExp(`^${path}$`), auth, fn });

  route('GET', '/api/health', false, async ({ res }) => send(res, 200, { ok: true, users: store.state.users.length }));

  route('POST', '/api/login', false, async ({ req, res }) => {
    const body = await readJson(req);
    const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (recentFailures(username).length >= maxAttempts) {
      store.log(null, 'auth.locked', { username }, iso());
      return send(res, 429, { error: { code: 'TOO_MANY_ATTEMPTS', message: 'Demasiados intentos fallidos: espera unos minutos.' } }, { 'Retry-After': String(Math.ceil(windowMs / 1000)) });
    }
    const user = store.state.users.find((u) => u.id === username);
    // Siempre se verifica un hash (aunque el usuario no exista) para no dar pistas por el tiempo de respuesta.
    const ok = await verifyPassword(password, user?.passwordHash ?? 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    if (!user || user.disabled || !ok) {
      failures.set(username, [...recentFailures(username), now()]);
      await store.exclusive(() => store.log(null, 'auth.failure', { username }, iso()));
      return send(res, 401, { error: { code: 'BAD_CREDENTIALS', message: 'Usuario o contraseña incorrectos.' } });
    }
    failures.delete(username);
    const issuedAt = now();
    const token = signToken({ sub: user.id, iat: issuedAt, exp: issuedAt + ttl }, secret);
    await store.exclusive(() => store.log(toActor(user), 'auth.login', {}, iso()));
    send(res, 200, { token, expiresAt: new Date(issuedAt + ttl).toISOString(), user: publicUser(user) });
  });

  route('GET', '/api/me', true, async ({ user, res }) => send(res, 200, { user: publicUser(user) }));

  route('GET', '/api/users', true, async ({ user, res }) => {
    need(user, 'users.manage');
    send(res, 200, { users: store.state.users.map(publicUser) });
  });

  route('POST', '/api/users', true, async ({ user, req, res }) => {
    need(user, 'users.manage');
    const body = await readJson(req);
    const id = typeof body.id === 'string' ? body.id.trim().toLowerCase() : '';
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';
    if (!ID_RE.test(id) || !name || !isRole(body.role)) throw new HttpError(422, 'BAD_USER', 'Usuario no válido: id (3–32 caracteres a-z, 0-9, ., _, -), nombre y rol son obligatorios.');
    const password = randomPassword();
    const passwordHash = await hashPassword(password);
    const role = body.role;
    await store.exclusive(() => {
      if (store.state.users.some((u) => u.id === id)) throw new HttpError(409, 'USER_EXISTS', 'Ese usuario ya existe.');
      store.state.users.push({ id, name, role, passwordHash, createdAt: iso() });
      store.save();
      store.log(toActor(user), 'user.create', { id, role }, iso());
    });
    // La contraseña se devuelve una sola vez; el servidor solo guarda su hash.
    send(res, 201, { user: { id, name, role, roleLabel: ROLE_LABELS[role], disabled: false }, password });
  });

  route('GET', '/api/workspace', true, async ({ user, res }) => send(res, 200, store.state.workspace));

  route('PUT', '/api/workspace', true, async ({ user, req, res }) => {
    const body = await readJson(req);
    const data = body.data;
    if (!Number.isInteger(body.baseRevision) || data === null || typeof data !== 'object' || Array.isArray(data)) throw new HttpError(422, 'BAD_WORKSPACE', 'Se esperaba baseRevision (entero) y data (objeto).');
    await store.exclusive(() => {
      const ws = store.state.workspace;
      if (body.baseRevision !== ws.revision) throw new HttpError(409, 'REVISION_CONFLICT', `Otra persona guardó antes (revisión ${ws.revision}); recarga para no pisar sus cambios.`);
      const check = checkWorkspaceChange(user.role, ws.data, data as Workspace);
      if (!check.ok) {
        store.log(toActor(user), 'workspace.denied', { sections: check.changed, reason: check.message }, iso());
        throw new HttpError(403, 'FORBIDDEN', check.message ?? 'Cambio no permitido.');
      }
      if (check.changed.length === 0) return;
      store.state.workspace = { revision: ws.revision + 1, data: data as Workspace, updatedAt: iso(), updatedBy: user.id };
      store.save();
      store.log(toActor(user), 'workspace.update', { sections: check.changed, revision: ws.revision + 1, dataHash: sha256(canonicalJson(data)) }, iso());
    });
    send(res, 200, store.state.workspace);
  });

  route('GET', '/api/releases', true, async ({ user, res }) => send(res, 200, { releases: store.state.releaseState.releases.map((r) => releaseView(r, false)), nextId: nextReleaseId() }));

  route('GET', '/api/releases/prior-orders', true, async ({ user, res }) => send(res, 200, { releaseId: lastReleased()?.id ?? null, orders: priorOrders() }));

  route('GET', '/api/releases/([A-Z0-9-]+)', true, async ({ user, res, params }) => {
    const r = store.state.releaseState.releases.find((x) => x.id === params[0]);
    if (!r) throw new HttpError(404, 'NOT_FOUND', 'La propuesta no existe.');
    send(res, 200, releaseView(r, true));
  });

  route('POST', '/api/releases', true, async ({ user, req, res }) => {
    need(user, 'release.propose');
    const body = await readJson(req);
    const summary = body.summary;
    if (summary === null || typeof summary !== 'object' || Array.isArray(summary) || JSON.stringify(summary).length > 20_000) throw new HttpError(422, 'BAD_SUMMARY', 'El resumen debe ser un objeto pequeño.');
    const warnings = parseWarnings(body.warnings);
    const created = await store.exclusive(() => {
      const releaseId = nextReleaseId();
      if (body.releaseId !== releaseId) throw new HttpError(409, 'STALE_RELEASE_ID', `El número de propuesta cambió (ahora es ${releaseId}): vuelve a generar los archivos.`);
      const artifacts = buildArtifacts(releaseId, body.artifacts);
      const hash = contentHashOf(summary, artifacts);
      const result = flow(proposeRelease(store.state.releaseState, toActor(user), { summary: summary as Record<string, unknown>, artifacts, warnings, contentHash: hash }, iso()));
      store.state.releaseState = result.state;
      store.save();
      store.log(toActor(user), 'release.propose', {
        id: result.release.id, contentHash: hash, supersedes: result.release.supersedes ?? null,
        artifacts: artifacts.map((a) => ({ name: a.name, kind: a.kind, rows: a.rows, sha256: a.sha256 })),
        warnings: warnings.map((w) => ({ code: w.code, justification: w.justification ?? null })),
      }, iso());
      return result.release;
    });
    send(res, 201, releaseView(created, true));
  });

  route('POST', '/api/releases/([A-Z0-9-]+)/approve', true, async ({ user, req, res, params }) => {
    const body = await readJson(req);
    if (body.as !== 'capacity' && body.as !== 'mps') throw new HttpError(422, 'BAD_KIND', 'Indica qué apruebas: capacity o mps.');
    const kind = body.as;
    const comment = typeof body.comment === 'string' ? body.comment.slice(0, 500) : '';
    const release = await store.exclusive(() => {
      const result = flow(approveRelease(store.state.releaseState, toActor(user), params[0], kind, comment, iso()));
      store.state.releaseState = result.state;
      store.save();
      store.log(toActor(user), 'release.approve', { id: params[0], as: kind, comment, contentHash: result.release.contentHash, status: result.release.status }, iso());
      return result.release;
    });
    send(res, 200, releaseView(release, false));
  });

  route('POST', '/api/releases/([A-Z0-9-]+)/reject', true, async ({ user, req, res, params }) => {
    const body = await readJson(req);
    const reason = typeof body.reason === 'string' ? body.reason.slice(0, 500) : '';
    const release = await store.exclusive(() => {
      const result = flow(rejectRelease(store.state.releaseState, toActor(user), params[0], reason, iso()));
      store.state.releaseState = result.state;
      store.save();
      store.log(toActor(user), 'release.reject', { id: params[0], reason, contentHash: result.release.contentHash }, iso());
      return result.release;
    });
    send(res, 200, releaseView(release, false));
  });

  route('POST', '/api/releases/([A-Z0-9-]+)/publish', true, async ({ user, res, params }) => {
    const release = await store.exclusive(() => {
      const target = store.state.releaseState.releases.find((r) => r.id === params[0]);
      if (target) {
        // Lo aprobado debe ser exactamente lo que se publica: se recalculan los hashes antes de soltar los archivos.
        const tampered = target.artifacts.some((a) => sha256(a.content) !== a.sha256) || contentHashOf(target.summary, target.artifacts) !== target.contentHash;
        if (tampered) {
          store.log(toActor(user), 'integrity.failure', { id: target.id, contentHash: target.contentHash }, iso());
          throw new HttpError(409, 'INTEGRITY_ERROR', 'El contenido de la propuesta no coincide con lo aprobado: no se publica. Hay que proponer de nuevo.');
        }
      }
      const result = flow(publishRelease(store.state.releaseState, toActor(user), params[0], iso()));
      store.state.releaseState = result.state;
      store.save();
      store.log(toActor(user), 'release.publish', { id: params[0], contentHash: result.release.contentHash, artifacts: result.release.artifacts.map((a) => ({ name: a.name, sha256: a.sha256, rows: a.rows })) }, iso());
      return result.release;
    });
    send(res, 200, releaseView(release, true));
  });

  route('GET', '/api/releases/([A-Z0-9-]+)/artifacts/([A-Za-z0-9_.-]+)', true, async ({ user, res, params }) => {
    const r = store.state.releaseState.releases.find((x) => x.id === params[0]);
    const a = r?.artifacts.find((x) => x.name === params[1]);
    if (!r || !a) throw new HttpError(404, 'NOT_FOUND', 'Archivo no encontrado.');
    if (r.status === 'RELEASED') await store.exclusive(() => store.log(toActor(user), 'artifact.download', { id: r.id, name: a.name, sha256: a.sha256 }, iso()));
    send(res, 200, a.content, { 'Content-Disposition': `attachment; filename="${a.name}"`, 'X-Content-SHA256': a.sha256 });
  });

  route('GET', '/api/audit', true, async ({ user, res, url }) => {
    need(user, 'audit.read');
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 100));
    send(res, 200, { total: store.audit.length, entries: store.audit.slice(-limit).reverse() });
  });

  route('GET', '/api/audit/verify', true, async ({ user, res }) => {
    need(user, 'audit.read');
    send(res, 200, store.verifyAudit());
  });

  // --------------------------------------------------------------------------- servidor
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const match = routes.map((r) => ({ r, m: r.re.exec(url.pathname) })).find(({ r, m }) => m && r.method === req.method);
      if (!match || !match.m) {
        const pathExists = routes.some((r) => r.re.test(url.pathname));
        return send(res, pathExists ? 405 : 404, { error: { code: pathExists ? 'METHOD_NOT_ALLOWED' : 'NOT_FOUND', message: pathExists ? 'Método no permitido.' : 'Ruta no encontrada.' } });
      }
      const user = match.r.auth ? authenticate(req) : (null as unknown as UserRecord);
      await match.r.fn({ req, res, url, params: match.m.slice(1), user });
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: { code: e.code, message: e.message } });
      log(`Error interno: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
      send(res, 500, { error: { code: 'INTERNAL', message: 'Error interno del servidor.' } });
    }
  });

  return {
    server,
    store,
    listen: (port = 0, host = '127.0.0.1') => new Promise((resolve) => server.listen(port, host, () => resolve((server.address() as { port: number }).port))),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
