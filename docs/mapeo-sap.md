# Mapeo dominio ↔ SAP

Estado: **borrador**. Lo marcado como *por confirmar* sale de las reuniones del 2026-08-14 y 2026-09-15 y no está verificado en el sistema.

| Concepto del dominio | Origen en SAP / Excel | Estado |
|---|---|---|
| `Sku.lineId` | Campo "perfil general" (vista Preparación de trabajo del maestro de materiales) | En productivo; confirmar nombre técnico del campo |
| `Line.rate`, horas por línea y fecha | Tabla Z ("tabla de liberación") | **Por confirmar nombre de la tabla** (Diana no lo recordaba) |
| `Line`, `Crew` | No existen en SAP (solo puestos de trabajo) | Dato nuevo; fuente inicial: Excel de Miguel |
| `LineCalendar` | Excel de Miguel (festivos, paradas, mantenimiento) | Por levantar |
| Inventarios (base 1) | Descarga SAP cada lunes ~8 am, corte 8 am + 1 mes de movimientos | Fase 3 |
| Abastecimiento (base 2) | Movimientos de triangulación en zona franca (0004→0060, Intercomex): neteo de doble conteo y faltante después de las 2 pm | Fase 3 |
| Trazabilidad de despachos (base 3) | Transacción Z de consulta (solo lectura): qué falta por entregar entre 8 am y 2 pm | Fase 3; aclarar a Alfredo (ABAP) que no escribe |
| `DemandRecord` (carga a SAP) | Gestión de Demanda vía MD61 / LSMW (o BAPI) | Fase 4 |
| Órdenes provisionales (salida MPS final) | Hoy: archivo por planta cargado a mano con LSMW; el flujo automático por archivo plano se rompió con una migración de SAP | Fase 8 |
| Explosión de materiales | MD04 / MD5A; COISPI; tabla Z1 propia de Diana | Fase 6 |
| Cuota reguladora | Arreglo de cuotas SAP (ME01 / MEQ1 / ME11) | Fase 7 |

## Pendiente de confirmar
- Nombre exacto de la tabla Z de liberación y del campo de perfil general.
- Nombre completo de Daniel (¿Rangel?) y su rol exacto sobre el archivo "MPS".
- Formato exacto (columnas, separadores) de los archivos de las 3 bases.
