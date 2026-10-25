# FAQ factual mínima — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Preparación documental delegada; no implementación, ejecución, publicación o commit en este encargo.

**Goal:** Dar al dueño tres respuestas factuales versionadas y al cliente una consulta explícita por ID, sin IA, acciones o cambios al guardado agregado.

**Architecture:** Estado/recibos privados separados, owner GET/PUT con CAS y API factual cliente con revisión. Editor independiente y panel plegable dentro del chat web general autorizado, con texto literal del negocio y ninguna modificación del protocolo conversacional.

**Tech Stack:** Node24, pnpm11.23.0, Next16.4.0, React19.3.0, TypeScript/Zod4.6.7, Vitest5.0.4, Database Firestore/D1, Web Crypto del navegador y tokens Sarin existentes.

**Spec:** [2026-10-22-business-factual-faq-design.md](../specs/2026-10-22-business-factual-faq-design.md); leer con el [incremento inicial de recepción](../specs/2026-10-22-business-receptionist-knowledge-design.md). Esta fase no se añade silenciosamente a ese alcance anterior.

## Global Constraints

- Node 24 y pnpm 11.23.0; conservar lockfile y no añadir dependencias.
- Fuente efectiva reconciliada y rama aislada; nunca implementar o publicar desde E: mixto.
- Solo información de negocio general sin menores habilitados; salud/representación mantienen recorridos actuales.
- La FAQ no inicia llamadas a motor/health, inferencia, intent nuevo, herramienta, cuota de IA, acción de reserva, cobro o mensaje externo; conserva las llamadas ya existentes del chat.
- No modificar BusinessConfig, Business/publicBusinesses, ChatSelection/ChatResponse, historial del chat o APIs existentes para almacenar FAQ.
- Texto literal escapado por React; sin HTML/Markdown/enlaces automáticos, ejecución, secretos o datos de clientes.
- Dueño vigente para editar; cuenta/negocio/consentimientos vigentes para consulta del cliente; sin roles laborales inventados.
- Identidad/tokens Sarin, guía por tarea, ayuda plegable, revisión explícita y controles de44px.

## Review Focus

- Respuesta editada/retirada entre listar temas y elegir: revisión409, limpiar texto anterior y pedir elección nueva, sin coincidencia aproximada; tareas2–4.
- PUT perdido y recibo del mismo ID con otro payload, o guardado seguido de otra edición: verificar huella/prueba y state actual, sin sobrescribir ni afirmar contenido antiguo vigente; tareas1–3.
- Salud/menores/consentimiento cambian mientras keepChat conserva una confirmación: FAQ se purga/oculta sin abortar recuperación de cita; tareas2,4.
- Texto del negocio con HTML o instrucciones de cobro/reserva: literal, sin prompt/acción/historial de chat, incluso al decir sí después; tareas2,4.
- Cuenta/negocio/época cambia o lectura tarda: descartar privado tarde; error no es FAQ vacía ni permiso para otro guardado; tareas3–4.

---

## Base y archivos

Fuente de solo lectura `C:/Users/Drean Skate/AppData/Local/SarinBot/whatsapp-adaptation-20261020/source-restoration`, pin463ae55f8c873468980746185fb3e91f55cb8681; runtime documentado c8bb0a99d9ac2bb20acaef2e5a157b0ff83b05f2, sin comprobación remota nueva. Implementar desde fuente reconciliada aislada, con navegación, configuración guiada, recepción inicial y S09 integrados/verificados para la composición UI. No cambiar worktree recuperado ni ejecutar desde E:.

