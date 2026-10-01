# ADR 0003 — Ingesta de las bases SAP (Fase 3)

**Estado:** implementado con archivos sintéticos; formatos y fórmula de disponibilidad pendientes de validar con Miguel · **Fecha:** 2026-10-01
**Código:** `packages/ingest` · `apps/web/src/components/ramo/DataView.tsx` · `scripts/generate-synthetic-sap.mjs`

## Decisiones
1. **Se lee en el navegador, sin servidor.** Los CSV nunca salen de la máquina del usuario (los datos reales de Ramo no se versionan ni se suben). El backend llega en la Fase 8.
2. **Parseo tolerante, validación estricta.** Alias de encabezado sin tildes ni mayúsculas, separador autodetectado, decimal configurable. Cada fila defectuosa se descarta con un problema nombrado (código, línea, mensaje) en vez de abortar toda la carga. Una base se rechaza solo si falta una columna obligatoria o no queda ninguna fila válida.
3. **Línea base por SKU** (`ingestBaseline`): stock, en tránsito, pendiente de despacho, salida del mes, cobertura y disponible, todo en cajas.
4. **El plan usa el disponible de SAP** (`applyBaseline` sustituye `dataset.inventory`). Sin bases cargadas el plan sigue con el inventario sintético. El estado queda visible en la barra lateral (`SAP` / `Mock`) y en el registro del ciclo.
5. **Conciliación stock ↔ movimientos:** stock al corte menos la suma de movimientos del mes es el inventario inicial implícito; si es negativo se avisa (`IMPLIED_NEGATIVE_OPENING`).
6. **Dos juegos sintéticos** (`data/synthetic/sap/limpio` y `sucio`) con 15 defectos inyectados, usados por las pruebas y por los botones de ejemplo de la interfaz.

## Qué NO se resolvió
- Los formatos reales (ver `docs/formatos-bases-sap.md`): todo es supuesto hasta recibir los archivos de Miguel.
- La fórmula `disponible = stock + en tránsito − pendiente de despacho` es una interpretación de lo que contó Miguel; debe confirmarse.
- No se leen aún las órdenes de producción en curso (`openOrders`) desde SAP: siguen siendo las del dataset sintético.
- No hay carga por arrastre ni conexión directa a SAP; la descarga del lunes sigue siendo manual.
- La ventana horaria de la consulta Z (8 am–2 pm) y los destinos finales de la triangulación (`0060`, `CUSTOMER`) son valores por defecto configurables.

## Criterio de aceptación pendiente
Cargar las 3 bases reales de un lunes ya cerrado y que Miguel confirme que stock, en tránsito y pendiente de despacho coinciden con lo que él calcula a mano.
