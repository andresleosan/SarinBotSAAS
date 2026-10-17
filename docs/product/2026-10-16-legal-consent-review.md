# Revisión de aceptación y tratamiento de datos — 16 de octubre de 2026

**Estado:** revisión de fuentes y control técnico **implementado y verificado localmente** tras la continuación del propietario. Los textos son borradores locales pendientes de cerrar conservación, contratos/roles de proveedores y datos de cada establecimiento antes de publicar este incremento. No constituye aprobación de cumplimiento ni descripción de una función ya publicada. [Plan ejecutado](../superpowers/plans/2026-10-16-consent.md) y [evidencia](../qa/2026-10-16-consent-acceptance.md).

## Identidad y situación comprobada

El propietario pidió identificar a **ALS Dev Studio** como responsable de Sarin, confirmó **alsdevstudio@alsdevstudio.com** y remitió a su política existente para completar los datos de contacto. Se contrastaron directamente en Chrome el 16 de octubre de 2026 y se incorporaron a la página local de privacidad:

- Nombre comercial: **ALS Dev Studio**; titular identificado en la política: **Andrés Leonardo Santiago González, persona natural**.
- NIT publicado: **7005674733**.
- Dirección publicada, conservada tal como aparece: **Carrera 34 Calle 38 # 38, Medellín, Colombia**.
- Teléfono: **+57 314 643 2135**.
- Correo: **alsdevstudio@alsdevstudio.com**.

