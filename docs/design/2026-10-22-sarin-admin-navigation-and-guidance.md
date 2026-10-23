# Navegación y guía administrativa de Sarin

Propuesta documental del 22 de octubre de 2026. El propietario pidió adaptar la claridad de Fresha: tareas fáciles de encontrar, explicación contextual y configuración paso a paso, sin amontonar información ni copiar su interfaz. Esta propuesta conserva la identidad de Sarin y reorganiza capacidades existentes; no implementa pantallas ni declara disponibles funciones futuras.

Complementa el [registro de captura](../product/fresha-admin-capture-register.md), la [evidencia administrativa de Fresha](../qa/2026-10-22-fresha-admin-settings-and-permissions.md), el [inventario efectivo de Sarin](../qa/2026-10-22-sarin-effective-admin-inventory.md) y la [referencia del recepcionista IA](../qa/2026-10-22-fresha-ai-receptionist-reference.md). La agenda visual tiene [diseño propio](../superpowers/specs/2026-10-22-owner-agenda-design.md); este documento organiza su acceso, sin ampliar sus operaciones.

## Base auditada y decisiones

Se leyó `source-restoration` en `C:/Users/Drean Skate/AppData/Local/SarinBot/whatsapp-adaptation-20261020/source-restoration`, correspondiente al pin de referencia `463ae55f8c873468980746185fb3e91f55cb8681`. Las rutas de código siguientes son relativas a esa fuente; no al checkout mixto de E:. No se inspeccionó Chrome ni se volvió a probar el runtime remoto. El inventario identifica funciones publicadas que no deben recrearse como novedades.

| Evidencia de código actual | Implicación de diseño |
| --- | --- |
| `src/components/app-shell.tsx`: negocio tiene Mi agenda, Mi negocio, Enlace y QR, Suscripción; administración tiene Control de SarinBot, Asistente y Mi negocio. En escritorio hay lateral de 236 px; en móvil, enlaces horizontales desplazables. | Conservar los cuatro destinos del dueño. Hacer visible el contexto de rol y mejorar el acceso móvil; no añadir un menú amplio para imitar Fresha. |
| Shell: salto al contenido, foco visible, `aria-current`, controles de 44 px, `Notice` con status/alert y panel de consentimiento plegado cuando está vigente. | Reutilizar estas bases de accesibilidad. No convertir autorizaciones en un banner grande permanente ni esconder una decisión pendiente. |
| `src/app/dashboard/onboarding/page.tsx`: identidad, contactos, ubicación, recursos, catálogo, horario, preguntas y reglas comparten formulario; asistente lateral prepara un borrador aplicable antes de guardar. | Separar tarea y orientación; mostrar un bloque editable a la vez y revisar el borrador. No hacer obligatoria la IA ni presentar instrucciones como permisos reales. |
| `src/lib/server/businesses.ts`: guardado de configuración agregado; marca onboarding completo y actualiza proyección pública. Logo tiene guardado propio. | No simular guardado independiente de cada sección con el contrato actual. Explicar qué cambia públicamente; no inventar estados borrador/publicado. |
| `src/app/dashboard/page.tsx`: lista diaria, estado de suscripción, políticas de reservas y bloqueo plegable. Selector de clientes para políticas se deriva de citas del día. | La agenda debe dominar visualmente. Las políticas van en una sección secundaria y no se presentan como CRM completo. |
| `src/app/admin/page.tsx`: estado del motor, presupuestos, clasificación, consumo, WhatsApp, invitaciones, pagos, negocios y facturación están apilados. | Dividir por tareas reales y exponer un resumen inicial; los formularios especializados se abren al elegir un módulo. |
| `src/app/admin/assistant/page.tsx`: copiloto, revisión de pago, WhatsApp de plataforma, conversaciones de negocios y soporte web en la misma página. | Separar consulta de ejecución y los ámbitos de atención. Una respuesta del copiloto no debe desplazar o confirmar un pago. |
| `admin-payment-confirmation.tsx`, `admin-invitations.tsx`, `admin-platform-budget.tsx`: revisión, confirmación, motivo, autenticación reciente o conflicto según operación. | Reutilizar estos patrones; una reorganización visual no puede retirar sus controles o repetir una operación incierta. |

La interfaz se diseña para el dueño que necesita atender su día y ajustar su negocio, y para el administrador que opera la plataforma. El personal del establecimiento no tiene roles laborales equivalentes en el inventario actual; no se promete una cuenta de equipo mediante un selector visual.

La regla de presentación es divulgación progresiva por tarea: resumen primero, editor pertinente después y ayuda ampliable cuando hace falta. Los pasos orientan una decisión real y conservan contexto; no sustituyen una página congestionada por múltiples pantallas sin propósito. Se reutilizan identidad, componentes y contratos de Sarin, sin dependencia nueva para menús, asistentes o paneles.

## Patrones de Fresha que se adaptan

El recorrido capturado usa Más → módulo → sección; algunos módulos comienzan por una explicación y Empezar; los asistentes dividen la tarea en pasos y separan ajustes, detalles y rendimiento. La evidencia local acredita, entre otros ejemplos, Rendimiento/Vista previa/Detalles en recordatorios y una demo de IA separada de Activar. Los asistentes de dos o tres pasos capturados orientan una tarea concreta; no obligan a dividir cualquier formulario arbitrariamente en tres pantallas.

