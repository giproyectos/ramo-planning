# Plan de adaptación — Repo nuevo para Ramo (a partir de demad-app)

**Autora:** Valentina Gómez (GI Proyectos) · **Fecha:** 2026-10-01 · **Estado:** borrador para discusión con Fabio

## 1. Decisión de partida
- `giproyectos/demad-app` **no se modifica**. Queda como demo genérica y semilla de producto.
- Se crea un **repo nuevo** (nombre propuesto: `giproyectos/ramo-planning`, privado) con el código de demad-app **copiado sin historial** (`git init` nuevo, commit inicial que cite el origen y el hash `66adddf`).
- Lo que se reutiliza: shell de UI (Sidebar, Header, Command Palette, Alerts, Export, i18n, estilos), idea de escenarios y grillas editables.
- Lo que **no** se reutiliza: el dominio (types, `derive.ts`, `mockData.ts`) y la lógica de escenarios incrustada en `App.tsx`. Se reescriben.
- Se descarta del alcance el plan SaaS multi-tenant de `plan-estrategico.md`. Este repo es **el piloto de Ramo**. Lo que se aprenda se llevará después a demad-app.

## 2. Principios (para no repetir el error de Tools)
1. **Incremental por módulos, con victorias demostrables.** Ningún módulo se declara hecho sin validación de Diana o Miguel con datos reales.
2. **MPS/CRP primero:** es la pieza que no existe en SAP y el cuello de botella real (reunión 2026-08-14 y 2026-09-15).
3. **Motor separado de la UI:** el cálculo vive en un paquete TypeScript puro, con pruebas, sin React. La UI solo lo consume.
4. **SAP sigue siendo el sistema de registro.** No se extraen inventario ni órdenes a un tercero. Se lee de SAP (archivos de las 3 bases) y se escribe solo lo aprobado.
5. **Nada se escribe a SAP sin aprobación humana trazada** (quién, qué, por qué).
6. **Datos de Ramo fuera de GitHub.** Solo datos sintéticos o anonimizados en el repo. Los reales se cargan en ejecución.

## 3. Estructura propuesta del repo
```
ramo-planning/
  apps/web/            # UI (shell reutilizado de demad-app)
  packages/engine/     # motor puro: demanda, drp, mps, crp, mrp-risk (con tests)
  packages/domain/     # tipos del modelo Ramo
  packages/ingest/     # parsers de las 3 bases SAP y de los Excel de Diana/Miguel
  packages/sap-out/    # generadores de archivos de salida (LSMW/MD61/órdenes provisionales)
  data/synthetic/      # datos sintéticos con la forma real
  docs/                # decisiones (ADR), mapeo SAP, guion de demo
```
Se mantiene frontend + un backend ligero (Node) solo cuando haga falta persistencia y auditoría (Fase 6). Antes de eso, los archivos se cargan en el navegador.

## 4. Fases

### Fase 0 — Arranque del repo (≈2–3 días)
- Crear repo, copiar shell, limpiar dependencias sin uso (`@google/genai`, `express`) hasta que se necesiten.
- Marca unificada (nombre de proyecto Ramo), español por defecto, EN opcional.
- CI mínimo: `tsc --noEmit`, pruebas del motor, build.
- **Entregable:** app arranca vacía con navegación Demanda · DRP · MPS · CRP · MRP.

### Fase 1 — Modelo de dominio Ramo (≈1 semana, en paralelo a pedir insumos)
Entidades: Material/SKU (con unidad comercial y unidad productiva, "tajadas"), **Línea** (ritmo u/h o kg/h, horas disponibles, mantenimiento), **Tripulación** (compartida entre líneas), Planta, CEDI/agencia, Calendario (festivos, paradas), **Flujos de demanda** (CEDI regular, Hard Discount, Exportaciones), Versión de plan y **Building Block** (ajuste trazable).
- Mapeo a campos SAP conocidos: "perfil general" (amarra producto→línea), tabla Z de liberación (ritmo/horas por línea y fecha; nombre exacto pendiente), MD04/MD5A, MD61.
- **Entregable:** `packages/domain` + ADR del modelo, validado con Diana.

