# Health and Represented Booking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Permitir que un adulto reserve para sí o para un menor representado, incluyendo citas de salud, mediante autorización específica y un recorrido estructurado sin IA para salud/menores.

**Architecture:** Conservar `client.uid` como quien gestiona la cita y añadir beneficiario/representación opcionales en la cita privada. Una política privada por negocio determina los requisitos; constancias por caso y propuestas v2 los vinculan transaccionalmente, sin reinterpretar autorizaciones ni citas históricas. Mantener el chat general para adulto propio; el formulario usa disponibilidad/propuestas/confirmación de servidor y no un proveedor de IA.

**Tech Stack:** Next.js 16.4, React 19.3, TypeScript estricto, Node 24, pnpm 11.23.0, Zod, Firebase Auth, adaptador D1/Firestore y Worker singleton existentes. Sin dependencias nuevas.

**Spec:** [Diseño aprobado de salud y representación](../specs/2026-10-16-health-and-represented-booking-design.md). El propietario aprobó expresamente el diseño y pidió preparar este plan. **Plan aprobado y ejecutado localmente. Aceptación técnica completada; sin publicación.** Se conserva su método ya elegido: ejecución directa en esta sesión, con revisión independiente final.

## Global Constraints

- «El alcance es agenda: servicio, profesional/recurso, horario, contacto y confirmación.»
- «Sarin no recoge historia clínica, síntomas, diagnósticos, imágenes clínicas ni consentimiento para procedimientos médicos.» Es el alcance del flujo nuevo, no una garantía sobre campos legados.
- «Google acredita la cuenta, no edad, parentesco o tutela.»
- «No hay llamada de IA en ese recorrido ni campo de texto clínico.» Salud y representación no cambian automáticamente el proveedor de los otros negocios.
- «No exigir nueva aceptación para consultar/cancelar citas existentes ni ejercer derechos.»
- «No añadir por defecto preguntas abiertas al recorrido nuevo; la lista de campos admitidos se valida también en servidor.»
- «La política ausente significa capacidad nueva no habilitada, no “negocio revisado”.» Conservar chat general legado; incorporación manual debe clasificar los negocios de salud antes de usar el flujo nuevo.
- Mantener `America/Bogota`, vigencia de propuesta de diez minutos, acceso de suscripción, locks de horario/cliente y diez citas de prueba sin devolver cupo al cancelar. Una operación estructurada sin IA no reserva presupuesto monetario ni consume una respuesta de chat.
- Únicamente datos sintéticos `demo-*`; no pruebas con niños/pacientes reales ni llamadas pagadas. No publicar, activar flags remotos, enviar correos o ejecutar supresiones mediante este plan.
- Una réplica; D1/R2 y Firebase Auth actuales. Sin migración destructiva ni cambio de hostname del motor; exclusivamente `alsdevstudio.com`.

## Review Focus

1. La política cambia de general a salud mientras un turno espera o una propuesta v1 está pendiente: detener nueva IA/confirmación incompatible, conservando recuperación de una cita ya guardada. Tests en tareas 3 y 4.
2. Se cambia nombre de beneficiario o calidad del representante reutilizando la misma referencia: exigir caso nuevo, sin actualizar silenciosamente constancia/binding anteriores. Tests en tareas 2 y 3.
3. La aceptación de un adulto/negocio se copia a otro menor, negocio o UID: las relaciones de cuenta no conceden acceso familiar ni autorizaciones generales. Tests en tareas 2, 3 y 7.
4. Se retiran permisos mientras la respuesta de confirmación se pierde: recuperar únicamente lo efectivamente guardado; sin segunda cita/cupo ni reapertura por una lectura atrasada. Tests en tareas 3, 5 y 7.
5. Un marcador privado aparece en imagen, prompt, telemetría o proyección pública: conservar allowlists y rechazar chat restringido antes de admisión/proveedor. Tests en tareas 4, 6 y 7.

## Mapa de archivos y contrato común

