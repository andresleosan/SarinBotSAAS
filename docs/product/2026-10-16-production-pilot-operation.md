# Operación para publicar el piloto comercial

Preparado el 16 de octubre de 2026 tras la instrucción del propietario de resolver la publicación. Este documento convierte los pendientes operativos en acciones concretas; no acredita contratos firmados, revisión jurídica, recepción de correos ni actuaciones remotas. No modifica el runtime. El resultado efectivo del push, despliegue, configuración y comprobaciones remotas debe registrarse en el informe de publicación.

La candidata técnica incluye invitaciones gratuitas, precios administrables, logo/tarjeta A, autorizaciones y límites individuales de IA, además del formulario de salud y representación. La [aceptación local](../qa/2026-10-16-health-and-represented-booking.md) identifica la imagen y sus pruebas. La publicación del código y la incorporación de datos reales de un negocio son decisiones operativas distintas: el código de salud puede estar instalado sin habilitar ese uso en ningún establecimiento.

## Alcance de la primera apertura

Iniciar con negocios acompañados de servicios generales para adultos, por ejemplo barbería, peluquería o servicio técnico. Mantener salud y reservas representadas para menores pendientes de incorporación por establecimiento. No cancelar ni borrar citas o autorizaciones existentes al acotar las operaciones nuevas.

La clasificación es una política privada por negocio, modificable por superadministración. No hay un interruptor global que desactive todos los usos de salud ni un detector fiable de la actividad del negocio. Una política ausente devuelve `general`, `representedMinorsEnabled=false`, `configured=false`; esto conserva el chat legado y **no acredita que el negocio haya sido revisado**. Para cada negocio real que se abra, registrar explícitamente `general` y menores deshabilitados, tras comprobar su actividad. No clasificar una consulta médica como general para eludir el formulario.

Los primeros accesos se controlan en los puntos operativos existentes: emisión del código dirigido a un correo Google revisado y aprobación manual del primer pago. No emitir invitaciones ni aprobar pagos de salud o reservas de menores hasta completar su ficha específica. Esta revisión es humana: la aplicación no exige todavía una ficha completa ni que todos entren por invitación. Si se encuentra un negocio sanitario ya operativo sin clasificar, cerrar la entrada pública mediante mantenimiento hasta aislarlo o completar su incorporación; no seguir enviando su chat al modelo mientras se resuelve.

## Corte y comprobaciones de apertura

