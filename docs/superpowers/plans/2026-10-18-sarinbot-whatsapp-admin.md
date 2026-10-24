# SarinBot WhatsApp Administration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consultar SarinBot privadamente por WhatsApp y preparar revisiones de suscripciones confirmables en el panel.

**Architecture:** Usar PlatformActor verificado y los servicios administrativos existentes. Separar el asistente de consulta de las propuestas deterministas: el modelo no ejecuta mutaciones. Confirmación y revisión de pago comparten una transacción.

**Tech Stack:** Firebase Admin, TypeScript/Next, Database/D1, Vitest, UI React existente.

**Spec:** [Diseño aprobado](../specs/2026-10-18-sarinbot-whatsapp-audio-menus-design.md), [coordinador/restricciones](2026-10-18-sarinbot-whatsapp-adaptation.md). Depende de A1–A5; B2 puede probarse aisladamente tras A1/A3.

## Global Constraints

Aplicar restricciones globales: número/verificación nunca equivalen por sí solos a superadmin; no datos privados en soporte público. «El modelo no decide si un comprobante es auténtico ni ejecuta aprobación autónoma.» «Pedir confirmación individual en el panel autenticado, abierto desde WhatsApp». Propuesta de un solo uso y «caducidad de cinco minutos». Reutilizar reviewPayment; sin débito bancario ni aprobación automática.

## Review Focus

Audio que ordena aprobar (B1/B2); vínculo de cliente que solicita menú admin (B1); UID deshabilitado o sesión revocada tras vincular (B1); propuesta con negocio/importe alterados (B2); competencia entre confirmación y revisión manual (B2).

### B1: Consultas privadas del titular

**Files:** Crear `src/lib/server/platform-whatsapp-admin.ts`, `tests/platform-whatsapp-admin.test.ts`. Modificar dispatcher A5, `src/lib/server/admin-copilot.ts`, `src/types/platform-whatsapp.ts`, `src/components/admin-platform-whatsapp.tsx` y pruebas existentes de administración.

**Interfaces:** `assertPlatformSuperadmin(actor:PlatformActor,db?:Database):Promise<void>` y `answerPlatformAdmin(actor:PlatformActor,input:{requestId:string;question:string;businessId?:string},signal:AbortSignal):Promise<AdminCopilotAnswer>`; reutiliza tipo de `src/types/admin-copilot.ts`. `readPlatformAdminMenu(actor:PlatformActor):Promise<{payments:number;health:string;support:number}>`; health proyecta solo hechos comprobados, support cuenta bandeja vigente de plataforma.

- [ ] Pruebas rojas: cliente y UID ajeno dan 403 antes de snapshot; `getUser(uid)` deshabilitado o `tokensValidAfterTime` posterior a la autenticación del vínculo bloquean; solicitud pública jamás llama `answerPlatformAdmin`; `expect(reviewPayment).not.toHaveBeenCalled()` aunque audio pregunte por aprobación. Consulta de pagos permitida conserva fuentes del servidor y presupuesto.
- [ ] Ejecutar `node node_modules/vitest/vitest.mjs run tests/platform-whatsapp-admin.test.ts tests/admin-copilot.test.ts tests/admin-copilot-budget.test.ts`, observar fallo y luego implementar guardas actuales de vínculo/anclas/conexión, `isSuperadmin` y estado Firebase antes de datos privados, inferencia y salida. No confiar únicamente en un rol guardado al vincular.
- [ ] Adaptar admin-copilot solo para proyección con ámbito de canal y enlaces privados de fuentes, sin herramientas nuevas de escritura; mantener su API web y cuotas independientes. Menú privado solo aparece tras autorización. Copiar salida cifrada a outbox con anclas del mismo actor; perder rol o vínculo cancela pendientes.
- [ ] Probar revocación durante generación, límite/costo, respuesta tardía y salida sin imágenes de comprobantes; suites, typecheck y commit `feat: add private WhatsApp administration queries`.

