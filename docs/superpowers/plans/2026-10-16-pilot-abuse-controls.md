# Pilot Abuse Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Proteger el cupo del piloto con límites persistentes, reservas confirmadas explícitamente y respuestas vinculadas a operaciones autorizadas del negocio.

**Architecture:** Next, Database D1/Firestore y cola existente. Modelo interpreta; servidor conserva estado, renderiza, autoriza y reserva presupuesto. Sin servicios nuevos.

**Tech Stack:** Node 24, pnpm 11.23.0, Next.js, TypeScript estricto, Zod, Vitest, D1/R2, Firebase Auth.

**Spec:** [BRIEF.md](../../product/BRIEF.md), «Protección de uso». [Índice de implementación](2026-10-16-commercial-pilot.md) para aislamiento del checkout, aceptación general y publicación. Invitaciones, tarifas y logo/QR tienen planes separados.

## Global Constraints

- «diez citas y 700 respuestas totales, sin vencimiento por días»; cancelar no devuelve unidades. Prueba de **5.000 pesos colombianos**: este plan no modifica precios ni concesiones.
- «Una IP compartida no identifica a una persona»; ninguna prohibición automática por IP/nombre parecido.
- «Historial con procedencia controlada por servidor»: estado estructurado, sin transcript, prompts, cuerpos del chat ni IP cruda persistidos.
- «Presupuesto de tokens/costo reservado antes de llamadas pagadas, con corte configurable»; cuotas comerciales y alertas no son ese presupuesto.
- Máximo inicial propuesto de **tres futuras activas por cliente y negocio**, configurable/excepción manual. Conservar citas antiguas que superen el máximo.
- Una réplica, mismo proveedor seleccionado y lockfile. WhatsApp deshabilitado; solo `alsdevstudio.com` para hostname del motor.
- Esta fase solo escribe el plan; sin implementación, pruebas, commits, datos remotos o despliegues. DeepSeek autorizado para QA sintética posterior necesaria.

## Review Focus

1. Dos reservas concurrentes en distintos días/recursos con dos futuras existentes: exactamente una alcanza tres; Task 1.
2. Replay después de reinicio y agotamiento de prueba: misma cita, sin IA/admisión/cuota adicional; Tasks 2/5.
3. Asistente inventado, tenant cambiado y respuesta tardía: ninguna propuesta o estado ajeno; Tasks 3/5.
4. Servicio legítimo con vocabulario técnico o instrucciones maliciosas en catálogo: consulta útil, sin permisos ni ensayo libre; Task 4.
5. Timeout sin usage, reinicio y último saldo concurrente: reserva incierta conservada, agenda disponible; Tasks 6/7.

---

## Cobertura y decisiones para revisión

Duplicación de pruebas depende de invitaciones individuales, identidad revisada y conciliación en su plan. Sin identidad multicuentas ni clasificación semántica perfectas.

Endurecimiento posterior: Turnstile y límites persistentes de altas/canjes por red. IP solo del borde confiable, sin encabezados suplantables; referencia HMAC autenticada, clave diaria, vencimiento 24 h. Coincidencia solicita revisión/desafío con excepciones. Sin secretos inactivos ahora. Turnstile posterior exige `siteverify`, hostname/action esperados. Piloto: revisión humana frente a multicuentas.

**Valores operativos propuestos, pendientes de aprobación del plan:** mantener 10/min, 60/h y 120/24 h globales por UID; mismos valores UID+negocio; añadir 30/min, 300/h y 1.000/24 h por negocio. Sumar todos los modos/canales. Presupuesto global: USD 0,50/día, USD 8/mes, 20.000.000 tokens/día y 300.000.000/mes; por negocio: USD 0,10/día, USD 2/mes, 2.000.000 tokens/día y 30.000.000/mes. No son precios ni garantía de factura. Configuración privada versionada por superadmin. Los límites de tokens se dimensionan para no impedir por defecto el consumo legítimo de 3.000 respuestas mensuales; las reservas se concilian después de cada llamada. El presupuesto monetario sigue siendo un corte del operador, independiente del cupo comprado: al agotarse debe informarse como incidencia operativa, sin descontar respuestas no entregadas ni presentarlo como agotamiento del plan. Revisar y financiar el presupuesto según crezcan los negocios; no prometer que USD 8 cubrirán diez planes consumidos al máximo.

