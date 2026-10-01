import { IngestTexts } from '@ramo/ingest';
import limpioStock from '../../../../data/synthetic/sap/limpio/inventarios_stock.csv?raw';
import limpioMov from '../../../../data/synthetic/sap/limpio/inventarios_movimientos.csv?raw';
import limpioSup from '../../../../data/synthetic/sap/limpio/abastecimiento.csv?raw';
import limpioDisp from '../../../../data/synthetic/sap/limpio/despachos.csv?raw';
import sucioStock from '../../../../data/synthetic/sap/sucio/inventarios_stock.csv?raw';
import sucioMov from '../../../../data/synthetic/sap/sucio/inventarios_movimientos.csv?raw';
import sucioSup from '../../../../data/synthetic/sap/sucio/abastecimiento.csv?raw';
import limpioHist from '../../../../data/synthetic/sap/limpio/historico_demanda.csv?raw';
import sucioHist from '../../../../data/synthetic/sap/sucio/historico_demanda.csv?raw';
import sucioDisp from '../../../../data/synthetic/sap/sucio/despachos.csv?raw';

/** Archivos sintéticos con la forma supuesta de las bases del lunes (ver docs/formatos-bases-sap.md). */
export const SAMPLE_LIMPIO: IngestTexts = { stock: limpioStock, movimientos: limpioMov, abastecimiento: limpioSup, despachos: limpioDisp };
export const SAMPLE_SUCIO: IngestTexts = { stock: sucioStock, movimientos: sucioMov, abastecimiento: sucioSup, despachos: sucioDisp };

/** Histórico semanal de demanda (2 años) con el pronóstico que emitió el proceso vigente. */
export const SAMPLE_HISTORY_LIMPIO: string = limpioHist;
export const SAMPLE_HISTORY_SUCIO: string = sucioHist;