### B2: Propuestas de revisión y confirmación web

**Files:** Crear `src/types/admin-payment-actions.ts`, `src/lib/server/admin-payment-actions.ts`, `src/app/api/admin/copilot/payment-actions/route.ts`, `src/app/api/admin/copilot/payment-actions/[id]/confirm/route.ts`, `src/components/admin-payment-confirmation.tsx`, `tests/admin-payment-actions.test.ts`, `tests/admin-payment-action-routes.test.ts`, `tests/admin-payment-confirmation.test.tsx`. Modificar `src/lib/server/billing.ts`, `src/components/admin-copilot.tsx`, `src/app/admin/assistant/page.tsx`, allowlist/retención y dispatcher privado. Mantener PATCH manual existente.

**Interfaces:** `PreparePaymentInput={paymentId:string;action:'approve'|'reject';requestId:string;rejectionReason?:string}`; `PaymentProposal={id:string;actorUid:string;paymentId:string;action:'approve'|'reject';contextFingerprint:string;revision:number;expiresAt:number;state:'pending'|'executed'|'expired'|'cancelled'}`. `preparePaymentAction(actor:DecodedIdToken,input:PreparePaymentInput,db?:Database):Promise<PaymentProposal>`; `confirmPaymentAction(actor:DecodedIdToken,id:string,input:{requestId:string;expectedRevision:number;confirmed:true},db?:Database):Promise<{receipt:PaymentReceipt;business:Business}>`.

Extraer de billing `reviewPaymentInTransaction(tx:Transaction,db:Database,paymentId:string,action:'approve'|'reject',reason:string|undefined,now:number):Promise<{receipt:PaymentReceipt;business:Business}>`. `reviewPayment` existente abre transacción y delega; no cambiar reglas de prueba pagada, paquetes, capacidad ni requisito de conexión de planes WhatsApp.

- [ ] Pruebas rojas: `expect(proposal.expiresAt-now).toBe(300_000)`; rechazo vacío=400; usuario ajeno/antiguo=403 o428; estado, plan, importe o cuota cambiados=409; doble confirmación devuelve resultado idempotente con un único efecto; revisión manual concurrente produce un solo periodo/paquete. Audio «aprueba» puede iniciar selección/propuesta pero jamás ejecutar confirmación.
- [ ] Ejecutar suites nuevas más `tests/billing.test.ts`, `tests/billing-paid-trial.test.ts`, `tests/billing-policy.test.ts`; observar fallo y extraer helper sin alterar comportamiento. Preparar lectura/fingerprint de comprobante, negocio, plan y estado de cuota que determinan el efecto; no incluir imágenes ni URL privadas en la propuesta. Caducidad cinco minutos, actor fijo, confirmación web con autenticación reciente de cinco minutos.
- [ ] Persistir `adminPaymentActions` con metadatos mínimos hasta 30 días; consumir propuesta y aplicar helper en una transacción, sin transacciones anidadas ni llamadas de modelo. Antes de escrituras resolver todas las lecturas necesarias del helper para conservar compatibilidad transaccional. Mantener petición de confirmación en panel, con plan/importe/efecto y motivo si rechaza. Enlace WhatsApp contiene solo ID opaco; abrir enlace/GET nunca confirma.
- [ ] Añadir rutas requireSuperadmin antes de lectura y esquemas estrictos; UI no envía actor ni datos de efecto, confirma explícitamente y maneja 409 mostrando estado vigente. No enviar imágenes de comprobante por WhatsApp; se revisan en panel autorizado.
- [ ] Probar transacción D1 real, carrera con PATCH manual, doble pestaña y expiración mientras se visualiza; QA 320 px/teclado, suites/typecheck/build. Commit `feat: confirm administrative payment proposals in the web panel`. Publicación y prueba con registros reales se coordinan en P2; no crear ni aprobar pagos reales como fixture.