Crear `src/lib/booking-subject.ts` para tipos/esquemas compartidos de beneficiario; `src/lib/booking-subject-legal.ts` para documentos de este ámbito; `src/lib/server/booking-data-policy.ts` para clasificación; `src/lib/server/booking-subject-consent.ts` para constancias; `src/lib/server/structured-booking.ts` para orquestar solicitudes estructuradas; `src/lib/server/representation-review.ts` para revisión del dueño. No convertir `chat.ts` ni el archivo de consentimiento de cuenta en un subsistema clínico.

Crear UI `structured-booking.tsx`, `booking-subject-consent.tsx`, `admin-booking-data-policy.tsx` y `representation-review.tsx`; controladores `useBookingDataPolicy.ts`, `useBookingSubjectConsent.ts`, `useStructuredBooking.ts`. Reutilizar estilos/controles y los formularios manuales de configuración existentes. Los detalles de interfaces siguientes son comunes a todas las tareas:

```ts
type BookingSubjectKind = 'self' | 'represented_minor';
type RepresentativeRole = 'parent' | 'legal_guardian';
type BookingBeneficiary = { kind: 'self' } | {
  kind: 'represented_minor'; displayName: string; representativeRole: RepresentativeRole;
}; // displayName recortado, 1–80 caracteres; sin documento, fecha de nacimiento ni UID infantil.
type BookingSubjectCase = {
  bookingRequestId: string; subjectKind: BookingSubjectKind; representativeRole?: RepresentativeRole;
}; // ID y requestIdSchema existentes: 8–128 caracteres, A-Za-z0-9_-.
type BookingDataPolicy = {
  version: 1; revision: number; dataMode: 'general' | 'health'; representedMinorsEnabled: boolean;
  reason: string; updatedAt: number; updatedBy: string;
};
type BookingCapability = {
  configured: boolean; revision: number; dataMode: 'general' | 'health'; representedMinorsEnabled: boolean;
}; // sin motivo ni identidad del administrador.
type BookingSubjectDecisions = {
  dataAuthorized: boolean; sensitiveDataAuthorized: boolean; representationDeclared: boolean;
}; // necesidades derivadas de política/caso; no aceptar categorías enviadas libremente.
type RepresentationReview = {
  revision: number; status: 'declared' | 'reviewed' | 'needs_contact';
  reviewedBy: string | null; reviewedAt: number | null;
};
type StructuredProposalContext = { case: BookingSubjectCase; beneficiary: BookingBeneficiary };
type ValidatedBookingSubject = StructuredProposalContext & {
  proposalId: string;
  authorization: { receiptId: string; fingerprint: string; policyRevision: number } | null;
}; // solo contexto construido y comprobado por servidor, no cuerpo de API confiado.
```

Guardar políticas/estado/recibos/bindings privados en `serverSettings` con claves hash SHA-256 de argumentos canónicos, máximo 128 caracteres. Mantener arrays ordenados y claves de mapas canónicas, como en consentimiento existente; un hash enlazable no es anonimización. No cambiar las huellas históricas ni ampliar `ConsentScope` de cuenta: el módulo específico usa su propio discriminante `scope:'booking_subject'`.

### Task 1: Clasificación privada y capacidad del negocio

**Files:** Create `src/lib/booking-subject.ts`, `src/lib/server/booking-data-policy.ts`, `src/app/api/admin/booking-data-policy/route.ts`, `src/app/api/businesses/[id]/booking-policy/route.ts`, `tests/booking-data-policy.test.ts`, `tests/booking-data-policy-routes.test.ts`. Modify `src/lib/server/businesses.ts`, `cloudflare/src/router.ts`, `cloudflare/tests/router.test.mjs`.

**Interfaces:** Produce `readBookingDataPolicy(businessId,db?,tx?):Promise<{policy:BookingDataPolicy|null;capability:BookingCapability}>`; `saveBookingDataPolicy(admin,{businessId,expectedRevision,dataMode,representedMinorsEnabled,reason},db?):Promise<BookingDataPolicy>`; `assertBookingIntakePolicy(tx,businessId,intakeFields,db):Promise<void>`. Ausente => `configured:false,revision:0,dataMode:'general',representedMinorsEnabled:false`. Guardar requiere superadmin, negocio existente y CAS; corrupción falla 503. Motivo 1–300 caracteres; fecha/actor del servidor. Activar salud o menores exige que no existan campos libres en intake; preservar los campos de negocios generales que no activan estas capacidades. `createBusiness` no permite reintroducirlos después por otra vía.

