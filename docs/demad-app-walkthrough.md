# Walkthrough de la Demo — Tessaris Demand & Operations Suite

Guía de referencia para quien presente esta demo: qué representa cada pantalla, qué significa cada número, y por qué importa para un prospecto. Pensada para leerse una vez y luego usarse como consulta rápida antes de una reunión.

---

## 1. Qué es esto

Un prototipo funcional (datos de ejemplo, no conectado a un ERP real) que demuestra el **ciclo completo de planeación de demanda y suministro**: S&OP → DRP → MPS → CRP → MRP, con los cinco módulos conectados entre sí como lo estarían en una implementación real. La empresa ficticia es un fabricante de motion control / robótica / sensores industriales ("Precision Motion Drives", "Robotics Control Modules", "Industrial Edge Sensors"), con una planta central en Detroit y 3-4 depósitos regionales.

El objetivo de la demo **no es que los números sean reales** — es que un comprador técnico (VP de Operaciones, Director de Supply Chain) reconozca el flujo y confíe en que la lógica detrás es correcta. Por eso, en la sesión anterior se revisó que **todos los cálculos cuadren matemáticamente** entre etapas (ver [plan-estrategico.md](plan-estrategico.md) para el contexto del producto completo).

Tiene toggle **EN/ES** en el header — úsalo según el idioma del prospecto.

---

## 2. El mapa mental: la cascada de planeación

Esto es lo primero que hay que dejar claro en cualquier demo, porque todo lo demás depende de que el prospecto entienda el flujo:

```
S&OP  →  DRP  →  MPS  →  CRP  →  MRP
(mes)   (semana) (semana) (semana) (semana)
```

| Etapa | Pregunta que responde | Nivel | Output |
|---|---|---|---|
| **S&OP** | ¿Cuánto vamos a vender y podemos producirlo? | Familia de producto, mensual | Plan de consenso ventas-operaciones |
| **DRP** | ¿Cuánto inventario necesita cada depósito y cuándo? | SKU × depósito, semanal | Plan de reabastecimiento de red |
| **MPS** | ¿Qué y cuándo construye la planta? | SKU terminado, semanal | Programa maestro + disponible-para-prometer (ATP) |
| **CRP** | ¿Tenemos las horas de máquina para cumplir el MPS? | Centro de trabajo, semanal | Validación de capacidad / cuellos de botella |
| **MRP** | ¿Qué materiales hay que comprar y cuándo? | Componente (BOM), semanal | Órdenes de compra sugeridas |

Cada etapa **alimenta a la siguiente** (el consenso de S&OP se desagrega en demanda de DRP; el tiro de DRP se consolida en el MPS; el MPS valida contra CRP; el MPS aprobado explota en necesidades de MRP) y **cada una puede devolver una señal hacia atrás** cuando hay una restricción (ej. CRP encuentra un cuello de botella → hay que revisar el MPS). Esa retroalimentación bidireccional es el "bucle cerrado" que la app menciona constantemente ("Closed-Loop").

---

## 3. Recorrido pantalla por pantalla

### 3.1 Sidebar (navegación izquierda, siempre visible)
- Logo/marca ("Tessaris"), nombre de la planta y año fiscal.
- Las 6 paradas de navegación (Flow, S&OP, DRP, MPS, CRP, MRP), cada una con un badge de estado en vivo (Aprobado, Balanceado, Bloqueado, Alerta, etc.) — esto ya le comunica al prospecto, sin hacer clic en nada, que el sistema sabe en qué estado está cada etapa.
- Abajo: selector de escenario activo y la tarjeta del usuario (planificador maestro, conectado al ERP — ese punto verde es un guiño a que esto se integraría con su ERP real).

### 3.2 Header (barra superior, siempre visible)
- Breadcrumb de la etapa actual + badge "En vivo".
- Buscador central (abre el Command Palette, ver 4.1).
- Toggle **EN/ES**.
- Pill de escenario activo (abre el comparador de escenarios, ver 4.3).
- Campana de alertas con contador (abre el drawer de excepciones, ver 4.2).
- Botón **Exportar** (ver 4.4).
- Botón **Regenerar** — dispara el recálculo de punta a punta del pipeline; es el momento "wow" para mostrar que el sistema recalcula todas las etapas en cascada, no son pantallas estáticas independientes.

### 3.3 Process Map / Flow & Dashboard (pantalla de inicio)
La vista ejecutiva. Tiene dos modos (toggle arriba):
- **Panel de Estadísticas Globales**: 4 KPIs consolidados (Pipeline proyectado en $, entrega de red de depósitos, carga máxima de máquina, abastecimiento de materiales), el embudo visual de las 5 etapas con su cifra clave cada una, una comparación demanda-vs-capacidad, y un panel de alertas/cuellos de botella en tiempo real con botón de "Disparar Recálculo".
- **Etapas de Arquitectura**: las 5 tarjetas de proceso en formato más explicativo (horizonte, granularidad, throughput) — útil si el prospecto pregunta "¿y esto en cuánto tiempo corre?" antes de entrar al detalle de cada módulo.