La [operación manual de una cita](../qa/2026-10-22-fresha-appointment-operation.md) detectó que elegir otro horario aplicó inmediatamente la reprogramación, sin segunda confirmación observada. El resumen antes de confirmar que propone Sarin es una decisión propia para hacer el efecto comprensible, no una atribución universal a Fresha. Ese ensayo no se ejecutó a través de la demo IA.

| Patrón útil | Adaptación Sarin | Límite |
| --- | --- | --- |
| Módulo y sección | Pocos destinos persistentes y subsecciones con nombre de tarea. | No reproducir el árbol comercial completo de Fresha ni crear accesos a productos pendientes. |
| Introducción y Empezar | Estado vacío con finalidad, requisitos reales y una acción clara. | No anteponer una introducción cada vez que se abre una función ya configurada. |
| Pasos y resumen | Un recorrido corto para alta o cambio sensible, con Atrás y revisión antes del efecto. | Editar un nombre no necesita un asistente largo ni confirmaciones repetidas. |
| Ayuda contextual | Una frase junto al campo, ejemplo opcional y ayuda ampliable. | No repetir manuales o advertencias genéricas en cada tarjeta. |
| Resumen, configuración y actividad | Separar lectura, edición y evidencia donde existan esos datos. | No crear pestaña Rendimiento para una función sin métricas ni usar cifras demostrativas como datos del negocio. |

## Mapa del dueño: cuatro destinos reales

Las URLs de la segunda columna existen hoy. Las secciones son una reorganización propuesta, no rutas nuevas ya publicadas.

| Destino | Ruta actual | Contenido propuesto y acción principal |
| --- | --- | --- |
| Mi agenda | `/dashboard` | Fecha, citas/bloqueos y resultado de carga. Acción contextual Bloquear horario; compartir desde acción secundaria. Políticas del negocio se abren mediante Reglas de reservas. La futura cuadrícula conserva esta entrada. |
| Mi negocio | `/dashboard/onboarding` | Resumen de configuración y entradas Datos y contactos, Servicios y recursos, Horarios y Cómo responde Sarin. Acción Configurar negocio en alta; después Editar en la sección elegida. |
| Enlace y QR | `/dashboard/qr-kit` | Tarjeta, enlace y preparación/descarga existentes. Acción Preparar tarjeta o descargar cuando exista artefacto listo; Copiar enlace y Abrir reservas secundarias. |
| Suscripción | `/dashboard/billing` | Estado, citas/respuestas disponibles, vencimiento y comprobantes; elección de compra bajo una acción explícita. Invitación en Tengo un código, sin ocultar su disponibilidad. |

El enlace actual Ver mi isla se propone renombrar **Ver mi página de reservas**: mantiene el destino y explica el resultado a alguien nuevo. Puede conservarse la palabra isla en contenido de marca, sin exigirla para comprender una acción operativa.

Mi negocio abre un resumen breve: nombre/modalidad, número de servicios/recursos, días de atención y estado real de configuración. Cada bloque tiene una descripción de una línea y Editar. No muestra todos los campos ni todas las sugerencias simultáneamente. Las referencias a personas siguen llamándose **Profesionales o estaciones**; no se convierten en empleados con cuentas y permisos.

La sección Cómo responde Sarin contiene únicamente tono, indicaciones y preguntas de reserva permitidos por la política actual. Explica que esos campos no crean acciones nuevas y que las respuestas actuales tienen alcance acotado. No muestra interruptores de voz, WhatsApp propio, FAQ o acciones que todavía no tengan contrato. Para salud se conserva la configuración manual y el recorrido sin IA; para menores se conservan las restricciones existentes, sin sugerir preguntas incompatibles.

## Mapa del administrador de plataforma

Cambiar de contexto se llama **Administración de Sarin** o **Volver a mi negocio**. Está disponible solo al superadministrador, también en móvil. Volver a mi negocio abre su negocio propio; no implica entrar como dueño de otro establecimiento. El encabezado muestra Administración de Sarin de forma persistente; el selector de negocio dentro de una tarea no cambia el rol de sesión.

La propuesta utiliza las páginas existentes `/admin` y `/admin/assistant`, con selección de módulo serializable en parámetros de URL. Esos parámetros son trabajo futuro de interfaz, no enlaces funcionales acreditados hoy. No se requieren APIs nuevas para añadir destinos al menú.