- [x] **RED:** Casos `inherits unreviewed legacy general capability`, `rejects owner and stale policy revision`, `rejects restricted activation with free intake and subsequent reintroduction`, `fails closed on malformed policy`. Afirmaciones: ausencia no crea documento; dueño no puede cambiar clasificación; una edición concurrente gana y otra devuelve 409; `publicBusiness()` no incluye política/motivo/actor.
- [x] **Ejecutar RED:** `pnpm.cmd test tests/booking-data-policy.test.ts tests/booking-data-policy-routes.test.ts`. Expected: FAIL por exports/rutas ausentes.
- [x] **GREEN:** Implementar interfaces. GET/PATCH admin con cuerpo estricto ≤8 KiB; GET de capacidad requiere cuenta autenticada y devuelve solo capacidad del negocio existente. No aceptar `ownerUid`, fechas ni flags globales del navegador. Mantenimiento permite únicamente rutas exactas autenticadas GET/PATCH admin, con un único `businessId` válido solo en GET; conserva bloqueados chat/otras consultas.
- [x] **Verificar:** Repetir pruebas y `node --test cloudflare/tests/router.test.mjs`. Expected: PASS incluyendo duplicados/extra/cursor, falta de Bearer y comprobación real de superadmin en Next.
- [x] **Commit:** `feat: classify booking data needs per business` con los archivos de esta tarea.

### Task 2: Autorización específica antes de datos representados/sensibles

**Files:** Create `src/lib/booking-subject-legal.ts`, `src/lib/server/booking-subject-consent.ts`, `src/app/api/booking-subject-consent/route.ts`, `tests/booking-subject-consent.test.ts`, `tests/booking-subject-consent-route.test.ts`. Modify `src/lib/legal.ts` únicamente para explicar el tratamiento nuevo y actualizar su versión cuando cambien documentos generales.

**Interfaces:** Consume política de tarea 1 y `assertConsent` de cuenta/negocio existente. Produce `readBookingSubjectConsent(user,businessId,case,db?,tx?):Promise<BookingSubjectConsentStatus>`; `updateBookingSubjectConsent(user,{businessId,case,action,requestId,expectedRevision,fingerprint?,decisions?},db?):Promise<BookingSubjectConsentStatus>`; `assertBookingSubjectConsent(tx,user,business,case,db):Promise<{receiptId:string;fingerprint:string;policyRevision:number}|null>`. Solo devuelve `null` si política/caso no requieren este permiso adicional; nunca por ausencia/corrupción del permiso obligatorio. `BookingSubjectConsentStatus` contiene `required`, `active`, `revision`, documentos específicos y recibo privado actual o `null`. Los documentos incluyen negocio/contacto, caso, calidad, categorías/finalidades, derechos, versión y huella. Versión específica inicial `2026-10-16.subject.1`.

- [x] **RED:** `requires explicit sensitive choice for adult health`, `requires representation and child-data authorization`, `requires both for pediatrics`, `cannot replay acceptance over withdrawal`, `cannot cross uid business case or representative role`, `canonical receipt survives map key sorting`. Afirmar 428 antes de aceptación; adulto propio general no crea constancia innecesaria; health+self exige `dataAuthorized && sensitiveDataAuthorized`; menor general exige `dataAuthorized && representationDeclared`; pediatría exige las tres. No admitir rol en `self`; el menor requiere rol válido. Recibo no contiene nombre del niño, IP o chat.
- [x] **Ejecutar RED:** `pnpm.cmd test tests/booking-subject-consent.test.ts tests/booking-subject-consent-route.test.ts`. Expected: FAIL por módulo/ruta ausente.
- [x] **GREEN:** Estado `subject_state_<hash(uid,businessId,bookingRequestId)>`; recibos inmutables `subject_receipt_<hash(uid,businessId,bookingRequestId,requestId)>`. Asociar caso, rol, revisión de política y huella; UID/fecha servidor, CAS e idempotencia por huella de entrada. Modificar rol/caso exige referencia nueva, no sobrescritura. El mismo ID de decisión con payload distinto devuelve 409. Revocación y nueva confirmación deben leer/escribir el mismo estado. No reutilizar pruebas anónimas de cuenta para este ámbito. GET/POST autenticados, entradas estrictas ≤8 KiB, `no-store`; no pedir ni aceptar nombre del beneficiario aquí. Mostrar identidad/contacto de negocio y canal alternativo. Silencio y Google no aceptan decisiones.
- [x] **Verificar:** Repetir pruebas más `pnpm.cmd test tests/consent.test.ts tests/consent-routes.test.ts`. Expected: PASS; los snapshots históricos conservan su contenido. Un cambio de documentos generales exige aceptación actual para nueva operación, sin borrar constancias.
- [x] **Commit:** `feat: record case-specific booking authorizations` con archivos de esta tarea.

