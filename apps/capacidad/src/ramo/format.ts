const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** '2026-10-12' → '12 oct' */
export function weekLabel(weekStart: string): string {
  const [, m, d] = weekStart.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

export const fmtInt = (n: number): string => Math.round(n).toLocaleString('es-CO');
export const fmtDec = (n: number, digits = 1): string => n.toLocaleString('es-CO', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const MEASURE_LABELS = {
  commercial_units: 'Cajas',
  productive_units: 'Unid. productivas (u / kg)',
  tons: 'Toneladas',
  cost: 'Costo (COP)',
} as const;

export const EXCEPTION_LABELS: Record<string, string> = {
  HOLIDAY: 'Festivo',
  MAINTENANCE: 'Mantenimiento',
  PLANT_STOP: 'Parada de planta',
  EXTENDED: 'Turno extendido',
};
