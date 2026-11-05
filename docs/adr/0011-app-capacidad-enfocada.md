# ADR 0011 — App enfocada en capacidad (MPS, CRP y programación diaria)

**Estado:** implementada con datos sintéticos · **Fecha:** 2026-11-04
**Código:** `apps/capacidad` (la app) · `packages/engine/src/{alternatives,templateAdvisor,realCapacity}.ts` (+ `focus.test.ts`) · historial sintético en `scripts/generate-synthetic.mjs`
**Versión completa guardada en:** etiqueta `demo-completo` y `apps/web` (sin cambios).

## Decisión
Lo que se presenta a Ramo se limita al problema que pidieron: pasar del MPS a la programación de capacidad por día. `apps/capacidad` reutiliza el motor, el dominio y la gobernanza de la app completa, pero solo muestra cuatro pantallas: **Resumen, MPS, CRP y Esquemas y programación diaria**. Demanda, DRP, MRP, datos SAP, recomendaciones de compras y salida a SAP siguen en `apps/web` (que no se tocó). El store se copió completo: calcula todo, pero la app solo expone lo de capacidad.

"Plantilla" pasó a llamarse **esquema de producción** en la interfaz: según Producción es la configuración semanal (qué días se fabrica cada producto en cada línea), no la tripulación. El nombre interno de los tipos (`ProductionTemplate`) no cambió.

## Dónde entra la IA (y qué es cada cosa)
| Punto | Qué hace | Método | Estado |
|---|---|---|---|
| Alternativas semanales (`weeklyAlternatives`) | Tres formas de resolver las semanas sobre capacidad (poco inventario extra, equilibrada, sin horas extra) con costo comparable | Optimización voraz con restricciones, ejecutada con tres configuraciones | Funciona con datos de ejemplo |
| Alternativas diarias (`dailyAlternatives`) | Tres secuencias para los días en rojo (solo días de producción, usar días libres, solo horas extra) | Igual | Funciona con datos de ejemplo |
| Esquema recomendado (`recommendTemplates`) | Prueba todas las combinaciones de un producto por día (hasta 4.000) más familias de esquemas, simula cada una con el motor diario y propone las que reducen el exceso y los cambios de producto | Búsqueda exhaustiva con simulación | Funciona; necesita las reglas reales de planta |
| Confiabilidad (`crpConfidence`, `weeklyConfidence`) | Probabilidad de que una semana alcance la carga con el rendimiento real de la línea | Media encogida por línea y día de la semana, más residuos observados, con simulación de 400 semanas | **Solo el mecanismo**: el historial es sintético |

Ningún punto usa un modelo de lenguaje. Todos sugieren y una persona decide.

## Costo comparable de las alternativas
`costo = horas adelantadas × semanas de anticipación + horas extra × 3 + horas sin cubrir × 12` (en días, la anticipación se divide entre 7 y abrir un día nuevo suma 0,5). Los pesos 3 y 12 son supuestos declarados (`EXTRA_HOUR_WEIGHT`, `UNMET_HOUR_WEIGHT`) para discutir con Producción; cambiarlos puede cambiar cuál alternativa sale recomendada.

## Qué no se debe afirmar
- La confiabilidad **no es un modelo validado**: con 26 semanas de historial inventado solo demuestra la mecánica. Con el registro real de producción de Ramo se debe medir el error del estimado contra semanas que el modelo no vio antes de usarlo para decidir.
- El recomendador de esquema puede sugerir combinaciones que no se pueden ejecutar: no conoce qué sabores no pueden ir juntos ni qué días no se puede producir un producto. Se excluyen días a mano y la interfaz de restricciones se completa cuando Producción las confirme.
- Los tiempos de cambio, turnos y ritmos son de ejemplo. Los ritmos de SAP se toman como nominales.

## Pendiente
- Reglas reales de planta para el recomendador (combinaciones válidas por línea, causas que cambian el esquema).
- Historial real de producción por línea y día (y registro de paradas) para validar la confiabilidad.
- Vigencia del esquema (1, 3 o 6 meses) como dato del esquema.
- Confirmación de plantas con trazabilidad y que la capacidad semanal del CRP salga del cálculo diario.

## Rediseño de la interfaz (2026-11-04)
Las tres pantallas siguen el mismo patrón: un mapa interactivo a la izquierda, un panel a la derecha con la selección, los pendientes y lo que propone el asistente, y todo el detalle plegado. Los cambios se prueban antes de aplicarse.
- **Mesa de programación (Día a día):** borrador con deshacer y rehacer, arrastrar y soltar con aviso de capacidad mientras se arrastra, vista previa de cada propuesta al pasar el cursor y paleta de comandos (Ctrl K).
- **CRP:** mapa con dos vistas (sobre el papel y con rendimiento real) y vista previa de las alternativas sobre el mapa.
- **MPS:** mapa producto por semana con el efecto de un ajuste en la tripulación antes de registrarlo, la misma vista previa de alternativas y la lista de verificación del cierre.
- **Franja del ciclo** (`CycleBar`) con el paso actual y el botón que lo hace avanzar, compartida por CRP y MPS.
Referencias de práctica: arrastrar y soltar sobre el tablero, trabajar en una copia antes de aplicar, avisar si algo cabe durante el arrastre y mostrar la carga contra la capacidad en la misma línea de tiempo (herramientas de programación como PlanetTogether, Dynamics 365 y Oracle), y divulgación progresiva con un solo nivel de detalle.