Activar juntos bajo mantenimiento; Task 7 evita cortar DeepSeek por configuración nueva ausente. Verificar tarifas oficialmente al ejecutar; los valores propuestos requieren revisión.

## Mapa de responsabilidades

Reusar tipos existentes. Tipos públicos nuevos en `src/types/chat.ts`; esquemas privados en su módulo servidor. Allowlist `shared/data-protocol.ts`; probar privacidad. Sin nuevo enum de origen comercial; consumir el contrato de invitaciones y conservar precedencia del plan pagado.

### Task 1: Política de cliente y máximo transaccional

**Files:** Create `src/lib/server/client-policy.ts`, `src/app/api/businesses/[id]/client-policy/route.ts`, `src/components/client-policy-controls.tsx`, `tests/client-policy.test.ts`, `tests/client-policy-controls.test.tsx`. Modify `src/lib/server/bookings.ts`, `src/app/dashboard/page.tsx`, `shared/data-protocol.ts`, `tests/bookings.test.ts`, `tests/cloudflare-data.integration.test.ts`.

**Interfaces:**

```ts
type ClientPolicy = { blocked: boolean; futureAppointmentLimit: number; reason: string | null };
readClientPolicy(businessId: string, actorUid: string, db?: Database): Promise<ClientPolicy>;
updateClientPolicy(owner: ChatActor, businessId: string, input: {
  clientUid?: string; blocked?: boolean; futureAppointmentLimit?: number | null; reason: string
}, db?: Database): Promise<ClientPolicy>;
assertClientCanBook(tx: Transaction, business: Business, actorUid: string, now: number, db: Database): Promise<void>;
```

- [x] **RED:** Tests: cuarta futura devuelve `CLIENT_BOOKING_LIMIT`; canceladas/pasadas/en curso/manual_block no cuentan. Con dos futuras, `expect(successes).toHaveLength(1)` para dos reservas concurrentes entre recursos/días. Bajar máximo conserva cinco existentes. Excepción 5 permite cuarta; `null` hereda 3. No dueño: 403. Bloqueado conserva historial/cancelación. UI descarta respuesta tardía.
- [x] **Ejecutar RED:** `pnpm test tests/client-policy.test.ts tests/client-policy-controls.test.tsx tests/bookings.test.ts`; esperar módulos ausentes/cuarta reserva actualmente permitida.
- [x] **GREEN:** Documentos `businesses/{id}/clientPolicies/defaults` y `clientPolicies/{sha256(uid)}`; máximo entero 1–20, motivo 1–300 caracteres, actor/fecha privados. GET/PATCH solo dueño; sin clientUid actualiza default; prohibir autobloqueo. Releer política en creación, contar `confirmed && type==='appointment' && startAt>now`; escribir lock compartido `bookingLocks/client_{sha256(uid)}` además del recurso/día. Cancelación participa. Replay precede límites; corrupción: 503. Añadir `clientPolicies` a DATA_CHILDREN; controles en agenda.
- [x] **Verificar:** Repetir RED y `pnpm test tests/cloudflare-data.integration.test.ts`, incluyendo carrera entre handles D1 y privacidad; PASS.
- [x] **Frontera de commit futuro:** `feat: enforce client booking limits and owner exceptions`; solo archivos revisados.

### Task 2: Admisión antes de cola en todos los modos

**Files:** Modify `src/lib/server/inference-rate-limit.ts`, `src/lib/server/chat.ts`, `src/lib/server/http.ts`, `src/lib/client/api.ts`; tests `tests/inference-rate-limit.test.ts`, `tests/http-auth.test.ts`, `tests/client-api.test.ts`, `tests/chat-route.test.ts`.

**Interfaces:**

```ts
type AdmissionInput = { actorUid: string; businessId: string; mode: ChatMode;
  channel: 'web' | 'whatsapp'; requestId: string; fingerprint: string };
enforceInferenceAdmission(input: AdmissionInput, db: Database, now?: number): Promise<void>;
```

`HttpError` añade cuarto parámetro opcional `retryAfterSeconds?: number`. Consume `readClientPolicy` de Task 1; conservar wrapper legado `enforceClientInferenceRateLimit`.

