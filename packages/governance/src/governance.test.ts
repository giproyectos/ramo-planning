import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  Actor, AuditEntry, EMPTY_RELEASE_STATE, GENESIS_HASH, ProposalInput, ReleaseState, ROLES, ROLE_PERMISSIONS, appendEntry, approveRelease, canonicalJson, can,
  changedSections, checkWorkspaceChange, proposeRelease, publishRelease, rejectRelease, verifyChain,
} from './index';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const actor = (id: string, role: Actor['role']): Actor => ({ id, name: id, role });
const miguel = actor('miguel', 'production');
const daniel = actor('daniel', 'distribution');
const daniela = actor('daniela', 'distribution');
const diana = actor('diana', 'demand');
const NOW = '2026-10-05T08:00:00Z';

const input = (over: Partial<ProposalInput> = {}): ProposalInput => ({
  summary: { weeks: 13 },
  contentHash: 'abc',
  warnings: [],
  artifacts: [{ name: 'ordenes_1000.csv', kind: 'PROVISIONAL_ORDERS', plantId: 'P1', rows: 5, sha256: 'x', content: 'a;b\n1;2\n' }],
  ...over,
});

describe('roles y permisos', () => {
  it('cada rol solo tiene los permisos de su capa', () => {
    expect(can('production', 'capacity.edit')).toBe(true);
    expect(can('production', 'mps.edit')).toBe(false);
    expect(can('distribution', 'release.publish')).toBe(true);
    expect(can('production', 'release.publish')).toBe(true);
    expect(can('demand', 'release.publish')).toBe(false);
    expect(can('purchasing', 'release.publish')).toBe(false);
    expect(can('demand', 'release.propose')).toBe(false);
    expect(can('viewer', 'demand.edit')).toBe(false);
    expect(can(null, 'audit.read')).toBe(false);
  });

  it('solo Producción y Distribución publican; y ningún rol aprueba las dos capas', () => {
    expect(ROLES.filter((r) => ROLE_PERMISSIONS[r].includes('release.publish')).sort()).toEqual(['distribution', 'production']);
    for (const r of ROLES) expect(ROLE_PERMISSIONS[r].filter((p) => p.startsWith('release.approve')).length).toBeLessThanOrEqual(1);
  });
});

describe('cambios del espacio de trabajo', () => {
  const base = { blocks: [], decisions: [], adjustments: [], stage: 'DRAFT', recDecisions: {}, leadTimeOverrides: {}, log: [] as unknown[] };

  it('detecta qué secciones cambiaron', () => {
    expect(changedSections(base, { ...base, blocks: [1] })).toEqual(['blocks']);
    expect(changedSections(base, base)).toEqual([]);
  });

  it('cada sección exige el permiso de su capa', () => {
    expect(checkWorkspaceChange('demand', base, { ...base, blocks: [1] }).ok).toBe(true);
    expect(checkWorkspaceChange('production', base, { ...base, blocks: [1] })).toMatchObject({ ok: false });
    expect(checkWorkspaceChange('production', base, { ...base, decisions: [1] }).ok).toBe(true);
    expect(checkWorkspaceChange('distribution', base, { ...base, decisions: [1] }).ok).toBe(false);
    expect(checkWorkspaceChange('distribution', base, { ...base, adjustments: [1] }).ok).toBe(true);
    expect(checkWorkspaceChange('purchasing', base, { ...base, recDecisions: { a: 1 }, leadTimeOverrides: { m: 3 } }).ok).toBe(true);
    expect(checkWorkspaceChange('viewer', base, { ...base, adjustments: [1] }).message).toContain('no puede modificar');
  });

  it('una sección desconocida se rechaza', () => {
    expect(checkWorkspaceChange('production', base, { ...base, secreto: 1 }).message).toContain('no existe');
  });

  it('el registro es de solo añadir: se puede crecer, no borrar ni reescribir', () => {
    const withLog = { ...base, log: [{ t: 'b' }, { t: 'a' }] }; // lo nuevo va al principio
    expect(checkWorkspaceChange('viewer', withLog, { ...withLog, log: [{ t: 'c' }, ...withLog.log] }).ok).toBe(true);
    expect(checkWorkspaceChange('production', withLog, { ...withLog, log: [] }).ok).toBe(false);
    expect(checkWorkspaceChange('production', withLog, { ...withLog, log: [{ t: 'b' }, { t: 'CAMBIADO' }] }).message).toContain('solo añadir');
  });

  it('la etapa del ciclo avanza solo por la transición del rol correspondiente', () => {
    expect(checkWorkspaceChange('production', base, { ...base, stage: 'SENT_TO_MPS' }).ok).toBe(true); // Miguel envía
    expect(checkWorkspaceChange('distribution', base, { ...base, stage: 'SENT_TO_MPS' }).ok).toBe(false); // Daniel no
    const sent = { ...base, stage: 'SENT_TO_MPS' };
    expect(checkWorkspaceChange('distribution', sent, { ...sent, stage: 'MPS_FINAL' }).ok).toBe(true); // Daniel cierra
    expect(checkWorkspaceChange('production', sent, { ...sent, stage: 'MPS_FINAL' }).ok).toBe(false);
    expect(checkWorkspaceChange('production', base, { ...base, stage: 'MPS_FINAL' }).message).toContain('no permitida'); // no se salta etapas
    expect(checkWorkspaceChange('production', sent, { ...sent, stage: 'DRAFT' }).ok).toBe(true); // reiniciar
    expect(checkWorkspaceChange('demand', sent, { ...sent, stage: 'DRAFT' }).ok).toBe(false);
  });
});

