# Navegación administrativa guiada — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. La delegación del titular permite preparar este plan sin otra consulta rutinaria; este encargo no implementa ni publica código.

**Goal:** Hacer localizables las tareas existentes del dueño y del superadministrador mediante shell accesible y módulos administrativos con estado conservado.

**Architecture:** Modelo puro de destinos/URL, controlador Next con límite Suspense y paneles de presentación ocultos sin desmontar. Shell compartido conserva rutas del dueño; `/admin` y `/admin/assistant` mantienen componentes y contratos internos, con una sección visible por vez.

**Tech Stack:** Node 24, pnpm 11.23.0, Next 16.4.0, React 19.3.0, TypeScript estricto, tokens/Tailwind y Vitest/react-test-renderer existentes.

**Spec:** [2026-10-22-admin-guided-navigation-design.md](../specs/2026-10-22-admin-guided-navigation-design.md). Leer además el [diseño general](../../design/2026-10-22-sarin-admin-navigation-and-guidance.md). La [agenda visual](2026-10-22-owner-agenda.md) es otro incremento y no se implementa con este plan.

## Global Constraints

- Node 24 y pnpm 11.23.0; sin nuevas dependencias, APIs, migraciones ni cambios de lockfile.
- Conservar marca, fuentes, tokens Sarin, `AuthGate`, consentimiento y autorizaciones del servidor.
- Conservar operaciones y contratos actuales de pagos, invitaciones, clasificación salud/menores y handoff.
- No iniciar inferencia, envío, pago, activación, guardado o publicación por abrir/navegar un módulo.
- No persistir borradores, contactos, conversaciones o datos privados en URL, localStorage o sessionStorage.
- Las rutas del dueño y el contrato agregado de configuración permanecen sin cambios.
- No implementar desde el checkout mixto `E:/Proyectos/Sarin Bot` ni sobrescribir el worktree recuperado.

## Review Focus

- URL antigua/contradictoria, cambio de hash o Atrás: sección correcta antes del foco, sin mutación ni lectura de ID no validado; tareas 1 y 3–4.
- Componente oculto con borrador, busy o resultado incierto: conservar la misma instancia y controles internos; tareas 2–4.
- Copiloto oculto que alimenta pagos/negocios: mantener callbacks y datos sin pedir una inferencia; tarea 4.
- Cambio de UID/época/rol con lectura dirigida: destruir contexto privado y rechazar respuestas tardías; tareas 3–4.
- Cambio de módulo con edición de settings o menú móvil abierto: no resetear borrador ni dejar foco/controles en sección oculta; tareas 2–3.

## Base y mapa de archivos

Base comprobada limpia `463ae55f8c873468980746185fb3e91f55cb8681` en `C:/Users/Drean Skate/AppData/Local/SarinBot/whatsapp-adaptation-20261020/source-restoration`; runtime documentado c8bb0a9, posterior delta documental. Antes de ejecutar: reconciliar runtime/CI efectivos y usar using-git-worktrees para rama aislada desde la fuente vigente. No copiar cambios sueltos de E: ni modificar el worktree recuperado. Llevar estos dos documentos a la rama aislada.

| Archivo | Responsabilidad |
| --- | --- |
| Crear `src/lib/admin-navigation.ts` | Catálogo de destinos, validación de URL/deep links y constructor de enlaces/API de lectura. Sin React, red o auth. |
| Crear `src/components/admin-navigation-boundary.tsx` | Suspense, hooks Next/hash, selección y navegación; no lecturas de negocio ni mutaciones. |
| Crear `src/components/workspace-navigation.tsx` | Menú responsive por rol con foco/activo/contexto y cierre. |
| Crear `src/components/admin-module-panel.tsx` | Panel `hidden` estable con heading/ayuda; no API. |
| Modificar `src/components/app-shell.tsx` | Componer navegación, conservar marca/avatar/consentimiento y aceptar selección administrativa opcional. |
| Modificar `src/app/admin/page.tsx` | Agrupar JSX existente, lectura dirigida validada, foco y boundary de autoridad. |
| Modificar `src/app/admin/assistant/page.tsx` | Agrupar componentes existentes sin remount por sección y conservar alimentación del copiloto. |
| Crear `tests/admin-navigation.test.ts`, `tests/workspace-navigation.test.tsx`, `tests/admin-modules.test.tsx`, `tests/admin-assistant-navigation.test.tsx` | Contrato URL, semántica de menú, estados y dependencias/deep links. |
| Modificar pruebas afectadas `tests/user-avatar.test.tsx`, `tests/admin-focus-navigation.test.tsx`, `tests/admin-assistant-platform.test.tsx`, `tests/admin-ai-page.test.tsx` | Adaptar navegación/paneles visibles conservando aserciones de comportamiento. |
| Crear `qa/tests/admin-guided-navigation.md`, `docs/qa/2026-10-22-admin-guided-navigation.md` en ejecución futura | Protocolo y resultados realmente ejecutados, sin datos privados. |

