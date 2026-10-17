# Diseño de citas de salud y reservas con representación

Fecha: 16 de octubre de 2026. **Diseño local para revisión, no implementado ni publicado.** No acredita cumplimiento jurídico, parentesco, habilitación sanitaria ni condiciones contractuales de proveedores. No modifica producción ni autoriza borrar datos. Complementa la [revisión legal](../../product/2026-10-16-legal-consent-review.md) y la [propuesta de operación](../../product/2026-10-16-pilot-operation.md).

**Seguimiento:** el propietario aprobó expresamente este diseño y solicitó preparar el [plan de implementación](../plans/2026-10-16-health-and-represented-booking.md). El plan está preparado para revisar, conservando la ejecución directa ya elegida; no se ha iniciado la implementación de este flujo.

## Propósito, decisión recibida y límites

El propietario pidió que se eligieran casos reales. Se seleccionaron: **adulto que reserva para sí; adulto representante que reserva un corte para un niño; padre, madre o representante legal que reserva pediatría**. El alcance es agenda: servicio, profesional/recurso, horario, contacto y confirmación. Sarin no recoge historia clínica, síntomas, diagnósticos, imágenes clínicas ni consentimiento para procedimientos médicos.

No recoger historia clínica no convierte automáticamente una cita de salud en un dato ordinario. La relación entre persona, establecimiento y servicio puede revelar salud; este diseño trata las citas clasificadas de salud como sensibles. No se prohíben genéricamente las reservas para menores. Tampoco se habilita en esta entrega el acceso directo de menores, la reserva por cualquier acompañante o la representación de adultos: necesitan decisiones distintas.

Se recomienda separar reservante y beneficiario dentro del contrato actual de citas, sin crear un registro de pacientes. Guardar el niño en un campo libre mantendría ambigüedad sobre identidad y autorización; construir expedientes familiares o clínicos excedería la necesidad de agendar. El formulario estructurado resuelve esta necesidad con menos datos.

## Base normativa y decisiones de producto

Estas son referencias oficiales consultadas; las reglas técnicas posteriores son decisiones propuestas, no citas literales de la ley:

