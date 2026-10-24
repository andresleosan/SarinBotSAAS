# Configuración guiada del negocio — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Este documento se capturó como plan el 22 de octubre; la ejecución posterior se registra debajo.

## Ejecución del 23 de octubre de 2026

El titular pidió continuar la integración de las funciones capturadas de Fresha. P2 se implementó en `codex/fresha-p2-20261023`, worktree aislado `C:/Users/Drean Skate/AppData/Local/SarinBot/fresha-p2-20261023/source`, desde la fuente efectiva P1 `33edcbc57ed57a85f41200dbc65f3b099d7114ec`. No se implementó en el checkout mixto de E: ni se modificó el checkout P1.

Tareas 1–4 implementadas y revisadas. Tarea 5: suite completa, tipos, build y recorrido local con transporte controlado comprobados; el detalle y los límites de QA manual están en el [reporte de ejecución](../../qa/2026-10-23-owner-guided-configuration.md). Las casillas del plan original debajo son el protocolo histórico, no un registro de resultados. No hubo publicación, despliegue ni cambios de flags. El siguiente incremento del handoff es P3, agenda por tareas.

**Goal:** Guiar alta y edición del dueño por tareas pequeñas, con un borrador agregado en memoria y un guardado público explícito usando el contrato vigente.

**Architecture:** Modelo puro de configuración/validación/diferencias, provider dentro de AuthProvider con autoridad revocable y un hook que verifica propiedad antes de exponer borrador. Un POST conserva su promesa y barrera: GET observa configuración pero no demuestra finalización ni habilita reenvío incierto. Sin APIs nuevas ni recuperación durable ficticia.

**Tech Stack:** Node 24, pnpm 11.23.0, Next/React/TypeScript/Zod y Vitest/react-test-renderer existentes.

**Spec:** [2026-10-22-owner-guided-configuration-design.md](../specs/2026-10-22-owner-guided-configuration-design.md). Componer después del [plan de navegación](2026-10-22-admin-guided-navigation.md), sin mezclar commits de otros incrementos.

## Global Constraints

- Node 24 y pnpm 11.23.0; sin nuevas dependencias, endpoints, migraciones ni cambios de lockfile.
- Un solo POST `/api/businesses` con configuración completa revisada; guardar actualiza el perfil público y completa el alta según contrato vigente.
- Borrador solo en memoria de la pestaña y misma autoridad; nunca localStorage, sessionStorage, URL o conversación persistida como sustituto.
- Logo conserva operación separada, hash/conflicto y resultado propios; cancelar configuración no revierte el logo guardado.
- Conservar consentimiento, suscripción, invitaciones, clasificación salud/menores, slug permanente e IDs de recursos/servicios/preguntas.
- Sin nuevos permisos de equipo, FAQ, acciones del asistente, canales, pagos o automatizaciones.
- Marca/tokens Sarin, ayuda contextual, una tarea visible y controles accesibles de al menos 44 px.
- Implementación futura aislada desde fuente efectiva reconciliada; E: mixto solo contiene la entrega documental.

## Review Focus

- Borrador dirty y actualización externa/logo: no perder campos ni confundir un hash de logo con versión de configuración; tareas 1–2 y 4.
- POST lento, resultado incierto o revocación con misma tupla: no abortar por 20 s, no liberar barrera por GET coincidente ni usar caché como autoridad; tarea 2.
- Campo inválido en sección oculta o relación de servicio/recurso rota: abrir/focalizar la sección correcta antes de informar; tareas 1 y 3.
- Propuesta IA sobre edición manual y cambio de política salud/menores: no escribir ni montar IA indebida; tareas 3–4.
- Navegar Atrás/otra ruta/volver con misma sesión, luego cambiar cuenta: recuperar solo memoria propia y borrar autoridad anterior antes de render; tareas 2 y 4.

## Base y estructura

Base comprobada limpia `463ae55f8c873468980746185fb3e91f55cb8681` en `C:/Users/Drean Skate/AppData/Local/SarinBot/whatsapp-adaptation-20261020/source-restoration`, runtime documentado c8bb0a9/delta documental. Reconciliar versión/CI actuales antes de ejecutar y usar using-git-worktrees para aislar rama. No implementar en E: ni modificar worktree recuperado. Llevar spec/plan a la rama de ejecución.

