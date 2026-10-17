# Categoría y descripción de los servicios

Fecha: 17 de octubre de 2026.

## Decisión y alcance

El catálogo añade dos campos opcionales por servicio: descripción y categoría de menú. El dueño los edita en Configuración; el visitante los consulta en la ficha pública antes de acceder con Google. El objetivo es explicar qué incluye cada servicio y ordenar un menú que ya tiene nombre, precio fijo en COP y duración.

La categoría del servicio es independiente de la categoría general del negocio. Es texto libre del establecimiento, sin taxonomía de tratamientos, búsqueda entre negocios ni relación con un marketplace. No se incorporan entidades de categoría, gestión de archivo, fotografías, variantes ni precios «desde».

## Referencia de Fresha y adaptación

La guía oficial [Create services](https://www.fresha.com/help-center/knowledge-base/catalog/284-create-services-1) distingue la categoría de menú, visible al cliente, del tipo de tratamiento usado para descubrir servicios en el marketplace. También describe la descripción como un resumen de lo incluido y de lo que puede esperar el cliente.

La lección [Create services de Fresha Academy](https://www.fresha.com/help-center/academy/run-your-business/get-the-most-from-your-services/lessons/100339) presenta la descripción breve como una opción. La guía [Manage service categories](https://www.fresha.com/help-center/knowledge-base/catalog/52-manage-service-categories-1) documenta agrupaciones visibles al reservar y su orden configurable. Estas fuentes se comprobaron el 17 de octubre de 2026.

Sarin adapta la explicación y agrupación al catálogo actual. Los límites de **300 caracteres para descripción y 60 para categoría son decisiones de Sarin**; las guías consultadas no publican esos límites para Fresha. La categoría opcional de Sarin tampoco implica que el mismo campo sea opcional en Fresha.

## Edición, validación y compatibilidad

Cada servicio muestra «Descripción (opcional)» en un área de texto y «Categoría (opcional)» en una entrada de texto, con la ayuda «Visible para tus clientes». Se conservan las etiquetas accesibles que identifican el número de servicio. Los controles usan los límites 300/60; el servidor vuelve a validarlos después de quitar espacios exteriores. Un valor que excede el límite devuelve HTTP 400.

Ambos valores se guardan como texto y se presentan mediante texto de React: no se interpretan HTML ni Markdown. La descripción conserva sus saltos de línea en el perfil. La proyección pública omite campos vacíos y descarta metadatos históricos que no sean cadenas válidas dentro del límite.

| Entrada de configuración | Resultado para el mismo ID de servicio |
| --- | --- |
| Campo con texto | Se aplica el texto sin espacios exteriores. |
| Campo enviado como `''` o solo espacios | Se guarda `''` como borrado explícito; el perfil público omite el campo. |
| Campo omitido | Se conserva el valor previo válido, incluso un borrado explícito. |
| Servicio nuevo con otro ID | No hereda metadatos de otro servicio. |
| Servicio retirado de la lista | No se recupera por conservar metadatos. |

Esta combinación permite guardar desde clientes antiguos y mezclar borradores de configuración sin borrar silenciosamente el contenido editorial. La preservación se realiza por ID, no por nombre ni posición. Un borrador operativo sin estos campos mantiene los valores existentes.

Se conserva el límite total de **64 KiB** del cuerpo de configuración y los límites existentes de servicios. Los máximos por campo no garantizan que cualquier combinación de hasta 60 servicios quepa en una sola solicitud. No se añade migración, colección, dependencia ni proveedor. Los documentos históricos sin estos campos siguen siendo válidos.

## Presentación pública

La lectura continúa en `GET /api/public/businesses/[slug]?view=profile`, con `Cache-Control: no-store`. La lista permitida del servicio se amplía únicamente con `description` y `category`; no se entregan recursos, buffer, notas internas, configuración del asistente ni datos de clientes o pagos.

Si al menos un servicio tiene categoría, el perfil agrupa los servicios bajo títulos. La clave de agrupación quita espacios exteriores, normaliza Unicode a NFC y pasa a minúsculas con la configuración regional `es-CO`. Así se reúnen diferencias de mayúsculas y representaciones Unicode equivalentes; no se eliminan tildes. El título conserva la escritura de la primera categoría encontrada. Los grupos y los servicios dentro de cada grupo conservan el orden de su primera aparición en el catálogo, sin ordenar alfabéticamente.

En un menú mixto, los servicios sin categoría se reúnen bajo «Sin categoría». Si ninguno tiene categoría, se conserva la lista plana anterior y no se añade ese título. Una descripción ausente no deja un bloque vacío. Nombre, precio y duración permanecen visibles en ambos casos.

Se mantiene [Agenda clara](../design-system.md), con DM Sans, superficies y foco existentes. Los títulos de categoría usan el nivel `h3` y los servicios agrupados `h4`; la lista plana conserva servicios `h3`. El contenido largo puede envolver líneas sin desplazar el ancho de la página. No cambia la acción «Reservar», el acceso con Google ni el recorrido de citas.

## Asistente y reservas existentes

Los contextos del asistente reciben una lista explícita de datos operativos del servicio: `id`, `name`, `durationMinutes`, `bufferMinutes`, `price` y `resourceIds`. Descripción y categoría de menú no se incorporan a esos contextos. No aumenta el contenido editorial enviado al motor ni se cambia de proveedor.

Las citas confirmadas conservan sus datos y no se reescriben al editar el catálogo. Los metadatos editoriales tampoco se copian a la cita. Una propuesta pendiente conserva la instantánea del servicio existente: si cambia el servicio, incluidos sus metadatos, la confirmación devuelve HTTP 409 `BOOKING_PROPOSAL_CHANGED` y requiere una propuesta actualizada. Ese rechazo no crea una cita ni consume un cupo. Una propuesta ya confirmada recupera la misma cita al reintentarse, sin duplicarla ni consumir de nuevo.

Este documento describe la decisión implementada. La ejecución de aceptación se registra por separado; no constituye evidencia de publicación.