- [x] **RED:** Onboarding/copiloto alcanzan 429; 31 UIDs en mismo negocio/minuto admiten 30; negocio distinto independiente. UID no evade cambiando modo/tenant. Onceavo turno: `expect(queue).not.toHaveBeenCalled()` y cero proveedor/cuota. Replay coincidente no readmite; ID alterado 409; fallo liberado cuenta otra admisión. `Retry-After` exacto.
- [x] **Ejecutar RED:** `pnpm test tests/inference-rate-limit.test.ts tests/http-auth.test.ts tests/client-api.test.ts`; esperar nuevos controles ausentes.
- [x] **GREEN:** Transacción de tres scopes con ventanas indicadas, hashes y tiempos acotados; conservar documentos/eventos globales v1 publicados. Autenticación, entitlement, bloqueo, replay durable y admisión antes de `runUserInference`/`runInSarinQueue`; revalidar acceso tras esperar. Rechazo sin reserva comercial. `apiError` conserva Retry-After; cliente muestra espera, sin retry automático. Corrupción falla cerrado.
- [x] **Verificar:** Repetir RED y `pnpm test tests/chat-route.test.ts tests/whatsapp-queue.test.ts`; último lugar concurrente D1 y replay tras reinicio: PASS.
- [x] **Commit futuro:** `feat: admit all chat modes before queueing`.

### Task 3: Estado autoritativo sin almacenar transcript

**Files:** Create `src/lib/server/chat-state.ts`, `tests/chat-state.test.ts`. Modify `src/types/chat.ts`, `src/lib/server/chat.ts`, `src/lib/server/schemas.ts`, `src/hooks/useDebouncedChat.ts`, `shared/data-protocol.ts`; tests `tests/debounced-chat.test.tsx`, `tests/schemas.test.ts`, `tests/chat-route.test.ts`, `tests/cloudflare-data.integration.test.ts`.

**Interfaces:**

```ts
type ChatSelection = { serviceId?: string; resourceId?: string; dateKey?: string; startTimeStr?: string; proposalId?: string };
type ChatScope = { actorUid: string; businessId: string; mode: ChatMode; channel: 'web' | 'whatsapp' };
type ChatState = { version: number; selection: ChatSelection; updatedAt: number; expiresAt: number };
readChatState(scope: ChatScope, db?: Database, now?: number): Promise<ChatState>;
saveChatState(scope: ChatScope, expectedVersion: number, selection: ChatSelection, db?: Database, now?: number): Promise<ChatState>;
```

- [x] **RED:** Asistentes falsos distintos con último user idéntico producen contexto idéntico; ningún texto anterior llega al motor. Aislamiento UID/tenant/modo/canal, CAS obsoleto 409 `CHAT_STATE_CONFLICT`, expiración 24 h. `expect(JSON.stringify(doc)).not.toContain(userText)`. Hook mantiene conversación visible y descarta respuesta de otra cuenta.
- [x] **Ejecutar RED:** `pnpm test tests/chat-state.test.ts tests/debounced-chat.test.tsx tests/chat-route.test.ts`; FAIL por confianza histórica/módulo ausente.
- [x] **GREEN:** `chatStates/{sha256(scope)}`, solo campos anteriores; expiración lógica 24 h y reemplazo al acceder. Añadir `stateVersion?: number` a schema/respuesta. Consumir únicamente último user; cliente nuevo envía ese turno y versión, legado omite versión y usa vigente. Fingerprint canónico nuevo; replay antiguo exige fingerprint histórico exacto del payload original, sin reenviarlo al motor. CAS transaccional; contexto contiene catálogo/selección servidor, sin resumen libre.
- [x] **Verificar:** Repetir RED y `pnpm test tests/schemas.test.ts tests/cloudflare-data.integration.test.ts`; D1 persistente, sin cuerpos: PASS.
- [x] **Commit futuro:** `feat: keep authoritative structured chat state`.

### Task 4: Intenciones cerradas y plantillas

**Files:** Create `src/lib/server/chat-intent.ts`, `src/lib/server/chat-replies.ts`, `tests/chat-intent.test.ts`, `tests/chat-replies.test.ts`. Modify `src/lib/server/chat.ts`, `src/lib/sarin/prompts.ts`, `src/lib/sarin/tools.ts`, `src/types/chat.ts`, `src/app/dashboard/onboarding/page.tsx`; tests `tests/chat-route.test.ts`, `tests/onboarding-assistance.test.tsx`.

