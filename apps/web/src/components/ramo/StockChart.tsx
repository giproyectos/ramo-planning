import React from 'react';
import { fmtInt, weekLabel } from '../../ramo/format';

interface Props {
  dates: string[];
  stock: number[];
  receipts: number[];
  /** Inventario de seguridad (línea punteada). */
  safety: number;
  /** Plazo de entrega en días desde el corte: lo que se pida hoy llega después de esta marca. */
  leadTimeDays: number;
  ruptureIndex: number | null;
  unit: string;
}

const W = 760;
const H = 230;
const PAD = { l: 62, r: 12, t: 12, b: 26 };

/** Inventario proyectado día a día, con la marca del plazo de entrega y la fecha de ruptura. */
export function StockChart({ dates, stock, receipts, safety, leadTimeDays, ruptureIndex, unit }: Props) {
  const n = dates.length;
  const max = Math.max(1, ...stock, safety) * 1.08;
  // El faltante muy profundo no debe aplastar la parte útil del gráfico: se recorta a la mitad del inventario máximo.
  const min = Math.max(Math.min(0, ...stock) * 1.1, -0.5 * max);
  const clip = (v: number) => Math.max(v, min);
  const x = (i: number) => PAD.l + (i / Math.max(1, n - 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (clip(v) - min) / (max - min)) * (H - PAD.t - PAD.b);
  const line = stock.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const below = stock.map((v, i) => ({ v, i })).filter(({ v }) => v < 0);
  const ticks = [0, 0.5, 1].map((f) => min + f * (max - min));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Inventario proyectado (${unit})`} className="w-full h-auto">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="rgba(15,23,42,0.08)" />
          <text x={PAD.l - 6} y={y(t) + 3} textAnchor="end" fontSize="9" fill="#64748b" fontFamily="monospace">{fmtInt(t)}</text>
        </g>
      ))}
      <line x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} stroke="#0f172a" strokeWidth="1" />
      {safety > 0 && <line x1={PAD.l} x2={W - PAD.r} y1={y(safety)} y2={y(safety)} stroke="#c2410c" strokeDasharray="4 3" opacity="0.7" />}
      {dates.map((d, i) => (i % 14 === 0 ? <text key={d} x={x(i)} y={H - 8} textAnchor="middle" fontSize="9" fill="#64748b" fontFamily="monospace">{weekLabel(d)}</text> : null))}
      {leadTimeDays < n && (
        <g>
          <line x1={x(leadTimeDays)} x2={x(leadTimeDays)} y1={PAD.t} y2={H - PAD.b} stroke="#7c3aed" strokeDasharray="3 3" />
          <text x={x(leadTimeDays) + 4} y={PAD.t + 9} fontSize="9" fill="#7c3aed">un pedido de hoy llega aquí</text>
        </g>
      )}
      {below.length > 0 && (
        <path d={`M${x(below[0].i)},${y(0)} ${below.map(({ v, i }) => `L${x(i)},${y(v)}`).join(' ')} L${x(below[below.length - 1].i)},${y(0)} Z`} fill="#FFA27D" opacity="0.6" />
      )}
      <path d={line} fill="none" stroke="#0f172a" strokeWidth="1.8" />
      {receipts.map((r, i) => (r > 0 ? <circle key={i} cx={x(i)} cy={y(stock[i])} r="3.5" fill="#059669"><title>{`Llega orden: +${fmtInt(r)} ${unit}`}</title></circle> : null))}
      {ruptureIndex !== null && (
        <g>
          <line x1={x(ruptureIndex)} x2={x(ruptureIndex)} y1={PAD.t} y2={H - PAD.b} stroke="#c2410c" />
          <text x={x(ruptureIndex) - 4} y={PAD.t + 21} textAnchor="end" fontSize="9" fill="#c2410c" fontWeight="bold">ruptura</text>
        </g>
      )}
    </svg>
  );
}
