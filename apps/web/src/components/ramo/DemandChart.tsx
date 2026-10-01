import React from 'react';
import { fmtInt, weekLabel } from '../../ramo/format';

interface Props {
  histWeeks: string[];
  histValues: number[];
  fcWeeks: string[];
  fcValues: number[];
  /** Banda p10–p90; solo tiene sentido para un SKU (no es aditiva). */
  low?: number[];
  high?: number[];
  /** Consenso (pronóstico + building blocks); se dibuja si difiere del pronóstico. */
  consensus?: number[];
  unitLabel: string;
}

const W = 800;
const H = 240;
const PAD = { l: 56, r: 12, t: 12, b: 28 };

/** Historia reciente, pronóstico y consenso en un gráfico SVG sin dependencias. */
export function DemandChart({ histWeeks, histValues, fcWeeks, fcValues, low, high, consensus, unitLabel }: Props) {
  const all = [...histValues, ...fcValues, ...(high ?? []), ...(consensus ?? [])];
  const max = Math.max(1, ...all) * 1.05;
  const n = histWeeks.length + fcWeeks.length;
  const x = (i: number) => PAD.l + (i / Math.max(1, n - 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b);
  const path = (vals: number[], offset: number) => vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i + offset).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const off = histWeeks.length;
  const differs = consensus && consensus.some((c, i) => Math.round(c) !== Math.round(fcValues[i]));

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const labelAt = [...histWeeks, ...fcWeeks].map((w, i) => ({ w, i })).filter(({ i }) => i % 13 === 0);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Historia y pronóstico semanal (${unitLabel})`} className="w-full h-auto">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="rgba(15,23,42,0.08)" />
          <text x={PAD.l - 6} y={y(t) + 3} textAnchor="end" fontSize="9" fill="#64748b" fontFamily="monospace">{fmtInt(t)}</text>
        </g>
      ))}
      {labelAt.map(({ w, i }) => (
        <text key={w} x={x(i)} y={H - 8} textAnchor="middle" fontSize="9" fill="#64748b" fontFamily="monospace">{weekLabel(w)}</text>
      ))}
      <line x1={x(off - 0.5)} x2={x(off - 0.5)} y1={PAD.t} y2={H - PAD.b} stroke="rgba(15,23,42,0.25)" strokeDasharray="3 3" />
      <text x={x(off - 0.5) + 4} y={PAD.t + 9} fontSize="9" fill="#64748b">pronóstico →</text>

      {low && high && (
        <path
          d={`${path(high, off)} ${low.map((v, i) => `L${x(fcValues.length - 1 - i + off).toFixed(1)},${y(low[fcValues.length - 1 - i]).toFixed(1)}`).join(' ')} Z`}
          fill="#DDCBF5"
          opacity="0.55"
        />
      )}
      <path d={path(histValues, 0)} fill="none" stroke="#0f172a" strokeWidth="1.6" />
      <path d={path(fcValues, off)} fill="none" stroke="#7c3aed" strokeWidth="2" strokeDasharray="5 3" />
      {differs && <path d={path(consensus!, off)} fill="none" stroke="#c2410c" strokeWidth="2" />}
    </svg>
  );
}
