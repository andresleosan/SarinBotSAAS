# Resumen operativo S17 — QA del 25 de octubre de 2026

Base publicada `6f523a7a3be38f2f69d97094c1a561824fd6c231`; rama `codex/owner-operation-summary-20261024`, código final `8beae02`. Se ejecutó el orden10 de la composición desde el diseño/plan aprobados, trasladando solo ese par desde E:. El checkout mixto y las evidencias anteriores permanecen conservados. No se reabrió S07. Este incremento S17 sigue local; no hay merge, push ni despliegue suyo realizado.

## Resultado funcional

Entrada secundaria desde Mi agenda a `/dashboard/reports`, conservando los cuatro destinos principales y sus guardas. Lectura del dueño vigente por fecha guardada/estado actual, periodos inclusivos de1–31 días, Hoy/7/30, sin polling propio. La consulta recibe un timestamp de servidor; el avance monótono determina los presets posteriores sin volver a etiquetar cifras antiguas como actuales.

Una transacción lee negocio y una consulta acotada de citas.999 documentos recuperados son admisibles;1000 devuelven413 sin resultado parcial. Se excluyen bloqueos válidos, se avisan registros inválidos y los que no tienen fecha indexable pueden faltar. Se cuentan citas una vez, sin importes, personas, tasas u ocupación. No hay dependencia nueva de CRM/turnos, gates de plan/consentimiento para historia propia, escrituras, SQL, índices, allowlists o dependencias nuevas.

## Gates observados

| Comprobación | Resultado |
| --- | --- |
| Modelo/dominio/rutas/D1 |43/43, incluidos autorización, contrato estricto, coherencia y999/1000. |
| Corrección de autoridad, cuatro suites de reporte |23/23 tras RED del sondeo real de negocio. Navegación y dashboard incluidos además en suite general. |
| Suite completa, primer pase sobre d045806 |4267 aprobadas,0 fallidas,37 omitidas;275 archivos con pruebas aprobadas y4 solo omitidos,279 total; exit0. |
| Suite completa final sobre8beae02 |4267 aprobadas,0 fallidas,37 omitidas;275 archivos con pruebas aprobadas+4 solo omitidos=279 total; exit0 en408315ms. |
| TypeScript independiente |Exit0 después de la corrección de autoridad; cambio posterior del producto solo clases responsive. |
| Build final Next16.4.1 |Exit0, compilación, TypeScript y generación de rutas, incluido GET y página de resumen. |
| Firestore real, reglas y Admin |35/35,14 reglas y21 Admin, emulador oficial/Java21, exit0. Sin cambios posteriores de backend: no se repitió. |
| Worker |Sin cambios S17; no se ejecutó check/deploy rutinario. FAQ compatible ya publicado por CI49. |

La suite general omite las suites opt-in. El gate Firestore se ejecutó por separado; no se atribuyen pruebas nuevas de journey/proveedor a S17. Los comandos equivalentes del paquete se invocaron mediante sus entrypoints instalados exactos, con entorno estéril y versiones cotejadas contra lock; no hubo instalación. Node24.22.0, pnpm11.23.0, Vitest5.0.4 y TypeScript5.9.3. Lock SHA256 `f035b6bd0ddb862b899be3e15ec8115cf0a47ac508f8d1e644899aa902e12358` intacto. `next-env.d.ts` generado por build se inspeccionó y restauró. Se retiraron líneas vacías finales de cuatro tests, sin modificar sus instrucciones.

## Navegador y datos sintéticos

Demo propia `demo-sarin-bot`, localhost3051/Firebase local, guard de red loopback y sin credenciales productivas. Fixture inicial21 documentos,10 de citas:9 recuperables en el rango,7 clasificables,1 bloqueo y1 estado inválido; el décimo carece de fecha. Dos recursos, precios distintos y un beneficiario representado no cambian la unidad de conteo. Negocio con suscripción vencida: su historia siguió disponible.

La sesión comenzó el24 a las23:59 Colombia y cruzó medianoche real. El resultado inicial conservó periodo18..24 y hora de consulta; después de medianoche, Hoy consultó25..25 y devolvió vacío con advertencia de cobertura.7 días pasó a19..25. La confirmada cuyo buffer terminaba al final del24 entró en el subconjunto terminado sin resultado al consultar de nuevo:1→2, sin autoasignar atención.

Una corrección explícita del fixture local cambió `completed`→`no_show`: Actualizar mantuvo total7 y cambió atendidas1→0/ausencias1→2. Fue una mutación sintética directa para observar la lectura; **no** acredita un recorrido del escritor de asistencia. Cero eventos de asistencia y cero conversaciones. Un rango excesivo retiró las tarjetas, mostró error y recibió foco; usar el preset recuperó el resultado. Las fechas se editaron mediante el control nativo; un primer intento de `fill` no había confirmado el cambio en React y no se contó como prueba del error.

Se añadieron990 bloqueos de fixture para llegar a999 filas recuperables: siguió mostrando7 citas. Un bloqueo más llevó a1000: error de capacidad y cero tarjetas; Hoy, con rango reducido al25 sin filas, volvió a vacío con cobertura. No se sumaron páginas parciales. Inventario final1001 documentos de citas,1000 indexables y1 legado sin fecha; negocio intacto y únicamente corrección/capacidad como mutaciones explícitas. Los resúmenes de `--verify` conservan los campos de conteo de la siembra inicial; los recibos `s17-capacity999.json`/`s17-capacity1000.json` contienen los recuentos finales correctos. Hash final comprobado contra el último recibo. No se restauró ni purgó la siembra.

