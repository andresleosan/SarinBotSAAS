# Recordatorios de citas — aceptación del incremento

Base de comparación v18; incremento publicado como v19. Diseño aprobado: un aviso24h, opt-in por cuenta/negocio, visto persistente y permisos vigentes. Todo dato de acción es sintético en `demo-sarin-bot` y loopback. No aceptar permisos ni crear, mover o cancelar citas reales. Resultados y límites: `docs/qa/2026-10-17-in-app-reminders.md`.

## Contratos automatizados

- Cuenta y negocio ajenos nunca leen ni marcan el aviso. UID procede del token; cuerpos y parámetros desconocidos se rechazan, no-store en éxito/error.
- Ventana inclusiva24h/exclusiva inicio. Creación dentro de la ventana, citas antiguas, canceladas, manuales y revisión corrupta.
- GET sin escrituras y consulta propia/confirmada/futura limitada; exceso devuelve error explícito. Proyección solo IDs/revisión/inicio/antelación/visto.
- Preferencia inicialmente apagada; guardar revisión esperada; apagar sigue disponible tras retirar permisos; retirar y reaceptar no reactiva hasta decisión explícita.
- Visto idéntico es idempotente y conserva hora. Reschedule/cancel concurrentes y A→B→A no permiten sustituir recibo con una ocurrencia obsoleta. Respuesta perdida recupera la misma operación.
- Marcar visto deja intacto Appointment y cualquier fingerprint/propuesta de cambio pendiente.
- D1 local real, dos conexiones, conflicto global y journal. Exportar/borrar/verificar ausencia para cita/cuenta/negocio, preservando vecinos.
- UI: cambios UID/negocio, handlers retenidos, abortos/respuestas tardías, error sin vacío falso, latch del mismo evento, reloj servidor, polling únicamente visible, no aceptación de permisos ni notificaciones externas.
- Mantenimiento: GET exacto de sesión con Bearer llega a la autenticación; variantes, métodos y tráfico de negocio siguen cerrados.

## Navegador local

- [ ]320px: sección legible y sin overflow, apagada al iniciar, texto claro sobre24h y apertura de pantalla.
- [ ] Activar con teclado; confirmar aviso genérico con fecha/hora Colombia y sin servicio/contacto/beneficiario/intake copiados.
- [ ] Recargar: preferencia persiste y el aviso sigue pendiente; abrir/desplazarse no marca visto.
- [ ] «Ver cita» cambia a Próximas y enfoca tarjeta canónica; no altera la reserva ni abandona operación bloqueada.
- [ ] Marcar visto explícito: pasa a grupo plegable, persiste tras recarga y un reintento no cambia seenAt.
- [ ]390px: reprogramar la misma cita a otro horario dentro24h; el aviso nuevo usa horario/revisión nuevos y no hereda visto.
- [ ] Propuesta de cambio pendiente no se invalida por lectura/visto; comprobar estado por fixture/contratos.
- [ ] Cancelar: desaparece aviso y la cita figura cancelada; cero citas nuevas de navegador.
- [ ] Desactivar: oculta inmediatamente y persiste tras recarga; recibo y cita conservados.
- [ ] Error GET controlado: error/reintento visible, no mensaje vacío; restaurar red y recuperar.
- [ ] Pérdida controlada de respuesta de preferencia: reconciliar GET, no repetir el PATCH antiguo.
- [ ] Cambiar cuenta/salir: no quedan recordatorios personales; respetar sesión administrativa productiva en otra pestaña.
- [ ]1280px y foco/teclado/contraste; sin permisos de notificaciones solicitados.
- [ ] Guardar capturas sintéticas, registrar verificaciones del fixture y limpiar solo sus documentos; detener procesos propios y restablecer viewport.

## Publicación

Revisión independiente, regresión completa y artefacto congelado antes del despliegue autorizado. Fuente/imagen verificadas, v18 preservada, sin cambio de secretos. Mantenimiento → cola auténtica vacía → respaldo privado D1/R2 verificado → índice aditivo0002 y hashes de documentos intactos → singleton nuevo/antiguos0 → cola de candidato vacía → reapertura → comprobación auténtica y HTTP/UI con límites explícitos. Guardar captura final y conservar acceso administrativo.
