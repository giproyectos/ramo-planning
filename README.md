# Ramo Planning

Piloto de planeación para Ramo (GI Proyectos): Demanda → DRP → MPS/CRP → MRP, con capa de IA y aprobación humana antes de escribir a SAP.

- Plan completo: [docs/plan-adaptacion.md](docs/plan-adaptacion.md)
- Origen: copia sin historial de `giproyectos/demad-app@66adddf` (ese repo no se modifica).
- Estado: **Fase 0**. La UI y los datos de `apps/web` son aún los de la demo genérica (placeholder); el dominio de Ramo se construye en la Fase 1.

## Estructura
- `apps/web` — interfaz (React + Vite)
- `packages/domain` — modelo de dominio de Ramo
- `packages/engine` — motor de cálculo puro, con pruebas
- `packages/ingest` — lectura de las 3 bases SAP y Excel
- `packages/sap-out` — archivos de salida hacia SAP
- `data/synthetic` — datos sintéticos (los reales nunca se versionan)

## Comandos
```bash
npm install
npm run dev     # http://localhost:3000
npm run lint
npm test
npm run build
```