describe('auditoría encadenada', () => {
  const build = (n: number) => {
    const log: AuditEntry[] = [];
    for (let i = 0; i < n; i++) log.push(appendEntry(log, i % 2 ? miguel : null, `evento.${i}`, { i, z: { b: 2, a: 1 } }, `2026-10-05T08:0${i}:00Z`, sha));
    return log;
  };

  it('el JSON canónico no depende del orden de las claves', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 4, c: 3 }] })).toBe(canonicalJson({ a: [2, { c: 3, d: 4 }], b: 1 }));
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
  });

  it('una cadena íntegra se verifica y cada entrada enlaza con la anterior', () => {
    const log = build(5);
    expect(log[0].prevHash).toBe(GENESIS_HASH);
    expect(log[3].prevHash).toBe(log[2].hash);
    expect(verifyChain(log, sha)).toEqual({ ok: true, entries: 5 });
    expect(verifyChain([], sha).ok).toBe(true);
  });

  it('detecta una entrada modificada', () => {
    const log = build(5);
    log[2] = { ...log[2], data: { ...log[2].data, i: 999 } };
    expect(verifyChain(log, sha)).toMatchObject({ ok: false, brokenAt: 3, reason: expect.stringContaining('modificado') });
  });

  it('detecta una entrada borrada, insertada o reordenada', () => {
    const log = build(5);
    expect(verifyChain([log[0], log[1], log[3], log[4]], sha).ok).toBe(false); // borrada
    expect(verifyChain([log[0], log[2], log[1], log[3], log[4]], sha).ok).toBe(false); // reordenada
    const fake = { ...appendEntry([log[0]], miguel, 'falso', {}, NOW, sha), seq: 2 };
    expect(verifyChain([log[0], fake, ...log.slice(2)], sha).ok).toBe(false); // insertada
  });

  it('si se reescribe una entrada Y se recalcula su hash, se rompe el enlace con la siguiente', () => {
    const log = build(4);
    const { hash: _h, ...body } = { ...log[1], data: { i: 'manipulado' } };
    const forged = { ...body, hash: sha(canonicalJson(body)) };
    expect(verifyChain([log[0], forged, log[2], log[3]], sha)).toMatchObject({ ok: false, brokenAt: 3 });
  });
});

