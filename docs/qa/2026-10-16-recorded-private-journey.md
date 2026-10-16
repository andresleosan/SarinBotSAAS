# Recorrido privado grabado: reserva con Ollama

Fecha: 16 de octubre de 2026, hora Colombia. Se probó el enlace cliente de `Sarin Pruebas`, slug `sarin-pruebas-20261015`, en la instancia privada accesible mediante `localhost:3032`. El proveedor activo fue Ollama en la Mac. El recorrido produjo cinco respuestas de Sarin; no se cambió de proveedor ni se publicó la aplicación.

## Resultados observados

| Comprobación | Resultado |
| --- | --- |
| Consulta del servicio | Duración de 30 minutos y precio de 30.000 COP correctos |
| Disponibilidad del 17 de octubre de 2026 a las 10:00 | Sarin consultó la disponibilidad sin crear una reserva |
| Resumen previo | Se presentó antes de reservar; no apareció una cita nueva |
| Confirmación explícita | Se creó una sola tarjeta para el 17 de octubre, 10:00–10:30, hora Colombia |
| Identidad de la reserva | La confirmación usó la identidad de la cuenta Google autenticada |
| Persistencia | Después de recargar la página reapareció una sola tarjeta en «Tus próximas citas» |
| Consulta posterior | Sarin indicó 10:00, 10:15 y 10:30 ocupados, y 10:45 disponible, coherente con el servicio de 30 minutos, margen posterior de 10 minutos e intervalos de agenda de 15 minutos |
| Calendario | Se descargó un archivo `.ics` de 360 bytes con un solo evento confirmado: inicio `20261017T150000Z` y fin `20261017T153000Z`, equivalentes a 10:00–10:30 en Colombia. Servicio y negocio correctos; no se importó al calendario |
| Comunicaciones externas | No se enviaron mensajes de WhatsApp |

La persistencia se comprobó desde la misma sesión, sin otro inicio de sesión: la tarjeta se obtiene de la consulta de citas de Firestore filtrada por el usuario autenticado y reapareció tras recargar. Esto acredita la reserva visible para esa cuenta; no es una auditoría de todos los documentos ni una prueba de aislamiento entre usuarios distintos.

## Hallazgos de la respuesta

1. **Margen explicado antes del servicio.** En la primera respuesta, Sarin describió los 10 minutos como preparación antes de la cita. El código reserva ese tiempo después: servicio 10:00–10:30 y margen 10:30–10:40. La consulta posterior ofreció 10:45 como siguiente inicio disponible, coherente con el cálculo real. La explicación verbal es incorrecta; no se observó un desplazamiento de la cita ni un cambio en la disponibilidad. El prompt actual dice «reservado para preparación» sin precisar «después»; la ayuda de configuración sí lo precisa. Queda pendiente corregir y volver a comprobar esa explicación.
2. **Markdown sin formato.** Se vieron marcadores Markdown literales en las respuestas. La pantalla cliente renderiza el contenido como texto JSX, mientras que la respuesta libre del modelo puede incluir esos marcadores. Es un defecto de presentación; no afectó a la tarjeta ni a la persistencia observadas. Queda pendiente acordar y verificar el formato de respuesta.

La confirmación final después de guardar se construye con los datos y el estado devueltos por la herramienta de reserva. Los hallazgos anteriores corresponden a la explicación libre y su presentación; no se aplicaron correcciones durante este recorrido.

## Estado final y evidencia

Quedó **una cita sintética activa** para el 17 de octubre de 2026 a las 10:00, con un número ficticio aportado en la solicitud. No se canceló ni se borró; ocupa ese intervalo y su margen hasta que se cancele. La cuenta y los datos identificables no se incluyen en este documento.

La captura mediante CDP conserva 317 fotogramas y sus tiempos originales. Los materiales privados están en `F:/SarinBot-videos/2026-10-16-prueba-real`. Se exportaron dos archivos MP4 H.264, 1080 × 1920, 30 fps y sin audio:

- `sarin-prueba-completa-vertical.mp4`: 253,77 segundos, con los tiempos originales y cuatro segundos de cierre.
- `sarin-demo-redes-vertical.mp4`: 50,4 segundos, con pasos rotulados y esperas recortadas. Identifica la prueba como prototipo con IA local; los tres segundos finales repiten la tarjeta persistida bajo un rótulo explícito de resumen.

Chrome cambió el tamaño de los fotogramas durante la captura. Se recortó únicamente el área vacía exterior y se normalizó el encuadre conservando la proporción, sin reescribir el contenido del chat. Los originales permanecen intactos. Ambos videos pasaron inspección de formato y decodificación completa sin errores; se revisaron visualmente muestras y el cierre del MP4 exportado. La revisión por muestras no equivale a inspección manual de cada fotograma. No se publicaron los videos. El calendario descargado permanece fuera del repositorio.

## Alcance y límites

- Se verificó un recorrido real y secuencial de consulta, resumen, confirmación y lectura posterior con Ollama. No fue una prueba de carga, concurrencia o recuperación de la Mac.
- No se probó Gemini, DeepSeek ni el envío o recepción de WhatsApp. La descarga del calendario no demuestra entrega de notificaciones.
- No se ejecutaron cancelación, reprogramación ni bloqueos en este recorrido. El chat cliente actual no dispone de herramientas de cancelación o reprogramación.
- No se midieron aquí tokens, costo, saldo de cuota ni latencia de cada solicitud. Las cinco respuestas observadas no equivalen a cinco llamadas al modelo, porque un turno puede incluir varias rondas de herramientas.
- El acceso continúa siendo privado. La grabación no demuestra publicación pública, funcionamiento de OAuth desde otro dominio ni acceso de otro cliente.

El recorrido anterior y sus cancelaciones se documentan por separado en [QA privada de administración y reservas](2026-10-15-private-journey.md). Las comprobaciones previstas más amplias del piloto se conservan en [Piloto privado de Sarin Pruebas](2026-10-15-private-pilot.md).
