export type ProcessStep = 'summary' | 'sop' | 'drp' | 'mps' | 'crp' | 'mrp' | 'data' | 'ai' | 'release';

/** Título de cada pantalla (migas de pan del encabezado). */
export const STEP_TITLES: Record<ProcessStep, string> = {
  summary: 'Resumen del plan',
  sop: 'Demanda',
  drp: 'Distribución (DRP)',
  mps: 'MPS final',
  crp: 'Capacidad (CRP)',
  mrp: 'Materiales (MRP)',
  data: 'Datos SAP',
  ai: 'Recomendaciones',
  release: 'Salida a SAP',
};
