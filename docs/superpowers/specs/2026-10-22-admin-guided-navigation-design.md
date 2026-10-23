# Navegación administrativa guiada por módulos

Fecha: 22 de octubre de 2026, Colombia. Diseño preparado por delegación explícita del titular para dejar lista la implementación; no se modifica ni despliega producto. [Plan técnico](../plans/2026-10-22-admin-guided-navigation.md). Referencia de experiencia: [Navegación y guía administrativa de Sarin](../../design/2026-10-22-sarin-admin-navigation-and-guidance.md).

## Propósito y alcance elegido

El dueño debe encontrar sus cuatro tareas habituales y el superadministrador debe operar una tarea de plataforma a la vez, con contexto claro, sin recorrer todos los formularios. Adaptar jerarquía, guía y divulgación progresiva de Fresha conservando marca, lenguaje y contratos propios de Sarin.

Primer incremento: **shell accesible por rol y consola/atención de plataforma por módulos**. Mantener las rutas reales del dueño; no rediseñar su formulario de configuración en este incremento. El alta/edición guiada es otro trabajo, con estado agregado, validación entre secciones, borradores y logo independientes: incorporarlo aquí impediría una revisión proporcionada. La decisión de separación está cerrada; no es una parte pendiente de este plan. La [agenda visual](2026-10-22-owner-agenda-design.md) conserva su diseño propio; este incremento solo organiza navegación y no cambia su lectura/acciones.

Fuente comprobada en solo lectura: `C:/Users/Drean Skate/AppData/Local/SarinBot/whatsapp-adaptation-20261020/source-restoration`, HEAD limpio `463ae55f8c873468980746185fb3e91f55cb8681`. Runtime documentado `c8bb0a99d9ac2bb20acaef2e5a157b0ff83b05f2`; diferencia posterior documental. Las rutas de código siguientes son relativas a esa fuente. Antes de ejecutar: verificar versión efectiva, reconciliar cualquier entrega posterior y crear aislamiento; E: es un checkout mixto de entrega documental, nunca base de implementación/publicación.

## Restricciones globales

- Node 24 y pnpm 11.23.0; sin nuevas dependencias, APIs, migraciones ni cambios de lockfile.
- Conservar marca, fuentes, tokens Sarin, `AuthGate`, consentimiento y autorizaciones del servidor.
- Conservar operaciones y contratos actuales de pagos, invitaciones, clasificación salud/menores y handoff.
- No iniciar inferencia, envío, pago, activación, guardado o publicación por abrir/navegar un módulo.
- No persistir borradores, contactos, conversaciones o datos privados en URL, localStorage o sessionStorage.
- Las rutas del dueño y el contrato agregado de configuración permanecen sin cambios.
- No implementar desde el checkout mixto `E:/Proyectos/Sarin Bot` ni sobrescribir el worktree recuperado.

## Base real y enfoques

`src/components/app-shell.tsx:12–23` contiene cuatro enlaces de dueño y tres de administración; el enlace para pasar del dueño a administración hoy está solo en el pie de escritorio. `src/app/admin/page.tsx:269–275` monta todos los editores; `src/app/admin/assistant/page.tsx:30–36` monta copiloto, confirmación, WhatsApp y soporte juntos. El copiloto entrega negocios/pagos a sus hermanos mediante callbacks (`src/components/admin-copilot.tsx:20,47–49`); desmontarlo rompe esa alimentación.

1. **Elegido: módulos de presentación con subárboles estables.** Enlaces serializan la tarea y se muestra una sección cada vez, pero los componentes ya montados conservan su instancia mientras se permanece en esa página. Preserva borradores/busy/confirmaciones inciertas sin extender APIs especializadas.
2. Montar/desmontar cada módulo al entrar reduce lecturas, pero elimina estado interno no exportado y exigiría extraer snapshots y borradores. Queda fuera hasta diseñar ese ciclo de vida completo.
3. Nuevas rutas, un store global y un bloqueo universal de navegación amplían demasiado el cambio. Tampoco se simula ese bloqueo leyendo clases CSS o el DOM de componentes hijos.