### Task 3: Propuestas estructuradas y confirmación con beneficiario

**Files:** Create `src/lib/server/structured-booking.ts`, `src/app/api/businesses/[id]/availability/route.ts`, `src/app/api/businesses/[id]/booking-proposals/route.ts`, `tests/structured-booking.test.ts`, `tests/structured-booking-routes.test.ts`, `tests/represented-booking.integration.test.ts`. Modify `src/lib/server/booking-proposals.ts`, `src/lib/server/bookings.ts`, `src/lib/server/schemas.ts`, `src/types/chat.ts`, `src/types/firestore.ts`, `src/app/api/businesses/[id]/booking-proposals/[proposalId]/confirm/route.ts`, `tests/booking-proposals.test.ts`, `tests/bookings.test.ts`, `tests/firestore.integration.test.ts`, `tests/consent-fixtures.ts`.

**Interfaces:** Consume política/caso/autorización de tareas 1–2. Produce `readStructuredAvailability(user,businessId,{case,dateKey,serviceId,resourceId?},db?):Promise<ReturnType<typeof getAvailableSlots>>` y `createStructuredBookingProposal(user,businessId,{case,beneficiary,selection},db?):Promise<BookingProposalView>`. `selection` usa los cuatro campos actuales. Extender `createBookingProposal(user,businessId,selection,requestId,db?,subject?:StructuredProposalContext)`: los argumentos existentes no cambian y la variante estructurada valida caso/binding dentro de su misma transacción, sin encadenar dos commits para simular atomicidad. Extender confirmación con `beneficiary?` tipado para propuestas v2; `createAppointmentInTransaction(...,now,subject?:ValidatedBookingSubject)` recibe el contexto validado por servidor, jamás un receiptId confiado del navegador.

Produce también el helper de prueba `acceptSyntheticSubjectConsent(db,actor,business,case,policy)`: obtiene documentos vigentes y ejecuta aceptación explícita mediante el dominio real de tarea 2 para los actores sintéticos nombrados. No fabrica estados permisivos ni cambia el adaptador genérico.