| Destino propuesto | Base existente | Secciones mostradas al entrar |
| --- | --- | --- |
| Resumen | `/admin` | Pendientes consultados, estado de operación y accesos a la tarea. Motor/cola en Estado técnico plegable; sin todos los editores en portada. |
| Negocios | `/admin` | Tabla y suscripciones existentes; detalle seleccionado con consumo y clasificación de reservas. Ninguna ficha promete historial de clientes global. |
| Pagos y acceso | `/admin` y revisión actual de `/admin/assistant` | Comprobantes por estado; revisar individualmente; invitaciones en sección propia. Confirmación de pago conserva propuesta y autenticación. |
| IA y canales | `/admin` | IA de negocios, presupuestos, consumo y vinculaciones actuales. Identificar separadamente IA comercial, presupuesto de plataforma y WhatsApp de negocios/plataforma. Abrir solo un editor a la vez. |
| Asistente y atención | `/admin/assistant` | Consulta de operación, WhatsApp de Sarin, conversaciones de negocios y soporte web, como secciones distintas. Un nombre de sección declara siempre el ámbito. |
| Facturación de Sarin | `/admin` | Datos comerciales/precios y configuración de facturación de plataforma ya existentes. No confundir con cobros del establecimiento a sus clientes. |

Dentro de IA y canales se proponen Resumen, Configuración y Consumo únicamente donde haya lectura/edición/contadores reales. Configuración agrupa fuentes existentes, no activa proveedores o envíos por abrir la pestaña. En Asistente y atención, primero se elige Consulta o el ámbito de conversación; el texto, los identificadores privados y los botones de toma humana no quedan apilados bajo un resumen general.

Conservar enlaces existentes con `focusPayment`, `paymentAction`, `support` y anclas de comprobante/negocio: resolver el módulo/sección necesario antes de enfocar su registro. Parametrización inválida vuelve al resumen con mensaje recuperable; jamás prepara o ejecuta un cambio. Permisos se vuelven a comprobar en servidor; ocultar una sección no es autorización.

## Alta guiada y edición posterior

### Alta inicial en tres pasos

El alta exige el acceso ya previsto por el producto: pago aprobado o invitación válida y consentimiento correspondiente. El bloqueo de acceso se explica con estado y acción hacia Suscripción; no abre un formulario que luego fallará por esa condición conocida. No se contrata, cobra o publica algo al pulsar Empezar.

| Paso | Tarea visible | Continuar y resumen |
| --- | --- | --- |
| 1. Tu negocio | Nombre, categoría, enlace permanente y contacto requerido. Ubicación/modalidad y redes opcionales en un bloque expandible. | Valida estos campos; explica que contacto/ubicación configurados se muestran públicamente. El enlace queda reservado al guardar, no al escribir. |
| 2. Tu agenda | Una subsección a la vez: Profesionales o estaciones → Servicios → Horarios. El rótulo indica cuál de las tres se está completando. | Recurso y servicio conservan IDs. Precio, duración, buffer y elegibilidad tienen etiqueta y unidad. Los días muestran abierto/cerrado e intervalos, con ejemplo opcional. Se revisan relaciones antes de pasar. |
| 3. Revisar y guardar | Resumen de negocio, servicios, recursos, días e información pública; Editar vuelve al punto exacto. Preferencias del asistente y preguntas compatibles son opcionales y ampliables. | Botón Guardar configuración; explicación expresa de su efecto sobre perfil/agenda y condición real de reservas. Tras éxito: Ver mi agenda como acción, Enlace y QR como secundaria. |

Los pasos son agrupaciones de una única configuración en memoria. Continuar valida el bloque y cambia de pantalla; no indica Guardado. Atrás conserva cambios. El servidor sigue validando el objeto agregado al final. Si hay error en un campo de un paso anterior, se abre ese paso y se enfoca el campo; no se deja un control inválido escondido fuera del alcance del navegador.

La alternativa **Configurar con Sarin** es voluntaria, junto a Configurar manualmente, con igual acceso. El asistente puede preparar la configuración; Usar propuesta la aplica al borrador y conduce a revisar los campos cambiados. No guarda, activa canales ni sustituye confirmación. En móvil abre una vista dedicada o bloque ampliable de ancho completo; nunca aprieta conversación y formulario en dos columnas. Fallo/cuota agotada conserva el formulario manual y los datos introducidos.

No se promete Continuar después como persistencia entre sesiones: el código leído no acredita borrador de alta guardado aparte. La primera reorganización conserva estado durante la visita; al salir con cambios se permite Continuar editando o Descartar. Persistencia durable de borradores requiere diseño/contrato específico posterior. No guardar conversaciones ni datos sensibles en localStorage como atajo.

### Negocio ya configurado

Editar abre solo la sección elegida y ofrece resumen de cambios antes de Guardar configuración. Para el contrato actual se conserva un borrador agregado y se envía una configuración completa válida; no se simulan endpoints parciales. Datos ajenos a la sección editada mantienen su valor. Cambiar secciones no descarta cambios; un indicador sobrio muestra Cambios sin guardar.

La forma actual de evitar sobrescribir el borrador con una actualización de datos debe conservarse. No presentar como implementado un control de versiones del servidor: si el diseño exige resolver edición concurrente real, el plan deberá especificar esa ampliación y su fallo, sin inventar mensajes de conflicto exitosos. Cancelar edición restaura el estado conocido y no elimina datos publicados.

El logo tiene operación de guardado independiente ya existente: su estado se muestra junto a su control, con Guardar logo y confirmación propia. No se declara pendiente del Guardar configuración general ni se afirma que Cancelar revierta un logo ya guardado.

## Lenguaje de acciones y revisión

