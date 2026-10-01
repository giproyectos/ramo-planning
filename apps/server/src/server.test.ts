import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RamoDataset } from '@ramo/domain';
import { computeNetProduction, demandForHorizon } from '@ramo/engine';
import { buildMd61, buildProvisionalOrders } from '@ramo/sap-out';
import { App, createApp } from './app';

const PASS = (id: string) => `prueba-${id}-local`; // contraseñas solo de este servidor de prueba, en un directorio temporal
const ds: RamoDataset = JSON.parse(readFileSync(new URL('../../../data/synthetic/dataset.json', import.meta.url), 'utf8'));
const net = computeNetProduction(ds, demandForHorizon(ds, 'V-N1-2026-W40', 'V-PBO-2026-10'));
const cedi = ds.demand.filter((d) => d.versionId === 'V-N1-2026-W40');

let dir: string;
let app: App;
let base: string;
let clock = Date.parse('2026-10-05T08:00:00Z');
const seedPasswords = Object.fromEntries(['admin', 'diana', 'miguel', 'daniel', 'compras', 'consulta'].map((id) => [id, PASS(id)]));

async function start(existingDir?: string) {
  dir = existingDir ?? mkdtempSync(join(tmpdir(), 'ramo-server-'));
  app = await createApp({ dataDir: dir, now: () => clock, seedPasswords, loginMaxAttempts: 3, loginWindowMs: 60_000, tokenTtlMs: 3_600_000 });
  base = `http://127.0.0.1:${await app.listen(0)}`;
}
beforeEach(async () => { clock = Date.parse('2026-10-05T08:00:00Z'); await start(); });
afterEach(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });

async function call(method: string, path: string, opts: { token?: string; body?: unknown; raw?: string } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}), ...(opts.body !== undefined || opts.raw !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: opts.raw ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* texto plano (CSV) */ }
  return { status: res.status, json, text, headers: res.headers };
}
async function login(id: string) {
  const r = await call('POST', '/api/login', { body: { username: id, password: PASS(id) } });
  expect(r.status).toBe(200);
  return r.json.token as string;
}

describe('servidor básico', () => {
  it('responde salud, rutas inexistentes, método incorrecto y JSON inválido', async () => {
    expect((await call('GET', '/api/health')).json).toEqual({ ok: true, users: 6 });
    expect((await call('GET', '/api/nada')).status).toBe(404);
    expect((await call('DELETE', '/api/health')).status).toBe(405);
    expect((await call('POST', '/api/login', { raw: '{no es json' })).status).toBe(400);
    expect((await call('POST', '/api/login', { raw: '[1,2]' })).status).toBe(400);
  });

  it('envía cabeceras de seguridad y no cachea', async () => {
    const r = await call('GET', '/api/health');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('cache-control')).toBe('no-store');
  });
});