| Archivo | Responsabilidad |
| --- | --- |
| Crear `src/lib/business-factual-faq.ts` | Temas/labels fijos, tipos/schemas de DTO/comando, normalización y string canónico puro. |
| Crear `src/lib/server/business-factual-faq.ts` | Estado/recibo, SHA256 servidor, autoridad/CAS y lecturas factuales autorizadas. |
| Crear tres rutas FAQ de la tarea2 | Transporte estricto, no-store y límites, sin tocar public-businesses/chat. |
| Modificar `shared/data-protocol.ts` | Añadir factualFaq/factualFaqOperations a hijos privados de businesses. |
| Crear `src/hooks/use-owner-factual-faq.ts`, `src/components/business-factual-faq-editor.tsx`, `src/app/dashboard/faq/page.tsx` | Guardado propio revisado y recuperable, sin formulario agregado. |
| Modificar `src/components/business-assistant-scope-notice.tsx`, `src/app/dashboard/onboarding/page.tsx`, `src/components/app-shell.tsx` | Enlace secundario elegible y contexto Mi negocio sin otro destino principal. |
| Crear `src/hooks/use-client-factual-faq.ts`, `src/components/business-factual-faq-panel.tsx`; modificar `src/app/b/[slug]/page.tsx` | Lectura explícita por tema, UI separada del transcript y gate de política actual. |
| Nuevos `tests/business-factual-faq-model.test.ts`, `tests/business-factual-faq-domain.test.ts`, `tests/business-factual-faq-routes.test.ts`, `tests/business-factual-faq-d1.test.ts`, `tests/business-factual-faq-contract.ts` | Contratos, autoridad, CAS, transacciones reales y fixture compartido. |
| Nuevos `tests/owner-factual-faq.test.tsx`, `tests/client-factual-faq.test.tsx`, `tests/factual-faq-integration.test.tsx` | UI/hooks reales, errores y composición. |
| Ampliar `tests/firestore.rules.test.ts`, `tests/firestore.integration.test.ts`, `tests/data-migration.test.ts`, `cloudflare/tests/data.test.mjs` | Privacidad, almacenamiento y respaldo. |
| Crear en ejecución `qa/tests/business-factual-faq.md`, `docs/qa/2026-10-22-business-factual-faq.md` | Protocolo y evidencia realmente ejecutada. |

Sin campo FAQ en Business, proyección anónima, customRules, prompt o Conversation. Sin índices/migraciones SQL: solo docs por ID. No introducir un motor de búsqueda o framework de formularios para tres respuestas.

### Task 1: Modelo acotado y verificación de comandos

**Files:** crear módulo puro, tests modelo y fixture. **Consumes:** utilidades de fecha/ID existentes cuando sean seguras para cliente; no importar server/schemas al navegador. **Produces:** todos los tipos de la spec, `FACTUAL_FAQ_TOPICS`, `factualFaqQuestion(topic)`, `factualFaqItemSchema`, `factualFaqCommandSchema`, DTO schemas y:

```ts
normalizeFactualFaqItems(value:unknown):FactualFaqItem[];
factualFaqCommandCanonicalString(command:FactualFaqCommand):string;
```

Normalizar NFC/CRLF/trim, temas en orden fijo, respuesta1–400 caracteres y máximo3 LF; controles distintos de LF rechazados. Lista0–3, sin duplicados, pregunta/alias/URL/actor extra. String canónico orden requestId/expectedRevision/expectedPolicyRevision/items, sin que el orden original altere huella. No importar crypto/server-only a este archivo.

- [ ] Escribir `onlyThreeTopicsExistAndHaveExactQuestions`, `duplicateTopicAndFreeQuestionAreRejected`, `answerBoundsAndControlCharactersAreClosed`, `normalizationAndOrderingAreCanonical`, `zeroItemsExplicitlyRemovesAll`, `revisionCannotOverflow`. Verificar que topic price/location/hours/booking no valida, y que texto parecido a instrucciones no se interpreta ni elimina silenciosamente: se conserva como texto válido dentro de sus límites.
- [ ] Fixture `seedFactualFaqScenario(db:Database)`, `factualFaqNow=Date.parse('2030-01-01T12:00:00Z')`: negocio demo-general configurado, dueño demo-owner, cliente demo-client consentido y otro negocio, tres respuestas sintéticas, política general revisión1; sin contactos reales. Fixture no usa motor.
- [ ] Ejecutar `pnpm exec vitest run tests/business-factual-faq-model.test.ts`; RED. Implementar modelo y repetir GREEN. Futuro commit `feat: define bounded factual business questions`.

