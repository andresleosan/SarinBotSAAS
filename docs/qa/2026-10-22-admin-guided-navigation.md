# Navegación administrativa guiada — verificación local P1

Ejecución: **23 de octubre de 2026**, America/Bogota. La fecha del archivo corresponde al diseño. Resultado de entrega local: **DONE_WITH_CONCERNS**. La corrección final tiene 240 pruebas focales, tipos y build aprobados, más comprobaciones reales de foco. La revisión documental fue aprobada; la revisión global detectó dos fallos corregidos en la tanda final descrita abajo. La suite completa conserva un timeout D1 y falta la observación audible con lector de pantalla. No representa aceptación totalmente verde ni publicación.

## Fuente y alcance

- Base efectiva: `463ae55f8c873468980746185fb3e91f55cb8681`.
- Checkpoint previo de producto: `c1d5742390a10bf167a9342765f50a4cb6ba80b2`; corrección exclusivamente de fixture: `b55fb49051814c0f9539fd6ea0d38ca73824336e`. Corrección final de foco: `1f7886bf70784cf8b6e68d91427d945808d74354`, rama `codex/admin-guided-navigation-20261023`, worktree aislado `C:/Users/Drean Skate/AppData/Local/SarinBot/admin-navigation-20261023/source`.
- Estado inicial de Git limpio. El checkpoint documental `f575bb0` agregó protocolo, este reporte y tres capturas; la posterior corrección final modifica únicamente la integración de foco, navegación compartida y sus tests. Se conservan API, dependencias, configuración y lockfile.
- Runtime local de verificación: Node `v24.22.0`; pin `pnpm@11.23.0`; Vitest instalado `5.0.4`. El [protocolo reproducible](../../qa/tests/admin-guided-navigation.md) contiene los casos y límites.

Los cambios organizan consola y asistente por tarea y ámbito, con selección validada en URL, shell según rol y paneles estables. Los permisos, consentimiento y acciones comerciales explícitas conservan sus controles. El alcance autorizado para esta fase es local; no hubo despliegue.

## Gates locales y arnés

Se usó el arnés externo preparado en `../qa-runner/final-checks`, con evidencia nueva por comando en `runs/`: `command-result.json`, stdout/stderr y, para Vitest, `vitest-results.json`. Cada registro incluye pin/estado de fuente antes y después, runtime, comando, PID, tiempos y salida real. No se suman los tests focales a la suite completa porque se solapan.

| Gate | Comando ejecutado | Resultado |
| --- | --- | --- |
| Diez archivos focales | `node <harness>/run.mjs focal` | Exit 0; 10 archivos, 177 tests pasados, 0 fallidos, 0 omitidos; 5,17 s de Vitest. |
| Suite completa sin filtros | `node <harness>/run.mjs full` | Exit 1; 214 archivos pasados / 2 fallidos / 4 omitidos (220); 3.251 tests pasados / 16 fallidos / 28 omitidos (3.295); 384,54 s. |
| Completa serial controlada | `node <harness>/run.mjs full-serial` | Exit 1 sobre `b55fb49`; 215 archivos pasados / 1 fallido / 4 omitidos (220); 3.266 tests pasados / 1 fallido / 28 omitidos (3.295); 642,06 s. |
| Tipos | `node <harness>/run-command.mjs typecheck` | Exit 0 sobre `b55fb49`; 18:30:23.409–18:30:27.258 UTC. |
| Build real | `node <harness>/run-command.mjs build` | Exit 0 sobre `b55fb49`; 18:30:30.252–18:31:06.054 UTC; 14/14 páginas estáticas generadas, incluidas `/admin` y `/admin/assistant`. |

