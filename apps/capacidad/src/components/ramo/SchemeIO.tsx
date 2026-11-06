import React, { useMemo, useState } from 'react';
import { ChangeCause, ProductionTemplate } from '@ramo/domain';
import { ParsedScheme, parseSchemesCsv, schemesToCsv, weekdayShort } from '@ramo/engine';
import { useRamoPlan } from '../../ramo/store';
import { useAuth } from '../../ramo/auth';
import { downloadCsv } from '../../ramo/download';
import { weekLabel } from '../../ramo/format';
import { CAUSES } from './DeskTools';

const UNTIL: { weeks: number | null; label: string }[] = [
  { weeks: null, label: 'sin fin' },
  { weeks: 4, label: '1 mes (4 semanas)' },
  { weeks: 13, label: '3 meses (13 semanas)' },
  { weeks: 26, label: '6 meses (26 semanas)' },
];
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const EXAMPLE = 'esquema;producto;lun;mar;mie;jue;vie;sab;dom\nT-BARMINI;SK-005;X;X;;;;;\nT-BARMINI;SK-003;;;X;X;;;\nT-BARMINI;SK-004;;;;;X;X;\nT-BARMINI;TURNOS;3;3;3;3;3;3;';
const field = 'rounded-xl border border-black/10 bg-white/80 px-2.5 py-1.5 text-xs font-semibold';