- [x] **RED:** `structured health proposal never calls engine or response quota`, `name and representative change cannot reuse a case`, `pending legacy proposal cannot bypass current health policy`, `confirmed v1 replay survives new policy and withdrawal`, `represented subject cannot change booking client uid`, `two confirmations and concurrent withdrawal create at most one appointment`. Incluir revisión de catálogo/política, vencimiento 600000 ms y cupo final de diez citas. La misma referencia con selección/beneficiario alterados devuelve 409. Escribir también antes del dominio los casos de propuesta/confirmación D1 y Firestore descritos en tarea 7; deben fallar por las capacidades nuevas ausentes, sin introducir bypasses artificiales. Los casos de rechazo de chat/cola pertenecen a tarea 4.
- [x] **Ejecutar RED:** `pnpm.cmd test tests/structured-booking.test.ts tests/structured-booking-routes.test.ts tests/booking-proposals.test.ts tests/bookings.test.ts tests/represented-booking.integration.test.ts`; después `pnpm.cmd run test:rules`. Expected: FAIL en capacidades/casos nuevos ausentes, con emulador cerrado; no relajar las pruebas antiguas.
- [x] **GREEN:** Mantener lector discriminado v1/v2. Propuestas v2 guardan referencia de caso, revisión de política, recibo/huella y hash canónico de beneficiario; el nombre completo se guarda únicamente al confirmar en la cita privada. Vincular una referencia a una propuesta/binding inmutable; cambio de beneficiario/rol requiere caso y decisión nuevos. Mapping incluye el contrato nuevo sin cambiar hashes v1. Antes de disponibilidad/propuesta, exigir permisos y caso para salud/menor; inputs de salud/menor no admiten intake libre. POST disponibilidad ≤8 KiB evita incluir selección sensible en query; POST propuesta ≤8 KiB. La ruta existente de confirmación admite beneficiario como dato desconocido hasta resolver replay, igual que el contacto actual: validar solo para nueva confirmación.
- [x] **GREEN:** La transacción de confirmación comprueba política, autorización vigente y binding antes de crear; conserva locks, acceso, catálogo y cuota de citas. `beneficiary.kind:'self'` no duplica identidad; menor guarda nombre mínimo/rol y, cuando corresponda, `subjectAuthorization:{receiptId,bookingRequestId,policyRevision}`. Solo para menor, inicializar revisión `declared`, revisión 0, sin revisor/fecha. Rol/subjectKind de beneficiario y caso deben coincidir. Prohibir entrada directa a `createAppointment` que eluda autorización actual cuando la política/caso la requiere. Replay de cita guardada conserva precedencia y no acepta sustitución de payload.
- [x] **Verificar:** Repetir ambos comandos de RED, secuencialmente. Expected: PASS; precio, servicio y disponibilidad se obtienen del negocio, no del cliente. Cero incremento de respuestas/presupuesto monetario por formulario; sí una cita consumida cuando corresponde.
- [x] **Commit:** `feat: confirm structured bookings with scoped beneficiary consent`.

### Task 4: Impedir IA y revisión humana privada

**Files:** Create `src/lib/server/representation-review.ts`, `src/app/api/businesses/[id]/appointments/[appointmentId]/representation-review/route.ts`, `tests/representation-review.test.ts`, `tests/representation-review-route.test.ts`, `tests/health-booking-flow.test.ts`. Modify `src/lib/server/chat.ts`, `tests/chat.test.ts`, `tests/engine-budget.test.ts`.

**Interfaces:** Produce `updateRepresentationReview(owner,businessId,appointmentId,{expectedRevision,status:'reviewed'|'needs_contact'},db?):Promise<Appointment>`. Solo dueño del negocio, cita representada existente y CAS; revisor/fecha del servidor. El estado no cambia `Appointment.status`, horario, consumo ni constancias; `reviewed` significa revisión realizada, no verificación infalible.

- [x] **RED:** `health policy stops queued inference before paid fetch`, `health client and owner copilot cannot dispatch patient input`, `owner cannot review another business or nonrepresented appointment`, `stale review is rejected without changing booking status`. Usar marcador `SYNTHETIC_PRIVATE_SUBJECT` y `expect(engine).not.toHaveBeenCalled()`; contadores de admisión/respuesta/presupuesto no cambian por rechazo nuevo.
- [x] **Ejecutar RED:** `pnpm.cmd test tests/chat.test.ts tests/engine-budget.test.ts tests/representation-review.test.ts tests/representation-review-route.test.ts tests/health-booking-flow.test.ts`. Expected: FAIL para nueva política/revisión ausente. Los casos de flujo comprueban los tres modos/canales en el dominio y marcadores privados, sin depender de componentes de la tarea 5.
- [x] **GREEN:** Para negocio persistido `health`, rechazar nuevos turnos de cliente y propietario con 409 `STRUCTURED_BOOKING_REQUIRED`, antes de admisión y al salir de cola/justo antes de inferir. Leer política transaccionalmente donde se reserva cuota, junto a permisos actuales. Recuperar operaciones confirmadas sin nueva IA antes de denegar reintentos legítimos. El dueño conserva formulario manual de `dashboard/onboarding`; no necesita chat para configurar. El recorrido de menor general no llama al chat; no prometer detección de todo dato escrito en chat general. PATCH de revisión autenticado, cuerpo estricto ≤1 KiB, sin texto clínico libre.
- [x] **Verificar:** Repetir pruebas. Expected: PASS incluyendo cambio de política durante cola, autorización y constancia intactas; el mismo marco protege todos los canales del dominio, sin habilitar WhatsApp.
- [x] **Commit:** `feat: isolate restricted bookings from inference and record review`.