| Archivo | Responsabilidad |
| --- | --- |
| Crear `src/lib/owner-configuration.ts` | Borrador, normalización, pasos/paths, validación y comparación; sin red/React. |
| Crear `src/components/owner-configuration-provider.tsx` | Memoria/autoridad revocable, verificación GET y comando POST pendiente/incierto; sin conversación ni logo binario. |
| Crear `src/hooks/use-owner-configuration.ts` | Revalidar propiedad al entrar/reingresar, ocultar controller sin autoridad fresca y conectar política/consentimiento sin confiar en useBusiness cacheado. |
| Crear `src/components/owner-configuration-workspace.tsx` | Introducción, resumen, pasos/edición, revisión y errores; slot `assistantScope`. |
| Crear `src/components/owner-configuration-fields.tsx` | Fieldsets identity/resources/services/schedule/assistant; extraer controles actuales sin red. |
| Crear `src/components/configuration-assistant.tsx` | Extraer asistente actual y añadir preview local de propuesta revisable, manteniendo useDebouncedChat. |
| Modificar `src/app/layout.tsx` | Montar provider dentro de AuthProvider y encima de rutas, sin cambiar auth. |
| Modificar `src/app/dashboard/onboarding/page.tsx` | Adaptador delgado al hook/vista; conservar AuthGate/AppShell. |
| Crear `tests/owner-configuration-model.test.ts`, `tests/owner-configuration-provider.test.tsx`, `tests/owner-configuration-workspace.test.tsx`, `tests/owner-guided-configuration.test.tsx` | Modelo, memoria/operación, pasos/slot e integración. |
| Actualizar `tests/onboarding-assistance.test.tsx`, `tests/business-location-onboarding.test.tsx`, `tests/business-branding-ui.test.tsx` donde corresponda | Mantener semántica existente con navegación a la sección del campo. |
| Crear `qa/tests/owner-guided-configuration.md` y `docs/qa/2026-10-22-owner-guided-configuration.md` en ejecución futura | Protocolo y resultados reales. |

No modificar backend/BusinessLogoField/useDebouncedChat como atajo a un busy global o un supuesto Publish. El componente informativo de conocimiento lo implementa otro incremento; este define el slot para componerlo sin dependencia circular.

### Task 1: Modelo, validación por pasos y diferencias

**Files:** `src/lib/owner-configuration.ts`, `tests/owner-configuration-model.test.ts` nuevos.

**Interfaces producidas:**

```ts
type OwnerConfigurationSection = 'summary' | 'identity' | 'resources' | 'services' | 'schedule' | 'assistant' | 'review' | 'logo';
type OwnerConfigurationPhase = 'idle' | 'checking' | 'saving' | 'uncertain' | 'external-change' | 'saved' | 'error';
type ConfigurationIssue = { path: string; section: OwnerConfigurationSection; message: string };
type ConfigurationDifference = { section: OwnerConfigurationSection; path: string; before: unknown; after: unknown };
createOwnerConfigurationDraft(business: Business): BusinessConfig;
configurationFingerprint(config: BusinessConfig): string;
validateOwnerConfiguration(config: BusinessConfig, capability: BookingCapability, section?: OwnerConfigurationSection): ConfigurationIssue[];
configurationDifferences(before: BusinessConfig, after: BusinessConfig): ConfigurationDifference[];
mergeOwnerConfigurationProposal(current: BusinessConfig, proposal: BusinessConfig, permanentSlug: string | null): BusinessConfig;
```

BusinessConfig usa tipos/schema existentes. En alta conservar defaults actuales: nombre/categoría/contacto vacíos, recurso/servicio principal con nombre vacío, duración 30 min, buffer/precio 0 y siete días cerrados; son campos por completar/revisar, no datos comerciales publicados. Fingerprint es serialización estable de campos configurables, no hash de autorización ni de logo/subscription; nunca se registra. No hace parse obligatorio de un borrador incompleto: para comprobar un guardado comparar primero proyecciones validadas/normalizadas mediante el schema y después fingerprints. Mantener orden de arrays de menú/recursos; ordenar claves de objeto solo para serialización estable. `validateOwnerConfiguration` construye payload efectivo con intake permitido y reutiliza `businessConfigSchema`; sección filtra issues por sus paths, revisión valida todo. Preservar IDs y vacíos/null explícitos; no recrear preguntas por cada submit.

