# Piloto comercial: aceptación integrada local

Estado al 16 de octubre de 2026: los cuatro incrementos del piloto están implementados en el worktree separado `commercial-pilot`. **Candidata local verificada: `ecec02828feb474ffd0e6c46069a120697f9912c`. Los gates locales están cerrados; publicación y activación permanecen pendientes.** Producción permanece sin cambios, con marketplace y WhatsApp deshabilitados y el nuevo gate de presupuesto sin activar.

## Resultado funcional observado

La revisión usa cuentas/negocios sintéticos y servicios oficiales locales de Auth/Firestore. La prueba de contratos D1 utiliza Workerd/D1 reales. El recorrido Chrome posterior usa un **motor fixture en loopback**, por lo que no acredita una conversación con DeepSeek dentro de la app. Las ocho llamadas DeepSeek aisladas se describen aparte, con sus discrepancias originales.

| Incremento | Evidencia conseguida | Límite |
| --- | --- | --- |
| Invitación de cortesía | Canje sin comprobante concede diez citas y 700 respuestas, sin ingresos ficticios. Suspender/reactivar conserva uso; después de cancelar se observa **1/10 citas y 3/700 respuestas**. | Entorno sintético; no códigos entregados a clientes reales ni conciliación bancaria auténtica. |
| Tarifas | Una landing que ya estaba abierta cambió de **65.000 a 68.000 COP**, sin recargar, comprobado en el árbol de accesibilidad nativo. | Tarifas locales sintéticas; no cambio de precios de producción. |
| Logo y tarjeta | Guardar logo conserva el borrador; A/Agenda clara es la única plantilla. Archivos reales PDF/PNG/SVG descargados, render inspeccionado y QR leído. | Impresión dentro del acrílico pendiente; no selector B/C. |
| Chat y reserva | Chrome recorre propuesta → confirmación explícita → agenda actualizada → cancelación → historial. Consulta ajena al negocio recibe plantilla comercial. | Motor fixture local; no se confunde este recorrido con una prueba pagada del proveedor. |
| Conservación de datos | Dos contratos D1, prueba pagada y cortesía, conservan cinco citas históricas y el consumo durante propuesta, confirmación concurrente, replay y cancelación. | Integración sintética, no carga con negocios reales. |

### Evidencia del navegador

- [Invitaciones en administración](2026-10-16-pilot-invitations-admin.png), [canje](2026-10-16-pilot-invitations-redeemed.png) y [consumo después de cancelar/suspender/reactivar](2026-10-16-pilot-invitations-consumption.png).
- [Propuesta de reserva](2026-10-16-pilot-proposal-desktop.png), [confirmación](2026-10-16-pilot-confirmed-desktop.png), [cancelación e historial](2026-10-16-pilot-cancelled-desktop.png) y [respuesta de alcance](2026-10-16-pilot-scope-desktop.png).

El precio 65.000 → 68.000 se observó mediante lectura de accesibilidad de la landing abierta; no se incorpora una captura inventada para ese cambio. El fixture de navegador y las pruebas automatizadas se mantienen diferenciados.

### Tarjeta A y móvil

El [informe de branding](2026-10-16-business-branding.md) contiene archivos y revisión detallada:

- PDF real de una página **105,00 × 148,00 mm**; render a 300 ppp y PNG de **1241 × 1749 px**. El PDF contiene el mismo PNG, sin prometer texto vectorial/seleccionable.
- ZXing-C++ leyó PNG, PDF renderizado y SVG convertido a imagen y obtuvo exactamente `http://127.0.0.1:3040/b/barberia-norte` en los tres. Es una URL local, no material comercial listo para distribuir.
- Kit y perfil en Chrome real con emulación CDP **320 × 844**: `scrollWidth = clientWidth = 320`. Logo, teléfono sintético y tres enlaces correctos; emulación retirada al terminar. No equivale a un móvil físico.

## Ejecuciones automatizadas verificadas

Los siguientes resultados están confirmados; sus grupos se solapan y no deben sumarse. Esta redacción reúne los logs de la sesión, sin volver a ejecutar pruebas ni llamadas pagadas.

| Ejecución | Resultado confirmado |
| --- | --- |
| `tests/pilot-abuse.integration.test.ts`, D1 real local | **2 casos aprobados**, prueba pagada y cortesía; cinco históricas preservadas. |
| Hook + integración D1 focalizada | **13 pruebas aprobadas**. |
| `pnpm run test:journey --port 3040` | **1 caso aprobado con 97 comprobaciones**, sin inferencia; limpieza de documentos, cuentas y banco del runner, preservando datos manuales/admin local. |
| `pnpm run test:rules` | **23 pruebas aprobadas**, integración/reglas de Firestore oficiales. |
| Regresiones UI focalizadas | **46 pruebas aprobadas**. |
| Regresiones onboarding/hook/budget/chat | **42 pruebas aprobadas**. |
| Revisión independiente tras correcciones | **Sin P1/P2 pendientes en esa revisión**; **94 pruebas de aplicación y 23 de router aprobadas**. |

