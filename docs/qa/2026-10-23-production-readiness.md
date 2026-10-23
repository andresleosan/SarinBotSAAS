# Corrección de bloqueos de publicación — evidencia local

Estado: **Evidencia disponible; gates manuales/remotos abiertos**. Este informe registra la corrección posterior a P1 y no modifica su [informe histórico](2026-10-22-admin-guided-navigation.md). El verde local no acredita CI remota ni aceptación del runtime de producción. No se ha desplegado, publicado ni enviado a `main` durante esta validación.

## Fuente y alcance

- Base de la corrección: `3351698a2d8eb8f9df56cf7ad0cf9d7fd27a5b3f`.
- Corrección D1: `8fa64c19c3d84eb5f6ee4b1761231c8024d8362b`; dependencias y **fuente exacta de los gates finales**: `2eb3a956f035b002d65c3e790ab52b631108709c`.
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

Al cierre de este corte documental, el demo manual permanece activo, con una nueva pestaña en Consulta y un GET retenido para coordinar NVDA con el titular. Todavía se espera su señal de preparación; no se ha observado el resultado audible ni se declara aprobada esa secuencia. Los resultados humanos o remotos posteriores requieren evidencia nueva fechada.

El demo se lanzó a las 23:02:27 UTC mediante el `start.mjs` externo existente, Firebase CLI oficial cacheada 15.33.0 y Next 16.4.1, con entorno demo canónico, en el puerto 3042; no fue una ejecución literal de `pnpm run dev:local`. El wrapper local preserva el script journey real: este elimina `NODE_OPTIONS` en su hijo. El guard loopback del launcher no cubre los workers Vitest/fixtures; allí rigen las protecciones existentes de entorno demo, inventario de emuladores, URLs loopback permitidas y rechazo de inferencia/credenciales. El aislamiento del servidor demo es independiente del guard del launcher.

## Producción actual y preparación de publicación

La primera lectura CLI de Pages falló por autenticación/permisos; `whoami` exitoso no acreditaba acceso al recurso. Se conservó el fallo, sin login ni ampliación de scopes. Después se pudo leer el Dashboard existente y, por separado, metadata Worker/Container con la cuenta ya autorizada. No se sustituyó ese fallo por un HTTP 200 ni por un despliegue.

| Superficie observada el 23 de octubre | Identidad y límite |
| --- | --- |
| Pages, Dashboard existente | Fuente `c8bb0a99d9ac2bb20acaef2e5a157b0ff83b05f2`, deployment `5967773a-8618-4949-a06e-2aebfd80f3f8`; rama `main`, automático habilitado, `pnpm run build:pages`, salida `landing/out`. |
| Worker, lectura 22:43 UTC | Deployment `361204c7-d8f2-4ca2-87e8-d6e07c0e9026`, versión `315abd28-3b3c-470c-8b11-a055c0f525c0` / 86 al 100%; metadata sin commit de fuente verificable. |
| Container, misma reconciliación | Revisión 29, imagen `sha256:ea44a43c17ab24156888f1a5d0f32bedf953d3d3d1db970c4cf238a079b4c834`; capacidad configurada 1/máximo 1. Inventario completo: 0 running y una fila inactive en ese instante. No prueba ejecución efectiva singleton durante un rollout futuro. |

Estas identidades corresponden al runtime anterior, **no a `2eb3a956`**. El push a `main` activa Pages estático/gateway; no reemplaza automáticamente el Next alojado en Worker/Container. La procedencia fuente→imagen del runtime anterior continúa sin verificarse independientemente.

El preflight privado identificó 17 variables solo presentes en runtime y 18 bindings de secretos que deben preservarse. La preparación propone configuración externa revisada y `--keep-vars`; esto no preserva por sí solo triggers, rutas, observabilidad ni todos los ajustes del Container. Faltan comparación efectiva y verificación posterior a una publicación autorizada. Los valores privados y argumentos públicos de Firebase permanecen fuera de Git.

El dry-run Worker con rollout `none` valida empaquetado/configuración, **no construye ni arranca una imagen Linux**. Ese gate se complementó con una construcción Linux local real: `node <readiness-image>/run.mjs --build`, 23:14:06.849–23:14:57.848 UTC, 13 operaciones exit 0. El wrapper usó Docker config nueva, endpoint local named pipe verificado y cuatro argumentos públicos validados sin imprimir sus valores. Construyó desde un archivo de fuente versionada exacta `2eb3a956`, árbol `26c7c95e288ec34e8caada7c905bd86d5d6a9ef4`; la nueva QA sin versionar no forma parte de ese archivo.

Imagen local `linux/amd64`: **`sha256:631eb0060cc7b8e3b51c76d0271ccc612eadc2f57697748146705cf4c6cbdd27`**. Inspect/IID y etiquetas de revisión OCI/árbol coincidieron. En este almacén containerd local, el ID coincide con el manifest digest de BuildKit; no se lo presenta como config digest ni como digest de registry. El responsable cotejó el log privado filtrado: frozen pnpm 11.23.0, Next 16.4.1 compilado y 14 páginas. Se conservan imagen y procedencia privadas externas; **no hubo push de registry ni arranque de la aplicación**. La construcción/identidad local no prueban salud, credenciales ADC, proveedores ni rollout singleton.

## Evidencia conservada y límites de cierre

Raíz externa: `../qa-runner/`. Completa/tipos/build: `final-checks/runs/2026-10-23T22-54-00-796Z-full-23e36ea66ef1`, `22-57-51-639Z-typecheck-cce607b36355` y `22-57-58-178Z-build-0e1752923fca` (los dos últimos con prefijo `2026-10-23T`). Auditoría: `readiness-audit/02fa82617826d303`. Gates restantes: `readiness-checks/runs/`, con los intervalos anteriores y sufijos `ad86c4577623`, `5d6c2c3c5fd9`, `4bfaa324bee2`, `b9c851bda4dd`, `ac83f13c5ec5`, `a18ed5bd0316`. Locales: `readiness-local/runs/2026-10-23T23-03-10-863Z-test-local-7a37b9d24956` y `2026-10-23T23-03-30-752Z-test-journey-edc8d11f2d6f`. Cada ejecución completada conserva comando, runtime, HEAD/estado antes/después, tiempos, exit y stdout/stderr; la completa también JSON de Vitest. Runtime: `readiness-pages-browser.json`, `readiness-runtime/worker-container.json` y el plan externo `release-runtime-plan.md`.

El resultado de imagen está en `readiness-image/runs/0329f713-9406-42b6-aaf9-4444dacef4b7/result.private.json`; solo se cotejaron campos permitidos de fuente, identidad, estados y resultados, sin copiar argumentos/logs/procedencia BuildKit privados.

Task 1 y Task 2 recibieron revisiones independientes acotadas Spec PASS/Approved. La revisión de Task 2 solo acredita su parche de dos archivos; su imposibilidad de establecer toda la release se mantiene cubierta por gates finales y por los límites que siguen abiertos aquí. Revisión global del rango correctivo: pendiente. CI remota, observaciones audible/zoom nativo, publicación y aceptación de producción: pendientes; no se declara readiness total.
