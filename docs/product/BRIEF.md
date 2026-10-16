# Piloto comercial de Sarin

Diseño de producto del 16 de octubre de 2026. El propietario aprobó el piloto y la inclusión del logo y la tarjeta autogestionados antes de abrirlo mediante su respuesta «1 y 2» a las opciones presentadas. El objetivo es incorporar pronto a los primeros negocios interesados, controlar las pruebas regaladas y convertirlas en negocios que reciben citas y contratan un plan. Las propuestas y la evidencia de diseño originales se conservan abajo; el seguimiento posterior distingue implementación local de funciones publicadas.

## Decisiones expresas del propietario

- El paquete de prueba cuesta **5.000 pesos colombianos**. Los códigos de invitación deben **regalar esa prueba** a los invitados.
- El administrador debe generar los códigos y saber quién los canjea.
- Cada negocio debe poder usar su logo y exportar una tarjeta de reservas con QR, nombre, teléfono y redes sociales.
- El propietario eligió **A / Agenda clara** («usemos la A») como plantilla del primer piloto. B y C se conservan como referencias; no se implementa un selector de estilos antes de lanzar.
- Los precios de la landing deben seguir los cambios guardados en administración.
- Sarin debe atender la operación del negocio, con protección frente a registros y conversaciones abusivos.
- La idea de marketplace se conserva para cuando haya al menos diez negocios registrados. No se muestra ni activa en la producción actual.
- La prioridad es empezar a operar y producir ingresos. DeepSeek está autorizado para pruebas cuando sean necesarias.

## Seguimiento de implementación local — 16 de octubre de 2026

La ejecución fue autorizada y se realiza en el worktree separado `commercial-pilot`. La candidata de runtime es `ecec028`, con los cuatro incrementos y recuperación de logos. **No se ha publicado este incremento ni cambiado datos, tarifas o configuración de producción.** Los apartados siguientes conservan el contexto de diseño inicial; su redacción en futuro no describe el estado local de esta sección.

- **Invitaciones:** emisión/canje/trazabilidad y suspensión/reactivación implementados. El recorrido sintético concede diez citas y 700 respuestas sin comprobante; cancelar y reactivar conserva el consumo, observado en 1/10 citas y 3/700 respuestas.
- **Tarifas:** oferta pública y validación de cotizaciones implementadas. Una landing local abierta pasó de 65.000 a 68.000 COP sin recarga; no es un cambio de precios reales.
- **Identidad:** logo validado del propietario, contactos públicos y tarjeta autogestionada **A / Agenda clara** implementados. PDF/PNG/SVG descargados y QR local decodificado; revisión a 320 px sin desbordamiento. B/C son referencias y no hay selector. La impresión física queda pendiente.
- **Protección de operación:** política de cliente y límite inicial de tres futuras activas con excepción del propietario, admisión persistente antes de cola, estado estructurado de servidor, respuestas por plantilla y confirmación explícita de propuestas implementados. Se conservan citas históricas y consumo. El presupuesto de tokens/costo también está implementado, pero **`PILOT_AI_BUDGET_ENFORCED=false`** permanece sin activar; activación/configuración se preparan juntas bajo mantenimiento en un release posterior.

La evidencia incluye dos contratos D1 reales locales para prueba pagada/cortesía con cinco citas históricas preservadas, 97 comprobaciones del recorrido y limpieza del runner, y 23 pruebas Firestore. Chrome utilizó un motor fixture en loopback. Por separado, ocho llamadas DeepSeek sintéticas en memoria dieron **6/8 clasificaciones esperadas**; dos `clarify` quedaron dentro del contrato comercial. La respuesta fija de ambas ramas tiene regresión determinista, sin nueva repetición pagada ni afirmación de clasificador 8/8 perfecto.

