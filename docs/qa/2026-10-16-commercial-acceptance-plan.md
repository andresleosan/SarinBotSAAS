# Aceptación comercial: Ollama y después DeepSeek

Fecha: 16 de octubre de 2026, America/Bogota. Este documento describe el ensayo; no acredita todavía una ejecución en producción.

## Protección mínima contra abuso

El modo cliente tendrá un límite persistente global por UID: diez intentos capaces de iniciar inferencia en sesenta segundos, sesenta en una hora y ciento veinte en veinticuatro horas, mediante ventanas deslizantes. No cambia los modos de configuración ni copiloto. Una transacción guarda como máximo ciento veinte marcas de tiempo y hashes de identificador/huella en `serverSettings/client_rate_<sha256 UID>`, dentro del almacén privado existente; no guarda IP, mensajes ni argumentos.

La comprobación ocurre después de la caché idempotente y antes de reservar respuestas o llamar al proveedor. Un 429 `CLIENT_RATE_LIMITED` no retiene capacidad comercial. La admisión sí cuenta si después falla el motor o no queda capacidad. La caché y los turnos duraderos ya completados o reservados se reconocen mediante `responseQuotaTurns` para que recuperar su resultado o estado no consuma otra admisión ni otra inferencia; un identificador con huella diferente se rechaza con 409. Los registros liberados o sin reserva duradera sí pueden volver a inferir: cada reintento cuenta otra admisión aunque repita exactamente el identificador y contenido, evitando una evasión mediante fallos repetidos del proveedor. Las marcas pueden repetir el hash de solicitud con la misma huella y siempre permanecen acotadas a ciento veinte. Las marcas antiguas se descartan al siguiente uso admitido. El documento por UID permanece, con tamaño acotado.

Esto limita frecuencia de inferencia, no verifica teléfonos ni limita por sí mismo citas futuras activas, cuentas Google múltiples o consumo agregado entre clientes de un negocio. La confirmación previa a reservar sigue dependiendo de la orquestación del modelo y debe observarse en el ensayo. No se hará una prueba de carga contra datos de clientes reales.

## Alcance y aislamiento

Origen único: `https://sarinbotsaas.pages.dev`. Primera pasada con Ollama; segunda con DeepSeek, conservando el mismo negocio QA y creando reservas diferentes. WhatsApp permanece deshabilitado y no se envían mensajes, correos ni transferencias bancarias desde la automatización. La cita existente en `sarin-pruebas-20261015` queda fuera de todas las mutaciones.

Cada UID tiene un único negocio, cuyo ID deriva del UID (`businessIdForOwner`). Hace falta un propietario Google dedicado que no sea el dueño de Sarin Pruebas, un cliente Google distinto y, preferiblemente, un tercero para probar aislamiento. El superadministrador conserva su identidad actual para revisar comprobantes y seleccionar proveedores. No se fabrican tokens Google ni se importan cuentas sintéticas al proyecto real: los botones de cuentas locales pertenecen exclusivamente al emulador.

Las pestañas del mismo perfil comparten Firebase Auth y pueden cambiar de identidad conjuntamente. Usar perfiles/almacenes de navegador separados o trabajar por roles secuencialmente mediante cerrar/iniciar sesión. Antes de cada acción verificar el rol y la identidad esperados mediante la sesión de la aplicación. Una ventana o `sessionName` nuevo no acredita aislamiento de perfiles.

Preparar un manifiesto privado fuera de Git con UUID de corrida, alias de roles, UID autorizados, negocio, slug, identificadores de solicitudes, comprobantes y nuevas citas. El informe público usa solo alias, conteos y estados. No guardar tokens, cuerpos de conversación, contactos reales, imágenes bancarias ni metadatos de sesiones en el repositorio.

Datos del negocio: nombre `ACEPTACIÓN QA <UUID>`, slug único `qa-<UUID>`, categoría «Ensayo técnico sin clientes reales», recurso `qa-room`, servicio `qa-service` de treinta minutos y margen posterior de quince minutos, precio claramente sintético de 100 COP, un campo obligatorio `reason`. Elegir una fecha futura en Colombia distinta de cualquier compromiso real y abrir únicamente el intervalo de prueba, por ejemplo 09:00–12:00. El teléfono será un número controlado por el operador; no se contactará. Nunca reutilizar un número ajeno tomado al azar. Confirmar que el slug y negocio no existen antes de crearlos.

## Preparación y condiciones de entrada