### Task 2: Dominio, CAS y transporte autorizado

**Files:** crear servidor y rutas `src/app/api/businesses/[id]/factual-faq-settings/route.ts`, `src/app/api/businesses/[id]/factual-faq/route.ts`, `src/app/api/businesses/[id]/factual-faq/[topic]/route.ts`; tests domain/routes; modificar allowlist.

**Consumes:** tipos1, assertOwner/assertConsent, readBookingDataPolicy, isSubscriptionAllowed, Database, stableDocumentId y requireUser/readJson/apiError. **Produces:**

```ts
readOwnerFactualFaq(owner:ChatActor,businessId:string,requestId?:string,db?:Database):Promise<OwnerFactualFaqView>;
saveOwnerFactualFaq(owner:ChatActor,businessId:string,command:FactualFaqCommand,db?:Database):Promise<OwnerFactualFaqView>;
readClientFactualFaqTopics(actor:ChatActor,businessId:string,db?:Database):Promise<ClientFactualFaqTopics>;
readClientFactualFaqAnswer(actor:ChatActor,businessId:string,topic:FactualFaqTopic,revision:number,db?:Database):Promise<ClientFactualFaqAnswer>;
factualFaqCommandFingerprint(command:FactualFaqCommand):string; // Node SHA256 del string canónico1
```

- [ ] Escribir `onlyCurrentOwnerCanEditAndInspectReceipts`, `clientCannotObtainPrivateState`, `superadminRoleDoesNotBypassOwner`, `readMissingStateIsRevisionZeroButCorruptFails503`, `ownerHistoricalReadDoesNotRequirePlanOrConsent`, `newSaveRequiresConfiguredPlanConsentAndEligiblePolicy`, `changedPolicyRejectsOwnerReview`. No cliente autenticado con UID distinto usa un body actorUID para acceder.
- [ ] Escribir `sameRequestAndCommandReturnsOriginalProofAndCurrentState`, `sameIdDifferentAnswerOrExpectationIs409`, `concurrentOwnerCommandsOnlyApplyOneRevision`, `lostResponseDoesNotRepeatRevision`, `replayAfterAnotherEditKeepsLaterState`, `receiptHashMatchesExactNormalizedCommand`. Guardar state+receipt juntos; proof incluye hash, actor privado y revisión aplicada. Rechazo transaccional no deja una mitad.
- [ ] Escribir `topicsReturnLabelsAndRevisionWithoutAnswersOrActor`, `answerRequiresExactCurrentRevision`, `removedTopicCannotReturnOldAnswer`, `unknownTopicIs400`, `policyHealthOrMinorsClosesReads`, `accountAndBusinessConsentAreRequired`, `faqFactsDoNotUnlockPausedBookingOrChat`, `factsReadDoesNotConsumeEngineQuota`. El listado puede funcionar con IA/plan en pausa; no llama al motor o a mutadores por ello. Espera/citas/propuestas/cuotas/proyección deben ser idénticas antes/después de ambos GET.
- [ ] Rutas reales: GET dueño solo requestId opcional único, PUT8192bytes y schema strict; GET temas sin query; GET respuesta solo revision decimal canónica única. Todas requireUser/IDs/no-store incluso error. Body/query extra, revisión negativa/duplicada/exponencial, tipos extra o content-type incorrecto fallan400/413/415 según helper. Ninguna ruta hace fallback a endpoint anónimo o colección publicBusinesses.
- [ ] Ejecutar `pnpm exec vitest run tests/business-factual-faq-domain.test.ts tests/business-factual-faq-routes.test.ts`; RED. Implementar transacciones en orden spec y solo dos hijos privados; permitir ausencia real/revisión0, corrupción/error nunca empty. Repetir GREEN. Futuro commit `feat: store and read factual FAQs with owner CAS`.