| Acción | Significado propuesto | Regla |
| --- | --- | --- |
| Empezar / Configurar | Abre una tarea o editor. | No guarda ni habilita un servicio. Si algún paso persiste, debe nombrar ese efecto antes de ejecutarlo. |
| Continuar / Atrás | Cambia paso manteniendo el borrador de esta visita. | No utiliza check de Guardado ni confirma cambios comerciales. |
| Usar propuesta | Copia una propuesta al borrador revisable. | Señala qué cambió; no concede permisos ni ejecuta acciones. |
| Guardar configuración | Persiste los campos revisados. | En el contrato actual actualiza la proyección pública y completa el alta cuando corresponde; explicar ese efecto. No presentarlo como borrador privado. |
| Activar / Pausar | Cambia un estado operativo real. | Solo aparece si existe esa operación autorizada; indicar canal, ámbito y alcance. Guardar un límite no activa un control de presupuesto que está apagado. |
| Publicar | Hace visible contenido mediante transición propia. | No añadir este botón al perfil actual: no se encontró un estado de publicación separado del guardado. Primero haría falta ese contrato. |
| Preparar revisión | Lee datos y genera propuesta de una operación sensible existente. | No ejecuta; preservar caducidad, identidad y resultado incierto. |
| Confirmar [acción] | Ejecuta la operación identificada sobre el registro indicado. | Resumen incluye negocio, objeto, antes/después, efecto y datos económicos pertinentes. Evitar botones genéricos Sí/Aceptar. |

Para cambios reversibles ordinarios, revisión inline junto al botón es suficiente; no apilar diálogos. En pagos, suspensión, revocación o efectos globales, utilizar el flujo explícito existente con motivo/reautenticación según contrato. Una pérdida de conexión después de confirmar se presenta como Resultado pendiente de comprobar, con consulta de estado o reintento idempotente existente; nunca como fallo definitivo que invite a crear otra operación.

Ejemplos de texto: El cambio aparecerá en tu página de reservas al guardar; Esta propuesta todavía no cambia el pago; La recepción está pausada, tus citas existentes se conservan. No traducir errores internos sin contexto ni prometer que una respuesta del bot demuestra una reserva.

## Jerarquía visual, ayuda y móvil

Se mantienen DM Sans local, fondo `#f7f9ff`, blanco, texto `#162344`, secundario `#52617d`, azul `#315ff3`, suave `#edf1ff` y líneas `#e0e6f1`, presentes en `src/app/globals.css`. Bordes de 10–20 px, foco azul, cifras tabulares y marca/cara Sarin existentes. El [sistema visual](../../design-system.md) nació para portada: aquí se reutilizan identidad y accesibilidad, sin llevar animaciones promocionales al espacio de trabajo.

- Cada vista tiene un título, una frase que explica la tarea y una acción principal. Agrupar lo relacionado; no poner cada dato en una tarjeta. En resumen, pocas cifras pertinentes y enlaces de tarea; el resto aparece cuando se necesita.
- Escritorio conserva lateral y ancho legible; formularios de una tarea no exceden aproximadamente 45 rem. Dos columnas solo para campos breves relacionados. La ayuda no ocupa una columna fija que estreche el formulario.
- Móvil muestra cabecera con contexto y botón Menú, seguido del título de tarea. Menú abre lista de destinos del rol con etiqueta activa; evita que descubrir navegación dependa de desplazamiento horizontal. Preferir expansión en flujo con `aria-expanded` y `aria-controls`, sin modal ni biblioteca nueva. Al navegar se cierra y lleva foco al título.
- Pestañas de contenido pueden ser enlaces/botones con estado de sección, no un `tablist` incompleto. Si se usa el patrón ARIA tabs, implementar teclado completo; como base, enlaces de subsección con `aria-current` simplifican semántica y Atrás del navegador.
- Navegación de módulo/sección se refleja en URL y conserva Atrás/Adelante. No insertar un historial nuevo por pulsación de campo. Cambiar ruta con borrador sin guardar requiere una decisión explícita; no bloquear navegación sin explicar por qué.
- Objetivos de al menos 44 × 44 px, foco visible y orden DOM lógico. Etiquetas persistentes, unidades, opcionales explícitos y ayudas con `aria-describedby`. Iconos acompañan texto; color no es el único indicador. Menú no roba foco si no está abierto.
- A 320 px y zoom de texto no se corta Guardar, se permite envolver nombres y no aparece scroll horizontal de página. Las tablas densas pueden desplazarse dentro de su región etiquetada o presentar filas como fichas con las mismas cabeceras; ninguna acción depende de hover.
- Pie Guardar/Cancelar puede permanecer visible solo si no cubre controles o teclado móvil. Sin pie fijo como requisito inicial. Al cambiar paso, foco al encabezado y anuncio breve; al fallar, foco al resumen de errores y enlace al campo. `role=status` para carga/éxito y `alert` para fallo; evitar anunciar cada carácter o actualización del chat.
- Ayuda breve en el contexto: Buffer → Tiempo entre citas; Recurso → Persona o estación que puede atender este servicio. Lo avanzado usa `details/summary` o sección propia. No abrir varios paneles extensos de ejemplos por defecto.
- Movimiento reducido se respeta; navegación y éxito no necesitan animación. Ningún tour obliga a dar permisos o pagar. Ayuda/soporte se ofrecen donde exista la función vigente y con ámbito claro.