La ocultación no es autorización ni ahorro de red: los pollers actuales pueden seguir leyendo con la página visible. No prometer menor consumo, pausas por módulo o que todas las operaciones anuncian busy al padre. La salida a otra ruta mantiene el ciclo de vida existente; este incremento no garantiza recuperación de borradores ordinarios tras recargar/salir.

## Shell y acceso por rol

Dueño mantiene **Mi agenda**, **Mi negocio**, **Enlace y QR**, **Suscripción** con sus URLs actuales. El superadministrador tiene acceso explícito **Administración de Sarin** también en móvil; dentro de plataforma, **Volver a mi negocio** enlaza `/dashboard` y nunca suplanta al dueño de otro negocio. El rol y la sesión no cambian al seleccionar un negocio dentro de un editor.

Escritorio conserva lateral de 236 px. Móvil sustituye enlaces horizontales desplazables por botón **Menú**, `aria-expanded`/`aria-controls` y lista desplegada en flujo, sin modal ni biblioteca. Se cierra al navegar; Escape lo cierra y devuelve foco al botón. No añadir un focus trap. Marca, avatar, cerrar sesión y salto al contenido permanecen. Contexto **Administración de Sarin** / **Mi negocio** siempre legible, sin depender del breadcrumb oculto en tamaños pequeños.

El menú administrativo tiene seis destinos: Resumen, Negocios, Pagos y acceso, IA y canales, Asistente y atención, Facturación de Sarin. El activo se deriva de la selección validada y no solo del pathname. Un usuario sin rol no recibe enlaces administrativos; `AuthGate admin` y APIs continúan siendo la barrera real. El shell del dueño ignora parámetros de módulos administrativos.

## Módulos y URL

Parámetros nuevos de interfaz: `module` y `section` en `/admin`; solo `section` en `/admin/assistant`. No se envían a APIs. Omisión abre la selección default. Enlaces de módulo/subsección son enlaces semánticos con `aria-current`, no tabs ARIA incompletos. Cambios intencionales usan `router.push(href, { scroll: false })`, conservan Atrás/Adelante y no escriben historial por editar campos. Ninguna selección de URL prepara o confirma una mutación.

| Ruta y selección | Contenido visible | Estado preservado |
| --- | --- | --- |
| `/admin` / `module=summary&section=overview` | Resumen de registros consultados, pendientes y accesos; motor/cola en Estado técnico plegado. | Snapshot actual, sus límites y errores; no cifras globales inventadas. |
| `module=businesses&section=list` | Tabla de negocios/suscripciones existente. | Anclas `business-ID`; no entrar como ese dueño. |
| `module=businesses&section=booking-policy` | `AdminBookingDataPolicy`. | Clasificación salud/menores y contratos existentes. |
| `module=access&section=receipts` | Comprobantes actuales y sus acciones existentes. | Imagen bajo acción explícita, motivos, resultados y `working`. |
| `module=access&section=invitations` | `AdminInvitations`. | Crear/revocar/suspender, motivos e identidad de operación actuales. |
| `module=intelligence&section=provider` | `AdminAiSettings`. | Selección solo se aplica al guardar. |
| `module=intelligence&section=business-budget` | `AdminAiBudget`. | Límite de IA comercial por negocio, separado del presupuesto de plataforma. |
| `module=intelligence&section=platform-budget` | `AdminPlatformBudget`. | Presupuesto del bot de plataforma, gasto/reservas y CAS actuales. |
| `module=intelligence&section=usage` | `AdminAiUsage`. | Datos consultados y cobertura real, sin métricas nuevas. |
| `module=intelligence&section=business-whatsapp` | `AdminWhatsApp`. | Configuración de WhatsApp de negocios; no confundir con canal de plataforma. |
| `module=billing&section=settings` | Formulario actual de facturación de Sarin. | Guardado agregado actual de settings; no cobros del establecimiento. |
| `/admin/assistant?section=query` | `AdminCopilot`. | Pregunta, resultado y snapshot que alimenta hermanos. |
| `section=payments` | `AdminPaymentConfirmation`. | Propuesta, reautenticación, caducidad y recuperación de resultado incierto. |
| `section=platform-whatsapp` | `AdminPlatformWhatsApp` y `PlatformWhatsAppLink`. | Conversaciones/control/vínculo del ámbito Sarin. |
| `section=business-whatsapp` | `AdminWhatsAppConversations`. | Ámbito negocio y negocios recibidos del copiloto. |
| `section=web-support` | `AdminPlatformSupport`. | Apertura/cierre explícitos y thread actual; cerrar soporte conserva su semántica de borrar esta vista. |