Fuente: [política pública de ALS](https://www.alsdevstudio.com/privacidad). Es información declarada en esa web, no una verificación registral. Sarin mantiene el nombre comercial solicitado y la identificación de su titular sin presentarlo como una sociedad distinta. No se copia automáticamente la política de un portafolio sin cuentas a una plataforma de citas con IA; los tratamientos, conservación y proveedores de Sarin deben describirse según su operación propia.

La [página local de privacidad](../../src/app/privacidad/page.tsx) identifica a ALS Dev Studio, explica autenticación, reservas, comprobantes y logos, y distingue Ollama de las API externas configurables DeepSeek/Gemini. Declara que no hay borrado automático general por antigüedad y que la política formal de conservación sigue pendiente. Cancelar una cita conserva su registro. Ahora también describe las constancias y su retirada; los textos públicos y sus snapshots usan la [misma fuente versionada](../../src/lib/legal.ts). La publicación de información por sí sola no equivale a recoger autorización.

## Qué exige la normativa y qué se recomienda

- Salvo una excepción legal aplicable, el tratamiento necesita autorización previa e informada que pueda consultarse después. Al solicitarla deben explicarse tratamiento y finalidad, derechos, carácter facultativo de respuestas sensibles e identidad y contacto del responsable. Debe conservarse prueba y entregarse copia cuando corresponda. [Ley 1581 de 2012, arts. 9 y 12](https://www.cancilleria.gov.co/normograma/compilacion/docs/ley_1581_2012.htm).
- La autorización debe solicitarse, como máximo, al recoger los datos. Puede manifestarse por escrito, oralmente o mediante conducta inequívoca; el silencio no basta. El Decreto 1377 de 2013, arts. 5, 7 y 8, está compilado en el [Decreto 1074 de 2015, arts. 2.2.2.25.2.2, .2.4 y .2.5](https://normativa.colpensiones.gov.co/colpens/docs/decreto_1074_2015_pr025.htm). Las dos casillas separadas son una recomendación de interfaz, no un formato literal exigido por esas normas. Publicar una política o iniciar con Google no demuestra por sí solo autorización para todas las finalidades.
- La aceptación contractual puede producirse electrónicamente. Debe distinguirse del permiso de datos, sin convertir condiciones generales en autorización ilimitada. [Ley 527 de 1999, art. 14](https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=4276).
- La política debe explicar tratamiento, derechos, procedimiento de atención y vigencia, y estar disponible para consulta. La atención manual debe respetar los plazos legales de consultas y reclamos; que la interfaz no prometa un plazo automático no elimina esa obligación. [Decreto 1074, sección 3](https://normativa.colpensiones.gov.co/colpens/docs/decreto_1074_2015_pr026.htm); [Ley 1581, arts. 14 y 15](https://www.cancilleria.gov.co/normograma/compilacion/docs/ley_1581_2012.htm).

## Dueño, cliente y roles de tratamiento

El dueño acepta el contrato de Sarin y autoriza sus propios datos de cuenta. **Su aceptación no autoriza automáticamente los datos personales de todos sus clientes.** El cliente es titular de los datos de su reserva y conversación; si interviene un representante debe verificarse su legitimación.

La distribución propuesta, pendiente de validar con la operación y los contratos, es:

| Tratamiento | Rol propuesto |
| --- | --- |
| Cuenta comercial, cobros y finalidades propias de operación de Sarin | ALS Dev Studio, responsable de las finalidades que decide. |
| Agenda y datos de clientes tratados por instrucciones del negocio | Negocio, responsable; ALS Dev Studio, encargado. Deben acordarse instrucciones, seguridad, confidencialidad, conservación y atención de derechos. |
| Datos que un proveedor trate por cuenta de otro | Revisar contrato y uso efectivo antes de calificarlo como encargado. Si determina fines propios, la clasificación puede cambiar. |

Es una aplicación propuesta de las definiciones del [art. 3 de la Ley 1581](https://www.cancilleria.gov.co/normograma/compilacion/docs/ley_1581_2012.htm), no una atribución automática de responsabilidades por usar la plataforma. El aviso del cliente debe identificar al negocio concreto y la intervención de ALS Dev Studio; el negocio debe facilitar sus contactos y política aplicable.

## Textos implementados localmente: dos casillas desmarcadas por ámbito

Hay dos decisiones independientes con enlaces visibles a `/terminos` y `/privacidad`. La autorización de cuenta sirve a clientes y dueños; la segunda incluye pagos y publicación comercial solo si la persona administra un negocio. No se pide aceptar una política o condiciones particulares inexistentes del establecimiento.

| Casilla | Alta del dueño | Cliente que inicia una reserva/chat |
| --- | --- | --- |
| **1. Condiciones contractuales** | «Acepto los Términos y condiciones de uso de Sarin, prestado por ALS Dev Studio.» | El mismo texto de condiciones de uso de Sarin. |
| **2. Autorización de datos** | Identificación y contacto para autenticación, cuenta y solicitudes; pagos y publicación de datos comerciales decididos por el dueño cuando corresponda. | Identificación, contacto, mensajes y reserva para solicitudes y citas con el negocio nombrado, mediante Sarin, según el aviso y la política. |

El aviso de cliente muestra el nombre y teléfono del negocio, su finalidad de atender citas y la intervención de ALS Dev Studio en operación, cuenta, seguridad y soporte. Explica que el chat usa IA y puede enviar mensaje/contexto al proveedor configurado, e invita a evitar datos sensibles. No afirma contratos, países, entrenamiento o retención de proveedores que no se hayan comprobado.

Las condiciones deben describir servicio, límites, precio/prueba/invitación, suspensión, soporte y cancelaciones coherentes con el producto. No incorporar renuncias de derechos, exenciones generales de responsabilidad ni aceptación de cambios de finalidad indefinidos. La publicidad o comunicaciones comerciales requieren una decisión separada y opcional, nunca incluida tácitamente en estas dos casillas ni necesaria para reservar.

## Constancia y validación implementadas en servidor

Conservar una **constancia de aceptación**, distinta de un comprobante de pago. El diseño mínimo propuesto registra cada decisión con: UID autenticado, actor dueño/cliente, negocio correspondiente, identificador y versión de cada documento, finalidades específicas versionadas, versión o huella del texto mostrado, acción afirmativa y fecha del servidor. La constancia debe poder consultarse y entregarse al titular. UID y fecha no deben confiarse al cuerpo enviado por el navegador; no es necesario guardar conversaciones o IP para este diseño mínimo.

No sobrescribir la prueba histórica al cambiar un documento: registrar cambios y revocaciones. Un cambio de finalidad exige nueva autorización cuando corresponda; renovar el texto informativo no permite ampliar silenciosamente los usos. Reintentar la misma aceptación no debe fabricar decisiones adicionales ni alterar su fecha original.

La implementación local:

1. Muestra las dos decisiones antes del acceso principal con Google. `/api/consent/preauthorize` firma una prueba anónima durante veinte minutos con fecha del servidor, sin escribir identidad ni registros anónimos en base de datos. Tras Google, `/api/consent` la vincula una sola vez al UID autenticado. Un reinicio invalida pruebas pendientes y exige repetir la decisión; no invalida constancias guardadas. El [GET de sesión](../../src/app/api/session/route.ts) es de solo lectura; el perfil se materializa al aceptar explícitamente. Existe acceso separado para consultar citas y ejercer derechos, sin aceptación automática.
2. Exige autorización de cuenta y, para el cliente, de ese UID con ese negocio. Revisa antes de admisión y de IA, dentro de la transacción de cuota y al ejecutar trabajo que estuvo en cola. Falta de constancia vigente devuelve `CONSENT_REQUIRED` antes de nueva inferencia o consumo. Cubre las funciones de dominio, además de los endpoints.
3. Revisa de forma transaccional antes de nuevas propuestas/reservas y de nuevas configuraciones, comprobantes, canjes, logos, bloqueos manuales y políticas de clientes. La creación de citas lee el estado de autorización dentro de la misma transacción; una revocación concurrente obliga a resolver el conflicto antes de guardar. No cambia las huellas de reservas anteriores.
4. Conserva lectura, cancelación, contacto de derechos y recuperación de operaciones existentes. Un reintento de aceptación antigua devuelve el estado vigente y nunca reactiva una retirada. Las constancias son privadas, descargables por su titular, y contienen textos, huellas, finalidades, acciones afirmativas y fechas del servidor. El estado usa revisión incremental; la aceptación nueva requiere la revisión y documentos vigentes.
5. Al retirar permisos, el navegador detiene lotes pendientes y nuevas confirmaciones sin borrar el historial mostrado. Una consulta de estado atrasada no reabre trabajo mientras la retirada está pendiente o es incierta; se ofrece reintentar la misma decisión. Los envíos comprueban que el token corresponda al UID que inició la acción.

Los documentos `serverSettings/consent_state_<hash>`, `consent_receipt_<hash>` y `consent_claim_<hash>` usan el contrato de almacenamiento existente; no requieren migración destructiva. La clave efímera de firma corresponde al proceso único exigido por la arquitectura. El origen público usa `SARIN_PUBLIC_BOOKING_ORIGIN`, compartido con los QR, para soportar el Host interno del gateway Pages sin confiar en cabeceras reenviadas del navegador. Estos controles no reemplazan las decisiones jurídicas y operativas siguientes.

## IA internacional y datos sensibles: decisiones pendientes

Enviar datos a un encargado que actúa por instrucciones puede ser **transmisión**; existe un régimen contractual específico. Enviar a un receptor responsable puede ser **transferencia**, sujeta al art. 26 de la Ley 1581 y sus excepciones/garantías. No afirmar que todo envío internacional está prohibido ni que una casilla genérica lo resuelve. Verificar DPA/contrato de cada proveedor, subencargados, países, finalidades propias, entrenamiento, retención y eliminación. [Decreto 1074, arts. 2.2.2.25.5.1–.5.2](https://normativa.colpensiones.gov.co/colpens/docs/decreto_1074_2015_pr026.htm); [SIC, concepto sobre transferencias internacionales de febrero de 2026](https://sedeelectronica.sic.gov.co/publicaciones/boletin-juridico/concepto/alcance-de-la-circular-002-de-2025-sobre-transferencias-internacionales-de-datos).

La SIC dispone de lineamientos específicos de datos en IA y destaca transparencia, privacidad, seguridad y responsabilidad. Informar que se interactúa con IA y minimizar datos enviados es parte de la propuesta; no basta añadir texto legal sin revisar el tratamiento real. [Circular Externa 002 de 2024](https://sedeelectronica.sic.gov.co/transparencia/normativa/circular-externa-2-de-2024-de-la-superintendencia-de-industria-y-comercio-lineamientos-sobre-el-tratamiento-de-datos); [concepto SIC de junio de 2025](https://sedeelectronica.sic.gov.co/publicaciones/boletin-juridico/concepto/el-uso-de-la-inteligencia-artificial-en-actividades-comerciales-debe-respetar-el-habeas-data).

Como valoración de riesgo, un servicio o mensaje de una cita puede revelar salud. No pedir diagnósticos ni datos clínicos innecesarios, revisar los formularios configurables y definir si se admitirán negocios de salud y reservas de menores. Si procede tratar datos sensibles, identificar cuáles, informar su carácter facultativo y obtener consentimiento explícito salvo excepción legal; las dos casillas generales no lo sustituyen. Una reserva ordinaria no acredita urgencia médica. [Decreto 1074, art. 2.2.2.25.2.3](https://normativa.colpensiones.gov.co/colpens/docs/decreto_1074_2015_pr025.htm); [criterio SIC sobre salud](https://sedeelectronica.sic.gov.co/publicaciones/boletin-juridico/concepto/tratamiento-de-datos-sensibles-relativos-la-salud).

## Pendientes antes de cerrar textos y aplicación

- Identificación y contacto de ALS completados en la versión local con la política indicada por el propietario. Recopilar además contactos y roles de cada negocio; la autorización del dueño no cubre automáticamente a todos sus clientes.
- Aprobar una política de conservación por categoría y finalidad, incluidos respaldos y proveedores, y un procedimiento de derechos con responsable de atención. La norma limita la conservación a lo razonable y necesario y contempla deberes legales/contractuales; la ausencia actual de TTL no autoriza conservación indefinida. No prometer un borrado automático o inmediato que hoy no existe. [Decreto 1074, art. 2.2.2.25.2.8](https://normativa.colpensiones.gov.co/colpens/docs/decreto_1074_2015_pr025.htm).
- Verificar contratos/DPA, países y tratamiento efectivo de proveedores; resolver salud/datos sensibles y menores antes de autorizar esos usos.
- Revisar los textos finales con asesoría jurídica pertinente antes de publicar el incremento. El control funciona localmente con datos sintéticos; no hay nueva publicación ni constancias de consentimiento atribuidas a usuarios reales por estas pruebas. No considerar a los usuarios anteriores autorizados por antigüedad o por iniciar sesión.
