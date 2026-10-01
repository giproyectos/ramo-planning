# ADR 0006 — Tablero de riesgo de abastecimiento / MRP liviano (Fase 6)

**Estado:** implementado con datos sintéticos (materiales, listas y órdenes inventados); **decisión pendiente** entre explosión propia y simulación nativa de SAP · **Fecha:** 2026-10-01
**Código:** `packages/engine/src/supplyRisk.ts` · `packages/domain` (`Material`, `BomLine`, `PurchaseOrderLine`) · `apps/web/src/components/ramo/MrpView.tsx`, `StockChart.tsx`

## Qué se implementó
Replica la lógica del tablero de riesgo de abastecimiento que Diana ya arma a mano en Excel, en modo **solo lectura** (no genera ni modifica pedidos):
1. **Producción diaria:** la producción neta del MPS final (con los ajustes de Daniel) se baja a días en proporción a las horas disponibles del calendario de cada línea (`dailyProduction`).
2. **Explosión de la lista de materiales** (`explodeBom`): multinivel, con mermas y **mezclas de la planta secreta como ítems de paso** (se explotan hacia sus insumos el día en que se produce el SKU). Detecta ciclos.
3. **Proyección diaria del inventario** de cada insumo y empaque, con las órdenes de compra abiertas (las atrasadas cuentan desde el día 0).
4. **Riesgo contra el plazo de entrega** (`runSupplyRisk`):
   - **Ruptura dentro del plazo:** el inventario se agota antes de que llegue un pedido hecho hoy.
   - **Pedir ya:** la fecha límite para pedir (ruptura − plazo) cae en los próximos 7 días.
   - **Vigilar:** se rompe más adelante o cae bajo el colchón de seguridad; la fecha límite está a ≤ 28 días.
   - **Sin riesgo cercano:** no se rompe, o la fecha límite queda a más de 28 días (aunque se muestre la ruptura).
5. **Pedido sugerido** (cubre plazo + 14 días + colchón, descontando inventario y órdenes abiertas), en múltiplos del pedido mínimo y repartido por **cuota reguladora** (60/40 en el cacao, por ejemplo) con el método del mayor residuo.
6. **Orden abierta tardía** (`lateOrder`): si una orden ya existente llega después de la ruptura, el mensaje no es "pedir más" sino **adelantarla con el proveedor** (el caso de proveedores que incumplen que mencionó Diana).
7. **Vista MRP:** semáforo, tabla ordenada por severidad, gráfico del inventario con la marca del plazo y la ruptura, productos que lo consumen (con la ruta vía mezcla), órdenes abiertas y pedido sugerido.

## Decisión pendiente: simulación nativa de SAP vs explosión propia
Quedó abierta desde la reunión del 2026-08-14 (Fabio criticó que el proveedor anterior sacara inventario y órdenes de SAP a un tercero).
**Recomendación:** usar la **simulación nativa del MRP de SAP** como fuente de verdad cuando se cumplan tres condiciones, y mantener la explosión propia como **contraste de solo lectura y para escenarios previos a la carga**:
- el MPS + CRP llega a SAP como órdenes provisionales (hoy el cargue automático está roto y se hace a mano por planta con LSMW);
- las listas de materiales, plazos y datos maestros están depurados (lo que atacó el Plan B);
- el modo de simulación está disponible sin tocar el plan firme.
Hasta entonces la explosión propia permite ver el riesgo sin esperar esa cadena, y sirve para detectar discrepancias contra SAP. El cálculo está aislado en `runSupplyRisk(ds, net)`: la misma salida (`SupplyRiskResult`) puede alimentarse desde el resultado de la simulación de SAP sin cambiar la vista.
**Tensión a tener presente:** la explosión propia necesita traer inventarios, listas de materiales y órdenes de compra de SAP al entorno de GI; hay que acordar con Ramo que sea local, solo lectura y sin persistir datos.

## Hallazgos de la verificación
- **Horizonte de decisión:** con 13 semanas, casi cualquier material con menos de 91 días de inventario se rompería "algún día" si nunca se vuelve a pedir. Marcarlos todos como alerta diluye lo urgente. Por eso el riesgo se mide contra la **fecha límite para pedir** (`watchDays`, 28 días por defecto, configurable).
- **Orden tardía:** un material crítico con una orden abierta que llega 11 días tarde aparecía sin pedido sugerido, lo que confundía. Se agregó el aviso de adelantar la orden.
- **Gráfico:** los faltantes muy profundos aplastaban la parte útil; el eje se recorta a la mitad del inventario máximo.

## Supuestos y límites
- **Materiales, listas y órdenes son sintéticos**; los inventarios se dimensionaron en días de cobertura sobre la demanda base para que haya variedad de riesgos (5 críticos, 2 pedir ya, 8 vigilar, 4 sin riesgo cercano en el ejemplo).
- **Mezclas como ítems de paso:** no se modela su inventario, su capacidad ni el plazo de la planta secreta; se asume producción justo a tiempo.
- **Consumo según la producción planeada**, no la limitada por capacidad (si el CRP muestra faltantes, el consumo real sería menor); es la lectura conservadora para el riesgo.
- **Asignación diaria** por horas de línea; no considera la secuencia real de producción.
- **Plazos fijos:** no se modelan plazos variables, entregas parciales ni proveedores que incumplen (lead times dinámicos: Fase 7).
- **Cuota reguladora:** se respeta al repartir el pedido sugerido; la detección de ajustes manuales que "tiran la cuota" y la excepción por riesgo de plazo son de la Fase 7.
- **Sin** sustitutos, vida útil, lotes de compra económicos, multi-planta ni múltiples bodegas.
- **Pedidos mínimos** simplificados a un solo valor por material.

## Criterio de aceptación pendiente
Reproducir, con el Excel real del tablero de Diana y una semana ya cerrada, las mismas fechas de ruptura y las mismas alertas (tolerancia a acordar). Hoy solo se verificó con datos sintéticos y casos calculados a mano (84 pruebas del motor).