La corrección revisada conserva el acceso administrativo paginado al presupuesto bajo mantenimiento, con cursor estrictamente validado y autorización de servidor. La revisión no sustituye los gates finales ni una prueba de carga.

## DeepSeek: ensayo acotado y resultado original conservado

Se efectuaron **solo ocho llamadas sintéticas aisladas**, con base de datos en memoria y sin datos de producción, mutaciones de cuentas o mensajes. [Reporte JSON original](2026-10-16-deepseek-synthetic-results.json).

El benchmark de clasificación estricta **falló: 6/8**. `general_research` e `injection_override` devolvieron `clarify` en lugar de la etiqueta esperada `out_of_scope`; no ejecutaron la petición generalista o inyectada. Las seis clasificaciones esperadas y las dos aclaraciones se mantienen dentro de respuestas renderizadas por el servidor. No se declara un clasificador 8/8 perfecto.

El código actual hace que `clarify` y `out_of_scope` respondan exactamente la plantilla comercial fija; una regresión comprueba ambas ramas. **No se repitió el ensayo pagado tras la corrección ni se reescribió su JSON como aprobado.** El [informe de protecciones](2026-10-16-pilot-abuse-controls.md) explica el criterio y sus límites.

Datos agregados originales: **21.633 tokens**, **1.116 ms** de media por interpretación y estimación conservadora de **USD 0,0068931**. No constituyen costo/latencia por conversación completa ni prueba del proveedor integrada con la UI.

## Gates finales verificados

Los grupos se solapan y no se suman. Las 25 omisiones del comando general corresponden a suites opt-in; no se acreditan por ese comando. Las ejecutadas se registran por separado.

| Gate | Resultado final observado |
| --- | --- |
| Aplicación y tipos | **783 aprobadas, 25 omitidas**, 86 archivos aprobados y cuatro omitidos; TypeScript exit 0. |
| Firestore oficial | **23 aprobadas**, reglas e integración sin omisiones. |
| Smoke local | Auth, autorización, facturación y configuración correctas; sin inferencia ni datos reales. |
| Journey | **97 comprobaciones**, una prueba aprobada y limpieza confirmada. |
| Builds | Aplicación, landing, check standalone de 41 archivos y empaquetado Pages: exit 0. |
| Worker | **72/72**, tipos y dry-run aprobados; sin rollout. |
| Gateway | **25/25** aprobadas. |
| Dependencias | Auditoría completa y de producción: **sin vulnerabilidades conocidas**. |
| Recuperación de logos | **21 pruebas**, incluida recuperación SQL en Miniflare, logo de 151 KiB y dos prefijos con el mismo SHA. |
| Revisión independiente | Sin P1/P2 abiertos; revisión adicional de backup y allowlist de ayuda/privacidad. |
| Imagen Linux | Build congelado de la revisión exacta; smoke sin red verifica Sharp nativo WebP 512×512 y sesión sin credenciales HTTP 401. |

El build inicial detectó un tipo incorrecto en el test del callback administrativo; la firma del componente se corrigió y build/tipos pasaron. Pages detectó que la allowlist anterior rechazaba ayuda/privacidad: se añadieron exclusivamente esas dos rutas. El verificador standalone se ejecuta antes de empaquetar `_worker.js`; ejecutarlo después sobre el artefacto Pages rechaza ese ejecutable por diseño. La recuperación detectó que los logos excedían la política exclusiva de comprobantes: `342dbca` separa las políticas y los campos, sin elevar el límite de comprobantes. Los fallos originales y correcciones permanecen en logs ignorados.

Logs locales `final-*.log`, `validation-cloudflare.log`, `validation-pages-gateway.log` y `backup-green.log`, bajo el ledger del piloto. No se publican registros privados de clientes. Gap no bloqueante de la revisión: el CLI completo con dos claves remotas del mismo SHA se revisó por código; el bundle compartido y su lectura sí tienen prueba ejecutada.

## Versión, imagen y respaldo preliminar