- La [Ley 1581, arts. 5, 6, 9 y 12](https://www.cancilleria.gov.co/normograma/compilacion/docs/ley_1581_2012.htm) distingue datos sensibles, autorización explícita, información previa y prueba. Una reserva ordinaria no acredita la excepción de urgencia médica. La [SIC explica su alcance](https://sedeelectronica.sic.gov.co/publicaciones/boletin-juridico/concepto/tratamiento-de-datos-sensibles-relativos-la-salud).
- La [Corte Constitucional, C-748/2011](https://www.corteconstitucional.gov.co/relatoria/2011/c-748-11.htm), condiciona el tratamiento de datos de menores al interés superior y respeto de sus derechos, sin una prohibición absoluta por naturaleza del dato. El [Decreto 1074, arts. 2.2.2.25.2.3 y .2.9](https://normativa.colpensiones.gov.co/colpens/docs/decreto_1074_2015_pr025.htm), desarrolla información sobre datos sensibles y autorización del representante, previa participación del menor según madurez. La [SIC reiteró ese estándar en diciembre de 2025](https://sedeelectronica.sic.gov.co/publicaciones/boletin-juridico/concepto/tratamiento-excepcional-y-autorizacion-del-representante-legal-con-interes-superior).
- La autorización para datos y la reserva no sustituyen el consentimiento informado médico. La [Resolución 309 de 2025 de Minsalud](https://www.minsalud.gov.co/sites/rid/Lists/BibliotecaDigital/RIDE/DE/DIJ/resolucion-0309-de-2025.pdf) trata autonomía progresiva, participación y decisiones en salud; ese proceso corresponde al prestador, no a una casilla de Sarin.

## Punto de partida comprobado

La implementación local de consentimiento solo distingue `account` y `business_client`; el texto autoriza «mis datos» y la constancia no identifica a otro titular ni representación ([legal.ts](../../../src/lib/legal.ts)). Esa aceptación no se reinterpreta para cubrir menores o salud.

La cita guarda en `client` UID, nombre y correo del autenticado ([bookings.ts](../../../src/lib/server/bookings.ts)); hoy no existe beneficiario separado. Los campos adicionales son hasta veinte textos de 500 caracteres, con marca de obligatorio y sin categoría jurídica ([schemas.ts](../../../src/lib/server/schemas.ts)). El formulario los recoge al confirmar. El modelo recibe mensaje libre, selección y configuración del negocio ([prompts.ts](../../../src/lib/sarin/prompts.ts)); un aviso no impide que alguien escriba datos sensibles.

Las propuestas ya vinculan negocio, actor, selección y catálogo; duran diez minutos y una confirmación repetida recupera la cita existente ([booking-proposals.ts](../../../src/lib/server/booking-proposals.ts)). Se conserva ese comportamiento, así como historial, cancelación, aislamiento por UID/negocio y cuotas.

## Contratos mínimos propuestos

| Elemento | Decisión |
| --- | --- |
| Reservante | `client.uid/name/email/phone` conserva su significado operativo de cuenta que gestiona la reserva. El servidor lo obtiene de la identidad autenticada; no se reemplaza por un nombre escrito en el chat. |
| Beneficiario | Añadir `beneficiary` opcional, versión 1, con `kind: self | represented_minor`. En `self` no duplicar datos de la cuenta. En menor, `displayName` de 1–80 caracteres tras recortar espacios, solo el nombre necesario para distinguir la cita. No crear UID, expediente familiar o perfil Google del niño. |
| Representación | Para menor: declaración `parent | legal_guardian`, vinculada al UID reservante y a esa reserva. No presentar la declaración como parentesco verificado. «Acompañante» no concede automáticamente facultad de autorizar datos. |
| Clasificación del negocio | Política privada versionada con `dataMode: general | health` y `representedMinorsEnabled`. La revisión de incorporación decide su configuración; si hay servicios de salud, todo el recorrido de reserva del negocio utiliza el modo estructurado de salud. No clasificar por palabras del mensaje ni cambiar de proveedor automáticamente. |
| Revisión | Estado separado de la cita: `declared | reviewed | needs_contact`, con autor/fecha cuando el negocio revise. `reviewed` significa revisión humana realizada, sin certificar identidad o parentesco infalibles. No convertir esa marca en consentimiento médico. |
| Constancia específica | Nuevo ámbito propuesto `booking_subject`, vinculado a UID, negocio y `bookingRequestId` único. Contiene tipo de beneficiario, clase de datos, calidad declarada, finalidades, textos/huellas versionados, decisiones y fecha del servidor. No contiene síntomas ni documentos de identidad. |

La política ausente significa **capacidad nueva no habilitada**, no «negocio revisado». La activación de salud/menores exige clasificación manual y comprobar las condiciones operativas de ese negocio. Las reglas no existen todavía en producción.

Para el primer alcance no pedir fecha de nacimiento, identificación, foto del adulto, registro civil ni pruebas de tutela universales. Si un prestador necesita edad u otro dato para asignar un servicio concreto, debe justificarlo y revisarse esa ampliación antes de añadir el campo. No aprovechar los campos libres para introducirla silenciosamente.

### Autorización específica y representación proporcionada

Mantener condiciones y autorización de cuenta/negocio. Antes de recoger datos del beneficiario representado o persistir una selección de salud, mostrar el aviso específico y registrar decisiones afirmativas separadas según el caso:

- **Menor:** «Declaro que actúo como padre, madre o representante legal del menor para quien gestiono esta reserva. Autorizo los datos mínimos indicados para agendar y gestionar esta cita con [negocio], conforme al aviso». Explicar que deben respetarse sus derechos y ser informado/escuchado de manera adecuada a su madurez; no exigir una casilla al niño como prueba automática de ese proceso.
- **Salud:** «Autorizo expresamente el tratamiento de los datos de esta reserva que pueden revelar información de salud, para agendar y gestionar la cita con [prestador], conforme al aviso». Identificar datos y destinatarios, carácter facultativo y canal alternativo; no autorizar diagnóstico, entrenamiento o finalidades futuras indeterminadas.

En pediatría concurren ambas decisiones; en corte infantil solo la correspondiente al menor, salvo datos sensibles adicionales que este alcance no recoge. El adulto que reserva salud para sí autoriza sus propios datos sensibles. Los textos son borradores: deben completarse con la identidad y funciones reales del negocio y ALS.

Google acredita la cuenta, no edad, parentesco o tutela. En la incorporación, cada negocio debe definir controles proporcionados para identificar al autorizante y gestionar dudas antes de recoger o divulgar datos adicionales. Para esta agenda mínima se conserva la declaración y se habilita contacto/revisión humana, sin denominarla verificación documental. Una declaración falsa no crea una autorización válida; el responsable debe valorar si esos controles bastan para su caso. La revisión posterior no convierte retroactivamente una recogida indebida en autorizada.

No exigir nueva aceptación para consultar/cancelar citas existentes ni ejercer derechos. La representación discutida requiere revisión del negocio antes de entregar datos a otra cuenta; no existe acceso familiar automático por compartir nombre o teléfono.

## Flujo y límites de IA

1. El catálogo público permite conocer negocio, servicios y contacto. El cliente elige «Para mí» o «Para un menor a quien represento». Mostrar avisos antes de recoger datos representados o sensibles; las decisiones aún no aceptadas no se infieren del inicio de sesión.
2. El formulario genera `bookingRequestId`. La autorización específica se recoge para ese caso y registra en servidor antes del formulario de beneficiario. Una misma referencia representa una reserva y un beneficiario; no sirve como permiso general para otros hijos o citas. La constancia puede identificar el caso por esa referencia sin recoger primero el nombre del niño.
3. Para menor o negocio de salud se usa selección estructurada de servicio, recurso, día y hora, contacto del adulto y, si corresponde, nombre breve del beneficiario. **No hay llamada de IA en ese recorrido ni campo de texto clínico.** El adulto que reserva para sí en un negocio general conserva el chat existente.
4. Proponer un POST nuevo `/api/businesses/[id]/booking-proposals` con selección estructurada y `requestId`, reutilizando el dominio actual de propuestas y disponibilidad. El servidor valida política, cuenta/negocio y autorización específica aplicable; no acepta UID ni sensibilidad declarados libremente por el cliente. El catálogo y la política determinan el requisito.
5. La confirmación existente incorpora beneficiario y referencia de constancia. En una transacción verifica actor, negocio, política vigente, alcance/estado de autorización y selección antes de guardar cita, enlace de constancia y consumo. Vincula la constancia a esa operación. Si cambian beneficiario, calidad o finalidad, se recoge otra decisión; no se sobrescribe la anterior.
6. Mostrar «Reserva gestionada por [adulto]» y beneficiario cuando corresponda; una cita guardada confirma el horario, sin afirmar parentesco o autorización médica. El negocio revisa dudas por su canal habitual. `needs_contact` es una señal de revisión, no otro estado de disponibilidad ni una segunda reserva.

El backend debe impedir saltar el formulario enviando chat directamente: para negocios clasificados de salud, rechazar chat con instrucciones de usar reserva estructurada antes de proveedor, admisión o cuota. En negocios generales, no existe detección infalible de datos sensibles escritos espontáneamente; el recorrido de menor no usa el endpoint de chat y su interfaz no ofrece texto libre. No prometer que el aviso filtra todos los mensajes posibles.

No enviar beneficiario, representación o respuestas del formulario a prompts, herramientas del modelo, telemetría ni nombres de archivos. Los metadatos de servicio y mensajes libres también pueden revelar salud; por eso este diseño evita toda IA en el negocio clasificado de salud. Esto no cambia el proveedor seleccionado para otros negocios.

Si falta autorización, hay dudas de representación o no funciona Sarin, mostrar contacto directo del negocio para gestionar la cita por su procedimiento, sin IA ni promesa de guardar automáticamente una reserva. No convertir la negativa a un tratamiento opcional en negación de atención sanitaria.

## Persistencia, compatibilidad y amenazas

Usar JSON simple y las transacciones compartidas D1/Firestore. Política y constancias privadas pueden mantenerse en documentos planos `serverSettings` ya permitidos por [el protocolo](../../../shared/data-protocol.ts), con claves hash acotadas y sin nuevas colecciones públicas. La revisión de representación y los datos de beneficiario se conservan solo en la cita privada; nunca en `publicBusinesses`.

Las constancias específicas usan revisión/CAS y recibos inmutables, siguiendo el contrato local de consentimiento. Un reintento conserva fecha y decisión originales; la repetición de un `accept` antiguo no revierte una revocación. La validación transaccional de una reserva nueva debe competir con la revocación sobre los mismos documentos. No se promete cancelar una operación ya confirmada por revocar después.

Las propuestas nuevas que vinculen política y autorización específica usarán versión 2. El lector conservará versión 1 para recuperar confirmaciones históricas; una propuesta antigua pendiente no elude los requisitos nuevos y deberá renovarse si corresponden a su caso. No reabrir reservas con una versión anterior de la aplicación que ignore estos contratos; conservar las lecturas de historial y las vías operativas de cancelación durante la reversión.

| Amenaza o regresión | Invariante y comprobación futura |
| --- | --- |
| Adulto distinto, otro negocio o referencia reutilizada | Vincular constancia/propuesta/cita a UID y negocio; rechazar cruces y payload alterado. |
| Casilla o clasificación manipulada en API | Exigir constancia verificable y política del servidor; prueba de acceso directo sin decisiones o con versión antigua. |
| Doble confirmación o revocación concurrente | Una cita/un consumo; prueba concurrente D1 y Firestore. Revocación previa impide operación nueva; replay solo recupera una cita guardada. |
| Historial antiguo interpretado como representación | `beneficiary` ausente sigue siendo registro legado, sin inferir edad, destinatario o permiso sensible. No migrar automáticamente ni reescribir constancias. |
| Cambio de política/catálogo tras propuesta | Invalidar nueva confirmación incompatible y pedir revisión/decisión correspondiente; conservar recuperación de operaciones confirmadas. |
| Fuga a IA, proyección pública, imagen descargada o logs | Pruebas con marcadores sintéticos en beneficiario/formulario: cero solicitudes al proveedor en estos recorridos y ausencia en salidas públicas/telemetría. La tarjeta descargable omite por defecto beneficiario menor y representación. |
| Cuotas alteradas por identidad del beneficiario | Mantener identidad de acceso y límites por reservante; no crear cuentas infantiles para sortearlos. Cancelar no devuelve cupos; lectura y cancelación siguen disponibles. |

No añadir por defecto preguntas abiertas al recorrido nuevo; la lista de campos admitidos se valida también en servidor. Los campos legados de texto no se convierten automáticamente en formulario apto para salud/menores: deben revisarse antes de habilitar esas capacidades. Los bloqueos de horario manuales no se convierten en expedientes o citas clínicas.

## Etapas y condiciones de publicación

1. **Revisión del diseño:** confirmar contratos y separación de responsabilidades con los casos elegidos. Preparar después un plan acotado; este archivo no comienza implementación ni constituye aprobación de la publicación.
2. **Implementación local:** beneficiario opcional, política revisada, constancia específica y recorrido estructurado; pruebas sintéticas de los tres casos, carrera/replay, ausencia de IA y conservación de historial/cancelación. Aprovechar `booking-proposals.test.ts`, `bookings.test.ts`, `consent.test.ts`, pruebas de rutas y `firestore.integration.test.ts`, comprobando sus fixtures al planificar.
3. **Preparación de un negocio de cada caso:** identificar responsable y contactos, revisar formularios/representación y acordar instrucciones, acceso de personal y atención de derechos. No usar datos reales de niños o pacientes como fixtures de aceptación.
4. **Publicación separada:** validar contratos y tratamiento efectivo de Cloudflare/Firebase y proveedores que reciban datos, países y conservación por categoría, respaldos incluidos. El recorrido sin IA evita esa transmisión al modelo, pero no elimina el tratamiento en Auth/D1/R2 ni resuelve por sí solo las obligaciones. La [incertidumbre contractual de DeepSeek API](https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html) sigue documentada para sus usos; no se cambia automáticamente de proveedor ni se afirma entrenamiento o exclusión sin evidencia.

La conservación y supresión de datos sensibles/representados y constancias necesita una política operativa aprobada; no se hereda una duración clínica ni se inventa TTL. Resolver estos puntos determina qué puede prometerse y habilitarse con datos reales; permite desarrollar localmente con datos sintéticos, sin presentar este diseño como dictamen jurídico concluyente.
