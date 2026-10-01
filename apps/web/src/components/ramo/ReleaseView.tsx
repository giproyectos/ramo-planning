import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { GovRole, ROLE_LABELS, ReleasePackage, ReleaseStatus } from '@ramo/governance';
import { buildMd61, buildProvisionalOrders } from '@ramo/sap-out';
import { ApiError, OrderRow, PublicUser, api, downloadArtifact } from '../../ramo/api';
import { useAuth } from '../../ramo/auth';
import { useRamoPlan } from '../../ramo/store';
import { fmtInt, weekLabel } from '../../ramo/format';

type Tab = 'prepare' | 'releases' | 'audit';
interface Check { code: string; message: string; level: 'error' | 'warning' | 'info'; requiresJustification: boolean }

const STATUS: Record<ReleaseStatus, { label: string; chip: string }> = {
  PROPOSED: { label: 'Propuesta', chip: 'bg-[#FFF87C]' },
  APPROVED: { label: 'Aprobada', chip: 'bg-[#7AFFA1]' },
  REJECTED: { label: 'Rechazada', chip: 'bg-[#FFA27D]' },
  RELEASED: { label: 'Publicada', chip: 'bg-[#7AFFA1]' },
  SUPERSEDED: { label: 'Reemplazada', chip: 'bg-white/80' },
};
const when = (iso: string) => iso.replace('T', ' ').slice(0, 19);
const short = (h: string) => h.slice(0, 10);
const errText = (e: unknown) => (e instanceof ApiError ? e.message : 'Ocurrió un error inesperado.');