describe('autenticación', () => {
  it('entra con la contraseña correcta y devuelve usuario con rol', async () => {
    const r = await call('POST', '/api/login', { body: { username: 'MIGUEL', password: PASS('miguel') } });
    expect(r.status).toBe(200);
    expect(r.json.user).toMatchObject({ id: 'miguel', role: 'production' });
    expect((await call('GET', '/api/me', { token: r.json.token })).json.user.id).toBe('miguel');
  });

  it('el mismo mensaje para usuario inexistente y contraseña errónea (no revela cuáles existen)', async () => {
    const a = await call('POST', '/api/login', { body: { username: 'miguel', password: 'mala' } });
    const b = await call('POST', '/api/login', { body: { username: 'nadie', password: 'mala' } });
    expect(a.status).toBe(401);
    expect(a.json).toEqual(b.json);
  });

  it('tras varios fallos bloquea al usuario (aunque acierte la contraseña) y se libera con el tiempo', async () => {
    for (let i = 0; i < 3; i++) await call('POST', '/api/login', { body: { username: 'diana', password: 'x' } });
    const locked = await call('POST', '/api/login', { body: { username: 'diana', password: PASS('diana') } });
    expect(locked.status).toBe(429);
    expect(locked.headers.get('retry-after')).toBe('60');
    clock += 61_000;
    expect((await call('POST', '/api/login', { body: { username: 'diana', password: PASS('diana') } })).status).toBe(200);
  });

  it('rechaza tokens ausentes, manipulados y vencidos', async () => {
    expect((await call('GET', '/api/me')).status).toBe(401);
    const token = await login('miguel');
    const [body, sig] = token.split('.');
    const forged = `${Buffer.from(JSON.stringify({ sub: 'admin', iat: 0, exp: clock + 1e9 })).toString('base64url')}.${sig}`;
    expect((await call('GET', '/api/me', { token: forged })).status).toBe(401);
    expect((await call('GET', '/api/me', { token: `${body}.AAAA` })).status).toBe(401);
    clock += 3_600_001;
    expect((await call('GET', '/api/me', { token })).status).toBe(401);
  });

  it('las contraseñas se guardan con hash, nunca en claro, y los fallos quedan auditados sin la contraseña', async () => {
    await call('POST', '/api/login', { body: { username: 'miguel', password: 'incorrecta-123' } });
    const state = readFileSync(join(dir, 'state.json'), 'utf8');
    const audit = readFileSync(join(dir, 'audit.ndjson'), 'utf8');
    expect(state).not.toContain(PASS('miguel'));
    expect(state).toContain('scrypt$');
    expect(audit).toContain('auth.failure');
    expect(audit).not.toContain('incorrecta-123');
  });
});

describe('usuarios', () => {
  it('solo administración lista y crea usuarios; la contraseña nueva se muestra una vez y sirve para entrar', async () => {
    const admin = await login('admin');
    expect((await call('GET', '/api/users', { token: await login('miguel') })).status).toBe(403);
    const list = await call('GET', '/api/users', { token: admin });
    expect(list.json.users).toHaveLength(6);
    expect(JSON.stringify(list.json)).not.toContain('passwordHash');
    const created = await call('POST', '/api/users', { token: admin, body: { id: 'supervisor', name: 'Supervisor', role: 'production' } });
    expect(created.status).toBe(201);
    expect(created.json.password.length).toBeGreaterThanOrEqual(16);
    expect((await call('POST', '/api/login', { body: { username: 'supervisor', password: created.json.password } })).status).toBe(200);
    expect((await call('POST', '/api/users', { token: admin, body: { id: 'supervisor', name: 'X', role: 'viewer' } })).status).toBe(409);
    expect((await call('POST', '/api/users', { token: admin, body: { id: 'AB', name: 'X', role: 'viewer' } })).status).toBe(422);
    expect((await call('POST', '/api/users', { token: admin, body: { id: 'otro', name: 'X', role: 'superadmin' } })).status).toBe(422);
  });

  it('la identidad de cada petición no se mezcla con peticiones simultáneas de otros usuarios', async () => {
    const admin = await login('admin');
    const viewer = await login('consulta');
    const results = await Promise.all(Array.from({ length: 40 }, (_, i) => {
      const asAdmin = i % 2 === 0;
      return call('POST', '/api/users', { token: asAdmin ? admin : viewer, body: { id: `user${i}`, name: `U${i}`, role: 'viewer' } }).then((r) => ({ asAdmin, status: r.status }));
    }));
    expect(results.filter((r) => r.asAdmin).every((r) => r.status === 201)).toBe(true);
    expect(results.filter((r) => !r.asAdmin).every((r) => r.status === 403)).toBe(true);
    expect((await call('GET', '/api/users', { token: admin })).json.users).toHaveLength(6 + 20);
  });
});