### Task 5: Formulario cliente y decisiones verificables

**Files:** Create `src/hooks/useBookingDataPolicy.ts`, `src/hooks/useBookingSubjectConsent.ts`, `src/hooks/useStructuredBooking.ts`, `src/components/booking-subject-consent.tsx`, `src/components/structured-booking.tsx`, `tests/structured-booking.test.tsx`, `tests/booking-subject-consent.test.tsx`, `tests/structured-booking-lifecycle.test.tsx`. Modify `src/app/b/[slug]/page.tsx`, `src/components/booking-proposal.tsx` y sus pruebas existentes.

**Interfaces:** `StructuredBooking({business,capability,onConfirmed})`; `useBookingDataPolicy(uid,businessId)` devuelve estado de capacidad listo/error/recarga; `useBookingSubjectConsent(uid,business,case)` devuelve `status,loading,error,accept,revoke,refresh,downloadReceipt`; `useStructuredBooking(uid,business,case,subjectActive)` controla selección, disponibilidad, propuesta y confirmación. Usar siempre `apiFetch(...,expectedUid)`. `onConfirmed(appointment)` refresca Mis citas mediante el contador existente, sin `sendMessage` ni `useDebouncedChat.confirm`.

- [x] **RED:** `minor name field appears only after current case authorization`, `pediatrics requires both explicit choices`, `late availability cannot replace changed service or subject`, `withdrawal stays closed across stale refresh`, `lost confirmation retries original proposal`, `health books while inference is offline`. Asserts: casillas desmarcadas, datos del menor ausentes antes de aceptación; cambiar caso/rol invalida decisiones; no montar/enviar un chat mientras se carga política o se usa flujo restringido.
- [x] **Ejecutar RED:** `pnpm.cmd test tests/structured-booking.test.tsx tests/booking-subject-consent.test.tsx tests/structured-booking-lifecycle.test.tsx tests/booking-proposal.test.tsx`. Expected: FAIL por componentes/controladores ausentes.
- [x] **GREEN:** Elegir «Para mí»/«Para un menor a quien represento» solo si capacidad permite. Generar ID de caso antes del aviso; decisiones verificadas en servidor antes de nombre o selección sensible persistida. Después, selects de catálogo/recurso, fecha, slot autorizado y contacto del adulto; nombre breve/rol solo para menor. Sin campo clínico ni intake arbitrario. Reutilizar resumen con precio/horario y confirmación explícita de diez minutos; no bloquear horario por mostrar propuesta. Controlar alcance UID/negocio/caso, abortar/descartar respuestas atrasadas y mantener latch tras revocación incierta. No almacenar datos del menor en localStorage, URL, mensajes de chat ni nombres de descarga. Renderizar contacto del prestador ante negativa/dudas/fallo.
- [x] **Verificar:** Repetir pruebas. Expected: PASS; historial/cancelación permanecen accesibles sin permisos para nueva operación. Política cargándose/error no habilita IA por defecto. No mostrar «IA disponible» como requisito de una reserva estructurada.
- [x] **Commit:** `feat: add privacy-scoped structured client booking`.

### Task 6: Administración, agenda y exportación

**Files:** Create `src/components/admin-booking-data-policy.tsx`, `src/components/representation-review.tsx`, `tests/admin-booking-data-policy.test.tsx`, `tests/representation-review.test.tsx`. Modify `src/app/admin/page.tsx`, `src/app/dashboard/page.tsx`, `src/app/dashboard/onboarding/page.tsx`, `src/components/client-appointments.tsx`, `tests/client-appointments.test.tsx`, `tests/onboarding-assistance.test.tsx`; ampliar las pruebas existentes de imagen en el archivo que cubra `src/lib/client/appointment-image.ts`.