## Estados de pantalla

| Estado | Presentación y acción |
| --- | --- |
| Primera configuración | Explicar qué se obtendrá y requisitos reales; Configurar negocio abre el paso 1. No rellenar con datos de ejemplo que parezcan guardados. |
| Día sin citas | No hay citas ni bloqueos para esta fecha, con fecha visible. Compartir enlace y Bloquear horario según permisos. No afirmar que no existen clientes en todo el negocio. |
| Búsqueda/filtro vacío | No hay resultados con estos filtros; Limpiar filtros. Mantener selección y diferencia con base realmente vacía. |
| Carga inicial / actualización | Mantener estructura y estado; actualización conserva datos anteriores identificados como tales. No mostrar 0 ni Sin pendientes mientras no hay lectura. |
| Datos parciales | Señalar qué se consultó y qué falta; no presentar un resumen completo. Reutilizar cobertura parcial del copiloto. |
| Error recuperable | Qué no se pudo consultar/guardar y Reintentar esa operación. Mantener borrador. Sin stack, tokens o datos privados. |
| Sesión o permiso vencido | Cerrar vista privada/acciones según mecanismos existentes; explicar verificación requerida. No dejar contacto o comprobante visible como caché de otro usuario. |
| Acceso comercial no vigente | Motivo comprensible y ruta a Suscripción/contacto según estado. Diferenciar cortesía suspendida, pago pendiente y consumo agotado; conservar lectura de citas donde el contrato lo permita. |
| Guardando / resultado incierto | Deshabilitar duplicación de acción y anunciar proceso; al resultado incierto consultar estado. No marcar éxito por respuesta HTTP incompleta o texto de IA. |
| Guardado | Mensaje en contexto con nombre de sección/objeto y acción siguiente. Si cambia información pública, permitir abrir la vista existente. |

## Actual, reorganizable y previsto

| Categoría de trabajo | Tratamiento en interfaz |
| --- | --- |
| Actual: perfil, catálogo, recursos, horario común, asistente de configuración, QR, suscripción e invitaciones | Reorganizar ahora como diseño de UI, reutilizando contratos y condiciones. Los mensajes deben reflejar límites actuales del asistente y modalidad de reservas. |
| Actual: lista diaria, bloqueos, cancelación y políticas del dueño | Conservar entradas y permisos; separar tarea diaria de ajustes. No convertir tipo/etiqueta Completada en botón funcional sin operación respaldada. |
| Actual: administración global, presupuestos, confirmación de pagos, canales y atención de plataforma | Reubicar componentes con ámbito y revisión existentes; no degradar protección al dividir la página. |
| Previsto: cuadrícula día/semana del dueño | Integrar en Mi agenda cuando esté implementada y validada conforme a su diseño; no menú nuevo ni selector deshabilitado prometiendo fecha. |
| Previsto: CRM del dueño, equipo/turnos, FAQ, bandeja del negocio, informes del establecimiento y recordatorios externos | Permanecen en documentación de producto. No aparecen en navegación del usuario, en menús vacíos ni como botones inactivos. Se incorporan cuando exista capacidad real y permiso. |
| Fuera del alcance: cobros/anticipos de servicios, membresías, voz o publicación en directorio | No crear pasos ni controles comerciales. Tener una referencia Fresha no concede ese alcance a Sarin. |

## Criterios de aceptación y preparación del plan

La implementación futura debe partir de la versión efectiva reconciliada, no del checkout E:, y conservar enlaces compatibles. Este documento no autoriza mezclar las mejoras de navegación con nuevos subsistemas. Una primera entrega puede reorganizar shell y secciones; después alta/edición; después consola global y pulido, sin cambiar contratos a escondidas.