Focal: `2026-10-23T18-11-07-097Z-focal-82ba8aff1c5d` (18:11:07.101–18:11:13.386 UTC). Completa: `2026-10-23T18-11-16-395Z-full-d0f483a00a7e` (18:11:16.408–18:17:42.105 UTC). El arnés de tests usa el mismo Vitest/config/tests instalados, dos workers y plazos originales; `configLoader: 'runner'`, `envDir: false`, sin caché de resultados, cachés/HOME/config externos nuevos y TEMP/TMP corto. La suite completa no recibe filtro de archivo ni de nombre. El entorno hijo permite solo variables necesarias y excluye credenciales, dotenv y opt-ins de pruebas vivas. Estas diferencias ambientales frente a `pnpm test` se hacen explícitas; no se presenta como una ejecución literal de ese script.

La primera completa **falló**. Catorce fallos en `tests/platform-whatsapp-link-pages.test.tsx` comparten `invariant expected app router to be mounted`, desde `useRouter` de Next hasta `src/components/admin-navigation-boundary.tsx:22`; dos fallos son los plazos D1 descritos abajo. Los conteos de archivos vienen del resumen de consola; el campo JSON `numTestSuites` también cuenta bloques `describe` y no equivale a archivos.

El implementador corrigió exclusivamente el fixture en `b55fb49`: hooks Next y URL sintética de la sección de WhatsApp de plataforma que el límite real ahora consume. La revisión independiente acotada dio Spec PASS/Approved y conservó todas las aserciones y el flujo real de AuthGate; su evidencia reportó RED de 14 fallos y GREEN de 32 tests en tres archivos, más tipos. Esta evidencia del implementador se distingue de las ejecuciones de Task 5.

Después de esa revisión, el responsable autorizó una única completa serial con las mismas pruebas/configuración/entorno/cachés/plazos y sin filtros; la única opción de runner modificada es `maxWorkers: 1` frente a 2. Evidencia nueva `2026-10-23T18-19-34-296Z-full-serial-18f8e414e06c` (18:19:34.300–18:30:17.474 UTC), exit 1. `platform-whatsapp-link-pages` pasó sus 17 tests; permanece el timeout D1. El experimento no demuestra que la contención sea la causa y el gate completo sigue abierto. Tipos/build se ejecutaron después, sin demo concurrente ni cambios de producto. Evidencia de tipos: `2026-10-23T18-30-23-406Z-typecheck-acbf82afed8a`; build: `2026-10-23T18-30-30-250Z-build-f245d407f6a0`.

El wrapper de tipos/build valida los scripts exactos `tsc --noEmit` / `next build` e invoca sus CLI instalados. El build conserva producción, generación normal de páginas, output standalone y `.next`; no usa tipos como sustituto. No aporta configuración Firebase falsa ni credenciales y se niega a arrancar si encuentra archivos dotenv que pudieran contener secretos. Demo apagado durante completa/build; no hubo comprobaciones Worker redundantes.

El build real terminó sin error de Suspense ni restricciones de dependencias enlazadas; no hizo falta una copia física alternativa. Registró únicamente el aviso de ausencia de caché de build. Next cambió sus dos imports generados de `next-env.d.ts` de `.next/dev/types` a `.next/types`; tras revisar el diff exacto, se restauró ese archivo generado al estado versionado. El registro de salida conserva esa modificación transitoria; no se incluye en el commit documental. Todos los procesos de gates terminaron antes de avisar al responsable para reiniciar el demo.

Las 28 omitidas de la primera completa son `deepseek-intent.live` (1, opt-in vivo), `firestore.integration` (15), `firestore.rules` (11) y `local-journey.integration` (1). No se convirtieron en pases ni se activaron proveedores/emuladores para rellenar ese conteo. La salida conserva advertencias de deprecación de `react-test-renderer`; no equivalen a fallos nuevos.

## Historia D1 que se conserva

El gate completo anterior de Task 3 terminó con **3.251 pasados / 1 fallido / 28 omitidos**: `boot and cold wake reach live claimed behind fifty stale-authority continuations without ready rows` alcanzó su plazo original de 30 s. El reintento aislado también agotó el plazo. Esos resultados no se borran por ejecuciones posteriores.

