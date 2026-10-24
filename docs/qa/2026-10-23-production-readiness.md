# Corrección de bloqueos de publicación — evidencia local y remota

**Estado actualizado al 24 de octubre de 2026, 01:18:17.345 UTC (23 de octubre, 20:18:17.345 en Colombia): backend Worker/Container publicado desde `cf1be130`, metadata reconciliada y HTML público observado. El push a `main` y Pages producción siguen pendientes en este corte.** La continuación al final registra esos hechos; el cuerpo anterior conserva su corte histórico de las 00:33 UTC. Lector audible y zoom nativo siguen NO OBSERVADOS; no se declara aceptación completa de P1 ni salud integral de producción.

## Corte histórico de las 00:33 UTC

Estado: **Evidencia local conservada; CI remota y revisión correctiva aprobadas; observaciones manuales y aceptación de producción pendientes**. Corte de evidencia: **24 de octubre de 2026, 00:33 UTC (23 de octubre, 19:33 en Colombia)**; el cierre del demo se verificó a las 00:32:54 UTC. Este informe registra la corrección posterior a P1 y no modifica su [informe histórico](2026-10-22-admin-guided-navigation.md). Se publicó únicamente la rama de trabajo y se abrió el PR #1 como borrador. `main` permanece en `463ae55f8c873468980746185fb3e91f55cb8681`; no hubo merge, push a `main`, push de registry ni despliegue del backend. La evidencia local/remota no acredita aceptación del runtime de producción.

## Fuente y alcance

- Base de la corrección: `3351698a2d8eb8f9df56cf7ad0cf9d7fd27a5b3f`.
- Corrección D1: `8fa64c19c3d84eb5f6ee4b1761231c8024d8362b`; dependencias y **fuente exacta de los gates finales**: `2eb3a956f035b002d65c3e790ab52b631108709c`.
- HEAD documental previo a esta actualización: `ba341870c901d27911074ec048471aee7473a80d`, cuya única diferencia respecto de `2eb3a956` es este informe QA. Esta actualización también es solo documental; no añade código de producto ni repite las suites de fuente.
- Rama `codex/admin-guided-navigation-20261023`, worktree aislado `C:/Users/Drean Skate/AppData/Local/SarinBot/admin-navigation-20261023/source`. No se desarrolla desde el checkout mixto E: ni se modifica source-restoration.
- Node `v24.22.0`, pnpm `11.23.0`, Vitest `5.0.4`; Next exacto `16.4.1`. React/React DOM `19.3.0` y Sharp `0.35.5` permanecen.

El [diseño vinculante](../superpowers/specs/2026-10-23-production-readiness-design.md) conserva cincuenta continuaciones, paginación 25×4, deadline D1 de 30 segundos y todas las aserciones prepared/claimed y expired/stale-authority. El rechazo temprano solo descarta heads obsoletos; la autoridad reciente completa y CAS siguen siendo obligatorios para efectos vigentes. Se conserva cancelación privada, reservas, incertidumbre/idempotencia, AuthGate, consentimiento, contratos comerciales y una sola réplica.

El dispatch público y el scheduler compartido rechazan ahora un head inequívocamente ajeno al trabajo antes de leer identidad/dependencias innecesarias. La proyección temporal de solo lectura para un advance válido y vencido también fija `nextAttemptAt: null` al proyectarse como active, para respetar su esquema. No cambia el head almacenado, CAS ni la política de autorización.

## Gates finales sobre `2eb3a956`

El responsable ejecutó los comandos; este informe coteja sus registros externos. No se suman suites que se solapan. Horas UTC del 23 de octubre de 2026; los comandos hijos completados tienen exit 0. La excepción del wrapper journey se detalla abajo.

