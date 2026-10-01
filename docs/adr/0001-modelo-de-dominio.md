# ADR 0001 — Modelo de dominio de Ramo (Fase 1)

**Estado:** propuesto, pendiente de validar con Diana y Miguel · **Fecha:** 2026-10-01 · **Código:** `packages/domain`

## Decisiones
1. **La línea es una entidad propia.** SAP solo conoce puestos de trabajo; Ramo planifica por línea completa. Cada SKU se amarra a su línea con el equivalente al "perfil general" de SAP (`Sku.lineId`).
2. **Tripulación como entidad.** Varias líneas pueden compartirla (Barras/Mini, Maicitos/Tostadas). La regla de capacidad compartida se implementa en el motor (Fase 2); aquí solo se modela la relación.
3. **Dos unidades por SKU.** Comercial (caja) y productiva (u o kg, según el ritmo de la línea), más `kgPerCommercial` y `costPerCommercial` para el selector de unidad de medida (costo, unidades comerciales, toneladas) que pidió Diana.
4. **Tres flujos de demanda** (`CEDI`, `HARD_DISCOUNT`, `EXPORT`). HD y Exportaciones son make-to-order y no pasan por el DRP (`MAKE_TO_ORDER_FLOWS`).
5. **Calendario por línea como reglas + excepciones** (días hábiles, horas base y excepciones: festivo, mantenimiento, parada de planta, turno extendido), no una grilla día a día. Las horas netas se calcularán en el motor.
6. **Versiones de plan** (`PBO_MONTHLY`, `WEEKLY_N1`, `CRP_PROPOSAL`, `MPS_FINAL`) con `basedOn`, para representar el ciclo Miguel ↔ Daniel sin sobrescribir.
7. **Building blocks** con motivo, autor y rol obligatorios (la validación rechaza los que no los tengan).
8. **Semana = lunes** (`weekStart`), validado.
9. **Validación sin excepciones:** `validateDataset` devuelve la lista de problemas con código, ruta y mensaje, para poder mostrarlos al cargar archivos reales (Fase 3).

## Fuera de esta fase
Cálculo de capacidad, neto de demanda, saturación (Fase 2); lectura de las bases SAP (Fase 3); modelo estadístico (Fase 4).

## Preguntas abiertas (para Diana y Miguel)
1. **Qué significa "compartir tripulación" en capacidad.** En el ejemplo de Miguel (Barras al 37 % sobre capacidad, que baja a 7 % al sumar Choco Mini), ¿las horas se agrupan (pool) o las líneas son excluyentes en el tiempo? Esto cambia la fórmula de saturación; se define en la sesión de la Fase 2.
2. **Granularidad del calendario:** ¿turnos de 8 h con tripulación distinta, o horas por línea y día es suficiente?
3. **Secuencia de producción:** ¿se modela en el dominio (orden de SKUs dentro de la semana, cambios de formato) o queda como ajuste manual?
4. **Código de material y otros atributos de `Sku`:** ¿qué campos reales de SAP hay que traer además de perfil general? (ver `mapeo-sap.md`)
5. **Frecuencias de distribución, canastas y espacio** (insumos de Daniel): no están modelados todavía; entran con el MPS final.
6. **Stock de seguridad dinámico y lead times dinámicos:** se modelan en Fases 5 y 7.

## Consecuencias
- Los datos sintéticos (`data/synthetic/dataset.json`, generado con `npm run synthetic`) usan nombres y códigos ficticios con el sufijo "(sint.)"; solo imitan los órdenes de magnitud vistos en reuniones (ritmos de ~29.000 u/h, ~70 kg/h, ~620 kg/h).
- Barras queda sobrecargada a propósito (≈110 % de las 80 h nominales) para ejercitar la Fase 2.