- [ ] Escribir `stepValidationDoesNotRequireFutureSteps`, `reviewFindsHiddenInvalidResourceReference`, `schemaIssuesMapToRealFieldSection`, `proposalOmissionPreservesMetadataAndExplicitClears`, `configuredSlugCannotChange`, `fingerprintIgnoresLogoAndSubscription`, `questionIdsSurviveReviewAndRetry` y `healthOrMinorsExcludesRestrictedIntake`.
- [ ] Afirmar ejemplos: editar precio conserva IDs/recursos/horario; propuesta sin description conserva valor previo; description `''` conserva borrado explícito; location null borra pero omisión conserva. Recursos referenciados ausentes generan issue de services; todos los días cerrados pueden ser configuración válida.
- [ ] Ejecutar `pnpm exec vitest run tests/owner-configuration-model.test.ts`; RED específico.
- [ ] Implementar interfaces con grafo de imports apto para cliente, sin duplicar reglas ni importar admin/Firebase. Repetir tests GREEN. Commit futuro `feat: model guided owner configuration and review`.

### Task 2: Memoria de pestaña y guardado comprobable

**Files:** crear provider y `tests/owner-configuration-provider.test.tsx`; modificar `src/app/layout.tsx`.

**Consumes:** modelo tarea 1, apiFetch/ApiError y auth existentes. **Interfaces producidas:**

```ts
type ConfigurationScope = { uid: string; authEpoch: number; businessId: string };
type ConfigurationAuthorityState = 'unverified' | 'checking' | 'verified' | 'unavailable' | 'revoked';
type ConfigurationAuthority = { scope: ConfigurationScope | null; generation: number; state: ConfigurationAuthorityState; error: string | null };
type PendingConfigurationCommand = { localId: string; payload: BusinessConfig; fingerprint: string; authorityGeneration: number; startedAt: number; transport: 'pending' | 'failed-unknown'; slow: boolean; observedCurrent: BusinessConfig | null };
type OwnerConfigurationSession = { scope: ConfigurationScope; draft: BusinessConfig; baseline: BusinessConfig; section: OwnerConfigurationSection; phase: OwnerConfigurationPhase; issues: ConfigurationIssue[]; external: BusinessConfig | null; savedConfiguration: BusinessConfig | null; pendingCommand: PendingConfigurationCommand | null; error: string | null };
OwnerConfigurationProvider(props: { children: ReactNode }): ReactNode;
useOwnerConfigurationSession(): {
  authority: ConfigurationAuthority;
  session: OwnerConfigurationSession | null;
  verifyOwner: (input: { uid: string; authEpoch: number; expectedBusinessId?: string }) => Promise<Business | null>;
  protect: (scope: ConfigurationScope, message: string) => void;
  revoke: (scope: ConfigurationScope, message: string) => void;
  observe: (scope: ConfigurationScope, business: Business) => void;
  edit: (scope: ConfigurationScope, next: BusinessConfig) => void;
  go: (scope: ConfigurationScope, section: OwnerConfigurationSection) => void;
  discard: (scope: ConfigurationScope) => void;
  save: (input: { scope: ConfigurationScope; capability: BookingCapability; consentActive: boolean; reviewedExternalFingerprint?: string }) => Promise<void>;
  checkOutcome: (scope: ConfigurationScope) => Promise<void>;
  loadExternal: (scope: ConfigurationScope) => void;
};
```

`verifyOwner` realiza GET nuevo, no recibe un Business cacheado como prueba: mientras verifica, controller privado queda oculto. Comprueba ownerUid/negocio y generación antes de otorgar autoridad. `protect` oculta al no poder verificar por red/error recuperable y conserva memoria; no aborta un POST solo por error de lectura. `revoke` incrementa generación, oculta inmediatamente, purga draft/comando/observaciones y aborta controladores. Se invoca por 403 de propiedad en GET/POST de configuración, ownerUid distinto, business null/eliminado autoritativo, 401 de sesión o cambio de UID/época; también si UID/época/ID no cambiaron. Respuestas de generación revocada jamás repueblan datos.