**Interfaces:** `AdminBookingDataPolicy({businesses})` selecciona negocio y guarda la clasificación versionada de tarea 1; `RepresentationReviewControls({businessId,appointment,onSaved})` aplica tarea 4. Conservar las props/API de Mis citas y del exportador; no añadir beneficiario al contrato `AppointmentImageDetails`.

- [x] **RED:** `policy edits preserve current business on stale response`, `needs contact does not cancel appointment`, `client sees beneficiary only for its own booking`, `private subject marker never reaches image or download name`, `health owner can configure manually without AI`. El marcador sintético aparece solo en vista autenticada de dueño/reservante; ninguna búsqueda por familia o teléfono concede acceso.
- [x] **Ejecutar RED:** `pnpm.cmd test tests/admin-booking-data-policy.test.tsx tests/representation-review.test.tsx tests/client-appointments.test.tsx tests/onboarding-assistance.test.tsx`. Expected: FAIL en controles/etiquetas nuevas.
- [x] **GREEN:** Reutilizar blanco/azul Sarin, DM Sans, cifras tabulares, foco visible y controles de al menos 44 px; no crear identidad visual nueva. Mostrar nombre mínimo del beneficiario y «Gestionada por [reservante]», o etiqueta de registro legado sin inferir titular/edad. Solo dueño puede registrar revisión; no describir `reviewed` como parentesco certificado. Ocultar chat de configuración/copiloto en negocio clasificado salud y mantener formulario manual. La imagen conserva su allowlist de negocio/servicio/recurso/horario; omite nombre del menor, calidad, constancia y contacto privado, sin afirmar que el nombre del servicio de salud deja de ser sensible.
- [x] **Verificar:** Repetir pruebas más la suite existente del exportador. Expected: PASS; controles hasta 320 px sin desbordamiento y sin cambios en marketplace/WhatsApp/paquetes.
- [x] **Commit:** `feat: expose booking classification and representation review`.

### Task 7: Contratos reales D1/Firestore y seguridad de los tres casos

**Files:** Verificar `tests/represented-booking.integration.test.ts` y `tests/firestore.integration.test.ts`, escritos en RED de tarea 3, y `tests/health-booking-flow.test.ts`, escrito en RED de tarea 4. El fixture de tarea 3 solo usa actores sintéticos explícitos; nunca cambiar `memoryFirestore` para simular permisos. Esta tarea es una verificación integrada, sin crear código para forzar un nuevo ciclo RED.

**Interfaces:** Consume tareas 1–6, el helper `acceptSyntheticSubjectConsent` producido en tarea 3 y `createDataTestRuntime`/`createCloudflareDatabase`, dos handles independientes. No introduce otra implementación de autorización en pruebas.

- [x] **Comprobar cobertura escrita antes del dominio:** Cruces de negocio/UID/caso, última cita concurrente, revocación frente a confirmación, respuesta perdida, política cambiada y marcadores privados ausentes de proyección/IA/imagen. Los ledgers de tareas 3–4 deben acreditar RED con las capacidades ausentes; no inventar fallos desactivando protecciones para justificar una nueva prueba. La prueba de imagen pertenece a la allowlist de tarea 6.
- [x] **Verificar contrato real:** Contra el runtime real, confirmar adulto propio general, menor/corte y pediatría. En casos restringidos, proveedor espía recibe cero llamadas y D1 conserva una cita/constancia vinculada, un cupo y ningún consumo IA. Verificar retiro antes de nueva confirmación, recuperación exacta posterior de operación guardada y registros legados intactos. Incluir fila corrupta y mapas de recibos reordenados. Las pruebas de Firestore deben usar las mismas funciones de dominio y nuevas autorizaciones explícitas, sin replicar la implementación en el fixture.
- [x] **Verificar:** `pnpm.cmd test tests/represented-booking.integration.test.ts tests/health-booking-flow.test.ts`; luego `pnpm.cmd run test:rules` con Java 21+, de forma secuencial sin build concurrente. Expected: PASS, emulador de reglas cerrado y cero cambios remotos. No relajar timeouts o aserciones para ocultar conflictos reales.
- [x] **Registrar:** resultados de ambos backends, duración y limpieza en el ledger. No crear un commit vacío; solo un fallo real con corrección justificaría código adicional y su regresión.

