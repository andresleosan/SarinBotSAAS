# Cloudflare Data Implementation Plan

> **For agentic workers:** Ejecutar en esta sesión con delegación independiente y revisión final. El usuario aprobó proceder sobre la distribución D1/R2/Firebase Auth presentada; conservar el checkout mixto y no pedir de nuevo autorización de alcance.

**Goal:** Mover datos comerciales y comprobantes de Firestore a D1/R2 conservando usuarios Google y comportamiento de Sarin.

**Architecture:** Next mantiene la lógica y usa una interfaz documental acotada; un bridge privado de Worker ejecuta consultas y commits CAS atómicos en D1 y almacena imágenes en R2. El navegador consulta APIs con Firebase ID tokens.

**Tech Stack:** Node 24, pnpm 11.23.0, TypeScript, Cloudflare D1/R2, SDK Containers 0.3.7, Firebase Auth.

**Spec:** [Diseño de datos](../specs/2026-10-16-cloudflare-data-design.md).

## Global Constraints

- Origen `https://sarinbotsaas.pages.dev`; motor solo `alsdevstudio.com`; una réplica.
- USD 15/mes como presupuesto objetivo; no aumentar plan/capacidad; no secretos o exports en Git.
- Mantener UID, lógica comercial, Vault local, WhatsApp apagado y cambios previos del checkout.
- No borrar Firestore ni devolver tráfico a su copia obsoleta tras nuevas escrituras D1.

## Review Focus

- Dos clientes reservan la misma hora o consumen la última unidad: solo uno confirma.
- Inserción concurrente entre query y commit: revisión conflictiva y callback reejecutado.
- Respuesta perdida tras commit: repetir UUID conserva resultado sin doble efecto.
- Cambio de usuario/negocio en UI: respuesta anterior no revela datos de otra sesión.
- R2 falla o CAS aborta: ninguna referencia nueva queda sin blob; huérfanos privados no se borran sin política.

## Task 1: Contrato y bridge D1/R2

Files: `shared/data-protocol.ts`, `cloudflare/src/data.ts`, `cloudflare/migrations/0001_data.sql`, `cloudflare/tests/data.test.mjs`, config/bindings.

- [x] RED de comandos inválidos, guardas singleton, queries parametrizadas, snapshots/revisión, commit atómico e idempotente y fallos de blob.
- [x] Implementar `executeDataCommand(command, env)` y `handleDataOutbound(request, env, ctx)` con protocolo compartido; crear esquema/indexación/guard SQL.
- [x] Probar contra D1/R2 locales reales y revisar límites/costo/seguridad.

## Task 2: Adaptador Node y lógica comercial

Files: `src/lib/storage/database.ts`, `src/lib/storage/types.ts`, `src/lib/firebase/admin.ts`, imports de tipos en módulos servidor, pruebas de almacenamiento/integración.

- [x] RED de lecturas, merge, idempotencia, conflictos de snapshot/commit y fallos de transporte.
- [x] Implementar `createCloudflareDatabase(transport?)`, API propia collection/doc/query/transaction; backend explícito `SARIN_DATA_BACKEND=d1|firestore` sin fallback silencioso.
- [x] Mantener Auth Firebase separado; verificar lógica existente y escenarios concurrentes sobre SQLite/bridge real.

## Task 3: APIs y vistas sin listeners Firestore

Files: endpoints de negocio público/propio y citas, `src/lib/client` refresco acotado, cuatro vistas/listeners, cliente Firebase y sus pruebas.

- [x] RED de permisos, parámetros, suspensión/reanudación y callbacks obsoletos.
- [x] Reemplazar listeners por APIs que conservan filtros servidor; Firebase cliente solo Auth.
- [x] Verificar agenda, cliente, carga/error, cancelación y calendario.

## Task 4: Copia, importación y reversión

Files: `scripts/cloudflare-data-migration.mjs`, helpers de export/import verificados y runbook.

- [x] Probar conversión Firestore, rutas recursivas, hash/conteos, imágenes y rechazo de tipos no soportados sin pérdida.
- [x] Crear backup privado verificable e importación repetible sin exponer datos en shell/logs; inspeccionar permisos y tarifas.
- [x] Ensayar restauración y la condición de no revertir sobre escrituras D1 más nuevas.

## Task 5: Validación y corte

- [x] Ejecutar tipos, suites, builds, imagen y revisión independiente de cambios combinados.
- [x] Publicar recursos/artefactos autorizados; mantenimiento/export final/import/verificación/cambio de backend.
- [x] Verificar sesión real, citas existentes y administración desde Cloudflare; dejar evidencia y estado exacto de Git/alertas/reversión en `docs/qa/2026-10-16-cloudflare-data-migration.md`.
- [ ] Repetir salud e inferencia de Ollama cuando el propietario pueda encender el Mac. Túnel Down, cero réplicas; el propietario confirmó que no puede encenderlo durante el corte. No bloquea la aceptación de datos, que permanece independiente de la IA.
