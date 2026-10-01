# ADR 0008 — Gobernanza y salida a SAP (Fase 8)

**Estado:** implementado con datos sintéticos y archivos **para revisión**. No hay conexión con SAP ni se ha probado ningún archivo contra el cargue real · **Fecha:** 2026-10-01
**Código:** `packages/governance` (roles, flujo, auditoría) · `packages/sap-out/src/provisionalOrders.ts` · `apps/server` (Node, sin dependencias externas) · `apps/web/src/ramo/{api,auth}.ts*`, `components/ramo/{LoginScreen,ReleaseView}.tsx`

## Qué se implementó
1. **Servidor de gobernanza** (Node, `node:http`, sin librerías): usuarios con contraseñas con hash (scrypt), tokens firmados (HMAC-SHA256) con vencimiento, límite de intentos fallidos por usuario, cabeceras de seguridad, cuerpos acotados, y rutas de usuarios, espacio de trabajo compartido, propuestas de salida y auditoría.
2. **Roles por capa** (`Demanda`, `Producción/capacidad`, `Distribución/MPS final`, `Compras`, `Administración`, `Consulta`) con una matriz de permisos única que usan el servidor (para autorizar) y la interfaz (para habilitar botones). La interfaz nunca es la barrera: el servidor revisa cada sección que cambia y cada transición de etapa.
3. **Espacio de trabajo compartido y persistente**: bloques de demanda, decisiones de capacidad, ajustes del MPS, decisiones de recomendaciones, plazos aprobados, etapa del ciclo y registro. Se guarda solo (con control de revisión: si dos personas guardan sobre la misma versión, gana una y la otra recibe conflicto) y se recarga al entrar. Resuelve el límite "los datos viven en memoria" de las fases 4 a 7.
4. **Flujo de salida a SAP** con doble control: se propone, se aprueba y se publica; solo lo aprobado sale y los archivos llevan hash (lo aprobado es exactamente lo publicado). Cada aviso del plan (capacidad en rojo, inventario no SAP, quiebres, duplicados) exige una justificación escrita para poder proponer.
5. **Órdenes provisionales por planta** (`buildProvisionalOrders`): una orden por SKU y semana, fechada el último día con horas de su línea, con referencia trazable `REL-n|centro|SKU|semana`, y un archivo de **borrado** de las órdenes de la publicación anterior (desde la primera semana del plan nuevo), para no duplicar necesidad. Es lo que reemplaza el cargue manual por planta con LSMW.
6. **Auditoría encadenada**: cada entrada incluye el hash de la anterior; modificar, borrar o reordenar una rompe la cadena y se detecta al verificarla (también tras un reinicio y editando el archivo en disco).
7. **Vista "Salida a SAP"**: verificaciones previas, propuesta, aprobación, publicación, descarga, auditoría, verificación de la cadena y administración de usuarios. En modo local (sin servidor) todo sigue funcionando para análisis, pero no hay salida a SAP.

## Reglas de gobernanza
- **Quien propone aprueba la capa de su rol** (Miguel propone = capacidad; Daniel propone = MPS) y **otra persona aprueba la otra**; **publica alguien distinto de quien propuso**. Así bastan dos personas y siempre hay dos distintas.
- Una sola propuesta abierta a la vez; rechazar exige motivo (≥ 10 caracteres) y se puede hasta antes de publicar.
- Una publicación nueva reemplaza a la anterior, y el servidor **verifica que la propuesta borre exactamente las órdenes de la anterior** que caen desde su primera semana (ni más ni menos); si no, se rechaza.
- Antes de publicar se recalculan los hashes: si el contenido guardado cambió después de aprobarse, no se publica y queda auditado.

## Errores míos que encontré mientras lo construía
- **Interbloqueo con dos personas:** el primer diseño exigía aprobar ambas capas con personas distintas de quien propone y publicar solo por Distribución. Con solo Miguel y Daniel, el proceso se bloqueaba. Se corrigió con la regla de arriba.
- **Identidad compartida entre peticiones:** guardé el usuario autenticado en una variable del servidor; con peticiones simultáneas se habría pisado y una acción podría ejecutarse como otro usuario. Se corrigió pasando el usuario con cada petición y se agregó una prueba de concurrencia (40 peticiones simultáneas de dos roles distintos).
- **Fechas imposibles que pasaban la validación:** `Date.parse` acepta "31.02.2026" y lo corre a marzo; un archivo con esa fecha se habría aceptado. Se valida ahora con ida y vuelta (en el archivo de órdenes y en el de demanda).
- **Pruebas de mutación:** se apagaron a propósito la revisión de conflictos, el control de integridad, la verificación de borrados, el doble control y el enlace de la cadena de auditoría, y las pruebas fallaron en cada caso.

## Límites y riesgos que hay que conocer (importante)
- **No se conecta a SAP.** Los archivos son para revisar y cargar con LSMW. El formato de columnas, el tipo de orden `LA`, la unidad `CJ` y el "factor de cantidad" (por ahora 1) son **supuestos sin probar** contra el cargue real; el canal automático sigue roto tras la migración (pendiente con Alfredo/ABAP).
- **El servidor no recalcula el plan.** Valida la forma y la integridad de los archivos y garantiza que lo aprobado es lo publicado, pero **no sabe si las cantidades son las correctas**: eso depende del motor del cliente y de que los aprobadores revisen los archivos (se pueden ver y descargar antes de aprobar). Recalcular en el servidor es la mejora de seguridad más importante pendiente.
- **No es un sistema de producción.** Falta: HTTPS (hoy http local; debe ir detrás de TLS), cambio y restablecimiento de contraseñas, desactivar usuarios, revocar sesiones antes de vencer (el cierre de sesión es solo del lado del cliente), copias de seguridad, cifrado en reposo (el secreto de firma y los hashes viven en `state.json`) y varias instancias (el almacenamiento es de un solo proceso). El token vive en `sessionStorage` (expuesto a XSS).
- **El registro del ciclo en la pantalla es informativo, no probatorio:** lo escribe el cliente y cualquier usuario puede añadir entradas con el nombre que quiera. La evidencia es la **auditoría del servidor** (quién autenticado hizo qué), no ese registro.
- **La auditoría es evidencia de integridad, no no-repudio:** detecta manipulación, pero no prueba criptográficamente quién actuó (eso exigiría firmas con llaves de cada persona).
- **Credenciales de desarrollo:** el servidor genera contraseñas aleatorias en el primer arranque y las deja en `data/private/server/dev-credentials.json` (ignorado por git). Nada de eso va al repositorio.
- **Conflictos de guardado:** la experiencia es mínima (avisa y hay que recargar; lo local no guardado se pierde).
- **Roles y nombres reales de Ramo:** los usuarios iniciales (diana, miguel, daniel…) son de demostración; los roles y permisos hay que validarlos con Ramo (¿quién publica realmente? ¿Alejandro aprueba?).

## Criterio de aceptación pendiente
Que Alfredo (SAP/ABAP) cargue un archivo de órdenes provisionales de prueba en un ambiente de desarrollo de SAP y confirme que el formato es el correcto, que el borrado de la publicación anterior funciona y que el MRP de SAP ve la necesidad una sola vez.