### Task 8: Aceptación local y candidata revisable

**Files:** Create `docs/qa/2026-10-16-health-and-represented-booking.md` y capturas sintéticas; actualizar `tasks.md`, revisión legal, operación y manifiesto de release. Mantener logs, backups y reportes HTML en scratch ignorado.

**Interfaces:** Consume los contratos completos y deja una candidata exacta, no una publicación. La revisión independiente final cubre el rango íntegro desde `205a771` con este plan y el diseño aprobado; no sustituirla por revisión del autor. Resolver hallazgos importantes con regresión RED→GREEN y suite final, sin reabrir funciones omitidas ni atribuir consentimiento a usuarios reales.

- [x] **Verificar seguridad y regresión:** `pnpm.cmd test`, `pnpm.cmd run typecheck`, `pnpm.cmd run build`, `pnpm.cmd --filter sarin-cloudflare-host run check`, `node --test pages-gateway/tests/*.test.mjs`, `git diff --check`. Expected: todos con salida 0; informar omitidas por separado. No reconstruir landing si no cambió su fuente/contrato.
- [x] **Verificar navegador:** `pnpm.cmd run dev:local --port 3042`, emuladores oficiales `demo-sarin-bot`, proveedor desconfigurado. Tres casos y vuelta al historial/cancelación, permisos desmarcados/retirada, revisión del dueño y edición manual; móvil 390 × 844 y 320 px sin desbordamiento. Expected: cita única y datos correctos mediante lectura independiente del emulador, ninguna llamada IA, capturas y reporte local. Restablecer viewport y cerrar procesos/puertos de esta sesión.
- [x] **Revisar y empaquetar:** congelar commit, construir desde `git archive` con solo argumentos Firebase públicos y comprobar imagen Linux sin red externa/solo lectura. Expected: etiqueta OCI/revisión/hash coincidentes, Sharp y rutas públicas/privadas correctas; no presentar este smoke como integración remota.
- [x] **Documentar y commit:** registrar resultados reales, riesgos restantes y rollback que conserve revocaciones/bindings/propuestas v2/citas; imagen anterior incompatible permanece bajo mantenimiento. Expected: worktree limpio, `tasks.md` diferencia diseño/implementación/publicación. Preservar los límites de IA aprobados y no activar recursos reales.

## Revisión del plan y pendientes operativos

Se conservan tres casos del diseño aprobado, sin crear historia clínica, cuentas de niños o un sistema general de pacientes. La política privada habilita capacidades nuevas; no se infiere edad/parentesco por una cuenta. La separación de cuenta, negocio y caso evita reinterpretar los recibos ya guardados.

Self-review realizada: cobertura del diseño por tareas 1–8 y de los cinco puntos de Review Focus en sus tareas; nombres/firmas comunes, permiso nullable solo cuando no se requiere, binding/caso y replay v1/v2, lectura antes de escritura y pruebas D1 escritas antes del dominio. Se corrigieron la posibilidad de dos commits separados para autorizar/proponer y una fase de tests artificialmente RED. No hay un bypass de prueba en producto. Antes de usar datos reales siguen siendo necesarios la ficha/acuerdo del negocio, proceso proporcionado de representación, conservación y condiciones de proveedores. La reserva sin IA evita enviar esos datos al modelo; no elimina su tratamiento en Auth/D1 ni convierte este plan en validación jurídica.

El propietario ya eligió ejecución directa: **no volver a preguntar método**. Tras su revisión de este plan, usar `superpowers:executing-plans`. Publicación y cualquier tratamiento real quedan fuera de esta autorización de desarrollo local.

## Cierre de ejecución

Runtime `6315379`; 887 pruebas aprobadas/26 omitidas, Firestore 24/24, Worker 74/74, gateway 25/25, tipos/build e imagen Linux correctos. Revisión independiente y correcciones RED→GREEN registradas en [aceptación](../../qa/2026-10-16-health-and-represented-booking.md). Aceptación visual/lectura independiente sintéticas; pendientes operativos conservados.
