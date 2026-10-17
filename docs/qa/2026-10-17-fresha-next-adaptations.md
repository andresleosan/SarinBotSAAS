# Fresha: próximas adaptaciones para Sarin

Investigación del 17 de octubre de 2026, después de publicar «Volver a reservar». Se inspeccionaron ocho pantallas de ajustes y automatizaciones de la cuenta ya abierta, se consultaron más de diez guías oficiales y se compararon las capacidades con el runtime publicado `0b3bf0558b48ded61f9869374bee75c80d29d22a`. Worktree `service-catalog`, documentación base `f395408`. Esta revisión propone prioridades: no implementa funciones ni modifica producción.

## Método y límites

La inspección del navegador fue de solo lectura: configuración de hora/calendario, opciones de reserva, espera, disponibilidad, cierres, asignación dinámica, automatizaciones y detalle de un recordatorio. No se pulsaron acciones para guardar, activar, enviar pruebas o recargar saldo. Al terminar se devolvió la pestaña al perfil original. No se aceptaron términos ni se crearon citas.

Las capturas de texto y la imagen del detalle del recordatorio se conservan fuera de Git en `%LOCALAPPDATA%/SarinBot/fresha-research-20261017`. Este informe omite correos, datos de la cuenta y saldos. Las opciones de configuración observadas no acreditan que una reserva o un mensaje hayan sido ejecutados.

Se distinguen tres tipos de evidencia: **observado** en la interfaz, **documentado** en una guía oficial y **propuesto** para Sarin. Las prioridades y métricas siguientes son hipótesis de producto; no son resultados medidos con clientes.

## Lo que ya tiene Sarin

Ficha pública antes de Google, servicios por categoría y descripción, precio y duración, calendario directo, resumen y confirmación explícita, continuidad de la elección después del acceso, aviso de ausencia de horarios y «Volver a reservar» desde Historial. También existen logo, contacto, enlaces sociales, tarjeta PDF/PNG/QR, cancelación y descarga de imagen de la cita. No se vuelven a presentar como novedades.

Fuentes: [estado de implementación](../../tasks.md), [ficha y calendario](../../src/app/b/[slug]/page.tsx), [Historial](../../src/components/client-appointments.tsx), [kit del negocio](../../src/app/dashboard/qr-kit/page.tsx). Los análisis anteriores conservan estados históricos y no sustituyen esta base.

## Hallazgos y correspondencia