describe('flujo de salida a SAP', () => {
  const ok = (r: ReturnType<typeof proposeRelease>) => {
    if (!r.ok) throw new Error(r.message);
    return r.state;
  };
  /** Propuesta de Miguel (Producción): su capa (capacidad) queda aprobada al proponer. */
  const proposed = () => ok(proposeRelease(EMPTY_RELEASE_STATE, miguel, input(), NOW));
  const approved = (state: ReleaseState, id = 'REL-0001') => ok(approveRelease(state, daniel, id, 'mps', 'Rojos resueltos en la reunión', NOW));

  it('ciclo completo con dos personas: propone Miguel (capacidad), aprueba Daniel (MPS), publica Daniel', () => {
    const s = proposed();
    expect(s.releases[0]).toMatchObject({ id: 'REL-0001', status: 'PROPOSED', proposedBy: { id: 'miguel' } });
    expect(s.releases[0].approvals.capacity).toMatchObject({ by: { id: 'miguel' } });
    expect(s.releases[0].approvals.mps).toBeUndefined();
    const a = approveRelease(s, daniel, 'REL-0001', 'mps', 'Rojos resueltos', NOW);
    expect(a.ok && a.release.status).toBe('APPROVED');
    const pub = publishRelease((a as { state: ReleaseState }).state, daniel, 'REL-0001', NOW);
    expect(pub.ok && pub.release).toMatchObject({ status: 'RELEASED', releasedBy: { id: 'daniel' } });
  });

  it('también funciona al revés: propone Daniel (MPS), aprueba y publica Miguel', () => {
    const s = ok(proposeRelease(EMPTY_RELEASE_STATE, daniel, input(), NOW));
    expect(s.releases[0].approvals.mps).toMatchObject({ by: { id: 'daniel' } });
    const a = approveRelease(s, miguel, 'REL-0001', 'capacity', 'Capacidad validada', NOW);
    expect(a.ok && a.release.status).toBe('APPROVED');
    expect(publishRelease((a as { state: ReleaseState }).state, miguel, 'REL-0001', NOW).ok).toBe(true);
  });

  it('doble control: quien propone no aprueba ni publica lo suyo', () => {
    const s = proposed();
    expect(approveRelease(s, miguel, 'REL-0001', 'capacity', '', NOW)).toMatchObject({ ok: false, code: 'FOUR_EYES' });
    expect(publishRelease(approved(s), miguel, 'REL-0001', NOW)).toMatchObject({ ok: false, code: 'FOUR_EYES' });
  });

  it('cada aprobación exige el rol de su capa; la capa del proponente ya está aprobada', () => {
    const s = proposed();
    expect(approveRelease(s, diana, 'REL-0001', 'mps', '', NOW)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(approveRelease(s, daniel, 'REL-0001', 'capacity', '', NOW)).toMatchObject({ ok: false, code: 'FORBIDDEN' }); // Distribución no aprueba capacidad
    expect(approveRelease(s, actor('miguel2', 'production'), 'REL-0001', 'capacity', '', NOW)).toMatchObject({ ok: false, code: 'ALREADY_APPROVED' });
    expect(approveRelease(approved(s), daniela, 'REL-0001', 'mps', '', NOW)).toMatchObject({ ok: false, code: 'BAD_STATE' }); // ya está completa
  });

  it('no se publica sin la aprobación de la otra capa, y solo la publica alguien de Producción o Distribución', () => {
    const s = proposed();
    expect(publishRelease(s, daniel, 'REL-0001', NOW)).toMatchObject({ ok: false, code: 'NOT_APPROVED' });
    const done = approved(s);
    expect(publishRelease(done, diana, 'REL-0001', NOW)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(publishRelease(done, actor('compras', 'purchasing'), 'REL-0001', NOW)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });

  it('el rechazo exige motivo, cierra la propuesta y permite proponer otra', () => {
    const s = proposed();
    expect(rejectRelease(s, daniel, 'REL-0001', 'no', NOW)).toMatchObject({ ok: false, code: 'REASON_REQUIRED' });
    expect(rejectRelease(s, diana, 'REL-0001', 'Motivo suficientemente largo', NOW)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    const rej = rejectRelease(s, daniel, 'REL-0001', 'La línea de barras sigue en rojo', NOW);
    expect(rej.ok && rej.release).toMatchObject({ status: 'REJECTED', rejection: { by: { id: 'daniel' }, reason: 'La línea de barras sigue en rojo' } });
    expect(approveRelease((rej as { state: ReleaseState }).state, daniel, 'REL-0001', 'mps', '', NOW)).toMatchObject({ ok: false, code: 'BAD_STATE' });
    const again = proposeRelease((rej as { state: ReleaseState }).state, miguel, input(), NOW);
    expect(again.ok && again.release.id).toBe('REL-0002');
  });

  it('se puede rechazar aun aprobada, hasta que se publique; después ya no', () => {
    const done = approved(proposed());
    expect(rejectRelease(done, daniel, 'REL-0001', 'Cambió la demanda del lunes', NOW).ok).toBe(true);
    const released = (publishRelease(done, daniel, 'REL-0001', NOW) as { state: ReleaseState }).state;
    expect(rejectRelease(released, daniel, 'REL-0001', 'Ya es tarde para esto', NOW)).toMatchObject({ ok: false, code: 'BAD_STATE' });
  });

  it('quien propuso puede retirar su propia propuesta con motivo', () => {
    expect(rejectRelease(proposed(), miguel, 'REL-0001', 'Retiro: faltó cargar el inventario', NOW).ok).toBe(true);
  });

  it('una sola propuesta abierta a la vez', () => {
    expect(proposeRelease(proposed(), miguel, input(), NOW)).toMatchObject({ ok: false, code: 'OPEN_RELEASE_EXISTS' });
  });

  it('valida la propuesta: rol, archivos y avisos justificados', () => {
    expect(proposeRelease(EMPTY_RELEASE_STATE, diana, input(), NOW)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(proposeRelease(EMPTY_RELEASE_STATE, miguel, input({ artifacts: [] }), NOW)).toMatchObject({ ok: false, code: 'NO_ARTIFACTS' });
    expect(proposeRelease(EMPTY_RELEASE_STATE, miguel, input({ artifacts: [{ ...input().artifacts[0], rows: 0 }] }), NOW)).toMatchObject({ ok: false, code: 'EMPTY_ARTIFACT' });
    const warn = { code: 'CRP_OVERLOAD', message: 'Quedan 6 rojos de capacidad', requiresJustification: true };
    expect(proposeRelease(EMPTY_RELEASE_STATE, miguel, input({ warnings: [warn] }), NOW)).toMatchObject({ ok: false, code: 'WARNING_NOT_JUSTIFIED' });
    expect(proposeRelease(EMPTY_RELEASE_STATE, miguel, input({ warnings: [{ ...warn, justification: 'corto' }] }), NOW).ok).toBe(false);
    expect(proposeRelease(EMPTY_RELEASE_STATE, miguel, input({ warnings: [{ ...warn, justification: 'Horas extra autorizadas por Alejandro' }] }), NOW).ok).toBe(true);
    expect(proposeRelease(EMPTY_RELEASE_STATE, miguel, input({ warnings: [{ code: 'INFO', message: 'x', requiresJustification: false }] }), NOW).ok).toBe(true);
  });

  it('una publicación nueva reemplaza a la anterior y la propuesta enlaza con lo que reemplaza', () => {
    const publish = (state: ReleaseState, id: string) => (publishRelease(approved(state, id), daniel, id, NOW) as { state: ReleaseState }).state;
    let s = publish(proposed(), 'REL-0001');
    const second = proposeRelease(s, miguel, input(), NOW);
    expect(second.ok && second.release.supersedes).toBe('REL-0001');
    s = publish((second as { state: ReleaseState }).state, 'REL-0002');
    expect(s.releases.map((r) => [r.id, r.status])).toEqual([['REL-0001', 'SUPERSEDED'], ['REL-0002', 'RELEASED']]);
  });

  it('las funciones no mutan el estado recibido', () => {
    const s = proposed();
    const snapshot = JSON.stringify(s);
    approveRelease(s, daniel, 'REL-0001', 'mps', 'ok', NOW);
    rejectRelease(s, daniel, 'REL-0001', 'Motivo suficientemente largo', NOW);
    expect(JSON.stringify(s)).toBe(snapshot);
  });
});
