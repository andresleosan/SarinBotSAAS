# Perfil público del negocio: verificación

Fecha: 17 de octubre de 2026. Estado: publicado y verificado tras autorización explícita del propietario. Runtime `03a4703`, rama `codex/public-business-profile-20261017`, basada en `9e21f6d` del piloto publicado. El checkout original mixto no se usó como base de implementación.

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

La base conserva los tres archivos del icono que ya está publicado. [Registro del favicon](2026-10-17-pwa-favicon.md). La publicación no modificó Fresha, servicios, horarios, reservas, pagos ni políticas del negocio.

Se congeló `03a47030f9bcf017ee48a5736ebd13dffaa01582` en un archivo Git independiente. Comparación SHA-256 de 612 archivos contra las fuentes publicadas: solo cinco archivos ejecutables de aplicación cambiaron, todos del perfil público. Los iconos, manifiesto, dependencias, Dockerfile, Worker y arranque permanecieron idénticos. El harness de pruebas y el flag del presupuesto pertenecen a la revisión base del piloto; el presupuesto ya estaba activo en producción.

La imagen Linux/amd64 se construyó con los mismos cuatro argumentos públicos Firebase, sin attestations/provenance, y pasó Next/TypeScript. El ensayo HTTP de la imagen, aislado sin red externa, comprobó páginas, sesión anónima 401, manifiesto, bytes de ambos PNG y bundle del perfil. Ese ensayo usa `node server.js`; la identidad ADC real se verificó después mediante la sesión administrativa de producción. También pasaron las 74 pruebas del Worker, sus tipos y el dry-run de la configuración exacta de publicación.

| Etapa | Referencia y resultado |
| --- | --- |
| Imagen publicada | `registry.cloudflare.com/05fb22c155667de064b55c4e287b21d8/sarin-bot@sha256:0ce3ac0a81a93f7825d56edc7c30bdf8ed1eaf352cc251bac9b2ee0d702dd7f6` |
| Mantenimiento | Worker `e9487a89-f12b-438a-a2be-e4c286ea7d3a`; imagen anterior conservada. Cola autenticada cero antes y después del cierre. |
| Rollout | Worker `b9c83fc1-fcad-416f-9e44-65904c291b64`; nueva imagen con mantenimiento activo. Se esperó la promoción efectiva, no solo la aceptación del comando. |
| Instancia efectiva | Containers v9; allocation `d03baccf-3c88-491b-be7e-59cac2baf995`, running y conectada a `sarin-global-app`. Una instancia, ninguna antigua; cola vacía en la imagen nueva. |
| Reapertura | Worker **`bd604e53-49aa-40b5-b866-29633cc684bf`**, mantenimiento desactivado. |
| Cierre independiente | 13:46:38 UTC / 08:46:38 Colombia: Worker al 100 %, imagen correcta, máximo/configurado uno, paginación completa sin instancias antiguas. Trece secretos, todos los bindings, D1/R2 y presupuesto conservados. |
| Pages | Deployment `a461b670-5130-41e7-8c75-957f5439cfd7`, sin redesplegar. |

HTTP público: portada, ayuda, privacidad, negocio y manifiesto 200/no-store; `/api/session` y `/api/businesses` anónimos 401. `view=profile` devolvió 200/no-store y únicamente las claves previstas, incluidos servicios reducidos; un negocio inexistente devolvió `{ business: null }`. Ambos iconos publicados mantienen sus SHA-256 anteriores.

Chrome real después de reabrir: consola administrativa con DeepSeek disponible e historial del cliente accesible. Al salir de sesión se comprobó la ficha publicada de Sarin Aceptación QA en móvil y escritorio, sin Google hasta pulsar Ver mis citas, con regreso al negocio correcto. Los siete días de ese negocio QA ya estaban cerrados; por eso el estado en pausa y Ver mis citas son correctos. No se abrieron horarios para fabricar una reserva disponible. La variante Reservar del negocio disponible está cubierta por el ensayo local, las pruebas y la misma implementación publicada.

- [Ficha publicada en móvil](2026-10-17-public-profile-live-mobile.png).
- [Ficha publicada en escritorio](2026-10-17-public-profile-live-desktop.png).

Se restauró el viewport y se retiró la intercepción temporal de salud. Google dejó pendiente la selección manual de cuenta al restituir la sesión después de comprobar la vista anónima; se dejó su ventana y el negocio abiertos para el propietario. Esto no bloquea la publicación ni es una prueba de fallo de autorización del servidor: la consola y el historial autenticados ya se habían verificado en la imagen nueva.

Fuentes, configuración de reversión, build y verificaciones saneadas quedan fuera de Git en `%LOCALAPPDATA%/SarinBot/public-profile-release-20261017`. No se hicieron migraciones ni generaciones de IA. La [guía oficial de rollouts](https://developers.cloudflare.com/containers/configuration/rollouts/) respalda la espera hasta comprobar la sustitución efectiva.

Rollback: activar mantenimiento, drenar la cola y volver a la imagen publicada del favicon `registry.cloudflare.com/05fb22c155667de064b55c4e287b21d8/sarin-bot@sha256:1faafea1cc8bce41a6a7ab284807e932b604547528424525e1f9041384039c72`, conservando D1/R2, variables, secretos y presupuesto. Usar `wrangler.rollback.json` del paquete privado, esperar una única instancia efectiva y reabrir. Referencia Worker anterior `218fa37f-9589-4cfa-bd80-b5a51bea4212`, Containers v8. No hay migración de datos que revertir.
