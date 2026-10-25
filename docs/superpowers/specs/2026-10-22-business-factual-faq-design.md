# FAQ factual mínima: información elegida, publicada y versionada

Diseño del 22 de octubre de 2026, preparado por delegación del titular con brainstorming/writing-plans. Fase separada del [incremento inicial de recepción](2026-10-22-business-receptionist-knowledge-design.md), que deliberadamente no contiene editor FAQ. Este diseño y su [plan](../plans/2026-10-22-business-factual-faq.md) no implementan, prueban o publican producto.

## Alcance elegido y alternativas

El dueño puede guardar hasta tres respuestas factuales breves sobre el establecimiento. Un cliente autorizado las consulta eligiendo una pregunta explícita dentro del chat web general. La respuesta procede de una lectura del servidor y se muestra como texto del negocio, sin modelo, búsqueda semántica o interpretación libre. No promete que escribir una pregunta equivalente en el chat active una FAQ.

Primera entrega cerrada: **tres temas fijos**, sin pregunta libre, alias ni orden comercial. Se eligen por utilidad, poco mantenimiento y separación de los contratos existentes:

| ID estable | Pregunta de interfaz | Límite de finalidad |
| --- | --- | --- |
| `parking` | ¿Dónde puedo estacionar? | Acceso logístico; no cambia dirección/modalidad del negocio ni verifica geolocalización. |
| `accessibility` | ¿Qué condiciones de accesibilidad tiene el lugar? | Características físicas declaradas; sin consejo clínico, evaluación de personas o certificación por Sarin. |
| `onsite_payment_methods` | ¿Qué medios de pago aceptan en el establecimiento? | Medios informados para atención presencial; no activa pagos, anticipos, suscripción SaaS o cobros automáticos. |

El negocio solo guarda temas pertinentes. Tema ausente no aparece ni obtiene respuesta inventada. No incluir cancelaciones/depósitos, precios, disponibilidad, instrucciones clínicas, datos de clientes o permisos entre estos temas. El dueño confirma que el texto es factual y apto para clientes antes de guardar; esa revisión no acredita veracidad automática ni detección semántica infalible por Sarin.

Alternativas: elegida, temas fijos y elección por ID; acota precedencia, datos y pruebas. Preguntas libres con coincidencia exacta necesitan reglas de duplicados/core y producen mala comprensión de paráfrasis; se posponen. FAQ por clasificador/RAG amplía contexto, costes y precisión no demostrada; queda fuera. No mostrar editor de alias, entrenamiento, canal futuro o página FAQ vacía anunciada como capacidad terminada.

## Fuente y dependencias

Fuente real leída en solo lectura: `C:/Users/Drean Skate/AppData/Local/SarinBot/whatsapp-adaptation-20261020/source-restoration`, pin `463ae55f8c873468980746185fb3e91f55cb8681`; runtime documentado c8bb0a99d9ac2bb20acaef2e5a157b0ff83b05f2, no comprobado remotamente en esta preparación. E: mixto solo recibe documentación. Reconciliar fuente efectiva y aislar rama antes de implementar.

- `src/app/b/[slug]/page.tsx`: `GeneralBookingChat` es función local del chat opt-in; `BookingJourney` protege salud, representación y recuperación incierta. No inventar ChatPanel/ChatInput separados que no existen.
- `src/app/api/public/businesses/[slug]/route.ts`: lectura anónima exclusiva de publicBusinesses, con allowlist `view=profile`; no ampliar esa respuesta ni buscar FAQs en colección privada desde ese endpoint.
- `src/components/business-public-profile.tsx`: ficha anónima actual muestra servicios/ubicación/horario/contacto; permanece sin FAQ en esta fase.
- `src/lib/server/chat-intent.ts`, `chat.ts`, `chat-replies.ts`, `src/lib/sarin/prompts.ts`: clasificador cerrado, permisos/cuota y renderer; ninguna FAQ entra en esos contratos o prompts.
- `src/lib/server/businesses.ts`: guardado agregado conserva campos conocidos y actualiza proyección pública; no incrustar FAQ ahí ni en customRules.
- `src/lib/server/consent.ts`, `booking-data-policy.ts`, `src/lib/storage/types.ts`, `shared/data-protocol.ts`: patrones de consentimiento, política y transacción disponibles. No crear escritura por SDK ni almacenamiento distinto.