Defaults de módulo: summary/overview, businesses/list, access/receipts, intelligence/provider, billing/settings y assistant/query. Una sección incompatible, parámetros duplicados o valores desconocidos vuelven a Resumen en `/admin`, o Consulta en `/admin/assistant`, con **«No pudimos abrir esa sección. Elige una tarea del menú»**. No ejecutar ni preparar acciones al resolver parámetros. Otros querystrings ajenos al navegador de módulos se ignoran en esta lógica y jamás pasan a `/api/admin`.

Cada sección tiene título, una frase de finalidad y el resultado de carga/acción de su componente. Una ayuda `details` cerrada explica lo avanzado; sin tour obligatorio, panel gigante o editor paralelo. Una franja breve identifica el ámbito al editar presupuestos/canales. Mantener importes/etiquetas/advertencias de los formularios; no traducir Guardar como Activar o Publicar.

## Enlaces existentes, datos y foco

Conservar generadores de enlaces y valores existentes; no modificar `platformAdminSourceUrl` ni URLs firmadas/protegidas. El resolver abre la sección antes de enfocar:

- `/admin?focusPayment=ID#payment-ID` → access/receipts. Validar ID con `[A-Za-z0-9_-]{1,128}` y consultar `/api/admin?focusPayment=ID`, incluso fuera de las primeras 500 filas. `#payment-ID` sin query puede derivar ese mismo focusPayment para recuperar el registro. Query/hash contradictorios son enlace inválido, sin lectura dirigida.
- `/admin#business-ID` → businesses/list; si el registro no está en el snapshot actual, indicar **«El registro enlazado no está entre los datos consultados»**, sin prometer cobertura completa ni API inexistente de focusBusiness.
- `/admin/assistant?paymentAction=UUID` → payments; admite UUID conforme al componente actual (versiones 1–8, variante válida, minúsculas). Pasar solo el ID validado a `proposalId`; abrir permite lectura, nunca confirmación. Caducidad/reauth/uncertain siguen dentro del componente.
- `/admin/assistant?support=UUID` → web-support, usando UUID v4 conforme al filtro de `AdminPlatformSupport`; no convertir un ID arbitrario en hilo válido. `#soporte-web` sin thread abre la sección, pero no obliga a abrir el chat cerrado ni crear una consulta.
- Más de un destino de registro, duplicados, ID vacío/malformado o conflicto entre destino y ancla vuelve al default con aviso. Un destino válido manda sobre `module/section` meramente visuales; un module desconocido sigue inválido aunque haya destino. Ningún valor privado no validado se refleja como HTML.

Al elegir deliberadamente otra sección, eliminar de la nueva URL `focusPayment`, `paymentAction`, `support` y ancla de destino antiguos; no dejar que el enlace previo arrastre al usuario al módulo anterior. Las URLs de módulo propias contienen solo `module/section`; al entrar por enlaces externos conservar su forma, sin redirección automática ni reescritura en bucle.

Excepción deliberada para estado sensible en `/admin/assistant`: `proposalId` e `initialThread` se fijan con la URL de entrada del workspace. Quitarlos de la URL al cambiar sección no cambia esas props ni borra el estado del hijo. Una navegación posterior hacia un enlace de propuesta/hilo, incluida Atrás/Adelante, selecciona la sección pero **no sustituye automáticamente la revisión/conversación actual**: mostrar «Se conserva la tarea que tienes abierta. Abre este enlace en otra pestaña para revisar el destino sin descartarla», con enlace explícito a la URL validada y `target="_blank" rel="noopener noreferrer"`. Enfocar ese aviso, no el registro anterior. Esto protege tupla incierta, busy y borrador sin inventar callbacks de busy global. La nueva pestaña inicia su propio workspace y resuelve el destino normal. No abrir pestañas automáticamente; no convertir un cambio de URL en otra preparación/confirmación. La consola `/admin` sí puede cambiar su lectura dirigida porque conserva estado de formulario separado del snapshot.

