# Plan Estratégico — Plataforma de Gestión de la Demanda con IA
### SOP · DRP · MPS · CRP · MRP + Agentes de IA / ML

**Fecha:** 2026-09-28
**Autor:** Valentina Gómez (GI Proyectos SAS)
**Estado:** Borrador para discusión inicial

---

## 1. Visión

Construir una plataforma de planificación de la demanda y el suministro (Supply Chain Planning) que cubra el ciclo completo de planeación —**S&OP → DRP → MPS → CRP → MRP**— potenciada con **IA generativa (agentes)** y **IA/ML predictiva y de optimización**, diseñada desde el inicio para poder operar tanto como implementación dedicada a un cliente como producto SaaS multi-tenant en el futuro.

Diferenciador frente a ERPs tradicionales (SAP APO/IBP, Oracle Demantra, etc.):
- **Agentes de IA conversacionales** que asisten al planificador (explican desviaciones, preparan la reunión de S&OP, sugieren acciones).
- **IA aplicada al MRP/forecasting**, no solo reglas determinísticas: forecasting jerárquico con ML, demand sensing, optimización de inventario y capacidad.
- **Capa de integración desacoplada del ERP** (modelo canónico propio + conectores), para no depender de un solo ERP fuente.

---

## 2. Los procesos que cubre (marco conceptual)

| Proceso | Qué resuelve | Horizonte | Nivel de agregación | Output principal |
|---|---|---|---|---|
| **S&OP** (Sales & Operations Planning) | Balancear demanda y oferta a nivel ejecutivo, alinear ventas/finanzas/operaciones | 3–24 meses | Familia de producto / negocio | Plan de ventas y operaciones consensuado |
| **Forecast desagregado** | Bajar el plan agregado a SKU–ubicación | 3–18 meses | SKU / ubicación | Pronóstico estadístico + ajustado |
| **DRP** (Distribution Requirements Planning) | Reabastecer la red de distribución (CDs, bodegas regionales, tiendas) | Semanas–meses | SKU / nodo de red | Plan de reabastecimiento por ubicación |
| **MPS** (Master Production Schedule) | Qué y cuándo producir a nivel SKU en planta | Semanas | SKU / planta | Programa maestro de producción |
| **CRP** (Capacity Requirements Planning) | Validar que el MPS/MRP es factible con la capacidad instalada | Días–semanas | Centro de trabajo / línea | Plan de capacidad, cuellos de botella |
| **MRP** (Material Requirements Planning) | Explosionar BOM para definir necesidades de compra/fabricación de componentes | Días–semanas | Componente / materia prima | Órdenes planificadas de compra/producción |

**Flujo de cascada:** S&OP (agregado, mensual) → Forecast por SKU → DRP + MPS (en paralelo, red de distribución y planta) → CRP (valida capacidad) → MRP (explosiona materiales) → Órdenes de compra/producción ejecutables.

Esta cascada es el "esqueleto" funcional de todo el sistema; cada módulo consume el output del anterior y retroalimenta hacia arriba cuando hay restricciones (capacidad insuficiente, quiebre de proveedor, etc.) — ese ciclo de retroalimentación es justamente donde más valor aportan los agentes de IA (detectar el problema y proponer resolución antes de que el planificador lo note).

---

## 3. Arquitectura de la solución

### 3.1 Principios de diseño
- **API-first** y **multi-tenant desde el diseño** (aunque el primer despliegue sea single-tenant), para no rehacer la base si se decide ir a SaaS.
- **Modelo de datos canónico propio**, independiente del ERP de origen — los ERPs se integran vía adaptadores, nunca se acopla la lógica de negocio a un ERP específico.
- **Arquitectura modular por dominio** (monolito modular al inicio, con fronteras claras para poder extraer microservicios cuando el volumen lo justifique — evita sobre-ingeniería prematura).
- **Event-driven** para la sincronización entre módulos (un cambio de forecast dispara recálculo de DRP/MPS, etc.).
- **Explicabilidad**: toda recomendación de IA (forecast, orden sugerida, alerta) debe poder mostrar el "por qué" — crítico para que los planificadores confíen en el sistema.

### 3.2 Dominios / servicios funcionales
1. **Master Data** — ítems, BOM, ubicaciones, clientes, proveedores, calendarios, centros de trabajo, rutas.
2. **Demand & Forecasting** — histórico de ventas, forecast estadístico/ML, ajustes colaborativos, demand sensing.
3. **S&OP** — planes agregados, escenarios, reconciliación, resumen ejecutivo.
4. **DRP** — red de distribución, políticas de reabastecimiento, transporte/lead times entre nodos.
5. **MPS** — programación maestra, restricciones de secuenciación.
6. **CRP** — capacidad de recursos, turnos, cuellos de botella.
7. **MRP** — explosión de materiales, lotificación, órdenes planificadas.
8. **Inventory & Procurement** — políticas de stock de seguridad, punto de reorden, órdenes de compra.
9. **Integration Layer** — conectores ERP (SAP, Oracle, Dynamics), importadores CSV/Excel, webhooks/API.
10. **AI/Agents Platform** — orquestación de agentes, RAG, herramientas (tools) que exponen cada dominio.
11. **Analytics & Reporting** — KPIs (forecast accuracy, bias, fill rate, inventory turns), dashboards.
12. **Plataforma (Auth, Tenancy, Auditoría, Notificaciones)**.