Base UI: [navegación administrativa](2026-10-22-admin-guided-navigation-design.md), [configuración guiada](2026-10-22-owner-guided-configuration-design.md), recepción inicial y [turnos S09](2026-10-22-resource-schedules-and-closures-design.md) integrados/verificados. S09 añade Horarios al shell; esta FAQ no agrega otro destino principal. Backend FAQ es independiente de su algoritmo de disponibilidad. La referencia [Fresha IA](../../qa/2026-10-22-fresha-ai-receptionist-reference.md) orienta separación de información y acciones; estos límites son decisiones de Sarin, no capacidades verificadas de Fresha.

## Restricciones globales

- Node 24 y pnpm 11.23.0; conservar lockfile y no añadir dependencias.
- Fuente efectiva reconciliada y rama aislada; nunca implementar o publicar desde E: mixto.
- Solo información de negocio general sin menores habilitados; salud/representación mantienen recorridos actuales.
- La FAQ no inicia llamadas a motor/health, inferencia, intent nuevo, herramienta, cuota de IA, acción de reserva, cobro o mensaje externo; conserva las llamadas ya existentes del chat.
- No modificar BusinessConfig, Business/publicBusinesses, ChatSelection/ChatResponse, historial del chat o APIs existentes para almacenar FAQ.
- Texto literal escapado por React; sin HTML/Markdown/enlaces automáticos, ejecución, secretos o datos de clientes.
- Dueño vigente para editar; cuenta/negocio/consentimientos vigentes para consulta del cliente; sin roles laborales inventados.
- Identidad/tokens Sarin, guía por tarea, ayuda plegable, revisión explícita y controles de44px.

## Modelo y publicación

Crear `src/lib/business-factual-faq.ts`, compartido y puro. Temas enumerados en orden fijo parking/accessibility/onsite_payment_methods; sus preguntas se generan desde el catálogo de UI, no se aceptan del propietario ni del cliente. Cada respuesta normaliza NFC, CRLF/CR a LF y trim;1–400 caracteres, máximo tres saltos de línea, rechazando controles salvo LF. Rechazar duplicados de tema, campos desconocidos y IDs fuera del enum. No convertir texto vacío en publicación; omitir un tema en el reemplazo completo lo retira.

```ts
type FactualFaqTopic = 'parking' | 'accessibility' | 'onsite_payment_methods';
type FactualFaqItem = { topic: FactualFaqTopic; answer: string };
type FactualFaqState = { version:1; businessId:string; revision:number; items:FactualFaqItem[]; updatedAt:number|null };
type FactualFaqCommand = { requestId:string; expectedRevision:number; expectedPolicyRevision:number; items:FactualFaqItem[] };
type FactualFaqApplied = { requestId:string; commandFingerprint:string; revision:number; savedAt:number };
type OwnerFactualFaqView = { state:FactualFaqState; policyRevision:number; eligible:boolean; applied:FactualFaqApplied|null };
type ClientFactualFaqTopics = { businessId:string; revision:number; topics:{topic:FactualFaqTopic;question:string}[] };
type ClientFactualFaqAnswer = { businessId:string; revision:number; topic:FactualFaqTopic; question:string; answer:string; source:'business' };
```

Estado privado singleton `businesses/{businessId}/factualFaq/current`; ausencia real es versión1/revisión0/items[]/updatedAt null. Registro presente inválido o error de lectura falla503 `FACTUAL_FAQ_UNAVAILABLE`; no convertirlo en FAQ vacía. Revisiones presentes positivas y seguras; expectedRevision/expectedPolicyRevision0..MAX_SAFE_INTEGER-2; antes de incrementar validar capacidad, sin overflow. Guardar el reemplazo de0–3 respuestas es **ponerlas a disposición de los clientes de este recorrido**. No existe un segundo Publicar, Guardar borrador remoto o fecha de publicación programada.

