# Bandeja y revisión manual S10 — QA del 25 de octubre de 2026

Base `39a53ed30c4119e5ef8c48e2e32a48f8df4896a5`; rama `codex/owner-waitlist-review-20261025`, producto final `29a55f4`. Orden11 de la composición: bandeja FIFO y revisión privada, primera fase S10. El par aprobado se trasladó desde E:; solo se normalizaron espacios de encabezados Task1→Task 1 para extraer briefs. E: mixto permanece protegido, con archivos/evidencias conservados. S10 sigue local: no hay migración, push o despliegue suyo realizado.

## Resultado

`/dashboard/waitlist` usa contexto Mi agenda y enlace secundario, conservando cuatro destinos/guardas. Una fecha, páginas20 con lookahead21, FIFO createdAt/entryId ordinal y continuación de empates sin perder filas. Lista consulta hasta21 solicitudes y20 marcas en concurrencia4; no calcula slots ni consulta perfiles por fila. Incompletas pueden faltar; retiradas/reemplazadas no son archivo histórico ni total de personas.

Dueño vigente exacto en cada lectura/escritura, sin bypass superadmin. Lectura sin nuevo gate de plan/consentimiento; marcar requiere consentimiento de cuenta, sin ocupar capacidad o exigir plan. UID cliente solo deriva del registro canónico y entra en helpers read-only, nunca en join/cancel/book ni como autenticación ficticia. DTO ownerUid siempre es dueño autenticado; sin UID cliente, contacto, caso completo, anclas, recibos, actor o nombre de menor.

Seleccionar fila es local; Ver disponibilidad llama el detalle compartido con cliente, respetando permisos, política, cupo, ocupación sin truncar, buffer y S09 en la misma transacción. Leer policy antes del reloj final evita devolver estado viejo si cruza medianoche. Consultar no retiene horarios, revisada no resuelve espera ni notifica; el cliente conserva Comprobar horarios→Elegir horario→revisar/confirmar. Agenda abre `/dashboard` y pide seleccionar fecha; no añade deep-link ni cambia S07.

## Revisión y pasada de reparación

Una revisión independiente `s10_review` de39a53ed..21e7e49 encontró0Critical,3Important y0Minor. Los tres se aceptaron por efecto real, reprodujeron RED y repararon en una pasada `29a55f4`; sin re-review.

| Important | Reparación y evidencia |
| --- | --- |
| Cancelar cliente después de PATCH incierto dejaba barrera permanente:404detalle/409retry no ofrecían prueba de tombstone. | GET readonly `/owner-waitlist/{recordId}/review` devuelve solo dueño/negocio/record/revisión de espera/entrada nullable/revisión de marca/servidor. Tombstone canónico con revisión mayor cerca A sin atribuir éxito histórico; ausencia404 sigue sin probar nada. Dominio y hook RED→GREEN; recorrido de hook con dominio real pierde respuesta PATCH, cancela, recupera proof y continúa. |
| Reusar join requestId después de salida conserva entryId y heredaba revisada. | Marca privada versión2 liga waitlistRevision. V1 solo acredita primera encarnación; marca válida anterior no se asigna a otra, y revisión futura falla503. IDs/contrato/replay cliente conservados. Rejoin revision3 empieza sin revisión y nuevo comando escribe marca2 ligada a3. El hook acepta mayor waitlistRevision como fence aunque entryId sea igual. |
| Más de100 marcas de una cuenta hacía imposible el borrado; más de1000 bloqueaba exportar. | Export por cuenta pagina por document ID real con consultas100. Helpers privados verifican/borran≤100 por tx, encadenan recibos ligados al export, recuperan lote presente/ausente y verifican inventario residual antes de complete.1006documentos reales en D1 y203en Firestore; pruebas de vecinos, deriva y respuesta perdida. |

La reparación del mantenimiento añade `__name__` privado tipado: D1 traduce a columna física document_id, sin confiar en JSON id ni excluir documentos corruptos sin campos de orden. Índice aditivo de marca usa parent/waitlistRecordId/document_id/path. No existe ruta pública de exportación/borrado. WritersStopped:true declara la precondición operativa; no detiene servicios. [Procedimiento completo](../waitlist-data-lifecycle.md).