| Caso | Criterio comprobable |
| --- | --- |
| NAV01 — Alcance por rol | Dueño encuentra los cuatro destinos reales; no ve administración global. Superadministrador cambia de contexto también en móvil y nunca interpreta selector de negocio como suplantación. |
| NAV02 — Tarea localizable | Sin conocer la marca, una persona encuentra editar duración, horario, QR y comprobante a través de destino → sección, sin recorrer formularios ajenos. |
| NAV03 — Alta manual | Completa los tres pasos sin IA; Atrás conserva el borrador, no marca guardado y los errores abren el paso/campo correcto. Guardar produce un único resultado y explica su visibilidad. |
| NAV04 — Configuración asistida | Usar propuesta muestra cambios revisables; no persiste por sí mismo. Error de IA/cuota no impide continuar manualmente ni borra campos válidos. |
| NAV05 — Edición parcial visual | Cambiar un servicio conserva recursos, redes, ubicación y horario no editados; Cancelar restaura borrador sin afirmar revertir el logo ya guardado. |
| NAV06 — Seguridad existente | Salud/menores, consentimiento, suscripción, identidad y autorización servidor conservan efecto; panel oculto o URL manipulada no habilita acciones. |
| NAV07 — Enlaces y Atrás | `focusPayment`, `paymentAction`, `support` y anclas abren contexto correcto con foco accesible. Volver/avanzar no confirma pagos ni pierde silenciosamente el borrador. |
| NAV08 — Confirmación | El resumen de pago muestra objeto/efecto/caducidad y conserva autenticación/reintento existente. Activar, guardar y publicar nunca se usan como sinónimos. |
| NAV09 — Errores y vacíos | Carga no se presenta como cero, parcial no como completo y fallo no como vacío. Reintento mantiene fecha/filtro/borrador pertinente y no muestra información de otra sesión. |
| NAV10 — Móvil y teclado | Revisar 320/390 px, escritorio y zoom; navegación completa sin ratón, foco visible, orden/retorno coherente y ningún control cubierto por menú, pie o teclado. Probar lector de pantalla en pasos y errores. |
| NAV11 — Densidad e identidad | Un editor/tarea principal visible; resumen antes de detalle, ayuda ampliable y retorno al contexto; tipografía y tokens Sarin existentes. No se importa un menú, biblioteca, iconografía o paleta de Fresha ni se muestran todos los ajustes al entrar. |
| NAV12 — Sin funciones ficticias | No aparecen CRM/equipo/voz/reportes/bandeja del dueño antes de tener backend y permiso. Los datos de demo y las métricas estimadas se identifican claramente cuando correspondan. |

Validación de este artefacto: enlaces locales comprobables, referencias de código identificadas y separación de actual/previsto. El diseño requiere verificación de interacción en la futura implementación; la lectura de fuente no acredita usabilidad observada, accesibilidad completa ni un despliegue. No se modificaron código, dependencias, datos o configuraciones comerciales para producirlo.

## Ampliación de patrones observados

Añadido el 22 de octubre de 2026 tras la [captura administrativa ampliada](../qa/2026-10-22-fresha-admin-deep-capture.md). Las secciones anteriores conservan el alcance histórico de la auditoría de fuente463 y su distinción actual/previsto. Después se preparó un núcleo de catorce pares y se amplió a [diecisiete diseños/planes con composición acumulativa](../product/sarin-admin-extension-composition.md), enlazados desde el [handoff de implementación](../product/sarin-admin-implementation-handoff.md). Preparar esos pares no implementa funciones ni prueba toda la administración de Fresha. Las reglas siguientes refinan decisiones de Sarin, sin atribuir a Fresha comportamientos que solo se propusieron aquí.

