# Calendario de reservas: aceptación local

Fecha: 17 de octubre de 2026. Estado: publicado y verificado tras autorización específica. Runtime `98629e1`, rama `codex/direct-booking-calendar-20261017`, basada en `b91c545`, en el worktree existente `F:/Proyectos/SarinBot-worktrees/service-catalog`. El checkout original mixto se conserva.

## Resultado

El adulto que reserva para sí mismo en un negocio general comienza con «Reservar con calendario», después de Google y los permisos actuales. Puede elegir «Hablar con Sarin» expresamente. El calendario reutiliza selección, disponibilidad, propuesta, teléfono, preguntas del negocio y confirmación existentes. No monta chat ni diagnóstico de inferencia por defecto. Salud y menores mantienen el formulario y sus autorizaciones correspondientes.

[Diseño y referencia oficial de Fresha](../design/2026-10-17-direct-booking-calendar.md). [Protocolo repetible](../../qa/tests/direct-booking-calendar.md).

## Verificación ejecutada

| Comprobación | Resultado |
| --- | --- |
| RED previo al código | Diez casos de selección/montaje/bloqueo fallaron por ausencia del calendario general; cuatro del formulario por destinatario incorrecto; siete del hook por incertidumbre ausente; dos de propuesta por recuperación sin congelación. |
| Revisión independiente | Detectó pérdida de la operación incierta al retirar permisos, fallar la política o cambiar a salud. Regresiones RED/GREEN y segunda revisión PASS: se conserva el controlador y solo puede repetirse el cuerpo original con UID esperado. |
| Ajustes de QA | Título y ayuda del calendario general; panel específico omitido únicamente con `required=false` validado y sin carga/error. El hook y permisos previos siguen activos. Campos congelados también en recuperación del calendario. Regresiones RED/GREEN, revisión independiente PASS. |
| `pnpm test` final | **955 aprobadas, 26 omitidas**, 115 archivos aprobados y cuatro omitidos. Los tests opt-in no se cuentan como ejecutados aquí. |
| `pnpm run typecheck` | Sin errores tras el último cambio. |
| Build de producción | Imagen Linux/amd64 del archivo Git exacto `98629e1`: Next 16.4.0, TypeScript y generación de las 12 páginas correctos. |
| `pnpm run test:journey --port 3040` | **129 comprobaciones** con Auth/Firestore oficiales en loopback; limpieza de su namespace correcta. Sin inferencia. |
| `pnpm --filter sarin-cloudflare-host run check` | **74 pruebas**, tipos y dry-run correctos, Wrangler 4.150.0. Worker sin cambios. |
| `pnpm audit --audit-level=high` | Sin vulnerabilidades conocidas. Lockfile y dependencias sin cambios. |
| `git diff --check` | Sin errores. |

La rama se envió a `origin`; el workflow remoto solo se dispara en `main`, PR o ejecución manual, por lo que no se atribuye una corrida CI al push de esta rama. Los resultados de la tabla son verificaciones locales ejecutadas.

La seguridad conserva validación y autorización del servidor, consentimientos vigentes, límites, disponibilidad transaccional, cupos e idempotencia. El nuevo calendario general usa `subjectKind: self` y `beneficiary.kind: self`, ya admitidos por el backend publicado. No cambia API, esquema, regla de almacenamiento, secreto, proveedor ni despliegue de Pages. El replay de una confirmación incierta valida el UID, repite los datos originales y no se convierte en una reserva nueva. Cambiar de UID o negocio limpia el ámbito anterior y descarta respuestas tardías.

Las simulaciones de respuesta perdida, errores, retirada durante confirmación, cambio de política/salud, identidad y restricciones de salud/menores son pruebas de componente/hook y contratos existentes; no se atribuyen a una manipulación de red en Chrome. Las propuestas pendientes viven en memoria; tras recargar se debe consultar «Mis citas» para comprobar lo ya guardado.

## Chrome mediante CUA

Entorno exclusivo `demo-sarin-bot`, emuladores Auth 9099/Firestore 8080 y Cliente local. Negocio sintético `calendario-qa-20261017`, dos servicios y dos profesionales, todos los días 09:00–18:00 y suscripción de prueba activa. Preguntas existentes: «Preferencia de acabado» obligatoria y «Referencia de estilo» opcional.

El servidor de desarrollo en 3040 respondió por HTTP, pero se observaron recompilaciones continuas al coincidir con builds en el mismo worktree y la primera pestaña CUA quedó en carga. Esa tentativa no se contabiliza como aceptación. Se separó la comprobación en una vista compilada local en **3041**, con `localDevelopmentEnvironment`, `next build --debug-prerender` y `next start` para conservar las guardas y botones demo sin editar la configuración. El build terminó con código cero y el servidor final anunció Ready a las **10:51:57 Colombia**, después del último cambio de código. Es un preview de QA, no la imagen de producción.

