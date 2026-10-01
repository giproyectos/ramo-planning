# ADR 0005 — DRP: red de distribución, stock de seguridad dinámico y regla de escasez (Fase 5)

**Estado:** implementado con datos sintéticos; la red, el inventario por nodo y la regla de escasez son supuestos pendientes de validación · **Fecha:** 2026-10-01
**Código:** `packages/engine/src/drp.ts`, `scarcity.ts` · `packages/domain` (`DistributionNode`) · `apps/web/src/components/ramo/DrpView.tsx`

## Qué se implementó
1. **Red de dos niveles** (planta → CEDI → agencias) como dato: cada nodo tiene plazo en semanas, participación de demanda e inventario, prioridad del canal, mínimo de cobertura en días y capacidad de almacenamiento (`DistributionNode`, validado en `validateDataset`).
2. **DRP semanal** (`runDrp`): cada agencia consume su participación de la demanda CEDI y repone para no bajar de su stock de seguridad; las liberaciones de las agencias son demanda del CEDI; las del CEDI hacia planta son la **necesidad de producción que entra al MPS** (lo confirmó Diana: el DRP es insumo del MPS). Hard Discount y Exportaciones no pasan por el DRP.
3. **Stock de seguridad dinámico** frente al estático de hoy: dinámico = z × σ × √(plazo + revisión), con z por prioridad del canal (97,5 % / 95 % / 90 %) y σ el error real del pronóstico a 1 semana (Fase 4); estático = X días fijos de demanda promedio. La política es conmutable y la vista compara ambas.
4. **Alertas de red:** espacio (stock proyectado del nodo sobre su capacidad), stock bajo el de seguridad y quiebre.
5. **Regla de escasez** (`allocateScarcity`), la que describió Diana: (1) ajustes manuales del planeador, (2) mínimos de cobertura por canal prioritario (alta → normal → baja), (3) resto a prorrata del pronóstico, sin pasar de lo pedido. Los faltantes salen del CRP (`supplyGaps`). El reparto aprobado queda en el registro del ciclo con autor y motivo.
6. **Integración:** con "Usar la necesidad del DRP como entrada del MPS" (por defecto), el MPS recibe la necesidad del DRP más los pedidos bajo pedido y solo descuenta órdenes en curso: el DRP ya neteó el inventario de la red, así que no se descuenta dos veces.

## Hallazgos de la verificación (cambiaron el diseño)
Al revisar los números en la interfaz aparecieron tres problemas; ninguno lo detectaban las pruebas unitarias:
- **Inventario sintético irreal:** con solo 25 % de una semana de cobertura, la semana 0 pedía más del doble de lo normal. Se subió a ~1 semana (Barras queda con poco inventario a propósito).
- **σ por nodo:** repartir σ por participación (σ × share) subestimaba el stock de seguridad de los nodos pequeños. Ahora es σ × √share (errores independientes entre nodos): más conservador. Con σ real por nodo se reemplaza.
- **Plazo y flujo en camino:** pedir en la semana 0 recepciones que nadie puede producir a tiempo apilaba demanda y distorsionaba el MPS y el CRP. El tratamiento actual es el estándar: **dentro del plazo no se puede cambiar nada** (horizonte congelado); el stock proyectado puede bajar del de seguridad o agotarse, se avisa, y la primera recepción factible lo recupera. Para no empezar con la red "vacía" se supone un **flujo en camino de régimen** (el consumo promedio del nodo) durante el plazo; es un supuesto explícito y desactivable (`pipeline`) hasta cargar el inventario en tránsito y las órdenes abiertas reales.
- **Borde del horizonte:** las últimas semanas mostraban necesidad 0 porque el cálculo no veía más allá. Ahora se calcula internamente `plazo acumulado` semanas más repitiendo la última demanda, y solo se informa el horizonte original.

## Supuestos que hay que validar con Diana, Daniel y Miguel
1. **La red:** nodos, plazos, participaciones de demanda e inventario por nodo y capacidades son sintéticos. El inventario por nodo real sale de las descargas MD04/MD5A de Diana.
2. **Dos niveles y un solo CEDI:** el DRP real de Ramo puede tener más niveles o varios CEDI.
3. **Plazos en semanas enteras:** los despachos reales pueden ser diarios; el modelo es semanal.
4. **Niveles de servicio** por prioridad (97,5 / 95 / 90 %) y **revisión semanal**: valores por defecto, no de Ramo.
5. **La regla de escasez** (orden, mínimos por prioridad, prorrata) está descrita por Diana pero **no tiene definición comercial**: falta quién decide los canales prioritarios, los mínimos y si el reparto es por agencia, canal o cliente.
6. **Escasez desde el CRP:** el faltante de producción se reparte en la misma proporción entre los SKUs de la tripulación (aproximación lineal) y se aplica a la misma semana de despacho, sin buffers.
7. **El flujo en camino de régimen** reemplaza datos reales que ya existen (base de abastecimiento de la Fase 3, órdenes abiertas).

## Qué NO se resolvió
- **Frecuencias de despacho, canasta y rotación** de Daniel: no se modelan (solo espacio). La canasta exige que estén todos los SKUs de la canasta en cada agencia.
- **Restricciones de transporte** (camiones, ventanas) y **lotes mínimos/múltiplos** de despacho.
- **Escasez multi-período:** la regla es de un solo SKU y una sola semana; no optimiza entre semanas ni entre SKUs que compiten por la misma línea.
- **Retroalimentación:** el reparto aprobado es una propuesta; no cambia el MPS ni escribe en SAP.
- **σ real por nodo:** con historia por agencia y canal se puede reemplazar la suposición de errores independientes.
- **Persistencia** de decisiones (Fase 8).