| Regla UX concreta | Evidencia observada y adaptación | Destino documental y límite |
| --- | --- | --- |
| 1. Mantener contexto antes de ofrecer acciones. | L01/B02/B03 separan centro, cuenta personal y pertenencia al workspace. Mostrar siempre negocio y rol; un selector o una página abierta no concede otra identidad. Conservar cuatro destinos principales del dueño, no un menú por módulo capturado. | [1 Navegación](../superpowers/specs/2026-10-22-admin-guided-navigation-design.md) y [13 Equipo S13](../superpowers/specs/2026-10-22-business-team-permissions-design.md). Equipo no hereda permisos de dueño ni consola de plataforma; su primera fase es lectura asignada mínima. |
| 2. Cerrar no significa guardar y reabrir no lo demuestra. | En W01, Cerrar/reabrir conservó la selección local sin Guardar; recargar recuperó el ajuste original. C01/C03 mostraron descarte explícito. Señalar cambios pendientes, conservarlos al ir Atrás y ofrecer Descartar inequívoco; no poner check de Guardado por navegar. Un solo editor pertinente, con ayuda ampliable, evita amontonar el formulario. | [2 Configuración guiada](../superpowers/specs/2026-10-22-owner-guided-configuration-design.md). El borrador agregado vive en memoria; el guardado real actualiza también la ficha pública. No crear guardado independiente de cada sección, persistencia entre sesiones o publicación aparte. |
| 3. Un espacio libre en la agenda no es un horario reservable. | D01/D02 distinguen disponibilidad, capacidad e incrementos/optimización. La cuadrícula enseña ocupación; servicio, duración, buffer, horario efectivo y política determinan las opciones reservables. Mostrar el dato correspondiente y su actualización, sin invitar a reservar al pulsar cualquier hueco blanco. | [3 Agenda](../superpowers/specs/2026-10-22-owner-agenda-design.md). No se implementan optimizador de huecos, capacidad simultánea o reserva por arrastre como consecuencia de dibujar una cuadrícula. |
| 4. Explicar el destino público junto al dato. | L01 separa nombre público e interno; L02 separa modalidad, dirección, indicaciones y pin. La ayuda debe decir qué verá el cliente y de dónde sale la respuesta. Una dirección escrita no prueba coordenadas correctas; una modalidad online/domicilio no recibe una ubicación física inventada. | [4 Recepcionista informativo](../superpowers/specs/2026-10-22-business-receptionist-knowledge-design.md) y configuración2. Usa información guardada vigente; no contacto personal del administrador, atributos inferidos o valores del borrador aún no aplicado. |
| 5. Separar el resultado de atención del dinero y de la penalización. | C02 liga comisiones a venta; V01/V03 separan recibo/cargo de la cita; G04 pide una acción específica para bloquear. En Sarin, Atendida/Ausencia debe explicar su efecto y permitir revisar/corregir según contrato; no mostrar cobro, devolución o bloqueo como consecuencia implícita del estado. | [5 Resultados de atención](../superpowers/specs/2026-10-22-owner-attendance-and-client-record-design.md). Cambia resultado e historial privado; no cobra, devuelve cuota ni bloquea automáticamente. |
| 6. Distinguir ficha, nota interna y operación irreversible. | G01 separa alerta/comentario; G03 abre revisión de conflictos antes de Fusionar y guardar, que no se ejecutó. La ficha empieza por datos pertinentes y cobertura, con lectura antes que edición. Una nota del equipo no pasa a conocimiento del bot ni a respuesta pública. | [6 Consulta del reservante S06](../superpowers/specs/2026-10-22-owner-client-record-design.md). Sin notas libres, contactos, clínica, fusión o directorio global; no convertir las columnas ofrecidas por Fresha en nuevos datos obligatorios. |
| 7. Nombrar fecha concreta y patrón recurrente como tareas diferentes. | T01 distingue Editar este día del patrón; T02 muestra días libres, no una aprobación laboral verificada. Etiquetar a qué día/recurso afecta un cambio y resumir el horario efectivo antes de guardar. Mostrar avanzado solo cuando se elige excepción/cierre. | [7 Horarios y cierres S09](../superpowers/specs/2026-10-22-resource-schedules-and-closures-design.md). Sarin interseca con horario común por decisión propia; Fresha avisa que su disponibilidad de equipo no está ligada al horario habitual. Guardar no mueve/cancela citas previas ni crea gestión laboral. |
| 8. Revisar el antes/después antes de cambiar una cita. | La operación manual capturada aplicó el cambio al elegir horario sin segunda confirmación observada. Sarin adopta deliberadamente propuesta revisable con cita, fecha, hora, profesional y efecto. Mantener el workspace y su resultado incierto al cambiar fecha o filtro; no esconderlos al refrescar la cuadrícula. | [8 Reprogramación dueña S07](../superpowers/specs/2026-10-22-owner-rescheduling-design.md). Mismo ID/cuota, sin override de conflicto ni suplantación de cliente. El resumen explícito es decisión Sarin, no paridad universal con Fresha. |
| 9. Dar una respuesta factual por selección, separada de una acción. | L03 ofrece atributos del lugar; G01 conserva notas internas en otro contexto. Aparcamiento/accesibilidad/pagos presenciales pueden ser respuestas publicadas y revisadas por el negocio, sin convertir ese texto en instrucciones operativas. Plegar preguntas y mostrar una respuesta por elección evita una página congestionada. | [9 FAQ factual](../superpowers/specs/2026-10-22-business-factual-faq-design.md). Solo tres temas previstos; no FAQ libre, inferencia nueva, respuesta clínica o confirmación de reserva. Datos y acciones se explican separados. |
| 10. Mostrar qué se contó, cuándo y con qué cobertura. | R01 es catálogo de informes; R02/R03 muestran retraso y contenido de ejemplo/limitado, no resultados completos. Separar filtros de resultados y exponer fecha de consulta, vacío real, parcial y error; no sustituir carga por cero. | [10 Resumen operativo S17](../superpowers/specs/2026-10-22-owner-operation-summary-design.md). Cuenta estados actuales consultables por fecha, con aviso de legado; no ingreso, ocupación, personas únicas o métricas de retención. |
| 11. Describir el efecto de una oferta, no solo llamarla automática. | W01 explica notificación y muestra lista online activa con reservas online desactivadas. Separar revisar solicitud, ofrecer hueco y confirmar reserva; aclarar dependencia y vencimiento. Prioridad no demuestra exclusividad ni aceptación silenciosa. | [11 Bandeja S10](../superpowers/specs/2026-10-22-owner-waitlist-design.md) y [12 Ofertas in-app S10](../superpowers/specs/2026-10-22-owner-waitlist-offers-design.md). Revisada no resuelve espera; solo confirmación cliente enlazada lo hace. Sin ranking por valor, email/WhatsApp o reserva automática. |
| 12. El número de pasos sigue la modalidad y sus decisiones. | M02 muestra flash en tres pasos y última hora en dos; Atrás conservó el nombre del borrador. Diferenciar periodo de venta, fecha elegible de cita y anticipación respecto al inicio. En Sarin, cada rama enseña solo campos pertinentes y termina en una revisión del efecto, sin imponer tres pasos arbitrarios. | Configuración2 y ofertas12 adaptan el patrón de tarea. La oferta comercial de descuento de M02 es distinta de ofrecer un hueco de espera S10; descuentos/precedencia/precios permanecen fuera de esos planes. |
| 13. Una vista previa no es un enlace público ni progreso guardado. | L05 usó una preview con identificador temporal privado y porcentajes que cambiaban al navegar, sin guardado/publicación acreditados. Separar vista previa, cambios pendientes y estado público; no copiar una URL temporal al QR ni interpretar porcentaje como reservas habilitadas. L03/L04 Unlisted tampoco prueba disponibilidad online. | Navegación1/configuración2 y Enlace y QR existentes. Mantener control de ámbito y enlaces compatibles; Sarin no incorpora marketplace, checklist porcentual o transición Publicar nueva por imitación. |
| 14. Revisar propósito, remitente y gasto antes de habilitar un canal. | I01 permite personalizar antes de una puerta de contratación con prorrata/renovación; M01 exige tarifas/facturación antes del editor. Distinguir demostración, preferencias, guardar, activar y enviar; mostrar requisitos reales y resumen económico cuando aplique. No habilitar reseñas, campañas o voz al guardar una recepción informativa. | [14 Email operativo S11](../superpowers/specs/2026-10-22-external-appointment-reminders-design.md). Proveedor/remitente/coste siguen sin verificar y flags apagados; preferencia de servicio separada de marketing. Aceptación del proveedor no es entrega, y ninguna tarifa de Fresha se convierte en tarifa de Sarin. |

