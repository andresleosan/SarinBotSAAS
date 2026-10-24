# P2 — Configuración guiada del negocio

Ejecutado el 23 de octubre de 2026 (Colombia). P2 está implementado y validado localmente. No está desplegado y este reporte no declara completada la integración completa de Fresha.

## Fuente y alcance

- Rama: `codex/fresha-p2-20261023`.
- Base efectiva P1: `33edcbc57ed57a85f41200dbc65f3b099d7114ec`.
- Fuente: `C:/Users/Drean Skate/AppData/Local/SarinBot/fresha-p2-20261023/source`.
- [Diseño](../superpowers/specs/2026-10-22-owner-guided-configuration-design.md), [plan y ejecución](../superpowers/plans/2026-10-22-owner-guided-configuration.md), [protocolo reproducible](../../qa/tests/owner-guided-configuration.md).

El alta ahora tiene tres etapas: datos del negocio, agenda (recursos, servicios y horarios por separado), y revisión antes del guardado público. Un negocio configurado abre un resumen con editores por sección. El asistente es opcional, revisa diferencias antes de aplicar una propuesta en memoria y conserva las restricciones de salud y menores. El logo mantiene su guardado independiente.

El borrador vive bajo AuthProvider, solo en memoria de la pestaña, ligado a UID/época/negocio y generación de autoridad. Cada reentrada exige una lectura nueva antes de mostrarlo. La pérdida de autoridad purga borrador y comandos. Un POST pendiente o incierto bloquea otro envío; una consulta coincidente no confirma la petición original. Se reutilizan esquema y POST agregado existentes, sin backend, dependencias, lockfile, endpoints o migraciones nuevos.

## Comprobaciones automatizadas

Windows, Node `24.22.0`, pnpm `11.23.0`; instalación con lockfile congelado. Como pnpm no estaba en PATH, se invocó su CLI oficial ya almacenada en Corepack mediante Node. `--configLoader runner` se conserva en los comandos Vitest de este entorno.

| Comprobación | Resultado final |
| --- | --- |
| `pnpm test --configLoader runner --maxWorkers 2` | Exit 0; 220 archivos correctos, 4 omitidos; **3390 pruebas correctas, 28 omitidas**, 3418 totales; 224,90 s. |
| `pnpm run typecheck` | Exit 0. |
| `pnpm run build` | Exit 0; Next compiló y generó las 14 páginas estáticas. |
| Revisión independiente de código | Sin hallazgos bloqueantes pendientes. |

Las 28 pruebas omitidas son comprobaciones optativas del repositorio (emulador/journey e inferencia real); no se activaron para esta suite. El recorrido de navegador sí usó emuladores locales. No se ejecutó inferencia real. No se suman suites focales y completa como si fueran pruebas diferentes.

Las pruebas nuevas cubren modelo (12), provider (37), workspace (27) e integración (20); están incluidas en la suite completa. Cubren validación y campos ocultos, propuestas, metadatos, autoridad, cambios de cuenta, errores definitivos y de transporte, límite GET de 10 s, aviso POST a 20 s, generación revocada, respuesta tardía, concurrencia, logo y políticas.

Se conservaron los fallos de desarrollo: la primera suite completa coincidió con dos regresiones UI en RED y detectó una prueba antigua que montaba el chat dentro de la página. Se corrigieron Atrás y la recuperación del borrador; la prueba de chat ahora comprueba el componente extraído y el envío posterior sin reintento. La segunda suite completa anterior es el resultado final. La revisión también detectó que una respuesta POST válida puede normalizar URLs o preservar metadatos omitidos: dos regresiones verifican que se adopte la respuesta canónica del comando original, sin exigir un eco literal del payload.

Los logs de trabajo saneados permanecen fuera de Git en `../work/` (`full-tests-final.log`, `typecheck-final.log`, `build-final.log` y reportes por área). PowerShell presenta el mensaje de inicio de pnpm escrito en stderr como `NativeCommandError`; los códigos de salida finales de los tres comandos fueron 0. El archivo generado `next-env.d.ts` se devolvió al contenido de la base tras el build.

## Recorrido de navegador observado

Chrome, Next local en `127.0.0.1:3044`, Auth/Firestore emulados en `demo-sarin-bot`, Java Temurin 21. El fixture temporal creó exclusivamente el dueño `sarin-local-owner` y el negocio `b_7750d777e06e00d9b398600d50af1233`, con acceso y consentimiento sintéticos. Se usaron modos general, salud y menores sobre ese mismo negocio, de forma secuencial. No se aceptaron acuerdos reales ni se usaron credenciales de producción, pagos, mensajes, inferencia o datos de personas reales.