Verificados: **783 pruebas de aplicación aprobadas/25 omitidas**, tipos, builds de aplicación/landing/Pages, 72 Worker, 25 gateway, auditoría sin vulnerabilidades y 21 pruebas de recuperación. Imagen Linux construida desde la revisión exacta y smoke sin red correcto. El respaldo preliminar de producción solo lectura se restauró localmente: revisión 33, 48 documentos y un objeto R2. La [aceptación conjunta y manifiesto](../qa/2026-10-16-commercial-pilot-acceptance.md) registran los resultados y sus límites. Véanse también [protecciones](../qa/2026-10-16-pilot-abuse-controls.md) y [branding](../qa/2026-10-16-business-branding.md).

**Límites del alcance:** IP/red y Turnstile no están implementados; se conserva la revisión humana ante multicuentas, sin equiparar una IP o nombre parecido con fraude. WhatsApp y marketplace siguen deshabilitados. Llegar a **diez negocios registrados reales** permite una **revisión manual del marketplace**, no una activación automática ni una capacidad simultánea acreditada.

Producción queda pendiente de confirmación concreta y ejecución del respaldo final después del drenaje, configuración/activación del presupuesto y rollout verificado bajo mantenimiento. También permanecen pendientes el ensayo bancario auténtico, condiciones de devolución/conservación, impresión física y observación con negocios reales. La aceptación local no los sustituye.

## Base existente

La prueba actual concede diez citas y 700 respuestas totales, sin vencimiento por días. Se activa al aprobar un comprobante; cancelar una cita no devuelve unidades. La invitación debe conceder esa misma capacidad sin exigir un comprobante y sin registrar ingresos ficticios. Fuentes: [contrato de prueba](../paid-trial.md), [constantes](../../src/lib/paid-trial.ts), [facturación](../../src/lib/server/billing.ts).

La aplicación ya tiene una versión publicada en Cloudflare. La [aceptación comercial](../qa/2026-10-16-commercial-e2e.md) acredita reservas y cancelación; la entrega posterior añade [imagen PNG de la cita](../qa/2026-10-16-appointment-image.md). En esta revisión, el 16 de octubre a las 16:52 de Colombia, portada, ayuda y privacidad devolvieron HTTP 200 y la API de sesión anónima devolvió 401. Esa comprobación HTTP no repite el recorrido autenticado ni prueba capacidad simultánea.

Ya hay límite persistente para el chat de clientes: diez admisiones por minuto, sesenta por hora y ciento veinte por 24 horas, por UID global entre negocios. No se debe presentar esta mejora existente como trabajo nuevo. Todavía faltan protección entre cuentas, límites colectivos y un control temático más fuerte. Fuentes: [limitador](../../src/lib/server/inference-rate-limit.ts), [chat](../../src/lib/server/chat.ts).

## Invitaciones gratuitas

### Experiencia propuesta

En administración, añadir una sección **Invitaciones** con crear, copiar, consultar y revocar. Cada fila muestra destinatario, estado, vencimiento del código, quién lo canjeó, negocio creado, fecha de activación y consumo de citas/respuestas. El valor completo se muestra al generarlo; después se conserva una referencia enmascarada.

El alta ofrece dos caminos: pagar la prueba de 5.000 COP o **Tengo un código de invitación**. El canje exige sesión Google y validación en el servidor. Al tener éxito se habilita la configuración del negocio y se informa claramente: **Prueba de cortesía: diez citas y 700 respuestas; sin cobro**. Una cuenta puede registrarse como cliente sin recibir por ello una prueba comercial.

Recomiendo códigos individuales de un uso, asociados al correo del invitado. Así el administrador elige a la persona que puede utilizarlos. Un código compartido sin destinatario no garantiza quién lo canjeará. El vencimiento sugerido para el código es siete días, configurable antes de emitirlo; no cambia la duración sin límite de días de una prueba ya activada.

### Reglas de datos y acceso