Minors nuevos S10: ninguno. MinorCRM, MinorFAQ WebCrypto y los dos MinorsS17 siguen diferidos; no se modificaron. Zoom nativo200% y lector audible no observados, sin aceptación atribuida.

## Gates

| Comprobación | Resultado observado |
| --- | --- |
| Modelo/dominio/inbox/rutas |47/47 antes del último caso de corrupción de encarnación; modelo final11/11. Contratos cliente conservados en gate de dominio ampliado. |
| Hook/UI/page/dashboard/cliente/navegación |102/102 después de reparaciones; hook18/18, incluido recorrido con dominio real y barrera ante404/revisión igual. |
| D1/mantenimiento/migración |45/45:6D1+17mantenimiento+22migración. Cuenta1006 exportada/borrada por lotes100, recuperación e índices reales. |
| Firestore final |37/37:15reglas+22Admin, emulador oficial/Java21, exit0 tras cambios de backend; incluye203documentos, paginación real por nombre y recuperación de lotes. |
| Tipos/build final |TypeScript independiente exit0 (42850ms), build Next con tipos exit0 (87010ms). |
| Worker final |162/162, tipos y dry-run; recibos de cierre conservados. |
| Suite completa final estable |4355/4355 aprobadas,39omitidas,0fallos;283archivos con pruebas aprobadas+4archivos solo opt-in omitidos=287total. Sin filtros, maxWorkers1, exit0,744494ms. |

Node24.22.0, pnpm11.23.0, Next16.4.1, Vitest5.0.4 y TypeScript5.9.3. Entry points instalados exactos/lock cotejado, entorno estéril y sin instalación. Se conserva Next publicado en vez de bajar al16.4.0 del plan histórico. Lock SHA256 `f035b6bd0ddb862b899be3e15ec8115cf0a47ac508f8d1e644899aa902e12358` sin cambios. Suite general omite opt-in; Firestore se ejecuta aparte. No se atribuye un recorrido nuevo de journey/proveedor real a S10.

Primer pase completo sobre21e7e49:4343aprobadas/2fallidas/39omitidas. Un fixture exacto de índices aún esperaba11 y debía componer el nuevo índice12; se conservó y amplió su aserción. Segundo pase completo sobre29a55f4:4354aprobadas/1fallida/39omitidas, solo `d1HistoryUsesIndexedBoundedAppointmentPagesAmong1001UnrelatedEvents`, TypeError fetch failed en batch de siembra local (línea201), antes de sus aserciones, duración10063.592ms. No se cambió esa prueba, sus plazos ni su fixture para ocultarlo. Resultados íntegros `s10-first-*` y `s10-second-*` preservados.

Diagnóstico: archivo de asistencia sin cambios12/12 al aislarlo; junto al archivo D1 que coincidió temporalmente con el fallo (`platform-whatsapp-automation-d1.integration.test.ts`),34/34 con dos workers y diagnóstico de transporte. No se reprodujo allí el error; la causa subyacente sigue sin demostrarse y no se declara reparada. La comprobación general adicional usa un worker, sin filtros, con diagnóstico Undici externo y sin cambiar tests/configuración del repositorio. El par diagnóstico terminó durante los primeros instantes de esa ejecución, por lo que tampoco se atribuye un experimento de aislamiento total del equipo. El resultado de cierre se consigna en la tabla y recibo `s10-serial-*`; no sustituye ni borra los fallos previos. Riesgo pendiente: estabilidad del transporte del harness local al ejecutar toda la suite con dos workers; no es prueba de un defecto productivo ni de su ausencia.

