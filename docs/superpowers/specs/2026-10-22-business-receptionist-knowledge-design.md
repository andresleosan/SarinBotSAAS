# Recepción empresarial inicial: información vigente y alcance

Nota de ejecución del 23 de octubre de 2026: el titular indicó continuar con P4 tras publicar P3. Se ejecuta este diseño delegado desde la fuente aislada limpia y main 8daa77e5582302e6fab3d812ba9447e4308566ee, verificada por CI #42 y runtime. Las restricciones documentales del 22 de octubre describen aquel encargo histórico. Next vigente 16.4.1 y lockfile conservado. Los resultados se registran en [la evidencia de ejecución](../../qa/2026-10-23-business-receptionist-knowledge.md).


Diseño documental del 22 de octubre de 2026. El titular delegó las decisiones para preparar un primer incremento viable; este encargo produce diseño y plan, sin implementar, ejecutar pruebas, instalar, contratar, desplegar o hacer commits. Se aplicaron brainstorming y writing-plans con el alcance documental expresamente delegado.

**Decisión:** conectar correctamente información empresarial ya guardada con las respuestas deterministas del chat comercial y explicar al dueño qué datos y acciones usa Sarin. Corregir ubicación/modalidad, responder detalles de un servicio desde su descripción/categoría publicadas y mantener el catálogo, precio, contacto, horario y confirmación existentes. **El editor de preguntas frecuentes libres se separa de esta entrega.** No convertir `customRules` en una base FAQ oculta ni en autoridad para ejecutar acciones.

Leer también el [plan de implementación](../plans/2026-10-22-business-receptionist-knowledge.md), el inventario histórico `docs/qa/2026-10-22-sarin-effective-admin-inventory.md` del handoff documental, la referencia histórica `docs/qa/2026-10-22-fresha-ai-receptionist-reference.md` del handoff documental y el [diseño de navegación y guía](../../design/2026-10-22-sarin-admin-navigation-and-guidance.md). La referencia Fresha orienta claridad y separación de configuración/acciones; no prueba capacidades de Sarin.

## Intención, alternativas y alcance elegido

El dueño debe reconocer la información que Sarin utiliza; el cliente debe obtener datos verificables de ese negocio sin recibir una respuesta inventada. Una pregunta informativa no debe crear, cancelar o mover citas. Este incremento sirve al chat web existente de negocios generales, sin añadir canales, una bandeja del dueño o un agente libre.

| Alternativa | Coste y decisión |
| --- | --- |
| Reparar ubicación y reutilizar información estructurada, con guía de alcance | **Elegida.** Hay contrato, persistencia, proyección y pruebas para los datos. Añade valor inmediato sin inventar entidades, permisos o recuperación nuevos. |
| Añadir FAQ editable y selección determinista por pregunta exacta/ID | Pospuesta como incremento independiente: necesita decidir entidad, edición, publicación, identificación de pregunta, precedencia y recuperación. El `ChatSelection` actual solo contiene selección de reserva; introducir FAQ allí mezclaría conceptos. |
| Generar respuestas libres desde indicaciones, FAQ o todo el negocio | Descartada para esta recepción inicial. Sustituiría el contrato cerrado actual, aumentaría información enviada al proveedor y haría menos verificable respuesta y autoridad. |

Separar el editor FAQ es una decisión de alcance, no una dependencia pendiente que bloquee este plan. En esta entrega no aparece un apartado FAQ vacío ni un botón próximo a habilitarse. Las preguntas habituales cubiertas son las que corresponden a campos existentes: servicios, precio/duración, descripción de un servicio, horario, contacto y ubicación/modalidad. Una política de depósitos, aparcamiento o devoluciones no se responde como hecho si carece de un campo/contrato autorizado. No se deduce de un texto de indicaciones una política de cobro o una garantía de disponibilidad.

## Fuente y auditoría de contratos

Fuente de lectura: `C:/Users/Drean Skate/AppData/Local/SarinBot/whatsapp-adaptation-20261020/source-restoration`, pin de referencia `463ae55f8c873468980746185fb3e91f55cb8681`. Runtime documentado en el inventario: `c8bb0a99d9ac2bb20acaef2e5a157b0ff83b05f2`; el delta conocido es documental. No se verificó aquí el runtime remoto. `E:/Proyectos/Sarin Bot` es mixto y solo recibe estos documentos; no es base ejecutable. Las rutas de código siguientes son relativas a source-restoration.