describe('espacio de trabajo compartido', () => {
  const put = (token: string, baseRevision: number, data: Record<string, unknown>) => call('PUT', '/api/workspace', { token, body: { baseRevision, data } });
  const empty = { blocks: [], decisions: [], adjustments: [], stage: 'DRAFT', recDecisions: {}, leadTimeOverrides: {}, log: [] };

  it('arranca vacío; cada rol edita solo su sección y las sube la revisión', async () => {
    const diana = await login('diana');
    const ws = await call('GET', '/api/workspace', { token: diana });
    expect(ws.json).toMatchObject({ revision: 0, data: empty });
    const ok = await put(diana, 0, { ...empty, blocks: [{ id: 'b1' }] });
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({ revision: 1, updatedBy: 'diana' });
    const denied = await put(await login('miguel'), 1, { ...empty, blocks: [{ id: 'b1' }], decisions: [{ id: 'd1' }], adjustments: [{ id: 'a1' }] }); // Miguel no ajusta el MPS
    expect(denied.status).toBe(403);
    expect(denied.json.error.message).toContain('adjustments');
  });

  it('un cambio denegado queda en la auditoría', async () => {
    await put(await login('consulta'), 0, { ...empty, blocks: [1] });
    const audit = await call('GET', '/api/audit', { token: await login('consulta') });
    expect(audit.json.entries.some((e: any) => e.type === 'workspace.denied' && e.actor.id === 'consulta')).toBe(true);
  });

  it('rechaza guardar sobre una revisión vieja (conflicto) y deja intacto lo de la otra persona', async () => {
    const diana = await login('diana');
    const miguel = await login('miguel');
    await put(diana, 0, { ...empty, blocks: [{ id: 'b1' }] });
    const conflict = await put(miguel, 0, { ...empty, blocks: [{ id: 'b1' }], decisions: [{ id: 'd1' }] });
    expect(conflict.status).toBe(409);
    expect((await call('GET', '/api/workspace', { token: miguel })).json.data.blocks).toEqual([{ id: 'b1' }]);
  });

  it('con escrituras simultáneas sobre la misma revisión solo una gana', async () => {
    const diana = await login('diana');
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => put(diana, 0, { ...empty, blocks: [{ id: `b${i}` }] })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(11);
  });

  it('el registro solo crece: cualquiera añade, nadie borra ni reescribe', async () => {
    const c = await login('consulta');
    const entry = (t: string) => ({ at: 'x', actor: 'consulta', text: t });
    expect((await put(c, 0, { ...empty, log: [entry('uno')] })).status).toBe(200);
    expect((await put(c, 1, { ...empty, log: [entry('dos'), entry('uno')] })).status).toBe(200);
    expect((await put(c, 2, { ...empty, log: [] })).status).toBe(403);
    expect((await put(c, 2, { ...empty, log: [entry('dos'), entry('REESCRITO')] })).status).toBe(403);
  });

  it('las etapas del ciclo avanzan por el rol de cada capa', async () => {
    const miguel = await login('miguel');
    const daniel = await login('daniel');
    expect((await put(daniel, 0, { ...empty, stage: 'SENT_TO_MPS' })).status).toBe(403); // Daniel no envía
    expect((await put(miguel, 0, { ...empty, stage: 'SENT_TO_MPS' })).status).toBe(200); // Miguel sí
    expect((await put(miguel, 1, { ...empty, stage: 'MPS_FINAL' })).status).toBe(403); // Miguel no cierra el MPS final
    expect((await put(daniel, 1, { ...empty, stage: 'MPS_FINAL' })).status).toBe(200);
  });

  it('valida el cuerpo', async () => {
    const d = await login('diana');
    expect((await call('PUT', '/api/workspace', { token: d, body: { data: empty } })).status).toBe(422);
    expect((await call('PUT', '/api/workspace', { token: d, body: { baseRevision: 0, data: [] } })).status).toBe(422);
  });
});

/** Archivos reales (generados con el motor) para proponer una salida. */
function artifactsFor(releaseId: string, netRows = net, priorOrders: ReturnType<typeof buildProvisionalOrders>['files'][number]['rows'] = []) {
  const orders = buildProvisionalOrders(ds, netRows, { releaseId, priorOrders });
  const md61 = buildMd61(ds, cedi);
  return {
    artifacts: [
      ...orders.files.map((f) => ({ name: f.name, kind: f.kind, plantId: f.plantId, content: f.csv })),
      { name: `demanda_md61_${releaseId}.csv`, kind: 'DEMAND_MD61', content: md61.csv },
    ],
    created: orders.files.filter((f) => f.kind === 'PROVISIONAL_ORDERS').flatMap((f) => f.rows),
  };
}
const summary = { weeks: 13 };

