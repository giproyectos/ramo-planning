# Mapeo dominio ↔ SAP

Estado: **borrador**. Lo marcado como *por confirmar* sale de las reuniones del 2026-08-14 y 2026-09-15 y no está verificado en el sistema.

| Concepto del dominio | Origen en SAP / Excel | Estado |
|---|---|---|
| `Sku.lineId` | Campo "perfil general" (vista Preparación de trabajo del maestro de materiales) | En productivo; confirmar nombre técnico del campo |
| `Line.rate`, horas por línea y fecha | Tabla Z ("tabla de liberación") | **Por confirmar nombre de la tabla** (Diana no lo recordaba) |
| `Line`, `Crew` | No existen en SAP (solo puestos de trabajo) | Dato nuevo; fuente inicial: Excel de Miguel |
| `LineCalendar` | Excel de Miguel (festivos, paradas, mantenimiento) | Por levantar |
| Inventarios (base 1) | Descarga SAP cada lunes ~8 am, corte 8 am + 1 mes de movimientos | Fase 3: parser y validación hechos con formato supuesto (ver formatos-bases-sap.md) |
| Abastecimiento (base 2) | Movimientos de triangulación en zona franca (0004→0060, Intercomex): neteo de doble conteo y faltante después de las 2 pm | Fase 3: parser y neteo hechos con formato supuesto |
| Trazabilidad de despachos (base 3) | Transacción Z de consulta (solo lectura): qué falta por entregar entre 8 am y 2 pm | Fase 3: parser hecho con formato supuesto; aclarar a Alfredo (ABAP) que no escribe |
| `DemandRecord` (carga a SAP) | Gestión de Demanda vía MD61 / LSMW (o BAPI) | Fase 4: archivo generado para revisión (formato supuesto); la carga sigue siendo manual |
| Órdenes provisionales (salida MPS final) | Hoy: archivo por planta cargado a mano con LSMW; el flujo automático por archivo plano se rompió con una migración de SAP | Fase 8: archivo por planta + borrado de la publicación anterior generado para revisión (formato **supuesto**, sin probar contra el cargue real); falta validarlo con Alfredo (SAP/ABAP) en un ambiente de desarrollo |
| Red de distribución e inventario por nodo (DRP) | Descargas MD04 / MD5A que Diana usa en su Excel de DRP; maestro de nodos y plazos | Fase 5: red **sintética** (nodos, plazos, participaciones, capacidades); falta la fuente real |
| Explosión de materiales, listas de materiales (incluye mezclas de la planta secreta), inventario de insumos y órdenes de compra abiertas | MD04 / MD5A; COISPI; tabla Z1 propia de Diana; maestro de materiales y registros info | Fase 6: tablero de riesgo con datos **sintéticos** (explosión propia de solo lectura); falta la fuente real y la decisión frente a la simulación nativa de SAP (ADR 0006) |
| Cuota reguladora | Arreglo de cuotas SAP (ME01 / MEQ1 / ME11) | Fase 7: cuota negociada vs usada y excepciones por riesgo de plazo, con historial **sintético**; falta la cuota vigente real |
| Historial de órdenes recibidas (plazo real por proveedor) y solicitudes de pedido abiertas | Pedidos de compra y entregas (por confirmar tablas/transacciones, p. ej. historial de pedidos y solicitudes de pedido) | Fase 7: **sintético**; falta el extracto real |

## Pendiente de confirmar
- Nombre exacto de la tabla Z de liberación y del campo de perfil general.
- Nombre completo de Daniel (¿Rangel?) y su rol exacto sobre el archivo "MPS".
- Formato exacto (columnas, separadores) de los archivos de las 3 bases.