- Calendario inicialmente seleccionado, servicio propio y sin datos/campos del representante. El panel adicional no requerido desaparece; permisos de cuenta/negocio vigentes siguen visibles.
- Selección real de Corte clásico, Profesional uno de prueba y **19 de octubre de 2026, 09:00–09:30, 25.000 COP**. La fecha se seleccionó con el teclado nativo de Chrome; los horarios anteriores se invalidaron. La tentativa de rellenar el control nativo por `fill` no actualizó el estado de React y no se contó como selección válida.
- «Revisar propuesta» conservó selección y precio; antes de confirmar «Mis citas» seguía vacío.
- Teléfono incorrecto rechazado por patrón HTML; pregunta obligatoria vacía rechazada por `valueMissing`. Se corrigieron ambos con datos sintéticos; el campo opcional también se completó.
- Confirmación explícita única: «Cita guardada» y «Mis citas» mostraron **Corte clásico, Reserva para ti, 19 de octubre, 09:00–09:30, Confirmada**.
- Elección manual de «Hablar con Sarin»: chat visible y aviso de motor local no disponible; no se escribió ni envió ningún mensaje. Regreso a calendario con selección nueva, sin input de chat. La cita guardada permaneció en «Mis citas».
- Salud en fixture separado: «Reserva sin IA», sin opción de chat, autorización específica pendiente y servicio todavía no disponible. Menor en negocio general habilitado: calidad de representante visible, nombre y servicio no disponibles antes de autorizar, sin chat. Regreso a «Para mí» recupera calendario sin rol ni autorización de menor. No se aceptaron esas autorizaciones ni se ingresaron datos de salud o menores.
- **320×740, 390×844 y 1280×900**: sin desbordamiento horizontal. Anchos de documento 305/375/1265 px, con espacio del scrollbar. Selector de recorrido y botones de hora con 44 px de alto. Tab y Shift+Tab, fecha mediante teclado, estado `aria-pressed` y foco visible comprobados.
- Consola capturada sin errores ni advertencias inesperadas. El banner de Firebase emulado es propio del entorno.

La captura muestra datos ficticios y solo el entorno local. El reporte HTML de esta corrida está en `qa/reports/2026-10-17-direct-booking-calendar.html`, ignorado por Git. Se usó CUA; no se presenta como ejecución de `@playwright/test`.

La lectura posterior de Firestore verificó **24 condiciones**, incluida exactamente una cita confirmada, UID/negocio, beneficiario propio sin representación, servicio/recurso/fecha/hora/precio/buffer y persistencia del teléfono y ambos campos sintéticos. No se registró consumo ni admisión de inferencia/chat para ese negocio. El reporte sanitizado está en `qa/reports/direct-calendar.verify.result.json`. La preparación de los otros dos fixtures no modificó el negocio ni la cita principal.

Se restauró el viewport y se cerraron las pestañas locales. Preview y emuladores se detuvieron sin exportar datos; puertos 3040/3041/8080/9099/4400/4500 comprobados libres. La sesión administrativa de producción no se utilizó ni se modificó durante esta aceptación.

## Capturas

- [Entrada en 320 px](2026-10-17-direct-calendar-entry-320.png).
- [Horarios en 320 px](2026-10-17-direct-calendar-320.png).
- [Contacto e intake en 390 px](2026-10-17-direct-calendar-proposal-390.png).
- [Calendario en escritorio](2026-10-17-direct-calendar-desktop.png).
- [Confirmación local](2026-10-17-direct-calendar-confirmed.png).

## Publicación y reversión

La base del corte fue el catálogo `accab511`, imagen `sha256:b2b925f5965b38e8eca40fccd31087648f97b245e27da9a0e9725c54ae431df0`, Worker `274d9bf2-6b19-4704-99c1-88dbb8ef0e42`, Containers v10, con máximo uno y presupuesto activo. La imagen del calendario está ahora publicada en Containers v11, según el cierre siguiente.

La revisión independiente confirmó que ese runtime admite las propuestas v2 general-self y las citas que crea este calendario. Es el rollback compatible de este incremento: conservar D1/R2, secretos, cupos y metadatos; activar mantenimiento, drenar, volver a esa imagen, verificar una instancia efectiva y lecturas antes de reabrir. No se necesita migración ni borrar datos. Una página nueva del frontend anterior no reanuda una propuesta de calendario en memoria; las citas ya guardadas siguen consultables y cancelables y un cliente de calendario aún abierto conserva compatibilidad con el servidor anterior.

### Artefacto preparado

Fuente congelada **`98629e12df5df28801983ee59f87a103c835b710`**. Imagen local `sarin-bot:direct-calendar-20261017`, ID **`sha256:b6bc75f9f108e0f798dcb4f135e3cf281844060c2bd64e3181382b7cb785a39b`**, Linux/amd64. Se conservaron los cuatro argumentos públicos Firebase y la receta existente; no se montaron secretos de runtime al construir.

Humo de esa imagen: filesystem de solo lectura, red `none`, sin credenciales; portada, ayuda, privacidad, onboarding y `/b/synthetic-catalog` HTTP 200; APIs protegidas anónimas 401; manifiesto y SHA-256 de ambos iconos correctos; bundle con calendario y destinatario explícito. El contenedor de humo se retiró. Este humo no demuestra acceso real a ADC/D1: los contratos se validaron con los emuladores y el backend no tiene cambios.