No editar formularios de onboarding/logo, schemas, endpoints, pagos, invitaciones, auth central, pollers o componentes de handoff. Si una integración demuestra defecto previo bloqueante, registrarlo y separarlo del cambio de navegación, sin ampliar contratos silenciosamente.

### Task 1: Resolver puro de navegación y enlaces compatibles

**Files:** crear `src/lib/admin-navigation.ts`; pruebas `tests/admin-navigation.test.ts`.

**Interfaces producidas:**

```ts
type AdminPath = '/admin' | '/admin/assistant';
type AdminModule = 'summary' | 'businesses' | 'access' | 'intelligence' | 'billing' | 'attention';
type AdminSection = 'overview' | 'list' | 'booking-policy' | 'receipts' | 'invitations' | 'provider' | 'business-budget' | 'platform-budget' | 'usage' | 'business-whatsapp' | 'settings' | 'query' | 'payments' | 'platform-whatsapp' | 'web-support';
type AdminDestination = { module: AdminModule; section?: AdminSection };
type AdminLocation = { path: AdminPath; module: AdminModule; section: AdminSection; focusPayment: string | null; proposalId: string | null; supportThread: string | null; targetId: string | null; error: string | null; key: string };
type WorkspaceNavItem = { id: string; label: string; href: string };
resolveAdminLocation(path: AdminPath, search: string, hash: string): AdminLocation;
buildAdminHref(destination: AdminDestination): string;
adminConsoleReadPath(focusPayment: string | null): string;
getAdminNavigationItems(): WorkspaceNavItem[];
getAdminSectionItems(module: AdminModule): WorkspaceNavItem[];
```

`AdminLocation.key` es serialización determinista de ruta/selección/destino validados, sin contenido privado. `attention` usa `/admin/assistant`, demás módulos `/admin`. `buildAdminHref` genera URL nueva sin arrastrar destinos de registro; defaults y validación son exactamente la tabla de la spec. `adminConsoleReadPath` acepta ID válido o null; ante string inválido arroja error local antes de llamar API, no concatena parámetros visuales.

- [ ] Escribir tests de tabla de todos los módulos/defaults/secciones y `invalidOrDuplicateNavigationFallsBack`, `validRecordOverridesVisualSelection`, `contradictoryRecordTargetsAreRejected`, `hashPaymentDerivesFocusedRead`, `unsupportedBusinessFocusDoesNotInventApi`, `supportRequiresV4`, `paymentActionPreservesCurrentUuidContract`, `builderDropsOldTargets` y `unknownQueryNeverReachesAdminApi`.
- [ ] Incluir aserciones concretas: `adminConsoleReadPath('old-payment') === '/api/admin?focusPayment=old-payment'`; `/admin?focusPayment=a#payment-b` devuelve default/error/focusPayment null; `/admin/assistant?paymentAction=<uuid-v4>` devuelve attention/payments sin ejecutar nada; `/admin#business-demo` devuelve businesses/list y targetId business-demo. Probar query vacía/duplicada, ID vacío, path malicioso y módulo válido con sección de otro módulo.
- [ ] Ejecutar `pnpm exec vitest run tests/admin-navigation.test.ts`; confirmar RED de interfaces ausentes.
- [ ] Implementar modelo y validadores locales sin importar APIs server-only ni URL remota. No modificar generadores de enlaces protegidos actuales.
- [ ] Repetir comando; GREEN. Commit futuro focalizado `feat: define compatible administrative navigation destinations`.

### Task 2: Shell, controlador URL y paneles estables

**Files:** crear `admin-navigation-boundary.tsx`, `workspace-navigation.tsx`, `admin-module-panel.tsx`; modificar `src/components/app-shell.tsx`; pruebas `tests/workspace-navigation.test.tsx`, actualizar `tests/user-avatar.test.tsx`.

**Consumes:** tipos/catálogo tarea 1 y auth/Next existentes.

**Interfaces producidas:**

