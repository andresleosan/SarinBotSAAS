# Equipo por negocio: protocolo de QA de fase 1

Fuente normativa: [diseño](../../docs/superpowers/specs/2026-10-22-business-team-permissions-design.md) y [plan S13](../../docs/superpowers/plans/2026-10-22-business-team-permissions.md). Este documento describe escenarios; sus resultados se registran por separado en el [reporte de ejecución](../../docs/qa/2026-10-22-business-team-permissions.md). Un escenario descrito aquí no acredita que se haya observado.

## Preparación y alcance

Usar una copia reconciliada y aislada, Node 24, pnpm 11.23.0, Java 21+ y un proyecto Firebase `demo-*`. Conservar lockfile, datos y evidencia anteriores. Una sola réplica de la aplicación; la cola de inferencia es local al proceso. No usar cuentas, citas o contactos reales, canales externos, pagos ni inferencia. El único hostname autorizado del motor es `alsdevstudio.com`; este recorrido no necesita consultarlo.

Preparar cinco identidades sintéticas autenticadas y distintas: dueño, colaborador, cliente, otro dueño y superadministrador. Una membresía nunca convierte su cuenta en dueño, recurso ni administrador. Conservar por separado la identidad de cada sesión; para probar retiro reutilizar exactamente el mismo JWT aún válido y registrar únicamente su huella, nunca el token.

Preparar un negocio configurado general, sin menores habilitados, consentimientos actuales de dueño y colaborador, plan permitido para solicitar/aprobar, dos recursos activos y otro inactivo. Sembrar citas y un bloqueo del recurso asignado con marcadores privados en nombre, contacto, menor, intake, precio y `serviceName`; incluir otra cita en el recurso ajeno y una cita propia del colaborador como cliente. Los marcadores prueban exclusión, no son datos que la agenda de equipo deba mostrar. Registrar inventario y hashes previos de negocio/citas, evitando sobrescrituras y duplicación del sembrado.

Mantener `SARIN_TEAM_ACCESS_ENABLED=false` por defecto. Habilitarlo solo en el proceso local de prueba para el recorrido positivo; declarar explícitamente esta excepción. No tocar la configuración desplegada. Ejecutar el build antes de arrancar Next dev; no reconstruir `.next` mientras se usa el servidor de QA. No iniciar otra réplica para una sesión distinta.

## Solicitud, aprobación y lectura visible

1. Como colaborador, abrir `/team`, comprobar el UID propio y buscar el slug público. Antes de aprobar debe decir que todavía no tiene acceso. Solicitar produce `requested`, sin recurso o rol elegidos por el solicitante y sin acceso a la agenda.
2. Como dueño, entrar en `/dashboard/team` desde Mi negocio en una pestaña explícita; el borrador agregado de configuración debe conservarse. Revisar la cuenta exacta, escoger un recurso propio activo y confirmar el permiso cerrado `own_agenda_viewer`, versión 1. Ver revisión y resultado; no mostrar casillas de capacidades futuras.
3. Volver a la sesión del colaborador, revalidar y abrir `/team/[businessId]`. La petición real debe usar `?date=YYYY-MM-DD`. El DTO conserva `dateKey`; comprobar ambas interfaces para detectar mocks que repitan un parámetro incorrecto.
4. Mostrar únicamente recurso asignado, fecha, hora de comprobación y filas `Reserva`/`Tiempo bloqueado`, con su estado. No mostrar servicio, razón del bloqueo, contacto, cliente, menor, intake, precio, audit trail ni disponibilidad inferida. Otro recurso queda excluido. Un día autorizado sin filas se distingue de red fallida, denegación o fuente corrupta.
5. Cambiar el día dentro de hoy a hoy+31 (Colombia). Fechas fuera del rango, parámetros duplicados/desconocidos y `resourceId`, UID o `view=all` manipulados deben rechazarse. Una agenda con 1000 filas coincidentes devuelve 413, sin truncado exitoso.

## Revocación, cambios de autoridad y recuperación