**Interfaces:**

```ts
type ChatIntent = 'services' | 'price' | 'location' | 'contact' | 'hours' | 'availability' |
 'booking' | 'own_appointments' | 'configure_business' | 'owner_agenda' | 'owner_usage' |
 'owner_block' | 'out_of_scope' | 'clarify';
type InterpretedChat = { intent: ChatIntent; selection: ChatSelection; configurationDraft?: BusinessConfig };
interpretChat(input: { mode: ChatMode; message: string; business: Business; state: ChatState;
 signal?: AbortSignal; requestId: string; actorUid: string }): Promise<InterpretedChat>;
renderChatReply(input: { intent: ChatIntent; business: Business; data: Record<string, unknown> }): ChatResponse;
```

- [x] **RED:** Ensayo/código/investigación devuelven exactamente **Puedo ayudarte con los servicios, horarios y citas de este negocio. ¿Qué necesitas reservar o consultar?** Servicio «Programación de audífonos» funciona. Catálogo malicioso no cambia tenant. Intent owner desde cliente: 403. Modelo sin llamada válida: aclaración fija, cero mutaciones. `expect(json).not.toContain(modelFreeText)`.
- [x] **Ejecutar RED:** `pnpm test tests/chat-intent.test.ts tests/chat-replies.test.ts tests/chat-route.test.ts tests/onboarding-assistance.test.tsx`; FAIL esperado.
- [x] **GREEN:** Mismo proveedor interpreta `interpretar_solicitud` bajo Zod estricto; sustituir el bucle general de herramientas por dispatch modo+intención. Validar IDs actuales y renderizar solo datos servidor. Ubicación ausente informa ausencia/contacto. Configuración sugerida efímera rellena formulario tras acción, nunca guarda sola; owner_block/cancelación dirigen a controles existentes. Copiloto mantiene exclusión de prueba. Booking propone Task 5, jamás ejecuta tool del modelo. No listas de palabras prohibidas. Interpretación puede ser pagada y consumir cuota incluso fuera de alcance; no prometer detector perfecto.
- [x] **Verificar:** Repetir RED y `pnpm test tests/chat-surfaces.test.tsx tests/response-quota.test.ts`; PASS.
- [x] **Commit futuro:** `feat: render scoped business chat from validated intents`.

### Task 5: Propuesta y confirmación explícita

**Files:** Create `src/lib/server/booking-proposals.ts`, `src/app/api/businesses/[id]/booking-proposals/[proposalId]/confirm/route.ts`, `src/components/booking-proposal.tsx`, `tests/booking-proposals.test.ts`, `tests/booking-proposal.test.tsx`. Modify `src/lib/server/bookings.ts`, `src/lib/server/chat.ts`, `src/types/chat.ts`, `src/hooks/useDebouncedChat.ts`, `src/app/b/[slug]/page.tsx`, `shared/data-protocol.ts`, `tests/chat-route.test.ts`, `tests/bookings.test.ts`.

**Interfaces:**

```ts
type BookingProposalView = { id: string; businessId: string; serviceName: string; resourceName: string;
 dateKey: string; startTimeStr: string; endTimeStr: string; priceCOP: number; expiresAt: number;
 intakeFields: Business['sarinConfig']['intakeFields'] };
createBookingProposal(user: ChatActor, businessId: string, input: Pick<BookingInput,
 'dateKey' | 'startTimeStr' | 'serviceId' | 'resourceId'>, requestId: string, db?: Database): Promise<BookingProposalView>;
confirmBookingProposal(user: ChatActor, businessId: string, proposalId: string,
 contact: Pick<BookingInput, 'clientPhone' | 'intakeAnswers'>, db?: Database): Promise<Appointment>;
```

`ChatResponse` añade `proposal?: BookingProposalView`, `configurationDraft?: BusinessConfig`; hook expone `confirmProposal(proposalId: string, contact: Pick<BookingInput, 'clientPhone' | 'intakeAnswers'>): Promise<void>`.

