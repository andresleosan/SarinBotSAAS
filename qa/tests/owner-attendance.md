# Resultados de atención: protocolo de aceptación

Ejecutar el núcleo P5 sobre la Agenda compuesta y datos sintéticos de `demo-sarin-bot`. Registrar resultados, commits y límites en `docs/qa/2026-10-24-owner-attendance.md`. Este protocolo no acredita ejecución. Quitar resultado queda fuera hasta la integración S12 prevista en el diseño.

## Modelo, autoridad y transacción

- Admitir Atendida/No asistió solamente al terminar `reservedUntilAt` guardado, incluyendo el margen. Probar antes, exactamente al límite y tras lecturas lentas/reintento. No reconstruir tiempos desde el catálogo actual.
- Distinguir metadato ausente de corrupto; conservar estados heredados sin inventar actor/fecha. Bloqueos, canceladas y datos no verificables no admiten escritura. Revisión máxima legible no puede incrementarse a un valor ilegible.
- Solo propietario vigente, incluso frente a superadmin; tenant/ID exactos. Lectura histórica sin nueva barrera de plan/consentimiento; escritura con consentimiento de cuenta.
- Registrar/corregir conserva cita, beneficiario, revisión de representación, precio, horario, cuotas y políticas. No aplica sanciones automáticas ni marca historial de ausencia del cliente.
- Una transacción escribe solamente cita, evento privado y locks aplicables. Lecturas preceden escrituras; versiones corruptas fallan cerradas.
- Mismo requestId/cuerpo recupera recibo sin nueva escritura; cuerpo distinto falla. Tras una corrección, replay devuelve recibo original y cita actual, sin revertirla.
- Probar competencia entre resultados/correcciones, cancelación, reprogramación preparada antes del inicio y revisión de representación. Ejecutar con memoria, dos handles D1 reales locales y Admin SDK en emulador.

## Historia, privacidad y recuperación

- GET/PATCH no-store, 401/403/404/428, cuerpo estricto hasta 2048 bytes, sin actor/fecha/texto libre aportados por cliente. GET solo acepta cursor canónico único; PATCH sin querystring.
- Cabeza y páginas válidas/contiguas; 45 eventos producen 20/20/5, sin duplicar al agregar una corrección concurrente. Huecos/corrupción/errores de almacenamiento producen error, nunca historial vacío.
- SDK de dueño, cliente, otra cuenta y anónimo deniega eventos privados. La cita legible contiene solo revisión/puntero, sin actor/motivo.
- Demostrar índice D1 `app_attendance_history` con consulta acotada y más de 1000 eventos ajenos. Verificar nueva allowlist y rechazo del Worker anterior sin escrituras parciales.
- Simular respuesta de commit perdida y fallo previo; journal/replay no duplican. Ida/vuelta y reconciliación conservan metadato, evento, ID, fingerprint y secuencia.
- Restaurar respaldo SQL/R2 sintético en almacenamiento local; comparar todas las filas y esquema. Rollback de aplicación conserva eventos/índices y los estados terminales.

## Interfaz y composición real

Fixture: dos dueños/negocios/clientes; cita finalizada con/sin margen, futura, margen pendiente, resultados heredados, recurso retirado, menor representado, cancelada y bloqueo. Solo datos sintéticos; sin inferencia, mensajes externos ni cobros.

- Seleccionar resultado no escribe. Revisión muestra resultado anterior/propuesto y requiere Confirmar resultado. Corrección explícita con motivo fijo Error al registrar; no mostrar Quitar resultado.
- Historial cerrado inicialmente; cargar solo al abrir/Actualizar/paginar, sin poller por tarjeta. Actor como Tú/Otro propietario y legado sin auditoría registrada.
- PATCH pendiente publica busy antes del fetch, bloquea navegación/filtros/bloqueo/cancelación mediante ref además de controles. Su propio disabled y cerrar details no abortan ni cambian comando/controller.
- Conservar historial ya cargado durante escritura; éxito invalida lecturas anteriores. Una respuesta tardía no puede restaurarlas ni reemplazar otra cita.
- Timeout PATCH 20 s conserva resultado desconocido y ofrece comprobación manual con cuerpo/requestId idénticos; GET 10 s. No reintentar automáticamente ni prometer deshacer.
- Cambios reales de UID/negocio/día/ID ocultan/descartan el ámbito anterior. 401/403 oculta historia; nueva revisión invalida solo borrador no enviado, conserva comando incierto ya enviado.
- Verificar 320/390/1280 px, controles 44 px, labels, teclado/foco, aria-busy y aria-live. Comprobar zoom nativo al 200 % por separado; viewport no lo sustituye.
- Mantener flujos de cliente, recordatorios, beneficiario/revisión y busy local de políticas/representación. No crear un segundo GET diario.

## Publicación

Suite focal y completa, tipos, build, reglas/Admin SDK emulados y check Cloudflare. Revisión independiente de implementación y composición; no sumar recuentos solapados.

Antes de publicar: reconciliar commit/base/runtime, respaldo privado restaurable y una réplica; aplicar índice aditivo y Worker compatible antes del nuevo Container escritor. Mantener el procedimiento de mantenimiento verificado para la operación. El workflow habitual publica el `main` autorizado después de sus gates; verificar SHA/imagen/Worker/Container/Pages efectivos. No restaurar un respaldo antiguo sobre actividad posterior para revertir una interfaz.

Cerrar solo procesos/pestañas propios, restaurar interceptores/viewport y comprobar puertos libres. Separar evidencia de navegador, pruebas locales y observación de producción; no probar esta función creando citas reales.