- Con pestaña del colaborador abierta y JWT válido, revocar desde el dueño. La siguiente lectura con el mismo JWT se deniega; al revalidar la UI oculta datos. No prometer que se borró información que ya vio antes de la revocación. Repetir con transferencia de dueño, clasificación salud/menores, recurso inactivo y consentimiento retirado; distinguir casos nativos de casos cubiertos por dominio/backend.
- Una respuesta vieja que llega después de una denegación o de cambiar UID/época/negocio no debe restaurar datos. Verificar foco, visibilidad, polling de 15 s sin solapar, timeout de lectura de 10 s y fecha de la última comprobación. La red caída no autoriza datos ni fabrica huecos libres.
- Solicitar/aprobar requiere plan y consentimientos vigentes. La agenda no exige plan activo, pero sí consentimientos actuales de ambas cuentas, clasificación, dueño aprobador y recurso. Las lecturas propias/de relación del dueño, rechazo, revocación y salida siguen disponibles con gate, plan o consentimiento pausados.
- Retener o perder la respuesta de una mutación después del commit: el aviso blando de 20 s no aborta la escritura. Conservar comando sellado, requestId, hash, cuerpo, objetivo y revisiones; bloquear un comando distinto mientras el resultado sea desconocido. GET ausente, tiempo transcurrido y estado actual por sí solos no prueban fracaso.
- Comprobar recibo del actor y comando exactos. Un recibo anterior acredita aplicación histórica, no acceso vigente. La prueba de dueño debe ligarse al objetivo mediante evento reciente; fuera de los últimos 20 eventos mantener incertidumbre y ofrecer replay PATCH del objetivo exacto. Replay después de revocar devuelve prueba anterior y estado actual revocado, sin restaurar roles.
- Probar dos aprobaciones con las mismas revisiones, el cupo activo 30 y la solicitud pendiente 30, rate limits 5/UID/24 h, 30/negocio/24 h y un intento por par/24 h. Retiro/rechazo/revocación quedan fuera del rate limit. Contadores/head ausentes o corruptos fallan cerrados; no repararlos con scripts para obtener verde.

## Denegaciones y privacidad

Con membresía realmente activa, recorrer los handlers actuales con entradas válidas y comprobar 403 por dueño exacto, sin aceptar 404 como prueba: configuración/logo/QR, política de cliente, horarios de recursos, bloqueos y acciones sobre citas, asistencia, revisión de representación, CRM, FAQ, resumen S17, gestión de equipo, S07/S10 de reprogramación, espera/ofertas y copiloto del dueño. Ser superadministrador de plataforma tampoco concede la propiedad del negocio. El acceso propio e independiente del administrador conserva su política existente.

La membresía no concede módulos de plataforma, imágenes/recibos de pago ajenos, exportación, informes, cobros o contactos. Para capacidades futuras que todavía no tienen ruta, 404 solo demuestra ausencia de ruta: diseñar autorización y pruebas antes de implementarlas. Como cliente legítimo, la cuenta conserva exclusivamente sus propias citas y sus acciones autorizadas; nunca las de otra persona por compartir recurso.

Desde el SDK Firebase autenticado como colaborador activo, negar documento/query de membresías, eventos de equipo y citas de terceros, así como escritura forjada. Primero demostrar que el Admin API proyectado sí devuelve la agenda permitida; una ausencia de datos no prueba denegación de reglas. No incluir UID ajeno en URL, tokens, cuerpos privados, contactos o citas completas en logs, almacenamiento del navegador o capturas.

## Backends, accesibilidad y conservación

Ejecutar casos transaccionales sobre D1 real local con dos handles y un solo runtime, y Admin SDK sobre emulador oficial. Cubrir CAS, commit aplicado con respuesta perdida, head/estado/counters coherentes y lectura posterior a retiro. Declarar la semántica real de snapshot: una transacción Firestore readOnly pausada puede devolver el snapshot autorizado anterior; eso no implica permiso para la siguiente lectura.

Capturar SQL producido por los lectores reales y su `EXPLAIN QUERY PLAN`: listado propio cap 21 usa `app_team_member`, roster cap 31 usa `app_team_business_status`, eventos cap 20 usa `app_team_events_sequence`, sin scan global ni sort temporal. Probar 1001 eventos válidos y devolver solo los últimos 20. El emulador no acredita índices Firestore desplegados.

Verificar migración/reconciliación inversa y backup SQL sintéticos, con importación a D1 limpio y lectura real posterior de membresía, estado y eventos. Disponer secuencialmente runtime fuente, runtime del verificador y runtime de restore. Conservar respaldos y sus hashes fuera de Git.

