# SarinBot WhatsApp Adaptation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adaptar el chatbot de ALS a SarinBot para soporte con audios/menús, administración privada y soporte web sincronizado.

**Architecture:** Mantener el receptor propio de SarinBot y añadir servicios de plataforma con identidad Firebase, autorizaciones revocables y trabajos D1. Tres planes dependientes producen entregas comprobables sin compartir datos, credenciales o backend de ALS. El canal productivo permanece apagado hasta sus comprobaciones y activación específica.

**Tech Stack:** Node 24, pnpm 11.23.0, Next.js/TypeScript, Firebase Auth, adaptador Database/D1 existente, Cloudflare Containers/Workers AI, Vitest y Node test runner.

**Spec:** [Diseño aprobado](../specs/2026-10-18-sarinbot-whatsapp-audio-menus-design.md). Aprobación del titular recibida el 18 de octubre de 2026. Ejecución con agentes elegida previamente; se conserva.

## Global Constraints

- «Conservar WhatsApp Business App en coexistencia y el canal propio de SarinBot, en YCloud Free.»
- «No copiar secretos, historial ni registros de ALS.»
- «La transcripción es contenido de una consulta. Nunca prueba identidad, acepta documentos ni autoriza un pago».
- «Conservar contacto y contenido cifrados hasta 24 horas; metadatos mínimos de control hasta 30 días»; constancias legales por política separada.
- «El audio bruto se procesa en memoria y no se conserva en R2 ni en la bandeja.»
- «Una instancia de aplicación sigue siendo el límite existente.» No activar keepalive permanente, recargas ni plan superior.
- Nombre visible exacto SarinBot. Motor únicamente bajo `alsdevstudio.com`. Preservar lockfile y archivos ajenos.
- La aprobación del plan autoriza implementación aislada y pruebas sintéticas; no sustituye confirmaciones concretas para accesos, condiciones, gasto o activación productiva nueva.

## Review Focus

1. Revocar y volver a aceptar no debe reactivar un trabajo antiguo: contrato probado en A3/A5.
2. Un audio que diga «acepto» o «aprueba» jamás ejecuta controles: A2/A4 y B2.
3. Reiniciar después de que el proveedor acepte un envío no debe duplicarlo: A3/A5.
4. Cambiar de cuenta o cerrar la pestaña no debe mostrar una respuesta privada tardía: C2.
5. Una revisión manual concurrente no debe aplicar dos veces cupos/periodos: B2.

## Secuencia y entregables

| Orden | Plan | Entrega comprobable |
| --- | --- | --- |
| 0 | Tareas P0/P1 de este documento | Base aislada y cierre de recepción/coexistencia existente |
| 1 | [A: chatbot y autorización](2026-10-18-sarinbot-whatsapp-chatbot.md) | Consentimiento/vínculo, audios, menús, trabajos durables y soporte público, desactivados por defecto |
| 2 | [B: administración](2026-10-18-sarinbot-whatsapp-admin.md) | Consultas privadas y propuestas de pago con confirmación web |
| 3 | [C: soporte web](2026-10-18-sarinbot-whatsapp-web-support.md) | Hilos web privados, actualización incremental y avisos al titular |
| 4 | P2 de este documento | QA final, artefacto revisable y activación gradual autorizada |

P0 precede cambios de código. P1 es una operación independiente del desarrollo aislado; debe completarse antes de cualquier automatización productiva. No bloquear pruebas sintéticas de A/B/C por disponibilidad del teléfono, ni etiquetar P1 como terminado con evidencia simulada. Ejecutar tareas en orden de dependencia; revisores independientes por tarea y revisión final según el método ya elegido.

### P0: Base reproducible para toda la adaptación

**Files:** Crear `docs/qa/2026-10-18-whatsapp-adaptation-baseline.md` y un paquete de ejecución local fuera de las carpetas compartidas. Conservar el diseño y estos cuatro planes como documentos fuente.

**Interfaces:** Produce manifiesto de archivos/SHA y rutas `source`, `reference`, `evidence` del paquete. `source` parte de la versión SarinBot publicada, no del HEAD incompleto del directorio compartido; `reference` contiene solo módulos públicos de ALS y pruebas sintéticas, con commit fuente.

- [ ] Verificar versiones actuales y comparar publicación/configuración con el último paquete de marca; si hay cambios posteriores, incorporarlos antes de construir. No restaurar secretos desde archivos ni imprimirlos.
- [ ] Leer using-git-worktrees y preparar checkout/paquete aislado, respetando las reglas de cada repositorio. La referencia ALS es solo lectura. Inicializar Git local en la copia de ejecución si el origen congelado carece de `.git`; no añadir archivos privados.
- [ ] Ejecutar en el paquete `node node_modules/typescript/bin/tsc --noEmit`, `node node_modules/vitest/vitest.mjs run` y las cuatro suites ALS ya identificadas. Guardar resultados; una falla de base se resuelve o registra antes de atribuirla a cambios nuevos. Usar dependencias bloqueadas existentes; no reinstalar enlaces compartidos.
- [ ] Registrar árbol limpio de ejecución y manifiesto. Commit exclusivo: `docs: record WhatsApp adaptation baseline`.