### Task 3: Editor dueño y guardado recuperable

**Files:** crear hook/editor/page; modificar notice/onboarding/AppShell; prueba `tests/owner-factual-faq.test.tsx`. **Consumes:** owner API2, identidad/época/consentimiento y workspace guiado existente. **Produces:**

```ts
useOwnerFactualFaq(input:{businessId:string;ownerUid:string;authEpoch:number;enabled:boolean}):OwnerFactualFaqController;
type OwnerFactualFaqController = {
  view:OwnerFactualFaqView|null;draft:FactualFaqItem[];dirty:boolean;busy:boolean;uncertain:boolean;error:string|null;
  reviewed:boolean;publicationChecked:boolean;setPublicationChecked:(checked:boolean)=>void;
  setDraft:(items:FactualFaqItem[])=>void;load:()=>Promise<void>;review:()=>void;
  save:()=>Promise<void>;inspectPending:()=>Promise<void>;retryPending:()=>Promise<void>;
};
BusinessFactualFaqEditor(props:{controller:OwnerFactualFaqController;canEdit:boolean}):ReactNode;
```

Comando revisado vive inmutable junto a requestId y huella Web Crypto calculada del mismo string canónico1. review fija snapshot del draft/revisiones; editar después invalida reviewed/checkbox. save exige revisión local vigente y publicationChecked; mientras calcula hash se bloquea otra edición/envío, y después del await verifica otra vez scope y snapshot antes de POST. Error de Web Crypto no envía ni afirma guardado. No usar una casilla como consentimiento clínico. Comparar applied.commandFingerprint con hash pendiente antes de anunciar éxito de ese payload.

- [ ] Escribir `editorShowsThreeOptionalQuestionsAndDiffBeforeSave`, `blankAnswerDoesNotPublish`, `retirementIsShownInReview`, `editAfterReviewInvalidatesSave`, `saveUpdatesFaqNotBusinessConfig`, `receiptWithAnotherHashCannotResolvePending`, `uncertainSaveKeepsSameRequestAndBody`, `emptyReceiptWhilePutPendingDoesNotUnlockSecondSave`, `laterStateDoesNotEraseAppliedProof`, `identityOrOwnerChangePurgesLateState`. No afirmar guardado por mera coincidencia de textos o requestId.
- [ ] Lecturas plazo10s con controller/generación/cleanup; PUT a20s solo aviso. Mientras PUT esté pendiente bloquear segundo comando; inspectPending GET puede probar applied, ausencia no prueba fracaso. Tras error ambiguo, retryPending repite cuerpo exacto. Scope enabled solo autoridad vigente, no !busy propio; cambio de canEdit por expiración de plan no limpia una prueba pendiente ni habilita segundo envío. 401/403 oculta privado; datos viejos no reaparecen por respuesta retrasada.
- [ ] Crear ruta con AuthGate/AppShell y useBusiness como contexto, sin confiar en dueño cacheado para API. Reutilizar `businessNavigationPath` de S09 con solo cuatro paths base del enum spec; FAQ usa `/dashboard/onboarding`, admin lo ignora. Horarios/FAQ/Equipo/Recordatorios siguen secundarios desde Mi negocio, sin quinto enlace principal. Extender notice con `faqHref?: '/dashboard/faq'`; link se compone solo general/sin menores/configurado, abre pestaña nueva explícita y no manda ni guarda nada en onboarding. Mantener props previas y slot assistantScope.
- [ ] Tests `faqIsSecondaryToMyBusinessNotNewMainDestination`, `configurationDraftSurvivesFaqNewTabLink`, `noticeDoesNotAdvertiseFaqInRestrictedPolicy`, `adminNavigationIgnoresBusinessOverride`. Verificar link con noopener/noreferrer y aviso de nueva pestaña, no fake stub de ruta. No introducir Publicar/Guardar borrador ni otra API de guardado en configuración.
- [ ] Ejecutar `pnpm exec vitest run tests/owner-factual-faq.test.tsx tests/business-assistant-scope-notice.test.tsx tests/business-assistant-scope-integration.test.tsx tests/user-avatar.test.tsx tests/workspace-navigation.test.tsx`; RED solo nuevas capacidades antes de implementar, después GREEN. Futuro commit `feat: guide owners through factual answer review`.

