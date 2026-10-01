import { Sku } from './types';

export type MeasureView = 'commercial_units' | 'productive_units' | 'tons' | 'cost';

/** Convierte una cantidad comercial a la vista pedida (selector de unidad de medida del tablero). */
export function convertCommercialQty(sku: Sku, commercialQty: number, view: MeasureView): number {
  switch (view) {
    case 'commercial_units':
      return commercialQty;
    case 'productive_units':
      return toProductiveQty(sku, commercialQty);
    case 'tons':
      return (commercialQty * sku.kgPerCommercial) / 1000;
    case 'cost':
      return commercialQty * sku.costPerCommercial;
  }
}

/** Unidades productivas (u o kg, según la línea) que exige una cantidad comercial. */
export function toProductiveQty(sku: Sku, commercialQty: number): number {
  return commercialQty * sku.productiveUnitsPerCommercial;
}
