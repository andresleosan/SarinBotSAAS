# S09: turnos por recurso y cierres

Rama aislada: `codex/resource-schedules-20261024`, base `a1772eb`. Implementación según diseño/plan de 2026-10-22. S06 ya se publicó por separado; S09 no se publica automáticamente. Escritor de producción por defecto **false**.

## Comportamiento comprobado

- La política ausente hereda apertura común; una política ilegible o de otro negocio falla explícitamente. Intersección de apertura, semana individual y excepción; resta de cierres; ancla de 15 minutos y buffer completo.
- Las nueve llamadas de disponibilidad usan política transaccional. La búsqueda de 14 días lee una política por búsqueda. Disponibilidad pública relee Business, sin fiarse del objeto cacheado.
- Dueño actual exclusivamente, GET sin requisito de plan/consentimiento nuevo, PUT con gate/plan/consentimiento/configuración. CAS de revisión y apertura/recursos; recibos durables independientes de política actual. No hay SQL, dependencias nuevas ni reglas privadas en publicBusiness.
- Dos handles D1: CAS, petición concurrente idéntica, respuesta perdida, replay después de revisión posterior y tres carreras de cierre/apertura común frente a confirmación. Un cierre no cancela citas existentes; una confirmación rechazada no consume unidades. Bloqueos manuales conservan su contrato.
- Un conflicto de revisión al leer D1 debe llegar al adaptador para reintentar. La repetición de Task3 detectó un catch que lo convertía en503; prueba determinista RED/GREEN y corrección `0acc3a5`.
- Controlador: GET acotado10s, aviso PUT20s sin abortar, un comando sellado ante ambigüedad, retry idéntico y recibo con hash compartido navegador/servidor. Coincidencia de reglas sin recibo no libera el comando. 403 purga y bloquea respuestas tardías; readonly no genera borrador ni PUT.
- Pantalla con una tarea principal, revisión antes/después y reconocimiento operativo antes de guardar. Enlace secundario desde Horarios en otra pestaña. Cuatro destinos principales; contexto Mi negocio en la ruta nueva.
- Agenda con política independiente de sus citas: refresh visible15s sin solapar lecturas. Error de horarios quita sombreado; citas y errores por fecha permanecen. Recursos históricos desconocidos no reciben una jornada inventada.

## Validación ejecutada

Node24.22.0, pnpm11.23.0, dependencias instaladas y lock sin cambios; entorno saneado, sin credenciales/proveedores ni inferencia.

| Comprobación | Resultado observado |
| --- | --- |
| Task1: modelo/disponibilidad | 20 pruebas |
| Task2 y regresión posterior | 27 pruebas |
| Task3: nueve flujos, D1 y regresiones | 131 pruebas |
| Task4: controlador, workspace, configuración y navegación | 70 pruebas |
| Task5: contexto de agenda y polling | 81 pruebas |
| TypeScript | exit0 |
| Next build | exit0; ruta `/dashboard/schedule` incluida |
| Firestore reglas e integración, Java21/emulador oficial | 30 pruebas, exit0 |
| Worker tests | 158 pruebas, exit0 |
| Worker TypeScript y deploy dry-run, sin rollout | exit0 |
| Suite completa inicial | 3978 passed, 1 failed, 32 skipped; ver detalle abajo |
| Suite completa previa a revisión | 3979 passed, 32 skipped; 251 archivos passed y4 skipped, exit0 |
| Regresiones de revisión | 30 pruebas en2 archivos, incluyendo9 casos nuevos RED/GREEN |
| Corrida monolítica después de correcciones | 3987 passed, 1 failed, 32 skipped: mismo RPC de preparación D1 anterior |
| Cobertura completa después de correcciones, por grupos | 3988 passed, 32 skipped, 0 failed; unión exacta255 archivos/4020 casos, exit0 |