/** Salida a SAP: archivos de órdenes provisionales y demanda para revisión, con doble control y auditoría. No se conecta a SAP. */
export function ReleaseView() {
  const { dataset, danielView, consensus, stage, drp, supplyRisk, insights, baseline, useForecast, serverMode, can } = useRamoPlan();
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('prepare');
  const [releases, setReleases] = useState<ReleasePackage[]>([]);
  const [nextId, setNextId] = useState('');
  const [prior, setPrior] = useState<{ releaseId: string | null; orders: OrderRow[] }>({ releaseId: null, orders: [] });
  const [justifications, setJustifications] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ title: string; text: string } | null>(null);
  const [comment, setComment] = useState<Record<string, string>>({});
  const [audit, setAudit] = useState<{ total: number; entries: { seq: number; at: string; actor: { id: string; role: string } | null; type: string; data: Record<string, unknown> }[] } | null>(null);
  const [chain, setChain] = useState<{ ok: boolean; entries: number; reason?: string; brokenAt?: number } | null>(null);
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [newUser, setNewUser] = useState({ id: '', name: '', role: 'viewer' as GovRole });
  const [createdPassword, setCreatedPassword] = useState<{ id: string; password: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [list, p] = await Promise.all([api.releases(), api.priorOrders()]);
      setReleases(list.releases);
      setNextId(list.nextId);
      setPrior(p);
    } catch (e) {
      setMessage({ ok: false, text: errText(e) });
    }
  }, []);
  useEffect(() => { if (serverMode) void refresh(); }, [serverMode, refresh]);
  useEffect(() => {
    if (!serverMode || tab !== 'audit') return;
    api.audit(100).then(setAudit).catch((e) => setMessage({ ok: false, text: errText(e) }));
    if (user?.role === 'admin') api.users().then((r) => setUsers(r.users)).catch(() => undefined);
  }, [serverMode, tab, user?.role]);

  const build = useMemo(() => {
    if (!nextId) return null;
    const orders = buildProvisionalOrders(dataset, danielView.net, { releaseId: nextId, priorOrders: prior.orders.map((o) => ({ ...o })) });
    const md61 = buildMd61(dataset, consensus);
    const artifacts = [
      ...orders.files.map((f) => ({ name: f.name, kind: f.kind, plantId: f.plantId, content: f.csv, rows: f.rows.length })),
      ...(md61.rows.length > 0 ? [{ name: `demanda_md61_${nextId}.csv`, kind: 'DEMAND_MD61' as const, plantId: undefined, content: md61.csv, rows: md61.rows.length }] : []),
    ];
    return { orders, md61, artifacts };
  }, [nextId, dataset, danielView.net, consensus, prior]);

  const checks = useMemo<Check[]>(() => {
    if (!build) return [];
    const out: Check[] = [];
    for (const i of [...build.orders.issues, ...build.md61.issues].filter((x) => x.severity === 'error')) out.push({ code: i.code, message: i.message, level: 'error', requiresJustification: false });
    if (stage !== 'MPS_FINAL' && stage !== 'FINAL_ALERTS') out.push({ code: 'MPS_NOT_CLOSED', message: 'El MPS final todavía no se ha cerrado en el ciclo.', level: 'warning', requiresJustification: true });
    if (danielView.alerts.length > 0) out.push({ code: 'CRP_OVERLOAD', message: `Quedan ${danielView.alerts.length} semana(s)/tripulación(es) con capacidad por encima del límite.`, level: 'warning', requiresJustification: true });
    if (!baseline?.usable) out.push({ code: 'DATA_NOT_SAP', message: 'El inventario del plan no viene de las bases de SAP del lunes (datos sintéticos o sin cargar).', level: 'warning', requiresJustification: true });
    const stockouts = drp?.alerts.filter((a) => a.code === 'STOCKOUT').length ?? 0;
    if (stockouts > 0) out.push({ code: 'DRP_STOCKOUT', message: `El DRP proyecta ${stockouts} quiebre(s) de inventario dentro del plazo.`, level: 'warning', requiresJustification: true });
    const dup = insights?.anomalies.filter((a) => a.kind === 'DUPLICATE_REQUISITION').length ?? 0;
    if (dup > 0) out.push({ code: 'DUPLICATE_REQUISITIONS', message: `Hay ${dup} posible(s) duplicado(s) de solicitudes de pedido sin resolver.`, level: 'warning', requiresJustification: true });
    const crit = supplyRisk?.risks.filter((r) => r.status === 'CRITICAL').length ?? 0;
    if (crit > 0) out.push({ code: 'MRP_CRITICAL', message: `${crit} material(es) con ruptura dentro de su plazo de entrega (se ve en el tablero MRP).`, level: 'info', requiresJustification: false });
    if (build.orders.summary.deletedRows > 0) out.push({ code: 'REPLACES_PRIOR', message: `Reemplaza a ${prior.releaseId}: se borran ${build.orders.summary.deletedRows} órdenes provisionales de esa publicación desde la primera semana de este plan.`, level: 'info', requiresJustification: false });
    return out;
  }, [build, stage, danielView.alerts.length, baseline, drp, insights, supplyRisk, prior.releaseId]);

  const open = releases.find((r) => r.status === 'PROPOSED' || r.status === 'APPROVED');
  const errors = checks.filter((c) => c.level === 'error');
  const missingJustification = checks.filter((c) => c.requiresJustification && (justifications[c.code] ?? '').trim().length < 10);
  const noArtifacts = !build || build.artifacts.length === 0;
  const blocker = !can('release.propose') ? 'Tu rol no puede proponer una salida.' : open ? `Ya hay una propuesta abierta (${open.id}).` : noArtifacts ? 'No hay nada que proponer: el plan no tiene producción.' : errors.length ? 'Hay errores que impiden generar los archivos.' : missingJustification.length ? 'Falta justificar (mínimo 10 caracteres) los avisos marcados.' : '';

  const act = async (fn: () => Promise<unknown>, okText: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      setMessage({ ok: true, text: okText });
      await refresh();
    } catch (e) {
      setMessage({ ok: false, text: errText(e) });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const propose = () =>
    act(async () => {
      if (!build) return;
      const s = build.orders.summary;
      await api.propose({
        releaseId: nextId,
        summary: { firstWeek: s.firstWeek, lastWeek: s.lastWeek, plants: s.perPlant, plannedCommercial: Math.round(s.plannedCommercial), writtenCommercial: s.writtenCommercial, deletedRows: s.deletedRows, demandRows: build.md61.rows.length, stage, dataSource: baseline?.usable ? 'SAP' : 'sintético', demandFromForecast: useForecast },
        artifacts: build.artifacts.map(({ name, kind, plantId, content }) => ({ name, kind, plantId, content })),
        warnings: checks.filter((c) => c.level !== 'error').map((c) => ({ code: c.code, message: c.message, requiresJustification: c.requiresJustification, justification: justifications[c.code]?.trim() || undefined })),
      });
      setTab('releases');
    }, 'Propuesta registrada: falta la aprobación de la otra capa.');

  const showPreview = async (r: ReleasePackage, name: string) => {
    try {
      const full = await api.release(r.id);
      const a = full.artifacts.find((x) => x.name === name);
      setPreview({ title: `${r.id} · ${name}`, text: (a?.content ?? '').split('\n').slice(0, 12).join('\n') });
    } catch (e) {
      setMessage({ ok: false, text: errText(e) });
    }
  };

  if (!serverMode) {
    return (
      <div className="glass-panel rounded-3xl p-5 space-y-2">
        <h1 className="text-xl font-black">Salida a SAP</h1>
        <p className="text-xs text-slate-600 max-w-3xl">
          Esta etapa necesita el servidor de gobernanza: usuarios por rol, doble control, auditoría y archivos inmutables. Está en modo local (sin servidor), donde todo está permitido y nada se guarda.
          Para activarlo: <span className="font-mono">npm run dev:server</span> y recarga la página.
        </p>
      </div>
    );
  }

  const approveAs = (r: ReleasePackage): 'capacity' | 'mps' | null => {
    if (r.status !== 'PROPOSED' || r.proposedBy.id === user?.id) return null;
    if (can('release.approve.capacity') && !r.approvals.capacity) return 'capacity';
    if (can('release.approve.mps') && !r.approvals.mps) return 'mps';
    return null;
  };

  return (
    <div className="space-y-5">
      <div className="glass-panel rounded-3xl p-5">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
          <span className="w-2 h-2 rounded-full bg-[#7AFFA1]"></span>
          <span className="text-black font-extrabold">Salida a SAP · Gobernanza</span>
        </div>
        <h1 className="text-xl sm:text-2xl font-black tracking-tight text-slate-950">Solo lo aprobado sale, y lo publicado es exactamente lo aprobado</h1>
        <p className="text-xs text-slate-500 mt-0.5 font-medium max-w-4xl">
          Genera, por planta, las órdenes provisionales del MPS final y el archivo de demanda, más el borrado de las órdenes de la publicación anterior para no duplicar necesidad.
          Quien propone aprueba su capa (Producción: capacidad · Distribución: MPS) y otra persona aprueba la otra; publica alguien distinto de quien propuso. Todo queda en una auditoría encadenada.
          <span className="font-bold"> No se conecta a SAP: son archivos para revisar y cargar con LSMW. El formato es un supuesto sin probar contra el cargue real.</span>
        </p>
      </div>

      {message && <div role="status" className={`rounded-3xl px-5 py-3 text-xs font-bold border ${message.ok ? 'bg-[#7AFFA1]/40 border-[#7AFFA1]' : 'bg-[#FFA27D]/30 border-[#FFA27D]'}`}>{message.text}</div>}

      <div className="flex flex-wrap gap-2">
        {([['prepare', 'Preparar y proponer'], ['releases', `Propuestas (${releases.length})`], ['audit', 'Auditoría y usuarios']] as [Tab, string][]).map(([t, l]) => (
          <button key={t} onClick={() => setTab(t)} className={`px-4 py-2 rounded-full text-xs font-bold cursor-pointer ${tab === t ? 'bg-slate-950 text-white' : 'bg-white/70 text-slate-600'}`}>{l}</button>
        ))}
      </div>

      {tab === 'prepare' && build && (
        <div className="space-y-5">
          <div className="glass-panel rounded-3xl p-5 space-y-3">
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Lo que se publicaría como {nextId}</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              {[
                ['Órdenes a crear', fmtInt(build.orders.summary.createdRows)],
                ['Cajas escritas', fmtInt(build.orders.summary.writtenCommercial)],
                ['Órdenes a borrar', fmtInt(build.orders.summary.deletedRows)],
                ['Filas de demanda (MD61)', fmtInt(build.md61.rows.length)],
              ].map(([k, v]) => <div key={k} className="rounded-xl bg-white/60 border border-white/80 px-3 py-2"><div className="text-[10px] uppercase font-bold text-slate-500">{k}</div><div className="font-mono font-black text-lg">{v}</div></div>)}
            </div>
            <table className="w-full text-xs">
              <thead><tr className="text-[10px] uppercase text-slate-500 text-left"><th className="py-1">Archivo</th><th>Tipo</th><th className="text-right">Filas</th></tr></thead>
              <tbody>
                {build.artifacts.map((a) => <tr key={a.name} className="border-t border-black/5"><td className="py-1.5 font-mono">{a.name}</td><td>{a.kind === 'PROVISIONAL_ORDERS' ? 'Órdenes provisionales' : a.kind === 'ORDER_DELETIONS' ? 'Borrado de la publicación anterior' : 'Demanda (MD61)'}</td><td className="text-right font-mono">{fmtInt(a.rows)}</td></tr>)}
              </tbody>
            </table>
            {build.orders.summary.firstWeek && <p className="text-[11px] text-slate-500">Semanas {weekLabel(build.orders.summary.firstWeek)} a {weekLabel(build.orders.summary.lastWeek ?? build.orders.summary.firstWeek)}. Cada orden se fecha el último día con horas de su línea; la diferencia con el plan ({fmtInt(build.orders.summary.plannedCommercial)} cajas) es solo redondeo.</p>}
          </div>

          <div className="glass-panel rounded-3xl p-5 space-y-3">
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Verificaciones antes de proponer</div>
            {checks.length === 0 ? <p className="text-xs text-emerald-800 font-bold">Sin avisos.</p> : checks.map((c) => (
              <div key={c.code} className="space-y-1.5">
                <div className="flex items-start gap-2 text-xs">
                  <span className={`text-[9px] font-black rounded-full px-2 py-0.5 text-black shrink-0 ${c.level === 'error' ? 'bg-[#FFA27D]' : c.level === 'warning' ? 'bg-[#FFF87C]' : 'bg-[#DDCBF5]'}`}>{c.level === 'error' ? 'Error' : c.level === 'warning' ? 'Aviso' : 'Nota'}</span>
                  <span>{c.message}</span>
                </div>
                {c.requiresJustification && (
                  <input value={justifications[c.code] ?? ''} onChange={(e) => setJustifications((j) => ({ ...j, [c.code]: e.target.value }))} placeholder="Justificación (obligatoria, mín. 10 caracteres)" aria-label={`Justificación ${c.code}`} className="w-full rounded-xl border border-black/10 bg-white/80 px-2.5 py-2 text-xs" />
                )}
              </div>
            ))}
            <button onClick={propose} disabled={busy || !!blocker} className="px-5 py-2.5 text-xs font-bold text-white bg-slate-950 rounded-full disabled:opacity-40 cursor-pointer">Proponer salida {nextId}</button>
            {blocker && <p className="text-[11px] text-slate-500">{blocker}</p>}
          </div>
        </div>
      )}

      {tab === 'releases' && (
        <div className="space-y-4">
          {releases.length === 0 && <div className="glass-panel rounded-3xl p-5 text-xs text-slate-600">Todavía no hay propuestas.</div>}
          {[...releases].reverse().map((r) => {
            const as = approveAs(r);
            const canReject = (r.status === 'PROPOSED' || r.status === 'APPROVED') && (can('release.approve.capacity') || can('release.approve.mps') || r.proposedBy.id === user?.id);
            const canPublish = r.status === 'APPROVED' && can('release.publish') && r.proposedBy.id !== user?.id;
            return (
              <div key={r.id} className="glass-panel rounded-3xl p-5 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-black font-mono">{r.id}</h3>
                  <span className={`text-[9px] font-black rounded-full px-2 py-0.5 text-black ${STATUS[r.status].chip}`}>{STATUS[r.status].label}</span>
                  <span className="text-[11px] text-slate-500">propuso {r.proposedBy.name} ({ROLE_LABELS[r.proposedBy.role]}) · {when(r.proposedAt)}{r.supersedes ? ` · reemplaza a ${r.supersedes}` : ''}</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                  {(['capacity', 'mps'] as const).map((k) => {
                    const a = r.approvals[k];
                    return <div key={k} className={`rounded-xl border px-3 py-2 ${a ? 'bg-[#7AFFA1]/30 border-[#7AFFA1]' : 'bg-white/60 border-white/80'}`}><span className="font-bold">{k === 'capacity' ? 'Capacidad (Producción)' : 'MPS final (Distribución)'}:</span> {a ? `✓ ${a.by.name} · ${when(a.at)}${a.comment ? ` — ${a.comment}` : ''}` : 'pendiente'}</div>;
                  })}
                </div>
                {r.rejection && <p className="text-xs"><span className="font-bold">Rechazada por {r.rejection.by.name}:</span> {r.rejection.reason}</p>}
                {r.warnings.length > 0 && (
                  <ul className="text-xs list-disc pl-4 space-y-0.5">{r.warnings.map((w) => <li key={w.code}>{w.message}{w.justification ? <span className="text-slate-500"> — «{w.justification}»</span> : null}</li>)}</ul>
                )}
                <table className="w-full text-xs">
                  <tbody>
                    {r.artifacts.map((a) => (
                      <tr key={a.name} className="border-t border-black/5">
                        <td className="py-1.5 font-mono">{a.name}</td><td className="text-right font-mono">{fmtInt(a.rows)} filas</td><td className="text-right font-mono text-slate-400" title={a.sha256}>sha256 {short(a.sha256)}…</td>
                        <td className="text-right"><button onClick={() => showPreview(r, a.name)} className="text-[11px] underline text-slate-600 cursor-pointer mr-3">Ver</button><button onClick={() => downloadArtifact(r.id, a.name).catch((e) => setMessage({ ok: false, text: errText(e) }))} className="text-[11px] underline text-slate-600 cursor-pointer">Descargar</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-[10px] text-slate-500 font-mono">Contenido {short(r.contentHash)}… (si algo cambia después de aprobarse, no se publica).</p>
                {(as || canReject || canPublish) && (
                  <div className="flex flex-wrap items-end gap-2">
                    <input value={comment[r.id] ?? ''} onChange={(e) => setComment((c) => ({ ...c, [r.id]: e.target.value }))} placeholder="Comentario o motivo" aria-label={`Comentario ${r.id}`} className="flex-1 min-w-48 rounded-xl border border-black/10 bg-white/80 px-2.5 py-2 text-xs" />
                    {as && <button disabled={busy} onClick={() => act(() => api.approve(r.id, as, comment[r.id] ?? ''), `Aprobaste ${as === 'capacity' ? 'la capacidad' : 'el MPS final'} de ${r.id}.`)} className="px-4 py-2 text-xs font-bold text-white bg-slate-950 rounded-full disabled:opacity-40 cursor-pointer">Aprobar {as === 'capacity' ? 'capacidad' : 'MPS final'}</button>}
                    {canPublish && <button disabled={busy} onClick={() => act(() => api.publish(r.id), `${r.id} publicada: los archivos quedaron fijos.`)} className="px-4 py-2 text-xs font-bold text-white bg-slate-950 rounded-full disabled:opacity-40 cursor-pointer">Publicar</button>}
                    {canReject && <button disabled={busy || (comment[r.id] ?? '').trim().length < 10} onClick={() => act(() => api.reject(r.id, comment[r.id] ?? ''), `${r.id} rechazada.`)} className="px-4 py-2 text-xs font-bold bg-white/80 border border-black/10 rounded-full disabled:opacity-40 cursor-pointer">Rechazar (motivo ≥ 10)</button>}
                  </div>
                )}
              </div>
            );
          })}
          {preview && (
            <div className="glass-panel rounded-3xl p-5 space-y-2">
              <div className="flex items-center justify-between"><div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{preview.title} (primeras filas)</div><button onClick={() => setPreview(null)} className="text-[11px] underline text-slate-500 cursor-pointer">Cerrar</button></div>
              <pre className="text-[11px] font-mono overflow-x-auto whitespace-pre">{preview.text}</pre>
            </div>
          )}
        </div>
      )}

      {tab === 'audit' && (
        <div className="space-y-5">
          <div className="glass-panel rounded-3xl p-5 space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Auditoría encadenada ({audit?.total ?? '…'} entradas)</div>
              <button onClick={() => api.verifyAudit().then(setChain).catch((e) => setMessage({ ok: false, text: errText(e) }))} className="px-3.5 py-1.5 text-xs font-bold text-white bg-slate-950 rounded-full cursor-pointer">Verificar cadena</button>
              {chain && <span className={`text-xs font-bold rounded-full px-2.5 py-1 ${chain.ok ? 'bg-[#7AFFA1]' : 'bg-[#FFA27D]'}`}>{chain.ok ? `Íntegra (${chain.entries} entradas)` : `Rota en la entrada ${chain.brokenAt}: ${chain.reason}`}</span>}
            </div>
            <div className="overflow-x-auto max-h-96">
              <table className="w-full text-[11px]">
                <thead><tr className="text-[10px] uppercase text-slate-500 text-left"><th className="py-1">#</th><th>Cuándo</th><th>Quién</th><th>Qué</th><th>Detalle</th></tr></thead>
                <tbody>
                  {(audit?.entries ?? []).map((e) => (
                    <tr key={e.seq} className="border-t border-black/5 align-top">
                      <td className="py-1 font-mono">{e.seq}</td><td className="font-mono whitespace-nowrap">{when(e.at)}</td><td>{e.actor ? `${e.actor.id} (${e.actor.role})` : 'sistema'}</td><td className="font-mono">{e.type}</td>
                      <td className="text-slate-500 break-all">{JSON.stringify(e.data).slice(0, 140)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-slate-500">Cada entrada incluye el hash de la anterior: modificar, borrar o reordenar una rompe la cadena. Es evidencia de integridad, no firma digital de cada persona.</p>
          </div>

          {user?.role === 'admin' && (
            <div className="glass-panel rounded-3xl p-5 space-y-3">
              <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Usuarios</div>
              <table className="w-full text-xs">
                <tbody>{users.map((u) => <tr key={u.id} className="border-t border-black/5"><td className="py-1.5 font-mono">{u.id}</td><td>{u.name}</td><td>{u.roleLabel}</td></tr>)}</tbody>
              </table>
              <div className="flex flex-wrap items-end gap-2">
                <input value={newUser.id} onChange={(e) => setNewUser({ ...newUser, id: e.target.value })} placeholder="usuario" aria-label="Usuario nuevo" className="rounded-xl border border-black/10 bg-white/80 px-2.5 py-2 text-xs" />
                <input value={newUser.name} onChange={(e) => setNewUser({ ...newUser, name: e.target.value })} placeholder="Nombre" aria-label="Nombre del usuario nuevo" className="rounded-xl border border-black/10 bg-white/80 px-2.5 py-2 text-xs" />
                <select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value as GovRole })} aria-label="Rol del usuario nuevo" className="rounded-xl border border-black/10 bg-white/80 px-2.5 py-2 text-xs">
                  {(Object.keys(ROLE_LABELS) as GovRole[]).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </select>
                <button onClick={() => api.createUser(newUser).then((r) => { setCreatedPassword({ id: r.user.id, password: r.password }); setNewUser({ id: '', name: '', role: 'viewer' }); return api.users().then((x) => setUsers(x.users)); }).catch((e) => setMessage({ ok: false, text: errText(e) }))} className="px-4 py-2 text-xs font-bold text-white bg-slate-950 rounded-full cursor-pointer">Crear usuario</button>
              </div>
              {createdPassword && <p className="text-xs rounded-xl bg-[#FFF87C]/50 border border-[#FFF87C] px-3 py-2">Contraseña de <span className="font-mono font-bold">{createdPassword.id}</span>: <span className="font-mono font-bold select-all">{createdPassword.password}</span> — se muestra una sola vez; el servidor solo guarda su hash.</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
