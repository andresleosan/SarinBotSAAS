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

## Resultado en la instancia privada

El commit `7ad5b74f204caeaa52d51632b0d7c50cf7a4f0bb` pasó los tres trabajos de [CI](https://github.com/andresleosan/SarinBotSAAS/actions/runs/38831479637). Se construyó desde 86 archivos de ese commit y se activó la imagen `sarin-bot:billing-plans-20261016t004732z`, ID `sha256:5f7c17924335b84d0be3974b911fd086378f641cddb7893d5324fe4e7d283cbc`. Antes y después pasaron las 16 comprobaciones de autenticación, páginas/assets, lecturas Firebase y conexión privada a Ollama. El entorno, administrador, proveedor, DNS y montaje ADC permanecieron intactos.

Con respaldo privado y precondición de versión se sustituyó el documento de un campo mensual por los tres precios aprobados; la lectura posterior confirmó exactamente esos valores. No se accedió a documentos de pagos ni negocios en esta operación. No se añadieron cuentas bancarias.

La sesión normal de QA en `localhost:3032/dashboard/billing` mostró los tres precios correctos y la prueba gratuita intacta. Elegir Semanal cambió el total y resumen a 20.000 COP/7 días; Quincenal a 35.000 COP/15 días; Mensual a 59.900 COP/30 días. Sin cuentas receptoras, la carga y envío permanecen deshabilitados. El historial continúa vacío. Captura y evidencia de activación quedan fuera de Git: `%LOCALAPPDATA%/SarinBot/deployment/sarin-three-billing-plans-20261016.png` y `sarin-billing-plans-activation-20261016.json`.

El servidor local con Turbopack presentó recargas continuas que interrumpían la herramienta del navegador; el recorrido HTTP con emuladores sí pasó. No se atribuyó ni corrigió ese comportamiento como parte de facturación. La comprobación visual final se realizó en la instancia privada compilada, donde la carga y selección funcionaron correctamente. No se abrió la aplicación al público ni se reinició la Mac.

## Cuentas receptoras configuradas

Después de recibir los datos autorizados del propietario se configuraron Bancolombia Ahorros y Nequi en la instancia privada. Se añadió únicamente `bankAccounts`, con respaldo previo, precondición de versión, lectura exacta posterior y revisión independiente del procedimiento. Los tres precios permanecieron intactos. La operación no accedió a documentos de pagos ni negocios y no requirió otra imagen.

La pantalla de suscripción mostró las dos cuentas con el titular y números proporcionados, permitió elegir Nequi y habilitó la selección de captura. Enviar comprobante sigue deshabilitado hasta adjuntar una imagen. El historial continúa vacío. No se realizó una transferencia ni se verificó la titularidad con las entidades financieras.

Los datos bancarios completos, la captura, el respaldo y las instrucciones de reversión permanecen fuera de Git. Evidencia privada: `sarin-bank-accounts-configured-20261016.json`, `sarin-payment-accounts-20261016.png` y `sarin-bank-accounts-rollback-20261016.md`, en `%LOCALAPPDATA%/SarinBot/deployment`.
