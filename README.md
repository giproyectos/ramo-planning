# Ramo Planning

Piloto de planeación para Ramo (GI Proyectos): Demanda → DRP → MPS/CRP → MRP, con capa de IA y aprobación humana antes de escribir a SAP.

- Plan completo: [docs/plan-adaptacion.md](docs/plan-adaptacion.md)
- Origen: copia sin historial de `giproyectos/demad-app@66adddf` (ese repo no se modifica).
- Estado: **Fase 7** (capa de recomendaciones sobre el MRP: prioridad, ajuste por variabilidad, plazos dinámicos, cuota reguladora, anomalías y consolidación, con aprobación humana; sin modelo de lenguaje) sobre las Fases 2 a 6. Todas las vistas usan el motor. Todo se probó con datos sintéticos. Ver ADR [0001](docs/adr/0001-modelo-de-dominio.md), [0002](docs/adr/0002-mps-crp-fase-2.md), [0003](docs/adr/0003-ingesta-bases-sap-fase-3.md), [0004](docs/adr/0004-demanda-fase-4.md), [0005](docs/adr/0005-drp-fase-5.md), [0006](docs/adr/0006-riesgo-abastecimiento-fase-6.md), [0007](docs/adr/0007-recomendaciones-fase-7.md), [formatos de las bases](docs/formatos-bases-sap.md) y [mapeo SAP](docs/mapeo-sap.md).

## Estructura
- `apps/web` — interfaz (React + Vite)
- `packages/domain` — modelo de dominio de Ramo
- `packages/engine` — motor puro: neto, CRP, ciclo, pronóstico, DRP, escasez, riesgo de abastecimiento y recomendaciones (con pruebas)
- `packages/ingest` — lectura y validación de las 3 bases SAP (CSV)
- `packages/sap-out` — archivos de salida hacia SAP (MD61 de demanda)
- `data/synthetic` — datos sintéticos (los reales nunca se versionan)

## Comandos
```bash
npm install
npm run dev     # http://localhost:3000
npm run lint
npm test
npm run synthetic   # regenera data/synthetic/dataset.json
npm run build
```