## Funcionalidades agregadas tras revisar los requisitos (2026-11-04, tarde)
Se contrastó la app con las reuniones, la diapositiva de esquemas y las pantallas de la app completa (ver `Cobertura_Requisitos_Capacidad.md`). Se agregó:
- **Confirmación de plantas** (`packages/engine/src/plants.ts`, pantalla `PlantsView`): confirmaciones por producto y semana que solo se añaden (la vigente es la más reciente), entregas que se suman, estado (pendiente, confirmado, parcial, no puede), cobertura, faltante y cumplimiento, y marca cuando el MPS cambió después de confirmar. Secciones del espacio de trabajo `plantConfirmations` y `plantDeliveries` (permiso de capacidad). Supuestos a validar: se confirma por producto y semana, la hace Producción, lo entregado se digita.
- **Calendario editable** (`CalendarEdit`, `applyCalendarEdits`): festivos, paradas, mantenimientos, cierres y turnos extendidos hechos en la aplicación se mezclan con el calendario del conjunto de datos para todo el cálculo (CRP, MPS y diario). Sección `calendarEdits`. En la mesa pasan por el borrador.
- **Cambio de secuencia**: invertir la semana, intercambiar los días de dos productos o de dos días (botón ⇄ o arrastrando el encabezado). Opera sobre el esquema del borrador, sin tocar los turnos.
- **Vigencia y causa del esquema** (`TemplateOverride.untilWeek`, `.cause`): un cambio «desde» puede tener semana final; pasada esa semana vuelve el esquema anterior o rige otro cambio.
- **Reglas de planta** (`PlantRule`: no juntos, día prohibido, mínimo de días, tiempo de cambio por par): alertas `RULE_VIOLATION` en el cálculo diario, tiempo de cambio por par en el cálculo, restricciones y penalización (100 por violación) en el recomendador de esquema, y el balanceo diario no mueve producción a un día que las viole. Sección `plantRules`.
Pruebas: 238 en el motor (valores calculados a mano y mutación de las reglas nuevas: vigencia, calendario, cambio por par, plan cambiado, confirmación vigente, suma de entregas, penalización y regla de no juntos).

## Priorización, plan oficial, datos, neto explicado y escenarios (2026-11-04, noche)
- **Priorización** (`packages/engine/src/priority.ts`): para cada tripulación-semana sobre su capacidad recorta producción hasta que quepa, con tres reglas (RISK: se protege lo de más riesgo de quiebre; VALUE: lo de mayor costo por caja × cajas; EVEN: parejo según las horas). No recorta lo bajo pedido; si solo queda eso, devuelve las horas sin resolver. Se aplica como ajustes negativos al MPS. Es el último recurso tras las alternativas de capacidad.
- **Neto explicado** (`explainNet` en `mps.ts`): la misma cuenta de `computeNetProduction` paso por paso (demanda CEDI, inventario inicial, órdenes en curso, bajo pedido por flujo, inventario final). Una prueba confirma que coincide con `computeNetProduction` en todas las semanas.
- **Escenarios** (`scenarios.ts`, `ScenarioRecord`): cifras para comparar (horas que faltan, días en rojo, horas sin día, horas de cambio, choques, reglas violadas). Sección `scenarios` del espacio de trabajo (capacidad).
- **Esquemas en CSV** (`schemeCsv.ts`): exporta y lee `esquema;producto;lun…dom` con fila `TURNOS`; acepta códigos o nombres, marcas variadas, coma o punto y coma, y BOM; rechaza el esquema entero si una fila tiene error.
- **Plan oficial** (`ReleaseRecord`, `packages/sap-out/src/planFiles.ts`, pantalla `ReleaseView`): versiones numeradas con los archivos tal como salieron (programación diaria por planta, confirmación de plantas, órdenes provisionales y borrado de las de la versión anterior con `buildProvisionalOrders` de la app completa). Liberar con pendientes exige nota. Sección `releases` (permiso de publicar: Producción y Distribución). No escribe en SAP.
- **Datos**: se reutilizó la pantalla de bases de SAP de la app completa y se añadió el cargue de esquemas.
Pruebas: 258 en el motor y 34 en los archivos de salida, con mutación de las reglas nuevas (EVEN sin proporción, recorte de lo bajo pedido, orden invertido, órdenes en curso ignoradas, días en rojo en cero, producto de otra línea, turnos sin tope).

## Rediseño de las pantallas nuevas (2026-11-04, noche)
Plantas, Plan oficial y Datos se llevaron al mismo patrón que CRP, MPS y la mesa:
- **Plantas:** un mapa de producto por semana (agrupado por planta, con interruptor Confirmación / Entregas) y un panel con la celda elegida para confirmar, ajustar con atajos de porcentaje, registrar entregas y ver el historial; flechas del teclado; la selección no salta sola. La pantalla pasó de listas largas por semana a unos 890 px con las 13 semanas a la vista.
- **Plan oficial:** cuatro cifras clicables de lo que falta, una barra de liberación y una tabla de archivos por planta; las versiones liberadas son una lista plegable con una línea por planta.
- **Datos:** una pantalla con dos pestañas (bases de SAP y esquemas en Excel), cada una con sus pasos, un área principal y un panel de revisión; la pantalla de bases de la app completa se reescribió con ese patrón (`DataBases`).
