# ADR 0007 — Capa de recomendaciones sobre el MRP ("IA") (Fase 7)

**Estado:** implementada con datos sintéticos. **No usa ningún modelo de lenguaje**; es estadística y reglas determinísticas con explicación de cada cifra · **Fecha:** 2026-10-01
**Código:** `packages/engine/src/insights.ts`, `recommendations.ts` · `packages/domain` (`OrderHistoryRow`, `PurchaseRequisition`) · `apps/web/src/components/ramo/AiView.tsx`

## Qué significa "IA" en esta fase (y qué no)
El plan hablaba de agentes con LLM. Aquí **no se conectó ningún modelo de lenguaje**, por dos razones: la app es solo frontend (no hay un lugar seguro para una llave de API) y enviar inventarios, órdenes y precios de Ramo a un servicio externo es una decisión de datos que hay que tomar con ellos, no asumir. Lo que sí se entrega es la parte que aporta valor y se puede auditar: estadística robusta (mediana, MAD, percentiles, prorrata) y reglas, donde cada recomendación muestra **las cifras que la sustentan**. El "copiloto" es un enrutador de preguntas guiadas sobre resultados ya calculados, no genera texto libre. Si Ramo aprueba un LLM, el punto de conexión es `answerQuestion`: bastaría pasarle esas mismas cifras como contexto verificado y dejarlo solo redactar.

## Flujo de gobernanza
SAP propone (MRP) → el sistema refina (estas recomendaciones) → **el planeador aprueba, rechaza o deshace, con autor y motivo** (el rechazo exige motivo) → queda en el registro del ciclo. Nada se escribe a SAP desde la app. Aprobar un **plazo dinámico** sí cambia el plazo que usa el tablero MRP (el dato maestro de SAP no se toca); las demás aprobaciones se registran.

## Qué hace cada pieza
1. **Priorización** (`urgencyOf`): crítico si faltan menos de 5 días hasta la ruptura (regla validada con Diana), normal si hay que decidir, puede esperar si no hay riesgo cercano. Ordena las recomendaciones.
2. **Ajuste por variabilidad** (`adjustOrderForVariability`, `materialWeeklySigma`): sube el pedido sugerido en z × σ × √semanas cubiertas (confianza 95 %), con σ del error de pronóstico de cada SKU propagado a cada material por la lista de materiales (errores independientes entre SKUs), redondeado al pedido mínimo.
3. **Plazos dinámicos** (`recommendLeadTimes`): P80 del plazo real del **proveedor principal** frente al plazo fijo de SAP. Se propone subirlo si lo supera en ≥ 2 días y ≥ 10 % con ≥ 8 órdenes (bajarlo exige ≥ 12 y ≤ 70 %). Muestra el efecto en el riesgo (qué estado cambia) y qué estado tendría con el plazo real.
4. **Cuota reguladora** (`quotaCompliance`, `quotaExceptions`): compara la cantidad realmente pedida a cada proveedor con la cuota negociada (60/40) y marca la cuota "rota" con ≥ 10 puntos de desviación; y propone una **excepción justificada por riesgo de plazo** cuando el proveedor principal no llega antes de la ruptura y otro sí. Es el aporte de Diana: respetar la cuota salvo riesgo de lead time, con el ajuste manual trazado.
5. **Anomalías** (`detectOrderAnomalies`, `detectDemandSpikes`): posible duplicado sol.ped. vs orden de compra abierta (misma cantidad ±10 % y fecha ±7 días), cantidades atípicas (z robusto con MAD sobre el historial, y > 2× o < 0,3× la mediana) y semanas de venta atípicas que contaminarían el pronóstico.
6. **Consolidación** (`consolidateOrders`): junta pedidos sugeridos al mismo proveedor cuya fecha límite cae dentro de una ventana (7 días por defecto, ajustable).
7. **Órdenes tardías**: cuando una orden abierta llega después de la ruptura, la recomendación es adelantarla, no pedir más (viene del tablero de la Fase 6).
8. **Copiloto de preguntas guiadas** (`answerQuestion`): críticos, qué pedir, proveedores, cuotas, plazos, anomalías, consolidación, o un material por nombre con su explicación completa.

## Hallazgos de la verificación
- **Plazo dinámico mezclando proveedores:** el primer diseño usaba todas las órdenes del material. En el cacao mezclaba al proveedor lento (P80 42 días) con el rápido (14) y mostraba cifras contradictorias ("retraso medio 1,1 días" y "26 % puntual"). En SAP el plazo vive por proveedor y los pedidos siguen la cuota, así que ahora se usa el proveedor principal (con respaldo a todas las órdenes si tiene poca evidencia). Fue un error de diseño que el compilador y la revisión visual destaparon; quedó una prueba.
- **Mutaciones no detectadas al principio:** el percentil con rango no entero y el borde exacto de la excepción a la cuota pasaban sin que ninguna prueba fallara; se agregaron casos que las detectan.
- **Datos sintéticos mal puestos (error mío, no del código):** una solicitud "normal" de vainilla estaba fuera de lo habitual y se marcaba como anomalía (la detección era correcta); y con los datos originales ninguna excepción a la cuota era posible porque ningún proveedor llegaba antes de la ruptura. Se ajustó el ejemplo (Cacao Import 2 como proveedor regional rápido e infrautilizado, que además explica la cuota rota).
- **Consolidación:** con las fechas de este ejemplo no hay dos pedidos al mismo proveedor a menos de 7 días; con 14 aparecen las bolsas de Plásticos H. La función está probada aparte; la ventana es ajustable.

## Supuestos y límites
- **Historial de órdenes y solicitudes sintéticos** (239 órdenes, 4 solicitudes): los perfiles de puntualidad y la cuota rota están construidos para que haya qué detectar. Con datos reales se sabrá cuántas recomendaciones son útiles y cuántas ruido; hoy solo se valida la mecánica.
- **Umbrales** (5 días, 10 puntos de cuota, 8 órdenes, z de 3,5, ±10 % y ±7 días de duplicado, ventana de 7 días) son valores por defecto razonables, no calibrados con Ramo.
- **σ por material** asume errores independientes entre SKUs; con SKUs correlacionados (promociones conjuntas) subestima.
- **Resincronización del plazo con SAP:** pendiente. Si no se recarga el dato maestro, el MRP de SAP sigue con el valor fijo (hoy la aprobación solo afecta al tablero).
- **Una sola cantidad de pedido mínimo por material** y reparto de la cuota por mayor residuo en múltiplos de ese mínimo.
- **No hay aprendizaje:** las reglas no se ajustan solas con el feedback de aprobar/rechazar. Lo rechazado queda registrado con su motivo, que es el insumo para calibrarlas.
- **Persistencia:** decisiones y plazos aprobados viven en memoria del navegador (Fase 8).

## Criterio de aceptación pendiente
Correr la capa con el historial real de órdenes recibidas, las solicitudes abiertas y las cuotas vigentes de Ramo, y que Diana y el equipo de compras confirmen cuáles recomendaciones habrían sido útiles y cuáles falsas alarmas (por tipo), y a partir de ahí fijar los umbrales.