| Fuente leída | Hallazgo y consecuencia |
| --- | --- |
| `src/lib/server/chat-intent.ts` | Una herramienta `interpretar_solicitud`, enum cerrado y salida estricta; valida IDs y modos. La IA clasifica, no redacta texto final ni crea permisos. Añadir solo `service_details` como lectura explícita; sin intención FAQ ni herramientas nuevas. |
| `src/lib/server/chat.ts` | Comprueba propietario/modo, suscripción, bloqueo del cliente, consentimiento, política, admisión, cuota y estado; relee negocio tras inferencia antes de responder. Conservar esa secuencia. |
| `src/lib/server/chat-replies.ts` | Respuestas deterministas; `location` afirma siempre que no hay dirección aunque el dato exista. `services` lista datos básicos pero no utiliza descripción/categoría ni el servicio seleccionado. |
| `src/lib/sarin/prompts.ts`, `tests/service-catalog-prompts.test.ts` | Descripciones/categorías se excluyen deliberadamente del contexto de IA. Ubicación tampoco forma parte del clasificador. Renderizar datos del servidor no requiere enviarlos al modelo. |
| `src/lib/business-location.ts`, `src/lib/service-catalog.ts` | Normalización estricta de modalidad/ubicación y allowlist de metadatos de servicios ya existen. Reutilizarlas, incluyendo límites dirección 200, indicaciones 500, descripción 300 y categoría 60. |
| `src/lib/server/schemas.ts`, `src/types/firestore.ts` | `BusinessConfig` tiene ubicación opcional/null; servicios ya contienen descripción/categoría. No hay entidad FAQ libre. No modificar schemas de petición/configuración ni tipos persistidos; la ampliación puntual de `ChatIntent` se limita a lectura. |
| `src/lib/server/businesses.ts` | `createBusiness` exige dueño, consentimiento y acceso; guarda negocio/proyección pública transaccionalmente. Omitir ubicación conserva; null elimina. El guardado completa onboarding: no es un borrador privado. |
| `src/lib/firebase/admin.ts`, `src/lib/storage/database.ts`, `src/lib/storage/types.ts` | El dominio opera sobre una interfaz de documentos; hay adaptación Cloudflare además del desarrollo con Firestore. El arreglo usa los lectores existentes, sin SQL, migraciones o credenciales nuevas. |
| `src/app/dashboard/onboarding/page.tsx`, `src/app/b/[slug]/page.tsx` | Dueño edita campos actuales; IA prepara borrador revisable. Perfil ya muestra ubicación; chat web es opt-in para adulto que reserva para sí; salud y representación conservan formulario. |
| `tests/chat-route.test.ts`, `tests/chat.test.ts`, `tests/chat-surfaces.test.tsx`, `tests/business-location-*.test.*` | Hay fixtures de DB, cuotas, replay, políticas y UI. Ampliar estas pruebas; no solicitar inferencia real o datos privados para comprobar el cambio. |

## Arquitectura mínima

Crear `src/lib/server/business-receptionist-info.ts`, módulo de formato sin DB, red o motor. Recibe exclusivamente la información del negocio ya leído y devuelve texto. `renderChatReply` le delega ubicación y los casos `services`/`service_details`/`price`; las demás ramas conservan su contrato. No devolver `toolResults`, propuestas, borradores o hechos del historial desde este módulo.

```ts
type BusinessServiceInformationInput = {
  business: Pick<Business, 'name' | 'services'>;
  intent: 'services' | 'service_details' | 'price';
  serviceId?: string;
};
renderBusinessLocationInformation(business: Pick<Business, 'location' | 'phoneWhatsApp'>): string;
renderBusinessServiceInformation(input: BusinessServiceInformationInput): string;
```

El archivo usa `normalizeBusinessLocation` y `serviceCatalogMetadata`. No importa un componente React para validar teléfonos ni un schema agregado de configuración para dar formato a una consulta. El teléfono de fallback solo se imprime si es string y coincide **completamente** con `^\+?[1-9]\d{7,14}$`, incluyendo comprobación de coincidencia completa para rechazar salto final; no limpiar caracteres hasta fabricar un contacto válido. No crear enlaces automáticos desde texto libre. El enlace Maps existente de la ficha pública no cambia.