| Caso | Evidencia observada |
| --- | --- |
| Alta manual en 390 px | Tres etapas; una subsección de agenda por vez; nombre, WhatsApp, recurso, servicio de 30 min y 25.000 COP; siete días cerrados válidos. Revisión con efecto público explícito; POST 201 y resumen guardado. |
| Atrás y reentrada SPA | Atrás desde revisión vuelve a horarios sin perder valores. Ir a Mi agenda y volver con Back oculta primero la configuración; tras lectura nueva restaura sección y borrador con el aviso de cambios de esta visita. |
| Edición configurada | Enlace reservado de solo lectura; resumen por secciones. Edición de servicio conservada; Cancelar exige confirmación y descarta solo el cambio local. |
| Conflicto externo | Con borrador modificado, el fixture cambió la categoría publicada. La reentrada conservó el borrador, mostró valores antes/después y exigió revisión antes de guardar la configuración completa sobre la actual. |
| Móvil y teclado | Inspección en 320, 390 y 1280 px. En servicios a 320 px no hubo desbordamiento horizontal del documento; Tab pasó de nombre a descripción y se observó foco en encabezados al cambiar etapa. |
| Salud | La sección de asistente solo muestra el aviso de formulario sin IA; no monta conversación ni editores de tono/reglas. |
| Menores representados | Se mantienen tono/reglas generales y no se muestran preguntas de intake restringidas. |
| Logo | Se comprobó la sección, el aviso de guardado separado y controles propios. No se subió un archivo durante este recorrido; preservación y contratos se cubren también en pruebas automatizadas. |
| POST lento y GET coincidente | CDP retuvo únicamente la respuesta Fetch del POST local después del 201 real. Tras 20 s apareció el aviso de espera; el GET periódico ya coincidía con lo enviado. No se anunció éxito, ni se habilitaron campos, descarte o segundo guardado. Liberar la respuesta original sí confirmó el guardado. |
| Resultado incierto | Otro POST recibió 201 en servidor, pero se simuló fallo de transporte en su respuesta. La interfaz quedó incierta y bloqueada; Consultar devolvió datos coincidentes y mantuvo la barrera. |
| Revocación con misma cuenta | Una consulta controlada respondió 403 de propietario mientras existía el comando incierto. Desaparecieron formulario, logo y borrador. Reintentar con GET real inició una sesión nueva desde el estado publicado, sin restaurar el comando purgado. |

La interceptación se limitó a `/api/businesses` del origen loopback y a recursos Fetch. Se retiró al finalizar. No se capturaron cabeceras Authorization ni conversaciones. El viewport se restauró y se cerró la pestaña propia. El launcher local se cerró y se verificó que los puertos 3044, 8080, 9099, 4400, 4500 y 9150 no quedaran escuchando; los fixtures eran memoria del emulador sin exportación.

## Capturas

- [Resumen guardado, escritorio](assets/fresha-p2/desktop-saved.jpg).
- [Editor de servicios, 320 px](assets/fresha-p2/mobile-service-320.jpg).
- [Modo de salud, 390 px](assets/fresha-p2/health-manual-390.jpg).
- [Autoridad revocada, 390 px](assets/fresha-p2/revoked-390.jpg).

## Límites y continuación del handoff

- Pendiente de aceptación manual: zoom real del navegador al 200 % y lector de pantalla audible. La reducción del viewport no se presenta como prueba de zoom. El recorrido de logo con carga de archivo, Forward y las variantes de red/402/null fuera de las observadas se mantienen en el protocolo; las invariantes correspondientes tienen pruebas automatizadas.
- El aviso fijo de Firebase Emulator cubrió el botón inferior de cancelación en 320 px. Se verificó por teclado; es una superposición del entorno de desarrollo, no evidencia de un fallo del build de producción.
- La API no ofrece CAS, operationId ni consulta durable de resultado. Revisar cambios externos reduce sobrescrituras inadvertidas pero no evita una carrera posterior. Reload/cierre pierde la memoria y no demuestra que un envío anterior terminó. No se ofrece como recuperación segura.
- No hay despliegue ni verificación de producción de P2. Para publicar: usar esta fuente revisada y el procedimiento vigente, completar la aceptación manual pendiente y confirmar CI/artefacto exacto; conservar una sola réplica. Revertir UI no revierte configuraciones o logos ya guardados.
- El siguiente incremento del handoff es **P3, agenda por tareas**. Conocimiento del recepcionista, asistencia y los demás incrementos siguen separados; el slot `assistantScope` queda listo para composición futura, sin afirmar capacidades nuevas.
