# Operación del primer piloto de Sarin

Propuesta preparada el 16 de octubre de 2026. Complementa la [revisión de datos](2026-10-16-legal-consent-review.md) y la [aceptación técnica](../qa/2026-10-16-consent-acceptance.md). **No es una política publicada ni una decisión del propietario.** No cambia datos, contratos, proveedores, tarifas ni límites de producción.

## Inicio acompañado

Proponer una incorporación por invitación y revisión humana para los primeros negocios. Registrar una persona de contacto, verificar el correo Google destinatario y acompañar una primera reserva. El código regala diez citas y 700 respuestas; no vence la capacidad por días. La caducidad del código sin canjear es otra cosa.

El alcance recomendado es citas de servicios generales para adultos, sin historias clínicas, diagnósticos, formularios de salud ni reservas de menores. Se solicitó la decisión del propietario; no se presenta como una restricción técnica ya aplicada. El control de preguntas empresariales no clasifica infaliblemente datos sensibles ni verifica edad. No basta escribir esta limitación en condiciones para acreditar que se impide ese tratamiento.

Para cada negocio, guardar una ficha privada fuera de Git, vinculada a su ID:

| Dato | Para qué se necesita |
| --- | --- |
| Nombre comercial y nombre de la persona/entidad responsable | Identificar quién presta el servicio y decide sobre su agenda. No confundir una marca con una sociedad. |
| Identificación tributaria, cuando corresponda | Completar su identificación; no publicar documentos personales de forma indiscriminada. |
| Dirección comercial, ciudad, teléfono y correo de derechos | Dar contacto real al cliente. Decidir expresamente qué dirección/contactos se publican. |
| UID dueño y correo Google verificado | Vincular acceso e invitación a la persona revisada. No copiar contraseñas ni tokens. |
| Actividad, servicios y campos que pide al reservar | Comprobar que son necesarios y están dentro del alcance acordado. |
| Instrucciones y acuerdo con ALS | Finalidades, confidencialidad, seguridad, conservación, proveedores, atención de derechos y devolución/eliminación al terminar. |
| Fecha de revisión y persona que la realizó | Dejar trazabilidad de la incorporación manual. |

