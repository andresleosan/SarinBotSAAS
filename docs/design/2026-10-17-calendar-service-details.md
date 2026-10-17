# Detalles del servicio en el calendario

Fecha: 17 de octubre de 2026. Diseño acotado aprobado por el propietario.

Al elegir un servicio, el calendario muestra su categoría y descripción opcionales, duración y precio antes del selector de profesional. El bloque usa los datos existentes y el estilo Agenda clara. No necesita petición, estado persistente ni interacción adicional.

Se conserva el selector actual y la secuencia del [calendario basado en la referencia de Fresha](2026-10-17-direct-booking-calendar.md). Esta mejora mantiene visibles los detalles del catálogo durante la selección del horario; no introduce una nueva integración con Fresha.

La duración corresponde a `durationMinutes`, sin sumar el buffer entre citas. El precio se muestra en COP, incluido cero. Categoría y descripción se normalizan con `serviceCatalogMetadata`, igual que la ficha pública: valores ausentes, blancos, de tipo incorrecto o fuera de límite se omiten. El texto se representa literalmente y conserva los saltos de línea de la descripción.

El bloque existe únicamente para un servicio seleccionado válido dentro de los controles actuales de la reserva. Cambiar de servicio reemplaza su contenido y conserva la limpieza existente de recurso, hora y disponibilidad. Cambiar de cuenta, negocio o destinatario reinicia el ámbito. Durante una propuesta congelada permanece de lectura; al guardar la cita desaparece con el formulario.

No cambia API, autorización, consentimiento, preguntas, disponibilidad, confirmación, recuperación, esquema, dependencia ni inferencia. La reversión compatible es la imagen vigente del calendario `sha256:b6bc75f9f108e0f798dcb4f135e3cf281844060c2bd64e3181382b7cb785a39b`, runtime `98629e1`; no requiere migraciones ni borrar datos. La publicación requiere su aprobación específica después de la aceptación local.

Protocolo: [qa/tests/calendar-service-details.md](../../qa/tests/calendar-service-details.md).
