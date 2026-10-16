# Cloudflare sin VPS — Implementation Plan

> **For agentic workers:** Use native execution coordinated by the primary agent, with independent task review. The owner authorized the migration; preserve the current dirty checkout and complete reviewable work before requesting any final external authorization.

**Goal:** Preparar y validar Sarin en Cloudflare con Ollama directo y credenciales renovables, sin depender de la VPS.

**Architecture:** Pages → service binding → Worker → singleton Container Node 24; Firebase permanece. Un issuer DO accesible solo por el outbound interno emite las credenciales de federación Google.

**Tech Stack:** Node 24, pnpm 11.23.0, Next.js, Cloudflare Containers 0.3.7, Durable Objects, WebCrypto y Firebase Admin ADC.

**Spec:** [cloudflare-no-vps-design](../specs/2026-10-16-cloudflare-no-vps-design.md).

## Global Constraints

- Origen público `https://sarinbotsaas.pages.dev`; motor solo bajo `alsdevstudio.com`.
- Una instancia; cola en memoria; ningún reintento automático de POST.
- Sin claves privadas Google, ADC humano, archivos de identidad de la VPS ni contenido Vault en Cloudflare.
- Conservar datos/identidades/despliegue anteriores durante aceptación y no tocar otros servicios.
- Objetivo de costo hasta USD 15/mes; comprobar plan y estimación antes de activar consumo.
- No nuevas dependencias ni actualización de SDK sin necesidad demostrada.

## Review Focus

- Emisión de identidad para un contenedor distinto o desde una ruta pública debe fallar.
- Reinicio/rotación no puede perder la clave que firma JWT aún válidos.
- ADC no debe aceptar una fuente externa arbitraria ni claves o certificados del host.
- Un binding incorrecto debe fallar sin recurrir silenciosamente a la VPS.
- Dormir reduce costo, pero no debe cortar streams activos ni dejar trabajo habilitado sin recuperación.

## Task 1: Identidad federada

Files: `cloudflare/src/identity-core.ts`, `identity.ts`, `cloudflare/tests/identity.test.mjs`.

Interfaces: `SarinIdentity.getJwks()/mintToken()`, `handlePublicIdentityRequest`, `handleIdentityOutbound` y parser de audiencia.

- [x] Escribir y observar fallos de pruebas de firma real, claves públicas, TTL, rotación, concurrencia y rechazo de identidad ajena/rutas de emisión públicas.
- [x] Implementar ES256, almacenamiento acotado y serialización, sujetando issuer/sub/audience al spec.
- [x] Ejecutar suite focal y revisión independiente.

## Task 2: Runtime Container

Files: `cloudflare/src/router.ts`, `index.ts`, configuración y pruebas correspondientes.

- [x] Observar RED para nuevas variables, ADC sin archivos host, host de motor y recuperación de trabajo habilitado.
- [x] Integrar identidad, exportar ContainerProxy, conservar namespace singleton y añadir issuer DO privado.
- [x] Configurar dos minutos de inactividad; cron condicionado sin despertar cuando WhatsApp/retención estén apagados.
- [x] Tipar bindings y ejecutar pruebas/dry-run; revisar seguridad/costo.

## Task 3: Arranque ADC sin VPS

Files: `scripts/lib/cloudflare-credentials.mjs`, `scripts/container-start.mjs`, `Dockerfile`, pruebas.

- [x] Pruebas RED de configuración externa inválida, mezcla de modos, rutas y dominios no permitidos, y ausencia de tokens/claves en el archivo.
- [x] Crear configuración external_account de fuente interna fija en directorio temporal privado; arrancar server.js con ADC y proyecto explícito.
- [x] Probar ciclo con google-auth-library real y transporte sintético, sin contactar Google ni imprimir credenciales.

## Task 4: Pages por binding

Files: `pages-gateway/worker.mjs`, tests y `wrangler.jsonc` raíz.

- [x] RED de forwarding privado con URL pública, cuerpo/stream únicos, orígenes y configuración ambigua.
- [x] Implementar `SARIN_APP_HOST.fetch`, sin llamadas de red o credenciales de aplicación VPS en esta modalidad.
- [x] Configurar service binding y probar fallback/reversión explícitos, errores y metadatos públicos de identidad.

## Task 5: Validación y activación

- [x] Ejecutar suites, tipos, builds, dry-run y revisión independiente de cambios combinados.
- [x] Documentar ADR, costos, inventario de permisos y estado real.
- [x] Preparar configuración de Google WIF, despliegue privado y reversión sin datos reales en Git.
- [x] Confirmar permisos y plan; publicar el artefacto revisado, configurar WIF y verificar suspensión/reinicio anónimo.
- [x] Completar acceso autenticado a Google/Firestore, Ollama desde Cloudflare y lectura de citas/calendario/ICS; repetir después de suspensión/reinicio.
- [x] Retirar dependencia activa de la VPS: verificar ruta directa a la Mac, detener solo Node Sarin/timer de certificados/forward local, conservar reversión y repetir lecturas autenticadas sin el Node anterior.
- [ ] Configurar alertas de presupuesto e integrar en Git las fuentes exactas publicadas; observar expiración natural Google de una hora en el mismo proceso.
- [ ] Completar aceptación comercial de escritura y pendientes operativos del informe de preparación antes de captar tráfico abierto.

Estado real y evidencia externa: [infraestructura operativa y pendientes comerciales](../../qa/2026-10-16-cloudflare-migration.md).