`observe` nunca concede autoridad: solo adopta con verificación vigente, limpio o mismo fingerprint; dirty registra external sin borrar borrador. Un ownerUid ajeno observado revoca. Mientras pendingCommand exista, observe/polling solo pueden añadir observación externa; no ponen saved/baseline ni retiran barrera aunque coincida. Red, 402, consentimiento/validación no son revocación de propiedad. `discard/loadExternal/edit/save` rechazan mientras pendingCommand exista (pending o failed-unknown), sin borrar su barrera; también respetan checking antes del envío para evitar cambiar el payload o iniciar otro preflight. `go` permite lectura/navegación. Sin comando, discard restaura external o baseline solo en memoria. `save` valida autoridad/permisos/config, relee GET y captura payload exacto; conflicto conocido requiere fingerprint externo recién revisado. Esa comparación no evita carrera posterior de servidor.

`PendingConfigurationCommand.localId` es solo identidad local de la promesa, no se envía al endpoint ni se anuncia como idempotencia. Solo una respuesta final válida de ese POST, mismo comando/generación no revocada, puede poner phase saved y retirar pendingCommand. Un error definitivo pre-commit de validación/402/consentimiento libera la operación y conserva borrador; un error de transporte/5xx/respuesta no verificable deja failed-unknown/uncertain y la barrera durante toda esa sesión de memoria. Respuesta ownerUid ajeno aplica revocación, no recuperación por caché. No inferir resultado de un GET aunque coincida.

- [ ] Escribir `spaReentryVerifiesOwnerBeforeExposingDraft`, `authEpochAndUidMaskOldDraftImmediately`, `sameTupleOwner403PurgesDraftAndPendingGeneration`, `authoritativeNullOrDeletedBusinessRevokes`, `wrongOwnerResponsePurgesWithoutWaitingForUidChange`, `useBusinessErrorWithCachedBusinessDoesNotAuthorize`, `typedOwnerProbeDoesNotParseUseBusinessMessage`, `providerRevokesOnOwnerDenialAfterRouteUnmount`, `network402ConsentAndValidationPreserveProtectedDraft` y `lateSuccessAfterSameTupleRevocationCannotRepopulate`. Probar GET y POST propios del provider, incluso fuera de ruta, no solo cambio de cuenta. Una nueva verificación positiva crea sesión nueva desde dato actual, sin restaurar borrador purgado.
- [ ] Escribir `logoOnlyUpdateDoesNotReplaceDirty`, `externalUpdateRequiresReview`, `preflightDoesNotResetDirty`, `doubleSubmitHasOnePost`, `matchingGetDoesNotPromoteSavedOrReleaseBarrier`, `matchingPollingCannotPromoteSavedOrReleaseBarrier`, `differentGetDoesNotProveOriginalPostFailed`, `discardObserveLoadExternalAndOverwriteCannotClearUnresolvedCommand`, `onlyFinalOriginalPostCanCompleteSaved` y `lateResponseCannotWriteNewScope`.
- [ ] Regresión obligatoria `pendingAThenMatchingGetCannotSendB`: POST A permanece pendiente, GET devuelve exactamente A, intentar editar/guardar B no crea segundo POST ni phase saved ni cambia payload/fingerprint de A. Resolver después la promesa original con respuesta final válida puede completar A; repetir con rechazo real de transporte deja uncertain y otro GET coincidente sigue sin habilitar B.
- [ ] Con fake timers probar `getDeadlineTenSeconds`, `twentySecondsOnlySetsSlowMessageWithoutAbortOrReplacement`, `getObservationHasSeparateControllerFromPendingPost` y cleanup. A 20.000 ms signal del POST sigue no abortado, misma promesa/comando y un solo POST. Revocación real sí aborta y elimina memoria. API sintética sin red/inferencia; una respuesta válida se proyecta antes de almacenarse, sin correo de dueño/logo/suscripción.
- [ ] Ejecutar `pnpm exec vitest run tests/owner-configuration-provider.test.tsx`; RED.
- [ ] Implementar provider sin fetch automático global: verificación/comprobación GET solo por comandos de página, con deadline 10 s y cleanup. POST conserva su promesa sin race/deadline duro: timer de 20 s solo establece slow y texto de espera; nunca aborta ni sustituye el envío por tardanza. Mantener controller POST separado de controller GET; consulta actual no completa el comando. Consumir respuesta/rechazo final de la misma promesa bajo guardas de autoridad/generación. No auto-retry ni requestId ficticio.
- [ ] Implementar `checkOutcome` como observación: GET válido actualiza únicamente pendingCommand.observedCurrent. Si coincide, mostrar «La configuración actual coincide con lo enviado; no pudimos confirmar el resultado de la petición». Si difiere, comparación revisable. Mantener saving si promesa pendiente o uncertain si falló; sin baseline nuevo, saved, discard/loadExternal ni otro POST. Autoridad denegada por esa consulta revoca/purga todo.
- [ ] Añadir beforeunload condicionado a dirty, saving o uncertain, sin afirmar que bloquea Back SPA. Navegación conserva provider, pero reingresar exige GET nuevo antes de exponer controller. Reload/cerrar/cambiar sesión elimina memoria y barrera sin probar que el POST anterior terminó; no recomendarlo como recuperación segura. Contrato durable de operationId/estado/CAS y segundo guardado garantizado quedan fuera de este incremento. No storage ni history hacks.
- [ ] Repetir tests GREEN; `pnpm run typecheck` cuando exista consumo del provider. Commit futuro `feat: preserve owner configuration drafts within the active session`.