### 3.3 Diagrama lógico (alto nivel)

```
                         ┌─────────────────────────┐
                         │   Frontend (Web App)     │
                         │  Planning Workbench +     │
                         │  Dashboards + Chat/Agentes│
                         └────────────┬──────────────┘
                                      │ GraphQL/REST
                         ┌────────────▼──────────────┐
                         │      BFF / API Gateway     │
                         └────────────┬──────────────┘
        ┌───────────────┬────────────┼────────────┬───────────────┐
        ▼                ▼            ▼            ▼               ▼
   ┌─────────┐    ┌───────────┐ ┌──────────┐ ┌───────────┐  ┌─────────────┐
   │ Master  │    │ Forecast/ │ │ SOP/DRP/ │ │ MRP/CRP   │  │ AI Agents   │
   │ Data    │    │ Demand    │ │ MPS      │ │ Engine    │  │ Orchestrator│
   └────┬────┘    └─────┬─────┘ └────┬─────┘ └─────┬─────┘  └──────┬──────┘
        │               │             │             │               │
        └───────────────┴──────┬──────┴─────────────┴───────────────┘
                                ▼
                    ┌──────────────────────┐        ┌────────────────────┐
                    │  Bus de eventos       │◄──────►│  Data Warehouse /   │
                    │  (Kafka/NATS)         │        │  Vector Store       │
                    └──────────┬─────────────┘        └────────────────────┘
                               ▼
                    ┌──────────────────────┐
                    │ Integration Layer      │
                    │ (SAP/Oracle/Dynamics/  │
                    │  CSV/API adapters)     │
                    └──────────────────────┘
```

---

## 4. Capa de Inteligencia Artificial

Se divide en **dos capas complementarias**: agentes de IA generativa (orquestación, razonamiento, interfaz conversacional) y ML/optimización clásica aplicada (forecasting, capacidad, inventario). Los agentes usan los modelos ML como "herramientas", no los reemplazan.

### 4.1 Agentes de IA (LLM, tool-calling)
| Agente | Función | Herramientas que usa |
|---|---|---|
| **Copiloto de planificación** | Responde preguntas en lenguaje natural sobre forecast, inventario, órdenes ("¿por qué bajó el forecast del SKU X en la región Y?") | Query engine sobre DW, RAG sobre notas/comentarios históricos |
| **Agente de excepciones** | Monitorea KPIs continuamente y alerta proactivamente (quiebres, excesos, atrasos de proveedor) antes de que el planificador lo revise | Reglas + modelos de anomalías, notificaciones |
| **Agente de preparación de S&OP** | Genera el resumen ejecutivo mensual, resalta gaps entre plan y forecast, prepara escenarios para la reunión | Motor de escenarios, generación de reportes |
| **Agente de recomendación de compras/producción** | Sugiere y justifica órdenes planificadas, prioriza en caso de restricción de capacidad o materiales | Motor MRP/CRP, reglas de negocio |
| **Agente de calidad de datos** | Detecta inconsistencias en maestros (BOM incompleto, lead times atípicos) antes de que contaminen la planeación | Validadores, modelos de anomalías |

**Orquestación:** patrón multi-agente con un orquestador central (framework tipo LangGraph / Claude Agent SDK con tool-use), cada agente especializado expone su dominio como "tools" con contratos claros. Memoria/contexto vía RAG (pgvector u otro vector store) sobre documentación, históricos de decisiones y comentarios de planificadores.

**Guardrails:** ningún agente ejecuta acciones irreversibles (lanzar una orden de compra real, por ejemplo) sin confirmación humana explícita en las primeras fases — el rol inicial es *recomendar y explicar*, no *ejecutar autónomamente*.

### 4.2 IA/ML aplicada (forecasting, capacidad, inventario)
- **Forecasting estadístico + ML jerárquico**: modelos clásicos (ETS, ARIMA) + ML (LightGBM/XGBoost) + deep learning para series largas (DeepAR, Temporal Fusion Transformer) con reconciliación top-down/bottom-up entre familia → SKU → ubicación.
- **Demand sensing**: incorporar señales exógenas (promociones, clima, precios, eventos, indicadores macro) para ajustar el forecast de corto plazo.
- **Optimización de inventario**: cálculo dinámico de stock de seguridad y punto de reorden según variabilidad de demanda y lead time (en vez de fórmulas estáticas).
- **Optimización de capacidad/secuenciación**: uso de solvers (OR-Tools, o similar) para proponer secuencias de producción que respeten restricciones de capacidad — complementa al CRP determinístico.
- **Detección de anomalías**: en demanda histórica y en datos maestros.
- **Simulación "what-if"**: escenarios de S&OP simulados (ej. "¿qué pasa si el proveedor X se atrasa 3 semanas?").

