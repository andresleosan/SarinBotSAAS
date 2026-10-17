# Perfil público del negocio: verificación

Fecha: 17 de octubre de 2026. Estado: aprobado localmente; pendiente de autorización de despliegue. Rama `codex/public-business-profile-20261017`, basada en `9e21f6d` del piloto publicado. El checkout original mixto no se usó como base de implementación.

## Resultado

El enlace/QR `/b/[slug]` muestra a visitantes sin sesión nombre, logo opcional, servicios con precio fijo COP y duración, horario Colombia y contacto comercial existente. Reservar abre el acceso actual; Volver al negocio recupera la ficha. La acción aparece inmediatamente después de la identidad, antes del catálogo, para que sea visible al entrar en móvil.

Se conserva el flujo autenticado: chat general para adultos, recorrido estructurado según las políticas de salud/menores y Mis citas. El perfil pausado conserva información y acceso a las citas existentes mediante Ver mis citas. No se añade un directorio entre negocios, captura anónima, campos persistidos ni migración.

Diseño y contrato detallados: [decisión de implementación](../design/2026-10-17-public-business-profile.md).

## Pruebas y revisión

| Verificación | Resultado observado |
| --- | --- |
| RED antes de implementar | Las seis pruebas iniciales nuevas de ruta/entrada fallaron por la falta de proyección mínima y por Google antes del perfil; las cuatro existentes pasaron. El componente tuvo siete fallos antes de su implementación. |
| `pnpm run typecheck` | Sin errores. El build final repitió TypeScript correctamente. |
| `pnpm test` final | 904 aprobadas, 26 omitidas; 114 archivos aprobados y cuatro omitidos. Las integraciones opt-in no se presentan como ejecutadas por este comando. |
| `pnpm run build` | Next 16.4.0 compiló y generó las rutas de producción correctamente. |
| `pnpm run test:journey --port 3030` | Auth y Firestore oficiales en loopback; 117 comprobaciones de onboarding, permisos, reservas, concurrencia, cancelación, cobros sintéticos e idempotencia; limpieza propia correcta. Cero inferencia. |
| API real local, sin sesión | `view=profile` 200/no-store con identidad, catálogo reducido, horarios y estado derivado; `/api/session` 401. No hay consultas de cliente para ver la ficha. |
| Revisión independiente | Sin hallazgos bloqueantes en autorización, proyección, consulta, continuidad, estados o respuestas tardías. |
| Navegador Chrome mediante CUA | Recorrido de aceptación limpio en 320×740, 390×844 y 1280×900; Enter para reservar/volver; acceso Cliente local, cita existente y negocio pausado comprobados. Sin errores o advertencias de consola capturados. |
| `git diff --check` | Sin errores de formato. |

La proyección anónima reconstruye una lista permitida, incluidos campos internos de cada servicio e intervalo. No devuelve propietario, configuración del asistente, recursos, citas, clientes ni datos de facturación. `bookingAvailable` orienta la acción; no garantiza un hueco. El endpoint sin `view` conserva el contrato público amplio anterior para los consumidores existentes; este cambio no afirma haber reducido ese contrato histórico.

Las rutas de escritura, sesión, consentimientos y reglas de datos no se modificaron. El logo y redes siguen usando normalización y rutas existentes. No se añaden secretos ni dependencias.

## Evidencia visual

Datos explícitamente sintéticos, exclusivos del emulador:

- [Escritorio completo](2026-10-17-public-profile-desktop.png).
- [Móvil 320 px, texto largo y horario partido](2026-10-17-public-profile-320.png).
- [Móvil 390 px, acción visible](2026-10-17-public-profile-390.png).

La suite repetible está en [qa/tests/public-business-profile.md](../../qa/tests/public-business-profile.md). El informe HTML de esta corrida vive localmente en `qa/reports/2026-10-17-public-business-profile.html`, excluido de Git. La revisión de navegador usó controles CUA de Chrome; no se presenta como una ejecución de `@playwright/test`.

Se detectó un service worker heredado de pruebas anteriores en `localhost:3030` que servía estilos viejos. Se identificó por la respuesta CSS desde service worker/caché y se evitó temporalmente solo en la pestaña de QA. Con los estilos actuales se midieron 896 px de ancho y columnas de 552/280 px. No se borró almacenamiento del navegador; se restauraron las opciones de red y viewport y se cerró la pestaña.

El fixture de esta corrida creó diez documentos concretos (dos negocios, proyecciones, políticas, slugs y citas). Se retiraron los diez con validación de pertenencia y precondiciones, sin tocar cuentas ni consentimientos. Los puertos 3030/8080/9099/4400/4500 quedaron libres tras detener los servicios locales.

## Publicación y reversión

La base conserva los tres archivos del icono que ya está publicado. [Registro del favicon](2026-10-17-pwa-favicon.md). No se ha publicado la ficha nueva ni cambiado Fresha o datos de producción.

Tras autorización específica: congelar esta revisión, construir la imagen Linux con los mismos parámetros públicos de Firebase, conservar configuración y secretos del Worker y realizar el mantenimiento/drenaje del singleton según el runbook existente. Comprobar perfil público, sesión y citas tras publicar; mantener una sola instancia.

Rollback: volver a la imagen publicada del favicon `registry.cloudflare.com/05fb22c155667de064b55c4e287b21d8/sarin-bot@sha256:1faafea1cc8bce41a6a7ab284807e932b604547528424525e1f9041384039c72`, conservando D1/R2, variables, secretos y presupuesto. Referencia Worker anterior `218fa37f-9589-4cfa-bd80-b5a51bea4212`, Containers v8. No hay migración de datos que revertir.