### Task 3: Vista guiada, campos y asistente optativo

**Files:** crear `owner-configuration-workspace.tsx`, `owner-configuration-fields.tsx`, `configuration-assistant.tsx`; pruebas `tests/owner-configuration-workspace.test.tsx`.

**Interfaces producidas:**

```ts
type OwnerConfigurationController = { session: OwnerConfigurationSession; dirty: boolean; configured: boolean; busy: boolean; writeBlocked: boolean; canSave: boolean; change: (next: BusinessConfig) => void; go: (section: OwnerConfigurationSection) => void; review: () => void; save: (reviewedExternalFingerprint?: string) => void; discard: () => void; checkOutcome: () => void; loadExternal: () => void };
OwnerConfigurationWorkspace(props: { business: Business; capability: BookingCapability | null; policyReady: boolean; consentActive: boolean; controller: OwnerConfigurationController; assistantScope?: ReactNode; logo: ReactNode; assistant: ReactNode }): ReactNode;
OwnerConfigurationFields(props: { section: OwnerConfigurationSection; draft: BusinessConfig; capability: BookingCapability; disabled: boolean; issues: ConfigurationIssue[]; onChange: (next: BusinessConfig) => void }): ReactNode;
ConfigurationAssistant(props: { uid: string; business: Business; enabled: boolean; draft: BusinessConfig; busy: boolean; onDraft: (draft: BusinessConfig) => void }): ReactNode;
```

Workspace no llama API. `busy` cubre checking/saving; `writeBlocked` añade comando incierto y cualquier falta de autoridad verificable. Permitir navegación/lectura, no editar/aplicar/descartar/guardar mientras writeBlocked. `logo` mantiene componente montado/hidden/inert entre secciones, pero se desmonta por autoridad no verificada/revocada; no prometer selección al salir de ruta. `assistant` solo se monta por elección, en general y con autoridad verificada; provider no recibe mensajes. Slot assistantScope también en salud, solo policyReady/capability válida. Componente informativo lo aporta otro incremento.