| Gate y comando real | Intervalo UTC | Resultado |
| --- | --- | --- |
| `node <final-checks>/vitest-runner.mjs`, modo full sin filtros | 22:54:00.798–22:57:43.520 | 216 archivos pasados, 4 omitidos; **3.294 tests pasados, 28 omitidos, 0 fallidos**; Vitest 222,03 s. |
| CLI TypeScript instalado: `tsc --noEmit` | 22:57:51.641–22:57:55.576 | Tipos aprobados. |
| CLI Next instalado: `next build` | 22:57:58.181–22:58:36.619 | Build real con Next 16.4.1, output standalone y 14/14 páginas estáticas. |
| `pnpm audit --json` | 22:58:44.482–22:58:45.391 | 0 vulnerabilidades en todas las severidades; hashes de manifest/lock/workspace iguales antes y después. |
| `node --test pages-gateway/tests/*.test.mjs` | 22:58:55.154–22:58:55.520 | 25/25 pasados. |
| `pnpm run build:landing` | 22:58:56.270–22:59:04.430 | Export aprobado. |
| `pnpm run check:landing` | 22:59:05.190–22:59:06.388 | 41 archivos públicos verificados, secciones/enlaces/accesos presentes. |
| `pnpm run build:pages` | 22:59:07.123–22:59:12.672 | Build/export/verificación de Pages aprobados. |
| `pnpm run test:rules` | 22:59:44.549–23:01:35.718 | 2 archivos, 26/26 pasados: reglas 11 e integración Firestore 15; Vitest 107,70 s. |
| `pnpm --filter sarin-cloudflare-host --fail-if-no-match run check` | 23:01:41.900–23:02:09.670 | Worker 137/137, tipos y `wrangler deploy --dry-run --containers-rollout=none` aprobados. |
| `pnpm run test:local --port 3042` | 23:03:11.644–23:03:16.591 | Smoke local real: hijo y wrapper exit 0. |
| `pnpm run test:journey --port 3042` | 23:03:31.510–23:03:51.009 | Hijo exit 0, 1/1 test, 129 comprobaciones y limpieza verificada; 17,266 s del caso / 18,41 s de Vitest. Wrapper exit 1 por el cambio de estado documental descrito abajo. |

Las 28 omitidas de la completa son opt-ins separados: `deepseek-intent.live` (1), `firestore.integration` (15), `firestore.rules` (11) y `local-journey.integration` (1). Las 26 Firestore sí se ejecutaron después con el script literal de reglas; el opt-in vivo no se activó. No se presenta la completa como una ejecución literal de `pnpm test`.

El archivo D1 completo pasó **22/22** dentro de la completa, en 68,577 s. Los casos stale-authority prepared/claimed tardaron **6.716,371 / 6.662,276 ms**; los expired prepared/claimed, **11.043,907 / 11.535,671 ms**. Se mantuvo el plazo original de 30 s. Esto cierra el fallo local observado en esta ejecución final; no promete ausencia de latencia bajo cualquier carga.

## CI remota del PR #1