Recibos privados `businesses/{id}/factualFaqOperations/{stableDocumentId('factual-faq',businessId,owner.uid,requestId)}`: versión1, businessId, actorUid, requestId, commandFingerprint, applied. El hash usa el comando normalizado mediante `factualFaqCommandCanonicalString`, con campos en orden requestId/expectedRevision/expectedPolicyRevision/items y temas en orden fijo. SHA256 vive en Node para servidor y Web Crypto para verificación del comando pendiente en navegador; no enviar actor/texto a un servicio externo. La prueba incluye esa huella para no confundir un recibo antiguo con otro payload que reutilizó el ID. No duplica textos, clientes o Business completo. Recibo aplicado inmutable por el dominio; state puede cambiar por comandos posteriores. No hay historial de versiones de respuesta ni deshacer remoto en este incremento. El recibo prueba que una revisión se guardó, no conserva el contenido antiguo.

## Autoridad, CAS y guardado

Nueva ruta dueña `GET/PUT /api/businesses/[id]/factual-faq-settings`, Node/force-dynamic/no-store en éxito y error. RequireUser + assertOwner; superadmin/recurso no equivalen a dueño. GET permite solo requestId opcional único validado; no exige plan/consentimiento para leer estado propio. Si se pide recibo, comprobar actor/negocio y devolver applied más estado actual; no encontrar recibo no prueba que un PUT en vuelo haya fallado.

PUT máximo8192bytes y cuerpo strict. Requiere dueño vigente, negocio configurado, consentimiento de cuenta, `isSubscriptionAllowed` y política actual general sin menores. No exigir al dueño consentimiento de cliente. Política ausente válida revisión0 mantiene general actual; error/corrupción nunca habilita edición. Una política incompatible deja leer respuestas propias pero no añadir/modificarlas mediante este primer flujo; el cliente ya no las recibe.

En una sola transacción: leer negocio, estado, política y recibo; verificar dueño/actor/ámbito. Recibo idéntico devuelve prueba original y state actual sin escribir ni exigir plan nuevo. RequestId distinto de contenido ⇒409 `FACTUAL_FAQ_REQUEST_REUSED`. Para comando nuevo exigir expectedRevision y expectedPolicyRevision vigentes, elegibilidad y consentimiento; cambios ⇒409 `FACTUAL_FAQ_CHANGED`. Leer todo antes de writes; state revisión+1 y recibo se confirman juntos. No tocar Business, public projection, horarios, cuotas, consentimiento, chat o citas. Reintentar conserva comando/requestId; D1 utiliza su journal actual.

El editor ofrece3 preguntas con explicación breve y respuesta opcional. **Revisar respuestas** presenta solo añadidas/cambiadas/retiradas, texto que será visible y confirmación local «He revisado que son datos del establecimiento y no incluyen información de clientes». Esa confirmación no se guarda como autorización de tratamiento. Acción final **Guardar respuestas**. Campo vacío no publicado y cero respuestas es estado honesto, sin inventar contenido inicial. Texto visible: «Estas respuestas se consultan al elegir la pregunta. No cambian tus servicios, precios, horarios o reglas de reserva».

## Consulta por elección y precedencia

Nuevas rutas cliente, ambas GET/no-store, requireUser, consentimiento account/business_client y lectura transaccional de negocio/política/FAQ. No se usa el endpoint anónimo ni se expone estado/actor/recibos privados. Negocio configurado/slug válido y política general sin menores; no aceptar un UID/beneficiario del navegador. Un cliente consulta los hechos publicados del negocio elegido: no obtiene clientes o citas ajenas. Una lectura factual no consume cuota ni motor; puede seguir disponible cuando IA/plan estén en pausa, como información del establecimiento. No habilita reservar, saltarse bloqueo o reactivar suscripción.