- [ ] Escribir `initialManualPathHasThreeStages`, `agendaShowsOneSubsectionAtATime`, `configuredBusinessStartsWithSummary`, `nextAndBackNeverPost`, `reviewExplainsPublicEffect`, `cancelRequiresExplicitDiscard`, `hiddenIssueRevealsFieldBeforeFocus`, `allClosedDaysRemainValid`, `onePrimaryEditorAndOptionalHelp`, `scopeSlotAppearsInHealthWithoutAiConversationOrToneRulesEditors` y `unreadyPolicyDoesNotMountScopeSlot`. Campos de tono/reglas ocultos en salud conservan sus valores históricos en memoria/payload según contrato; no se borran ni se usan para activar IA por mostrar la sección informativa.
- [ ] Escribir `assistantNotMountedByDefault`, `assistantErrorKeepsManualDraft`, `proposalPreviewDoesNotPersist`, `draftChangedAfterPreviewRequiresReviewAgain`, `metadataClearSurvivesProposal`, `busyBlocksOnlyAggregateCommands` y `logoExplainsIndependentSave`. No comprobar cada clase CSS: comprobar tareas visibles, contenido, callbacks, identidad de payload y foco.
- [ ] Ejecutar `pnpm exec vitest run tests/owner-configuration-workspace.test.tsx`; RED.
- [ ] Extraer controles actuales manteniendo etiquetas/ids y helpers de teléfono/redes/ubicación. Form noValidate con validación explícita; al error revelar sección y enfocar resumen/campo montado. Pasos no van a URL. Conservar unidades y compatibilidad de metadatos, IDs y políticas.
- [ ] Extraer asistente conservando useDebouncedChat; introducir comparación de propuesta antes de copiar y comprobar fingerprint actual al aplicar. Layout de ancho completo, sin columna de chat permanente. No montar en salud; error/cuota no deshabilita manual. Repetir tests GREEN. Commit futuro `feat: guide owner configuration through focused editable steps`.

### Task 4: Integración de ruta y contratos existentes

**Files:** crear `src/hooks/use-owner-configuration.ts`, `tests/owner-guided-configuration.test.tsx`; modificar `src/app/dashboard/onboarding/page.tsx` y pruebas existentes afectadas.

**Interfaces:** `useOwnerConfiguration(): { loading: boolean; error: string | null; business: Business | null; capability: BookingCapability | null; policyReady: boolean; consentActive: boolean; authority: ConfigurationAuthority; retryAuthority: () => void; controller: OwnerConfigurationController | null }`. Conecta hooks existentes y realiza verificación GET nueva por entrada/reingreso/ámbito; esa lectura extra es deliberada. Ante cualquier error string de useBusiness, enmascarar controller en el render, llamar protect y pedir verifyOwner con ApiError tipado: no parsear el texto ni usar oldBusiness como prueba. **Solo exponer business/controller con autoridad verified, ámbito exacto y sin error de useBusiness pendiente**; en otro caso null y logo/asistente desmontados. retryAuthority pide la comprobación propia y refresh de useBusiness; si aún queda error cacheado, seguir protegido hasta su lectura correcta, sin inferir autoridad desde el mensaje. Red conserva memoria protegida; GET/POST propios con403owner/null/ownerUid ajeno revocan incluso con misma tupla y fuera de ruta. No cambiar useApiPoll compartido. La lectura autoritativa vigente se proyecta al modelo; polling solo observa. Un savedConfiguration originado por respuesta final POST válida provoca refresh una vez; GET/poll coincidente no.