La instrucción del clasificador se precisa dentro de `buildBusinessIntentPrompt`: preguntas sobre qué incluye un servicio son `service_details`, con ID solo si corresponde al catálogo; listar catálogo sigue siendo `services`, y modalidad/dirección es `location`. Se amplía el enum de intención con esa única lectura; su schema de herramienta refleja automáticamente el enum, pero conserva nombre y campos. No cambian `ChatSelection`, `ChatResponse` o los datos operativos enviados al proveedor. Descripción, categoría e indicaciones continúan fuera del prompt. No cambiar funciones históricas de agentes/herramientas como si estuvieran activas.

La separación es necesaria: `interpretChat` mezcla la selección del turno con la del estado anterior. Un `serviceId` heredado no demuestra que se haya pedido detalle. `services` ignora ese ID al listar. Para `service_details`, **antes del merge**, exigir `result.selection.serviceId` explícito del resultado interpretado de este turno. Si falta, devolver `{ intent: 'clarify', selection: input.state.selection }`, sin descripción ni configuración propuesta; no usar el ID anterior como respuesta. Si el ID explícito es desconocido, la validación actual devuelve aclaración con selección vacía, sin rescatar el anterior.

Una pregunta como qué incluye este servicio solo se responde si el clasificador explicita un ID válido del contexto en este turno. La frase por sí sola no lo acredita. Probar estado Corte + pregunta sobre servicio desconocido + salida sin ID y salida con ID desconocido: ninguno puede devolver la descripción de Corte. Este guard no inventa un protocolo de correferencia ni agrega campos persistidos.

Para esa intención de lectura, un recurso anterior tampoco es evidencia del turno actual: después del merge, si `result.selection.resourceId` está ausente, eliminar `selection.resourceId` heredado, incluso al consultar el mismo servicio. Así, estado servicio A/recurso A y detalle de B explícito sin recurso responde B sin exigir afinidad con A. Si el resultado incluye recurso explícito, conservar la validación existente de existencia, activo y afinidad con el servicio explícito; desconocido o incompatible devuelve `{ intent: 'clarify', selection: {} }`. No ignorar recursos explícitos maliciosos ni modificar el merge de los demás intents. Conservar el borrado de `proposalId` actual; no producir propuesta por esta lectura. El cambio de selección se persiste por el mecanismo existente: una consulta posterior deberá seleccionar de nuevo un recurso si lo necesita.

Una vez validada y eliminado `proposalId`, devolver para la nueva intención solo `{ intent: 'service_details', selection }`, sin copiar `configurationDraft` de la salida. El modo cliente conserva antes su rechazo actual de drafts; en onboarding, un draft ajeno a esta lectura se descarta. Esto evita que `chat.ts` lo adjunte automáticamente a una respuesta de detalle. No ampliar este cambio al contrato de drafts de los demás intents.

## Respuesta de ubicación y modalidad

Normalizar primero el valor guardado. Texto inválido histórico se trata como no disponible; no se recuperan propiedades desconocidas ni valores de otra proyección. Las indicaciones válidas se presentan como texto literal precedido por **Indicaciones publicadas por el negocio:**; no se convierten en instrucciones de sistema, HTML, enlaces, acciones o autorización.

| Estado guardado | Respuesta base exacta y composición |
| --- | --- |
| `at_business` con dirección | `Atención en el local.` + nueva línea + `Dirección: {dirección normalizada}`. Añadir indicaciones si existen. No afirmar que se ha geocodificado o verificado físicamente. |
| `at_business` sin dirección | `Atención en el local. El negocio no ha publicado la dirección exacta en SarinBot.` Añadir indicaciones si existen y fallback de contacto. No inventar dirección a partir del nombre o categoría. |
| `at_client` con indicaciones | `Atención a domicilio.` + bloque de indicaciones. No inferir precio, radio de cobertura o dirección del cliente. |
| `at_client` sin indicaciones | `Atención a domicilio. Confirma con el negocio la zona y las condiciones de atención.` Añadir frase de teléfono solo si es válido. |
| `online` con indicaciones | `Atención en línea.` + bloque de indicaciones. No crear enlace de reunión, contraseña o instrucciones particulares ausentes. |
| `online` sin indicaciones | `Atención en línea. Contacta al negocio para conocer las indicaciones de conexión.` Añadir frase de teléfono solo si es válido. |
| Ausente/null/inválida | `El negocio no ha publicado una ubicación o modalidad válida en SarinBot.` + fallback de contacto. No copiar texto de campos desconocidos. |