- [x] **RED:** «sí» en chat/tool del modelo crean cero citas; formulario local muestra resumen, pide teléfono/admisión y POST estricto `{confirm:true,clientPhone,intakeAnswers}` crea una. Contacto inválido 400; precio/hora/servicio enviados por navegador 400. Otro UID/tenant 403/404; expiración exacta 10 min y catálogo/admisión cambiados 409. Estado/propuesta no contienen teléfono ni respuestas antes de confirmar. Doble confirmación: `expect(appointmentIds).toEqual([id,id])`, consumo único. Bloqueo/cuarto futuro/slot ocupado no consumen propuesta. Replay agotada/cancelada muestra estado real sin IA, antes de comparar o usar contacto nuevo.
- [x] **Ejecutar RED:** `pnpm test tests/booking-proposals.test.ts tests/booking-proposal.test.tsx tests/chat-route.test.ts tests/bookings.test.ts`; FAIL esperado.
- [x] **GREEN:** Colección privada `bookingProposals`, IDs aleatorios >=128 bits, snapshot inmutable de servicio/precio/horario/recurso e intakeFields vinculado a UID/tenant, expiración lógica 10 min; ningún teléfono ni respuestas de admisión en estado/propuesta. Extraer `createAppointmentInTransaction(tx: Transaction, user: ChatActor, business: Business, input: BookingInput, requestId: string, db: Database, now: number): Promise<Appointment>`; wrapper conserva contrato. Componente BookingProposal recoge contacto localmente según intakeFields. Confirmación combina snapshot servidor y contacto validado con bookingSchema, revalida catálogo/admisión, crea cita y consume propuesta en misma transacción/locks; ID estable por propuesta. Replay precede entitlement/expiración nuevos. Solo la cita conserva contacto bajo su contrato existente. Confirmación no llama IA ni cobra otra respuesta; propuesta ya pertenece al turno medido. UI protege doble clic/cambio de scope. WhatsApp deshabilitado nunca confirma por una tool; adaptar sus fixtures al resultado de propuesta, sin habilitar canal.
- [x] **Verificar:** Repetir RED y `pnpm test tests/cloudflare-data.integration.test.ts tests/client-appointments.test.tsx tests/response-quota.test.ts tests/whatsapp-queue.test.ts`; PASS.
- [x] **Commit futuro:** `feat: require explicit server-bound booking confirmation`.

### Task 6: Presupuesto previo a cada llamada pagada

**Files:** Create `src/lib/server/ai-budget.ts`, `src/lib/server/ai-pricing.ts`, `src/app/api/admin/abuse/route.ts`, `tests/ai-budget.test.ts`, `tests/admin-abuse-route.test.ts`. Modify `src/lib/sarin/engine.ts`, `src/lib/server/ai-usage.ts`, `src/lib/server/chat-intent.ts`, `cloudflare/src/router.ts`, `shared/data-protocol.ts`; tests `tests/engine.test.ts`, `tests/engine-gemini.test.ts`, `tests/ai-usage.test.ts`, `tests/cloudflare-data.integration.test.ts`, `cloudflare/tests/router.test.mjs`.

**Interfaces:**

```ts
type PaidCallContext = { businessId: string; actorUid: string; mode: ChatMode; requestId: string };
type BudgetReservation = { id: string; callId: string; maxTokens: number; maxCostNanoUsd: number };
quotePaidCall(input: { provider: CloudAiProvider; model: string; requestBytes: number; maxOutputTokens: number }):
 { maxTokens: number; maxCostNanoUsd: number; pricingVersion: string };
reservePaidCallBudget(input: PaidCallContext & { callId: string; provider: CloudAiProvider; model: string;
 maxTokens: number; maxCostNanoUsd: number; pricingVersion: string }, db?: Database, now?: number): Promise<BudgetReservation>;
settlePaidCallBudget(reservation: BudgetReservation, observation: EngineUsageObservation, db?: Database): Promise<void>;
```