La primera comparación baseline falló antes del cuerpo de tests, en migración Miniflare D1. La prueba controlada externa reprodujo el fallo con TEMP/TMP largo y pasó las seis migraciones sin cambiar fuente al acortar solo esas rutas. En la comparación comparable posterior, baseline `b0b4960` pasó en **29.018,7 ms** y candidato `814fad3` en **25.691,9 ms**, ambos exit 0, un test pasado/21 omitidos por filtro, con el plazo de 30 s intacto. La byte-comparación verificó iguales el test, runtime D1, driver, cola, scanner, config y lockfile.

Esto establece el problema de ruta temporal del setup; no demuestra por sí solo la causa exacta del timeout original ni estabilidad repetida de la suite. El baseline quedó cerca del plazo y la carga de máquina sigue siendo una consideración. Evidencia histórica retenida en `d1-baseline-diagnosis.md` y su raíz externa `d1-baseline-20261023-125753`.

En la ejecución completa final con TEMP/TMP corto reaparecieron dos fallos en `platform-whatsapp-automation-d1.integration.test.ts:249`: los casos de cold wake detrás de cincuenta continuaciones con autoridad obsoleta, para trabajo `prepared` (30.469 ms) y `claimed` (30.018 ms), ambos `Test timed out in 30000ms`. No se aumentaron plazos ni se hicieron reintentos o cambios de producto. Los pases A/B aislados anteriores no sustituyen este resultado completo.

En la completa serial posterior también se observó un timeout del caso `prepared` (30.025 ms); el caso `claimed` pasó en 29.985 ms, muy cerca del mismo plazo original. Fue el único fallo final (`Test timed out in 30000ms`, misma línea 249). Reducir a un worker no eliminó el fallo observado y no permite declarar estable la suite ni atribuir causalidad a contención. No hubo más reintentos D1/completos ni ampliación de plazos.

## Navegador local

El responsable del demo realizó las observaciones siguientes sobre `b55fb49`, después de finalizar build/tipos y los procesos de tests. El entorno recién sembrado tuvo un negocio, 501 comprobantes pendientes y soporte vacío, todos sintéticos. No se enviaron preguntas ni mensajes, ni se guardó, aprobó un pago, subió un archivo o activó un canal/proveedor desde la UI.

- Entrada real landing → Administración → Administrador local. A 320 px, Menú de 44 px, seis destinos administrativos y Volver a Mi negocio en flujo. Tab llevó de Menú a Resumen; Escape cerró y devolvió el foco a Menú.
- A 320/390/1280 px se midió ancho de documento 305/375/1265, sin desbordamiento horizontal. Once secciones de consola permanecieron montadas: una visible, otras diez con `hidden` e `inert`; cero diálogos en DOM activo.
- Se escribió un Nombre comercial sintético largo sin guardar. Facturación → proveedor de IA → Atrás → Adelante → Atrás restauró URL, panel activo y foco del encabezado correspondientes; el texto exacto permaneció intacto. No se pulsó Guardar.
- Reflujo equivalente al 200 % mediante métricas CDP explícitas: viewport CSS de 640×450 y DPR 2 sobre superficie de 1280×900; documento de 625 px sin desbordamiento. Tab desde Añadir cuenta alcanzó Guardar facturación y ArrowDown dejó el botón completo de 44 px visible, por encima del aviso local del emulador. Los atajos de zoom nativo no cambiaron las métricas: **Chrome nativo al 200 % no fue observado**.
- Emulación de movimiento reducido: `scrollBehavior: auto` y transición del menú de 0,01 ms. Se retiraron las emulaciones y se restauró 1280×900; no se inyectó código/estilo de aplicación.

Las capturas siguientes fueron saneadas y revisadas visualmente por el responsable antes de incorporarlas. Las advertencias de emulador/Next pertenecen a las herramientas locales.