Observar 320, 390 y 1280 px; teclado, foco al revisar/cancelar/volver, etiquetas, avisos y desbordamiento horizontal. Distinguir zoom nativo 200% de cambiar el viewport. Registrar capturas únicamente sintéticas y señalar lo no observado, incluido lector de pantalla o proveedor externo. Hashes finales deben acreditar negocio/citas conservados; las mutaciones esperadas de equipo se registran por separado.

## Gates y entrega posterior

Registrar tipos, build real, suite integrada y check Worker con comandos, exit codes, recuentos y skips exactos. Si falla un wrapper pnpm, conservar el fallo y describir el equivalente nativo ejecutado; no llamarlo un `pnpm` verde. Reutilizar checks aceptados sin repetirlos solo después de comparar inventario y bytes pertinentes. No sumar suites solapadas ni atribuir al run unitario los casos emulador omitidos.

Revisión independiente de los cinco Review Focus antes de cualquier activación. Cerrar solo fase 1. Fases 2/3 necesitan diseño/plan propios, scopes, DTO y pruebas de retiro. Desplegar Worker/protocolo e índices aditivos compatibles antes de la app; activar gate requiere decisión posterior explícita. El rollback mantiene lector/enforcement S09, membresías, estado, eventos/recibos e índices; gatefalse suspende nuevas solicitudes/aprobaciones/agenda y conserva relaciones y retiro. No borrar evidencia, reparar counters, promover roles ni restaurar citas para aparentar una reversión.

## Suplemento operativo observado el 26 de octubre de 2026, 03:26–03:49 UTC

El [suplemento de ejecución](../../docs/qa/2026-10-22-business-team-permissions.md#suplemento-cronológico-continuación-nativa-de-0326-a-0349-utc) separa lo observado de estos escenarios generales. Conserva el intento anterior detenido por URL no verificable; no lo convierte retroactivamente en éxito. El recorrido principal nativo tiene evidencia de solicitud/aprobación, aviso de 20 s y GET de recibo mientras PATCH está retenido, agenda mínima, 320/390/1280, foco por Enter, zoom nativo confirmado y revocación con el mismo JWT. El suplemento y la rama todavía requieren revisión independiente; no es autorización de release.

- Si una continuación necesita restaurar el estado ya observado, importar una copia exacta del snapshot a un emulador nuevo vacío con inventario/hash e identidades sintéticas comprobadas. Registrar que fue restore, no nueva ejecución del request/approve; conservar la fuente y no repetir comandos para obtener la misma pantalla. La continuación observada restauró 32 documentos y cinco identidades una sola vez, con cero comandos de dominio repetidos.
- Registrar viewport y ancho de contenido por cada pestaña. Una captura rotulada 320 puede haber seguido en 1816 px; una captura efectiva 320 durante carga no acredita su contenido. En el run final, ancho de contenido nunca superó el viewport en los seis casos dueño/colaborador.
- Limpiar el override de viewport antes del zoom nativo. Confirmar el porcentaje aplicado y métricas, y conservar fallos de atajos. La evidencia válida de 200% usa confirmación del usuario, DPR 1→2 y ancho interior 1816→908; no usar la imagen previa mal nombrada que seguía a 100%.
- Comprobar Enter en revisión y cancelación, registrando destino de foco h2/botón. No atribuir al lector de pantalla una comprobación de foco DOM; lector de pantalla sigue no observado.
- Distinguir respuestas 400 de una fecha intermedia editada y la denegación 403 con fecha válida. Registrar igualdad de huella del JWT y DOM sin filas/recurso después del retiro, sin persistir el JWT.
- Para probar un body viejo después de denegación debe existir evidencia de que ese body llegó. En la continuación observada Chrome canceló la intercepción y continuar produjo `InvalidInterceptionId`: se documenta cancelación, no entrega tardía. La regresión automatizada que ignora abort cubre otro nivel; no sustituye esa observación de navegador.
- Conservar cualquier texto de resultado aparentemente contradictorio para revisión. El primer run mostró «Resultado sin confirmar» junto a constancia verificada tras abortar el PATCH; está registrado para juicio integrado, sin corrección ni clasificación inventada.

Los screenshots/DOM sintéticos y los snapshots originales quedan fuera de Git. Mantener hashes de JSON canónico de negocio/citas, estado/eventos finales y cierre del harness; no llamar a esas comparaciones igualdad de bytes binarios de la base. Otros casos de esta guía y proveedores externos siguen sin aceptación nativa cuando no tengan un resultado concreto en el reporte.
