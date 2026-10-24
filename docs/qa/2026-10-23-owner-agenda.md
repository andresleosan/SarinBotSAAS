# P3: agenda diaria y semanal del propietario

Jornada del 23 de octubre de 2026, Colombia; recibos UTC del 24 de octubre. Fuente aislada desde `867a67b0a592afa6154e91ee7ef7130beab2dcca`, conservando P2 y el checkout original de E: sin alteraciones. Protocolo: [owner-agenda.md](../../qa/tests/owner-agenda.md).

## Resultado y alcance

La agenda ofrece Día con todos los recursos o un filtro, Semana de lunes a domingo para un recurso, ocupación registrada y detalles accesibles del día seleccionado. Conserva bloqueos, cancelación, revisión de representación, políticas, suscripción y QR existentes. No incorpora arrastre, reservas desde celdas, nuevos estados de asistencia ni endpoints.

Implementación inicial `dc3acc1` y corrección final `87a4fda`. La revisión final detectó un filtro histórico que podía quedar oculto al cambiar de fecha y una repetición de mensajes de error. Ambos hallazgos se corrigieron y la revisión independiente del rango final quedó aprobada, sin nuevos hallazgos. El filtro conserva una opción explícita mientras carga y se reconcilia después de una lectura válida.

## Evidencia automatizada

- Modelo: 19 casos; incluye desfases históricos de `America/Bogota`, carriles según coordenadas visibles y conservación de intervalos no verificables en el listado.
- Lectura, hook y compatibilidad de API: 75 casos focales aprobados tras corregir el rechazo 401/403 con JSON que no termina.
- Integración inicial: 203 pruebas en 14 archivos, TypeScript aprobado. Estos recuentos se solapan y no se suman.
- Build final de `87a4fda`: aprobado, 32,725 s, Next 16.4.1; configuración pública sintética, sin credenciales ni acceso externo. El build anterior de `dc3acc1` también pasó. Lockfile sin cambios.
- TypeScript final sobre `87a4fda`: `tsc --noEmit` exit 0, 9,385 s.
- Corrección final: ocho regresiones nuevas, 132 pruebas focales en cinco archivos y TypeScript aprobados; revisión independiente aprobada.
- Primera suite general en `dc3acc1`: 3516 aprobadas, 1 fallida y 28 omitidas. El fallo de Wrangler/D1 local se aisló mediante comparación de rutas temporales: fallaba la ruta larga y pasaba la corta con la misma ACL privada, entorno y `SELECT 1 --local`. Se acortó sólo TEMP/TMP/TMPDIR del runner externo; el caso focal pasó sin cambiar aplicación, prueba ni permisos. La repetición completa sobre `87a4fda` terminó aprobada: **3525 pruebas aprobadas, 28 omitidas, 225 archivos aprobados y 4 omitidos**, exit 0, 338,79 s de Vitest (339,624 s del runner). No se presenta la primera ejecución como aprobada.