El fallback de contacto para ubicación ausente/inválida o local sin dirección es `Puedes consultar los detalles en {phoneWhatsApp}.` si el teléfono es válido; en otro caso, `Contacta directamente al negocio para confirmarlo.`. Domicilio/online sin indicaciones ya tienen una petición de contacto en su base: añaden únicamente la frase del teléfono válido, sin otra frase genérica. Unir frases con espacio y bloques de datos con nueva línea. No prometer recepción por Sarin, envío o atención humana inmediata.

## Servicios, precio y preguntas conocidas

- `services` conserva siempre el catálogo básico actual, aunque la selección anterior incluya un servicio: `Servicios de {nombre}:` y cada `nombre: {precio COP} · {duración} minutos.`. No volcar descripciones de hasta 60 servicios en una sola respuesta.
- `service_details` con ID vigente y explícito en la interpretación actual muestra ese servicio: línea básica, `Categoría: {categoría}` si existe y `Descripción publicada por el negocio:` con descripción literal si existe. Si falta descripción, añadir `El negocio no ha publicado una descripción adicional de este servicio.`. El helper sin ID devuelve defensivamente `¿De qué servicio quieres conocer los detalles?`; en la ruta normal, el guard del intérprete transforma antes ese caso en `clarify`, cuyo texto cerrado se conserva. Esto responde qué incluye sin fabricar una prestación a partir del nombre.
- `price` con ID vigente conserva la línea breve de precio/duración, sin añadir descripción; sin ID conserva `¿De qué servicio quieres conocer el precio?`.
- ID que ya no exista tras la relectura, en `service_details`/`price`: `Ese servicio no está disponible en el catálogo actual. Consulta los servicios del negocio.`. No cambiar silenciosamente al primer servicio ni mostrar datos de una selección vieja.
- La información básica usada debe ser válida: nombre string no vacío hasta 120 caracteres, precio finito entre 0 y 100000000, duración entera entre 5 y 720. Para un servicio seleccionado inválido: `El negocio debe revisar la información de este servicio. Contacta al negocio para confirmarla.`. Si la lista contiene un básico inválido, devolver `El negocio debe revisar su catálogo. Contacta al negocio para confirmarlo.` en lugar de una lista que parezca completa y correcta. Metadatos opcionales inválidos se omiten mediante la allowlist existente.
- Catálogo vacío conserva el fallback empresarial sin atribuir al cliente la tarea del dueño: `El negocio todavía no ha publicado sus servicios. Contacta al negocio para confirmarlos.`. No es una autorización de edición.
- Horario y contacto conservan sus respuestas existentes y se comprueban con fixtures actualizados. El horario semanal es información publicada; la disponibilidad real requiere la consulta de huecos existente. No convertir horario de apertura en una hora reservable.
- `out_of_scope` y `clarify` mantienen `OUT_OF_SCOPE_REPLY` exacto. No se devuelve prosa libre del modelo ni se responde una FAQ libre leyendo `customRules`. Un retorno parcial del clasificador sigue siendo una aclaración, no una coincidencia FAQ segura.

No garantizar comprensión de cualquier paráfrasis: los tests de integración fuerzan una intención válida para verificar el contrato de respuesta. Un test de prompt/herramienta no demuestra precisión de un proveedor real. No añadir una segunda inferencia para explicar el resultado ni un camino sin cuota para estas consultas.

## Vigencia, replay y fallos

Una **consulta nueva** utiliza el negocio de la última lectura autorizada posterior a interpretar el mensaje. Precio, modalidad o descripción cambiados mientras el modelo responde deben reflejar esa relectura; si se elimina el servicio, aplicar fallback. Esto no constituye una lectura linealizable con todos los cambios que ocurran después de esa lectura.

El mismo `requestId`/fingerprint conserva el replay actual: puede devolver el texto histórico original durante su ventana, sin inferencia ni unidad adicional. No recalcularlo con datos nuevos ni reescribir una reserva de cuota para simular información siempre actual. Tras expirar caché, un turno ya completado mantiene `REQUEST_ALREADY_COMPLETED` cuando corresponda; una consulta nueva requiere otro requestId y usa datos nuevos. Un mensaje anterior del chat no se actualiza solo al guardar configuración.