/** Esquemas y turnos en CSV: se descargan los vigentes, se editan en Excel y se vuelven a cargar como un cambio de esquema. */
export function SchemeIO() {
  const { dataset, daily, weeks, saveTemplateOverride, can } = useRamoPlan();
  const { user } = useAuth();
  const author = user?.name ?? 'Producción';
  const canEdit = can('capacity.edit');
  const [exportWeek, setExportWeek] = useState(weeks[0]);
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [fromWeek, setFromWeek] = useState(weeks[0]);
  const [until, setUntil] = useState<number | null>(null);
  const [cause, setCause] = useState<ChangeCause>('OTHER');
  const [reason, setReason] = useState('');
  const [done, setDone] = useState<number | null>(null);

  const skuName = (id: string) => dataset.skus.find((s) => s.id === id)?.name.replace(' (sint.)', '') ?? id;
  const current = (week: string): ProductionTemplate[] => daily?.weeks.filter((w) => w.weekStart === week).map((w) => w.template) ?? dataset.templates ?? [];
  const parsed = useMemo(() => (text.trim() ? parseSchemesCsv(text, dataset) : null), [text, dataset]);
  const errors = parsed?.issues.filter((i) => i.severity === 'error') ?? [];
  const warnings = parsed?.issues.filter((i) => i.severity === 'warning') ?? [];

  const describeDays = (days: Record<number, string[]>) =>
    Object.entries(days).filter(([, l]) => l.length).sort(([a], [b]) => Number(a) - Number(b)).map(([d, l]) => `${weekdayShort(Number(d))}: ${l.map(skuName).join(' + ')}`).join(' · ') || 'sin días';
  const sameDays = (a: Record<number, string[]>, b: Record<number, string[]>) => describeDays(a) === describeDays(b);
  const sameShifts = (a: Record<number, number>, b: Record<number, number>) => [1, 2, 3, 4, 5, 6, 7].every((d) => (a[d] ?? 0) === (b[d] ?? 0));

  const changes = (parsed?.schemes ?? []).map((p: ParsedScheme) => {
    const cur = current(fromWeek).find((t) => t.id === p.templateId)!;
    const shifts = p.shifts ?? cur.shifts;
    return { p, cur, shifts, differs: !sameDays(cur.days, p.days) || !sameShifts(cur.shifts, shifts) };
  });
  const toApply = changes.filter((c) => c.differs);
  const step = done !== null ? 4 : parsed ? 3 : 1;

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setText(await f.text());
    setFileName(f.name);
    setDone(null);
  };
  const apply = () => {
    if (!reason.trim() || toApply.length === 0 || !canEdit) return;
    for (const c of toApply) {
      saveTemplateOverride({ templateId: c.p.templateId, scope: 'FROM', weekStart: fromWeek, untilWeek: until ? addDays(fromWeek, 7 * (until - 1)) : undefined, days: c.p.days, shifts: c.shifts, cause, reason: reason.trim(), author });
    }
    setDone(toApply.length);
    setText(''); setFileName(''); setReason('');
  };

  return (
    <div className="space-y-4">
      <ol className="flex flex-wrap items-center gap-1.5" aria-label="Pasos para cargar los esquemas">
        {['Descargar los vigentes', 'Editar en Excel y cargar', 'Revisar y aplicar'].map((t, i) => {
          const n = i + 1;
          const active = n === Math.min(step, 3) && step !== 4;
          return <li key={t} className={`rounded-full px-3 py-1.5 text-[11px] font-bold border ${active ? 'bg-slate-950 text-white border-slate-950' : step === 4 || n < step ? 'bg-[#7AFFA1]/40 border-[#7AFFA1] text-black' : 'bg-white/60 border-white/80 text-slate-500'}`}>{step === 4 || n < step ? '✓ ' : `${n}. `}{t}</li>;
        })}
      </ol>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_400px] gap-4 items-start">
        <div className="space-y-4 min-w-0">
          <section className="glass-panel rounded-3xl p-4 sm:p-5 space-y-3">
            <div>
              <h2 className="text-sm font-black">1 · Descarga los esquemas vigentes</h2>
              <p className="text-[11px] text-slate-500 mt-0.5 max-w-2xl">Un CSV con una fila por producto (una X en los días en que se produce) y una fila TURNOS. Se abre en Excel; al guardarlo, elige «CSV delimitado por punto y coma».</p>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <label className="flex items-center gap-2 font-bold">Semana
                <select value={exportWeek} onChange={(e) => setExportWeek(e.target.value)} className={field}>{weeks.map((w) => <option key={w} value={w}>{weekLabel(w)}</option>)}</select>
              </label>
              <button onClick={() => downloadCsv(`esquemas_${exportWeek}.csv`, schemesToCsv(dataset, current(exportWeek)))} className="px-4 py-2 text-[11px] font-black rounded-full bg-white border border-black/10 cursor-pointer">⬇ Descargar CSV</button>
            </div>
          </section>

          <section className="glass-panel rounded-3xl p-4 sm:p-5 space-y-3">
            <div>
              <h2 className="text-sm font-black">2 · Carga tu archivo</h2>
              <p className="text-[11px] text-slate-500 mt-0.5">Se lee en tu navegador. Puedes escribir el esquema y el producto con el código o con el nombre.</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="px-4 py-2 text-[11px] font-black rounded-full bg-slate-950 text-white cursor-pointer">
                Elegir archivo CSV…
                <input type="file" accept=".csv,.txt,text/csv" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} aria-label="Archivo CSV de esquemas" />
              </label>
              <span className="text-xs text-slate-500">{fileName || 'ningún archivo'}</span>
            </div>
            <details className="text-xs" open={!!text && !fileName}>
              <summary className="cursor-pointer font-bold text-slate-500">O pega el contenido</summary>
              <textarea value={text} onChange={(e) => { setText(e.target.value); setDone(null); }} rows={5} placeholder={EXAMPLE} aria-label="Contenido del CSV" className="mt-2 w-full rounded-xl border border-black/10 bg-white/80 px-3 py-2 font-mono text-[11px]" />
            </details>
          </section>
        </div>

        {/* 3 · Revisión */}
        <aside className="glass-panel rounded-3xl p-4 sm:p-5 space-y-3 xl:sticky xl:top-[88px]">
          <h2 className="text-sm font-black">3 · Revisa y aplica</h2>
          {done !== null && <p className="rounded-xl bg-[#7AFFA1]/50 px-3 py-2 text-xs font-bold">Se aplicaron {done} cambio(s) de esquema. Míralos en la programación diaria, en «Cambios vigentes».</p>}

          {!parsed ? (
            <div className="space-y-2 text-xs">
              <p className="text-slate-600">Cuando cargues un archivo, aquí verás los errores con su fila y cómo cambia cada esquema («Hoy» frente a «Archivo») antes de aplicar nada.</p>
              <div className="font-bold text-[11px] text-slate-500 uppercase tracking-wider">Así se ve el formato</div>
              <pre className="rounded-xl bg-white/70 border border-white p-3 font-mono text-[10px] leading-relaxed overflow-x-auto">{EXAMPLE}</pre>
              <ul className="list-disc pl-4 space-y-0.5 text-[11px] text-slate-600">
                <li>Una <b>X</b> (o 1, sí) marca un día de producción.</li>
                <li>La fila <b>TURNOS</b> es opcional; sin ella se conservan los turnos actuales.</li>
                <li>Un esquema con errores no se importa.</li>
              </ul>
            </div>
          ) : (
            <div className="space-y-3 text-xs">
              {errors.length > 0 && <ul className="space-y-1">{errors.map((i, k) => <li key={k} className="rounded-lg bg-[#FFA27D]/40 px-3 py-1.5"><b>{i.line ? `Fila ${i.line}: ` : ''}</b>{i.message}</li>)}</ul>}
              {warnings.length > 0 && <ul className="space-y-1">{warnings.map((i, k) => <li key={k} className="rounded-lg bg-[#FFF87C]/50 px-3 py-1.5">{i.line ? `Fila ${i.line}: ` : ''}{i.message}</li>)}</ul>}

              {changes.length > 0 && (
                <>
                  <ul className="space-y-2">
                    {changes.map((c) => (
                      <li key={c.p.templateId} className={`rounded-xl px-3 py-2 border ${c.differs ? 'bg-white/80 border-white' : 'bg-slate-100/60 border-transparent'}`}>
                        <div className="font-black">{c.cur.name.split(' (')[0]} {c.differs ? '' : <span className="font-normal text-slate-500">· sin cambios</span>}</div>
                        {c.differs && (
                          <div className="mt-1 space-y-1 text-[11px]">
                            <div><span className="font-bold text-slate-500">Hoy:</span> {describeDays(c.cur.days)} <span className="text-slate-400">· turnos {[1, 2, 3, 4, 5, 6, 7].map((d) => c.cur.shifts[d] ?? 0).join('-')}</span></div>
                            <div><span className="font-bold text-emerald-800">Archivo:</span> {describeDays(c.p.days)} <span className="text-slate-400">· turnos {[1, 2, 3, 4, 5, 6, 7].map((d) => c.shifts[d] ?? 0).join('-')}{c.p.shifts ? '' : ' (los actuales)'}</span></div>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex flex-col gap-1 font-bold">Rige desde
                      <select value={fromWeek} onChange={(e) => setFromWeek(e.target.value)} className={field}>{weeks.map((w) => <option key={w} value={w}>{weekLabel(w)}</option>)}</select>
                    </label>
                    <label className="flex flex-col gap-1 font-bold">Por
                      <select value={until ?? ''} onChange={(e) => setUntil(e.target.value ? Number(e.target.value) : null)} aria-label="Vigencia" className={field}>{UNTIL.map((o) => <option key={String(o.weeks)} value={o.weeks ?? ''}>{o.label}</option>)}</select>
                    </label>
                    <label className="flex flex-col gap-1 font-bold col-span-2">Causa
                      <select value={cause} onChange={(e) => setCause(e.target.value as ChangeCause)} aria-label="Causa" className={field}>{CAUSES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
                    </label>
                  </div>
                  <input value={reason} onChange={(e) => setReason(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') apply(); }} placeholder="Motivo (obligatorio): nuevo escenario de capacidades…" aria-label="Motivo" className="w-full rounded-xl border border-black/10 bg-white/80 px-3 py-2" />
                  <button onClick={apply} disabled={!canEdit || toApply.length === 0 || !reason.trim()} className="w-full px-4 py-2.5 text-[11px] font-black rounded-full bg-slate-950 text-white disabled:opacity-40 cursor-pointer">Aplicar {toApply.length} cambio(s) · {author}</button>
                  {!canEdit && <p className="text-[11px] text-slate-500">Tu rol no puede cambiar esquemas.</p>}
                </>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