```ts
type AdminNavigationController = { location: AdminLocation; navigate: (destination: AdminDestination) => void };
AdminNavigationBoundary(props: { children: (controller: AdminNavigationController) => ReactNode }): ReactNode;
WorkspaceNavigation(props: { context: 'business' | 'platform'; items: WorkspaceNavItem[]; activeId: string; isSuperadmin: boolean }): ReactNode;
AdminModulePanel(props: { id: string; active: boolean; title: string; description: string; children: ReactNode }): ReactNode;
AppShell(props: { children: ReactNode; admin?: boolean; adminLocation?: AdminLocation }): ReactNode;
```

`WorkspaceNavigation` resuelve iconos de un mapa local de IDs con lucide existente; no serializar funciones en el modelo puro. `AdminModulePanel` siempre renderiza children en el mismo nodo, usa `hidden={!active}`, `inert={!active}` y heading con `${id}-title`/tabIndex -1. No emite GET/PATCH, no administra busy de hijos. Boundary interno usa usePathname/useSearchParams y hashchange dentro de Suspense; antes de leer hash inicial devuelve carga neutra. navigate usa router.push con scroll false; no almacena campos editados. Shell owner no necesita Boundary ni useSearchParams.

- [ ] Escribir `ownerKeepsFourDestinations`, `onlySuperadminGetsContextSwitchOnMobile`, `activeModuleUsesValidatedSelection`, `mobileMenuHasExpandedControlsAndEscapeReturn`, `hiddenPanelCannotReceiveKeyboardFocus`, `panelSwitchKeepsChildInstanceAndDraft`, `hashNotReadyDoesNotMountPrivateWorkspace` y `backForwardUpdatesSelectionWithoutEffect`.
- [ ] Verificar avatar/signOut/salto/ConsentPanel preservados. Ajustar el test de shell administrativo existente para declarar realmente isSuperadmin true y esperar seis destinos más retorno al negocio, sin debilitar la prueba de usuario ordinario.
- [ ] Ejecutar `pnpm exec vitest run tests/workspace-navigation.test.tsx tests/user-avatar.test.tsx`; RED en capacidades nuevas.
- [ ] Implementar navegación en flujo, contexto persistente, activo semántico, controles 44 px, paneles estables y Boundary. En cambio intencional de tarea cerrar menú y enfocar heading visible; en Escape devolver foco al botón. No role menu/tablist ni foco robado por polling.
- [ ] Repetir comando; GREEN. Commit futuro `feat: guide workspace navigation by role and task`.

### Task 3: Consola por módulos sin pérdida de estado

**Files:** modificar `src/app/admin/page.tsx`; crear `tests/admin-modules.test.tsx`; actualizar `tests/admin-focus-navigation.test.tsx`, `tests/admin-ai-page.test.tsx`.

**Consumes:** controller y AdminLocation tareas 1–2. **Produces:** la misma página/contratos, con Console privado keyed por `[uid, authEpoch, isSuperadmin, signingOut]`. Console recibe `{ location: AdminLocation }`; no usar module/section como key.

- [ ] Escribir `oneConsoleSectionVisibleAllExistingComponentsMounted`, `settingsDraftSurvivesModuleSwitchAndFocusedRead`, `hiddenBudgetKeepsDraftAndBusyAtSameRevision`, `invitationsKeepPendingCommand`, `moduleNavigationDoesNotPatch`, `differentFocusedPaymentReloadsExactRead`, `refreshDoesNotRefocusRecord`, `missingRecordShowsCoverageNotice`, `roleOrEpochChangeDestroysPrivateWorkspace` y `lateFocusedReadCannotPopulateNewAuthority`. No atribuir al cambio la corrección del menor conocido donde una versión nueva del presupuesto sustituye el borrador por polling.
- [ ] Mantener pruebas reales de proveedor en `admin-ai-page.test.tsx`: entrar a intelligence/provider antes de operar, comprobar cero PATCH al navegar/seleccionar y guardado explícito con bloqueo local. Los mocks de Next ahora incluyen useSearchParams/useRouter/Suspense según tarea 2, sin conexiones externas.
- [ ] Ejecutar `pnpm exec vitest run tests/admin-modules.test.tsx tests/admin-focus-navigation.test.tsx tests/admin-ai-page.test.tsx`; RED de organización/ciclo nuevo.
- [ ] Envolver JSX de tabla/recibos/settings/componentes existentes en paneles estables según tabla de spec; resumen solo muestra estado/pendientes consultados y accesos. Mantener callbacks/working/reasons/images/settings/notice en Console. Conservar ruta y payload de review/settings; no sustituir aprobación directa actual por otra propuesta ni retirar controles.
- [ ] Sustituir adminReadPath por constructor validado. Lectura inicial o cambio de focusPayment usa signal/expectedUid/predicado de generación; cambiar solo module/section no lee de nuevo. Inicializar settings una sola vez por ámbito, preservarlo al refrescar o cargar otro comprobante. No simular CAS de settings ni resetear motivos por navegación.
- [ ] Cambiar efecto de foco a destino validado/visible: una vez por cambio de destination key después de datos; no usar un único boolean de por vida que impida otro deep link. Error/ausente enfoca aviso y muestra enlace de recuperación. Consulta 404 conserva navegación utilizable para volver al resumen.
- [ ] Repetir comando, más `pnpm exec vitest run tests/admin-deep-links.test.ts tests/admin-ai-budget.test.tsx tests/admin-platform-budget-ui.test.tsx tests/admin-booking-data-policy.test.tsx tests/invitation-ui.test.tsx`; GREEN. Commit futuro `feat: organize platform console into stable task modules`.