[Verify Sarin #31, run `40039605722`](https://github.com/andresleosan/SarinBotSAAS/actions/runs/40039605722), intento 1 y evento `pull_request`, terminó **success a las 23:28:55 UTC del 23 de octubre: 3/3 jobs aprobados, 0 fallidos y 0 pendientes**. El [PR #1 en borrador](https://github.com/andresleosan/SarinBotSAAS/pull/1) tiene head `ba341870c901d27911074ec048471aee7473a80d` y base `main` `463ae55f8c873468980746185fb3e91f55cb8681`. Los tres jobs comprobaron realmente el **merge sintético `204ebbed9d2a7e247369b4d2b5e3dc953249c803`** de ese head sobre esa base; no fue un checkout aislado del head.

| Job remoto | Evidencia |
| --- | --- |
| Types, tests and builds | App: 3.294 pasados, 28 omitidos; 216 archivos pasados, 4 omitidos. Gateway: 25 pasados. Tipos, auditoría de severidad alta, build Next, landing build/check y Pages aprobados; auditoría sin vulnerabilidades conocidas. |
| Firebase rules and local journey | Reglas: 26 pasados en 2 archivos; journey completo: 1 pasado. |
| Cloudflare configuration dry-run | 137 pasados, 0 fallidos/omitidos; tipos y dry-run Worker aprobados. |

Los resúmenes sanitizados `readiness-remote-ci/ci-report.md` y `ci-status.json` conservan esta identidad y sus resultados. No se suman estos tests a los locales como cobertura adicional. La observación de CI fue de lectura, sin rerun, merge, despliegue ni publicación de imagen; el resultado no acredita lector audible, zoom nativo ni runtime desplegado.

## Entorno y resultados que se conservan

Los arneses externos usan fuente fijada, HOME/config/cachés nuevos, TEMP corto y entorno permitido explícitamente; excluyen dotenv, credenciales heredadas y opt-ins vivos. La completa usa dos workers, `configLoader: 'runner'`, `envDir: false`, sin caché de resultados ni filtros, con los plazos originales. Tipos/build invocan las CLI instaladas tras validar los scripts; el build no recibió configuración Firebase ni credenciales. Demo apagado durante completa/build y gates pesados secuenciales. Estas diferencias respecto de CI permanecen explícitas.

Next regeneró temporalmente los imports de `next-env.d.ts`; el responsable inspeccionó el diff y restauró ese archivo generado. El registro de build conserva el estado transitorio. Se retienen avisos de `react-test-renderer`, tipo de módulo y ausencia de caché; reglas conservan un `MetadataLookupWarning` sin fallo del gate.

Dos intentos de preflight del arnés de reglas fallaron **antes** del script/emulador: `2026-10-23T22-59-16-394Z-test-rules-6436a184f91a` y `2026-10-23T22-59-38-165Z-test-rules-0d50edea0bc9`. El primero no produjo registro final; su fallo consta en el ledger del responsable. El segundo registró `MODULE_NOT_FOUND`: las barras invertidas de la ruta del guard en `NODE_OPTIONS` se consumían. Se corrigieron solo los wrappers externos a barras normales; la ejecución posterior `ac83f13c5ec5` pasó el script literal sin overrides de config loader, fuente, tests ni deadlines. Los preflights fallidos no se cuentan como tests fallidos ni como pases.

El wrapper journey terminó **exit 1**, aunque su comando hijo pasó, porque detectó este nuevo informe QA no versionado al finalizar: el estado pasó de limpio a `?? docs/qa/2026-10-23-production-readiness.md` durante la ejecución. HEAD quedó en `2eb3a956`, el hash del diff siguió vacío y todos los hashes de entradas registrados permanecieron iguales. La desviación es documental y no un fallo de test ni un cambio de producto. Se conserva el exit 1 del wrapper; no se repitió para obtener verde. El caso verificó retirada de documentos, cuentas y banco sintéticos, conservando los datos manuales y el administrador local.

La historia anterior permanece: la completa P1 tuvo fallos de fixture Next y timeout D1; la posterior serial conservó un timeout prepared de 30.025 ms y claimed de 29.985 ms. Una comparación instrumentada aislada de `3351698` pasó en 18,531/17,994 s con unas 2.100 lecturas por recuperación y 20 omisiones por filtro: fue diagnóstico, no una completa ni prueba de estabilidad. La auditoría anterior de Next 16.4.0 falló con dos críticas y una alta. Esos resultados corresponden a fuentes anteriores y no se reasignan al candidato final.

## Navegador y demo

El recheck automatizado usó el candidato `2eb3a956` y fixtures nuevos en `demo-sarin-bot`. A 320 px, seleccionar el destino activo cerró Menú y transfirió foco a su botón de 44 px, sin overflow. En el caso de pago se retuvo un GET 200, se abrió Consulta, se volvió con Back **antes** de liberar la respuesta y después se liberó: el foco permaneció en el aviso de tarea conservada mientras cargaba «Revisa antes de aprobar». Esa secuencia ocurrió a 320 px; la inspección posterior a 1280×900 conservó el foco del aviso y no tuvo overflow. No se atribuye la secuencia completa al layout desktop.

Cuatro clics reales comprobaron `/dashboard`, `/dashboard/onboarding`, `/dashboard/qr-kit` y `/dashboard/billing`, con los cuatro enlaces de navegación presentes. La captura de etiquetas de permiso por página no produjo datos: no se declara esa comprobación. El propietario recibió «Acceso restringido» en admin, con cero paneles privados. Tras logout administrativo quedaron cero paneles privados/cero navegación autenticada y desapareció el negocio anterior. Los primeros intentos de captura tras resize agotaron su espera; la captura estable posterior funcionó sin corregir fuente.

La verificación del fixture a las 23:08:07.641 UTC confirmó 501 recibos, todos pendientes, el objetivo antiguo presente, cero mensajes de soporte y ninguna confirmación de pago. Se cerró la pestaña automatizada tras logout y se restauró su viewport. Las capturas y JSON sanitizados permanecen en `../qa-runner/readiness-browser/`; no se realizaron envíos ni aprobaciones para cerrar la comprobación de navegación.

**Lector de pantalla audible: NO OBSERVADO. Zoom nativo 200%: NO OBSERVADO.** DOM/árbol accesible y reflow equivalente por viewport/DPR no prueban ninguna de esas observaciones. La evidencia histórica de P1 mantiene su alcance; no se relabela como una observación nueva.

En el corte anterior quedó una pestaña manual en Consulta con un GET retenido para coordinar NVDA. El 23 de octubre a las 19:32 en Colombia, el titular preguntó por qué NVDA era necesario para producción. Se aclaró que es una comprobación de accesibilidad y que NVDA no es un prerrequisito técnico de software para desplegar. El [protocolo QA](../../qa/tests/admin-guided-navigation.md), línea 40, dispone: «Si no se ejecuta realmente, registrar como no observado y limitar la atribución a tests concretos». El [plan correctivo](../superpowers/plans/2026-10-23-production-readiness.md), línea 58, también permite reportar el pendiente explícitamente. Esta aclaración no constituye una exención del titular, un pase de accesibilidad ni aceptación completa de P1.

La observación manual se aplazó como **NO OBSERVADA** en `readiness-browser/manual-reader-deferred.json`, a las 00:32:21.215 UTC del 24 de octubre. Cancelar la intercepción antigua devolvió `Invalid InterceptionId`; no se considera una cancelación válida ni un resultado audible. Después se retiraron los patrones de Fetch, se cerró sesión (texto visible «Inicia sesión para continuar», cero paneles privados), se guardó la captura externa `manual-reader-deferred.jpg` y se cerró la pestaña propia. Se detuvieron los emuladores y el servidor propios; a las 00:32:54 UTC los puertos 3042, 8080, 9099, 4400, 4500 y 9150 no tenían listeners. No queda una solicitud humana retenida ni un demo activo en este corte. Los resultados humanos posteriores requieren evidencia nueva fechada.

El demo se lanzó a las 23:02:27 UTC mediante el `start.mjs` externo existente, Firebase CLI oficial cacheada 15.33.0 y Next 16.4.1, con entorno demo canónico, en el puerto 3042; no fue una ejecución literal de `pnpm run dev:local`. El wrapper local preserva el script journey real: este elimina `NODE_OPTIONS` en su hijo. El guard loopback del launcher no cubre los workers Vitest/fixtures; allí rigen las protecciones existentes de entorno demo, inventario de emuladores, URLs loopback permitidas y rechazo de inferencia/credenciales. El aislamiento del servidor demo es independiente del guard del launcher.

## Producción actual y preparación de publicación

La primera lectura CLI de Pages falló por autenticación/permisos; `whoami` exitoso no acreditaba acceso al recurso. Se conservó el fallo, sin login ni ampliación de scopes. Después se pudo leer el Dashboard existente y, por separado, metadata Worker/Container con la cuenta ya autorizada. No se sustituyó ese fallo por un HTTP 200 ni por un despliegue.

| Superficie observada el 23 de octubre | Identidad y límite |
| --- | --- |
| Pages, Dashboard existente | Fuente `c8bb0a99d9ac2bb20acaef2e5a157b0ff83b05f2`, deployment `5967773a-8618-4949-a06e-2aebfd80f3f8`; rama `main`, automático habilitado, `pnpm run build:pages`, salida `landing/out`. |
| Worker, lectura 22:43 UTC | Deployment `361204c7-d8f2-4ca2-87e8-d6e07c0e9026`, versión `315abd28-3b3c-470c-8b11-a055c0f525c0` / 86 al 100%; metadata sin commit de fuente verificable. |
| Container, misma reconciliación | Revisión 29, imagen `sha256:ea44a43c17ab24156888f1a5d0f32bedf953d3d3d1db970c4cf238a079b4c834`; capacidad configurada 1/máximo 1. Inventario completo: 0 running y una fila inactive en ese instante. No prueba ejecución efectiva singleton durante un rollout futuro. |

Estas identidades corresponden al runtime anterior, **no a `2eb3a956`**. El push a `main` activa Pages estático/gateway; no reemplaza automáticamente el Next alojado en Worker/Container. La procedencia fuente→imagen del runtime anterior continúa sin verificarse independientemente.

El preflight privado identificó 17 variables solo presentes en runtime y 18 bindings de secretos que deben preservarse. El borrador externo usa `vars: {}` y `keep_vars: true`/`--keep-vars`: expresa la intención de heredar las variables existentes sin overrides locales; el deploy normal conserva por separado los bindings de secretos. Es preparación de preservación, no verificación posterior a un despliegue. Los valores privados y argumentos públicos de Firebase permanecen fuera de Git.

La comparación efectiva del 23 de octubre a las 23:19 UTC confirmó igualdad de los **cinco campos no relacionados con la imagen que define el payload de actualización de Container**: `max_instances`, `scheduling_policy`, `rollout_active_grace_period`, `constraints` normalizadas y recursos resueltos de `configuration.instance_type`. La imagen se excluyó expresamente. El camino instalado no envía `network`, `command`, `entrypoint` ni `runtime`; su omisión no se presenta como un overwrite. No se requirieron overrides adicionales ni se ejecutó actualización remota.

La lectura acotada de Worker a las 23:21:07 UTC confirmó igualdad de fecha/flags de compatibilidad, lista de cron, `workers_dev` y `preview_urls`. La respuesta **no expone los valores de observabilidad enabled/logs/traces**, por lo que los tres siguen **sin verificar**: no se afirma paridad completa ni deriva. Las rutas/dominios personalizados omitidos no se publican mediante listas vacías en este camino. `release-config-comparison.md`, su JSON sanitizado y `release-worker-settings-comparison.json` conservan método, tiempos e igualdad sin valores privados. Todavía falta la verificación posterior a la publicación autorizada.

El dry-run Worker con rollout `none` valida empaquetado/configuración, **no construye ni arranca una imagen Linux**. Ese gate se complementó con una construcción Linux local real: `node <readiness-image>/run.mjs --build`, 23:14:06.849–23:14:57.848 UTC, 13 operaciones exit 0. El wrapper usó Docker config nueva, endpoint local named pipe verificado y cuatro argumentos públicos validados sin imprimir sus valores. Construyó desde un archivo de fuente versionada exacta `2eb3a956`, árbol `26c7c95e288ec34e8caada7c905bd86d5d6a9ef4`; la nueva QA sin versionar no forma parte de ese archivo.

Imagen local `linux/amd64`: **`sha256:631eb0060cc7b8e3b51c76d0271ccc612eadc2f57697748146705cf4c6cbdd27`**. Inspect/IID y etiquetas de revisión OCI/árbol coincidieron. En este almacén containerd local, el ID coincide con el manifest digest de BuildKit; no se lo presenta como config digest ni como digest de registry. El responsable cotejó el log privado filtrado: frozen pnpm 11.23.0, Next 16.4.1 compilado y 14 páginas. Se conservan imagen y procedencia privadas externas; **no hubo push de registry ni arranque de la aplicación**. La construcción/identidad local no prueban salud, credenciales ADC, proveedores ni rollout singleton.

El runner externo de publicación está en preparación y revisión de autor, sin ejecuciones. Antes de cualquier push se detectó que su verificación confundía el IID/manifest local de containerd con el config digest remoto; su corrección y revisión acotada permanecen pendientes en este corte. No es un cambio de código de producto ni evidencia de publicación. La identidad exacta del manifest en registry y la publicación secuenciada de Worker/Container todavía no se han establecido.

## Evidencia conservada y límites de cierre

Raíz externa: `../qa-runner/`. Completa/tipos/build: `final-checks/runs/2026-10-23T22-54-00-796Z-full-23e36ea66ef1`, `22-57-51-639Z-typecheck-cce607b36355` y `22-57-58-178Z-build-0e1752923fca` (los dos últimos con prefijo `2026-10-23T`). Auditoría: `readiness-audit/02fa82617826d303`. Gates restantes: `readiness-checks/runs/`, con los intervalos anteriores y sufijos `ad86c4577623`, `5d6c2c3c5fd9`, `4bfaa324bee2`, `b9c851bda4dd`, `ac83f13c5ec5`, `a18ed5bd0316`. Locales: `readiness-local/runs/2026-10-23T23-03-10-863Z-test-local-7a37b9d24956` y `2026-10-23T23-03-30-752Z-test-journey-edc8d11f2d6f`. Cada ejecución completada conserva comando, runtime, HEAD/estado antes/después, tiempos, exit y stdout/stderr; la completa también JSON de Vitest. Runtime: `readiness-pages-browser.json`, `readiness-runtime/worker-container.json` y el plan externo `release-runtime-plan.md`.

El resultado de imagen está en `readiness-image/runs/0329f713-9406-42b6-aaf9-4444dacef4b7/result.private.json`; solo se cotejaron campos permitidos de fuente, identidad, estados y resultados, sin copiar argumentos/logs/procedencia BuildKit privados.

Task 1 y Task 2 recibieron revisiones independientes acotadas Spec PASS/Approved. La revisión de Task 2 solo acredita su parche de dos archivos; su imposibilidad de establecer toda la release se mantiene cubierta por gates finales y por los límites que siguen abiertos aquí. Task 3 recibió aprobación para su alcance documental con observaciones pendientes explícitas.

La revisión global correctiva de `3351698a2d8eb8f9df56cf7ad0cf9d7fd27a5b3f` a `ba341870c901d27911074ec048471aee7473a80d`, conservada en `.superpowers/sdd/2026-10-23-production-readiness/final-review.md`, concluyó **implementación/spec PASS y calidad Approved**, sin nuevo defecto de código Critical/Important ni solicitud de ola correctiva. M1 conserva el ruido de avisos existente. Su R1 Important era un **gate de release en el corte de esa revisión**, cuando CI, observaciones humanas y preparación/aceptación del runtime seguían abiertas; no era un defecto nuevo de código ni aprobación general de producción.

Este corte cierra la CI candidata y documenta la comparación de configuración con sus límites. Mantiene lector audible y zoom nativo 200% **NO OBSERVADOS**, observabilidad sin paridad verificable, revisión del runner de publicación en curso, identidad de registry/publicación y aceptación de salud/singleton pendientes. La aceptación posterior al despliegue se registra después de la acción autorizada, con evidencia nueva; no se presupone ahora. No se declara accesibilidad completa, aceptación completa de P1 ni readiness total.

## Continuación: candidato corregido y backend publicado

Corte: **24 de octubre de 2026, 01:18:17.345 UTC (23 de octubre, 20:18:17.345 en Colombia)**. Fuente desplegada `cf1be13074e022c97973c0501e088f98731870ff`, árbol `bb510b3d808ae93d1ee63507ff5ae85e28c26784`. Esta actualización solo modifica QA; no cambia esa fuente de producto ni reasigna las pruebas históricas a otro commit.

Tras fallar la auditoría de CI #32, Task 4 añadió exactamente `'miniflare@5.20261006.2-beta>undici': '7.30.1'` y regeneró el lock: dos archivos, siete inserciones/cuatro eliminaciones. Se mantienen Wrangler 4.150.0, Miniflare 5.20261006.2-beta, Next 16.4.1, React/React DOM 19.3.0, Sharp 0.35.5, fuente/tests y políticas de instalación/auditoría. La revisión independiente concluyó **Spec PASS / Quality Approved**, sin hallazgos; el override debe reevaluarse cuando el padre adopte una versión corregida.

La validación local acotada conservó el RED (una alta/dos moderadas), frozen install completada, grafo efectivo Undici 7.30.1, auditoría de todas las severidades con cero hallazgos/427 pares paquete-versión, tipos, Worker 137/137 y los 22 D1 originales. Los cuatro casos de cincuenta continuaciones tardaron 11,549 / 6,671 / 11,170 / 6,388 segundos; paginación 25×4 y deadlines de 30 s intactos. El parche probado coincide con el comprometido. Se conservan las incidencias de helpers de Sharp/realpath: no se oculta el error posterior a una instalación hija exit 0 ni se repitió la instalación para obtener verde. El journey local anterior mantiene hijo exit 0/wrapper exit 1 documental.

| CI automática del PR | Resultado e identidad |
| --- | --- |
| [#31, run 40039605722](https://github.com/andresleosan/SarinBotSAAS/actions/runs/40039605722) | Head `ba341870`, merge sintético `204ebbed`: 3/3 jobs aprobados y auditoría sin hallazgos en ese momento. |
| [#32, run 40045774236](https://github.com/andresleosan/SarinBotSAAS/actions/runs/40045774236) | Head `224930b4`, merge sintético `95fbd0cd`: una alta/dos moderadas en Undici; builds posteriores omitidos. |
| [#33, run 40047065243](https://github.com/andresleosan/SarinBotSAAS/actions/runs/40047065243) | Head `cf1be130`, merge sintético `9eaa52403c95eb66d91d5909b79b9ae890441f52` sobre `main` `463ae55f`, árbol idéntico `bb510b3d`: **3/3 jobs aprobados**, final 00:55:21 UTC. |

CI #33 usó Node 24.21.0/pnpm 11.23.0: app 3.294 pasados/28 omitidos (incluidos los 22 D1), gateway 25, Worker 137/tipos/dry-run, reglas 26 y journey 129 comprobaciones/1 test con limpieza; frozen install y builds app/landing/Pages aprobados. Auditoría sin vulnerabilidades conocidas a las 00:54:37.794 UTC. Los cuatro check-runs pasaron, incluido **Pages PR preview**, que no acredita producción. Los resultados cero→tres→cero se conservan sin afirmar cuándo se propagó el índice de advisories.

Una construcción Linux/amd64 nueva desde el archivo Git exacto de `cf1be130` pasó trece operaciones. IID, etiquetas OCI/árbol y descriptor coincidieron. El push real de registry de las 01:04:01.670–01:04:35.777 UTC verificó independientemente el manifest remoto **`sha256:626f3cf3d6f3229be9f59896f21114350e36031bf15095e935ed6c9cc90b2de4`**, OCI image manifest de 2.194 bytes, a las 01:04:32.706 UTC; no lo dedujo del IID local. La imagen anterior `631eb006…` no representa esta reparación.

La revisión acotada del runner conservó autenticidad de hashes raw del contexto y equivalencia exclusiva CRLF→LF con working file/blob comprometido. También corrigió antes del push la confusión entre manifest digest y config digest. No se cambiaron fuente ni imagen para eludir esos controles. Las credenciales temporales de registry se retiraron del directorio contenido; no se retuvieron valores ni salida CLI raw y no se afirma borrado seguro.

Los dos primeros dry-runs finales fallaron antes de mutación remota, a las 01:05:01.968 y 01:10:41.762 UTC. Wrangler combinaba mal un tsconfig absoluto Windows y después usaba bases cwd/config diferentes. Dos revisiones acotadas aprobaron la representación relativa canónica al mismo archivo y el cwd del config únicamente para dry-run/deploy. El config final cambia solo imagen y esa representación; mantiene `vars: {}`, `keep_vars: true` y máximo 1. El tercer dry-run **pasó** a las 01:13:37.174 UTC, sin upload ni build; ambos fallos previos permanecen conservados.

El deploy nativo real corrió a las **01:14:15.452–01:14:23.450 UTC, hijo exit 0**. El wrapper acabó **exit 1** a las 01:14:33.950 UTC porque la primera lectura todavía mostraba Container 29/imagen anterior: `rollout-not-yet-reconciled-no-blind-retry`. Worker ya tenía deployment `72fb6955-8c66-45a1-88db-e110b8b940c4`, versión `7f129029-3c3c-4008-89b9-1882fdf9b850` y tag de fuente `cf1be130`. **No hubo retry de deploy**; la reconciliación posterior fue solo de lectura.

La reconciliación finalizada a las 01:16:02.495 UTC confirmó la misma aplicación Container en **revisión 30/imagen `626f3cf3…`**, sin rollout activo, y el binding SARIN_APP del Worker hacia esa aplicación. Los hashes posteriores al upload coincidieron con el baseline para variables, nombres de bindings secretos, settings explícitos y representación expuesta de observabilidad. Esto conserva la evidencia de 17 variables solo runtime/18 bindings; no acredita valores secretos ni paridad de observabilidad no expuesta por la API.

La comprobación pública sin cookies/autenticación de `https://sarinbotsaas.pages.dev/admin` devolvió HTTP 200/markup Next a las 01:16:33.532 UTC, pero el matcher de una frase esperada fue inconcluso. Una lectura posterior a las **01:17:19.620 UTC** confirmó HTTP 200, título SarinBot y texto servidor **«Verificando tu sesión…»**. No se hicieron acciones comerciales, de proveedor ni login; esto acredita respuesta HTML pública, no el recorrido autenticado ni salud integral.

Después del GET, el inventario completo a las **01:18:17.345 UTC** mostró una fila **running**, versión 30, un candidato activo y máximo configurado 1; imagen aprobada vigente, sin rollout activo. El hash de los cinco campos efectivos no relacionados con imagen coincidió con el baseline (`b006b9d5…`). Es una observación puntual: no prueba continuidad singleton durante todo el rollout ni drenaje de la cola.

**`main`/Pages producción siguen pendientes en este corte**; su última fuente histórica no se convierte en la nueva por haber publicado el backend. Este documento se compromete antes del push autorizado a `main`; su resultado real posterior se registrará externamente. Lector audible/zoom nativo siguen **NO OBSERVADOS**, el demo está apagado y no se declara aceptación completa de P1. NVDA se usa para observar accesibilidad, no para ejecutar el despliegue.

Evidencia externa adicional: `readiness-undici-fix/`, Task 4 report/review en `.superpowers/sdd/2026-10-23-production-readiness/`, `readiness-remote-ci/patched-ci-report.md`/JSON, imagen `c9624868…`, push `b9618fae…`, dry-runs `40bb1908…`/`5beb1a35…`/`5e27c425…`, deploy `483f5de8…`, reconciliaciones `fa32d310…`/`3a15b642…` y `readiness-public/backend-before-main.json`/`backend-html-readonly.json`. Las revisiones de binding/tsconfig/cwd y los intentos fallidos permanecen; valores privados, argumentos Firebase y procedencia/logs privados siguen fuera de Git.