Otros fallos preservados: fixtures nuevos pasaron actor objeto a readConsent(uid:string) y omitieron isSuperadmin del mock al sembrar política; se corrigieron fixtures. Test de reverse asumía deletes/data en vez de deletionCandidates/update.fields. El adaptador ya recuperaba commit perdido con el mismo journal; la prueba lo caracteriza y descarta la respuesta API para probar replay de dominio. Types detectó inferencia de array vacío y get sobrecargado; se anotaron fronteras. Bucle de paginación necesitó Query/QuerySnapshot explícitos. Ninguna relajación de permisos, test cliente o timeout anterior.

## Navegador real

Demo propia `demo-sarin-bot`, localhost3053, emuladores/red loopback y entorno sin credenciales productivas. Inicial47requests:45actuales (25empates),1caducada representada y1incompleta sin fecha; cero citas/eventos/conversaciones. Se observaron páginas20/20/5, última sin siguiente, recurso retirado suspended y primer detalle available solo después de acción explícita. No se mostró UID/contacto/identidad de beneficiario.

Dos confirmaciones por UI cambiaron una sola marca revision1true→2false; solicitud permaneció activa. Cierre S09 sintético directo retiró horarios al Actualizar; revocación sintética de permisos de ese cliente devolvió suspended. Estos cambios de fixture no acreditan recorridos de los escritores S09/consentimiento. Fecha caducada mostró solo tipo de representación y ningún horario; fecha vacía conservó cobertura. Un registro adicional intencionalmente inválido en otra fecha produjo503, foco de error y ningún mensaje de vacío falso. No se restauraron datos para simular rollback.

Anchos320/390/1280 observados. A320 body305/campo fecha239; a390 body375/campo309, sin overflow global. Selección, confirmación y resultado/error tienen foco; teclado/control de fecha nativo observado. No auditoría audible completa ni zoom200% observado. Un encadenado de selectores intentó seleccionar durante el refresco de página; se leyó estado asentado antes de continuar, sin arreglo de producto atribuido a ese intento. Overlays de emulador/DevTools no pertenecen al producto publicado.

| Vista | Evidencia |
| --- | --- |
|Bandeja y cuatro destinos1280 |[inbox-1280.png](2026-10-25-owner-waitlist-evidence/inbox-1280.png) |
|Última página de5 |[page-three-1280.png](2026-10-25-owner-waitlist-evidence/page-three-1280.png) |
|Disponibilidad explícita |[availability-1280.png](2026-10-25-owner-waitlist-evidence/availability-1280.png) |
|Recurso anterior |[retired-resource-1280.png](2026-10-25-owner-waitlist-evidence/retired-resource-1280.png) |
|Confirmación local390 |[review-confirmation-390.png](2026-10-25-owner-waitlist-evidence/review-confirmation-390.png) |
|Revisada390 |[reviewed-390.png](2026-10-25-owner-waitlist-evidence/reviewed-390.png) |
|Vuelta a pendiente320 |[review-returned-pending-320.png](2026-10-25-owner-waitlist-evidence/review-returned-pending-320.png) |
|Cierre y permisos retirados |[closed-schedule-320.png](2026-10-25-owner-waitlist-evidence/closed-schedule-320.png), [revoked-consent-320.png](2026-10-25-owner-waitlist-evidence/revoked-consent-320.png) |
|Caducada y vacío |[expired-represented-320.png](2026-10-25-owner-waitlist-evidence/expired-represented-320.png), [empty-320.png](2026-10-25-owner-waitlist-evidence/empty-320.png) |
|503sin vacío falso/foco |[server-503-320.png](2026-10-25-owner-waitlist-evidence/server-503-320.png) |

Final48requests (47originales intactas+1inválida explícita),1marca revision2false, cero citas/eventos/conversaciones. Hash negocio y47requests originales conservados; cierre/revocación/registro inválido tienen pruebas de fixture separadas. Logout, pestaña propia cerrada y viewport restablecido; harness detenido. Datos/manifiestos/recibos externos conservados, no purgados. La automatización de borrado usa otros fixtures aislados, no elimina esta evidencia.

## Medición local e índices