1. Registrar versión/imagen activa y un respaldo verificable D1/R2 según el runbook de datos. Las fuentes sin commit no permiten atribuir una release únicamente a una rama Git.
2. Confirmar acceso Google por los roles y lecturas de administración, negocio y facturación. El origen de QR debe ser el canónico, sin localhost ni hostname VPS.
3. Antes de la primera pasada, Ollama debe estar disponible y el Mac conectado. La salud del catálogo no acredita inferencia ni tiempo de respuesta. El Mac apagado bloquea la aceptación de Ollama; no se sustituye por DeepSeek silenciosamente.
4. El selector de IA es global: esperar cola vacía y ausencia de turnos de prueba en curso antes de cambiarlo. Desde `/admin`, guardar Ollama y comprobar la selección persistida. Tras concluir su pasada, repetir para DeepSeek; la comprobación de modelos no confirma saldo disponible.
5. Registrar la capacidad y el medidor de DeepSeek antes de probar. Acotar a un máximo de diez turnos lógicos por proveedor, con hasta cuatro llamadas al modelo por turno según `chat.ts`; detener antes si falla una verificación. No hay un corte monetario automático de USD 15 en la aplicación. El medidor muestra estimaciones, no una factura conciliada del proveedor.
6. La primera compra exige una cuenta bancaria ya configurada por el administrador. No alterar cuentas ni precios globales para acomodar el ensayo.

## Recorrido operable

| Paso | Rol, acción y endpoint observable | Resultado requerido |
| --- | --- | --- |
| Acceso | Propietario QA entra por Google y abre `/dashboard/billing`; `GET /api/session`, `GET /api/businesses` | Rol normal; ningún negocio previo para ese UID. No se cambia el negocio existente del administrador. |
| Pago pendiente | Propietario envía prueba pagada desde la UI; `POST /api/billing`, `kind:paid_trial`, solicitud nueva | 201, importe fijado por servidor en 5.000 COP, diez citas, borrador privado `pending_payment`; sin acceso a configuración ni inferencia y sin gracia inicial. |
| Revisión | Administrador abre la captura exacta del propietario QA y aprueba únicamente su ID; `GET /api/admin?receiptId=...`, `PATCH /api/admin` | Imagen privada recuperable de R2, recibo `approved`, prueba activa de diez citas sin caducidad por días y 700 respuestas. Repetir aprobación no duplica capacidad. |
| Configuración | Propietario usa la configuración asistida, confirma el resumen y guarda | Herramienta `guardar_estructura_negocio` exitosa, un negocio propio, slug permanente y proyección pública sin datos del propietario. Si se usan formularios manuales, `POST /api/businesses` verifica persistencia pero no acredita la herramienta de onboarding del modelo. |
| Publicación/QR | Propietario abre `/dashboard/qr-kit` y el enlace del QR en la sesión cliente | URL `https://sarinbotsaas.pages.dev/b/<slug-QA>`, mismo catálogo, horario y precio. La prueba pagada no habilita copiloto ni WhatsApp. |
| Consulta sin reserva | Cliente pide servicio y disponibilidad para la fecha QA, diciendo que aún no confirma | `POST /api/sarin/chat` con `mode:sarin_client` y tenant QA; herramienta `consultar_disponibilidad` consulta datos reales. No aparece ninguna cita nueva ni se consume una cita de prueba. |
| Confirmación | Cliente aporta teléfono controlado y campo `reason`, revisa resumen y confirma expresamente una hora | Una sola herramienta `crear_cita` exitosa, identidad del cliente autenticado, fecha/hora Colombia, duración y precio correctos. El margen queda después del servicio. El texto del modelo por sí solo no acredita una escritura. |
| Persistencia | Cliente recarga `/b/<slug-QA>#mis-citas`; `GET /api/businesses/<QA>/appointments?view=mine` | Una única cita propia confirmada. Propietario ve la misma cita con `?date=YYYY-MM-DD`; el tercero recibe su lista vacía, no la cita del primer cliente. |
| Calendario | Cliente cambia a Calendario, elige la fecha y descarga `.ics` | Un `VEVENT`, `DTSTART` igual a hora Colombia más cinco horas UTC, `DTEND` tras treinta minutos, sin incluir el margen. Solo se descarga, no se importa al calendario ni se envía una notificación. |
| Cancelación | Cliente pulsa Cancelar y primero Conservar cita; después confirma la cancelación | El primer paso no muta. La confirmación produce un PATCH de esa cita, estado `cancelled_by_client`, paso a Historial, desaparición de Próximas y conservación tras recargar. |
| Horario liberado | Cliente consulta otra vez disponibilidad; propietario consulta su agenda | El intervalo vuelve a estar disponible. La cancelación no devuelve la unidad de cita de prueba ya consumida. No se cancela ningún ID ajeno al manifiesto. |
| Permisos | Cliente/tercero intenta una acción administrativa o cancelar la nueva cita ajena | 403 sin cambios. Lecturas de agenda están filtradas por UID y pueden devolver 200 con lista vacía; no exigir 403 donde el contrato es filtrado. |
| Segunda pasada | Administrador espera cola cero, guarda DeepSeek; cliente repite consulta, confirmación, persistencia, `.ics` y cancelación en otra hora QA | Mismos contratos de negocio y una sola nueva cita. El medidor DeepSeek registra las rondas realmente hechas, sin errores de contabilidad silenciosos ni textos privados. El cambio de proveedor no altera pagos ni límites de citas. |

Las llamadas anteriores describen lo que se observa en la UI y la red de la sesión autenticada; no autorizan extraer tokens del navegador ni crear una herramienta que salte la autenticación. Observar cuerpos únicamente de los datos sintéticos de esta corrida.