- [ ] Escribir `saveSendsCompleteConfigAndPreservesUneditedSections`, `paidTrialAndInvitationAccessGatesRemain`, `healthManualAndMinorIntakePolicyRemain`, `logoSavedDuringDirtyConfigDoesNotResetDraft`, `sameSessionBackVerifiesBeforeRestoringDraftAndStep`, `cachedOwnerAfter403NeverRendersControllerOrLogo`, `sameTupleDeletionPurgesBeforeLatePostSuccess`, `newSessionNeverReceivesOldValues`, `externalPublicationIsNotSilentOverwrite` y `saveDoesNotExposePublishOrSaveDraft`. Verificar que el formulario no crea negocio sin pago/invitación; no canjear invitaciones reales.
- [ ] Integrar ruta como adaptador de hook/vista con AuthGate/AppShell actuales. Pasar BusinessLogoField existente mediante logo con onSaved de negocio; no introducir supuesto busy mutuo. Encerrar la vista privada con key de autoridad/negocio para limpiar callbacks locales, sin reiniciar el provider propio del mismo ámbito por cada paso.
- [ ] Slot de alcance: cuando el componente de conocimiento esté integrado, importar `BusinessAssistantScopeNotice` desde `src/components/business-assistant-scope-notice.tsx` y componer assistantScope solo policyReady, con configured=business.sarinConfig.onboardingCompleted y capacidad actual. Mientras no exista, dejar prop ausente, sin stub que afirme nuevas capacidades. La prueba usa nodo centinela para verificar slot; el plan de conocimiento prueba su contenido.
- [ ] Actualizar tests de onboarding/location/branding para abrir sección antes de editar; conservar aserciones de payload/clear/IDs/errores, no convertirlos en snapshots de todo el DOM. Ejecutar `pnpm exec vitest run tests/owner-configuration-model.test.ts tests/owner-configuration-provider.test.tsx tests/owner-configuration-workspace.test.tsx tests/owner-guided-configuration.test.tsx tests/onboarding-assistance.test.tsx tests/business-location-onboarding.test.tsx tests/business-branding-ui.test.tsx tests/schemas.test.ts tests/businesses.test.ts tests/booking-data-policy.test.ts`; verificar nombres contra base reconciliada si hubo renombre.
- [ ] Todos GREEN y `pnpm run typecheck` exit 0. Commit futuro `feat: connect guided owner configuration to existing save contracts`.

### Task 5: Evidencia de interacción y preparación de release

- [ ] Ejecutar los cuatro tests nuevos, suite completa `pnpm test`, `pnpm run typecheck` y `pnpm run build`; registrar resultados/fallos/omitidos reales, sin sumar solapamientos. Confirmar imports cliente del schema y que provider no dispara lecturas en páginas ajenas. Si dependencias enlazadas impiden build, usar copia física de fuente exacta con procedimiento vigente, sin secretos ni producción.
- [ ] En `pnpm run dev:local --port 3042` con Java 21+, Node 24 y `demo-sarin-bot`, preparar cuentas/negocios sintéticos general, salud y menores. Recorrido manual completo y edición de servicio en 320/390/1280 px, teclado, foco, zoom 200 %, unidades, revisión pública y ayuda plegada; ningún chat real/inferencia ni contacto externo. Stub local de IA solo si se ensaya propuesta, identificado como tal.
- [ ] Comprobar Atrás/Back/Forward y reentrada con verificación antes de mostrar borrador. Simular en local owner403/negocio null con misma cuenta y caché antigua: no se muestran controller/logo/draft ni respuesta tardía. Red/402/consentimiento conservan borrador protegido. Ensayar POST A lento: a 20 s solo aviso; GET coincidente no saved ni B; respuesta final original válida sí puede completar. Tras error incierto, permanece bloqueo de escritura en esa memoria. Reload/cambio de sesión no se ofrece como recuperación segura; documentar ese límite sin afirmar CAS o comprobación de request-status.
- [ ] Revisar diff/branch de forma independiente: sin backend/deps/migraciones, payload agregado completo, slug/IDs, health/minors, scope, timers, logo independiente y slot composable. Mantener fuera todo nuevo editor FAQ/canal y toda acción del asistente no respaldada.
- [ ] Guardar protocolo `qa/tests/owner-guided-configuration.md` y reporte saneado `docs/qa/2026-10-22-owner-guided-configuration.md`, limpiar fixtures por inventario y cerrar procesos propios. Preparar publicación futura desde fuente/artefacto efectivos, con procedimiento vigente y una réplica; este encargo no despliega ni cambia flags. Rollback de UI no deshace configuración/logo guardados por usuarios. Commit futuro `docs: verify guided owner configuration`.

## Autorrevisión

Cada requisito tiene dueño: modelo/validación (1), revocación real/memoria/comando pendiente (2), presentación/asistente/slot (3), revalidación al entrar/ruta/logo (4), evidencia (5). Correcciones de revisión: misma tupla no conserva autoridad ante403/null/owner ajeno; useBusiness cacheado no autoriza; 20 s es aviso, no abort/timeout POST; GET actual solo observa y no libera barrera ni permite B. Recuperación durable/segundo envío garantizado requieren contrato futuro fuera de UI. No se ejecutaron pruebas ni producto al preparar estos documentos.