---

## 5. Modelo de datos — entidades núcleo

`Tenant/Org` · `Item/SKU` · `BOM` (multinivel) · `Location/Site` (planta, CD, tienda) · `Customer` · `Supplier` · `Work Center/Resource` · `Routing` · `Calendar` · `Demand History` · `Forecast` (versión, escenario) · `Sales Order` · `Production Order` · `Purchase Order` · `Inventory Policy` (SS, ROP, lote) · `Lead Time` · `User/Role` (RBAC por tenant)

Todo el modelo debe soportar **versionado** (forecast v1 vs v2, escenario base vs optimista) y **trazabilidad** (de dónde salió cada número: estadístico, ajuste manual, agente IA).

---

## 6. Stack tecnológico sugerido

| Capa | Propuesta | Justificación |
|---|---|---|
| Backend transaccional | Python (FastAPI) o TypeScript (NestJS) | Python facilita compartir código con la capa ML/IA; TS si el equipo ya es fuerte en JS |
| ML/Forecasting | Python: scikit-learn, LightGBM, Nixtla (statsforecast/mlforecast), PyTorch | Ecosistema maduro y con buen soporte de forecasting jerárquico |
| Agentes IA | Claude Agent SDK / LangGraph + tool-calling | Orquestación multi-agente con buen soporte de tools y memoria |
| Optimización | Google OR-Tools (o Gurobi si el presupuesto lo permite) | Estándar de facto para scheduling/capacidad |
| Base transaccional | PostgreSQL | Robusta, soporta pgvector para RAG sin sumar otro store |
| Analítica | ClickHouse o Snowflake/BigQuery (según volumen) | Consultas OLAP rápidas sobre históricos grandes |
| Bus de eventos | NATS o Kafka (Kafka si el volumen/los conectores lo justifican) | Desacople entre módulos |
| Frontend | React + Next.js, TanStack Table (grillas tipo Excel), Recharts/D3 | UX de planeación requiere grillas editables + visualización |
| Infra | Docker + Kubernetes, Terraform, CI/CD | Portabilidad multi-cloud, necesario si se va a SaaS |

---

## 7. Roadmap por fases

**Fase 0 — Discovery (4–6 semanas)**
Definir vertical/cliente piloto, casos de uso prioritarios, modelo de datos canónico, decisión arquitectónica final, y **decidir el modelo de negocio** (interno vs SaaS) con datos reales del piloto — hoy queda abierto, pero conviene cerrarlo antes de escalar el equipo.

**Fase 1 — MVP (3–4 meses)**
Master data + Forecasting estadístico + Dashboard de S&OP + carga vía CSV/API genérica + 1 conector ERP piloto. Primer agente: copiloto de consulta (Q&A sobre forecast/inventario).

**Fase 2 (3–4 meses)**
DRP + MPS + Planning workbench colaborativo (ajustes manuales al forecast con trazabilidad) + Agente de preparación de S&OP.

**Fase 3 (3–4 meses)**
CRP + MRP + explosión de BOM + recomendación de compras/producción + Agente de excepciones proactivo.

**Fase 4 (3+ meses)**
ML avanzado (demand sensing, deep learning, optimización de inventario) + hardening multi-tenant si se confirma ruta SaaS + más conectores ERP.

**Fase 5 — Escalamiento comercial**
Certificaciones de seguridad (SOC2/ISO si aplica a SaaS), marketplace de conectores, expansión de agentes autónomos (con acciones ejecutables, no solo recomendaciones).

---

## 8. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Calidad de datos maestros deficiente ("garbage in, garbage out") | Agente de calidad de datos desde Fase 1; validaciones duras antes de correr MRP |
| Baja adopción por parte de planificadores | Copiloto conversacional + explicabilidad de cada recomendación; involucrar planificadores desde el piloto |
| Complejidad de integraciones ERP heterogéneas | Modelo canónico propio + capa de adaptadores; no acoplar lógica de negocio a un ERP |
| Costo/latencia de agentes LLM a escala | Usar LLM solo donde aporta razonamiento; cálculos masivos (MRP, forecasting) siguen en motores determinísticos/ML clásicos |
| Indecisión SaaS vs interno retrasa arquitectura | Diseñar multi-tenant desde el inicio (bajo costo si se hace temprano) sin comprometerse aún al modelo comercial |
| Confianza en recomendaciones de IA | Ningún agente ejecuta acciones irreversibles sin aprobación humana en fases iniciales |

---

## 9. Próximos pasos inmediatos

1. Definir el **caso de uso piloto** (industria, tamaño, si hay ERP fuente disponible para pruebas).
2. Cerrar el **modelo de datos canónico** (versión inicial de las entidades de la sección 5).
3. Prototipo técnico: forecasting estadístico básico + carga de datos vía CSV, sin IA todavía, para validar el pipeline de datos de punta a punta.
4. Elegir framework de agentes y hacer un spike del **copiloto conversacional** sobre datos de prueba.
5. Definir estructura de repos/proyecto (monorepo vs multi-repo) y stack definitivo con el equipo técnico.