| Captura | Evidencia visible |
| --- | --- |
| [Menú administrativo, 320 px](assets/admin-guided-navigation-20261023/admin-320-navigation.png) | Marca, contexto, menú abierto y encabezado de la consola. |
| [Facturación con reflujo equivalente al 200 %](assets/admin-guided-navigation-20261023/admin-200-emulated.png) | Campo largo contenido y Guardar facturación visible; es emulación CDP, no zoom nativo. |
| [Soporte e historial, 1280 px](assets/admin-guided-navigation-20261023/assistant-support-history.png) | Tarea de soporte preservada y apertura explícita del destino en otra pestaña. |

El recorrido posterior verificó enlaces y asistente en el navegador real:

- El comprobante sintético más antiguo, excluido de los primeros 500, abrió una lectura dirigida de 501 registros, seleccionó Comprobantes y enfocó el registro exacto. Actualizar no volvió a enfocar ese registro; el botón deshabilitado perdió el foco a BODY al terminar, por lo que no se afirma conservación del foco del botón. No se abrió imagen ni se aprobó/rechazó el pago.
- Un hash válido de negocio ausente seleccionó Negocios, enfocó el aviso de cobertura y ofreció Ir al resumen; no declaró inexistencia global del registro.
- Cinco paneles del asistente siguieron montados, uno visible. Una pregunta sintética sin enviar sobrevivió Consulta → Revisión de pagos → Consulta con foco del encabezado correcto; el intervalo de Network registró cero POST de API. La cobertura parcial de 100 pagos del copilot se mantuvo explícita.
- El hash genérico de soporte seleccionó/enfocó la sección, dejando Abrir soporte web cerrado y sin textarea. El enlace de hilo válido abrió el soporte sintético existente. Un borrador sobrevivió Consulta y dos recorridos limpios de Atrás/Adelante; se enfocó el aviso de preservación y se verificó el enlace `_blank` con `noopener noreferrer`. Al pulsarlo explícitamente, la nueva pestaña abrió un workspace independiente del mismo hilo, sin borrador ni aviso; se cerró esa pestaña propia.
- Una secuencia anterior mezcló `goto` sobre la URL ya actual y mostró BODY como foco y discrepancia URL/UI. No se reprodujo en dos recorridos limpios con recarga real e historial nativo; una inspección de fuente no encontró defecto concreto. Se conserva como observación de esa secuencia, sin convertirla en pase ni aplicar una corrección especulativa.
- El responsable preparó una sola propuesta efímera local como fixture, nunca confirmada. La entrada mostró revisión real, importe sintético de 49.000 y efecto de 30 días; navegar/Atrás no preparó ni confirmó de nuevo. El intervalo del navegador registró cero POST de API. A 390 px el documento midió 375 px, sin desbordamiento ni diálogos. Recuperación de confirmación incierta/requestId permanece atribuida solo a tests.

Se observaron además respuestas tardías reales mediante CDP Fetch limitado a respuestas de GET `resourceType: Fetch` de los endpoints locales exactos, sin interceptar documentos, sustituir cuerpos ni modificar respuestas. Para pago y soporte se pausó una respuesta HTTP 200 mientras la UI cargaba, se pasó a Consulta y se continuó la respuesta original: el panel privado quedó `hidden`/`inert`, terminó de cargar oculto y el foco permaneció en `assistant-query-title`. La instantánea del árbol accesible omitió la revisión del pago y el composer privado de soporte; cero diálogos. Volver al pago conservó la revisión y enfocó el aviso de preservación. Se retiraron las interceptaciones después de cada caso.

Estos casos acreditan foco DOM y exclusión del árbol accesible; **no hubo sesión audible con NVDA/lector de pantalla**. Algunas instantáneas inmediatas de herramienta precedieron el commit de Next y se contrastaron después con URL, panel y foco reales. No se atribuye al navegador la recuperación financiera incierta que no se ejecutó.

El cierre del recorrido comprobó ámbitos, recuperación y autoridad:

- WhatsApp de Sarin y Conversaciones de negocios mostraron el panel y el ámbito explícito correctos, sin activar conexión o controles. Parámetros válidos de propuesta y soporte en conflicto recuperaron Consulta, enfocaron el aviso de recuperación y no abrieron composer; el intervalo de Network registró cero lecturas dirigidas de propuesta/hilo.
- Una pregunta sintética privada permaneció en Consulta oculta al cambiar a Revisión de pagos; Cerrar sesión por teclado retiró inmediatamente los cinco paneles privados, la navegación administrativa y el borrador oculto.
- Negocio local en la ruta administrativa recibió Acceso restringido. Landing → Mi negocio llegó a `/dashboard`, con los cuatro enlaces del dueño, cero enlaces administrativos y ningún texto privado de la sesión anterior. Se cerró también esa sesión.

El smoke previo del dueño fue observado por el responsable con emuladores oficiales, un proyecto `demo-*`, negocio y comprobantes sintéticos; no usó cuentas productivas ni envíos externos. El shell revisado era `b0b4960`, antes de la corrección final de menú y restauración del desplazamiento predeterminado del dueño:

- A 320 px, menú visible en flujo, cuatro destinos, `aria-expanded`/`aria-controls`, botón de 44 px; Tab a Mi agenda y Escape devuelve el foco a Menú. Cerrado, los enlaces ocultos quedan fuera del recorrido de Tab.
- Entrada real por las cuatro rutas existentes: agenda, configuración, QR y suscripción; ConsentPanel y contexto presentes, cierre de menú al navegar. Dueño ordinario sin enlace Administración.
- Configuración conservó logo y Guardar configuración, sin Guardar borrador/Publicar. No se guardó/subió nada, no se preparó tarjeta ni se compró.
- Sin desbordamiento horizontal observado: 320/305, 390/375 y 1280/1265 (viewport/ancho de página). A 1280 los cuatro destinos visibles y Menú oculto.
- Una carga directa inicial se atascó en el transporte Browser Use; landing → Mi negocio por enlace visible sí llegó al workspace. Una espera fría de QR agotó el tiempo de la herramienta y la URL/DOM posterior verificó la llegada; no se afirma garantía temporal.

Estos resultados previos del dueño no se presentan como un nuevo recorrido posterior a la corrección final. El cierre anterior volvió a verificar el límite de rol/acceso; las pruebas correctivas de navegación conservan sus cuatro destinos, consentimiento y desplazamiento predeterminado.

La verificación final de aquel recorrido por API local guardada el **23 de octubre de 2026 a las 18:46:15.607 UTC** confirmó 501 comprobantes, todos pendientes, el comprobante dirigido presente y cero mensajes de soporte. Su única propuesta efímera expiró normalmente; no hubo aprobación, rechazo, envío, guardado de configuración, activación de proveedor/canal, upload ni compra.

El responsable cerró todas sus pestañas, incluida la pestaña de soporte abierta explícitamente; restableció viewport/media/métricas y dejó vacíos los patrones de interceptación Fetch. Detuvo su wrapper y únicamente sus árboles de Next/emuladores; confirmó cero listeners en 3042/8080/9099/4400/4500. Los emuladores eran solo memoria, por lo que el estado sintético desapareció al apagarlos. La evidencia saneada externa permanece, sin tokens, claves o cuerpos privados exportados. No se tocaron otras pestañas, procesos o preferencias del usuario.

## Corrección y verificación finales

La revisión global independiente sobre `463ae55..f575bb0` pidió cambios: F1 importante, una respuesta tardía del pago o un envío de soporte ya iniciado podía quitar foco al aviso de preservación; F2 menor, elegir el destino móvil ya activo cerraba el menú dejando el foco sin control visible. No identificó fallos críticos. Su duda sobre desplazamiento de rutas del dueño no se consideró defecto reproducido: se restauró conservadoramente el comportamiento previo de Next para ese contexto.

Una sola tanda, `1f7886b`, añade una condición de foco por tarea: el pago/soporte conservado mantiene sus operaciones, estado y destino fijado, pero sus resultados automáticos respetan el panel activo y el aviso posterior. Una interacción explícita de puntero, teclado o clic dentro de la tarea devuelve su comportamiento habitual. No se enfoca repetidamente el aviso ni se cancela, remonta o confirma la tarea. El menú devuelve foco a Menú al seleccionar el módulo ya activo; los clics modificados conservan apertura aparte. Solo los enlaces de plataforma conservan `scroll=false`.