### Task 4: Asistente y atención separados por ámbito

**Files:** modificar `src/app/admin/assistant/page.tsx`; crear `tests/admin-assistant-navigation.test.tsx`; actualizar `tests/admin-assistant-platform.test.tsx`.

**Consumes:** controller/Location y paneles. AssistantWorkspace conserva key de autoridad ya existente y recibe `{ location: AdminLocation }`; no key por sección. `AdminCopilot`, `AdminPaymentConfirmation`, `AdminPlatformWhatsApp`, `PlatformWhatsAppLink`, `AdminWhatsAppConversations` y `AdminPlatformSupport` conservan props y posiciones estables.

- [ ] Escribir `copilotHiddenStillFeedsBusinessesAndPayments`, `switchPreservesQuestionAndUncertainPaymentTuple`, `entryPaymentActionUrlReadsButNeverConfirms`, `entrySupportUrlOpensCorrectThreadSection`, `laterSensitiveDeepLinkOffersExplicitNewTabWithoutReplacingTask`, `supportHashDoesNotAutoCreateConversation`, `conflictingTargetsShowRecoveryWithoutPrivateRead`, `returnToQueryDoesNotGenerateInference` y `scopeChangeDropsAllHiddenPrivateState`.
- [ ] Añadir prueba con `AdminPaymentConfirmation` real y API simulada: preparar o cargar propuesta, simular confirmación incierta, cambiar sección y regresar; conservar misma tupla/requestId y texto «Reintentar la misma confirmación». Ningún cambio de URL manda POST de confirmación. Su reauth/caducidad quedan en suites existentes. Probar soporte con componente real o spy fiel a su API, sin crear hilos reales.
- [ ] Ejecutar `pnpm exec vitest run tests/admin-assistant-navigation.test.tsx tests/admin-assistant-platform.test.tsx tests/admin-payment-confirmation.test.tsx`; RED de integración nueva.
- [ ] Reemplazar lectura única de window.search por location validada para seleccionar sección. Capturar con ref los proposalId/supportThread de entrada del workspace y mantener esas props durante toda su vida; no cambiarlas al borrar parámetros por navegación. En una transición posterior de URL que contenga propuesta/hilo, mostrar aviso con enlace validado para abrir explícitamente en otra pestaña y enfocar aviso; no sustituir el estado sensible, ni disparar otra lectura/preparación/confirmación. La nueva pestaña resuelve el destino en su propia entrada. Probar también Atrás/Adelante con confirmación incierta y draft de soporte. Envolver paneles, conservar callbacks del copiloto y diferencia plataforma/negocios. No desmontar copiloto al cambiar sección ni extraer nuevo loader que duplique GET. Generic #soporte-web selecciona sección y enfoca contenedor, sin convertir abrir sección en abrir chat.
- [ ] Repetir comandos más `pnpm exec vitest run tests/admin-copilot-ui.test.tsx tests/admin-platform-whatsapp.test.tsx tests/admin-whatsapp-conversations.test.tsx tests/platform-support-ui.test.tsx`; todos esos archivos existen en la base revisada.
- [ ] GREEN y `pnpm run typecheck` exit 0. Commit futuro `feat: separate assistant and support navigation by scope`.

### Task 5: Verificación, evidencia y entrega futura