Usar `usePathname`/`useSearchParams` dentro de un límite `Suspense` de las páginas administrativas y escuchar `hashchange`. Antes de conocer el hash inicial del navegador, mostrar una carga neutra sin montar el workspace privado: evita resolver una lectura dirigida con solo media URL. Usar enlaces Next para navegación intencional y sus hooks para Back/Forward; no parchear history ni importar router en el modelo puro. Ningún Suspense nuevo envuelve formularios del dueño. Si el tipo de pathname cambia entre consola y assistant, se aplica el ciclo de vida de ruta existente; no se guarda contenido privado en el controlador URL.

El encabezado de módulo tiene ID estable y `tabIndex={-1}`; enfocarlo al cambiar tarea. Para destinos de registro, esperar datos y panel visible, después focus/scroll una vez por cambio real de destino. Un refresco/polling no vuelve a robar foco. Con registro ausente/error, enfocar el aviso y ofrecer **Ir al resumen**. El salto genérico `#soporte-web` enfoca el encabezado del contenedor, no envía mensajes.

`adminReadPath` se reemplaza por un constructor que acepta solo `focusPayment` validado. Cambiar módulo no recarga ni resetea el snapshot de consola; cambiar el pago dirigido sí actualiza su lectura con AbortController/UID/generación y descarta respuestas tardías. Settings se inicializa una vez por ámbito de autoridad, no cada vez que llega una lectura dirigida: preservar ediciones locales como hace refresh actualmente. No añadir supuesto CAS de settings; el riesgo de ediciones concurrentes existe y se conserva como límite.

## Ciclo de vida, busy y protección de borradores

Todos los paneles que hoy están montados en cada página permanecen en posiciones estables, envueltos con `hidden` e `inert` cuando no están activos. No `key` por módulo, no mover físicamente un componente a una rama condicional ni duplicarlo en dos secciones. Hidden retira controles/anuncios del árbol accesible; inert bloquea foco/interacción de descendientes. Comprobar que ninguna clase anula la ocultación. El copiloto de `/admin/assistant` sigue montado aunque no sea visible para alimentar `businesses/payments`. Sus lecturas no cuentan como inferencia; una pregunta solo se envía mediante submit explícito.

En la fuente revisada no se encontraron portales, `<dialog>` ni autoFocus en los componentes administrativos/de plataforma, pero sí foco imperativo de revisión de pago (`admin-payment-confirmation.tsx:115`) y soporte (`platform-support-chat.tsx:256–258`). La aceptación debe comprobar en navegador que esos resultados tardíos no sacan foco ni anuncian contenido del panel oculto. Un popup de Google ya iniciado es externo: no se promete cerrarlo al cambiar sección; su finalización revalida identidad y solo relee la propuesta (`admin-payment-confirmation.tsx:147–156`), sin confirmación automática. Si la base reconciliada añade portales fuera del contenedor, no basta hidden/inert: resolver su ciclo de vida antes de aprobar el cambio, sin declarar protegido un diálogo externo al panel.

Cambiar sección en la misma página no resetea pregunta, motivos, borradores o estado incierto. **No congela globalmente navegación:** los componentes especializados tienen busy interno sin callback común. Sus bloqueos locales y validaciones permanecen; al regresar muestran resultado/estado vigente, incluido busy o «Reintentar la misma confirmación», sin auto-submit, nueva propuesta ni cambio de requestId. Una operación explícitamente iniciada puede completar mientras su panel está oculto; no se inicia otra por volver. No añadir `onBusy` a todos los formularios ni afirmar que ocultarlos cancela una mutación ya iniciada. En la consola, `working` sigue bloqueando las acciones que bloqueaba; no se reutiliza como supuesto estado de todos sus hijos. La navegación no corrige el menor ya documentado del presupuesto de plataforma: una revisión nueva del polling puede sustituir su borrador local; no prometer preservación frente a esa actualización externa.

