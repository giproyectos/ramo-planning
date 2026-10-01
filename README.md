# Ramo Planning

Piloto de planeación para Ramo (GI Proyectos): Demanda → DRP → MPS/CRP → MRP, con capa de IA y aprobación humana antes de escribir a SAP.

- Plan completo: [docs/plan-adaptacion.md](docs/plan-adaptacion.md)
- Origen: copia sin historial de `giproyectos/demad-app@66adddf` (ese repo no se modifica).
- Estado: **Fase 8** (gobernanza y salida a SAP: servidor con usuarios y roles, doble control, auditoría encadenada y archivos de órdenes provisionales por planta para revisión; no se conecta a SAP) sobre las Fases 2 a 7. Todo se probó con datos sintéticos. Ver ADR [0001](docs/adr/0001-modelo-de-dominio.md), [0002](docs/adr/0002-mps-crp-fase-2.md), [0003](docs/adr/0003-ingesta-bases-sap-fase-3.md), [0004](docs/adr/0004-demanda-fase-4.md), [0005](docs/adr/0005-drp-fase-5.md), [0006](docs/adr/0006-riesgo-abastecimiento-fase-6.md), [0007](docs/adr/0007-recomendaciones-fase-7.md), [0008](docs/adr/0008-gobernanza-y-salida-a-sap-fase-8.md), [formatos de las bases](docs/formatos-bases-sap.md) y [mapeo SAP](docs/mapeo-sap.md).

## Estructura
- `apps/web` — interfaz (React + Vite)
- `apps/server` — servidor de gobernanza (Node, sin dependencias externas): usuarios, roles, espacio compartido, salida a SAP y auditoría
- `packages/governance` — roles, permisos, flujo de aprobación y auditoría encadenada (puro)
- `packages/domain` — modelo de dominio de Ramo
- `packages/engine` — motor puro: neto, CRP, ciclo, pronóstico, DRP, escasez, riesgo de abastecimiento y recomendaciones (con pruebas)
- `packages/ingest` — lectura y validación de las 3 bases SAP (CSV)
- `packages/sap-out` — archivos de salida hacia SAP: demanda (MD61) y órdenes provisionales por planta con su borrado
- `data/synthetic` — datos sintéticos (los reales nunca se versionan)

## Comandos
```bash
npm install
npm run dev     # http://localhost:3000 (interfaz)
npm run dev:server  # http://127.0.0.1:8787 (gobernanza; sin él la app corre en modo local)
npm run lint
npm test
npm run synthetic   # regenera data/synthetic/dataset.json
npm run build
```
