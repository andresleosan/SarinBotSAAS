# Presupuesto administrativo y despliegue de WhatsApp

El titular autorizó desplegar el chatbot de texto y fijó US$0,25 diarios y US$3 mensuales. También aprobó editar ambos topes desde su panel, mostrar consumo y reservas, restringir modificaciones al administrador y conservar lo ya contabilizado al cambiar límites.

## Cambio

`/admin` incluye Presupuesto del bot de WhatsApp. GET/PATCH en `/api/admin/platform-whatsapp/budget` verifican Firebase y superadministrador. Los cambios usan revisión optimista; cero cierra nuevas llamadas. Los períodos son calendario UTC y el panel lo indica. El libro de costos `platformWhatsAppSpending` contiene únicamente importes, estados e identificadores opacos; no cuerpos ni teléfonos. Configuración en `serverSettings/platform_whatsapp_budget`.

La reserva y liquidación de texto/envío participan en la misma transacción D1 que el trabajo existente. El máximo pendiente cuenta contra ambos topes. Un resultado desconocido conserva su reserva; solo se libera una operación probadamente no iniciada. Una liquidación conocida no se duplica y un exceso bloquea el período. Bajar un límite no borra consumo ni reservas. Una reserva antigua sin asiento administrativo se deniega antes de iniciar cuando se configura el presupuesto. El despliegue debe fijar `PLATFORM_WHATSAPP_ADMIN_BUDGET_REQUIRED=true`: ausencia de configuración cierra efectos externos. Los límites de etapa del entorno siguen siendo una barrera adicional; para permitir editar el tope se deben dimensionar por encima del límite administrativo permitido, sin desactivar la contabilidad.

El arranque aprobado cubre texto; audio permanece desactivado. Configurar el presupuesto administrativo cierra audio hasta integrar su contabilidad equivalente en el Worker. La pantalla de WhatsApp también muestra las flags consultadas de IA/envío en lugar de textos fijos.

## Validación y revisión

La prueba inicial demostró que faltaba el cierre administrativo. Las pruebas específicas cubren autorización, validación de importes, CAS, cambio de límites sin reinicio, reservas iguales y distintas concurrentes, cambio de día con tope mensual, liberación idempotente y resultado incierto/exceso. Las pruebas de interfaz comprueban edición sin escritura automática, guardado explícito, pérdida de rol y conflicto sin reintento; la API comprueba autorización previa a almacenamiento y no-store.

Primera suite completa: 3170 casos, 3116 aprobados, 28 omitidos y 26 fallidos. Veinticuatro fallos eran fixtures de otras secciones administrativas que debían aislar el componente nuevo; sus cuatro suites quedaron corregidas y la ejecución dirigida aprobó35/35. Los dos timeouts D1 aprobaron al ejecutar su archivo aislado22/22. No se elimina el intento fallido. Worker136/136, tipos Worker y tipos no incrementales de aplicación aprobaron.

Revisión independiente de los16 archivos originales: cero críticos, dos importantes y dos menores. Los importantes fueron reproducidos antes de corregirse: el código de cierre nuevo impedía persistir entrada/soporte y una reserva anterior podía iniciar sin retención administrativa. Se preserva el contrato `PLATFORM_WORK_CLOSED` y se deniega el permiso de la reserva anterior. Tres regresiones rojas pasaron a verde junto con sus suites. La revisión global previa del candidato sigue conservada; esta revisión no la repite. Las verificaciones finales Linux/GitHub y el resultado productivo se registran por separado, sin convertir QA sintética en prueba de un proveedor real.

## Menores diferidos

- Una revisión nueva consultada por polling puede sustituir una edición local sin guardar. CAS protege el dato durable; queda pendiente conservar borradores y ofrecer cargar la revisión nueva explícitamente.
- Los asientos de llamada finalizados no tienen poda automática. Son registros contables mínimos sin texto ni teléfono. La futura retención debe definir plazo contable y podar solo registros finalizados; no borrar reservas inciertas ni reducir contadores para recuperar presupuesto.

## Operación

El backend debe publicarse primero con automatización apagada y retención compatible activa, preservando la clave de contenido existente. Deben mantenerse una sola réplica, los secretos separados por propósito y la identidad federada. Los respaldos D1/R2 se guardan fuera de Git y se verifica su restauración; los índices0003–0006 son aditivos. El cambio no altera usuarios ni proveedores Firebase Auth. La configuración y versión anterior se conservan por separado.

La activación depende de una credencial YCloud autorizada, contrato de consulta de cuenta/alcance, tarifa conservadora de envío y modelos reales de DeepSeek. No se regeneran claves compartidas ni se modifica ALS. Las pruebas reales históricas cerradas conservan su alcance y no se repiten para declarar esta entrega. La publicación de Pages desde main no sustituye el despliegue de Worker/Container.
