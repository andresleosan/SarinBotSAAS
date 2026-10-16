# Tarifas semanal, quincenal y mensual

El usuario sustituyó la mensualidad del piloto por tres opciones: 7 días por 20.000 COP, 15 días por 35.000 COP y 30 días por 59.900 COP. Son períodos fijos de acceso; la prueba gratuita inicial de siete días conserva sus reglas.

La pantalla de suscripción permite elegir el período y administración permite configurar sus tres precios. Cada comprobante nuevo conserva `planId`, `periodDays` y el importe calculado por el servidor. Aprobarlo agrega sus días al período vigente, o empieza desde la aprobación si estaba vencido. Repetir la aprobación no duplica el acceso. Los comprobantes anteriores sin esos campos conservan su importe original y 30 días; no se migran.

Los precios persistidos tienen prioridad sobre los valores iniciales del entorno. Un cliente administrativo anterior que omita las tarifas nuevas conserva los valores actuales. La selección se bloquea durante la preparación y envío de la imagen y mientras haya un comprobante pendiente; ese pendiente muestra su importe y duración guardados.

## Verificación del código

- Regresiones observadas antes de implementar: backend 25 fallos y UI 7 fallos; los tres casos nuevos de Firestore rechazaban `planId`.
- `pnpm run typecheck`: correcto.
- `pnpm test`: 280 pruebas aprobadas y 11 omitidas, incluidas 7 de UI.
- `pnpm run test:rules` con Java 21: 10 pruebas aprobadas. Los tres planes se envían y aprueban concurrentemente contra Firestore emulado, sin duplicación ni cambios retroactivos al modificar las tarifas.
- `pnpm run test:journey --port 3040`: 68 comprobaciones correctas. Incluye rechazo de precio/duración manipulados, permisos de propietario y administrador, pago semanal y renovaciones de 15 y 30 días, además del recorrido de reservas. Limpieza de sus datos sintéticos verificada.
- `pnpm audit --audit-level=high`: sin vulnerabilidades conocidas.
- Revisión independiente de backend, contrato y permisos: sin bloqueadores.

Estas pruebas usan exclusivamente datos sintéticos. No se han enviado ni aprobado comprobantes reales. Bancolombia y Nequi siguen previstos sin cuentas receptoras configuradas.

## Actualización y reversión

La actualización de la instancia privada requiere una imagen del commit revisado y un respaldo del documento `platformSettings/main`. Se cambian solo los tres campos de precio mediante transacción con precondición de versión y lectura posterior. El procedimiento está preparado fuera de Git; la publicación pública no forma parte de este cambio.

La reversión de precios es independiente de la imagen y rechaza ediciones posteriores. Una imagen anterior solo conoce 30 días: no debe aprobar comprobantes nuevos de 7 o 15 días. Ver [procedimiento de despliegue](../../deploy/README.md#planes-de-suscripción-y-actualización-de-precios).