No existe un endpoint público de reserva directa: `POST /api/businesses/<id>/appointments` crea un bloqueo del propietario. La reserva de cliente debe probar la herramienta `crear_cita` a través de la conversación real. La cancelación conversacional y la reprogramación no están implementadas; deben usarse los controles de citas.

Para la segunda pasada no se vuelve a comprar la prueba: solo se concede una por UID. Si se quiere aceptar también la herramienta de configuración de DeepSeek, editar el mismo negocio QA con los mismos valores y slug, confirmando el resumen. No crear otro negocio ni modificar uno real para esa comprobación. La cobertura del copiloto exige un plan aprobado y no forma parte de la prueba pagada mínima.

## Pago técnico frente a cobro real

Un comprobante generado y rotulado de forma inequívoca «ENSAYO TÉCNICO, SIN TRANSFERENCIA REAL» permite verificar carga, R2, permisos, revisión y activación de un negocio QA. No acredita un ingreso ni una conciliación bancaria. Debe identificarse así en el manifiesto y ser reconocido por el administrador antes de aprobarlo; nunca presentarlo como transferencia auténtica.

Para cerrar el cobro comercial, el operador realiza y concilia una transferencia real autorizada y revisa su captura. La automatización no inicia pagos. No cambiar el precio de 5.000 COP ni editar la suscripción directamente en D1 para fingir que ese recorrido pasó. Si no se hace transferencia real, el informe debe dejar «cobro/conciliación real pendiente» aunque el flujo técnico sea correcto.

## Pruebas previas y evidencia

`pnpm run test:local` y `pnpm run test:journey` solo admiten loopback y `demo-sarin-bot`: se conservan esas guardas. El journey prueba roles, pago, conflictos y limpieza con emuladores, y prohíbe endpoints de inferencia. `tests/cloudflare-data.integration.test.ts` verifica transacciones y R2 reales locales. `tests/chat-route.test.ts` usa proveedores simulados; tampoco sustituye una generación real. Las pruebas nuevas de frecuencia incluyen Workerd/D1 local y la ausencia de reserva comercial al rechazar con 429.

Registrar por paso: rol alias, versión, proveedor efectivo, estado HTTP, número de nuevas citas/recibos, latencia total y resultado observable. Para inferencias, contar turnos y llamadas al proveedor por separado. Tomar capturas con datos QA y comprobar móvil de 320 px. No registrar credenciales. Un resultado satisfactorio de salud, build o suite local no se marca como pasada de producción.

Los límites de frecuencia se verifican localmente; no agotar las 700 respuestas ni las diez citas del negocio en producción para demostrar un límite ya cubierto por pruebas de contrato. Una prueba de colisión/concurrencia se limita a dos clientes QA sobre una única hora QA si hace falta aceptación real adicional; no es una prueba de carga ni debe involucrar horarios de Sarin Pruebas.

## Pendientes mínimos de apertura y cierre del ensayo

- Completar las dos pasadas públicas con cuentas separadas; disponibilidad de Mac, credenciales y saldo de DeepSeek se verifican en su momento, no se presumen desde el código.
- Publicar información accesible de privacidad/proveedores y contacto operativo, y definir revisión/conciliación de comprobantes. El código guarda contacto, admisión y citas, y el proveedor externo recibe contexto y resultados de herramientas. Esta revisión no es una conclusión jurídica.
- La frecuencia por UID no impide saturar una agenda con reservas futuras ni verifica titularidad del teléfono. No hay máximo activo por cliente en `createAppointment`, bloqueo de clientes ni mitigación confirmada contra múltiples cuentas. Antes de tráfico abierto se necesita una política operativa y controles de reserva proporcionados; el piloto acompañado debe tener límites explícitos.
- La confirmación previa a reservar se expresa en prompt y descripción de herramienta, sin un comprobante de confirmación separado en el esquema de reserva. Si el modelo crea una cita durante una mera consulta, detener la apertura y corregirlo; no considerar la reserva exitosa como aprobación del flujo.
- Comprobar respaldo/restauración y alertas operativas/de gasto. Un Mac dormido interrumpe Ollama; no prometer servicio continuo basándose en este ensayo secuencial. La limitación por UID tampoco impone un tope a costos D1 o a múltiples identidades.
- `.ics` no sincroniza cambios: cancelar en Sarin no retira un evento que el usuario ya importó. La API aún puede cancelar una cita pasada mediante petición directa aunque la UI lo impida. Reflejar esas políticas sin adjudicar asistencia a una hora finalizada.

Al terminar, cancelar exclusivamente las nuevas citas QA confirmadas y cerrar los intervalos del negocio QA desde su configuración. Verificar que no quede inferencia pendiente ni capacidad reservada de esta corrida y registrar el proveedor final elegido por el propietario. No hay API de borrar negocio/comprobantes: conservar el manifiesto y los registros QA identificados hasta una limpieza deliberada y revisada. No ejecutar SQL de borrado ni eliminar blobs R2 por coincidencia de nombre; los objetos se deduplican por contenido y podrían compartirse.