### Task 4: Panel cliente por ID y precedencia cerrada

**Files:** crear hook/panel, modificar únicamente composición de `src/app/b/[slug]/page.tsx`; tests client/integration. **Consumes:** DTO APIs2 y gates actuales de BookingJourney/GeneralBookingChat. **Produces:**

```ts
useClientFactualFaq(input:{businessId:string;uid:string;authEpoch:number;enabled:boolean}):ClientFactualFaqController;
type ClientFactualFaqController = {
  topics:ClientFactualFaqTopics|null;answer:ClientFactualFaqAnswer|null;
  loading:boolean;error:string|null;loadTopics:()=>Promise<void>;choose:(topic:FactualFaqTopic)=>Promise<void>;clear:()=>void;
};
BusinessFactualFaqPanel(props:{businessId:string;uid:string;enabled:boolean}):ReactNode;
```

Panel obtiene authEpoch vigente de useAuth y usa hook sin reutilizar estado del chat. Al abrir details consulta lista, elegir hace GET tema+revisión, y cierre limpia texto/lista para que próxima apertura lea fresco. Scope UID/época/business en refs, expectedUid/predicado y timeout10s; enabled false purga durante render, aborta y descarta respuestas tarde. No polling. Cambiar tema limpia answer antes de enviar.409 limpia y recarga topics, pide elección; no reenvía solo la pregunta nueva ni cambia topic silenciosamente.

- [ ] Escribir `closedPanelDoesNotRead`, `chosenTopicUsesIdAndDisplayedRevision`, `answerChangeClearsOldTextBeforeRequest`, `revisionConflictReloadsButRequiresNewChoice`, `removedTopicDoesNotFallbackToAnotherAnswer`, `malformedForeignResponseCannotRender`, `scopeAndPermissionChangesPurgeEvenDuringLateRead`, `readTimeoutIsErrorNotEmptyFaq`. DTO debe coincidir businessId/topic/revision solicitados, pregunta con label fijo y source business; no confiar en JSON con una pregunta distinta.
- [ ] Escribir `noChatSendEngineProposalOrQuotaOnFaqClick`, `instructionsAndHtmlRemainBusinessText`, `faqAnswerDoesNotEnterPromptOrTranscript`, `typedParaphraseDoesNotTriggerFaqLookup`, `sayingYesAfterFaqCannotConfirmAppointment`, `faqDoesNotModifyChatInputOrCurrentProposal`. Usar componente/ruta reales y afirmar delta0 de llamadas motor/health/inferencia atribuibles a abrir/elegir FAQ; montar/controlar primero los sondeos actuales de useEngineHealth en GeneralBookingChat y no eliminarlos para lograr cero global. La ruta FAQ sí tiene cero llamadas propias. No simular comprensión del modelo con intención forzada.
- [ ] Integrar panel cerrado fuera del transcript/aria-live y formulario del chat. Añadir prop `faqEnabled` a GeneralBookingChat calculada en BookingJourney desde política ready/current general/no minors, adulto para sí y permitted; no desde keepChat ni estado antiguo del chat. Tests `healthTransitionWithUncertainChatStillHidesFaq`, `minorFlagPurgesFaqWithoutCancellingBookingRecovery`, `pausedAiCanShowBusinessFactsButCannotResumeAi`, `anonymousCalendarAndWhatsAppRemainWithoutFaq`.
- [ ] Ejecutar `pnpm exec vitest run tests/client-factual-faq.test.tsx tests/factual-faq-integration.test.tsx tests/chat-surfaces.test.tsx tests/client-reschedule-entry.test.tsx`; RED nuevas capacidades, implementar y GREEN. Mantener respuestas out_of_scope/clarify, intenciones y mensajes escritos sin cambio. Futuro commit `feat: show factual business answers by explicit selection`.