Si falla DB, política, consentimiento o admisión, no usar el negocio viejo de un prompt como fallback exitoso ni responder no publicado. Conservar errores/códigos actuales, liberar o retener cuota según el contrato existente y no emitir éxito falso. Si cambia a salud durante inferencia, no publicar respuesta nueva de IA; mantener recuperación de confirmaciones guardadas que ya existe. Este incremento no cambia retención de conversaciones, cuerpos de logs, diagnóstico, caché, TTL, presupuesto o proveedor.

## Autorización, salud y menores

La nueva presentación y el renderer no eluden `runSarinChat`: autenticación de ruta, modo autorizado, negocio configurado, acceso, bloqueo, consentimientos de cuenta y negocio, política de datos, admisión, cuota y estado siguen antes de información nueva. Un `tenantId` público puede elegirse para consultar ese negocio si las reglas actuales lo permiten; no es suplantación del dueño ni acceso a sus citas privadas.

Modificar información sigue exigiendo dueño mediante `/api/businesses`; se conserva escritura transaccional de negocio/proyección y semántica omisión/conservación/null. Un prompt, una descripción o una pregunta no crea capacidades. La consulta informativa no escribe negocio, catálogo, citas o propuestas; sí conserva los registros técnicos de estado/cuota del chat existente.

Para salud no se habilita chat ni bypass informativo: la ficha ya permite leer ubicación/contacto; la reserva usa formulario sin IA. La UI de representación de menores mantiene el formulario y no monta chat para ese caso. Una consulta informativa no cambia el beneficiario, sus datos o permisos; no enviar datos de pacientes/menores al motor ni añadir campos libres. En negocio general con menores habilitados, el chat general conserva el alcance de quien reserva para sí; no se inventa un rol laboral o una bandeja de equipo.

## Guía del dueño sin congestión

Crear `BusinessAssistantScopeNotice` en `src/components/business-assistant-scope-notice.tsx`, sin red, hook de chat o botones de activación. Sus props son `{ configured: boolean; dataMode: 'general' | 'health'; representedMinorsEnabled: boolean }`, tomadas del negocio/política actuales. No recibe texto privado ni un borrador IA.

Punto de composición coordinado con el diseño de configuración guiada: `OwnerConfigurationWorkspace` en `src/components/owner-configuration-workspace.tsx` ofrece la prop opcional `assistantScope?: ReactNode`. La ruta/controlador compone `BusinessAssistantScopeNotice` en ese slot solo con `policy.ready` y `policy.capability` válidos; `configured` procede de `business.sarinConfig.onboardingCompleted`. El workspace lo muestra dentro de Cómo responde Sarin o su explicación equivalente de formulario sin IA para salud. Este incremento no inserta un bloque perdido en el formulario monolítico actual ni duplica los textos de alcance en el otro proyecto.

Las tareas de formato/chat son independientes. La integración visual depende de que exista ese slot en la rama reconciliada; el [diseño de configuración guiada](2026-10-22-owner-guided-configuration-design.md) y su [plan](../plans/2026-10-22-owner-guided-configuration.md) son dueños del workspace y del borrador agregado. Este plan es dueño del contenido del notice y de su composición, no de reimplementar navegación, campos o persistencia. No pasar el contenido del slot al payload de configuración.

Un `details` cerrado por defecto con summary **Información y alcance de Sarin** contiene, al abrirlo, una explicación breve y fuentes agrupadas: Catálogo → servicios/precios/duración/descripción; Datos del negocio → ubicación y contacto; Horarios → horario publicado y consulta de disponibilidad; Confirmación → propuesta revisable y botón Confirmar cita. No repetir el catálogo entero o la tabla de QA. La configuración guiada conserva ayudas junto a campos; este notice añade alcance y fuentes sin duplicar sus editores.

Texto general: `Sarin utiliza la configuración guardada de tu negocio para responder sobre servicios, precios, horarios, contacto y modalidad de atención. Los cambios que todavía estás editando no se utilizan hasta guardar.`. Añadir `La cita solo queda registrada después de revisar la propuesta y pulsar Confirmar cita.`. Sobre preferencias: `El tono y las indicaciones no crean precios, servicios ni acciones nuevas.`. Si no está configurado: `Al guardar la configuración se actualiza tu página de reservas.`. No crear Guardar borrador o Publicar: el guardado actual actualiza proyección pública y completa alta cuando corresponde.

