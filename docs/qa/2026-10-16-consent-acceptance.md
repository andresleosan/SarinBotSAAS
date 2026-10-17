# Aceptación técnica local — condiciones y autorización de datos

16 de octubre de 2026. Fuentes de runtime: `89114cc`, sobre `31456a3`, rama `codex/commercial-pilot-20261016`. [Plan](../superpowers/plans/2026-10-16-consent.md), [revisión jurídica y decisiones pendientes](../product/2026-10-16-legal-consent-review.md).

**Resultado:** control implementado localmente y probado con datos sintéticos. No publicado. Las imágenes anteriores del piloto no incluyen este incremento; posteriormente se construyó y comprobó una [imagen actual de la revisión exacta](2026-10-16-consent-release.md). El funcionamiento técnico no cierra conservación, contratos de proveedores, identificación de cada establecimiento ni supuestos de salud/menores.

## Comportamiento verificado

- Dos decisiones independientes, desmarcadas: condiciones de uso y autorización de datos. Documentos públicos en `/terminos` y `/privacidad`, disponibles sin autenticar.
- El acceso principal obtiene una prueba firmada antes de Google y la vincula una sola vez a la cuenta resultante. Vigencia de veinte minutos, sin identidad ni escrituras anónimas en base de datos. Un reinicio exige repetir pruebas pendientes, sin perder constancias guardadas.
- Iniciar sesión para consultar citas o ejercer derechos no equivale a aceptar. GET de sesión no crea ni actualiza perfiles; la aceptación explícita de cuenta materializa un perfil nuevo. Cuentas anteriores conservan datos y requieren su propia decisión para nuevas operaciones.
- Autorización de cuenta por UID; autorización del cliente por UID y negocio concreto. Se muestra el nombre/contacto del negocio y el aviso de IA. La decisión del dueño no cubre a sus clientes ni a otros negocios.
- Constancias privadas con textos completos, versiones, huellas, finalidades, acción, revisión y fechas del servidor; descarga desde la cuenta. No contienen cuerpos de conversación ni IP. Guardarlas no crea un pago ni modifica cupos comerciales.
- Se exige vigencia antes de nueva IA y admisión, al salir de la cola y dentro de la reserva transaccional de cuota; nuevas propuestas/citas y mutaciones comerciales comprueban el estado antes de escribir. Falta de autorización devuelve `428 CONSENT_REQUIRED`; un estado corrupto falla cerrado.
- Revocación y cita nueva compiten por el estado de autorización en la misma transacción. Historial, cancelación y recuperación de operaciones guardadas siguen disponibles. Un replay de aceptación no reactiva una autorización retirada.
- La retirada local detiene nuevos lotes y confirmaciones, aborta respuestas tardías y conserva mensajes visibles. Un GET anterior no reabre el trabajo mientras se confirma la retirada o su resultado es incierto; reintentar conserva el identificador de esa decisión. Un token de otra cuenta no puede enviar la decisión del UID anterior.

## Validación

| Comprobación | Resultado |
| --- | --- |
| Aplicación completa, revisión final | **827 aprobadas / 25 omitidas**, 92 archivos aprobados y cuatro omitidos; salida 0. |
| Build Next final | Correcto; incluye compilación TypeScript, prerender público de Términos/Privacidad y endpoints de consentimiento. |
| TypeScript independiente | Salida 0 en la fuente final; el build final también comprueba los tipos. |
| D1 local real | Diez pruebas de almacenamiento comercial y dos de recorrido de abuso pasan dentro de la suite; los actores aceptan explícitamente antes de operar. No se modifica el adaptador genérico para simular aceptación. |
| Firestore oficial aislado | **23 aprobadas**, dos archivos, salida 0 en la fuente final; 87,38 segundos. Runner 8188 cerrado. |
| Navegador Chrome | Cuenta de dueño y cliente emulados; aceptación y retirada en servidor; negocio identificado, entrada de chat deshabilitada al retirar y Mis citas accesible. Escritorio y viewport 390 × 844; viewport restaurado. |
| Revisión independiente | Un P2 de retirada/polling reproducido y corregido con regresión; sin otros P1/P2 reportados en el rango revisado. Los ajustes posteriores se verifican con sus regresiones y la suite completa. |

Logs ignorados en `.superpowers/sdd/2026-10-16-consent/`: `verified-app.log`, `verified-build.log`, `verified-types.log`, `review-red.log`, `review-green.log`, `gateway-origin-red.log`, `gateway-origin-green.log`, `canonical-red.log`, `canonical-green.log`, `verified-firestore.log` y los ensayos previos. No se suman suites focalizadas al conteo completo.

La primera corrida de Firestore terminó 22/23 por timeout de quince segundos y bloqueo transaccional del emulador durante un build concurrente. La repetición sin cambiar código ni timeout pasó 23/23 en 65,61 segundos; después del ajuste final de huellas pasó de nuevo 23/23 en 87,38 segundos. No se oculta el fallo inicial ni se relajan las aserciones.

Regresiones de cierre: retirada mientras una lectura devuelve la revisión anterior; identidad que cambia durante obtención de token; URL interna de Next distinta del Host del navegador; Host reescrito por Pages frente al origen público configurado; mapa de constancia con idéntico contenido y claves reordenadas. Se detectan cambios reales del texto. La huella usa claves canónicas y conserva el orden de los arrays: Firestore documenta que [ordena las claves de los mapas](https://firebase.google.com/docs/firestore/manage-data/data-types).

## Evidencia visual

Todas las capturas son del proyecto aislado `demo-sarin-bot`, con cuentas y negocio ficticios. No se conectó un motor de IA ni se envió un mensaje para inferencia; el aviso de desconexión corresponde al entorno de prueba.

- [Acceso con las dos decisiones desmarcadas](2026-10-16-consent-login.png).
- [Constancia de cuenta y control de retirada](2026-10-16-consent-accepted.png).
- [Aviso específico de negocio en móvil](2026-10-16-consent-client-mobile.png).
- [Constancia del cliente para su negocio](2026-10-16-consent-client-accepted.png).
- [Mis citas accesible tras retirar la autorización](2026-10-16-consent-history.png).

## Almacenamiento y reversión

Se usan documentos privados existentes de `serverSettings`: `consent_state_<hash>`, `consent_receipt_<hash>` y `consent_claim_<hash>`. Estado y constancia se guardan en la misma transacción; las constancias se crean sin sobrescritura y la revisión esperada evita aplicar decisiones de una pestaña anterior. El protocolo D1 y las reglas de acceso de cliente no se amplían. No hay migración destructiva ni cambio de backend.

Conservar estos documentos y constancias en respaldos/restauraciones. No borrarlos para simular consentimiento ni volver a habilitar una autorización. Una imagen anterior que no aplique el control solo puede usarse bajo mantenimiento mientras se resuelve la regresión; no reabrir procesamiento atribuyendo aceptación a usuarios históricos. Antes de publicar, reconstruir la imagen con esta fuente, comprobar `SARIN_PUBLIC_BOOKING_ORIGIN` —el mismo origen canónico de los QR— y ejecutar los pasos de respaldo y mantenimiento del release.

Los servicios de QA y emuladores iniciados aquí se cerraron. No se cambió producción, no se emitieron invitaciones reales, no hubo llamadas pagadas de IA ni se modificaron límites de gasto. El presupuesto de IA y la publicación siguen pendientes de explicación/decisión del propietario.