Página real D1:22llamadas de transporte (negocio+query+20markers),21filas lookahead y27146bytes en la muestra final focalizada,488.771ms sumados de transporte. No son42GET ni slots por fila; son hasta42documentos consultados contando negocio/lookahead/marcas. EXPLAIN acredita app_waitlist_owner_fifo sin scan general/temp-sort;1001solicitudes de otra fecha no cambian el trabajo seleccionado. Export paginado usa app_waitlist_owner_review_record por recordId/nombre físico. Son mediciones locales, sin SLA ni capacidad/factura productiva inferidos.

0009 es aditiva, no reescribe solicitudes/citas. Firestore añade fecha/createdAt/entryId FIFO; nombre de documento usa orden nativo. Worker con allowlist previa rechaza el child antes de escribir; es una fixture de compatibilidad de allowlist sobre el Worker real, no una ejecución completa del binario histórico. Producción aún no recibió0009 ni cambios S10.

## Decisiones y ámbitos diferidos

Se resolvieron estos desajustes del plan: encabezados para helpers (riesgo de brief incorrecto, se contrastó); Next16.4.1 publicado/lock en vez de downgrade histórico (riesgo de compatibilidad, gates reales); reloj tras policy (riesgo de caducidad, RED→GREEN); proof mínimo de tombstone, marker2 y borrado por lotes frente a tres huecos de diseño (riesgos de barrera/herencia/borrado, reproducciones y almacenamiento real). Task5 empezó mientras el gate independiente Task4 terminaba y se cerró después, sin declarar un gate omitido. QA usa fecha real25, no22histórica. Worktree/scratch se conservan por instrucción del titular.

El revisor dejó fuera ofertas/notificaciones/resolución vinculada (siguiente par), archivo histórico/personas (excluidos y cobertura explícita), capacidad productiva (muestras locales), publicación/migración S10 (etapa aún no realizada) y QA final en marcha (se cierra con recibos). Se mantienen esas decisiones: confundirlas con funciones terminadas sobrestimaría alcance o producción; no hay defectos de esos ámbitos declarados resueltos.

## Publicación S17 y siguiente etapa

S17 sí quedó integrado/pusheado y publicado por «ok sigamos»: main/origin/main39a53ed, [CI50/run40166667260](https://github.com/andresleosan/SarinBotSAAS/actions/runs/40166667260) cuatro SUCCESS,4267pruebas/37skip, Firestore35+journey1, Worker160/audit0 y builds. ReleaseVERIFIED2026-10-25T05:52:34.7846753Z: Worker `334bcd5e-ded0-4213-8a27-b059970f63a5`, Container40, Pages `58684fcf-7bc0-4d00-b988-651e47ff317f`, image sha256 `eb0baed334ce1a24a8a25976af6ef5a7744e42d5f8d991b7c885426cb11af51f`. Runtime source exacto y escritorS09 ausente/defaultfalse. Smoke anónimo reports200/sessiongate y summaryGET401/no-store, sin mutación productiva. `../work/s17-publish-20261025/` conserva integración, release, CI, runtime y smoke. No queda publicación S17 pendiente; S07/FAQ no se reabrieron.

S10 requiere su propia etapa de integración/publicación: respaldo privado y restore local verificados, inspección/aplicación compatible de0009 y Worker antes de app. No reaplicar a ciegas ante resultado incierto; inspeccionar estado real. Rollback conserva datos/marcas/tombstones/índices y enforcementS09, sin restaurar snapshots antiguos para revertir UI. Después de integrar este par, siguiente funcional: ofertas in-app S10, orden12 ya preparado. Task7S05 sigue después de S12.

Evidencias: `../work/s10-*-result.json`, `s10-first-*`, `s10-second-*`, `s10-serial-vitest.json`, `s10-final-quality-proof.json`, ledger/review/logs en `.superpowers/sdd/2026-10-22-owner-waitlist/` y copia externa `../work/s10-completed-20261025/`. Firestore final `../work/s10-qa-runs/2026-10-25T06-42-25-118Z-3a7c71/`; demo `../work/s10-qa-runs/2026-10-25T06-16-21-628Z-ad8803/`. [Protocolo](../../qa/tests/owner-waitlist.md).
