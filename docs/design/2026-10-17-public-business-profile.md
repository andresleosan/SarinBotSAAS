# Perfil público del negocio

Fecha: 17 de octubre de 2026.

## Decisión y alcance

El propietario eligió explícitamente mostrar el negocio antes de pedir acceso con Google. La entrada existente `/b/[slug]`, compartida por enlace o QR, presenta a visitantes sin sesión la identidad del establecimiento, sus servicios, horarios y contactos. El visitante solicita acceso al pulsar «Reservar» o «Ver mis citas»; desde el acceso puede volver al perfil con «Volver al negocio». Una sesión existente continúa directamente al recorrido de citas.

El perfil usa los campos que el negocio ya configura. Es una presentación de un establecimiento concreto: no añade un marketplace, búsqueda de negocios, reseñas, puntuaciones, cifras de clientes ni contenido de muestra. Tampoco incorpora selección de servicio o de horario en esta primera pantalla. «Reservar» abre el acceso al recorrido vigente; no confirma una cita ni garantiza un cupo.

## Contenido y jerarquía

La cabecera muestra el nombre, la categoría cuando existe y el logo publicado cuando está disponible. El catálogo ocupa la columna principal y cada servicio reúne nombre, precio fijo en COP con formato `es-CO` y duración en minutos. Un precio de cero se presenta como `0 COP`. Si el catálogo está vacío, se indica «El negocio aún no ha publicado sus servicios».

La columna de apoyo contiene el horario semanal, de lunes a domingo, con la indicación «Hora de Colombia». Conserva los intervalos partidos de cada día. Un día cerrado muestra «Cerrado»; un día ausente o abierto sin intervalos muestra «Sin horario publicado».

Contacto muestra el teléfono publicado como enlace de llamada `tel:` y los enlaces sociales normalizados existentes, con su plataforma y etiqueta legible. El nombre del campo de origen es `phoneWhatsApp`, pero el perfil no añade un botón de conversación de WhatsApp. La sección desaparece si no hay teléfono ni redes. Los enlaces externos abren con `noopener noreferrer`.

Justo debajo de la cabecera se concentra la acción principal: «Reservar» junto a «Consulta la disponibilidad para reservar tu cita», o «Ver mis citas» cuando las nuevas reservas están en pausa. Esta posición permite encontrarla sin recorrer antes todos los servicios y horarios; en móvil el botón ocupa el ancho disponible.

## Contrato público y datos existentes

La lectura anónima usa `GET /api/public/businesses/[slug]?view=profile` y recibe `{ business: PublicBusinessProfile | null }`, con `Cache-Control: no-store`. La ruta conserva su contrato anterior cuando no se envía `view`. Un valor distinto de `profile`, o más de un parámetro `view`, devuelve un error 400. Se mantiene la validación del slug.

La proyección reducida contiene exclusivamente:

- `slug`, `name`, `category`, `phoneWhatsApp` y `timezone` (`America/Bogota`).
- `logo` y `socialLinks` cuando están disponibles y cumplen la normalización existente.
- `services`, limitado a `id`, `name`, `price` y `durationMinutes`.
- `weeklySchedule`, limitado a las claves de día de 0 a 6, `isOpen` e intervalos `start`/`end`.
- `bookingAvailable`, calculado por el servidor para orientar la acción del perfil.

La consulta lee únicamente `publicBusinesses`; no recurre a la colección privada `businesses` si la proyección falta. Esta vista no entrega identidad del propietario, configuración del asistente, campos de captación, recursos, datos de clientes, citas ni detalles de facturación. El logo utiliza la ruta pública existente y su identificador SHA-256.

No se añade una migración, una colección ni nuevos campos persistidos del negocio. `PublicBusinessProfile` es un contrato de lectura derivado de la proyección existente. El cambio de presentación tampoco elimina datos del navegador de versiones anteriores.

## Disponibilidad y estados

`bookingAvailable` requiere acceso comercial permitido por la lógica vigente, configuración inicial completada, al menos un día abierto con intervalos y algún servicio asociado a un recurso activo. Es una señal general del estado del negocio al consultar el perfil; la disponibilidad concreta de una cita sigue resolviéndose en el recorrido de reserva.

| Estado | Presentación y acción |
| --- | --- |
| Cargando | «Cargando negocio…», sin exigir Google para consultar el perfil. |
| Reservas disponibles | Información publicada y acción «Reservar». |
| Reservas en pausa | Se mantiene el perfil y se explica que las nuevas reservas están en pausa. «Ver mis citas» permite continuar al acceso para consultar y cancelar citas existentes. |
| Negocio ausente | «No encontramos este negocio. Revisa el enlace o escanea nuevamente su QR» y «Volver al inicio». |
| Error sin perfil | Mensaje de consulta fallida, «Reintentar» y retorno al inicio. |
| Error al actualizar un perfil ya cargado | Se conserva la información disponible, se muestra el error y se ofrece «Actualizar negocio». |

Los estados vacíos muestran la ausencia de información; no completan servicios, horarios, contactos o identidad con datos inventados.

## Continuidad del recorrido de citas

El cambio se sitúa antes de `AuthGate`. Tras el acceso permanece `Island`, con los permisos de cuenta y del negocio, la consulta de política de reserva y «Mis citas».

Para un adulto que reserva para sí mismo en modo general continúa el chat comercial de Sarin. El modo salud conserva la reserva estructurada. Cuando el negocio permite menores representados, la elección «Para un menor a quien represento» conserva ese recorrido estructurado y sus condiciones de representación. El perfil anónimo no captura información de salud ni de menores y no sustituye los controles de estos recorridos.

«Mis citas» permanece en la vista autenticada y conserva su acceso a las citas existentes. Una pausa de nuevas reservas no convierte el perfil en un bloqueo de la gestión de citas.

## Presentación visual

Se conserva [Agenda clara](../design-system.md): fondo `#f7f9ff`, superficies blancas, tinta `#162344`, texto secundario `#52617d`, acción y foco azul `#315ff3` y bordes `#e0e6f1`. La tipografía sigue siendo DM Sans autoalojada; horarios e importes usan cifras tabulares.

La composición tiene ancho máximo de lectura, tarjetas con bordes discretos y una sola acción principal tras la cabecera. En escritorio separa catálogo e información de apoyo; en móvil apila los bloques y permite envolver nombres y enlaces largos. Los controles mantienen un alto mínimo de 44 px, el foco es visible y los estados se explican con texto.

## Referencias de implementación

- Entrada y continuidad: `src/app/b/[slug]/page.tsx`.
- Presentación del perfil: `src/components/business-public-profile.tsx`.
- Lectura pública: `src/app/api/public/businesses/[slug]/route.ts`.
- Proyección y contrato: `src/lib/server/businesses.ts` y `src/types/firestore.ts`.

Este documento describe el diseño implementado en la rama de trabajo. No constituye evidencia de publicación ni un informe de resultados de QA.