Los destinos secundarios se agrupan por tarea: Horarios, FAQ, Equipo y Recordatorios se abren desde **Mi negocio**, conservando su contexto de navegación; Espera, Informes y S03 conversación compartida desde **Mi agenda**. Enlace y QR/Suscripción mantienen sus destinos actuales. Solo aparecen accesos cuando su ruta, backend, permiso y tratamiento de fallo estén implementados y verificados. Los diecisiete pares revisados no justifican más destinos principales ni botones que anuncien funciones futuras.

El [prototipo HTML local](sarin-admin-prototype/index.html) y su [guía de revisión](sarin-admin-prototype/README.md) permiten explorar agenda, tres pasos de configuración y alcance/FAQ con datos sintéticos. Es una **demo independiente, no producto**: las acciones solo cambian memoria, Guardar solo confirma una simulación y nada se publica/envía. Su acceso demostrativo Recepción no cambia el acuerdo de cuatro destinos principales. La revisión de qué sería público y los estados navegables sirven para evaluar claridad; no prueban contratos, disponibilidad, accesibilidad completa ni funcionamiento desplegado.

Esta ampliación usa evidencia local leída sin navegador propio y no modifica captura/matriz/handoff. La verificación futura debe evaluar una tarea por vista, foco/teclado, estados completos y recuperación sin perder contexto. Mantener tokens, marca y lenguaje de Sarin; los patrones observados orientan decisiones, no un clon.

## Reglas añadidas desde los editores operativos

La raíz continuó la captura de D03–D05, Q01–Q03, G07–G09 y B04–B05 y realizó [QA real del prototipo](../qa/2026-10-22-sarin-admin-prototype-browser.md). Esa prueba comprueba recorridos de una demo, sin cambiar el estado implementado del producto.

| Regla | Aplicación concreta a Sarin |
| --- | --- |
| Resumen antes del editor | Mostrar en la página el estado guardado y dos o tres datos relevantes. Editar abre una tarea breve; las dependencias avanzadas aparecen a petición. No repetir todos los campos dentro de cada tarjeta. |
| Regla global frente a excepción | Explicar de dónde viene el valor y qué cambia al personalizar. No habilitar excepciones de sede si el producto solo soporta un negocio; conservar esa referencia para después. |
| Plazo con ejemplo | S08 diferencia reservar con antelación de cambiar una cita existente. Mostrar un ejemplo con fecha y hora Colombia, y en revisión explicar que las condiciones de las citas previas se conservan. |
| Etiqueta visual frente a acción | Color e icono no autorizan una transición. Cancelar, registrar resultado y quitar una marca errónea son acciones con revisión/resultado definidos, no un desplegable universal sin explicación. |
| Retirar un resultado no declara asistencia | La acción se denomina Quitar resultado / Pendiente de registrar y explica que conserva el historial. No usar Confirmar de nuevo ni un aviso de nueva reserva. La tarea espera a la composición S12. |
| Definición junto al segmento | Cita, venta y visita son hechos distintos. Los filtros futuros deben decir qué fecha/estado/cobertura usan; un conteo en pantalla no promete una audiencia idéntica al enviar. |
| Conversación con ámbito comprensible | Antes de compartir un nuevo hilo con el negocio, explicar quién puede leer/responder, qué hace el bot y cómo se solicita una persona. No importar historial privado anterior por activar la función. |
| Disponibilidad comercial separada de capacidad | Activo, en prueba, incluido, pendiente de requisitos y Próximamente necesitan textos diferentes. No añadir precio, contrato o proveedor a una función Sarin por copiar una ficha de Fresha. |
| Salida conserva o descarta con precisión | Atrás conserva el borrador; cerrar con cambios ofrece salir sin guardar. Si una escritura ya se envió y su resultado es incierto, cerrar no equivale a cancelarla y no libera otro comando. |

La demo se inspeccionó en 1280, 390 y 320 píxeles y se comprobaron Atrás, revisión, reprogramación/cancelación sintéticas, FAQ con Enter/Tab y recuperación de estados. Zoom real al 200 %, lector de pantalla completo y todos los controles solo con teclado siguen pendientes. Esos límites deben permanecer visibles en la aceptación futura de cada entrega.
