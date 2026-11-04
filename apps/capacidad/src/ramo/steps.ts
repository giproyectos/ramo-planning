export type ProcessStep = 'summary' | 'mps' | 'crp' | 'daily';

/** Título de cada pantalla (migas de pan del encabezado). */
export const STEP_TITLES: Record<ProcessStep, string> = {
  summary: 'Resumen',
  crp: 'Capacidad (CRP)',
  mps: 'MPS final',
  daily: 'Mesa de programación',
};
