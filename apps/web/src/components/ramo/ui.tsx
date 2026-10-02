import React, { useState } from 'react';
import { fmtShort } from './charts';

/** Sección plegable: la tabla detallada queda a un clic, sin ser lo primero que se ve. */
export function Disclosure({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-black/5 pt-3">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2 text-xs font-bold text-slate-600 hover:text-black cursor-pointer" aria-expanded={open}>
        <span className={`inline-block transition-transform ${open ? 'rotate-90' : ''}`}>▸</span>
        {title}
      </button>
      {open && <div className="mt-3 overflow-x-auto">{children}</div>}
    </div>
  );
}

/** Tarjeta con título, ayuda y acciones; reemplaza los bloques de tabla suelta. */
export function Card({ title, hint, action, children, className = '' }: { title?: string; hint?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`glass-panel rounded-3xl p-5 ${className}`}>
      {(title || action) && (
        <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
          <div>
            {title && <h2 className="text-sm font-black text-slate-950 leading-tight">{title}</h2>}
            {hint && <p className="text-[11px] text-slate-500 mt-0.5 max-w-3xl">{hint}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export interface Stack {
  name: string;
  color: string;
  values: number[];
}

/** Barras apiladas por semana, con tooltip y total. */
export function StackedBars({ labels, stacks, height = 220, unit = 'cajas', highlight }: { labels: string[]; stacks: Stack[]; height?: number; unit?: string; highlight?: (i: number) => boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720;
  const H = height;
  const m = { t: 10, r: 12, b: 24, l: 52 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const totals = labels.map((_, i) => stacks.reduce((a, s) => a + (s.values[i] ?? 0), 0));
  const rawMax = Math.max(...totals, 1) * 1.05;
  const p = Math.pow(10, Math.floor(Math.log10(rawMax)));
  const f = rawMax / p;
  const maxV = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  const slot = iw / labels.length;
  const bw = Math.min(34, slot * 0.62);
  const y = (v: number) => m.t + ih - (v / maxV) * ih;
  const step = Math.max(1, Math.ceil(labels.length / 10));

  return (
    <div>
      <div className="flex flex-wrap gap-4 mb-2">
        {stacks.map((s) => (
          <span key={s.name} className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.color }}></span>
            {s.name}
          </span>
        ))}
      </div>
      <div className="relative" onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={`Barras apiladas por semana: ${stacks.map((s) => s.name).join(', ')}`}>
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <g key={t}>
              <line x1={m.l} x2={W - m.r} y1={y(t * maxV)} y2={y(t * maxV)} stroke="rgba(15,23,42,0.08)" strokeDasharray={t === 0 ? undefined : '3 4'} />
              <text x={m.l - 8} y={y(t * maxV) + 3.5} textAnchor="end" fontSize="10.5" fill="#94a3b8">{fmtShort(t * maxV)}</text>
            </g>
          ))}
          {labels.map((l, i) => {
            const cx = m.l + slot * i + slot / 2;
            let acc = 0;
            return (
              <g key={l + i} onMouseEnter={() => setHover(i)}>
                <rect x={m.l + slot * i} y={m.t} width={slot} height={ih} fill={hover === i ? 'rgba(15,23,42,0.04)' : 'transparent'} />
                {stacks.map((s, k) => {
                  const v = s.values[i] ?? 0;
                  const y0 = y(acc);
                  acc += v;
                  const y1 = y(acc);
                  const top = k === stacks.length - 1 || stacks.slice(k + 1).every((t) => !(t.values[i] > 0));
                  return v > 0 ? <rect key={s.name} x={cx - bw / 2} y={y1} width={bw} height={Math.max(0, y0 - y1 - (k > 0 ? 1.5 : 0))} fill={s.color} rx={top ? 4 : 0} opacity={highlight && !highlight(i) ? 0.45 : 1} /> : null;
                })}
                {i % step === 0 && <text x={cx} y={H - 7} textAnchor="middle" fontSize="10.5" fill="#94a3b8">{l}</text>}
              </g>
            );
          })}
        </svg>
        {hover !== null && (
          <div className="absolute z-10 pointer-events-none rounded-xl bg-slate-900 text-white text-[11px] px-3 py-2 shadow-lg" style={{ left: `${((m.l + slot * hover + slot / 2) / W) * 100}%`, top: 0, transform: `translateX(${hover > labels.length / 2 ? '-105%' : '8%'})` }}>
            <div className="font-bold mb-1">Semana del {labels[hover]}</div>
            {stacks.map((s) => (
              <div key={s.name} className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-sm" style={{ background: s.color }}></span>
                <span className="text-slate-300">{s.name}</span>
                <span className="ml-auto font-bold tabular-nums pl-3">{Math.round(s.values[hover] ?? 0).toLocaleString('es-CO')}</span>
              </div>
            ))}
            <div className="border-t border-white/20 mt-1 pt-1 flex justify-between"><span className="text-slate-300">Total</span><span className="font-bold tabular-nums">{Math.round(totals[hover]).toLocaleString('es-CO')} {unit}</span></div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Barra de progreso con marcas (p. ej. asignado dentro de pedido, con el mínimo protegido). */
export function ProgressBar({ value, max, mark, color = '#7AFFA1', height = 10 }: { value: number; max: number; mark?: number; color?: string; height?: number }) {
  const pct = (v: number) => `${Math.max(0, Math.min(100, max > 0 ? (v / max) * 100 : 0))}%`;
  return (
    <div className="relative rounded-full bg-black/[0.06]" style={{ height }}>
      <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: pct(value), background: color }}></div>
      {mark !== undefined && <div className="absolute -top-0.5 -bottom-0.5 w-0.5 bg-slate-900/80 rounded" style={{ left: pct(mark) }}></div>}
    </div>
  );
}