Responsive observado en320/390/640/1280px. QA detectó fechas de30px a390: captura/medición RED conservadas; grid las deja en239px a320,309px a390 y265.5px a640. Sin desbordamiento global; tabla de515.64px desplaza dentro de247px a320. Teclado/control nativo y foco explícito de error/resultado observados; no se atribuye una auditoría completa de accesibilidad. Ctrl+plus no cambió las métricas del navegador: zoom nativo200% **no observado**; lector audible **no observado**. Los overlays visibles de demo/DevTools no son parte del informe productivo.

| Vista | Evidencia |
| --- | --- |
|999 filas, resultado tras corrección,1280px |[summary-999-1280.png](2026-10-25-owner-operation-summary-evidence/summary-999-1280.png) |
|Campos legibles390px |[summary-390.png](2026-10-25-owner-operation-summary-evidence/summary-390.png) |
|Tabla con scroll local320px |[table-320.png](2026-10-25-owner-operation-summary-evidence/table-320.png) |
|Distribución640px |[summary-640.png](2026-10-25-owner-operation-summary-evidence/summary-640.png) |
|Error de rango y cobertura |[range-error-640.png](2026-10-25-owner-operation-summary-evidence/range-error-640.png) |
|1000 filas, sin totales parciales |[capacity-1000-1280.png](2026-10-25-owner-operation-summary-evidence/capacity-1000-1280.png) |
|Reducir rango permite volver a consultar |[reduced-period-1280.png](2026-10-25-owner-operation-summary-evidence/reduced-period-1280.png) |
|Medianoche, Hoy vacío |[midnight-empty-1280.png](2026-10-25-owner-operation-summary-evidence/midnight-empty-1280.png) |

Se cerró sesión y pestaña propias y se restableció viewport. Harness detenido y puertos3051/8080/9099/4400/4500/9150/8188 sin listeners. Datos, manifiestos, capturas y recibos conservados fuera de Git; sin motor, mensajes, pagos ni contactos reales.

## Costo local y coherencia

Medición real con el adaptador D1/SQLite del runtime de pruebas: dos respuestas de lectura, documento468 bytes/12.802ms y query2229 bytes/10.407ms,2697 bytes en total. Es una muestra local de la frontera de transporte, no latencia de usuario, coste de facturación o capacidad productiva. La query recupera9 filas y no escribe; fechas ausentes/numéricas no entran en ese índice/rango. La prueba concurrente fuerza corrección/movimiento entre lecturas: el intento primario reintenta coherentemente con4 lecturas y cero commits; un segundo handle realiza su commit explícito. No hay31 GET diarios ni una consulta por tarjeta.

## Revisión, reparaciones y límites

Una revisión independiente del incremento6f523a7..213d976: cero Critical, un Important, dos Minor. Important reproducido RED: el sondeo `useBusiness`503→200 recreaba el panel y enviaba una tercera consulta de7 días. `d045806` separa identidad de disponibilidad, conserva borrador/rango/ancla y exige Actualizar después de incertidumbre;401/403 conocido sigue purgando y no se rehabilita por una respuesta tardía. GREEN23/23. La reparación responsive posterior `8beae02` tiene RED→GREEN geométrico. No hubo re-review del mismo diff.

Minors diferidos: un fallo excepcional al calcular preset antes del ancla no invalida una lectura previa pendiente, que puede sustituir ese error; la ayuda/error de fecha carece de asociación `aria-describedby`. Etiquetas y foco explícito presentes. MinorCRM y Minor de preparación WebCrypto de FAQ continúan diferidos. Ninguno se corrigió en esta pasada.

Se conservan fallos de montaje inicial de UI (mock NextLink omitido, `self` ausente), TypeScript (clave interna filtrada/duplicada del controlador, corregido a interfaz pública exacta), y las reproducciones RED. La primera evidencia RED del modelo quedó truncada por PowerShell Stop al recibir stderr; el módulo aún no existía, pero no se atribuye un fallo de aserción que ese log no demuestra. GREEN23/23 del modelo y suites posteriores sí completos. No se reconstruyó evidencia retrospectiva.

Recibos: `../work/s17-*-result.json`, `s17-first-*`, `s17-complete-vitest.json`, `s17-summarymetrics-final.log`, `.superpowers/sdd/2026-10-22-owner-operation-summary/` y copia de cierre externa. Firestore `../work/s17-qa-runs/2026-10-25T04-42-50-611Z-b31a49/`; demo `../work/s17-qa-runs/2026-10-25T04-55-57-826Z-21378d/`. Protocolo [owner-operation-summary.md](../../qa/tests/owner-operation-summary.md).

## Publicación vigente y siguiente etapa

FAQ sí se integró y publicó por petición expresa del titular: main/origin/main6f523a7, [CI49/run40162327351](https://github.com/andresleosan/SarinBotSAAS/actions/runs/40162327351), cuatro jobs SUCCESS. Release verificado2026-10-25T04:41:11.8029913Z, Worker `57559dcc-ba36-498e-bd3b-ce16787b69aa`, Container39 y Pages `12809153-a07c-46c8-9be1-ce6ded87341e`. Runtime confirma SHA exacto y escritor S09 ausente/defaultfalse; página FAQ anónima200 con control de sesión y tres GET privados401/no-store. Sin mutaciones productivas. Evidencias `../work/faq-publish-20261024/`. CI49 reportó4200 pruebas aprobadas y36 omitidas:267 archivos aprobados+4 omitidos=271 total.

S17 permanece en rama local revisada/verificada para su etapa de integración/publicación. Al autorizarla, reconciliar Git remoto y artefactos efectivos; no repetir S07/FAQ ni los gates locales sin cambios. Rollback de S17 revierte UI/endpoint conservando citas/asistencia/índices y enforcementS09, sin restaurar datos. Después de integrar S17, siguiente funcional: revisión de espera S10, orden11. Task7S05 sigue después de S12; no habilitar otros ámbitos por esta lectura.