| Ruta | Consulta / resultado |
| --- | --- |
| `/api/businesses/[id]/factual-faq` | Sin query. `{ businessId,revision,topics }`; solo preguntas de temas guardados. |
| `/api/businesses/[id]/factual-faq/[topic]` | Único query `revision`, entero decimal canónico0..MAX_SAFE_INTEGER-1. Devuelve `ClientFactualFaqAnswer` solo si revisión coincide y tema sigue publicado. |

Elegir un tema lee la respuesta de nuevo; no responde desde una copia de la lista. Revisión cambiada o tema retirado ⇒409 `FACTUAL_FAQ_CHANGED`; limpiar respuesta anterior, recargar lista y pedir elección nueva, sin cambiar silenciosamente de tema. Tema desconocido/campo extra ⇒400. Política incompatible ⇒409 `FACTUAL_FAQ_UNSUPPORTED`; consentimiento428 y autenticación401/403 preservan sus códigos. No exponer por error el registro privado. Una nueva elección observa la última lectura autorizada; no se promete actualización en vivo después de ella.

Precedencia estructural:

1. Los datos existentes de servicios/precio/duración/ubicación/contacto/horarios siguen sus rutas/renderers. La FAQ no define esos temas ni reemplaza su respuesta.
2. Solo un ID de uno de los tres temas, elegido explícitamente en el panel, entrega su texto publicado. La pregunta escrita en el chat no se traduce a ese ID en esta fase.
3. Políticas, disponibilidad y confirmación siguen servidor/propuestas existentes. Un texto como ignora las reglas, confirma una cita o cambia el precio permanece texto; no crea acción o permiso.
4. Ausente, cambiada, restringida o fallida no se convierte en respuesta generada, customRules o coincidencia aproximada. Mostrar aviso y contacto actual del negocio mediante componente existente.

La etiqueta cliente es **Respuesta publicada por el negocio**. No presentarla como comprobación independiente de Sarin ni crear un mensaje de asistente persistido. Si el dueño escribe contenido incorrecto, el sistema no garantiza detectarlo semánticamente; límites de tema y revisión reducen superficie, y retirar una respuesta entra por un nuevo comando CAS. No añadir moderación/LLM oculto para intentar garantizar verdad.

## UI y composición sin aglomerar

Ruta dueña `/dashboard/faq` con AuthGate/AppShell: título **Información para tus clientes**, breve alcance, preguntas y revisión. Entrada secundaria desde el notice de recepción dentro de Cómo responde Sarin, no otro enlace principal de menú. Extender `BusinessAssistantScopeNotice` con `faqHref?: '/dashboard/faq'`; componerlo solo cuando negocio configurado/política elegible y el incremento esté integrado. Abrir esa gestión en otra pestaña por enlace explícito, anunciándolo, para conservar el borrador de configuración de la pestaña original. No incluir textos FAQ en assistantScope, propuesta IA o payload agregado.

Reutilizar contrato AppShell introducido por S09: `businessNavigationPath?: '/dashboard'|'/dashboard/onboarding'|'/dashboard/qr-kit'|'/dashboard/billing'`; solo resuelve activo/contexto en shell dueño, ignorado en admin. FAQ pasa `/dashboard/onboarding` para marcar Mi negocio; no crea otro destino, ruta de backend o rol. Mantener cuatro destinos principales; Horarios/FAQ/Equipo/Recordatorios son secundarios desde Mi negocio, no enlaces principales adicionales.

Editor con GET fresco al entrar; draft solo memoria. Actualización externa mientras dirty no sobrescribe: muestra revisión actual y obliga a revisar antes de otro PUT. Enviar sella comando/requestId. Tras20s solo aviso, sin abortar PUT por cronómetro. Error ambiguo mantiene draft/comando y barrera contra segundo guardado; consultar mismo recibo o reintentar cuerpo idéntico. Recibo ausente mientras pendiente no libera barrera. Prueba aplicada distinta del state actual se explica como cambio guardado seguido de otro; cargar actual antes de editar de nuevo. Salir/recargar no demuestra que un PUT falló y no se recomienda como atajo de recuperación.

