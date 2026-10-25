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
| Suite completa final | Pendiente de repetición antes de cerrar la rama |

La suite inicial falló en `d1HistoryUsesIndexedBoundedAppointmentPagesAmong1001UnrelatedEvents`, `tests/appointment-attendance-d1.test.ts:201`, durante el batch de preparación local, antes de sus aserciones: Miniflare `fetch failed`, causa `read ECONNRESET`. Es el mismo límite de transporte observado al integrar S06. La suite D1 completa aislada pasó12/12, sin cambiar código ni timeouts. Se preservaron log y resultado iniciales fuera de Git; la repetición general sigue pendiente en esta versión del informe.

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

## Decisiones y operación

1. Normalizar solo espacios de encabezados Task1→Task1 separado para el extractor de briefs; requisitos sin cambios. Riesgo: deriva de números de línea.
2. Días comunes realmente ausentes se expanden a cerrados y se permite que días comunes cerrados antiguos conserven intervalos. Días propios siguen estrictos. Mantiene compatibilidad con la configuración existente; riesgo de equivocación: rechazar o interpretar mal un horario legado.
3. Actualizar solo la allowlist actual del fixture Worker previo; literal histórico b7e9a28 permanece exacto. Riesgo: una selección de fixture incorrecta invalidaría la prueba de compatibilidad, por eso se conserva el literal histórico.

El lector aplica las políticas aunque el escritor se apague. Rollback seguro: conservar un lector compatible y poner el gate enfalse; no regresar a una versión que ignore políticas existentes ni borrarlas para deshacer cambios. Revertir reglas requiere un nuevo comando CAS revisado. No hay activación de producción en este incremento.

Evidencia detallada y fallos RED preservados fuera de Git en `work/s09-*`, junto al worktree aislado. No contiene exportaciones privadas dentro del repositorio.