Paquete privado `%LOCALAPPDATA%/SarinBot/direct-calendar-release-20261017`: archivo Git/hash, fuentes, logs de build, inspección de imagen, humo, resumen QA, plan de publicación y configuraciones base/mantenimiento con rollback al catálogo. Su estado inicial fue `awaiting_production_authorization`; el cierre actual registra `complete`, autorización recibida, imagen enviada y publicación verificada. El digest confirmado por el push coincide con el ID local preparado.

Preflight independiente de solo lectura a las **15:57:56 UTC / 10:57:56 Colombia**: Worker `274d9bf2…` al 100 %, mantenimiento desactivado, presupuesto activo, trece secretos y todos los bindings/variables iguales a la base. Containers v10 con imagen `b2b925f5…`, máximo/configurado uno, una allocation running/conectada y cero antiguas tras paginación completa. Pages `a461b670…` intacto. Registro privado `independent-before.json`. Se corrigió la falta de un JSON de evidencia del finalizador copiado y se repitió este helper desde el propio paquete con salida cero; no afecta al código o imagen congelados.

### Publicación autorizada y verificada

El propietario respondió «si autorizo» a la pregunta explícita de publicación del calendario. Se registró esa autorización en el paquete antes de enviar la imagen. El preflight independiente autorizado de las **16:04:14 UTC / 11:04:14 Colombia** confirmó la base sin drift, el archivo fuente/hash, la imagen Linux, el humo y el rollback.

La imagen fijada es **`registry.cloudflare.com/05fb22c155667de064b55c4e287b21d8/sarin-bot@sha256:b6bc75f9f108e0f798dcb4f135e3cf281844060c2bd64e3181382b7cb785a39b`**. El push devolvió exactamente ese digest. Wrangler 4.150.0, su ayuda instalada y la [guía oficial de rollouts](https://developers.cloudflare.com/containers/configuration/rollouts/) se comprobaron antes de ejecutar el dry-run de la configuración fijada. No se actualizaron dependencias.

| Etapa | Evidencia |
| --- | --- |
| Mantenimiento | Worker `0c2a1183-76a4-4b6e-af7d-3d091b24e7c0`, imagen anterior conservada; origen público 503 y cola autenticada vacía. |
| Sustitución | Worker `ec916e4f-119b-477c-9591-7a0907132a66`, imagen nueva y mantenimiento activo; se esperó la promoción efectiva. |
| Instancia efectiva | Containers **v11**, allocation **`d0386d9c-015d-48f0-921a-cefee306d711`**, running y conectada al singleton `sarin-global-app`. Máximo/configurado uno y cero antiguas tras paginación completa. Gate independiente de las 16:09:54 UTC aprobado. |
| Reapertura | Worker **`08a0183f-997a-4b84-8c9a-803a78b47b3c`**, mantenimiento desactivado, sin otro rollout. |
| Cierre independiente | **16:10:41 UTC / 11:10:41 Colombia**: Worker al 100 %, imagen/v11/instancia correctos; trece secretos, todos los bindings/variables, D1/R2 y presupuesto preservados. |
| Pages | Deployment `a461b670-5130-41e7-8c75-957f5439cfd7` conservado; no se redesplegó. |

La cola autenticada estuvo vacía antes del cierre, después de drenar, en la imagen nueva y tras reabrir. El despertar de v11 comprobó el arranque con ADC real mediante el endpoint de salud, sin inferencia. Las capturas de salud usaron exclusivamente la sesión existente, conservaron sus credenciales en Chrome y retiraron los patrones temporales de inspección al terminar.

El control HTTP público comprobó portada, ayuda, privacidad, negocio, configuración y manifiesto 200; APIs protegidas anónimas 401; perfil con allowlist/no-store, rutas inválidas y ambos iconos por SHA-256. Los bundles publicados contienen el calendario y los campos de catálogo conservados. Registro `http-final.json`.

Chrome real comprobó ambos negocios de prueba: el selector muestra calendario inicialmente elegido, «Mis citas» sigue visible y ningún chat se monta antes de los permisos. La cuenta actual mantiene autorización de cuenta y tiene pendientes los permisos de cliente de esos negocios; las dos opciones permanecen deshabilitadas correctamente. Esa verificación fue de solo lectura. La confirmación completa y persistencia son la evidencia local anterior, no una cita nueva en producción.

En 390×844 el documento ocupa 375 px, sin desbordamiento; consola sin errores/advertencias inesperadas. La captura real `calendar-live-390.png` y `browser-final.json` quedan en el paquete privado, fuera de Git. Se restauró el viewport; el negocio publicado y la pestaña administrativa quedan disponibles, con la sesión administrativa comprobada y conservada. No hay restauración de sesión pendiente.

`release-status.json` y `publication-plan.json` están en **`complete`**, con `productionApproval=true`, `registryPushed=true`, `productionChanged=true` y `publicationComplete=true`. El respaldo fijado `b2b925f5…` sigue disponible; las configuraciones `wrangler.rollback-rollout.json` y `wrangler.rollback-final.json` conservan bindings y datos. No hay migración ni cambios de configuración del negocio para esta aceptación.
