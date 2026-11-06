export type ProcessStep = 'summary' | 'mps' | 'crp' | 'plants' | 'daily' | 'release' | 'data';

/** Título de cada pantalla (migas de pan del encabezado). */
export const STEP_TITLES: Record<ProcessStep, string> = {
  summary: 'Resumen',
  crp: 'Capacidad (CRP)',
  mps: 'MPS final',
  plants: 'Confirmación de plantas',
  daily: 'Programación diaria',
  release: 'Plan oficial',
  data: 'Datos y esquemas',
};