### P1: Comprobar recepción y coexistencia, sin automatización

**Files:** Continuar el registro local `whatsapp-platform-20261018/source/.superpowers/sdd/2026-10-18-ycloud-free-platform/coexistence-live-progress.md` y `retry-observer-20261018/source/docs/ycloud-retry-diagnostic.md`. No añadir código diagnóstico nuevo ni cambiar la política de firma ±300 segundos.

**Interfaces:** Produce hechos separados `retryCompatible`, `signedInboundPersisted`, `humanEchoPersisted`, `pauseVerified`, `disconnectVerified`, con fechas y referencias privadas. No publica teléfonos de prueba ni contenido.

- [ ] Preparar y revisar configuración temporal/rollback a partir de la versión productiva fresca; verificar agentes y Journeys del proveedor y coordinar ventana tranquila de la compañía. Mantener IA/envío normales apagados. El número de prueba ya acordado no acredita un administrador.
- [ ] Ejecutar el procedimiento de observación aprobado solo al estar listo el titular: una entrada real con firma válida y mismo hash/ID reintentada después de más de 300 segundos, reloj real y firma renovada. Incompatible/inconcluso mantiene recepción normal apagada. Limpiar tuplas/secretos temporales y reiniciar memoria en la misma sesión; fijar eliminación de la exportación privada antes de generarla.
- [ ] Si es compatible, preparar retención/cifrado/ámbito propios y recepción humana; registrar la conexión exacta con la API administrativa existente. Probar entrada, duplicado y eco manual desde Business App. No pedir ni importar historial.
- [ ] Probar pausa y desconexión registrada sin nuevos efectos; documentar los hechos pendientes. Desactivar el endpoint al cerrar una prueba fallida. No afirmar que desactivarlo cancela reintentos ya encolados.

### P2: QA, revisión y activación de entregas terminadas

**Files:** Crear `docs/qa/2026-10-18-whatsapp-adaptation.md`, ampliar `STACK.md`, `.env.local.example`, `cloudflare/README.md` y runbook de producción solo en el paquete candidato. Versionar configuración sin valores secretos.

**Interfaces:** Consume los resultados de A/B/C y P1. Produce manifiesto del candidato, tabla de capacidades verificadas y rollback que conserva limpieza de datos existentes.

- [ ] Ejecutar suites focalizadas y luego una corrida completa: `pnpm run typecheck`, `pnpm test`, `pnpm run build`, `pnpm --filter sarin-cloudflare-host run check`; proceso con verificación de dependencias desactivada si los enlaces existentes lo requieren. No usar producción para resolver pruebas que fallan localmente.
- [ ] Completar security-baseline, self-critique-loop y revisión independiente. QA autenticado sintético escritorio/320 px, teclado, foco, consentimiento, vínculo, salida, permisos privados y propuesta de pago. Registrar reporte y capturas sin datos reales.
- [ ] Verificar contrato vigente YCloud para estados, offboarding y consulta de cuenta exacta; implementar reconciliación en A5. Sin evidencia contractual y comprobación de desconexión, la automatización permanece bloqueada aunque el resto del código esté publicado.
- [ ] Documentar presupuesto real de audio/IA/envíos y alertas, alcance global de una eventual key Free, destinatario privado y costo de mensajes/plantillas. Por defecto presupuesto nuevo cero y flags apagados; ninguna recarga automática. Presentar candidato y cambios productivos concretos al titular conforme deploy-checklist.
- [ ] Tras autorización aplicable: backup/mantenimiento/drenaje, publicación aislada con automatización apagada y verificación. Activar primero recepción, luego piloto de clientes consentidos y titular vinculado, con destinatarios/acciones concretos. Probar audio y botones reales, intervención humana, revisión de pago confirmada por el titular y reflejo web. No enviar pruebas por API antes de identificar destinatario y propósito autorizados.
- [ ] Rollback: apagar entrada/transcripción/IA/envío y endpoint si corresponde, cancelar pendientes; mantener retención compatible hasta expiración. Volver al artefacto previo comprobado sin abandonar cuerpos nuevos ni revertir cambios de otros proyectos. Registrar capacidades logradas y pendientes por separado.

## Handoff

Este plan requiere revisión del titular antes de implementación; conservar la ejecución con agentes ya elegida. Próxima acción tras aprobación: P0, revisión independiente y A1; coordinar P1 sin saltar sus requisitos ni pedir otra vez los datos de teléfono ya confirmados.