- Generación aleatoria criptográfica; guardar hash del código, creador, destinatario, fechas y estado. No guardar el código completo en logs ni URLs analíticas.
- Canje atómico: dos solicitudes concurrentes no pueden gastar el mismo código. Repetir una solicitud exitosa recupera el resultado, sin duplicar la concesión.
- Guardar el origen privado de la prueba como invitación. Reutilizar los contadores comerciales existentes; no fabricar un pago aprobado ni un `paymentId`.
- No conceder una segunda prueba ni reiniciar contadores a un negocio que ya disfrutó de ella. Un plan activo no se reemplaza por una cortesía. Los comprobantes pendientes requieren resolver su estado de forma explícita.
- Distinguir **Revocar código sin usar** de **Suspender acceso de cortesía**. La segunda acción requiere motivo, conserva datos y no suspende un plan pagado posterior. El administrador puede reactivar una cortesía suspendida sin reiniciar su consumo.
- Validar rol administrativo en el servidor para emitir, ver destinatarios o suspender. Las proyecciones públicas no muestran códigos, correos ni referencias privadas.
- Integrar el modelo con la abstracción D1/Firestore y su [allowlist de colecciones](../../shared/data-protocol.ts). No diseñar una solución exclusiva de Firestore para el runtime actual D1.

Aceptación: invitado correcto y código vigente activan una sola prueba; otra cuenta, código vencido/revocado y segundo canje se rechazan; una carrera de canje produce una concesión; al agotarse diez citas o 700 respuestas se conserva el contrato existente; una revocación no borra citas ni modifica pagos.

## Precios administrables en la landing

La desincronización está confirmada: [administración](../../src/app/admin/page.tsx) guarda tarifas en `platformSettings/main`, [facturación](../../src/lib/server/billing.ts) las consulta y [MarketingHome](../../src/components/marketing-home.tsx) muestra constantes `defaultPriceCOP`. La landing usa exportación estática.

Crear una lectura pública de la **oferta comercial** con proyección explícita: identificador de oferta, precio COP, vigencia, respuestas incluidas y disponibilidad comercial. No volver anónima `/api/billing`, que incluye ajustes privados. Landing y facturación deben usar el mismo cálculo de oferta vigente.

La landing estática consulta esa oferta al cargar. Después de guardar en administración, una nueva lectura debe mostrar el precio nuevo sin republicar. Si se usa caché, definir una caducidad máxima visible en las pruebas; objetivo propuesto de actualización: menos de un minuto. Ante error de lectura se ofrece reintentar o consultar el precio, sin anunciar una constante antigua como tarifa vigente. El servidor vuelve a validar el importe al crear un comprobante; un cambio no reescribe pagos anteriores. Si cambia durante el checkout, pedir revisar el importe nuevo antes de enviarlo.

Los precios de planes y ampliaciones actualmente editables entran en este contrato. El precio de prueba de 5.000 COP sigue siendo la oferta fija actual; hacerlo editable sería una decisión adicional. WhatsApp debe permanecer fuera de la oferta disponible mientras no tenga un número real aceptado.

Aceptación: cambiar una tarifa en administración se refleja en landing y nuevo comprobante; no se filtran cuentas bancarias ni ajustes privados; una caída de API, una tarifa inválida y un checkout con precio anterior tienen resultados controlados.

## Identidad y tarjeta del negocio

Separar la cuenta personal Google de la identidad comercial. El logo del negocio aparece en su configuración, página de reservas y material QR. No hace falta cambiar la foto Google para conseguir ese resultado; una foto personal cargable sería otra capacidad.

Añadir logo opcional, teléfono público y enlaces sociales validados. Recomiendo JPEG/PNG/WebP, máximo de entrada propuesto 2 MB y normalización a imagen cuadrada de hasta 512 px, con validación de contenido en servidor. El propietario solo cambia imágenes de su negocio. Las imágenes públicas no reutilizan las rutas de comprobantes privados de R2.

El [kit QR actual](../../src/app/dashboard/qr-kit/page.tsx) descarga solo el código SVG. Ampliarlo con vista previa y exportación de la composición completa: PDF para imprimir, PNG para compartir y SVG del QR. El QR contiene únicamente el enlace permanente de reservas; teléfono y redes se muestran en la tarjeta y en el perfil. Actualizar el teléfono o logo no debe obligar a cambiar el QR impreso. Conservar el slug y prever el dominio canónico antes de imprimir una tirada real.