| Función de Fresha | Evidencia concreta | Brecha actual de Sarin y adaptación propuesta |
| --- | --- | --- |
| Próxima fecha disponible y consulta de otros profesionales | La [creación de citas](https://www.fresha.com/help-center/knowledge-base/calendar/260-create-appointments-1) documenta estos accesos cuando no hay cupos, además de espera. Esa guía describe el calendario del negocio. | El cálculo y la API actuales trabajan un día. Proponer un acceso equivalente al cliente exige una búsqueda acotada entre días; no basta cambiar el mensaje vacío. Reutilizar el motor diario y conservar servicio/profesional hasta que el usuario decida cambiarlos. |
| Reprogramación de la cita existente | La [guía de reprogramación](https://www.fresha.com/help-center/knowledge-base/calendar/263-reschedule-appointments) permite cambiar fecha/hora dentro del plazo del negocio, conservando la cita y su información. Para el cliente, un servicio retirado de venta online impide el autoservicio. | No hay operación de reprogramación. «Volver a reservar» abre un caso nuevo. Hace falta cambio atómico entre horarios/recursos, autorización, plazo, confirmación y consumo comercial preservado. |
| Plazos configurables | **Observado:** Disponibilidad separa antelación/horizonte de reserva y plazo para cancelar/reprogramar. | Sarin tiene un horizonte fijo por fecha de 366 días y descarta horarios pasados. Faltan reglas configurables. La UI limita cancelación al futuro, pero el servidor no verifica el inicio/plazo; resolver esa diferencia antes de prometer una política. |
| Cierres por fecha | **Observado:** pantalla independiente para vacaciones, reformas y cierres de uno o varios centros. [Guía de cierres](https://www.fresha.com/es/help-center/knowledge-base/calendar/20-set-business-closed-periods). | Hay horario semanal y bloqueos manuales por recurso/día; falta una entidad de cierre por fecha/rango que afecte al negocio completo. Es un incremento operativo separado, no una ausencia total de bloqueos. |
| Avisos y recordatorios | **Observado:** automatizaciones separadas para reserva, cambio, cancelación, espera y recordatorios. El detalle de uno muestra anticipación de 24 horas y canales email/SMS/WhatsApp. La [guía de recordatorios](https://www.fresha.com/help-center/knowledge-base/calendar/167-send-appointment-reminders) documenta dos iniciales y un tercero opcional. | No hay recordatorios automáticos de citas. Comenzar por un canal exige proveedor, preferencias, programación persistente, deduplicación y retirada de avisos obsoletos. Importar un archivo de calendario es un incremento diferente. |
| Lista de espera | **Observado:** tipo de gestión, prioridad y solicitudes online. Las [entradas](https://www.fresha.com/help-center/knowledge-base/calendar/101629-manage-waitlist-entries-1) incluyen servicio y preferencias; los [ajustes](https://www.fresha.com/help-center/knowledge-base/calendar/259-set-up-and-manage-your-waitlist) describen ofertas cuando se libera un hueco. | No hay modelo/API/UI. Un primer incremento podría ser solicitud persistente y gestión manual. El cliente debe confirmar el hueco; el nombre «Automatically book» no acredita una reserva sin su intervención. |
| Ubicación e indicaciones | La [creación del perfil](https://www.fresha.com/help-center/knowledge-base/online-presence/266-create-your-online-profile) incluye dirección, mapa y nota para llegar. | Sarin publica teléfono y redes, pero no dirección/modalidad. Añadir datos comerciales opcionales y «Cómo llegar»; no asumir que un negocio a domicilio tiene un local público. |
| Galería y profesionales | **Observado:** opciones de mostrar perfiles, porfolio y valoraciones del equipo. La [galería](https://www.fresha.com/help-center/knowledge-base/online-presence/100667-marketplace-image-gallery-overview) distingue local, servicios y profesionales. | El logo no es una galería; los recursos actuales solo tienen ID, nombre y actividad. Fotos/bio y porfolio requieren datos, carga de archivos y proyección pública nuevas. |
| Asignación dinámica | **Observado:** asignar nuevas citas sin preferencia y reasignar citas existentes son ajustes distintos. | El motor ya filtra recursos elegibles; faltan turnos individuales y reglas de reparto/reasignación. No mover citas confirmadas silenciosamente como parte de «ver otros profesionales». |
| Varios servicios y reseñas | El [recorrido del cliente](https://www.fresha.com/help-center/knowledge-base/online-presence/102398-learn-how-clients-book-appointments-online) permite varios servicios y valoración posterior. | Sarin reserva un `serviceId` por cita y no tiene reseñas/moderación ni cierre operativo equivalente. Los paquetes comerciales de respuestas/citas para negocios no son paquetes de tratamientos del cliente. |

La ayuda de ajustes enlazada por Fresha no devolvió contenido utilizable en el lector remoto de esta revisión; los valores de Disponibilidad proceden de la pantalla real. La lección de cierres tampoco devolvió texto al lector de la revisión principal. Para la propuesta de próxima fecha se usa la guía verificable de creación y se declara explícitamente la adaptación al cliente.

## Prioridad propuesta

Escala de 1 a 5 para alcance, impacto, confianza y facilidad; facilidad 5 significa menos esfuerzo. Promedio simple según `product-strategy`. Son estimaciones relativas, sin atribuir mejoras porcentuales de conversión o inasistencia.

| Orden | Incremento | Alcance | Impacto | Confianza | Facilidad | Media | Métrica a observar |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Buscar próxima fecha disponible | 5 | 4 | 4 | 3 | 4,00 | Clientes que pasan de una consulta vacía a elegir un horario y confirmar. |
| 2 | Añadir cita al calendario | 4 | 3 | 4 | 4 | 3,75 | Exportaciones exitosas y dudas sobre guardar la cita. No equivale a medir asistencia. |
| 3 | Dirección/modalidad y cómo llegar | 4 | 3 | 4 | 3 | 3,50 | Uso de indicaciones y consultas al negocio sobre ubicación. |
| 4 | Reglas temporales en servidor | 3 | 4 | 5 | 2 | 3,50 | Solicitudes admitidas/rechazadas de forma coherente con la política. |
| 5 | Reprogramar cita existente | 3 | 5 | 4 | 1 | 3,25 | Cambios completados sin asistencia manual y sin duplicados. Depende del punto anterior. |
| 6 | Cierres por fecha/rango | 3 | 4 | 4 | 2 | 3,25 | Tiempo del negocio para cerrar un periodo y ausencia de reservas en esas fechas. |

El cliente que encuentra un día completo es quien más sufre la primera brecha: hoy debe probar fechas una a una. Mantenerla tres meses prolongaría ese trabajo y la posible pérdida de reservas, aunque aún no tenemos una medición de abandono. La búsqueda siguiente ofrece utilidad sobre el motor existente y no añade una integración de pago.

La segunda opción aprovecha una utilidad ICS existente, pero está desconectada de la UI. Antes de usarla hay que vincular el evento a la cita, revisar importación y duplicados, y corregir el texto heredado que atribuye recordatorios a Sarin. La descarga no supone sincronización futura con Google/Apple ni envío automático de avisos.

## Siguiente incremento recomendado, por definir

**«Buscar próxima fecha disponible»** después de una consulta correcta sin horarios. Conserva servicio y profesional; busca desde el día siguiente dentro de un rango limitado, por ejemplo catorce días; devuelve la primera fecha que tenga cupos reales. El cliente elige la hora y confirma por el recorrido actual. El rango final es una decisión de implementación pendiente.

Si el rango termina sin cupos, mostrar su límite y ofrecer elegir otra fecha. Un error de lectura no debe anunciar que la agenda está llena. Ante cambios de usuario, negocio, servicio o profesional se descarta la respuesta anterior. La búsqueda mantiene el acceso, permisos, clasificación y límites vigentes, sin usar IA ni crear propuestas/citas automáticamente. «Ver otros profesionales» sería una acción explícita adicional; no cambia la preferencia en silencio.

Puntos del código: [cálculo diario](../../src/lib/sarin/availability.ts), [lectura de disponibilidad](../../src/lib/server/bookings.ts), [contratos](../../src/lib/server/schemas.ts), [estado del calendario](../../src/hooks/useStructuredBooking.ts), [interfaz](../../src/components/structured-booking.tsx). La investigación no modifica esos archivos.

## Funciones que esperan

- **Recordatorios automáticos:** hacen falta canal y programador persistente; estimar costo y límites antes de comprometer el servicio. ICS puede llegar primero.
- **Lista de espera:** nuevo ciclo de solicitudes, vencimiento, baja, ofertas y comunicaciones; evaluar después de comprobar demanda sin cupos.
- **Galería/porfolio:** útil para negocios visuales, con almacenamiento y gestión de imágenes nuevos; dirección/modalidad resuelve antes información básica.
- **Fotos/bio del profesional:** depende de que los primeros negocios realmente operen equipos; priorizar turnos individuales si esa es la limitación real.
- **Múltiples servicios:** exige cálculo de secuencias, duración y precio conjuntos, recursos y consumo; no cabe como ampliación visual del selector.
- **Reseñas:** requieren cierre de citas y moderación; no usar citas simplemente pasadas como visitas acreditadas.
- **Reasignación automática:** altera operación confirmada y depende de reglas/turnos; no es necesaria para buscar un hueco.
- **Directorio/marketplace y pagos anticipados:** se mantienen las decisiones comerciales previas; esta investigación no los activa.

## Comprobaciones de código

La revisión independiente confirmó la falta de búsqueda entre días y reprogramación; la API de appointments solo permite cancelar mediante PATCH. `cancelAppointment` valida identidad y estado, sin plazo temporal; el control de futuro vive en la UI. La utilidad `src/lib/utils/icsGenerator.ts` genera un UID nuevo por descarga y no tiene import activo en la aplicación. Estos son puntos de partida para diseño y pruebas futuros, no pruebas de una implementación nueva.

Validación de esta entrega: revisión cruzada de fuentes y brechas, enlaces locales y `git diff --check`. Solo cambia documentación; no se repitieron pruebas de aplicación ni se atribuyen verificaciones nuevas de producción.