A la derecha vive el panel **Acciones de Planeación** (ver 3.9) — son los "próximos pasos" que un planificador real tendría en su día.

Este es el mejor punto de partida en una demo: da contexto antes de entrar al detalle.

### 3.4 S&OP — Consenso de Ventas y Operaciones
- Selector de familia de producto (3 familias con su % de peso en ingresos).
- 4 KPIs: demanda a 6 meses, techo de planta, brecha neta (superávit/déficit), pipeline proyectado.
- Gráfico de barras: demanda de consenso vs techo de planta por mes, con etiqueta de superávit/déficit.
- **Libro mayor editable**: la fila "Pronóstico Comercial de Ventas" y "Impulso de Campaña de Marketing" son celdas editables — cambia un número y observa cómo se recalculan en vivo el consenso, la brecha y el ingreso proyectado. Este es el mejor momento para mostrar que **no es una tabla estática**, sino que responde exactamente a la fórmula de negocio (`consenso = ventas + marketing`).
- Botón "+50 Impulso de Campaña" — atajo para simular una campaña sin editar celda por celda.
- Botón "Bloquear Consenso" — simula el paso de aprobación ejecutiva que cierra el plan del mes.
- Botón "Promover a DRP" — avanza el flujo (narrativamente: "el consenso ya aprobado baja a la red de distribución").

### 3.5 DRP — Planeación de Requerimientos de Distribución
- Diagrama de red: planta central de Detroit + 3 depósitos regionales, cada uno con su lead time de tránsito, inventario actual y tipo.
- Matriz de reabastecimiento por depósito × semana: requerimiento bruto, recibos en tránsito, balance disponible proyectado, requerimiento neto, y liberación de orden planeada (el número que se agrega para pedir reposición a planta).
- Fila total al final: agregado de todo lo que la red le está "jalando" a la planta — ese número es justamente lo que alimenta al MPS.
- Botón **Transferencia entre Depósitos**: abre un modal para simular un rebalanceo lateral de inventario entre dos depósitos (sin pasar por planta) — bueno para mostrar flexibilidad operativa.
- Botón "Consolidar en MPS" — avanza el flujo.

### 3.6 MPS — Programa Maestro de Producción
- Selector de SKU terminado.
- Explicación de las **zonas de tiempo** (time fences): Congelada (órdenes ya despachadas a planta, bloqueadas), Semi-abierta (cambios posibles con aprobación), Líquida (totalmente flexible). Esto es un concepto clave de manufactura que vale la pena explicar despacio si el prospecto no lo conoce.
- Matriz semanal: demanda pronosticada, órdenes de clientes comprometidas, construcción planeada (**editable solo en zona Semi-abierta/Líquida** — la Congelada está bloqueada a propósito, para reforzar visualmente la regla de negocio), balance disponible proyectado, y **ATP discreto/acumulado** (Available-to-Promise: cuánto se puede prometer a un cliente nuevo sin tocar lo ya comprometido).
- Botón **Simular Pedido ATP**: abre un modal donde se ingresa una cantidad y semana objetivo, y el sistema dice si se puede prometer o no contra el ATP acumulado real — este es el momento más "wow" del módulo para un VP de Ventas en la sala.
- Botón "Verificar Capacidad en CRP" — avanza el flujo.

### 3.7 CRP — Planeación de Requerimientos de Capacidad
- 4 tarjetas de centros de trabajo (fabricación CNC, electrónica SMT, electromecánico, calidad) con su % de utilización máxima y estado (Factible / Cuello de Botella).
- Al seleccionar un centro de trabajo: gráfico de carga semanal vs capacidad efectiva, más una tabla detallada (horas de preparación, horas de producción, carga total, capacidad efectiva, % de utilización contra la meta de ≤100%).
- Cuando hay sobrecarga: botones de mitigación — **Agregar Tiempo Extra (+16h)** y **Ruta Alterna (-24h)** — ambos recalculan la utilización en vivo. Este es el segundo gran momento demostrativo: mostrar que el sistema no solo detecta el problema, sugiere y aplica la solución.
- Botón "Explosionar Libro Mayor MRP" — avanza el flujo.

### 3.8 MRP — Planeación de Requerimientos de Materiales
Tres pestañas:
- **Libro Mayor MRP por Periodo**: por cada componente del BOM (con su proveedor, lead time, regla de lotificación, stock y costo), la matriz de neteo clásica de MRP — requerimientos brutos, recibos programados, balance disponible, requerimientos netos, y las órdenes planeadas de recibo/liberación (con el desfase de lead time ya aplicado).
- **Órdenes de Acción**: la lista de las 4 señales de compra que el neteo generó, cada una con tipo (Liberar Orden / Expeditar), urgencia, cantidad, proveedor y la razón de negocio explicada en una frase. Botón "Ejecutar y Transmitir" por orden, o "Ejecutar Todas" — simula el envío al EDI del proveedor.
- **Jerarquía de BOM**: el árbol indentado del producto terminado hacia sus componentes, con cantidad por padre, lead time, proveedor y costo estándar — bueno para mostrar trazabilidad multinivel si el prospecto pregunta "¿y si un componente tiene sub-componentes?".