**Files:** protocolo `qa/tests/admin-guided-navigation.md`, reporte `docs/qa/2026-10-22-admin-guided-navigation.md` en rama futura. No atribuir resultados a esta preparación documental.

- [ ] Ejecutar `pnpm exec vitest run tests/admin-navigation.test.ts tests/workspace-navigation.test.tsx tests/admin-modules.test.tsx tests/admin-assistant-navigation.test.tsx tests/user-avatar.test.tsx tests/admin-focus-navigation.test.tsx tests/admin-assistant-platform.test.tsx tests/admin-ai-page.test.tsx tests/admin-payment-confirmation.test.tsx tests/admin-deep-links.test.ts`; todas GREEN. Ejecutar `pnpm test`, `pnpm run typecheck` y `pnpm run build`; registrar fallos/omitidas reales sin sumar suites solapadas. Build verifica también que los nuevos useSearchParams estén bajo Suspense sin romper generación de páginas.
- [ ] Si el build falla por dependencias enlazadas del worktree, usar copia física de fuente exacta con procedimiento de la base efectiva, sin secretos ni producción. No dar por aprobado build a partir de tipos. No ejecutar Worker checks sin cambios de Worker por rutina.
- [ ] Preparar demo sintética en `pnpm run dev:local --port 3042`, Node 24/Java 21+, puertos 8080/9099/4400/4500 libres. En 320/390/1280 px y zoom 200 %, probar menú/teclado/Escape/contexto, una sección visible, campos largos, foco de deep link/Atrás/Adelante y acciones sin quedar tapadas. No enviar preguntas reales ni mensajes externos.
- [ ] Con fixtures locales comprobar enlace de comprobante fuera del primer listado, hash de negocio ausente, propuesta enlazada y soporte sintético; capturar URL/estado saneados sin tokens. Cambiar módulo con edición y volver; pérdida de autoridad elimina datos incluso de paneles ocultos. Simular respuesta tardía de pago/soporte tras ocultarlos: foco permanece en la tarea activa y un lector de pantalla no anuncia avisos del panel oculto. Volver a propuesta busy/incierta conserva estado/requestId sin confirmar ni preparar de nuevo. Las carreras y reintento incierto no observados en navegador se atribuyen solo a sus pruebas automatizadas.
- [ ] Comprobar en la fuente reconciliada ausencia de portales/diálogos fuera de los paneles y en el DOM activo que no aparecen overlays administrativos al navegar. La base revisada solo tiene foco imperativo de pago/soporte y popup externo de reautenticación. No prometer cerrar ese popup ya iniciado; su retorno conserva controles y no auto-confirma. Si aparecen portales en la base nueva, resolverlos antes de aceptar hidden/inert como protección, sin añadir un busy global ficticio.
- [ ] Probar smoke de rutas del dueño: agenda, configuración, QR y suscripción conservan entrada/ConsentPanel. En configuración verificar que no aparece Guardar borrador/Publicar y que logo mantiene control propio. No realizar escritura real, pago, canje o aceptación de salud/menores para una prueba de navegación.
- [ ] Revisar diff y branch completo de forma independiente sobre Review Focus: no rutas nuevas de backend, no payload alterado, no contactos en URL, no remount por módulo, no scope oculto reutilizado. Documentar que las lecturas de módulos ocultos y límite de settings sin CAS permanecen; no afirmar ahorro de red o recuperación durable de borradores.
- [ ] Preparar release futura desde fuente efectiva reconciliada y artefacto exacto; mantener una instancia y procedimiento vigente de publicación/reversión. La autorización general del titular existe, pero este encargo no despliega. Rollback de UI no revierte acciones reales realizadas por usuarios ni borra datos. No cambiar flags, canales ni presupuestos por publicar navegación.
- [ ] Guardar evidencias saneadas y resultado real con pin fuente/runtime, cerrar solo procesos/pestañas/fixtures propios. Commit futuro `docs: verify guided administrative navigation`.

## Autorrevisión

La spec se implementa con catálogo/URL (1), shell/controlador/panel (2), consola (3), atención (4) y evidencia (5). Se preserva dependencia del copiloto sin cargar otra API; autoridad y foco no dependen de CSS. Busy permanece local y no se promete un bloqueo global inexistente. Alta/edición guiada, CAS agregado, publicación separada y borrador durable están expresamente fuera de este incremento, sin tareas vacías que aparenten implementarlos. Ningún paso se marca ejecutado en esta entrega documental.