Navegar a otra ruta, recargar o cerrar sesión puede terminar la vista como hoy; el plan no promete recuperar borradores ordinarios ni añade confirmación global de salida. La propuesta de pago enlazable conserva su recuperación existente; no reconstruir una confirmación nueva a partir de un resultado incierto. Cerrar explícitamente soporte sigue desmontando su chat conforme al contrato actual.

Ámbito de autoridad: envolver Console y AssistantWorkspace con key `[uid, authEpoch, isSuperadmin, signingOut]`, siguiendo el patrón existente de la segunda página. Ocultar/desmontar inmediatamente si ya no hay superadministrador. En lecturas dirigidas de consola usar `expectedUid` y predicado de generación; no mostrar respuesta de otra sesión. No ampliar esto a una reescritura general de auth. Los componentes hijos conservan sus mecanismos de revocación, cifrado, expiración y permisos; esconder un módulo no concede acceso.

## Alta/edición del dueño: frontera explícita para el siguiente incremento

No se modifica `src/app/dashboard/onboarding/page.tsx` ni `BusinessLogoField` en este plan. La futura guía separará alta en Tu negocio → Tu agenda → Revisión y guardado; editará una sección visible con borrador agregado y un solo Guardar configuración. No implementar ahora pestañas vacías que aparenten ese trabajo terminado.

Hechos que su diseño separado debe conservar: `onboarding/page.tsx:195–199` evita sobrescribir edición local con polling; `:232–260` envía configuración completa; `src/lib/server/businesses.ts:94–112` completa onboarding y actualiza proyección pública. No existen SaveDraft/Publish independientes. Logo guarda por ruta propia y conflicto de hash (`src/components/business-logo-field.tsx:37–65`), sin busy exportado: no afirmar que Cancelar configuración revierte un logo guardado ni congelar ambos mediante un estado inexistente. Clasificación lista/salud/menores y consentimiento gobiernan campos/asistente (`onboarding/page.tsx:145–147,224–226,307`). La reorganización de shell no altera nada de ello.

## Accesibilidad, errores y aceptación

Controles de al menos 44 px, navegación con nombre/activo/retorno, foco visible, textos que envuelven y sin scroll horizontal de página a 320/390 px. Menú en flujo no tapa formulario ni teclado. `hidden` no deja acciones tabulables; al navegar desde el menú el foco va a título/registro y el menú se cierra. Probar teclado, Escape, zoom 200 % y movimiento reducido. No usar estilos de Fresha ni nuevas librerías.

Carga no se presenta como cero; error no como vacío; resúmenes conservan términos «registros consultados» sin fingir totales. La API de consola tiene límites existentes y no certifica cobertura completa. Las respuestas del copiloto no aprueban pagos; una URL de propuesta no los confirma; abrir IA y canales no activa proveedor o envío.

Aceptación: dueño conserva sus cuatro destinos; contexto administrativo accesible en móvil solo al rol; una sola sección visible; todos los módulos mantienen acciones y estados existentes; enlaces viejos abren/focalizan su contexto sin pérdida por ocultación; Back/Forward no escribe ni descarta estados por remount; pérdida de rol borra vistas privadas. No se declara resuelto el flujo guiado del dueño, ahorro de lecturas, conflicto de settings o pérdida de borradores tras salir de la ruta.

## Autorrevisión

Se separó alta/edición para mantener un incremento revisable. Se resolvieron dependencia de snapshot del copiloto, busy local, instancias ocultas estables, foco bajo polling, hash inicial, enlaces contradictorios y settings sin CAS. No se promete Publish, borrador durable, nuevo rol laboral o activación por navegación. La implementación futura necesita QA de interacción; la lectura actual no prueba usabilidad ni publicación.
