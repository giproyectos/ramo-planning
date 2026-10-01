# ADR 0004 — Demanda: línea base estadística, PBO/N+1 y archivo para SAP (Fase 4)

**Estado:** implementado con datos sintéticos. Ninguna conclusión de exactitud vale hasta correrlo con el histórico real de Ramo · **Fecha:** 2026-10-01
**Código:** `packages/engine/src/forecast.ts`, `demandPlan.ts` · `packages/ingest/src/history.ts` · `packages/sap-out/src/md61.ts` · `apps/web/src/components/ramo/DemandView.tsx`

## Qué se implementó
1. **Histórico de demanda** (`parseDemandHistory`): venta semanal por SKU y flujo, con el pronóstico que emitió el proceso vigente (si viene). Mismas reglas de validación que las bases SAP (recorte de 2 años, lunes, duplicados, unidades) más huecos en la serie (`MISSING_WEEKS`, se interpolan) e historia corta (`SHORT_HISTORY`).
2. **Pronóstico estadístico** (`forecastSku`, sin dependencias): promedio móvil 4 sem., suavizamiento exponencial, estacional (mismo periodo del año anterior, ajustado por nivel) y Holt-Winters multiplicativo. Se elige un modelo por SKU con un **backtest de origen móvil** y se entrega intervalo p10–p90.
3. **PBO y N+1 como versiones distintas** (`withForecastVersions`): el PBO mensual se corre 4 semanas antes (menos historia, más distancia) y el N+1 semanal con todo el histórico, basado en el PBO. Hard Discount y Exportaciones no se pronostican: se copian de las versiones vigentes (son pedidos).
4. **Building blocks** sobre el N+1: alcance SKU, familia, unidad de negocio o todos; una semana o todas; con motivo, autor y rol obligatorios; reparto proporcional al pronóstico; sin cantidades negativas.
5. **Vista Demanda:** filtros tipo BI (unidad de negocio, marca, familia, SKU), selector de unidad de medida (cajas, unidades productivas, toneladas, costo), gráfico histórico + pronóstico + banda + consenso, tabla PBO vs N+1 vs consenso, exactitud por SKU contra el proceso vigente, y registro de building blocks.
6. **Salida a SAP** (`buildMd61`): archivo de demanda semanal CEDI para MD61/LSMW (una fila por SKU y semana), para **revisión y descarga**; la app no escribe en SAP.
7. **Integración:** con "Usar este plan de demanda" encendido (por defecto), el consenso alimenta el neto del MPS y el CRP. Verificado: +5.000 cajas en Ponqués el 12 oct se repartieron +2.968 / +2.032 entre sus dos SKUs hasta el MPS.

## Decisiones de diseño que importan
- **El modelo se elige al horizonte que se usa.** El backtest evalúa de 1 a 13 semanas (17 para el PBO), no a 1 sola: un modelo plano parece bueno a 1 semana pero falla al entrar en el pico de diciembre.
- **Orígenes repartidos en el año, no las últimas 12 semanas.** Un backtest sobre un tramo plano reciente elegía casi siempre el suavizamiento simple, que proyecta plano. Hoy se usan orígenes cada 4 semanas, con al menos 60 semanas de entrenamiento, para que cubran diciembre.
- **Prior estacional (supuesto de negocio):** se prefiere el mejor modelo estacional si su error no supera al del mejor en más de 10 %. Los productos de Ramo tienen temporada y el ruido semanal tapa la señal en un backtest corto. **Es un parámetro a calibrar con histórico real** (`seasonalTolerance`); con datos sintéticos que yo mismo generé con estacionalidad no se puede validar.
- **El intervalo nunca se estrecha** con el horizonte (se usa el máximo acumulado de la dispersión observada).
- **Las comparaciones contra el proceso vigente usan una ventana distinta de la de selección:** últimas 12 semanas a 1 semana vista, que es lo comparable con un Excel que pronostica la semana siguiente.

## Resultado sobre datos sintéticos (para entender el comportamiento, no como evidencia)
En el ejemplo, el pronóstico mejora al "proceso vigente" en 7 de 8 SKUs (error de ~5–7 % contra ~8–12 %), pero **ese proceso lo definí yo** (la venta de la semana anterior con sesgo y ruido): es una referencia cualquiera, no el Excel de Diana. En el ejemplo, 3 de 8 SKUs siguen con un modelo plano (SES) aun con el prior estacional, de modo que el pico de diciembre se captura de forma parcial. La vista muestra un veredicto "Peor" cuando corresponde (Maicitos).

## Qué NO se resolvió
- **Evidencia real:** hay que correrlo con el histórico y los pronósticos reales de Ramo (por producto, no solo "Gansito") para saber si iguala o supera al proceso actual. El criterio de aceptación de la Fase 4 sigue abierto.
- **ML más pesado** (LightGBM, redes) y **demand sensing** con señales externas: sin datos reales no se justifica; el diseño deja el punto de extensión (`ModelId`, `forecastSku`).
- **Efectos de calendario y promociones** (festivos, Día de la Madre, etc.) y **niveles jerárquicos** (reconciliación familia → SKU → canal): hoy se pronostica cada SKU por separado.
- **Intervalos agregados:** la banda p10–p90 no es aditiva, por eso solo se muestra para un SKU.
- **SKUs nuevos** (sin historia) o con menos de 60 semanas: solo reciben modelos simples y un aviso.
- **Solo flujo CEDI:** Hard Discount y Exportaciones son pedidos conocidos, no pronóstico.
- **Las "dos demandas":** el N+1 semanal es la que alimenta el DRP (confirmado por Diana); el DRP aún no existe en esta app (Fase 5).
- **Formato MD61:** columnas, tipo de requerimiento (`LSF`), versión (`00`) y unidad (`CJ`) son supuestos (ver `docs/formatos-bases-sap.md`).
- **Persistencia:** los building blocks viven en memoria del navegador (Fase 8).