describe('salida a SAP: propuesta, aprobación y publicación', () => {
  const propose = (token: string, body: Record<string, unknown>) => call('POST', '/api/releases', { token, body });

  it('ciclo completo con auditoría íntegra: propone Miguel, aprueba y publica Daniel', async () => {
    const miguel = await login('miguel');
    const daniel = await login('daniel');
    const { json: list } = await call('GET', '/api/releases', { token: miguel });
    expect(list).toMatchObject({ releases: [], nextId: 'REL-0001' });

    const { artifacts } = artifactsFor('REL-0001');
    const p = await propose(miguel, { releaseId: 'REL-0001', summary, artifacts, warnings: [] });
    expect(p.status).toBe(201);
    expect(p.json).toMatchObject({ id: 'REL-0001', status: 'PROPOSED', proposedBy: { id: 'miguel' } });
    expect(p.json.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(p.json.artifacts.every((a: any) => /^[0-9a-f]{64}$/.test(a.sha256) && a.rows > 0)).toBe(true);
    expect(p.json.approvals.capacity.by.id).toBe('miguel');

    expect((await call('POST', '/api/releases/REL-0001/approve', { token: miguel, body: { as: 'capacity' } })).status).toBe(409); // doble control
    expect((await call('POST', '/api/releases/REL-0001/publish', { token: daniel })).status).toBe(409); // falta la aprobación del MPS
    expect((await call('POST', '/api/releases/REL-0001/approve', { token: await login('compras'), body: { as: 'mps' } })).status).toBe(403);
    const ap = await call('POST', '/api/releases/REL-0001/approve', { token: daniel, body: { as: 'mps', comment: 'Rojos resueltos' } });
    expect(ap.json.status).toBe('APPROVED');
    expect((await call('POST', '/api/releases/REL-0001/publish', { token: miguel })).status).toBe(409); // quien propone no publica
    const pub = await call('POST', '/api/releases/REL-0001/publish', { token: daniel });
    expect(pub.status).toBe(200);
    expect(pub.json).toMatchObject({ status: 'RELEASED', releasedBy: { id: 'daniel' } });

    const name = artifacts[0].name;
    const dl = await call('GET', `/api/releases/REL-0001/artifacts/${name}`, { token: daniel });
    expect(dl.status).toBe(200);
    expect(dl.text).toBe(artifacts[0].content);
    expect(dl.headers.get('content-disposition')).toContain(name);

    const verify = await call('GET', '/api/audit/verify', { token: daniel });
    expect(verify.json.ok).toBe(true);
    const types = (await call('GET', '/api/audit?limit=100', { token: daniel })).json.entries.map((e: any) => e.type);
    for (const t of ['release.propose', 'release.approve', 'release.publish', 'artifact.download']) expect(types).toContain(t);
  });

  it('el rechazo exige motivo, queda auditado y permite una propuesta nueva', async () => {
    const miguel = await login('miguel');
    const daniel = await login('daniel');
    await propose(miguel, { releaseId: 'REL-0001', summary, artifacts: artifactsFor('REL-0001').artifacts });
    expect((await call('POST', '/api/releases/REL-0001/reject', { token: daniel, body: { reason: 'no' } })).status).toBe(422);
    const rej = await call('POST', '/api/releases/REL-0001/reject', { token: daniel, body: { reason: 'La línea de barras sigue en rojo' } });
    expect(rej.json.status).toBe('REJECTED');
    const again = await propose(miguel, { releaseId: 'REL-0002', summary, artifacts: artifactsFor('REL-0002').artifacts });
    expect(again.status).toBe(201);
  });

  it('quien no tiene el rol no propone; no hay dos propuestas abiertas', async () => {
    const { artifacts } = artifactsFor('REL-0001');
    expect((await propose(await login('diana'), { releaseId: 'REL-0001', summary, artifacts })).status).toBe(403);
    const miguel = await login('miguel');
    expect((await propose(miguel, { releaseId: 'REL-0001', summary, artifacts })).status).toBe(201);
    expect((await propose(miguel, { releaseId: 'REL-0002', summary, artifacts: artifactsFor('REL-0002').artifacts })).status).toBe(409);
  });

  it('valida la propuesta: número vigente, archivos bien formados, referencias y nombres seguros', async () => {
    const miguel = await login('miguel');
    const { artifacts } = artifactsFor('REL-0001');
    const code = async (body: Record<string, unknown>) => (await propose(miguel, { releaseId: 'REL-0001', summary, ...body })).json?.error?.code;
    expect((await propose(miguel, { releaseId: 'REL-0007', summary, artifacts })).json.error.code).toBe('STALE_RELEASE_ID');
    expect(await code({ artifacts: [] })).toBe('BAD_ARTIFACTS');
    expect(await code({ artifacts: [{ ...artifacts[0], name: '../secreto.csv' }] })).toBe('BAD_ARTIFACT_NAME');
    expect(await code({ artifacts: [{ ...artifacts[0], kind: 'OTRO' }] })).toBe('BAD_ARTIFACT_KIND');
    expect(await code({ artifacts: [{ ...artifacts[0] }, { ...artifacts[0] }] })).toBe('DUPLICATE_ARTIFACT');
    expect(await code({ artifacts: [{ ...artifacts[0], content: artifacts[0].content.replace('09.10.2026', '31.02.2026') }] })).toBe('INVALID_ARTIFACT');
    expect(await code({ artifacts: [{ ...artifacts[0], content: '' }] })).toBe('BAD_ARTIFACT_CONTENT');
    expect(await code({ artifacts: artifactsFor('REL-0009').artifacts })).toBe('WRONG_RELEASE_ID'); // referencias de otra propuesta
    expect(await code({ artifacts, summary: [] })).toBe('BAD_SUMMARY');
    expect(await code({ artifacts, warnings: [{ code: 'X', message: 'm', requiresJustification: true }] })).toBe('WARNING_NOT_JUSTIFIED');
    expect(await code({ artifacts, warnings: 'no' })).toBe('BAD_WARNINGS');
  });

  it('una nueva publicación debe borrar exactamente las órdenes de la anterior (si no, se duplicaría la necesidad)', async () => {
    const miguel = await login('miguel');
    const daniel = await login('daniel');
    const first = artifactsFor('REL-0001');
    await propose(miguel, { releaseId: 'REL-0001', summary, artifacts: first.artifacts });
    await call('POST', '/api/releases/REL-0001/approve', { token: daniel, body: { as: 'mps' } });
    await call('POST', '/api/releases/REL-0001/publish', { token: daniel });

    const prior = await call('GET', '/api/releases/prior-orders', { token: miguel });
    expect(prior.json.releaseId).toBe('REL-0001');
    expect(prior.json.orders).toHaveLength(first.created.length);

    const plan2 = net.map((n) => ({ ...n, netProduction: n.netProduction * 1.05 }));
    const withoutDel = artifactsFor('REL-0002', plan2);
    expect((await propose(miguel, { releaseId: 'REL-0002', summary, artifacts: withoutDel.artifacts })).json.error.code).toBe('MISSING_DELETIONS');

    const ok = artifactsFor('REL-0002', plan2, prior.json.orders);
    expect(ok.artifacts.some((a) => a.kind === 'ORDER_DELETIONS')).toBe(true);
    const extra = ok.artifacts.map((a) => (a.kind === 'ORDER_DELETIONS' ? { ...a, content: a.content + a.content.split('\n')[1].replace(/\|A\|/, '|Z|').replace(/\|SK-\d+\|/, '|SK-999|') + '\n' } : a));
    expect((await propose(miguel, { releaseId: 'REL-0002', summary, artifacts: extra })).json.error.code).toBe('UNEXPECTED_DELETIONS');

    const good = await propose(miguel, { releaseId: 'REL-0002', summary, artifacts: ok.artifacts });
    expect(good.status).toBe(201);
    expect(good.json.supersedes).toBe('REL-0001');
    await call('POST', '/api/releases/REL-0002/approve', { token: daniel, body: { as: 'mps' } });
    await call('POST', '/api/releases/REL-0002/publish', { token: daniel });
    const all = (await call('GET', '/api/releases', { token: daniel })).json.releases;
    expect(all.map((r: any) => [r.id, r.status])).toEqual([['REL-0001', 'SUPERSEDED'], ['REL-0002', 'RELEASED']]);
  });

  it('si el contenido guardado cambia después de aprobarse, la publicación se bloquea y queda auditado', async () => {
    const miguel = await login('miguel');
    const daniel = await login('daniel');
    await propose(miguel, { releaseId: 'REL-0001', summary, artifacts: artifactsFor('REL-0001').artifacts });
    await call('POST', '/api/releases/REL-0001/approve', { token: daniel, body: { as: 'mps' } });
    app.store.state.releaseState.releases[0].artifacts[0].content += 'CREAR;1000;000000000009000001;LA;999999;CJ;09.10.2026;L;X\n'; // alguien toca el archivo guardado
    const r = await call('POST', '/api/releases/REL-0001/publish', { token: daniel });
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe('INTEGRITY_ERROR');
    expect((await call('GET', '/api/audit', { token: daniel })).json.entries.some((e: any) => e.type === 'integrity.failure')).toBe(true);
    expect(app.store.state.releaseState.releases[0].status).toBe('APPROVED');
  });
});

describe('persistencia y auditoría', () => {
  it('al reiniciar conserva usuarios, espacio de trabajo y propuestas, y los tokens siguen valiendo', async () => {
    const miguel = await login('miguel');
    const diana = await login('diana');
    await call('PUT', '/api/workspace', { token: diana, body: { baseRevision: 0, data: { blocks: [{ id: 'b1' }], decisions: [], adjustments: [], stage: 'DRAFT', recDecisions: {}, leadTimeOverrides: {}, log: [] } } });
    await call('POST', '/api/releases', { token: miguel, body: { releaseId: 'REL-0001', summary, artifacts: artifactsFor('REL-0001').artifacts } });
    await app.close();
    await start(dir);
    expect((await call('GET', '/api/workspace', { token: diana })).json.data.blocks).toEqual([{ id: 'b1' }]);
    expect((await call('GET', '/api/releases', { token: miguel })).json.releases.map((r: any) => r.id)).toEqual(['REL-0001']);
    expect((await call('POST', '/api/login', { body: { username: 'miguel', password: PASS('miguel') } })).status).toBe(200);
    expect((await call('GET', '/api/audit/verify', { token: miguel })).json.ok).toBe(true);
  });

  it('si alguien edita el archivo de auditoría en disco, la verificación lo detecta tras reiniciar', async () => {
    const miguel = await login('miguel');
    await call('POST', '/api/releases', { token: miguel, body: { releaseId: 'REL-0001', summary, artifacts: artifactsFor('REL-0001').artifacts } });
    await app.close();
    const path = join(dir, 'audit.ndjson');
    const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
    const forged = JSON.parse(lines[lines.length - 1]);
    forged.data.id = 'REL-9999'; // reescribe la última entrada
    lines[lines.length - 1] = JSON.stringify(forged);
    writeFileSync(path, `${lines.join('\n')}\n`);
    await start(dir);
    const v = await call('GET', '/api/audit/verify', { token: await login('miguel') });
    expect(v.json).toMatchObject({ ok: false, brokenAt: lines.length });
  });

  it('solo quien tiene permiso de auditoría la lee; un rol sin sesión no', async () => {
    expect((await call('GET', '/api/audit')).status).toBe(401);
    const r = await call('GET', '/api/audit?limit=2', { token: await login('consulta') });
    expect(r.status).toBe(200);
    expect(r.json.entries.length).toBeLessThanOrEqual(2);
  });
});