La agenda se trata por instrucciones del negocio; ALS gestiona además cuenta, acceso, pagos y seguridad para sus propias finalidades. Esta separación debe reflejar el acuerdo real. La autorización del dueño no equivale a la de sus clientes. [Ley 1581, definiciones y deber de informar](https://www.cancilleria.gov.co/normograma/compilacion/docs/ley_1581_2012.htm).

La ficha y el acompañamiento son un procedimiento propuesto. El producto actual muestra nombre y teléfono del negocio en la autorización, pero todavía no dispone de un formulario ni de una compuerta para verificar toda esta ficha. No afirmar que la mera existencia de una invitación acredita esa revisión.

## Conservación: propuesta para decidir, antes de prometer borrado

La norma exige conservar solo durante lo razonable y necesario según finalidad y obligaciones aplicables; **no impone los siguientes números como un plazo universal**. [Decreto 1074, art. 2.2.2.25.2.8](https://normativa.colpensiones.gov.co/colpens/docs/decreto_1074_2015_pr025.htm).

| Categoría | Propuesta operativa | Condición para llevarla a una política real |
| --- | --- | --- |
| Citas terminadas/canceladas y sus datos de contacto | Revisión al cumplir **12 meses** desde la atención o cancelación; eliminar o anonimizar lo innecesario, salvo una obligación o reclamación documentada. | Acuerdo con el negocio y procedimiento probado. No afecta citas futuras ni estadísticas de consumo. Un hash enlazable sigue pudiendo ser dato personal. |
| Cuenta y configuración | Mientras exista relación activa; al solicitar cierre, revisión manual y plan de entrega/eliminación. Revisar cuentas inactivas cada **12 meses**. | No caducar por inactividad una prueba comprada o regalada sin vencimiento. Resolver citas futuras, acceso a derechos y obligaciones antes de cerrar. |
| Selección de chat y propuestas nunca confirmadas | Candidatas a limpieza tras **30 días** sin actividad/vencidas. | Probar también los índices de solicitud y reintentos. La selección vence funcionalmente a las 24 horas y la propuesta a los diez minutos, pero eso no borra los registros. |
| Propuestas confirmadas, claves de recuperación y consumo | Conservar la información mínima que impide duplicar reservas, canjes y cobros mientras pueda recuperarse la operación. | No borrar por el plazo del chat. Diseñar antes la desvinculación de datos personales sin permitir repetir operaciones. No reiniciar cupos o presupuesto al limpiar. |
| Metadatos de IA y seguridad | Revisión a los **90 días**, preservando agregados necesarios sin contenido de conversaciones. | Conciliar primero llamadas inciertas y obligaciones. Hoy las reservas monetarias inciertas no se liberan por antigüedad. Los hashes de UID no equivalen automáticamente a anonimización. |
| Pagos, comprobantes y constancias de autorización/revocación | Separar el archivo restringido del uso cotidiano. Fijar plazos por finalidad y obligación contable/contractual aplicable; no asignar un plazo único sin esa clasificación. | Determinar el plazo y su punto de inicio antes de publicar la política final; conservar prueba, sin usarla para reactivar permisos. No borrar comprobantes por el solo hecho de aprobarlos. |
| Copias de recuperación propias | Proponer una ventana ordinaria de **35 días**, con excepciones justificadas para incidentes o deberes de conservación. | Inventariar también exportaciones históricas, Firestore conservado y copias VPS. Rotación aún sin implementar; no borrar la única copia recuperable. Tras restaurar, reaplicar retiradas/eliminaciones posteriores al backup. |
| Firebase, Cloudflare y proveedor de IA | Según contrato y funcionamiento verificado de cada servicio. | No prometer que una eliminación en D1 borra Auth, R2, estados recuperables o datos del proveedor. |

Esta tabla **no activa TTL ni autoriza ejecutar supresiones**. Antes de aplicar una limpieza: inventario privado, selección de registros revisable, prueba sintética, copia recuperable, ejecución delimitada y verificación de ausencia de efectos sobre otros titulares. Un cambio de política debe modificar también la fuente legal versionada y exigir la decisión que corresponda. No sobrescribir constancias históricas.

## Atención manual de solicitudes

Canal confirmado: **alsdevstudio@alsdevstudio.com**. ALS debe asignar una persona que revise ese buzón. No se envió ningún correo ni se acreditó aquí su recepción.

1. Abrir un expediente privado con referencia, fecha de recepción, alcance, estado y fecha límite. No guardar peticiones ni datos de clientes en este repositorio.
2. Verificar proporcionalmente la identidad y, si actúa un representante, su legitimación. No entregar datos solo por conocer un correo ni pedir documentos innecesarios.
3. Distinguir cuenta ALS y agenda del negocio; coordinar su respuesta conservando trazabilidad. Si el destinatario carece de competencia, trasladar al competente dentro de dos días hábiles e informar al interesado.
4. Para consultas, atender en diez días hábiles; si procede prórroga, informar motivo y nueva fecha, hasta cinco días hábiles adicionales. Para reclamos, quince días hábiles desde el día siguiente a la recepción; prórroga motivada hasta ocho adicionales. Si falta información, requerirla en cinco días; registrar los efectos legales del expediente incompleto. Registrar la leyenda de reclamo en trámite dentro de dos días hábiles de recibirlo completo. [Ley 1581, arts. 14–15](https://www.cancilleria.gov.co/normograma/compilacion/docs/ley_1581_2012.htm).
5. Entregar solo datos del titular y su constancia; una exportación D1 completa no es una respuesta adecuada a un cliente. Revisar cita/contactos, autorizaciones, propuestas, imágenes, metadatos y Auth según el alcance.
6. Ante rectificación/supresión, documentar qué se ejecuta, qué obligación justifica conservar otra parte y durante cuánto tiempo. No eliminar primero la identidad Auth: hace falta resolver antes las relaciones e identificadores. La retirada de autorización ya disponible no equivale a eliminación.
7. Si requiere al proveedor, tramitar su cooperación con el mínimo de datos. Informar los límites reales de recuperación/copias, dejar evidencia y cerrar la solicitud con respuesta al titular. No prometer borrado inmediato universal.

## Proveedores y condiciones comprobadas

Revisión pública de fuentes oficiales; no se ha vuelto a inspeccionar el runtime remoto ni se han firmado acuerdos mediante estas consultas. La última selección remota comprobada era DeepSeek, respaldo preliminar de las 23:40 UTC del 16 de octubre, revisión 33. El código permite `deepseek-flash`; Gemini y Ollama siguen siendo alternativas configurables sin fallback automático.

| Servicio | Hecho comprobado | Trabajo concreto pendiente |
| --- | --- | --- |
| DeepSeek API | Sus términos, §3.3, asignan al desarrollador la información/base para procesar y delegar datos. El §5.5 excluye datos de usuarios finales de aplicaciones derivadas del alcance de su política general. | Obtener condiciones aplicables al API sobre entrenamiento, retención, países, eliminación y tratamiento por instrucciones. No extrapolar garantías del chat de consumo ni afirmar sin evidencia que entrenan con estos mensajes. [Términos API](https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html). |
| Cloudflare D1/R2/Containers | Existe DPA de cliente para tratamiento por instrucciones. D1 Paid ofrece recuperación Time Travel hasta 30 días; los hints no garantizan país. R2 distingue jurisdicción y hint; no borra todos los objetos por una regla implícita de siete días. | Documentar acuerdo aplicable y ubicaciones/configuración reales, reglas de objetos, logs y exportaciones propias. [DPA](https://www.cloudflare.com/cloudflare-customer-dpa/), [D1 ubicación](https://developers.cloudflare.com/d1/configuration/data-location/), [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/), [R2 ubicación](https://developers.cloudflare.com/r2/reference/data-location/), [ciclos R2](https://developers.cloudflare.com/r2/buckets/object-lifecycles/), [Containers](https://developers.cloudflare.com/containers/faq/). |
| Firebase Auth | La documentación sitúa Authentication en EE. UU.; IP registradas durante semanas y otros datos hasta iniciar eliminación, con eliminación de sistemas activos/copias hasta 180 días después. | Documentar términos/DPA aplicables y procedimiento sobre identidades. Borrar registros D1 no elimina Auth. [Privacidad Firebase](https://firebase.google.com/support/privacy), [términos Firebase](https://firebase.google.com/terms), [Cloud DPA](https://cloud.google.com/terms/data-processing-addendum). |

No se encontró una garantía pública específica del API de DeepSeek de cero retención o exclusión de entrenamiento. Es una ausencia de evidencia para esas promesas, no una conclusión de ilegalidad o de uso concreto de los mensajes. Clasificar transmisión/transferencia por contrato y operación efectiva; las casillas no reemplazan ese análisis.

Solicitud preparada para revisar y enviar por el propietario al soporte oficial de DeepSeek; **no enviada**:

> ALS Dev Studio integra la API `deepseek-flash` en Sarin, un servicio colombiano de citas comerciales. Necesitamos confirmar las condiciones aplicables a entradas/salidas de usuarios finales: uso para entrenamiento y exclusión, períodos de retención, países y subencargados, eliminación y asistencia a derechos, y acuerdo de tratamiento por instrucciones. Por favor indiquen los documentos contractuales aplicables a nuestra cuenta API y cómo obtenerlos. No adjuntamos conversaciones ni datos de clientes.

## Presupuesto explicado

La [tarifa oficial](https://api-docs.deepseek.com/quick_start/pricing/) actual coincide con la reserva conservadora del código: DeepSeek Flash de pico, **USD 0,30/millón de tokens de entrada y USD 1,20/millón de salida**, sin descontar caché. No se hicieron nuevas llamadas pagadas.

El [ensayo sintético previo](../qa/2026-10-16-deepseek-synthetic-results.json) estimó USD 0,0068931 por ocho llamadas y 21.633 tokens. Extrapolando el mismo perfil, una llamada por respuesta: `700 × 0,0068931 ÷ 8 ≈ USD 0,60`. Con dos llamadas por respuesta sería aproximadamente USD 1,21. Muestra pequeña, sin garantía de costo/volumen; no es una factura ni se recalculó independientemente el desglose entrada/salida del proveedor.

Propuesta pendiente de respuesta: **USD 8/mes y USD 0,50/día globales; USD 2/mes y USD 0,10/día por negocio**, más los límites de tokens existentes. Son techos simultáneos: si tres negocios gastan USD 2 y otro USD 2, los USD 8 globales se agotan y los demás no reciben una bolsa adicional. Las reservas conservadoras y límites diarios pueden pausar antes. La muestra no garantiza que alcancen para los paquetes vendidos.

El alojamiento se contabiliza aparte. El cálculo de USD 11,93 de infraestructura para 30 días encendida continuamente es un escenario anterior, antes de CPU/otros consumos, no una lectura de factura. Ver [presupuesto de infraestructura](../cloudflare-no-vps-runbook.md#presupuesto-operativo) y [STACK](../../STACK.md). El límite de IA no corta el alojamiento ni garantiza un tope de factura total.

Una solicitud rechazada por el presupuesto antes de inferir no consume una respuesta comercial. Permanecen consulta/cancelación de citas existentes. Las nuevas reservas del cliente que dependen del chat también pueden quedar interrumpidas: no prometer que toda forma de agendar continúa. El negocio puede atender por su contacto. El control no modifica el precio ni el cupo comprado. La compuerta monetaria sigue desactivada en producción; no se activará por el mero hecho de documentar esta propuesta.
