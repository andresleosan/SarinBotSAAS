# Categorías y descripciones: aceptación local

Fecha: 17 de octubre de 2026. Estado: aprobado en local, pendiente de autorización específica de publicación. Rama `codex/service-catalog-20261017`, basada en `d942e90`, continuación del perfil público publicado. El checkout original mixto se conserva.

## Resultado

El dueño puede añadir descripción y categoría opcionales a cada servicio. La ficha anónima muestra las descripciones y agrupa el menú cuando hay categorías. Los servicios históricos mantienen la lista plana si no tienen categorías. Precio, duración, recursos, horarios y citas confirmadas conservan sus contratos.

[Diseño y fuentes oficiales de Fresha](../design/2026-10-17-service-catalog.md). Se usaron guías oficiales para este incremento; la pestaña de la cuenta Fresha no pudo inspeccionarse de nuevo por un fallo de conexión del control del navegador. No se atribuyen hallazgos nuevos a esa sesión privada.

## Evidencia ejecutada

| Comprobación | Resultado |
| --- | --- |
| RED previo al código | Backend: cinco fallos por campos desconocidos, pérdida de metadatos y envío de textos al contexto del asistente. UI: seis fallos por campos, conservación y agrupación ausentes. Propuestas: cuatro fallos por esquema estricto. |
| Revisión independiente | Detectó pérdida del borrado explícito al aplicar un borrador omiso. Se reprodujo, se añadió una regresión UI que falló y se corrigió la combinación. Segunda revisión sin bloqueantes; 38 pruebas enfocadas aprobadas. |
| `pnpm test` final | **927 aprobadas, 26 omitidas**; 115 archivos aprobados y cuatro omitidos. Las integraciones opt-in no se cuentan como ejecutadas por este comando. |
| `pnpm run typecheck` | Sin errores; el build final repitió TypeScript correctamente. |
| `pnpm run build` final | Next 16.4.0 compiló y generó las rutas de producción. |
| `pnpm run test:journey --port 3040` | **129 comprobaciones** con Auth y Firestore oficiales en loopback. Incluye 12 comprobaciones HTTP del catálogo, permisos, reservas, carrera concurrente, cancelación, comprobantes sintéticos e idempotencia. Limpieza del recorrido correcta. |
| `pnpm audit --audit-level=high` | Sin vulnerabilidades conocidas. Dependencias y lockfile sin cambios. |
| `git diff --check` | Sin errores. |

Las regresiones HTTP se añadieron después de implementar el contrato. Su primera ejecución esperaba por error propiedades ausentes en el documento privado tras vaciar; el contrato aprobado conserva `''` privado y omite los campos en la ficha anónima. Se corrigieron esas expectativas y se repitió el recorrido completo, que pasó. No se cambió producción para verificarlo.

La revisión de seguridad comprobó validación independiente del servidor, autorización del dueño y consentimiento existentes, cuerpo máximo de 64 KiB, lista pública explícita, texto React sin interpretación HTML y contextos de IA limitados a datos operativos. No hay endpoints, permisos, secretos, dependencias, proveedor ni migraciones nuevos. No se añadieron campos de cliente ni clasificación automática de salud o menores.

## Chrome local mediante CUA

Origen exclusivo `http://127.0.0.1:3040`, proyecto `demo-sarin-bot`, cuenta Negocio local y negocio sintético `catalogo-qa-20261017`. No se usó una cuenta real para editar ni se llamó al motor.

- Perfil anónimo con cinco servicios: agrupación de `Cortes` y `cortes`, orden estable, grupo «Sin categoría», descripción literal con etiquetas HTML y texto de 300 caracteres sin espacios.
- 320×740: perfil y formulario sin desbordamiento horizontal; botón de reserva y categoría de 44 px, descripción de 80 px; máximos HTML 300/60 y foco visible.
- 390×844: perfil tras borrar ambos textos del primer servicio; ese servicio conserva precio/duración y aparece en «Sin categoría», sin recuperar textos anteriores.
- 1280×900: perfil centrado con ancho máximo de 896 px y columnas de servicios/horario.
- Edición real de descripción/categoría, Guardar, mensaje de éxito y recarga: los valores persistieron. Se vaciaron ambos campos y se verificó la respuesta anónima 200/no-store sin ellos.
- Navegación a Enlace y QR, Mi agenda y Suscripción: pantallas esperadas disponibles. Enter en Reservar y Volver al negocio verificó acceso y regreso sin enviar mensajes.
- Sin errores o advertencias de consola capturados. La notificación visual del emulador es esperada.

La normalización Unicode NFC, el catálogo histórico plano, la combinación de borradores y la idempotencia de propuestas tienen cobertura automatizada; no se presentan como nuevas comprobaciones manuales en Chrome. La suite repetible está en [qa/tests/service-catalog.md](../../qa/tests/service-catalog.md), y el informe HTML local en `qa/reports/2026-10-17-service-catalog.html`, excluido de Git. Se usó CUA; no se presenta como una ejecución de `@playwright/test`.

Una captura con página completa agotó el tiempo de CDP. Se recuperó la evidencia con captura normal y se continuó verificando las pantallas. Se restauró el viewport y se cerró la pestaña local. Los servicios de esta sesión se detuvieron sin exportar datos del emulador; los puertos 3040/8080/9099/4400/4500 quedaron libres. La sesión administrativa de producción no se alteró.

## Capturas sintéticas

- [Ficha en 320 px](2026-10-17-service-catalog-320.png).
- [Ficha de escritorio](2026-10-17-service-catalog-desktop.png).
- [Edición en 320 px](2026-10-17-service-catalog-edit-320.png).
- [Borrado explícito en 390 px](2026-10-17-service-catalog-clear-390.png).

## Publicación y reversión

Este incremento todavía no está publicado. La versión activa sigue siendo el perfil público `03a4703`, imagen `sha256:0ce3ac0a81a93f7825d56edc7c30bdf8ed1eaf352cc251bac9b2ee0d702dd7f6`, Worker `bd604e53-49aa-40b5-b866-29633cc684bf`, Containers v9. No se sustituyen esos datos por un build local.

La futura publicación debe conservar bindings, trece secretos, D1/R2, presupuesto y una única instancia; cerrar nuevas solicitudes y drenar la cola antes de sustituir el contenedor.

La revisión de reversión encontró que **no se puede reabrir sin más la imagen `0ce3ac0a…` después de guardar los campos nuevos**: su esquema estricto puede rechazar tanto configuraciones como propuestas de reserva que los contengan. Se debe preparar y verificar una imagen compatible con la interfaz anterior y el contrato nuevo de servidor. No se borran metadatos ni se restauran documentos antiguos para hacer encajar una versión. Una reversión conserva mantenimiento hasta confirmar la imagen compatible, la única instancia efectiva y las lecturas/reservas. La construcción y comprobación de ese respaldo se registra al completarse.