La primera publicación en `main` (`178ceb1`) disparó [CI #41](https://github.com/andresleosan/SarinBotSAAS/actions/runs/40059270383). Cloudflare aprobó 155 pruebas y Firebase aprobó 26 pruebas más el journey con 129 comprobaciones. El gate general obtuvo 3524 aprobadas, 1 fallida y 28 omitidas: la espera de entrada a la cola en `platform-whatsapp-automation-d1.integration.test.ts` venció a los 1000 ms antes de observar el trabajo. El job de despliegue quedó `skipped`; esa ejecución no publicó producción.

Una reproducción controlada demoró sólo la primera lectura D1 previa a la cola en 1200 ms: con el límite original falló exactamente `normalQueued` (1 esperada, 0 observada); con 5000 ms pasó conservando las mismas comprobaciones de revocación, cero inferencia y cero reservas. Se retiró el wrapper de latencia. El cambio final se limita al plazo explícito de esa espera y un comentario, sin modificar código de producto, límites de producción ni aserciones. Sin la instrumentación, el archivo completo pasó 22/22 casos, ninguno omitido, en 122,19 s; TypeScript exit 0 en 9,037 s y revisión independiente aprobada sin hallazgos.

Node 24.22.0, pnpm 11.23.0, Vitest 5.0.4 y TypeScript 5.9.3. El runner externo ejecuta los mismos binarios instalados de Vitest, tsc y Next después de contrastar scripts/versiones con el lockfile. Se evitó la reparación automática de pnpm provocada por la configuración del almacén bajo `CI=true`; no hubo instalaciones ni cambios de dependencias. Comandos efectivos: `vitest run --configLoader runner --maxWorkers 2`, `tsc --noEmit`, `next build`.

## Navegador y datos sintéticos

Chrome sobre `http://127.0.0.1:3046`, Firebase Auth/Firestore emulados en `demo-sarin-bot`. Dos recursos activos, uno inactivo y uno eliminado; horario partido, día cerrado con historia, canceladas/completadas/ausencia, bloqueo, preparación guardada de 15 minutos, cita de cinco minutos solapada, margen ausente y menor representado sintético. No se aceptaron acuerdos reales ni se usaron pagos, inferencia, mensajes o datos de producción.

| Comprobación | Resultado observado |
| --- | --- |
| 1280 / 390 / 320 px | Documento de 1265 / 375 / 305 px: sin desbordamiento horizontal de página. |
| Gráfico a 320 px | Región de 222 px con contenido de 768 px; alto 403 px y contenido 667 px. Scroll local. |
| Nombres largos y privacidad | El nombre del recurso se ajusta en resúmenes y tarjetas. El gráfico no contiene contactos ni beneficiarios. Ayuda y detalles comienzan cerrados. |
| Teclado | Tab y Enter seleccionan el sábado y trasladan el foco al encabezado de sus citas. |
| Bloqueo y cancelación | POST del sábado 24, 16:00–16:30, recurso B, conservando el filtro visual A. Al seleccionar B aparece el bloqueo; después de cancelar queda como «Cancelada por negocio», un registro y cero confirmados. La navegación se deshabilita durante la escritura. |
| Representación | El componente real guarda y muestra «Revisión realizada por el negocio»; busy local a sus botones. |
| Políticas | Ambos clientes del día permanecen disponibles al filtrar por el recurso que tiene una sola cita. |
| Error parcial | GET del martes 20 interceptado con 503: «Semana incompleta», error en ese día y políticas ocultas al seleccionarlo. Tras retirar la intercepción y actualizar, se recupera el vacío correcto. |
| Historia | La cita del domingo 18 permanece visible aunque el día esté cerrado y el recurso inactivo. |
| Corrección final de filtros | En `87a4fda`, seleccionar el recurso inactivo el viernes y avanzar al sábado restaura «Todos los recursos» y muestra su cita activa. Semana con ese recurso seleccionado → Día del sábado también restaura la selección y la cita. El 503 corregido muestra un único mensaje por panel; se volvió a retirar la intercepción y recuperar la lectura normal. |
| Respuesta tardía y cuenta | Un GET retenido en Response se descarta al cerrar sesión. Al entrar como Cliente local no aparecen el negocio ni el beneficiario de la cuenta anterior. |

La entrada automática `fill` del control time modificó el DOM sin actualizar React y produjo un 400 con horas vacías. La repetición mediante el control accesible nativo `setValue` confirmó el POST correcto. No se cambió código para compensar ese problema de automatización.

Un ciclo semanal real del 19 al 25 de octubre emitió **7 GET**, todos 200, **máximo 2 simultáneos**, **645 ms** en total. Duraciones diarias: 172, 191, 117, 152, 208, 203 y 103 ms. Se guardaron sólo metadatos, sin headers, tokens ni cuerpos privados. Esta medición local no establece capacidad ni latencia productiva, ni una transacción atómica semanal.

Capturas sintéticas: [vista de ocupación](2026-10-23-owner-agenda-preview.jpg), [día completo a 1280 px](2026-10-23-owner-agenda-day-1280.jpg), [controles a 320 px](2026-10-23-owner-agenda-320.jpg), [día fallido a 320 px](2026-10-23-owner-agenda-partial-320.jpg). El día completo, la vista de ocupación y el error se capturaron nuevamente sobre `87a4fda`. [Metadatos del ciclo](2026-10-23-owner-agenda-week-metrics.json).

## Límites de verificación

El zoom real al 200 % no quedó verificado: los atajos no cambiaron el DPR observado; reducir el viewport no se presenta como sustituto. Tampoco se afirma una sesión audible con lector de pantalla ni una observación manual de polling con pestaña oculta. Visibilidad, deadlines de token/JSON, respuestas que ignoran abort, duplicados y cambios de ámbito tienen cobertura automatizada específica. La revisión de representación retrasada se prueba con el componente real y promesas controladas en integración.

La emulación Firestore no acredita el runtime D1 de producción. La verificación de despliegue se realiza por separado. Un intervalo histórico que cruza un cambio de desfase de Colombia conserva su registro y aviso, sin dibujar un bloque ambiguo.

Se retiraron interceptores, se restauró el viewport y se cerró la pestaña propia. El recibo del launcher quedó `stopped`; puertos 3046, 8080, 9099, 4400, 4500 y 9150 libres. El fixture temporal desapareció al detener los emuladores, sin exportación a producción.

## Decisiones de ejecución

1. Se ejecutó el diseño ya delegado con la autorización de continuar y publicar en `main`; no se volvió a solicitar la misma autorización. Coste si la interpretación fuera incorrecta: habría que retirar el incremento de aplicación, conservando los datos.
2. Se reutilizó el worktree aislado desde la versión efectiva de producción, manteniendo sólo `main` en el remoto. La carpeta E: con cambios locales no se usó para ejecutar ni publicar. Coste: su estado local sigue separado y requiere reconciliación propia.
3. Se conservaron Next 16.4.1 y el lockfile de la base efectiva, en lugar de la versión histórica del plan. No se introdujo una actualización de dependencias.
4. Los briefs y paquetes de revisión se prepararon con PowerShell; tareas con archivos independientes se solaparon y se revisaron después en conjunto. Coste: una incompatibilidad entre tareas exigiría corrección antes de publicar.
5. Se añadió únicamente un observador HTTP opcional a `apiFetch`, antes del JSON, para abortar globalmente la agenda ante 401/403. Los llamadores anteriores conservan errores y reintentos. Coste: cualquier regresión compartida afectaría otros llamadores; cubierta con pruebas de compatibilidad.
6. Se mantuvo el contrato real de bloqueo: dueño, consentimiento, recurso activo y horario futuro; no se añadió un requisito de suscripción inexistente. Historia y cancelación mantienen su autorización actual.
7. La revisión final del código se solapó con pruebas/build y documentación, con publicación condicionada a todos los resultados. Una corrección de código requiere revisar y verificar su rango final.

El siguiente incremento del handoff es P4, información operativa para recepción. P3 no acredita que todo el backlog de Fresha esté implementado.