### 3.9 Acciones de Planeación (columna derecha del Process Map)
Tres tarjetas de "próxima acción del planificador" con fecha/hora, ligadas a los mismos datos que ya viste en los módulos (la junta de aprobación de S&OP, la autorización de tiempo extra en WC-101, el expedite de la orden MOSFET) — refuerza que todo el sistema cuenta **una sola historia consistente**, no pantallas desconectadas.

---

## 4. Funcionalidades transversales (no viven en una sola pantalla)

### 4.1 Command Palette (Cmd/Ctrl+K, o clic en el buscador)
Búsqueda universal: navegación a cualquier etapa, acciones (regenerar, exportar), escenarios, y hasta entidades específicas (un SKU, un centro de trabajo). Vale la pena mostrarlo temprano en la demo — comunica que el sistema es "power-user friendly", no solo clicks.

### 4.2 Alertas y Excepciones (campana del header)
Un drawer con las 4 excepciones activas del sistema (cuello de botella CRP, faltante MRP recurrente, buffer DRP bajo, brecha S&OP pendiente de revisión), cada una con su botón de acción directa. Esta es la demostración más directa del valor de "gestión por excepción": el planificador no tiene que revisar 5 pantallas, el sistema le dice dónde mirar.

### 4.3 Comparador de Escenarios (pill de escenario / botón "Comparar Escenarios")
Tres escenarios pre-calculados lado a lado — **Base**, **Aumento de Demanda (+18%)**, **Cadena Restringida (-25%)** — cada uno con su propio volumen, meta de ingresos, carga de planta, cuellos de botella, días de suministro e índice de factibilidad. Al aplicar un escenario, **se recalculan DRP y CRP en vivo** en toda la app (revisa la Sección 3 con el escenario "Surge" activo para ver los números cambiar). Este es el equivalente demostrable del "simulador what-if" mencionado en el plan estratégico de IA — aunque aquí es determinístico, no generado por un modelo.

### 4.4 Exportar (botón del header)
Genera un archivo real (no un texto de relleno) en **CSV** o **JSON**, con los datos tal como están en pantalla en ese momento — incluyendo si ya cambiaste de escenario o editaste una celda. El JSON está pensado como "lo que un ERP real recibiría"; el CSV como "lo que un analista abriría en Excel".

### 4.5 Toggle de idioma (EN/ES, en el header)
Cambia toda la interfaz al instante, sin recargar la página. Útil para adaptar la demo sobre la marcha según quién esté en la sala.

---

## 5. Guion sugerido para una demo en vivo (8–10 min)

1. **Arranca en Process Map** (30s) — explica la cascada de 5 etapas con el embudo visual antes de tocar nada.
2. **S&OP** (1.5 min) — edita una celda de ventas, muestra cómo se recalcula el consenso y la brecha. "Aquí es donde Finanzas, Ventas y Operaciones se ponen de acuerdo una vez al mes."
3. **DRP** (1 min) — señala la red de depósitos, explica el neteo semana a semana. Opcional: dispara una transferencia entre depósitos.
4. **MPS** (2 min) — explica las zonas de tiempo, luego usa el simulador de ATP con un pedido hipotético. Este es el punto más fuerte para un VP de Ventas.
5. **CRP** (1.5 min) — muestra el cuello de botella de WC-101, aplica "Agregar Tiempo Extra" y observa la utilización bajar de 115.7% a factible. Punto fuerte para un Director de Planta.
6. **MRP** (1.5 min) — muestra el libro mayor de un componente, luego la pestaña de Órdenes de Acción, ejecuta una orden. Punto fuerte para Compras.
7. **Cierre en Process Map** (1 min) — abre el comparador de escenarios, aplica "Aumento de Demanda +18%" y deja que el prospecto vea todo el sistema reaccionar en cascada. Cierra con: "todo esto que acabas de ver editable en vivo, en tu operación real, corre con tus datos y tu ERP."

---

## 6. Preguntas frecuentes que podrían surgir

- **"¿Esto ya está conectado a un ERP?"** → No, es un prototipo con datos de ejemplo; la arquitectura real (ver plan estratégico) contempla una capa de integración desacoplada del ERP fuente.
- **"¿Dónde está la IA que mencionaron?"** → Es la siguiente fase — copiloto conversacional, agente de excepciones y resumen ejecutivo automático de S&OP. La base de datos/UI ya está lista para conectarla.
- **"¿Puedo ver mis propios datos aquí?"** → No en este prototipo (los datos son de ejemplo), pero es exactamente la discusión de piloto que abriría la siguiente conversación comercial.
- **"¿Por qué los números no cuadran con lo que yo esperaría de mi negocio?"** → Es una sola industria de referencia (manufactura de motion control) elegida para que el flujo sea reconocible; la lógica de cálculo (no los números en sí) es lo que se traslada a cualquier vertical.
