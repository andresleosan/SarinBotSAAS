# QA de la prueba pagada de diez citas

Fecha: 16 de octubre de 2026. Oferta verificada: pago único de **5.000 COP**, configuración después de aprobación y **diez citas sin caducidad por días**. Se usaron cuentas, comprobantes y datos sintéticos del proyecto `demo-sarin-bot`; no hubo pagos reales, llamadas a proveedores de IA ni despliegue.

## Validaciones ejecutadas

Node 24.18.0 y pnpm 11.23.0. Las verificaciones de integración usan los emuladores oficiales; el recorrido local apunta a `127.0.0.1:3040`, Auth `9099` y Firestore `8080`.

| Comando | Resultado |
| --- | --- |
| `pnpm test` | 578 pruebas pasan, 20 omitidas; 48 archivos pasan y 3 omitidos |
| `pnpm run typecheck` | Pasa |
| `pnpm run test:rules` | 19 pruebas pasan en 2 archivos, con Firestore aislado en `127.0.0.1:8188` |
| `pnpm run test:local --port 3040` | Pasa: autenticación, roles, APIs y rechazo de accesos no autorizados |
| `pnpm run test:journey --port 3040` | 1 prueba pasa con **96 comprobaciones** y limpieza verificada |
| `pnpm run build` | Compilación de producción y generación de páginas completas en el checkout original |
| `pnpm run build:landing` y `pnpm run check:landing` | Exportación y validación correctas |

El baseline previo fue 534 pruebas correctas y 18 omitidas. En el worktree se usó el override temporal `pnpm_config_verify_deps_before_run=warn` para conservar la junction de dependencias. El build del worktree falló al resolver esa junction con Turbopack; el build posterior del checkout original pasó. No se alteraron dependencias ni el lockfile.

## Comportamiento comprobado

- Sin pago o con comprobante pendiente, configurar devuelve `402`; el borrador permanece privado, sin slug público ni gracia de acceso. El navegador no puede cambiar el importe o los diez cupos, y el dueño no puede aprobar su comprobante (`403`).
- La aprobación administrativa habilita configurar el negocio y deja diez citas disponibles. Guardar de nuevo la configuración o repetir la aprobación conserva el consumo; una segunda compra de la oferta no reinicia la prueba (`409`).
- La décima cita guardada deja el contador en diez y bloquea una undécima (`402`). El emulador verificó dos recursos compitiendo por el último cupo: solo una reserva se confirma. Los reintentos recuperan la misma cita sin otro descuento, también después del agotamiento. Las regresiones unitarias cubren recuperar la confirmación tras fallo posterior al guardado.
- Los conflictos, bloqueos y operaciones fallidas no descuentan citas. Cancelar una cita confirmada libera su horario y **no devuelve cupo**; la agenda y cancelación siguen accesibles después del agotamiento.
- Subir un plan después de agotar la prueba mantiene el bloqueo hasta su aprobación. Aprobar el plan semanal reactiva las reservas por siete días desde la aprobación; repetirla no extiende dos veces el período. También se comprobaron renovaciones y ampliación de respuestas sin reiniciar la prueba.
- La proyección pública excluye identidad privada del dueño, referencias de pago e imágenes. Imágenes y listas de comprobantes se almacenan por separado; usuarios ajenos no pueden leerlos. Las reglas rechazan escrituras de cliente sobre pagos, activación y contadores. Vault y datos manuales se preservaron durante la limpieza.

## Alcance y evidencia

El recorrido automatizado combina APIs HTTP autenticadas con las mismas funciones transaccionales de reserva que ejecutan las herramientas de Sarin. No existe una API cliente de reservas independiente: esas operaciones se ejecutaron directamente contra Firestore emulado. Estas comprobaciones no acreditan conversación con un modelo.

La revisión del navegador se completó mediante navegación SPA, snapshots de Playwright y capturas. Se comprobó la oferta de 5.000 COP y el bloqueo de configuración sin negocio; el formulario bloqueado con comprobante pendiente; la apertura de la imagen y aprobación desde la consola administrativa; y, tras aprobar, la configuración vacía habilitada con primer slug editable. El negocio configurado mostró `0/10` citas usadas. En el estado agotado mostró `10/10`, mantuvo agenda y cancelación, ofreció planes sin recomprar la prueba y deshabilitó la reserva pública con indicación de contactar al negocio.

Se revisaron escritorio de 1474 × 713 y móvil de 320 × 740. Dashboard, facturación, página pública y portada conservaron un ancho de documento de 320 píxeles en móvil. Las diez capturas privadas están en `F:/SarinBot-videos/2026-10-16-barbero/paid-trial-qa`, desde `01-oferta.png` hasta `10-finalizacion-sin-fecha.png`. La primera captura extendida contiene una repetición del viewport; las posteriores usan capturas del viewport completo. La revisión corrigió nombres vacíos de borradores y el estado de respuestas al consumir las diez citas: «Prueba finalizada», respuestas «sin utilizar» y explicación de que no amplían las citas, sin atribuirlo a una fecha de vencimiento.

El estado visual agotado se preparó con diez documentos sintéticos mediante el harness externo `prepare-paid-trial-ui.mjs`. Ese seed solo acredita la presentación de ese estado. El consumo real, la undécima reserva rechazada y la concurrencia se verificaron por separado con las 19 pruebas de emulador y las 96 comprobaciones del recorrido automatizado.

Los logs privados están fuera de Git en `F:/SarinBot-videos/2026-10-16-barbero`: `paid-trial-unit-final.log`, `paid-trial-emulator-final.log`, `paid-trial-smoke.log`, `paid-trial-journey.log`, `paid-trial-build-final.log` y `paid-trial-landing.log`. Los servicios temporales de QA en 3040/8080/9099 se detuvieron, el viewport se restableció y las pestañas temporales se cerraron. Se conservó el servicio privado existente en 3032. Este documento no incorpora tokens, imágenes de comprobantes, cuerpos de chat ni datos de cuentas reales. La compatibilidad y reversión se describen en [Prueba pagada de diez citas](../paid-trial.md).