- [x] **RED:** Último saldo concurrente entre handles admite un fetch; agotamiento/config corrupta con gate activo rechaza antes de fetch. Timeout/usage ausente/reinicio conserva reserva; liquidación duplicada no duplica cargo. Cambio de mes Colombia liquida período original; cancelación/agenda no consultan presupuesto. Gate ausente mantiene contrato previo. Simular 100 respuestas legítimas/día y 3.000/mes con usage de 3.000 tokens/turno y conciliación tras cada llamada: el límite de tokens no bloquea ese cupo. En este caso aislar la prueba con presupuesto monetario suficiente; su precio real no se infiere de tokens sin tarifa. Corte monetario deja la cuota comercial intacta y muestra causa operativa distinta de plan agotado.
- [x] **Ejecutar RED:** `pnpm test tests/ai-budget.test.ts tests/admin-abuse-route.test.ts tests/engine.test.ts tests/ai-usage.test.ts`; FAIL esperado.
- [x] **GREEN:** `completeChat.options.billingContext?: PaidCallContext`, obligatorio cloud con `PILOT_AI_BUDGET_ENFORCED=true`; Ollama exento de costo, conserva límites. Tarifas compartidas versionadas, extremo caro sin cache/descuento. Cota interna `maxTokens=requestBytes+4096+maxOutputTokens` usando JSON UTF-8 final; entrada <=128.000, salida <=4.096. No garantiza tokenizador/factura externos. Reserva transaccional día/mes global+negocio en `aiBudgetCalls`/`aiBudgetPeriods`; usage concilia, desconocido mantiene máximo. Exceso/modelo imprevisto pausa nuevas llamadas, contabiliza cuando sea calculable, nunca repite operación. GET/PATCH superadmin administra ocho límites y pausa en `serverSettings/pilotAiBudget`; conciliación manual exige callId, motivo y resolución `keep_reserved`/`confirmed_not_charged` con evidencia. Meter best effort separado; fallo de liquidación no repite IA. Añadir flag a allowlist runtime.
- [x] **Verificar:** Repetir RED, `pnpm test tests/engine-gemini.test.ts tests/cloudflare-data.integration.test.ts` y `node --test cloudflare/tests/router.test.mjs`; fetch mockeado, PASS.
- [x] **Commit futuro:** `feat: reserve bounded paid inference budgets before fetch`.

### Task 7: Integración y gates específicos del piloto

**Files:** Create `tests/pilot-abuse.integration.test.ts`, `docs/qa/2026-10-16-pilot-abuse-controls.md`. Modify `tests/local-journey.integration.test.ts`, `tests/chat-surfaces.test.tsx`, `docs/response-quotas.md`, `docs/cloudflare-no-vps-runbook.md`.

**Interfaces:** Tasks 1–6, `createDataTestRuntime()`, reloj controlado y motor mockeado; ningún runner remoto nuevo.

- [x] **RED:** Recorrido servicio→disponibilidad→propuesta→confirmación→cita→cancelación; bloqueo entre pasos, máximo concurrente, replay reiniciado, fuera de alcance y presupuesto agotado. `expect(fetchCount).toBe(1)` para interpretación; cero para confirmar/replay/cancelar. Prueba pagada/cortesía conserva contadores y cinco citas históricas intactas.
- [x] **Ejecutar RED:** `pnpm test tests/pilot-abuse.integration.test.ts tests/chat-surfaces.test.tsx`; documentar resultado real, sin fabricar fallos.
- [x] **GREEN:** Integrar y adaptar journey; informe relaciona Review Focus con resultados sin cuerpos. QA global/emuladores/fuentes: índice general.
- [x] **Verificar:** Repetir RED y `pnpm test tests/booking-proposals.test.ts tests/inference-rate-limit.test.ts tests/ai-budget.test.ts`. QA DeepSeek posterior necesaria: máximo ocho interpretaciones sintéticas aisladas, dos legítimas/dos ambiguas/dos generalistas/dos inyecciones; medir costo. Sin aislamiento, dejar esa aceptación pendiente; mocks no prueban semántica real.
- [x] **Commit futuro y gate:** `test: verify pilot abuse controls and activation procedure`. Publicación separada según índice: mantenimiento y cola cero; guardar/validar política; activar nuevo gate y comprobar versión antes de reabrir una réplica. Config faltante mantiene mantenimiento, nunca interrumpe silenciosamente el proveedor previo. Rollback conserva datos; no habilitar de nuevo reservas dependientes solo de prompt sin revisar contrato.

## Auto-revisión

Cobertura: máximo/bloqueo T1; admisión T2; procedencia T3; alcance T4; confirmación sin contacto persistido previo T5; presupuesto T6; integración T7. Review Focus con tests, firmas y replay revisados. Altas/precios/logo tienen otros planes. Implementación local y pruebas acreditadas en la [aceptación](../../qa/2026-10-16-commercial-pilot-acceptance.md). Presupuesto aún sin activar; garantías limitadas al servidor, sin identidad o semántica perfectas ni factura garantizada.