- Rama `codex/commercial-pilot-20261016`; checkout principal conservado. `b8624ff` identifica las fuentes publicadas previas capturadas localmente. No hubo merge ni push de cambios anteriores ajenos.
- Runtime `ecec02828feb474ffd0e6c46069a120697f9912c`. [Manifiesto público de la candidata](2026-10-16-commercial-pilot-release.json).
- Imagen local `sarin-bot:pilot-ecec028`, ID `sha256:480c255e9a89ed879315287511c833328912b62184427025953953ce7dd97eae`, **79.578.251 bytes**. Contexto generado por `git archive` de esa revisión, sin env del checkout ni scratch. Solo cuatro valores públicos Firebase como argumentos de build. No subida ni desplegada.
- Archivo fuente SHA-256 `cc7dfb56dced99fd29ef3dc07d52c036328e199c8cc9568cd7194f25ef0bb561`; fuente, log e identificación de imagen conservados en privado.
- **Preflight de producción solo lectura**, `2026-10-16T23:40:03.857Z`: revisión antes/SQL/después **33/33/33**, 48 documentos, SQL **42.291 bytes**, un objeto R2 de **23.434 bytes**. Restauración local Miniflare aprobada: filas/esquema/hashes iguales e integridad `ok`. SQL SHA-256 `8657862be804b6edbb42a8837bb37034b2d092eefaa95dea20f182619487357a`.
- Copia fuera de Git: `%LOCALAPPDATA%/SarinBot/pilot-implementation-20261016/preflight-20261016T234003857Z-a081d832`. Sin mantenimiento ni escrituras remotas. **No sustituye el respaldo final tras drenar**, ni respalda por sí sola Auth o secretos.

## Publicación concreta preparada

Publicar esta candidata con una sola instancia, conservando D1/R2, Google y DeepSeek actuales. Antes de reabrir: mantenimiento, cola a cero, respaldo final recuperable, desplegar con gate en falso, configurar los ocho límites mediante API superadmin y activar el gate bajo mantenimiento; verificar y reabrir. El [runbook](../cloudflare-no-vps-runbook.md#activación-y-reversión) conserva contratos y reversión compatible con invitaciones, propuestas y contadores. No restaurar una imagen antigua que permita confirmar solo mediante el modelo.

Configuración inicial propuesta, **no aplicada**: global **USD 0,50/día y USD 8/mes**, por negocio **USD 0,10/día y USD 2/mes**; tokens globales **20 M/día y 300 M/mes**, por negocio **2 M/día y 30 M/mes**. Alcanzar un límite pausa nuevas llamadas pagadas sin consumir respuestas comerciales no entregadas. **Es un corte operativo conservador, no garantiza agotar todos los planes vendidos.** Revisar financiación/consumo; ni el ensayo acotado ni las alertas sustituyen ese control. [Costos y supuestos](../../STACK.md).

La confirmación de despliegue es distinta de la aprobación de implementar ya recibida. Los cuatro incrementos se ejecutaron sin volver a pedir permiso. La publicación sigue pendiente de esa decisión y de los pasos operativos anteriores.

## Producción y operación pendientes

- **Publicación:** no ejecutada. Candidata, imagen y gates locales preparados; faltan confirmación, respaldo final y activación/rollout bajo mantenimiento con una instancia. No reactivar VPS ni cambiar D1 por Firestore.
- **Presupuesto operativo:** `PILOT_AI_BUDGET_ENFORCED=false`; configuración y activación se preparan juntas antes de un release bajo mantenimiento. El cupo comercial no es un techo de facturación ni el presupuesto una garantía para diez planes consumidos al máximo.
- **Operación real:** conciliación de pago bancario auténtico, condiciones de devolución/conservación y medición con los primeros negocios siguen pendientes. No se acredita capacidad con diez negocios reales; ese umbral no habilita el marketplace automáticamente.
- **Material físico:** confirmar dominio estable de reservas y lectura al 100 % dentro del acrílico con iluminación real. La prueba digital no sustituye la impresión.
- **Canales:** WhatsApp y marketplace permanecen fuera de la apertura actual. No se enviaron invitaciones ni mensajes a terceros como parte de esta aceptación.

## Fuentes de alcance

[Brief](../product/BRIEF.md) · [plan general](../superpowers/plans/2026-10-16-commercial-pilot.md) · [invitaciones](2026-10-16-pilot-invitations.md) · [branding verificado](2026-10-16-business-branding.md) · [protecciones y DeepSeek](2026-10-16-pilot-abuse-controls.md).

El informe anterior de invitaciones conserva sus conteos y estado visual de aquella fase; el recorrido integrado y consumo actuales se registran aquí. Esta aceptación local no modifica ni reemplaza la evidencia histórica de la producción publicada.
