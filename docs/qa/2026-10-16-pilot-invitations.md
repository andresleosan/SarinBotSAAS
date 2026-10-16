# Invitaciones del piloto: verificación local

Implementación en `codex/commercial-pilot-20261016`, worktree separado. Sin despliegue, cambios de tarifas reales, mensajes a invitados ni datos personales reales.

Verificación del 16 de octubre de 2026:

- 24 pruebas dirigidas de servicios, rutas, interfaz y adaptador: pasan. Incluyen código efímero, idempotencia, correo/Google, autorización por UID de servidor, suspensión, cuota histórica desconocida y rate limit concurrente.
- D1 real local con Workerd/R2: seis pruebas pasan, incluidas carreras entre dos códigos y entre canje/subida de recibo; conservación de consumo al configurar, cancelar, suspender, reactivar y pasar a plan semanal. Paginación por id de 51 invitaciones con igual fecha: 50 + 1, sin duplicados.
- Emulador oficial Firestore con Java 21: 21 pruebas de integración y reglas pasan, sin omisiones. Misma secuencia transaccional que D1; navegador sin permisos para invitaciones, órdenes o cambios de cortesía, incluidos perfiles administrativos falsos.
- TypeScript pasa. La suite general pasó después de integrar las pantallas; se corrigió el aislamiento de los componentes nuevos en tres suites administrativas anteriores.

La revisión visual con datos sintéticos está pendiente de la aceptación conjunta del piloto. Los tests de componentes no acreditan impresión ni comportamiento en un teléfono físico. No se ha generado ningún código real para entregar a clientes.

Compatibilidad: pruebas pagadas anteriores siguen válidas sin migración. Revertir a código que no comprenda `accessSuspended` puede ignorar una suspensión de cortesía: pausar admisiones/reservas antes de tal reversión y conservar documentos/contadores. No borrar datos para volver atrás.
