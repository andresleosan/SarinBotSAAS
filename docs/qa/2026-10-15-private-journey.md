# QA privada: administración y ciclo de reservas

Fecha: 15 de octubre de 2026, Colombia (observaciones UTC del 16 de octubre). La aplicación se probó mediante el acceso privado de la VPS en `localhost:3032`, con Ollama en la Mac. Esto no publica el panel ni el enlace del negocio en Internet.

## Identidad y permisos

Se verificó por correo exacto la cuenta principal indicada por el usuario: Google vinculado, correo verificado y cuenta habilitada. Se asignó únicamente su UID a `SUPERADMIN_UID`, con respaldo privado, conservando la imagen, Compose, DNS y proveedor. La sesión real pudo abrir administración y Vault; ambos mostraron el motor local disponible. Antes y después pasaron 16 comprobaciones HTTP 401 con solicitudes anónimas o tokens inválidos.

Una segunda cuenta propia, también indicada por el usuario, inició sesión normalmente con Google. La lectura limitada de Firebase confirmó `role=user`, `isSuperadmin=false`, UID distinto del administrador y ausencia de negocio. Las pantallas `/admin` y `/admin/vault` mostraron «Acceso restringido». Estas comprobaciones de UI no equivalen a una prueba HTTP 403 con un token válido de esa cuenta; no se extrajeron tokens del navegador ni se fabricaron sesiones.

## Negocio de ensayo

El usuario autorizó usar la segunda cuenta para el negocio de prueba y proporcionó un WhatsApp controlado después de conocer que el guardado iniciaría siete días de prueba y reservaría el enlace. El contacto y las identidades permanecen fuera de Git.

Se creó `Sarin Pruebas` mediante el chat de onboarding, tras revisar el resumen y confirmar el guardado. La lectura posterior confirmó los vínculos entre negocio, perfil, índice del slug y proyección pública; un recurso activo, un servicio de 30 minutos, buffer de 10 minutos y precio de 30.000 COP; lunes a sábado 09:00–17:00 y domingo cerrado. La prueba dura exactamente siete días desde la creación. No hay período pagado.

## Recorrido comprobado

La cita y los bloqueos se probaron para el 16 de octubre de 2026, hora Colombia.

| Comprobación | Resultado observado |
| --- | --- |
| QR desde la UI | SVG descargado, 4.164 bytes, título del negocio y dos elementos de trazado |
| Consulta previa a reservar | 10:00 disponible; HTTP 200 |
| Reserva confirmada por chat | Una cita 10:00–10:30, con buffer hasta 10:40; apareció en cliente y agenda |
| Descarga de calendario | Un evento `.ics`; inicio `20261016T150000Z`, fin `20261016T153000Z`, servicio y negocio correctos |
| Bloqueo 10:00–10:40 con la cita activa | HTTP 409 y «El bloqueo se cruza con una cita activa»; no se creó otro documento |
| Cancelación de la cita | HTTP 200; desapareció de próximas citas del cliente y quedó cancelada en la agenda |
| Consulta después de cancelar | 10:00 disponible otra vez; HTTP 200 |
| Creación de bloqueo 10:00–10:40 | HTTP 201; apareció como bloqueado |
| Consulta durante el bloqueo | 10:00 no disponible; primera opción posterior 10:45; HTTP 200 |
| Cancelación del bloqueo | HTTP 200; quedó cancelado |
| Consulta final | 10:00 disponible de nuevo; HTTP 200 |

La lectura final encontró exactamente dos documentos del día: una cita y un bloqueo, ambos `cancelled_by_owner`; cero activos, sin duplicados y cero comprobantes de pago. No se eliminaron documentos ni el negocio; se conserva el historial. No se enviaron mensajes de WhatsApp ni se importó el calendario descargado.

Las cinco respuestas de chat de cliente medidas tardaron aproximadamente 10,1–19,4 segundos hasta recibir las cabeceras HTTP. Es una muestra funcional secuencial, no una prueba de carga ni un compromiso de latencia. La misma cuenta QA actuó como dueño y cliente; el aislamiento entre distintos dueños debe distinguirse de este recorrido.

## Hallazgo de confirmación

En la primera reserva, el modelo repitió un nombre de prueba escrito en el mensaje, aunque el servidor guardó correctamente el nombre de la cuenta autenticada. La herramienta sí había devuelto la cita con el nombre real. El problema era la explicación libre del modelo, no la identidad almacenada.

La corrección hace que la confirmación de `crear_cita` se derive del objeto realmente devuelto por el servidor y prevalezca sobre una explicación contradictoria. También respeta el estado cancelado de una reserva idempotente. Conserva el esquema, la identidad autenticada, los resultados de herramientas y la explicación del modelo para consultas sin reserva. El texto se renderiza mediante JSX, con caracteres literales y sin insertar HTML.

La regresión reprodujo primero los fallos de explicación contradictoria y reconfirmación de canceladas; también comprobó el fallback cuando falla el modelo y los nombres con caracteres especiales. Resultado local: 24 pruebas dirigidas aprobadas, TypeScript correcto, suite completa con 238 aprobadas y 8 omitidas, y revisión independiente sin bloqueadores. La actualización de la imagen y su verificación real se registrarán después de completarse.

## Evidencia y límites

La evidencia con identidades, contactos, capturas y respaldos está fuera de Git, en `%LOCALAPPDATA%/SarinBot/deployment`. Los resúmenes incluyen `sarin-admin-assignment-verification-20261016.json`, `sarin-qa-account-after-login-20261016T001107Z.json`, `sarin-qa-business-persisted-20261016T001338Z.json`, `sarin-qa-final-cancelled-20261016T001828Z.json` y `sarin-qa-http-results-20261016.json`.

La publicación HTTPS/OAuth definitiva, facturación real, carga concurrente, restauración de datos y pruebas de recuperación pendientes conservan su alcance anterior. El QR descargado apunta al origen privado de la prueba y debe regenerarse desde el dominio público definitivo. Vault solo se verificó en acceso y salud; no se probaron aquí visión, importación ni exportación. DeepSeek continúa como opción manual; Gemini sigue inactivo. No se reinició la Mac ni se cambió la delegación DNS.
