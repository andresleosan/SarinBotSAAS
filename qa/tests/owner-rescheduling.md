# Reprogramación del dueño: protocolo de QA

Usar solo un proyecto `demo-*`, identidades sintéticas y emuladores locales. Node 24, pnpm 11.23.0 y Java 21+. El motor, WhatsApp, pagos y mensajes externos no forman parte de este recorrido. Conservar el lockfile. Ejecutar desde el worktree reconciliado, nunca desde el checkout mixto E:.

## Preparación

- Negocio general, menores deshabilitados, dueño vigente y consentimiento sintético de cuenta activo.
- Dos recursos activos y uno retirado. Servicio actual de 30 minutos, preparación de 15 minutos y precio de 25.000 COP; cita original con precio histórico de 20.000 COP y metadatos adicionales.
- Una cita futura confirmada, una ocupación competidora, una cita con origen retirado, una cita de menor y una cita pasada. La política S09 incluye un cierre verificable; su escritor puede permanecer apagado.
- Un recibo preparado vencido sirve para observar el protocolo de cierre sin esperar diez minutos. Si se prepara por fixture, declarar qué campos son sintéticos: no acredita la validación de un destino vigente.
- Guardar inventario saneado de IDs/huellas y comprobar que el sembrado no sobrescribe documentos existentes. Una respuesta perdida requiere inspección; no repetir el sembrado a ciegas.

## Recorrido visible

1. Abrir la agenda como dueño y desplegar la cita futura. **Cambiar horario** consulta un origen fresco; no crea ni mueve la cita. La fecha inicial coincide con el origen, la hora está vacía y no se elige silenciosamente otro recurso.
2. Elegir fecha/recurso y **Consultar horarios**. Comprobar que no se ofrece una ocupación ni una hora que atraviese el margen o el cierre S09. Elegir una hora no crea propuesta ni confirmación.
3. **Revisar cambio** muestra Antes/Propuesto, fechas, profesional, precio anterior/actual y preparación. La propuesta no aparta el horario. No pide contacto ni repite respuestas privadas; no promete cobros o avisos externos.
4. Comprobar que la URL conserva sus parámetros ajenos y añade únicamente el ID opaco `ownerReschedule`. Cambiar día/filtro, polling o cerrar los detalles de la tarjeta conserva el mismo flujo. Cancelación, bloqueo, asistencia y una segunda entrada quedan bloqueados por referencias mientras corresponde.
5. **Confirmar cambio** conserva el ID, cliente, creador, metadatos y cuota; incrementa una revisión y escribe cita/locks/recibo atómicamente. La agenda invalida el rango anterior antes de la nueva lectura; el recibo permanece hasta cerrar.
6. Volver al primer recibo después de otro movimiento. Distinguir la prueba de aquel cambio de la posición, recurso, precio y estado actuales. **Ver día actualizado** solo navega por acción explícita.

## Recuperación y autoridad

- Perder o invalidar la respuesta de preparación: selección congelada, mismo requestId/cuerpo al reintentar. Salir de esta preparación no elimina su registro ni mueve la cita.
- Perder/invalidar una respuesta de confirmación después del commit: mostrar **Resultado por comprobar**, conservar la misma propuesta y bloquear una operación nueva. Una consulta GET puede coexistir con el POST pendiente; GET prepared y el reloj no liberan la barrera.
- Recargar la URL: solo GET autorizado; nunca proponer o confirmar automáticamente. Applied devuelve prueba original y cita actual. Closed verifica el cierre. Una URL prepared se trata conservadoramente hasta comprobar su misma confirmación.
- Abrir el recibo vencido: GET sigue prepared. El POST explícito de la misma confirmación persiste closed; consultar ese recibo permite resolver la incertidumbre. No lanzar dentro de la transacción después de escribir el cierre.
- Rechazo de dominio verificable en una primera confirmación, sin incertidumbre previa: permitir consultar el origen otra vez y retirar la referencia de la revisión descartada. Después de incertidumbre, un error aislado no sustituye el recibo.
- URL duplicada/vacía/malformada: error sin leer otro destino. URL externa durante un flujo: no sustituirlo; ofrecer solo un enlace validado para otra pestaña.
- Feature403: presentación privada oculta e inerte; escritores y cuerpos conservados. **Comprobar acceso** hace un GET propio acotado a 10 segundos. Mismo dueño renueva lecturas sin reenviar mutaciones; ausencia/otro dueño o denegación autoritativa purga el ámbito. UID/época/negocio nuevos rechazan callbacks anteriores.
- Leer histórico con plan vencido o consentimiento retirado; una escritura nueva mantiene sus barreras del servidor. Salud, menores y autorizaciones sensibles no tienen confirmación operativa en S07. El recorrido del cliente conserva sus endpoints y permisos.

## Accesibilidad y evidencia

Observar 320, 390 y 1280 px, teclado, labels, foco de paso, avisos y ausencia de desbordamiento horizontal. Intentar zoom nativo al 200%; distinguirlo de una emulación de viewport. Registrar explícitamente lo que no pudo observarse, incluyendo lector de pantalla o proveedor externo.

Guardar capturas sintéticas de revisión y resultado; no copiar contactos reales, tokens, cuerpos de conversación ni exports privados al repositorio. El reporte debe identificar SHA, comandos, exit codes, recuentos, omitidas y límites reales. No sumar dos veces suites solapadas.

## Gates de almacenamiento y entrega

Ejecutar suites de modelo/dominio/rutas/UI, carreras D1 con dos handles, Admin SDK y reglas reales del emulador, respaldo/reconciliación SQL/R2, regresiones de cliente/recordatorios, TypeScript, build y el check del Worker. Cubrir los cinco Review Focus del plan con evidencia independiente.

El Worker compatible con `ownerRescheduleProposals` precede a la aplicación; un Worker anterior debe rechazar sin writes parciales ni fallback a Firestore. No hay nueva migración o índice. Mantener una réplica, recibos y revisiones. Un rollback conserva el lector y enforcement S09; apagar su escritor no desactiva la política. No restaurar datos ni cuotas para simular una reversión de UI. Revisar el diff completo antes de integrar o publicar.