La suite inicial falló en `d1HistoryUsesIndexedBoundedAppointmentPagesAmong1001UnrelatedEvents`, `tests/appointment-attendance-d1.test.ts:201`, durante el batch de preparación local, antes de sus aserciones: Miniflare `fetch failed`, causa `read ECONNRESET`. Es el mismo límite de transporte observado al integrar S06. La suite D1 completa aislada pasó12/12, sin cambiar código ni timeouts. Se preservaron log y resultado iniciales fuera de Git; la repetición general pasó3979/32skip, incluyendo esta prueba, sin modificar el producto ni los timeouts.

## Navegador real, localhost y datos sintéticos

Chrome, Next dev en127.0.0.1:3046 y Firebase `demo-sarin-bot`, red de procesos limitada a localhost y motor deshabilitado. Dos recursos activos, uno retirado, siete días de apertura, semana propia, excepción, cierre global parcial, cierre individual de día completo, buffers y citas fuera de turno. Se verificaron70 documentos antes de interactuar.

- Semana propia visible; tareas excluyentes; foco en título al cambiar/revisar.
- Cierre de negocio del25 de octubre añadido al borrador. El helper de automatización `.fill()` del date input no actualizaba React; teclado ArrowUp sí actualizó ambas fechas. Se comprobó el **25** en la revisión antes del envío. No se cambió producto por esta limitación del helper.
- Espacio marcó el reconocimiento; Enter ejecutó un único PUT real. Respuesta200,177ms totales/160ms de aplicación. UI mostró «Horarios guardados»; lectura de almacenamiento confirmó revisión2, tres cierres y exactamente un recibo.
- Revisión móvil320 y390px sin desbordamiento de documento (scrollWidth305 y375 respectivamente); escritorio1280px (scrollWidth1265). Controles en flujo. Capturas obtenidas: [revisión320](2026-10-24-resource-schedules/review-320.png), [cierre guardado1280](2026-10-24-resource-schedules/saved-1280.png). Algunos intentos de captura CDP agotaron su timeout; no se atribuyen a fallos de aplicación.
- Agenda de día: nueve bloques visibles, tres segmentos sombreados, ocho advertencias contextuales. Semana de recursoA: siete columnas, quince bloques y seis días sombreados (domingo cerrado).
- Un GET de política fue respondido artificialmente503 mediante interceptación CDP acotada: quince bloques conservados, fecha24 de octubre conservada, cero segmentos sombreados y «Horario no verificable». Se retiró la interceptación.
- Seis GET reales de política en toda la sesión (entrada de edición, entrada de agenda, polls y reentrada), un PUT y siete fechas distintas consultadas para citas. Primer GET frío2.2s incluyendo compilación2.0s; los cinco calientes149/86/63/65/67ms totales. Prueba de temporizador verifica por separado una consulta por15s y ausencia de solapamiento.
- Reentrada hizo GET fresco y mostró el cierre guardado, sin inputs de editor en la portada. Logout quitó el cierre privado. No se enviaron mensajes ni se ejecutó inferencia.
- Verificación final:69 documentos ajenos a la política sin cambios,47 citas con21confirmed/13completed/12no_show/1cancelled_by_owner, cero cambios de contenido inmutable, cero cabezas/eventos de asistencia. Solo política y recibo nuevos. Pestaña cerrada, viewport restablecido, demo detenido; siete puertos de QA libres.

No se observó zoom nativo200% ni lector de pantalla audible. Se comprobó semántica accesible y teclado; no se presentan como prueba de esos dos criterios. Los fallos de permisos, GET10s, pérdida de respuesta y PUT20s se probaron además en suites, no todos como fallos de transporte de navegador.

## Revisión independiente y correcciones

Revisor nuevo `s09_final_review` (gpt-6-astra/high), rango `a1772eb..f4d6e26`, solo lectura, sin servicios ni subagentes adicionales. Encontró cero Critical, cuatro Important y un Minor. La revisión no se atribuye al commit posterior como si hubiera una segunda aprobación independiente.

Una sola pasada de correcciones, commit `3bfac8b`, con nueve regresiones observadas fallar antes de corregir y30/30 verdes después:

1. Conflicto dirty tras dos GET iguales o fallo de lectura intermedio: un bit de conflicto independiente de la vista actual permanece hasta descarte explícito. Casos de revisión y basis.
2. PUT incierto seguido de retry402/409/gate503: se conserva la ambigüedad de intentos anteriores y el mismo comando. Descartar/editar/crear otro comando sigue bloqueado; solo un recibo válido resuelve el resultado.
3. Borrador válido mayor que128KiB: límite UTF-8 compartido entre ruta y controlador, comprobado antes del envío. Un413 inicial conserva el borrador editable; un rechazo posterior a ambigüedad no libera la barrera. La prueba reduce el borrador y guarda con recibo válido.
4. Vaciar inicio o fin de una jornada: el preview valida las reglas antes del resolver. El borrador incompleto permanece editable, la vista indica que debe corregirse y recupera preview válido al completar la hora.

TypeScript y build después de esta pasada terminaron con exit0. La corrida general posterior reprodujo el mismo `ECONNRESET` de preparación de `appointment-attendance-d1.test.ts:201`, con3987 casos aprobados y uno fallido antes de sus aserciones. La causa última del transporte no está establecida. La cobertura completa pasó con12 casos en la suite intensiva y3976 en el resto, con reportes JSON que comprueban la unión exacta de archivos/casos; la corrida monolítica queda registrada como fallida. El verificador de unión terminó con exit0 (`work/s09-complete-verification-result.json`, código3bfac8b). Las capturas/navegador anteriores corresponden a la integración previa a revisión; los nuevos casos se verificaron mediante pruebas de estado y render, no se inventa una nueva observación manual.

Minor diferido: la ayuda genérica explica que la apertura común limita la jornada, pero no enumera explícitamente los tramos solicitados que quedan recortados en semana/excepción/revisión. El motor sí aplica la intersección; se difiere esa mejora informativa, no un permiso para abrir fuera de horario.

## Decisiones y operación

1. Normalizar solo espacios de encabezados `Task1`→`Task 1` para el extractor de briefs; requisitos sin cambios. Riesgo: deriva de números de línea.
2. Días comunes realmente ausentes se expanden a cerrados y se permite que días comunes cerrados antiguos conserven intervalos. Días propios siguen estrictos. Mantiene compatibilidad con la configuración existente; riesgo de equivocación: rechazar o interpretar mal un horario legado.
3. Actualizar solo la allowlist actual del fixture Worker previo; literal histórico b7e9a28 permanece exacto. Riesgo: una selección de fixture incorrecta invalidaría la prueba de compatibilidad, por eso se conserva el literal histórico.
4. Interpretar la huella conservadora de propuestas junto con la sección explícita de integración futura S07: S09 conserva los contratos de propuestas cliente actuales y revalida su destino con política transaccional. La persistencia/comparación de `resourceScheduleFingerprint` se deja para las propuestas futuras del dueño S07. Riesgo de interpretación: un cambio de política ajeno al destino no invalida por sí solo una propuesta cliente que sigue siendo válida; un destino que acaba de quedar cerrado sí se rechaza.
5. Ejecutar la cobertura final completa en dos procesos disjuntos: suite D1 de asistencia intensiva y todos los demás archivos. Se conserva código y timeouts de pruebas, con inventario JSON para verificar cobertura. Reduce su ejecución concurrente con otros sidecars de Miniflare. Riesgo: el fallo local de la corrida monolítica sigue siendo una limitación del entorno/CI que requiere seguimiento; la partición no demuestra que ese RPC sea estable bajo concurrencia.
6. Conservar el workspace ignorado del plan y una copia externa verificada por SHA256 en `work/s09-review-record-20261024/`: la política automática rechazó su limpieza recursiva con el motivo «blocked by policy». Se adoptó la conservación de evidencia. Coste: scratch local duplicado; ningún cambio funcional.

El lector aplica las políticas aunque el escritor se apague. Rollback seguro: conservar un lector compatible y poner el gate enfalse; no regresar a una versión que ignore políticas existentes ni borrarlas para deshacer cambios. Revertir reglas requiere un nuevo comando CAS revisado. No hay activación de producción en este incremento.

Evidencia detallada y fallos RED preservados fuera de Git en `work/s09-*`, junto al worktree aislado. No contiene exportaciones privadas dentro del repositorio.
