import React, { useRef, useState } from 'react';

/** Colores categóricos validados (daltonismo y contraste): azul, naranja, verde azulado. */
export const SERIES_COLORS = ['#2b50aa', '#c9601c', '#2a9d8f'];

export const fmtShort = (n: number): string => {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${(n / 1_000_000).toLocaleString('es-CO', { maximumFractionDigits: 1 })} M`;
  if (a >= 1_000) return `${Math.round(n / 1_000).toLocaleString('es-CO')} mil`;
  return Math.round(n).toLocaleString('es-CO');
};

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

/** Línea diminuta para tarjetas de indicador. */
export function Sparkline({ values, color = '#2b50aa', height = 28 }: { values: number[]; color?: string; height?: number }) {
  if (values.length < 2) return null;
  const w = 100;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${height - 3 - ((v - min) / span) * (height - 6)}`);
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full" style={{ height }} preserveAspectRatio="none" aria-hidden="true">
      <polyline points={`0,${height} ${pts.join(' ')} ${w},${height}`} fill={color} opacity="0.1" />
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="1.8" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export interface LineSeries {
  name: string;
  color: string;
  values: number[];
  dashed?: boolean;
}

/** Gráfico de líneas con cuadrícula suave, leyenda y tooltip al pasar el cursor. */
export function LineChart({ labels, series, height = 260, unit = 'cajas' }: { labels: string[]; series: LineSeries[]; height?: number; unit?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const W = 720;
  const H = height;
  const m = { t: 12, r: 16, b: 26, l: 52 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const all = series.flatMap((s) => s.values);
  const maxV = niceMax(Math.max(...all, 1) * 1.05);
  const x = (i: number) => m.l + (labels.length <= 1 ? iw / 2 : (i / (labels.length - 1)) * iw);
  const y = (v: number) => m.t + ih - (v / maxV) * ih;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * maxV);
  const step = Math.max(1, Math.ceil(labels.length / 8));

  const onMove = (e: React.MouseEvent) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((px - m.l) / iw) * (labels.length - 1));
    setHover(Math.max(0, Math.min(labels.length - 1, i)));
  };

  return (
    <div>
      <div className="flex flex-wrap gap-4 mb-2">
        {series.map((s) => (
          <span key={s.name} className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
            <span className="inline-block w-4 h-0.5 rounded" style={{ background: s.color, borderTop: s.dashed ? `2px dashed ${s.color}` : undefined, height: s.dashed ? 0 : 2 }}></span>
            {s.name}
          </span>
        ))}
      </div>
      <div ref={ref} className="relative" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 'auto' }} role="img" aria-label={`Gráfico de líneas: ${series.map((s) => s.name).join(', ')}`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} stroke="#e4e7ec" strokeWidth="1" strokeDasharray={t === 0 ? undefined : '3 4'} />
              <text x={m.l - 8} y={y(t) + 3.5} textAnchor="end" fontSize="10.5" fill="#98a2b3">{fmtShort(t)}</text>
            </g>
          ))}
          {labels.map((l, i) => (i % step === 0 ? <text key={l + i} x={x(i)} y={H - 7} textAnchor="middle" fontSize="10.5" fill="#98a2b3">{l}</text> : null))}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={m.t} y2={m.t + ih} stroke="#98a2b3" strokeWidth="1" />}
          {series.map((s) => (
            <polyline key={s.name} points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} fill="none" stroke={s.color} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dashed ? '5 4' : undefined} />
          ))}
          {hover !== null && series.map((s) => <circle key={s.name} cx={x(hover)} cy={y(s.values[hover])} r="4.5" fill={s.color} stroke="#fff" strokeWidth="2" />)}
        </svg>
        {hover !== null && (
          <div
            className="absolute z-10 pointer-events-none rounded-xl bg-slate-900 text-white text-[11px] px-3 py-2 shadow-lg"
            style={{ left: `${(x(hover) / W) * 100}%`, top: 0, transform: `translateX(${hover > labels.length / 2 ? '-105%' : '8%'})` }}
          >
            <div className="font-bold mb-1">Semana del {labels[hover]}</div>
            {series.map((s) => (
              <div key={s.name} className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ background: s.color }}></span>
                <span className="text-slate-300">{s.name}</span>
                <span className="ml-auto font-bold tabular-nums pl-3">{Math.round(s.values[hover]).toLocaleString('es-CO')} {unit}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
