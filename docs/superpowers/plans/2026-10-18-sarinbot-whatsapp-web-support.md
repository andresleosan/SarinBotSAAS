# SarinBot Web Support Synchronization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recibir consultas de soporte de la web, verlas actualizadas y avisar al titular por WhatsApp.

**Architecture:** Hilos de plataforma con propietario Firebase, mensajes inmutables y orden asignado transaccionalmente. Vistas privadas con polling incremental; avisos mínimos utilizan la outbox de A3/A5 y un destinatario vinculado y autorizado, distinto del Business sender.

**Tech Stack:** Next/React, TypeScript, Firebase Auth, Database/D1, polling existente, cliente YCloud de plataforma.

**Spec:** [Diseño aprobado](../specs/2026-10-18-sarinbot-whatsapp-audio-menus-design.md), [coordinador/restricciones](2026-10-18-sarinbot-whatsapp-adaptation.md). Depende de A1/A3/A5; notificaciones privadas consumen B1.

## Global Constraints

Restricciones del coordinador y «Crear un dominio de soporte de plataforma con identidad Firebase y permisos propios». «Primera notificación: resumen mínimo y enlace privado». «Una conversación web no abre por sí sola una ventana de atención de WhatsApp». Consulta cada cinco segundos mientras la vista esté visible; cuerpos cifrados 24 horas y control 30 días.

## Review Focus

Hilo de otro UID adivinado (C1); envío repetido con cuerpo cambiado (C1); dos mensajes con la misma hora o llegada retrasada (C1/C2); cuenta cambiada o respuesta HTTP tardía (C2); aviso al propio número Business o fuera de ventana (C3).

### C1: Hilos, mensajes y lectura autorizada

**Files:** Crear `shared/platform-support-records.ts`, `src/types/platform-support.ts`, `src/lib/server/platform-support.ts`, `src/app/api/platform-support/conversations/route.ts`, `src/app/api/platform-support/conversations/[id]/messages/route.ts`, `src/app/api/admin/platform-support/conversations/route.ts`, `src/app/api/admin/platform-support/conversations/[id]/messages/route.ts`, `tests/platform-support.test.ts`, `tests/platform-support-routes.test.ts`. Modificar allowlist, índices y retención.

**Interfaces:** `SupportMessageInput={requestId:string;expectedRevision:number;text:string}`; `SupportMessageView={id:string;sequence:number;author:'customer'|'admin';text:string|null;createdAt:number;expiresAt:number}`; `SupportPage={messages:SupportMessageView[];cursor:string|null;hasMore:boolean;revision:number;observedAt:number}`. Crear `createSupportConversation(uid:string,requestId:string,db?:Database):Promise<{id:string;revision:number}>`, `appendSupportMessage(actor:{uid:string;role:'customer'|'admin'},conversationId:string,input:SupportMessageInput,db?:Database):Promise<{id:string;sequence:number;revision:number}>`, `readSupportMessages(actor:{uid:string;role:'customer'|'admin'},conversationId:string,cursor:string|null,db?:Database):Promise<SupportPage>`. Todas las rutas deciden actor por token/requireSuperadmin, no body.

- [ ] Pruebas rojas de 401/403 antes de lecturas, consentimiento ausente, UID ajeno sin filtración por cursor, requestId repetido igual=id mismo y distinto=409, dos mensajes misma fecha con secuencias consecutivas y máximo cien por página. Texto límite 4096; crear hilo no produce envío por WhatsApp.
- [ ] Ejecutar `node node_modules/vitest/vitest.mjs run tests/platform-support.test.ts tests/platform-support-routes.test.ts`, observar fallo; implementar `platformSupportConversations` y `platformSupportMessages`, cifrado/AAD y anclas de cuenta/soporte. Asignar secuencia incremental y revisión en la transacción de mensaje; cursor opaco firmado ligado a UID/hilo y secuencia, sin teléfonos ni texto. No usar paginación basada solo en fecha ni el chat tenant.
- [ ] Aplicar expiración en lectura/escritura; borrar cuerpos/contactos a 24h y control a 30d sin extender por actividad. Mensaje nuevo y entrega pendiente C3 serán atómicos; no simular notificación por guardar un hilo. Respuestas web humanas no reactivan automáticamente un bot de WhatsApp vinculado.
- [ ] Probar D1 real: concurrencia, límite de página, índices y limpieza; suites/typecheck y commit `feat: add authenticated platform support threads`.

### C2: Chat web y bandeja incremental

