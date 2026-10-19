# ADR 0009 — Asistentes de IA/ML en las pantallas

**Estado:** implementado con datos sintéticos. Ningún asistente se ha validado con datos reales de Ramo · **Fecha:** 2026-10-19
**Código:** `packages/engine/src/{demandNudges,stockoutRisk,rebalance,supplySim}.ts` (+ `ai.test.ts`) · `apps/web/src/components/ramo/ai.tsx` · estado en `apps/web/src/ramo/store.tsx`

## Principio
IA/ML donde hay incertidumbre, un patrón que se puede aprender o muchas combinaciones que explorar; reglas y optimización donde hay restricciones duras. **Todo asistente sugiere, muestra su evidencia y una persona acepta o descarta**: nada se aplica solo ni escribe en SAP. Cada uno lleva la marca "Asistente · método" para que no se confunda con un modelo de lenguaje. **No hay ningún LLM** en la app (Ramo no lo ha autorizado).

## Qué se agregó
| Pantalla | Asistente | Método | Qué hace |
|---|---|---|---|
| Demanda | Ajustes sugeridos | Estadística | Si el pronóstico a 1 semana se equivocó siempre hacia el mismo lado (sesgo ≥ 3 %, ≥ 60 % del error en un solo sentido, ≥ 8 orígenes), propone un building block de corrección (tope 12 % del nivel). Se acepta con el nombre de quien decide; la evidencia queda como motivo |
| Distribución | Riesgo de quiebre | Estadística | P(demanda acumulada > inventario proyectado) dentro del plazo congelado, con σ del pronóstico × √participación del punto × √semanas. Errores normales e independientes |
| Capacidad y MPS | Optimizador | Optimización (voraz) | Por cada tripulación-semana sobre capacidad, adelanta producción a las ≤ 3 semanas anteriores con holgura (la más cercana primero, hasta 98 %), sin tocar lo bajo pedido; lo que no cabe se propone como horas extra. Miguel decide las horas extra; Daniel aplica los movimientos como ajustes al MPS |
| Materiales | Simulación | Monte Carlo | 400 escenarios: el consumo semanal varía con el CV del pronóstico y las entregas se atrasan con retrasos reales del proveedor principal (retraso = recibido − prometido). Da P(ruptura antes de que llegue un pedido hecho hoy), rango del día de ruptura y plazo real probable |
| Resumen | Resumen de la semana | Reglas | Texto armado con las cifras anteriores; listo para que un LLM lo redacte si Ramo lo autoriza |
| Resumen | Mapa de IA/ML | — | Qué está activo y qué falta (datos o autorización) |

## Verificación
`ai.test.ts` (26 pruebas) incluye valores calculados a mano (Φ, acumulación de √semanas), conservación de cajas, que mover producción no cree sobrecarga nueva y que el CRP coincida tras aplicar la sugerencia completa. Se hicieron pruebas de mutación: se rompió a propósito el llenado de semanas receptoras (500 %), el signo del ajuste, la acumulación de la incertidumbre y el uso de los retrasos de entrega, y las pruebas fallaron en los cuatro casos (dos de esas pruebas se agregaron porque la primera versión no detectaba la mutación).

## Límites que hay que conocer
- **Son aproximaciones declaradas, no modelos validados.** Con 104 semanas por producto y datos sintéticos no se puede afirmar utilidad real; hay que medirla con los datos de Ramo (¿cuántas sugerencias se aceptan?, ¿el riesgo estimado coincide con lo ocurrido?).
- **Sugerencia de sesgo:** no distingue un cambio de nivel real (nuevo cliente) de un error del modelo; por eso solo se propone y la persona decide. No usa promociones ni calendario.
- **Riesgo de quiebre:** el inventario por punto es el supuesto de ejemplo (hasta tener MD04/MD5A); si ese reparto cambia, cambia el riesgo.
- **Optimizador:** voraz, no óptimo. No compara el costo de la hora extra con el de mantener inventario, no mira canasta ni rotación, y en modo "líneas independientes" reparte las horas extra de la tripulación por igual entre sus líneas. Adelantar producción sube el inventario y no valida vida útil del producto (dato que no tenemos).
- **Simulación:** el CV del consumo es el del pronóstico de los productos que usan el material (media ponderada, sin compensación entre productos: conservadora); los retrasos se muestrean del historial sin considerar cantidad ni mes; con pocas órdenes por proveedor la estimación es ruidosa (se muestra cuántas órdenes se usaron). La probabilidad "dentro de 28 días" se publica porque "dentro de las 13 semanas" da ~100 % para casi todo si nunca se repone.
- La aceptación de un ajuste de demanda y los movimientos aplicados quedan como building blocks y ajustes del MPS (con su autor y motivo); los asistentes en sí no guardan estado en el servidor (lo descartado vuelve a aparecer al recargar).

## Siguientes pasos (necesitan datos o autorización)
1. **Pronóstico con variables externas** (promociones, festivos, precio): calendario comercial de Diana. Es el candidato natural para compararlo en el mismo backtest con el modelo que explore la pista de AWS SageMaker (solo Demanda).
2. **Demanda censurada por quiebres:** corregir las ventas de semanas con producto agotado (inventario o quiebres históricos).
3. **Ritmo real de línea y paradas:** producción real por hora y registro de paradas (Miguel) para reemplazar el ritmo estándar.
4. **Rendimiento y merma reales** de la lista de materiales (consumo real por orden).
5. **Riesgo de incumplimiento por proveedor** (clasificación) con más historial y causas de retraso.
6. **Aprendizaje de las decisiones humanas:** ya se guardan aprobaciones y rechazos con motivo; con meses de uso se puede ordenar y silenciar lo que casi nunca se acepta.
7. **LLM (si Ramo lo autoriza):** explicar el plan en lenguaje natural llamando al motor como herramienta (nunca calculando), redactar correos a proveedores y resumir qué cambió entre publicaciones.
