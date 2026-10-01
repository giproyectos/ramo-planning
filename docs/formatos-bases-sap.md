# Formatos supuestos de las 3 bases SAP (Fase 3)

**Estado:** supuesto de GI Proyectos, **sin verificar contra los archivos reales de Miguel**. El código (`packages/ingest`) acepta alias de encabezado y separador/decimal configurables, así que ajustar un formato real es cambiar una lista de alias, no la lógica. Si los archivos reales traen otras columnas, se ajusta aquí y en `packages/ingest/src/*.ts`.

Reglas comunes: CSV con separador autodetectado (`;`, tab o `,`), BOM permitido, encabezados sin distinguir mayúsculas ni tildes, **decimal con coma** y punto de miles (`1.234,56`; configurable), fechas `DD.MM.YYYY` / `YYYY-MM-DD` / `YYYYMMDD`, horas `HH:MM`, material con o sin ceros a la izquierda. Las cantidades pueden venir en cajas (`CJ`), unidades (`UN`), kg o toneladas: se convierten a cajas con los datos del SKU.

## 1. Inventarios (dos archivos)
- **Stock al corte** (lunes ~8 am) — obligatorias: `Material`, `UM`, `Libre utilización`; opcionales: `Centro`, `Almacén`, `Fecha corte`.
- **Movimientos del último mes** — obligatorias: `Fecha contabilización`, `Material`, `Cantidad` (**con signo**: entradas +, salidas −), `UM`; opcionales: `Hora`, `Centro`, `Almacén`, `Clase movimiento`, `Documento material`.

## 2. Abastecimiento (triangulación zona franca)
Obligatorias: `Fecha`, `Material`, `Centro origen`, `Centro destino`, `Cantidad`, `UM`, `Referencia`; opcional: `Hora`.
Cada envío puede aparecer en varios tramos (producción → recibo logística 0004 → nacionalización/customer 0060). Se agrupan por (SKU, referencia).

## 3. Trazabilidad de despachos (consulta Z, solo lectura)
Obligatorias: `Pedido`, `Material`, `Cantidad pedida`, `Cantidad entregada`, `UM`, `Fecha entrega`; opcionales: `Posición`, `Cliente`, `Hora entrega`.

## Validaciones
| Código | Severidad | Qué detecta | Qué pasa con la fila |
|---|---|---|---|
| `MISSING_COLUMN` / `EMPTY_BASE` / `NO_VALID_ROWS` | error | Falta una columna obligatoria o no queda ninguna fila válida | La base se rechaza |
| `MISSING_BASE` | error (stock) / aviso (resto) | No se cargó la base | Sin stock no hay línea base; las demás aportan cero |
| `BAD_NUMBER`, `BAD_DATE`, `BAD_TIME`, `UNKNOWN_UNIT` | error | Dato ilegible o unidad no convertible | Se descarta |
| `UNKNOWN_MATERIAL` | aviso | Material fuera del catálogo del piloto | Se descarta |
| `NEGATIVE_STOCK`, `DUPLICATE_STOCK_ROW`, `DUPLICATE_ORDER_LINE`, `MISSING_REFERENCE` | error | Stock negativo, fila o posición repetida, envío sin referencia | Se descarta |
| `STALE_ROW` | aviso | Más de 2 años antes del corte (recorte pedido por Marlon) | Se descarta |
| `FUTURE_ROW`, `OUT_OF_WINDOW` | aviso | Movimiento posterior al corte o fuera de la ventana de 31 días | Se descarta |
| `DUPLICATE_MOVEMENT` | aviso | Mismo documento, SKU, clase, cantidad y fecha | Se descarta la repetida |
| `DOUBLE_COUNT` | nota | Mismo envío en varios tramos con igual cantidad | Se cuenta una sola vez |
| `QTY_MISMATCH` | aviso | Tramos de un envío con cantidades distintas | Se usa la del primer tramo |
| `OVER_DELIVERED` | aviso | Entregado mayor que lo pedido | Pendiente = 0 |
| `IMPLIED_NEGATIVE_OPENING` | aviso | Stock al corte menos movimientos del mes es negativo (faltan movimientos o hay stock mal cargado) | Se avisa; no se corrige |
| `SNAPSHOT_DATE_MISMATCH` | aviso | La foto de stock no es del día del corte | Se avisa |

## Cálculo de la línea base por SKU
- **Stock** = suma de centros y almacenes (en cajas).
- **En tránsito** = envíos de triangulación sin ningún tramo hacia un destino final (`0060`, `CUSTOMER`; configurable).
- **Pendiente de despacho** = suma de máx(0, pedida − entregada) de los pedidos cuya hora cae en la ventana **08:00–14:00** (sin hora se asume dentro); lo demás se informa aparte.
- **Disponible** = máx(0, stock + en tránsito − pendiente de despacho). Es lo que usa el neto del MPS como inventario.
- **Cobertura (días)** = stock ÷ (salidas netas del mes ÷ 31).

## Supuestos a confirmar con Miguel
1. Nombres y orden reales de columnas, separador y formato de decimales de los exportes.
2. Si el movimiento "contado dos veces" de la triangulación es el mismo envío en dos tramos con igual cantidad y referencia (como se modeló), o se identifica de otra forma.
3. Qué significa exactamente "lo que falta por despachar después de las 2 pm" y si debe restarse del inventario disponible.
4. Si el stock en tránsito de la triangulación debe sumarse al disponible.
5. Qué centros y almacenes cuentan como inventario de producto terminado (hoy cuentan todos; la opción `plantCenters` permite filtrar).