El implementador registró RED limpio de **15 fallidas / 221 aprobadas**, luego GREEN de 236. La autoinspección añadió un RED limpio de **una fallida / 239 aprobadas** para clic virtual de ayuda técnica, antes del GREEN final de **240 aprobadas en once archivos**, cero fallidas/omitidas. Los fallos de preparación de fixtures también se conservaron en el reporte del implementador; no se atribuyen todos a producto. Se añadió `tests/platform-support-ui.test.tsx` a los diez archivos anteriores; no se reescribe el checkpoint de 177 ni se suman conteos solapados.

| Gate posterior a la corrección | Evidencia nueva y resultado |
| --- | --- |
| Focal | `2026-10-23T19-01-17-883Z-focal-1090f3a14a48`, 19:01:17.885–19:01:21.990 UTC; exit 0, 240/240 en once archivos. |
| Tipos | `2026-10-23T19-01-17-896Z-typecheck-5b09ff32de74`, 19:01:17.898–19:01:22.938 UTC; exit 0, sin diagnósticos. |
| Build real | `2026-10-23T19-03-07-635Z-build-37d90d627781`, 19:03:07.638–19:03:24.755 UTC sobre `1f7886b`; exit 0, 14/14 páginas incluidas las administrativas. |

El responsable inspeccionó el JSON y las salidas reales. Focal/tipos verificaron el contenido exacto registrado después en el commit; su metadata conserva HEAD previo y diff local, incluido el protocolo documental independiente. Los comandos focales correctivos se mantuvieron con el mismo entorno/plazos, añadiendo solo el archivo afectado de soporte; focal/tipos finales se ejecutaron en paralelo. El build posterior fue separado, con el demo apagado. Se inspeccionó y restauró exclusivamente el cambio generado de imports en `next-env.d.ts`. No se repitió la suite completa ni D1: su último resultado sigue siendo 3.266 aprobadas / una fallida / 28 omitidas, anterior a esta corrección.

El responsable reprodujo F1 antes de corregir: GET real de propuesta retenido, Consulta, Atrás **antes** de liberar el GET; aviso enfocado y carga pendiente; liberar la respuesta original desplazó foco a «Revisa antes de aprobar». Repitió la secuencia sobre el commit final exacto `1f7886b`: después de liberar, la revisión terminó de cargar y el foco permaneció en `assistant-sensitive-notice`. No se sustituyeron respuestas ni se confirmó un pago. Error tardío, A → B, envío de soporte pendiente e interacción explícita posterior están cubiertos por componentes reales y transporte sintético; no se atribuyen a envíos de navegador.

Para F2, el navegador a 320 px reprodujo Menú → Tab a Resumen → Enter sobre su URL canónica: antes, foco BODY; después, botón Menú enfocado, altura 44 px y documento de 305 px. La navegación no cambió después de esa observación. Las capturas finales fueron revisadas visualmente:

| Captura final | Qué demuestra |
| --- | --- |
| [Selección del módulo móvil ya activo](assets/admin-guided-navigation-20261023/admin-320-active-menu-focus.png) | Menú cerrado con foco visible en su botón a 320 px. |
| [Aviso de tarea preservada](assets/admin-guided-navigation-20261023/assistant-preserved-notice-final.png) | Aviso enfocado después de un recorrido limpio de historial, en tamaño de escritorio predeterminado. La secuencia GET retenida tiene registro DOM separado; su primera captura agotó el tiempo de la herramienta. |

En este nuevo demo se prepararon dos propuestas efímeras sintéticas para comparar antes/después, ninguna confirmada. Verificación API final **19:02:29.447 UTC**: 501 comprobantes, todos pendientes, destino antiguo presente y cero mensajes. Cerrar sesión retiró los cinco paneles privados y el aviso. Se cerró la pestaña propia, se restableció viewport y se vaciaron patrones Fetch; el wrapper propio terminó y todos sus puertos quedaron libres antes del build.