El propietario eligió **A / Agenda clara** de las [opciones de tarjeta A6](../design/2026-10-16-qr-cards/README.md) para el primer piloto. La app generará esa plantilla con los datos de cada negocio, sin selector de estilos; B y C permanecen como referencias. Los archivos entregados son muestras con negocio y contacto sintéticos y QR a `https://example.com/reservar`: sustituirlo por el enlace real y probarlo físicamente antes de usarlos con clientes. La marca del negocio tiene prioridad; Sarin queda como firma discreta.

## Protección de uso

### Registros y cuentas

Una IP compartida no identifica a una persona: varios negocios pueden usar la misma red o el mismo operador móvil. Usarla para detectar ráfagas y solicitar revisión, no para prohibir automáticamente el segundo negocio. El nombre parecido es otra señal; no prueba fraude.

Para el piloto, combinar invitación individual, una prueba por identidad comercial revisada, control de comprobantes repetidos y revisión administrativa. Después añadir límites persistentes de altas/canjes por cuenta y red, desafío ante riesgo y excepciones registradas para negocios legítimos. Obtener la IP solo del borde confiable y conservar una referencia HMAC con caducidad y finalidad definida, sin registrar conversaciones. Un desafío Turnstile necesita validación del token en servidor, `hostname` y `action` esperados; el widget por sí solo no protege el endpoint. [Documentación oficial](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/).

### Chat y reservas

El prompt actual limita Sarin al negocio, pero el servidor devuelve texto libre del modelo. Endurecer solo el prompt no garantiza el alcance. La propuesta combina:

- Intenciones permitidas para clientes: servicios, precio, ubicación, contacto, horarios, disponibilidad, reserva y gestión de sus propias citas. Para propietarios: configurar su operación y consultar su agenda/consumo. Investigación abierta, programación y ensayos generalistas quedan fuera, aunque el usuario los describa como empresariales.
- Respuesta fija fuera de alcance: **Puedo ayudarte con los servicios, horarios y citas de este negocio. ¿Qué necesitas reservar o consultar?** Ante ambigüedad, pedir una aclaración concreta. No aplicar una lista de palabras que bloquee preguntas legítimas sobre los servicios.
- Plantillas y datos del servidor para las respuestas críticas. La IA interpreta el lenguaje; el servidor autoriza herramientas, datos y cambios. Un clasificador adicional reduce riesgo, pero no constituye por sí solo una garantía.
- Historial con procedencia controlada por servidor para no confiar en turnos de asistente fabricados por el navegador.
- Propuesta de reserva guardada, resumen de servicio/precio/hora y confirmación explícita vinculada a esa propuesta, antes de ejecutar la mutación. La confirmación actual depende de una instrucción al modelo.
- Límites por usuario en todos los modos, por usuario y negocio y por negocio; admisión antes de ocupar la cola. Añadir suspensión de cliente por negocio y errores 429 con tiempo de reintento.
- Máximo configurable de citas futuras activas por cliente y negocio, comprobado transaccionalmente. Un punto de partida conservador para el piloto sería tres, con excepción manual; es una propuesta pendiente, no una regla vigente.
- Presupuesto de tokens/costo reservado antes de llamadas pagadas, con corte configurable. La bolsa comercial y las alertas de saldo actuales no son un tope monetario garantizado.

La defensa por capas y la revisión de salidas/herramientas siguen la guía de [OWASP sobre prompt injection](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html). Las reglas concretas anteriores son propuestas para Sarin.

Aceptación: una consulta generalista, instrucciones para ignorar reglas, historial manipulado, cambio de tenant, mensajes repetidos, agotamiento de presupuesto y varias reservas concurrentes no pueden saltarse las reglas del servidor. Las preguntas normales de servicios y una confirmación legítima deben seguir funcionando. Usar DeepSeek con casos sintéticos acotados cuando toque validar el modelo; no hace falta consumir inferencia para esta fase de diseño.

## Prioridad y roadmap

El usuario más afectado por una salida incompleta es el propietario que necesita recibir su primera cita y el cliente que quiere reservarla. Si el marketplace espera tres meses, el enlace y QR permiten operar. Si se retrasan acceso, tarifas claras y protección del cupo, se retrasa la validación comercial.