### Task 5: Almacenamiento real, privacidad y verificación de rama

**Files:** crear `tests/business-factual-faq-d1.test.ts`, ampliar suites de protocolo/reglas/Firestore/data-migration; protocolo/QA futuros.

- [ ] Dos handles D1 local con createDataTestRuntime/createCloudflareDatabase: competir PUT misma revisión, replay después de otra edición y commit aplicado cuya respuesta se pierde. Una revisión+recibo por comando; retry de commit idéntico en journal. Cliente leer mientras otra transacción cambia policy a health no obtiene permisos extra; cada respuesta autorizada se atribuye a su lectura, sin prometer sincronización instantánea del texto ya mostrado.
- [ ] Rules con dueño/cliente/otra cuenta/anónimo: ninguno lee/escribe factualFaq/factualFaqOperations por SDK; APIs devuelven solo DTO pertinente. Firestore Admin emulador comprueba atomicidad state+receipt y CAS. Worker allowlist acepta solo dos hijos nuevos; ningún campo/query extra añadido. Backup/restauración y migración sintéticos conservan revisiones/huellas/textos sin imprimirlos; no purgar recibos.
- [ ] Ejecutar `pnpm exec vitest run tests/business-factual-faq-model.test.ts tests/business-factual-faq-domain.test.ts tests/business-factual-faq-routes.test.ts tests/business-factual-faq-d1.test.ts tests/owner-factual-faq.test.tsx tests/client-factual-faq.test.tsx tests/factual-faq-integration.test.tsx tests/data-migration.test.ts`, `pnpm run test:rules`, `pnpm --filter sarin-cloudflare-host run check`, `pnpm run typecheck`, `pnpm test`, `pnpm run build`. Registrar resultados reales y suite omitida como pendiente; mock no sustituye D1/emulador.
- [ ] Regresión P4: `tests/chat-intent.test.ts`, `tests/chat-route.test.ts`, `tests/chat-replies.test.ts`, `tests/service-catalog-prompts.test.ts` más suites de recepción inicial. Marcador FAQ único en fixture DB no aparece en ningún prompt ni devuelve como prosa de IA. Perfil anónimo/businessConfig/publicBusiness y rutas de cliente conservan schemas y semántica anteriores.
- [ ] QA local320/390/1280 y zoom200%: editor3preguntas, revisión añadidas/retiradas, dirty/recibo incierto, panel plegado, texto largo/HTML literal, respuesta actualizada durante elección, política/consentimiento revocados y recuperación de cita sin efecto FAQ. No cobros, mensajes, IA o datos reales. Documentar lo observado y atribuir carreras solo a pruebas automatizadas si no se reproducen UI.
- [ ] Revisar diff independiente: tres temas exactos, sin alias/libre/RAG, sin campos en Business/chat, no propietario falso, no respuesta privada/actor/hashes al cliente, no draft perdido al abrir editor y sin cuotas tocadas. Worker compatible primero y rollback lector S09 compatible, sin borrar FAQ/recibos. Futuro commit `docs: verify factual FAQ publication and selection`; esta preparación no despliega.

## Autorrevisión

F01/F02 → tareas1–2; F03 →2–3/5; F04 →2/4; F05/F06 →2/4/5; F07 →3; F08 →5. Review Focus lleva pruebas de cambio/revisión, hashes, keepChat, texto sin autoridad y scopes. Backend y cliente no necesitan clasificador nuevo; editor se compone después del notice y configuración guiada. Alcance deliberadamente de3temas y chat autenticado general; futuras preguntas libres/canales/publicación anónima siguen fuera. Todas las tareas quedan sin marcar y no se atribuyen pruebas o producto publicado a esta entrega documental.