### Fase 2 — MPS + CRP como ciclo de dos actores (≈3–4 semanas) ★ prioridad
Reemplaza los módulos genéricos de demad-app.
- **Vista Miguel (CRP):** entrada = necesidad CEDI + Hard Discount + Exportaciones; secuencia semanal; conversión comercial→productiva; ritmo × horas netas → % saturación; exceso en horas; **tripulación compartida** (suma de capacidades entre líneas, p. ej. Barras + Choco Mini); mitigación (turno extendido, festivo, refuerzo externo). Horizonte de 3 meses.
- **Vista Daniel (MPS final):** consolida toda la necesidad del negocio + riesgos de distribución (canasta, espacio, rotación); "rojos" con ajustes positivos/negativos.
- **Bucle de negociación:** Miguel envía capacidades → Daniel consolida → MPS final → vuelve a Miguel → alertas finales. Cada versión queda guardada con su autor y motivo.
- Calendario semanal visible (miércoles comparte, jueves decide, viernes oficial).
- **Motor:** separar explícitamente *neto* (demanda − inventario − órdenes en curso) de *ajuste por capacidad*, que hoy están mezclados en el Excel de Diana.
- **Criterio de aceptación:** reproducir con los Excel reales de Diana/Miguel, de una semana ya cerrada, los mismos % de saturación y horas extra (tolerancia acordada).
- **Insumos de Ramo:** Excel MPS+CRP/explosión de Diana, archivo de capacidades de Miguel, 3 bases SAP de una semana pasada.
- **Hito de demo (primera vez que se le muestra algo a Alejandro).**

### Fase 3 — Ingesta de las 3 bases SAP (≈2 semanas, arranca con la Fase 2)
- Parsers de: Inventarios (corte 8am + 1 mes de movimientos), Abastecimiento (triangulación zona franca, netear doble conteo, faltante después de 2pm), Trazabilidad de despachos (transacción Z de consulta).
- Validaciones duras (calidad de datos): duplicados, basura de histórico, recorte temporal de 2 años.
- **Entregable:** cargar las 3 bases del lunes y ver el estado base en la app.

### Fase 4 — Demanda (≈3 semanas)
- Línea base estadística/ML desde histórico SAP (empezar con modelos simples y medir contra el Excel actual por SKU/canal; **no** asumir SageMaker).
- Ciclo mensual PBO + recálculo semanal N+1 como dos versiones distintas; building blocks con trazabilidad.
- Filtros tipo BI (unidad de negocio, marca, canal) y **cambio de unidad de medida** (costo / unidades comerciales / toneladas), pedido por Diana.
- Salida a SAP (MD61/BAPI) como archivo generado y revisable.
- **Criterio:** precisión (WAPE/sesgo) igual o mejor que el proceso actual en un conjunto de productos que elija Diana, no solo "Gansito".

### Fase 5 — DRP (≈3 semanas)
- Entrada: recálculo semanal (confirmado por Diana). Salida: necesidad CEDI hacia el MPS.
- Stock de seguridad **dinámico** según demanda semanal.
- Regla de escasez (fair share con mínimos por canal prioritario y override manual) — **requiere definición comercial previa**.
- Hard Discount y Exportaciones quedan fuera del DRP por ser bajo pedido.

### Fase 6 — Tablero de riesgo de abastecimiento (MRP liviano) (≈2–3 semanas)
- Replica el tablero de Diana: consumo diario proyectado del MPS explotado a insumos, alertas de ruptura dentro del lead time.
- **Decisión pendiente:** explotar con la lista de materiales traída de SAP (tabla Z1 de Diana) o usar la **simulación nativa del MRP de SAP**. Ver sección 6.
- La capa IA (Fase 7) actúa sobre esta salida.