Se compararon un piloto acompañado con tarjetas preparadas manualmente y uno con identidad y material autogestionados. El propietario eligió combinar el acompañamiento con **logo y exportación de tarjetas dentro de la app antes de abrir el piloto**. El onboarding general por pasos puede iterarse después: incluir el kit autogestionado no incorpora automáticamente todo el rediseño de registro de Fresha.

Puntuación orientativa de 1 a 5; esfuerzo invertido significa 5 para poco trabajo. Es juicio de producto, no medición de clientes. Promedio de alcance, impacto, confianza y esfuerzo invertido:

| Iniciativa | Alcance | Impacto | Confianza | Esfuerzo invertido | Promedio |
| --- | ---: | ---: | ---: | ---: | ---: |
| Invitaciones y trazabilidad | 5 | 5 | 5 | 3 | 4,50 |
| Tarifas sincronizadas | 5 | 4 | 5 | 4 | 4,50 |
| Protección de reservas y alcance | 5 | 5 | 4 | 3 | 4,25 |
| Logo y tarjeta exportable | 4 | 4 | 5 | 3 | 4,00 |
| Onboarding progresivo | 4 | 3 | 4 | 3 | 3,50 |
| Marketplace | 2 | 3 | 2 | 1 | 2,00 |

**MVP, lanzamiento del piloto:** conservar el flujo publicado de alta comercial, reserva, agenda y cancelación. Añadir invitaciones, tarifas conectadas, protecciones de acceso/reserva y **logo y kit de tarjetas autogestionados**. El kit ofrece la plantilla **A / Agenda clara** y vista previa, sin selector de estilos ni editor gráfico libre. El propietario puede acompañar la configuración de los primeros negocios. Antes de cada publicación, respaldar, verificar la versión exacta y ejecutar los controles adecuados; este brief no autoriza una publicación adicional.

**V2, primera iteración con los negocios iniciales:** perfil explorable antes de Google, onboarding por pasos y mejoras determinadas por la operación. La recomendación es enseñar servicios y datos públicos primero y pedir acceso al confirmar; actualmente la pantalla `/b/[slug]` pide Google antes de mostrar el perfil. El logo y kit de tarjetas ya forman parte del alcance del piloto aprobado.

**V3, revisión al llegar a diez negocios registrados reales:** evaluar el [marketplace guardado](marketplace-after-ten-businesses.md). Llegar al umbral permite revisar y pilotar; no activa nada automáticamente. Reseñas, comisiones, mapa avanzado, anticipos y pagos a clientes permanecen fuera de este lanzamiento.

No se fija una fecha de apertura a partir de una lista sin ejecutar. La estimación del primer incremento debe salir de su plan de implementación y de los controles de aceptación, sin prometer disponibilidad masiva.

## Pendientes operativos que permanecen

- Conciliar un pago bancario auténtico; la aceptación existente utilizó un comprobante sintético.
- Definir condiciones de devolución y conservación de datos, con revisión apropiada antes de publicarlas.
- Integrar deliberadamente las fuentes ya publicadas en Git y pasar CI; el checkout contiene muchas modificaciones previas que deben preservarse.
- Medir uso, latencia y reservas de los primeros negocios. Los tiempos individuales de QA no constituyen una prueba de carga.
- Completar la recuperación integral y observar la renovación natural de credenciales Google. El ensayo D1/R2 no respalda por sí solo Auth, secretos y configuración.

Métricas iniciales: invitación emitida a canje, canje a configuración, configuración a primera cita, consumo por negocio, pruebas a plan pagado, consultas rechazadas por abuso y errores de reserva. Guardar eventos/contadores mínimos, sin cuerpos del chat.

## Evidencia de la revisión

Se revisaron fuentes locales y la sesión de Fresha; no había `graphify-out/graph.json`, por lo que no se reconstruyó un grafo. La extracción observada está en [seguimiento del onboarding](../qa/2026-10-16-fresha-onboarding-followup.md). En esta tarea no se modificó producto, configuración de producción ni datos comerciales, ni se ejecutó inferencia pagada. La aceptación previa se distingue de las comprobaciones realizadas hoy.