**Files:** Crear `src/app/soporte/page.tsx`, `src/components/platform-support-chat.tsx`, `src/components/admin-platform-support.tsx`, `tests/platform-support-ui.test.tsx`. Modificar `src/app/ayuda/page.tsx`, `src/app/admin/assistant/page.tsx`, `src/lib/client/api-polling.ts`, `src/lib/client/use-api-poll.ts` y pruebas de polling existentes.

**Interfaces:** Ampliar `startApiPolling(load,onValue,onError,options?:{intervalMs?:number})` y `useApiPoll(scope,load,options?:{intervalMs?:number})`; default conserva 15.000 ms existentes, soporte usa 5.000. `scope` incluye UID+hilo+revisión de permiso. Consumir SupportPage de C1, acumular por ID y ordenar por sequence.

- [ ] Pruebas rojas con timers: soporte programa `5_000`, vistas existentes `15_000`; hidden detiene y volver visible refresca; cambio de UID o revocación vacía la vista antes de efectos, respuesta tardía no publica; páginas repetidas no duplican mensajes y hasMore se drena acotadamente antes del próximo intervalo.
- [ ] Ejecutar suites de polling y UI, observar fallo; implementar opción y vistas de cliente/admin, envío con requestId estable hasta confirmación, manejo de 409 y contenido expirado. No mezclar hilos ni mostrar texto antiguo tras error. Mostrar enviado/pending/blocked según estado durable, sin prometer entrega en WhatsApp por aceptación web.
- [ ] Añadir enlaces desde Ayuda y asistente admin; verificar consentimiento explícito, estados de carga/vacío/error, etiquetas, foco y anuncio de mensajes nuevos sin robar foco. Polling solo lecturas; las mutaciones son acciones del usuario.
- [ ] QA sintético escritorio/320 px y teclado, suites/typecheck/build; commit `feat: synchronize platform support views incrementally`.

### C3: Avisos mínimos al titular y vínculo entre canales

**Files:** Crear `src/lib/server/platform-support-notifications.ts`, `src/app/api/admin/platform-support/notifications/route.ts`, `tests/platform-support-notifications.test.ts`; modificar C1, trabajo/outbox A3, bandeja C2 y configuración privada de vínculo A1. Ruta GET muestra estado enmascarado; PATCH requireSuperadmin acepta solo el input de configuración declarado abajo.

**Interfaces:** `configurePlatformSupportRecipient(actor:DecodedIdToken,input:{linkId:string;expectedRevision:number;requestId:string},db?:Database):Promise<{revision:number}>`; `prepareSupportNotification(tx:Transaction,input:{conversationId:string;messageId:string;authorUid:string;at:number},db:Database):Promise<{state:'pending'|'blocked';outboxId:string|null}>`; el remitente siempre es el Business scope, destinatario solo del vínculo privado verificado y vigente. No aceptar `to` desde el cliente.

- [ ] Pruebas rojas: destino igual a Business, vínculo ajeno/no admin/revocado o consentimiento vencido bloquean; mensaje web sin entrada WhatsApp real no abre ventana; fuera de 24h queda blocked sin llamadas; mismo mensaje produce una sola salida; revocar/reaceptar no revive aviso; proyección no incluye cuerpo, remitente, imagen o email del cliente.
- [ ] Ejecutar `node node_modules/vitest/vitest.mjs run tests/platform-support-notifications.test.ts tests/platform-support.test.ts`, observar fallo; titular selecciona y verifica su propio número al configurar, sin inferirlo del teléfono de prueba. Guardar referencia al vínculo y revisión, no teléfono en claro. Asociar hilos/canales solo por UID y vínculo confirmado, nunca por nombre ni teléfono escrito en una consulta.
- [ ] Incorporar `prepareSupportNotification` dentro de la transacción de append: copy fijo «Tienes una nueva consulta de soporte en SarinBot. Revísala en tu panel.» y enlace privado al hilo. Guardar la notificación pending o blocked junto al mensaje; al reclamar y antes de red validar de nuevo actor/link/ventana/conexión/presupuesto. Tras consumir, mostrar estado de entrega y actualizar bandeja; no reenviar conversación completa.
- [ ] Sin ventana, ofrecer abrir WhatsApp e iniciar consulta al bot desde el número privado para habilitar nuevos avisos; no reproducir antiguos automáticamente. Plantillas fuera de ventana quedan deshabilitadas hasta configuración y revisión específicas, sin contratar ni enviar una aquí.
- [ ] Probar D1 real de mensaje+intención atómicos, carrera con revocación y caída de proveedor=unknown, suites/typecheck/QA; commit `feat: notify verified administrators about web support`. Ensayo con destinatario real solo en P2 autorizado.
