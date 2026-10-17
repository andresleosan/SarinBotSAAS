# Volver a reservar desde el historial

El propietario aceptó el siguiente incremento al responder «ok» a la propuesta de añadir «Volver a reservar» desde el historial, recuperar el servicio vigente y elegir un horario nuevo antes de confirmar. Es un cambio acotado sobre Mis citas y el calendario existentes.

La referencia es el [recorrido oficial de Fresha](https://www.fresha.com/help-center/knowledge-base/online-presence/102398-learn-how-clients-book-appointments-online), que permite volver a reservar desde la cuenta. Sarin adapta esa comodidad a sus permisos y confirmación actuales, sin integración externa.

En Historial, cada cita propia cuyo servicio siga en el catálogo ofrece «Volver a reservar». La acción entrega solo el ID de ese servicio al calendario nuevo. El formulario muestra nombre, precio, duración y metadatos vigentes; profesional y hora quedan sin elegir y el día vuelve al valor actual habitual. El foco y el desplazamiento llevan a Nueva reserva. Ninguna consulta de disponibilidad, propuesta o confirmación se ejecuta por pulsar el botón.

El caso nuevo inicia para la propia persona. Si reserva para un menor debe elegirlo y autorizarlo de nuevo; salud conserva su autorización por caso. No se copian destinatario, teléfono, respuestas, precio, fecha, hora o profesional históricos. Solo se consume una vez la selección; las ediciones manuales y otra reserva no la recuperan.

Permisos de cuenta y negocio, política lista, catálogo legible y suscripción activa habilitan la acción. Una operación de chat/calendario en curso o incierta la bloquea. La confirmación recuperable permanece montada aunque fallen permisos o lecturas. Cuenta, negocio, registro, catálogo y bloqueos se revalidan al pulsar; un servicio retirado no ofrece el botón.

Se reutiliza Agenda clara: DM Sans, superficies claras, azul funcional, borde y foco existentes y área táctil de 44 px. Se conserva la etiqueta visible en el nombre accesible, completada por el servicio actual. No hay nuevo esquema, API, dependencia, proveedor, migración o inferencia.

Base y reversión compatible: runtime `2440af53a7331f9e44a4a7324e798267e72cb912`, imagen `sha256:3c8e555db893889c444335de9d35a18041d8620ba3bda3e85d68c9fcee5aacd6`, Worker `bb969dc5-7062-46a0-9da4-34a08009f236`, Containers v13. Revertir retira el botón y conserva las citas y el catálogo. La selección nueva sigue siendo temporal en memoria.

[Protocolo de aceptación](../../qa/tests/rebook-from-history.md). La autorización de implementación no sustituye la revisión concreta del artefacto antes de publicar.