La revisión independiente acotada de esta única tanda final dio **F1 y F2 ADDRESSED, restauración del desplazamiento del dueño ADDRESSED; Spec PASS y calidad Approved**, sin roturas nuevas en el diff. Leyó el paquete completo `f575bb0..1f7886b`, el reporte RED/GREEN y las observaciones de navegador; no repitió tests/build ni hizo una segunda revisión global. La aceptación de Task 5 permanece incompleta por el gate D1 y la observación audible pendiente. No se añadió zoom nativo ni se cambió backend/dependencias para obtener un resultado verde.

## Revisión y límites

El delta de producto respecto a la base efectiva comprende las dos páginas administrativas, shell, componentes/resolver de navegación y el control de sus puntos existentes de foco en pago/chat; el resto son tests y documentación. No hay rutas nuevas de backend ni cambios de lockfile. Los paneles usan `hidden`/`inert` conservando los hijos montados; la autoridad del workspace cambia con UID/época/rol/salida. La fuente del límite de navegación incluye Suspense para `useSearchParams`.

La búsqueda estática acotada de componentes administrativos no encontró `createPortal`, `<dialog` o `autoFocus`. Se conservan puntos de foco imperativo de pago/soporte/copilot y el nuevo encabezado de panel. Una búsqueda estática no sustituye inspección real del DOM activo ni prueba con lector de pantalla. El popup externo de reautenticación puede seguir abierto al cambiar sección; no se promete cerrarlo ni confirmar al retornar.

Las pruebas automatizadas cubren selección única, estado/instancias conservados, navegación query/hash e historial, lecturas dirigidas, respuestas/callbacks viejos y autoridad. Los casos de estado incierto/requestId se atribuyen a automatización salvo observación de navegador explícitamente registrada. Los módulos ocultos siguen sus lecturas actuales; no se promete ahorro de red, borradores durables, cancelación automática ni arreglo del límite de settings sin CAS.

La revisión independiente acotada del fixture está registrada arriba. La revisión documental de Task 5 aprobó su calidad con aceptación incompleta; la revisión integral y la corrección posterior se describen en el corte final anterior. Permanecen abiertos el gate completo D1, zoom nativo al 200 % no observado y prueba audible con lector de pantalla no realizada. El reflujo equivalente y árbol accesible observados se describen con su método y límites.

## Gates separados de publicación

La auditoría de base del **23 de octubre de 2026, 07:16 UTC**, `corepack pnpm audit --audit-level=high`, salió **1** con **dos críticas y una alta** en la dependencia directa `next@16.4.0`: [SVG/Image Optimization](https://github.com/advisories/GHSA-2464-fhr4-w9xw), [`use cache`/typed arrays](https://github.com/advisories/GHSA-673q-mjm6-r5xr) y [Server Actions DoS](https://github.com/advisories/GHSA-p3m5-59mp-jv5r). El registro de esa auditoría indica versión corregida `>=16.4.1`; no se evaluó explotabilidad y P1 no autoriza actualizar dependencias. Este fallo existente es un **bloqueo separado para publicación**: no afirmar toda CI verde.

La base exacta consultada no tenía runs, checks ni statuses remotos exitosos observables. El HTTP 200 público solo acreditó alcance de la raíz; la identidad/configuración del runtime actual quedó sin verificar por OAuth Cloudflare vencido. No se renovó autenticación ni se desplegó desde este encargo. No se ejecutaron aquí todos los jobs de `.github/workflows/verify.yml` (landing/pages, reglas/journey y Worker son gates distintos).

Antes de una publicación futura se debe reconciliar main/candidato/runtime y artefacto exactos, resolver sus gates y mantener una instancia de aplicación por la cola process-local, conforme al procedimiento vigente de publicación/reversión. Revertir UI no revierte acciones reales de usuarios ni borra datos. Esta verificación no modifica flags, canales o presupuestos.