`BusinessFactualFaqPanel` se monta dentro de `GeneralBookingChat`, fuera de transcript/aria-live del chat, como un `details` cerrado **Información del negocio**. Al abrir consulta temas; lista de hasta3 botones de44px. Al elegir, carga una respuesta; nueva elección borra la anterior durante carga. Error y Actualizar viven allí; ningún spinner de FAQ bloquea confirmar una cita pendiente. No envía chat.sendMessage, no modifica input/history/selection ni dispara motor. El chat ya monta useEngineHealth y sus sondeos actuales se conservan: cero llamadas adicionales atribuibles a FAQ no significa cero llamadas globales de esa pantalla. Conserva el FAQ separado del mensaje escrito para no atribuirle comprensión libre.

GeneralBookingChat recibe `faqEnabled` desde BookingJourney calculado con política **actual** ready/general/sin menores, adulto para sí y consentimientos; no derivarlo del keepChat usado para recuperar una confirmación. Si cambia a salud/menores o se revoca permiso, el panel se oculta y borra datos inmediatamente aunque el chat antiguo siga montado para recuperación. Hooks llevan scope UID/época/negocio y expectedUid/predicado actual; cambios reales purgan/abortan y descartan tarde. API revalida política/consentimiento siempre. No montar panel en calendario, perfil anónimo, representación, WhatsApp o onboarding.

Lecturas FAQ plazo10s con cleanup/controller/generación, sin polling continuo. Volver a abrir o elegir hace lectura fresca; un texto ya mostrado no se actualiza automáticamente. No persistir respuestas/drafts en URL, localStorage/sessionStorage o logs. Texto plain/whitespace-pre-wrap; sin dangerouslySetInnerHTML, Markdown, linkification, copiar datos al proveedor o ejecutar indicaciones. Móvil320/390 y zoom200%, foco visible/labels/avisos polite puntuales; no robar foco del chat por actualizar preguntas.

## Datos, despliegue y fuera de alcance

Añadir `factualFaq` y `factualFaqOperations` a hijos permitidos de businesses; solo accesos por documento, sin índice/migración SQL o cambio de reglas SDK. Ambos permanecen privados al navegador; API entrega allowlist mínima a cliente. Actor/fingerprint no llegan a citas, proyección pública, cliente, chat o IA. Backups/reconciliación incluyen estado y recibos; no purgar recibos por TTL ni importar contenido desde contactos/mensajes.

Worker compatible antes de app que escribe hijos; Worker antiguo falla cerrado sin guardar state a medias. Rollback de app conserva FAQ/recibos y lector compatible con políticas S09; no volver a una base que ignore horarios guardados. No borrar respuestas o alterar cuota para revertir UI. Esta fase no ejecuta publicación o activación.

Fuera: preguntas/alias libres, importación masiva, FAQ anónima, multisedes, búsqueda semántica, recuperación de texto histórico, revisión por empleados, respuestas externas, señales clínicas, política de cancelación/cargos, capacidad para acciones y comprensión de lenguaje natural. Un alcance posterior necesita contrato propio de precedencia, selección, origen/versiones y permisos antes de aparecer en pantalla.

## Aceptación y revisión

F01 solo dueño edita ámbito propio; F023 temas y límites estrictos; F03guardar/CAS/recibo y replay posterior; F04consulta explícita por tema/revisión con respuesta fresca y cambio409; F05texto sin autoridad/prompt/acción/cuota; F06salud/menores/permiso/scope cierran incluso keepChat; F07editor independiente no pierde/guarda borrador agregado; F08privacidad, almacenamiento real, backup y rollback. El plan asigna casos concretos; ninguno se afirma ejecutado en esta preparación.