Seguir el [runbook de activación y reversión](../cloudflare-no-vps-runbook.md#activación-y-reversión). Registrar cada resultado como ejecutado, fallido o pendiente, sin copiar secretos al repositorio.

- [ ] Identificar commit, imagen y revisión pública; no atribuir las funciones nuevas a una imagen anterior.
- [ ] Tomar respaldo recuperable de D1/R2 y registrar configuración e inventario de Auth por separado; comprobar qué protege cada copia.
- [ ] Activar mantenimiento, comprobar cola drenada y conservar una réplica. Mantener WhatsApp y marketplace deshabilitados.
- [ ] Inventariar negocios reales con acceso vigente. Revisar actividad, servicios, campos y contacto; registrar clasificación explícita de cada negocio que se vaya a abrir. No copiar información de clientes al informe.
- [ ] Publicar con la entrada cerrada, validar sesión superadministradora y leer configuración efectiva.
- [ ] Configurar los límites aprobados: global USD 0,50/día y USD 8/mes; por negocio USD 0,10/día y USD 2/mes. Conservar los límites de tokens. Activar y leer de vuelta la compuerta monetaria; no confundir mantenimiento con un rechazo presupuestario del motor.
- [ ] Comprobar que `/terminos`, `/privacidad` y los textos versionados coinciden; que la cuenta nueva exige decisiones desmarcadas; que retirar permisos conserva lectura, cancelación y recuperación.
- [ ] Comprobar invitación vinculada al destinatario, canje único y capacidad de diez citas/700 respuestas sin caducidad por días; no crear un canje real de otra persona para probar.
- [ ] Comprobar precios públicos y del panel con el mismo valor vigente. No modificar precios productivos solo para obtener una captura.
- [ ] Comprobar el QR de un negocio revisado y el QR secundario de ALS; el primero debe abrir su enlace permanente y el segundo `https://www.alsdevstudio.com`.
- [ ] Reabrir, comprobar las rutas públicas, acceso privado y configuración efectiva; registrar hora, revisión y observación inicial de errores y presupuestos.

La observación de IA puede comenzar sin una llamada pagada: leer proveedor, tarifa, límites y estado de compuerta. Un smoke de pago, si se necesita para acreditar el transporte real, debe ser una operación sintética delimitada con el presupuesto ya activo; no usar mensajes de pacientes, menores ni clientes para probar. Los límites de IA no son un límite de factura de alojamiento y pueden pausar nuevas reservas que dependan del chat.

## Ficha privada de incorporación por negocio

Guardar fuera de Git una ficha por ID de negocio con estos campos y estado `pendiente`, `listo para piloto` o `pausado`. No introducir clientes reales en un establecimiento todavía pendiente.

| Campo | Comprobación y evidencia mínima |
| --- | --- |
| Identidad y contacto | Nombre comercial, persona o entidad que presta el servicio, teléfono y canal de derechos; confirmar qué contacto se publica. No inferir persona jurídica por el nombre de marca. |
| Acceso | UID dueño y correo Google verificado; invitación o pago aprobado correspondiente. No guardar tokens ni contraseñas. |
| Actividad y catálogo | Revisar servicios reales, personas atendidas y campos de reserva. Marcar general/adultos, salud y/o representación de menores sin deducirlo solo por el nombre. |
| Instrucciones de operación | Finalidad de agenda/contacto, personas con acceso, soporte, proveedores efectivos y procedimiento de devolución/cierre. Registrar el acuerdo efectivo y su fecha; un checklist no lo sustituye. |
| Conservación | Categorías, finalidad, criterio/plazo acordado y responsable de ejecutar revisiones; excepciones justificadas y tratamiento de copias. No prometer TTL que no existe. |
| Derechos | Persona que atiende en ALS y en el establecimiento, canal, registro privado y procedimiento de verificación proporcionada. |
| Revisión | Fecha, revisor, política/revisión guardada en Sarin, pendientes y decisión de apertura. |

No es necesario crear un nuevo módulo para el piloto. Esta ficha privada y la clasificación existente permiten acompañar los primeros negocios; si el volumen impide revisarlos, ampliar el control de incorporación antes de automatizar aprobaciones.

## Salud y menores: habilitación posterior por establecimiento

No habilitar una casilla por el solo hecho de instalar la candidata. Cuando corresponda un caso concreto, ejecutar los pasos siguientes y conservar la evidencia privada del responsable del negocio:

1. Completar la ficha, las instrucciones y las condiciones efectivas de infraestructura/proveedores aplicables. Revisar los avisos con el negocio antes de utilizarlos con datos reales; no presentar el software como validación jurídica o habilitación sanitaria.
2. Retirar los campos libres de reserva. Para salud, guardar `dataMode=health`; para reservas representadas, activar menores únicamente después de acordar el procedimiento. Leer de vuelta revisión y capacidades. El servidor rechaza campos libres incompatibles y bloquea inferencia en salud; configurar solo la interfaz no basta.
3. Designar quién atiende dudas de representación. Para una reserva cotidiana sin señales de contradicción, comprobar el contacto del adulto y su declaración. Ante conflicto, información incoherente o duda razonable, contactar al adulto por el canal del negocio y solicitar solo la acreditación necesaria por un medio adecuado. No recopilar documentos de todos por defecto ni adjuntarlos a Sarin.
4. En la atención, el establecimiento aplica su procedimiento para informar y escuchar al menor de forma adecuada a su situación. Registrar en Sarin únicamente `revisada` o `necesita contacto`; no guardar relatos familiares, imágenes, diagnósticos o documentación en nombres, reglas, chat o notas improvisadas. Google y la marca de revisión no prueban parentesco.
5. Si la duda persiste, resolverla mediante el negocio antes de prestar el servicio y mantener la marca de contacto. La marca no cancela automáticamente una cita. Si se decide cancelar, hacerlo mediante la operación existente y comunicarlo por el procedimiento habitual del establecimiento; no inventar una cancelación automática ni reembolsos de cupo.
6. Ensayar con datos sintéticos el formulario, sus decisiones inicialmente desmarcadas, confirmación, recuperación tras pérdida de respuesta, retirada y cancelación. Confirmar que no se producen llamadas IA en salud y que el beneficiario no aparece en proyecciones públicas o imagen exportada.

Este procedimiento propuesto cubre la reserva y su administración. No es consentimiento para un procedimiento médico, historia clínica, verificación universal de tutela o sustitución de las obligaciones del prestador. Las bases jurídicas y plazos se remiten a la [revisión de fuentes existente](2026-10-16-legal-consent-review.md), sin añadir aquí conclusiones jurídicas nuevas.

## Derechos y conservación desde el primer negocio

Canal confirmado por el propietario: **alsdevstudio@alsdevstudio.com**. Antes de incorporar el primer negocio real, asignar una persona de ALS a su revisión y comprobar el acceso al buzón por su titular. No se ha enviado correo ni acreditado recepción mediante este trabajo.

Abrir un registro privado por solicitud con referencia, recepción, titular/negocio, alcance, responsable, fecha límite aplicable, actuaciones y respuesta. Aplicar los plazos y procedimiento ya documentados en [atención manual de solicitudes](2026-10-16-pilot-operation.md#atención-manual-de-solicitudes). Comprobar identidad/representación de manera proporcionada, entregar solo los datos pertinentes y coordinar con el establecimiento. Nunca entregar una exportación completa de la base a un cliente.

La retirada ya implementada detiene operaciones nuevas del ámbito y conserva citas/constancias; no equivale a supresión ni cancelación. Localizar constancias históricas manualmente cuando el caso ya no esté abierto en la UI. Las solicitudes de supresión requieren una selección revisable de registros y relaciones; no borrar primero Auth ni destruir claves de recuperación, revisiones de retirada, `closedAt`, consumos o pruebas que evitan duplicados.

Al abrir el piloto, inventariar categorías y programar una revisión operativa mensual de datos innecesarios y solicitudes pendientes. No ejecutar borrados masivos con esa periodicidad: revisar cada selección frente a la finalidad, acuerdo y obligaciones aplicables. Los números de la [propuesta de conservación](2026-10-16-pilot-operation.md#conservación-propuesta-para-decidir-antes-de-prometer-borrado) siguen siendo propuestas hasta su adopción real; un aviso que diga que están pendientes no resuelve la decisión. Documentar el criterio acordado antes de incorporar al negocio y actualizar el texto versionado si cambia lo informado.

Mantener inventario de copias propias y su rotación efectiva. Tras una restauración, reconciliar retiradas, supresiones y operaciones posteriores; no permitir que una copia antigua reactive permisos. No afirmar que eliminar D1 borra Auth, R2, exportaciones o datos de proveedores.

## Proveedores: cierre verificable sin promesas inventadas

Usar la [matriz pública ya investigada](2026-10-16-pilot-operation.md#proveedores-y-condiciones-comprobadas) como punto de partida, no como constancia de acuerdos aceptados. Registrar privadamente cuenta/servicio real, documento aplicable y fecha, tratamiento por instrucciones o fines propios, países/configuración, subproveedores, retención, eliminación y canal de asistencia. La revisión incluye Cloudflare y Firebase aun si no se activa IA; también incluye el proveedor de IA cuando se use chat general.

No afirmar cero retención, ausencia de entrenamiento, residencia colombiana ni DPA de DeepSeek que no estén acreditados. No inferir una prohibición universal solo por no encontrar esas garantías. Conservar las condiciones efectivas y resolver lo que afecte a la incorporación concreta; la solicitud de aclaración previamente redactada sigue sin enviar y debe tramitarla el titular por su canal oficial. Este documento no autoriza enviar mensajes en su nombre.

Publicar la imagen no firma contratos ni completa esas fichas. La evidencia de apertura debe distinguir lo realmente ejecutado de lo pendiente por establecimiento, manteniendo salud/menores sin incorporación real mientras falte su revisión. El siguiente hito es incorporar un primer negocio revisado y comprobar su recorrido, sin esperar a desarrollar marketplace u otras funciones nuevas.
