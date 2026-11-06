import React, { useMemo, useState } from 'react';
import { ReleaseFile, ReleaseRecord } from '@ramo/domain';
import { CYCLE_ORDER, summarizePlants } from '@ramo/engine';
import { buildProvisionalOrders, confirmationsCsv, dailyPlanCsv, parseOrdersCsv } from '@ramo/sap-out';
import { useRamoPlan } from '../../ramo/store';
import { useAuth } from '../../ramo/auth';
import { downloadCsv } from '../../ramo/download';
import { fmtInt, weekLabel } from '../../ramo/format';
import { ProcessStep } from '../../ramo/steps';

const KIND_LABEL: Record<ReleaseFile['kind'], string> = {
  DAILY_PLAN: 'Programación diaria',
  CONFIRMATIONS: 'Confirmación de plantas',
  PROVISIONAL_ORDERS: 'Órdenes provisionales',
  ORDER_DELETIONS: 'Borrado de las anteriores',
};
const when = (iso: string) => iso.slice(0, 16).replace('T', ' ');
const lines = (csv: string) => Math.max(0, csv.trim().split('\n').length - 1);

/** Plan oficial: lo que sale cada viernes. Se revisa lo pendiente, se liberan los archivos por planta y cada versión queda guardada tal como salió. */
export function ReleaseView({ onSelectStep }: { onSelectStep: (s: ProcessStep) => void }) {
  const { dataset, stage, daily, danielView, miguelView, plantRows, plantConfirmations, adjustments, releases, publishRelease, can, weeks } = useRamoPlan();
  const { user } = useAuth();
  const author = user?.name ?? 'Producción';
  const canRelease = can('release.publish');
  const [note, setNote] = useState('');
  const [withPending, setWithPending] = useState(false);
  const [useConfirmed, setUseConfirmed] = useState(true);
  const [openVersion, setOpenVersion] = useState<string | null>(null);

  const sum = summarizePlants(plantRows);
  const redWeeks = new Set(miguelView.alerts.map((a) => a.weekStart)).size;
  const dailyRedWeeks = new Set(daily?.alerts.filter((a) => a.code === 'OVER_CAPACITY').map((a) => a.weekStart)).size;
  const violations = daily?.alerts.filter((a) => a.code === 'RULE_VIOLATION').length ?? 0;
  const closed = CYCLE_ORDER.indexOf(stage) >= CYCLE_ORDER.indexOf('MPS_FINAL');
  const mpsQty = danielView.net.reduce((a, r) => a + r.netProduction, 0);
  const plantsOk = sum.pending === 0 && sum.shortfall === 0 && sum.planChanged === 0;

  const checks: { ok: boolean; label: string; value: string; detail: string; go: ProcessStep }[] = [
    { ok: closed, label: 'MPS', value: closed ? 'Cerrado' : 'Abierto', detail: closed ? 'Distribución lo cerró.' : 'Todavía puede cambiar.', go: 'mps' },
    { ok: plantsOk, label: 'Plantas', value: sum.pending > 0 ? `${sum.pending} por confirmar` : sum.planChanged > 0 ? `${sum.planChanged} viejas` : sum.shortfall > 0 ? `faltan ${fmtInt(sum.shortfall)}` : 'Al día', detail: sum.coverage !== null ? `Lo confirmado cubre ${Math.round(sum.coverage * 100)} % de lo pedido.` : 'Nada confirmado todavía.', go: 'plants' },
    { ok: redWeeks === 0, label: 'Capacidad', value: redWeeks === 0 ? 'Resuelta' : `${redWeeks} sem. con sobrecarga`, detail: redWeeks === 0 ? 'Carga dentro de capacidad en todas las tripulaciones.' : 'Siguen faltando horas.', go: 'crp' },
    { ok: dailyRedWeeks === 0 && violations === 0, label: 'Programación diaria', value: dailyRedWeeks === 0 && violations === 0 ? 'Sin alertas' : `${dailyRedWeeks} sem. con sobrecarga${violations ? ` · ${violations} regla(s)` : ''}`, detail: 'Días sobre su capacidad o reglas de planta violadas.', go: 'daily' },
  ];
  const pendingCount = checks.filter((c) => !c.ok).length;
  const needJustify = pendingCount > 0;
  const canPublish = canRelease && (!needJustify || (withPending && note.trim().length > 0));

  // ---- Archivos de la versión que saldría ---------------------------------------------------------------------------------
  const nextVersion = releases.length + 1;
  const built = useMemo(() => {
    const releaseId = `V${nextVersion}`;
    const files: ReleaseFile[] = [];
    if (daily) {
      for (const pl of dataset.plants) {
        const csv = dailyPlanCsv(dataset, daily, pl.id);
        if (lines(csv) > 0) files.push({ name: `programacion_diaria_${pl.sapCenter ?? pl.id}_${releaseId}.csv`, kind: 'DAILY_PLAN', plantId: pl.id, csv });
      }
    }
    if (plantRows.length > 0) files.push({ name: `confirmacion_plantas_${releaseId}.csv`, kind: 'CONFIRMATIONS', csv: confirmationsCsv(dataset, plantRows) });
    const confirmedBy = new Map(plantRows.filter((r) => r.current).map((r) => [`${r.skuId}|${r.weekStart}`, r.confirmedQty]));
    const plan = danielView.net.map((r) => ({ skuId: r.skuId, weekStart: r.weekStart, netProduction: useConfirmed && confirmedBy.has(`${r.skuId}|${r.weekStart}`) ? Math.min(r.netProduction, confirmedBy.get(`${r.skuId}|${r.weekStart}`)!) : r.netProduction }));
    const last = releases[releases.length - 1];
    const priorOrders = last ? last.files.filter((f) => f.kind === 'PROVISIONAL_ORDERS').flatMap((f) => parseOrdersCsv(f.csv).rows) : [];
    const orders = buildProvisionalOrders(dataset, plan, { releaseId, priorOrders });
    for (const f of orders.files) files.push({ name: f.name, kind: f.kind, plantId: f.plantId, csv: f.csv });
    return { files, issues: orders.issues };
  }, [dataset, daily, danielView.net, plantRows, releases, useConfirmed, nextVersion]);

  const release = () => {
    if (!canPublish) return;
    publishRelease({
      author, note: note.trim(), weekFrom: weeks[0], weekTo: weeks[weeks.length - 1], justified: needJustify, files: built.files,
      summary: { mpsQty: Math.round(mpsQty), pendingPlants: sum.pending, shortfall: sum.shortfall, redWeeks, dailyRedWeeks, ruleViolations: violations, adjustments: adjustments.length },
    });
    setNote(''); setWithPending(false); setOpenVersion(null);
  };

  const plantName = (id?: string) => dataset.plants.find((p) => p.id === id)?.name.replace(' (sint.)', '') ?? '';
  const find = (files: ReleaseFile[], kind: ReleaseFile['kind'], plantId?: string) => files.find((f) => f.kind === kind && f.plantId === plantId);
  const DownloadCell = ({ f }: { f?: ReleaseFile }) =>
    f ? (
      <button onClick={() => downloadCsv(f.name, f.csv)} title={f.name} className="inline-flex items-center gap-1.5 rounded-full bg-white/80 border border-black/10 px-3 py-1.5 text-[11px] font-bold cursor-pointer hover:bg-white">
        <span aria-hidden="true">⬇</span> {lines(f.csv)} filas
      </button>
    ) : <span className="text-slate-300">—</span>;
  const FilesTable = ({ files }: { files: ReleaseFile[] }) => {
    const plantIds = [...new Set(files.filter((f) => f.plantId).map((f) => f.plantId!))];
    const conf = find(files, 'CONFIRMATIONS');
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-slate-500 text-left"><th className="pb-2 pr-3">Planta</th><th className="pb-2 pr-3">{KIND_LABEL.DAILY_PLAN}</th><th className="pb-2 pr-3">{KIND_LABEL.PROVISIONAL_ORDERS}</th><th className="pb-2">{KIND_LABEL.ORDER_DELETIONS}</th></tr>
          </thead>
          <tbody>
            {plantIds.map((pid) => (
              <tr key={pid} className="border-t border-black/5">
                <td className="py-2 pr-3 font-bold whitespace-nowrap">{plantName(pid)}</td>
                <td className="py-2 pr-3"><DownloadCell f={find(files, 'DAILY_PLAN', pid)} /></td>
                <td className="py-2 pr-3"><DownloadCell f={find(files, 'PROVISIONAL_ORDERS', pid)} /></td>
                <td className="py-2"><DownloadCell f={find(files, 'ORDER_DELETIONS', pid)} /></td>
              </tr>
            ))}
            {conf && (
              <tr className="border-t border-black/5"><td className="py-2 pr-3 font-bold">Todas las plantas</td><td colSpan={3} className="py-2"><span className="mr-2 text-slate-500">{KIND_LABEL.CONFIRMATIONS}</span><DownloadCell f={conf} /></td></tr>
            )}
          </tbody>
        </table>
      </div>
    );
  };

  /** Versión compacta para el panel angosto de versiones: una línea por planta con un botón por archivo. */
  const FilesList = ({ files }: { files: ReleaseFile[] }) => {
    const plantIds = [...new Set(files.filter((f) => f.plantId).map((f) => f.plantId!))];
    const conf = find(files, 'CONFIRMATIONS');
    const short: Record<ReleaseFile['kind'], string> = { DAILY_PLAN: 'Diaria', PROVISIONAL_ORDERS: 'Órdenes', ORDER_DELETIONS: 'Borrado', CONFIRMATIONS: 'Confirmación' };
    const pill = (f?: ReleaseFile) => f ? <button key={f.name} onClick={() => downloadCsv(f.name, f.csv)} title={`${KIND_LABEL[f.kind]} · ${f.name}`} className="rounded-full bg-white/80 border border-black/10 px-2.5 py-1 text-[10px] font-bold cursor-pointer hover:bg-white whitespace-nowrap">⬇ {short[f.kind]} · {lines(f.csv)}</button> : null;
    return (
      <ul className="space-y-1.5">
        {plantIds.map((pid) => (
          <li key={pid} className="flex flex-wrap items-center gap-1.5"><span className="font-bold mr-1 w-16 shrink-0">{plantName(pid).replace('Planta ', 'Planta ')}</span>{(['DAILY_PLAN', 'PROVISIONAL_ORDERS', 'ORDER_DELETIONS'] as const).map((k) => pill(find(files, k, pid)))}</li>
        ))}
        {conf && <li className="flex flex-wrap items-center gap-1.5"><span className="font-bold mr-1 w-16 shrink-0">Todas</span>{pill(conf)}</li>}
      </ul>
    );
  };

  const lastRelease: ReleaseRecord | undefined = releases[releases.length - 1];
  const openId = openVersion ?? lastRelease?.id ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight">Plan oficial</h1>
          <p className="text-sm text-slate-600 max-w-3xl">Lo que sale cada viernes a las plantas: revisa lo pendiente, libera la versión y descarga los archivos por planta. Cada versión queda guardada tal como salió.</p>
        </div>
        <span className={`rounded-full px-3 py-1.5 text-[11px] font-black ${lastRelease ? 'bg-[#7AFFA1]' : 'bg-slate-200'}`}>{lastRelease ? `Versión ${lastRelease.version} liberada` : 'Todavía no se ha liberado'}</span>
      </div>

      <div className="rounded-2xl bg-[#DDCBF5]/45 border border-[#DDCBF5] px-4 py-2 text-xs">
        <b>No escribe en SAP.</b> Genera archivos para que una persona los revise y los cargue con LSMW, como hoy. El formato de las órdenes provisionales es un supuesto sin probar contra el cargue real.
      </div>

      {/* 1. Qué falta */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" role="list" aria-label="Verificaciones antes de liberar">
        {checks.map((c) => (
          <button key={c.label} role="listitem" onClick={() => onSelectStep(c.go)} className="glass-card glass-card-hover rounded-3xl p-4 text-left cursor-pointer">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-500"><span className={`w-2.5 h-2.5 rounded-full ${c.ok ? 'bg-[#7AFFA1]' : 'bg-[#FFA27D]'}`} />{c.label}</div>
            <div className={`mt-1.5 text-lg font-black leading-tight ${c.ok ? '' : 'text-[#c2410c]'}`}>{c.value}</div>
            <div className="mt-1 text-[11px] text-slate-500 leading-snug">{c.detail}</div>
          </button>
        ))}
      </div>

      {/* 2. Liberar */}
      <section className="rounded-3xl bg-slate-950 text-white p-4 sm:p-5 shadow-lg">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <div className="min-w-[180px]">
            <div className="text-[11px] font-black uppercase tracking-wider text-[#7AFFA1]">Versión {nextVersion}</div>
            <div className="text-sm font-black">{needJustify ? `${pendingCount} pendiente(s) por revisar` : 'Listo para liberar'}</div>
          </div>
          {needJustify && (
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" checked={withPending} onChange={(e) => setWithPending(e.target.checked)} /> Liberar con pendientes (queda justificado)
            </label>
          )}
          <input value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') release(); }} placeholder={needJustify ? 'Por qué se libera con pendientes (obligatorio)' : 'Nota de la versión (opcional)'} aria-label="Nota de la versión" className="flex-1 min-w-[220px] rounded-xl bg-white text-black px-3 py-2 text-xs" />
          <button onClick={release} disabled={!canPublish} className="px-5 py-2.5 text-xs font-black text-black bg-[#7AFFA1] rounded-full disabled:opacity-40 cursor-pointer">Liberar la versión {nextVersion} · {author}</button>
        </div>
        {!canRelease && <p className="mt-2 text-[11px] text-slate-300">Tu rol no puede liberar el plan oficial (lo liberan Producción y Distribución).</p>}
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-4 items-start">
        {/* 3. Archivos */}
        <section className="glass-panel rounded-3xl p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h2 className="text-sm font-black">Archivos de la versión {nextVersion}</h2>
            <span className="text-[11px] text-slate-500">Se pueden descargar antes de liberar</span>
          </div>
          <FilesTable files={built.files} />
          {built.issues.length > 0 && <ul className="mt-3 space-y-1 text-[11px]">{built.issues.map((i, k) => <li key={k} className={`rounded-lg px-3 py-1.5 ${i.severity === 'error' ? 'bg-[#FFA27D]/40' : 'bg-[#FFF87C]/50'}`}>{i.message}</li>)}</ul>}
          <details className="mt-4 text-xs">
            <summary className="cursor-pointer font-bold text-slate-500">Cómo se arman los archivos</summary>
            <div className="mt-2 space-y-2 text-[11px] text-slate-600">
              <p>La programación diaria sale del MPS y los esquemas vigentes. Las órdenes provisionales son semanales, con fecha en el último día de producción de la línea; {releases.length > 0 ? 'incluyen el borrado de las que creó la versión anterior para no duplicar la necesidad' : 'la primera versión no borra nada'}.</p>
              {plantConfirmations.length > 0 && (
                <label className="flex items-center gap-1.5 cursor-pointer font-bold"><input type="checkbox" checked={useConfirmed} onChange={(e) => setUseConfirmed(e.target.checked)} /> Las órdenes usan lo que confirmaron las plantas (donde confirmaron menos de lo pedido)</label>
              )}
            </div>
          </details>
        </section>

        {/* Versiones */}
        <aside className="glass-panel rounded-3xl p-4 xl:sticky xl:top-[88px]">
          <h2 className="text-[11px] font-black uppercase tracking-wider text-slate-500 mb-2">Versiones liberadas ({releases.length})</h2>
          {releases.length === 0 ? <p className="text-xs text-slate-500">Todavía no hay versiones. La primera que se libere queda aquí con sus archivos.</p> : (
            <ul className="space-y-2">
              {[...releases].reverse().map((r) => {
                const open = openId === r.id;
                return (
                  <li key={r.id} className="rounded-2xl bg-white/60 border border-white overflow-hidden">
                    <button onClick={() => setOpenVersion(open ? '' : r.id)} aria-expanded={open} className="w-full text-left px-3 py-2.5 flex items-center justify-between gap-2 cursor-pointer">
                      <span className="text-xs"><b>Versión {r.version}</b> <span className="text-slate-500">· {when(r.createdAt)} · {r.author}</span></span>
                      <span className="flex items-center gap-1.5 shrink-0">
                        {r.justified && <span className="text-[9px] font-black rounded-full px-2 py-0.5 bg-[#FFF87C]" title="Se liberó con pendientes justificados">justificada</span>}
                        <span aria-hidden="true" className={`transition-transform ${open ? 'rotate-90' : ''}`}>▸</span>
                      </span>
                    </button>
                    {open && (
                      <div className="px-3 pb-3 space-y-2 text-xs">
                        <div className="text-slate-600">Semanas del {weekLabel(r.weekFrom)} al {weekLabel(r.weekTo)} · {fmtInt(r.summary.mpsQty)} cajas{r.summary.shortfall > 0 ? ` · faltaban ${fmtInt(r.summary.shortfall)}` : ''}</div>
                        {r.note && <div>«{r.note}»</div>}
                        <FilesList files={r.files} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}
