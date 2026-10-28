# ADR 0010 — Programación diaria (esquemas de producción)

**Estado:** implementado con datos sintéticos (fases 1 y 2 de la programación diaria). Los supuestos de abajo se validan con Producción · **Fecha:** 2026-10-28
**Código:** `packages/domain` (`ProductionTemplate`, `TemplateOverride`, `DailyAdjustment`) · `packages/engine/src/daily.ts` (+ `daily.test.ts`) · `apps/web/src/components/ramo/DailyView.tsx` · plantillas de ejemplo en `scripts/generate-synthetic.mjs`

## Origen
En la reunión de presentación del demo, Producción explicó que el reto real de la programación es poder cambiar con facilidad la secuencia y las plantillas de tripulación y ver las alertas al instante, comparando la necesidad con la capacidad **diaria**. Demanda envió una diapositiva ("Esquemas de Producción") con tres esquemas y sus requisitos: una línea con dos presentaciones que se reparten la capacidad (días de lunes a sábado), tres líneas que comparten una plantilla y rotan por día (2 días cada una), y una línea que alterna sabores por día.

## Qué se implementó
1. **Plantilla semanal** por línea o grupo de líneas con tripulación compartida: qué productos se hacen cada día (1 = lunes … 7 = domingo), turnos por día, horas por turno y horas de cambio de producto (aseo).
2. **Cambios de plantilla** (`TemplateOverride`) con alcance "solo esa semana" o "desde esa semana en adelante", con motivo y autor. El de la semana manda sobre el "desde"; entre iguales gana el más reciente.
3. **Motor de programación diaria** (`buildDailySchedule`): baja el plan semanal del MPS a días y calcula, por línea y día, cajas, horas que pide, horas disponibles, saturación y horas que faltan. Alertas: día sobre capacidad, producto sin día de producción, producto fuera de plantilla y tripulación en dos líneas el mismo día.
4. **Dos reglas de reparto de la semana entre los días de producción** del producto: `EVEN` (proporcional a las horas de cada día; si varios productos de la línea comparten un día, las horas se reparten entre ellos) y `COVER` (cada día de producción cubre la demanda hasta la próxima producción; con lunes y miércoles, 2 y 5 días).
5. **Calendario:** las horas de un día son turnos × horas por turno; un festivo o parada de 0 h cierra el día (la producción pasa a los demás días del producto), una parada parcial las limita y un turno extendido suma las horas extra del calendario de la línea.
6. **Optimizador diario** (`suggestDailyBalance`): para cada día sobre capacidad pasa producción a otro día de la misma semana con holgura (hasta 98 %): primero un día en que el producto ya se produce, luego un día libre de la tripulación; el anterior más cercano primero. El resto queda como horas extra. Es una sugerencia que se aplica como ajustes por día.
7. **Ajustes por día** (`DailyAdjustment`): mover cajas de un día a otro a mano, con motivo y autor.
8. **Pantalla "Programación diaria"**: mapa de las 13 semanas, un tablero lunes a domingo por plantilla (como la tabla de Demanda), edición de la plantilla con vista previa en vivo, optimizador, movimiento manual y lista de cambios vigentes.
9. **Gobernanza:** las secciones `templateOverrides` y `dailyAdjustments` del espacio de trabajo son de Producción (`capacity.edit`). Una sección ausente y una vacía cuentan como lo mismo para que un espacio guardado antes de que existieran no bloquee a otros roles.

## Verificación
`daily.test.ts` (36 pruebas) con valores calculados a mano (reparto parejo y por cobertura, festivos, paradas, turnos extendidos, cambio de producto, conflicto de tripulación, precedencia de cambios, ajustes, optimizador) y comprobaciones sobre el dataset sintético. Se hicieron pruebas de mutación de once reglas (envoltura de la cobertura, reparto sin horas, cambio de producto siempre, turno extendido ignorado, precedencia de cambios, tope del 98 %, tripulación ocupada ignorada, orden de preferencia del optimizador, festivo contado como día, alerta de conflicto apagada y reparto del día compartido). La del orden de preferencia no se detectaba al principio (la prueba no tenía un día nuevo disponible) y se corrigió.

## Supuestos a validar con Producción
- **"Única" frente a "Compartida":** se interpreta que "compartida" es una tripulación que se turna entre líneas (una por día) y "única" una línea con su propia tripulación.
- **Capacidad del día** = turnos × 8 h; los turnos de ejemplo (2 o 3) y los tiempos de cambio (1 a 1,5 h) son inventados. El CRP semanal agrupado supone que las líneas de una tripulación compartida corren en paralelo; con una plantilla rotativa son una a la vez y la capacidad real es menor (la pantalla muestra las dos cifras).
- **Reparto de la semana entre días:** el plan del MPS es semanal; no se conoce la demanda por día. `EVEN` es la regla por defecto; `COVER` supone demanda pareja los 7 días.
- Unidad y x5 (o dos productos de una línea) compiten por las mismas horas del día; no se modelan lotes mínimos, vida útil ni secuencias prohibidas entre sabores (solo el tiempo de cambio).
- El optimizador es voraz y no compara costos de horas extra frente a inventario; mover producción a un día anterior adelanta el consumo de materiales.

## Pendiente (fases siguientes)
- Que la saturación semanal del CRP salga de este cálculo diario y que el consumo diario de materiales use la secuencia real.
- Paso de **confirmación de plantas** por Producción (lo que sí pueden fabricar, con trazabilidad y seguimiento contra lo entregado).
- Datos reales de plantillas, turnos, restricciones por sabor, aseos y ritmos por formato (el Excel de Demanda y las respuestas de Producción).