En salud, la explicación principal será `Este negocio utiliza reservas mediante formulario, sin IA. La ubicación y el contacto publicados siguen disponibles en su página de reservas.`; no listar habilidades IA como activas ni iniciar una demo. Si hay representación habilitada, añadir `Las reservas para menores usan el formulario y la representación autorizada; no se gestionan mediante este chat general.`. Si la política está cargando o falla, no montar el panel con datos de una clasificación anterior; conservar aviso/reintento actual.

Conservar DM Sans, marca, tokens Sarin, `details/summary`, labels, foco visible y controles de 44 px existentes. Panel de una sola columna, sin tablas anchas, carruseles o biblioteca nueva; teclado/lectura y 320/390 px verificables. No añadir navegación de módulo futuro, métricas ficticias, proveedor técnico o una pantalla de documentación extensa al flujo del dueño.

## Aceptación y regresión

| ID | Resultado exigido |
| --- | --- |
| K01 | Dirección/modalidad e indicaciones guardadas válidas aparecen correctamente; ausencia/corrupción no inventa ubicación ni contacto. |
| K02 | Domicilio y online no se convierten en una dirección física, cobertura, precio de desplazamiento o enlace de reunión no publicados. |
| K03 | Detalle exige ID explícito válido de la interpretación actual y usa metadatos actuales permitidos; ID omitido/desconocido no rescata otro del estado. Recurso omitido no se hereda; recurso explícito inválido/inactivo/incompatible exige aclaración. Precio/duración siguen estructurados; ID retirado después de interpretar o básico inválido produce fallback cerrado. |
| K04 | Datos cambiados durante inferencia se releen; otra consulta nueva observa cambios. Replay conserva su texto/cuota y no crea una operación nueva. |
| K05 | HTML/instrucciones en metadatos se presentan como texto etiquetado y no se añaden al contexto del proveedor. El mensaje del cliente sigue entrando como dato de usuario sin autoridad; ninguno se ejecuta o concede acciones. Ninguna respuesta informativa incorpora prosa libre del modelo. |
| K06 | Persisten negativas de identidad/modo, política de salud, consentimiento, bloqueo, cuota agotada y fallos. No crear cita, propuesta o configuración por pedir información o decir sí. |
| K07 | Dueño entiende fuentes, guardado público y límite de acciones sin activar ni enviar nada; guía no usa el borrador como dato ya guardado. |
| K08 | Salud, menores, calendario directo, espera, recordatorios en app y reprogramación del cliente conservan rutas y permisos. WhatsApp y su contabilidad no se amplían. |
| K09 | Sin migración, campos persistidos ni schemas nuevos de petición/configuración, permisos nuevos, dependencia, modelo o mensaje externo. Solo se amplía el enum de intención de lectura. Los textos de datos siguen escapados por React. |

Pruebas futuras: unitarias de formato, integración de la ruta con motor simulado/DB sintética, UI con react-test-renderer y QA local en 320/390/1280 px. Usar Node 24 y pnpm 11.23.0; conservar `pnpm-lock.yaml`. La ejecución deberá reconciliar versión real, crear aislamiento y completar los checks aplicables de `.github/workflows/verify.yml`. No ejecutar desde E: ni alterar el worktree recuperado.

## Autorrevisión y punto de entrega

Se contrastaron tipos y funciones previstos con la fuente, y se eligió una entrega sin ambigüedad sobre FAQ: solo información estructurada existente. No se añade entrenamiento, búsqueda semántica, proveedor nuevo, editor FAQ, memoria de clientes, acción autónoma, voz, canal o cobro. Las reglas de replay, salud y guardado público están separadas de expectativas de UI.

El diseño queda listo para revisión junto con su plan; no es evidencia de una mejora implementada o desplegada. Puntos de revisión principales: texto fallback por modalidad, detalle de servicio como datos literales, alcance real del tono/indicaciones y no ampliar este plan con el editor FAQ. Si se adopta FAQ después, necesitará un diseño propio con entidad, publicación, selección, límites, versiones y precedencia explícitos antes de aparecer en navegación.