### Fase 7 — Capa IA (≈3–4 semanas, después de validar el núcleo)
Por orden de valor/riesgo: (1) priorización crítico/normal/espera; (2) detección de anomalías (cantidades fuera de rango, posibles duplicados sol.ped. vs OC); (3) ajuste por intervalo de confianza; (4) lead times dinámicos (fecha OC vs entrega real); (5) consolidación por proveedor; (6) alerta de **cuota reguladora** rota (ej. 60/40); (7) copiloto conversacional con explicaciones. Cada recomendación muestra el "por qué". Se usa LLM solo para explicación/razonamiento; el cálculo masivo es determinístico.

### Fase 8 — Gobernanza y salida a SAP (≈3 semanas, con backend)
- Backend ligero + base de datos: usuarios, **roles por capa** (Demanda / Distribución / Producción), auditoría, versiones.
- Flujo: propuesta → refinamiento → aprobación/modificación/rechazo con justificación → solo lo aprobado genera archivo de salida.
- **Reemplazo del cargue manual por planta vía LSMW** de órdenes provisionales: generar el archivo plano por planta (primer paso) y luego automatizar el cargue cuando el canal roto tras la migración de SAP esté resuelto con Alfredo/ABAP.

## 5. Cronograma orientativo
| Bloque | Fases | Duración aprox. | Hito |
|---|---|---|---|
| A | 0 + 1 | 1–2 semanas | Repo y modelo validado |
| B | 2 + 3 | 4–5 semanas | **Demo MPS/CRP con datos reales a Alejandro** |
| C | 4 + 5 | 5–6 semanas | Demanda y DRP en la app |
| D | 6 + 7 | 5–7 semanas | Riesgo de abastecimiento + IA |
| E | 8 | 3 semanas | Gobernanza y salida a SAP |

Son estimaciones gruesas de una sola persona de desarrollo; se ajustan tras la Fase 1.

## 6. Decisiones abiertas (necesito respuesta antes de la fase indicada)
1. **Nombre y visibilidad del repo** (Fase 0). Propuesta: `giproyectos/ramo-planning`, privado.
2. **¿Quién es dueño de los datos reales?** ¿Se pueden usar archivos de Ramo en el equipo de GI y bajo qué acuerdo? (Fase 2)
3. **MRP:** simulación nativa de SAP vs explosión propia (Fase 6). Recomiendo simulación nativa si el MPS+CRP llega a SAP como órdenes provisionales; si no, explosión propia solo para lectura.
4. **Regla de escasez** (Fase 5): requiere alineación con comercial.
5. **Mecanismo de resincronización de lead times** a datos maestros SAP (Fase 7).
6. **Relación con la pista AWS/SageMaker de Marlon** (Fase 4): el piloto no depende de ella; conviene definir la frontera con Alejandro.
7. **Nombre completo de Daniel** (¿Rangel?) y de la tabla Z de liberación, por confirmar.

## 7. Riesgos
| Riesgo | Mitigación |
|---|---|
| Repetir Tools (alcance excesivo) | Fases con aceptación contra datos reales; MPS/CRP primero; SaaS fuera de alcance |
| Reglas de capacidad más sutiles de lo visto (secuencia, paradas avisadas tarde) | Sesiones cortas semanales con Miguel; empezar con 2–3 líneas (Chocoramo, Barras/Choco Mini, maicitos) y ampliar |
| Datos sucios de SAP | Validaciones de ingesta en Fase 3; recorte a 2 años |
| Archivos de Ramo en GitHub | Solo datos sintéticos en el repo; `.gitignore` estricto; cargue local |
| Dependencia de SAP/ABAP para el cargue | Entregar primero archivo revisable; automatizar después |
| Un solo desarrollador (cuello de botella) | Motor y UI desacoplados; pruebas del motor desde el día uno |

## 8. Próximos pasos inmediatos
1. Fabio y Valentina confirman nombre y visibilidad del repo; se crea y se carga la semilla (Fase 0).
2. Pedir a Diana los Excel de MPS+CRP y el tablero de riesgo; a Miguel el archivo de capacidades y las 3 bases de una semana cerrada.
3. Sesión de validación del modelo de dominio (Fase 1) con Diana y Miguel.
4. Armar el caso de prueba de aceptación de la Fase 2 (semana pasada reproducida de punta a punta).
