# ADR 0002 — MPS y CRP como ciclo de dos actores (Fase 2)

**Estado:** implementado con datos sintéticos; supuestos pendientes de validar con Miguel y Daniel · **Fecha:** 2026-10-01
**Código:** `packages/engine` (motor) · `apps/web/src/components/ramo` (vistas) · `apps/web/src/ramo/store.tsx` (estado del ciclo)

## Qué se implementó
1. **Neto de demanda (MPS puro)** — `computeNetProduction`: `neto = max(0, CEDI − (inventario + órdenes en curso)) + make-to-order`, SKU por SKU y semana a semana, con arrastre de sobrante. Hard Discount y Exportaciones **no se netean** (entran completos).
2. **Building blocks** — `applyBuildingBlocks`: suman un delta por semana a los SKUs de su alcance (SKU, familia, unidad de negocio o todos), repartido en proporción; nunca dejan negativos. `demandForHorizon`: el N+1 semanal manda donde existe y el PBO mensual completa el resto del horizonte.
3. **CRP** — `computeCrp`: horas requeridas = unidades productivas ÷ ritmo; horas disponibles del calendario (días hábiles, festivos, mantenimiento, paradas); saturación por línea y por tripulación; `excessHours` tras las horas extra decididas. Umbrales: > 100 % amarillo, > 110 % naranja (igual que demad-app).
4. **Ciclo** — `snapshotCycle` + etapas `DRAFT → SENT_TO_MPS → MPS_FINAL → FINAL_ALERTS`. Miguel decide horas extra y envía; Daniel ajusta el neto con motivo y autor, y cierra el MPS final; Miguel recarga y emite las alertas finales. Todo movimiento queda en un registro (quién, qué, por qué).
5. **Vistas** — CRP (Miguel): mapa de calor tripulación × semana con el detalle por línea y SKU, calendario y decisión de horas extra. MPS final (Daniel): neto por SKU × semana con selector de unidad (cajas, unidades productivas, toneladas, costo), "rojos" de capacidad, ajustes y cierre.

## Supuesto provisional: tripulación agrupada
Con tripulación compartida, el exceso es `max(0, Σ horas requeridas − Σ horas disponibles)` de las líneas de la tripulación (POOLED). Reproduce el patrón del ejemplo de Miguel (Barras muy por encima, que baja al sumar Choco Mini). El modo `INDEPENDENT` (cada línea responde sola) queda disponible con un conmutador para comparar. **Pendiente de confirmar con Miguel** (ADR 0001, pregunta 1).

## Límites conocidos
- El estado del ciclo vive en memoria del navegador (se pierde al recargar). La persistencia y los roles llegan en la Fase 8.
- Los ajustes de Daniel suman o restan sobre una semana; no hay aún "mover a otra semana" en un solo paso.
- No se modelan secuencia de producción, cambios de formato ni paradas de planta avisadas con poca antelación más allá del calendario.
- Riesgos de distribución (canasta, espacio, rotación) y frecuencias de distribución de Daniel: pendientes (Fase 5).
- Las horas extra se asignan a la tripulación, no a una línea; no se valida el máximo de horas por día ni la regla de festivos.
- Los módulos S&OP, DRP y MRP de la interfaz siguen siendo la demo genérica (placeholder).

## Criterio de aceptación pendiente
Reproducir con los Excel reales de Diana y Miguel (una semana ya cerrada) los mismos % de saturación y horas extra. Hoy solo se verificó con datos sintéticos y casos calculados a mano (17 pruebas del motor).
