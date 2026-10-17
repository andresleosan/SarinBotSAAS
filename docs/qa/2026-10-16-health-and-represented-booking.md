# Salud y reservas para menores: aceptación local

**Aceptación técnica local completada. Sin publicación en producción ni uso de datos reales.** Runtime `6315379b8c0482af57fea20abd8e2e1af0c00ff1`; rama `codex/commercial-pilot-20261016`, worktree `commercial-pilot`. Diseño, plan y ejecución directa aprobados por el propietario. Los commits documentales posteriores no cambian el runtime de la imagen.

[Plan aprobado](../superpowers/plans/2026-10-16-health-and-represented-booking.md), [diseño](../superpowers/specs/2026-10-16-health-and-represented-booking-design.md), [manifiesto exacto](2026-10-16-health-and-represented-booking-release.json), [operación pendiente](../product/2026-10-16-pilot-operation.md) y [revisión de datos](../product/2026-10-16-legal-consent-review.md).

## Comportamiento entregado

El adulto autenticado sigue siendo quien gestiona la cita (`client.uid`). El beneficiario privado es independiente: para sí o nombre breve del menor y calidad declarada del representante. Salud y representación usan formulario sin IA, con decisiones específicas desmarcadas, recibos privados versionados y retirada. No se crea una cuenta infantil ni historia clínica; no se solicitan síntomas, diagnósticos, documentos o fecha de nacimiento.

| Caso | Recorrido |
| --- | --- |
| Adulto, servicio general para sí | Chat general conservado; sin constancia ficticia adicional. |
| Adulto representante, corte para menor | Formulario; autorización de datos y declaración de representación. |
| Pediatría reservada por representante | Formulario; añade autorización expresa sobre datos sensibles. |
| Salud para adulto propio | Formulario; datos y decisión expresa sobre salud, cubierto además por el contrato compartido. |

La política privada por negocio es editable solo por superadministración con revisión/CAS. Activar salud o menores exige eliminar campos libres de reserva y el servidor impide reintroducirlos. Una política ausente conserva el recorrido general legado: la incorporación debe clasificar los negocios sanitarios antes de usarlos. Google acredita la cuenta; no acredita parentesco, edad o tutela.

Propuestas v2 ligan caso, hash de beneficiario, revisión de política y constancia. El nombre se guarda al confirmar en la cita privada. Autorización, catálogo, locks y cupo se comprueban en la misma transacción. Una propuesta v2 vencida se cierra mediante `closedAt`; confirmación y cierre compiten sobre el mismo documento y el código terminal se devuelve después del commit. Una cita ya guardada tiene prioridad de recuperación. Cancelar no devuelve cupo de la prueba.

El negocio puede registrar revisión o necesidad de contacto sin modificar estado/cupo de la cita. La exportación de imagen conserva su lista explícita de campos y excluye beneficiario, representación y constancias. Los documentos generales avanzaron a `2026-10-16.2`; el ámbito independiente `booking_subject` comienza en `2026-10-16.subject.1`. Los hashes históricos se conservan.

## Verificación final

| Comprobación | Resultado observado |
| --- | --- |
| `pnpm.cmd test` | **887 aprobadas, 26 omitidas**; 112 archivos aprobados y 4 omitidos; 24,34 s. Las 24 de Firestore/reglas se ejecutaron por separado; las otras dos son opt-in DeepSeek en vivo y recorrido local automatizado, no ejecutadas en esta suite. Los casos visuales locales se verificaron aparte. |
| Firestore oficial y reglas | **24/24**, 117,94 s. Mismos contratos y adaptador real; sin relajar aserciones o timeouts. |
| D1 real | Incluido en la suite completa; dos handles independientes y cierre v2 persistente. |
| `pnpm.cmd run typecheck` | Salida 0. |
| `pnpm.cmd run build` | Salida 0; también build Linux de la imagen exacta. |
| Worker: pruebas, tipos y dry-run | **74/74**, salida 0; `--containers-rollout=none`, sin rollout. |
| Gateway Pages | **25/25**, salida 0. |
| `pnpm audit --audit-level=high` | Sin vulnerabilidades conocidas del lockfile comprobado. |
| Diff final | `git diff --check`, salida 0 al cerrar la tarea. |

Los resultados focalizados se superponen; no se suman como pruebas distintas. No se reconstruyó la landing porque no cambió su fuente ni contrato. Node 24, pnpm 11.23.0 y lockfile conservados; sin dependencias nuevas.

## Revisión y errores corregidos

Revisión independiente del rango `205a771..879d9a9`: ningún crítico, tres importantes y dos menores. Los tres importantes se corrigieron en una pasada, con regresiones observadas RED→GREEN y suite completa; no hubo segunda revisión del mismo diff. Corrección de runtime `0e5af83` y corrección visual posterior `6315379`:

1. **Cambio de política durante presupuesto:** el motor vuelve a comprobar inmediatamente antes de `fetch`, después de toda espera de reserva. Si no se despachó, libera transaccionalmente la reserva y no registra una llamada al proveedor. Si falla la liberación, conserva el máximo. La regresión usa motor y dominio reales, transporte espía y reclasificación a salud durante la transacción: cero envíos. Un aborto ya presente tampoco inicia un fetch; un aborto en curso conserva el manejo anterior.
2. **Pérdida del intento original:** el controlador estructurado permanece montado con identidad UID/negocio/caso ante retirada exterior, error temporal de política o deshabilitación de menores. Se bloquean operaciones nuevas, conservando recuperación y retirada. La prueba del árbol real de la página falló antes y pasó después; la prueba del componente conserva exactamente propuesta y cuerpo originales al cambiar capacidades.
3. **409 ambiguo y confirmación lenta:** un rechazo genérico no descarta una confirmación previamente incierta. Solo el cierre durable v2 permite salir como operación terminal; su escritura compite con la confirmación anterior. La prueba detiene una transacción anterior al commit, cierra desde otra y comprueba cero citas/cupo, además del contrato persistente D1/Firestore.
4. **Hallazgo visual adicional:** `scrollIntoView` devolvía una promesa usada accidentalmente como cleanup de React, rompiendo el chat general al navegar. Se descartó explícitamente su retorno. Regresión con nodo DOM que devuelve Promise, RED→GREEN, 11/11; navegación general comprobada de nuevo sin ese error.

El primer ensayo de la nueva regresión del motor tenía una suscripción sintética inactiva; se corrigió el fixture y se observó el RED real con un envío al espía. El primer mock del scroll era demasiado amplio para imágenes Next; se limitó al div y se observó el error de cleanup real. Avanzar `Date.now` globalmente en la prueba compartida interfería con los deadlines del SDK Firestore; se detuvo ese proceso local verificado y se sustituyó por una propuesta sintética almacenada como vencida. El ensayo en memoria conserva el reloj aislado. No se alteraron timeouts para lograr el resultado.

## Navegador y lectura independiente

Chrome contra Next local y emuladores oficiales `demo-sarin-bot`, proveedor desconfigurado. Solo cuentas y datos sintéticos:

- **Adulto propio:** la cita se creó antes mediante la API estructurada real; el navegador comprobó historial y cancelación. El chat general cargó con el proveedor offline. No se atribuye a esta prueba una nueva reserva conversacional con IA.
- **Corte infantil:** dos decisiones inicialmente desmarcadas, nombre visible después de autorizar, servicio/fecha/hora, propuesta y confirmación íntegramente desde la UI.
- **Pediatría:** tres decisiones inicialmente desmarcadas, reserva completa sin IA, retirada que conservó la cita y cancelación posterior desde historial.
- **Dueño:** se preparó un caso adicional por API real en el negocio del dueño local, conservando la cita adulta cancelada y su cupo. La UI marcó necesidad de contacto y después revisión realizada; guardó categoría manualmente con cero campos de chat. Se utilizó el acceso local integrado al fallar el click automatizado del selector de cuentas adicionales del emulador; no se añadió un bypass al producto.
- **Móvil:** 390×844, `innerWidth=390`, ancho documento/cuerpo 375; a 320 px, documento/cuerpo 305. Sin desbordamiento horizontal. Viewport restablecido.

La [lectura independiente del emulador](assets/health-20261016/browser-readback.json) comprobó 2/1/1 citas y cupos usados en los tres negocios, UID adulto conservado, ninguna referencia de caso duplicada, retirada pediátrica revisión 2, revisión del dueño revisión 2 y configuración manual guardada. La cita adulta y la pediátrica quedaron canceladas; las cancelaciones no devolvieron cupo. **Cero `aiBudgetCalls` y cero `responseQuotaTurns`.** Proyecciones públicas sin beneficiario.

Capturas reales JPEG: [pediatría 390](assets/health-20261016/pediatria-390.jpg), [pediatría 320](assets/health-20261016/pediatria-320.jpg), [cancelación](assets/health-20261016/pediatria-cancelada.jpg), [revisión del dueño](assets/health-20261016/owner-review.jpg) y [configuración manual](assets/health-20261016/owner-manual.jpg). La captura confirmada documenta el estado anterior a cancelar.

## Imagen exacta y cierre local

- Etiqueta: `sarin-bot:health-6315379`, Linux/amd64, 79,947,538 bytes.
- ID: `sha256:d890c075238e3c5e0d8cdc10a6037625dba2b243a61143b583f54e40d62f8d25`.
- Revisión OCI: `6315379b8c0482af57fea20abd8e2e1af0c00ff1`.
- SHA-256 del archivo Git: `d3aeb8ed66e124a07fd5633c5d1a216e7521a0114eefbf7c47e41d2b48bb6a3b`.

Contexto obtenido con `git archive` del commit exacto, solo cuatro argumentos públicos Firebase. Sin archivos de entorno, scratch, llaves Admin ni secretos en la imagen. Smoke con usuario `node`, red `none`, raíz de solo lectura, todas las capabilities retiradas y `no-new-privileges`. Sharp nativo generó WebP de 512×512; términos/privacidad/ayuda y documentos públicos 200; sesión/permisos/política/disponibilidad/propuestas anónimos 401; preautorización canónica 200, origen ajeno 403 y decisión sin marcar 400. No equivale a integración remota.

Los procesos locales de esta sesión se detuvieron y los puertos 3042/8080/9099/8188/4400/4500 quedaron sin listener. Contenedor de smoke detenido. Logs, ledger y scripts se archivan privadamente en `%LOCALAPPDATA%/SarinBot/health-qa-20261016/evidence` antes de limpiar exclusivamente el scratch de este plan. Rama y worktree se conservan; no merge, push ni publicación.

## Menores diferidos

- Elegir una hora limpia la lista visible; la selección aparece al revisar propuesta. Para cambiarla hay que consultar horarios otra vez.
- Un día cerrado que devuelve `[]` no muestra mensaje de resultado vacío.

## Decisiones registradas durante la implementación


| Decisión | Razón | Coste o límite |
| --- | --- | --- |
| Añadir a `interpretChat` una comprobación antes de inferir, suministrada por su único llamador de runtime, `runSarinChat`. | La selección asíncrona del proveedor abría una ventana después de la comprobación previa. | Un futuro llamador debe conservar la compuerta. La comprobación final ahora llega hasta el envío del motor, después de reservar presupuesto. |
| Limitar transaccionalmente la creación de autorizaciones/propuestas nuevas: UID 20/minuto, 120/hora, 300/día; negocio 100/minuto, 500/hora, 1.000/día. | Evitar creación ilimitada de documentos privados inmutables; solo se guardan hashes y fechas. Recuperación y retirada efectiva quedan exentas; repetir retirada ya inactiva devuelve la evidencia existente. | Un uso legítimo de gran volumen puede recibir 429 y esperar. El tráfico de lectura necesita además protección de infraestructura. |

Las resoluciones finales figuran a continuación. No sustituye las excepciones individuales de presupuesto ni modifica los precios comerciales.

La revisión dejó seis asuntos sin juzgar. Se registran estas resoluciones, sin presentarlas como validación del revisor:

| Asunto dejado sin juzgar | Resolución | Coste si la decisión es insuficiente |
| --- | --- | --- |
| Suficiencia jurídica de autorizaciones, representación, conservación y condiciones de proveedores | Mantenerlos como decisiones jurídicas/operativas pendientes. Los casos y controles técnicos aprobados no acreditan cumplimiento ni autorizan datos reales por sí solos. | Una incorporación que ignore esos pendientes puede tratar datos sin condiciones suficientes o impedir responder derechos adecuadamente. |
| Activación de flags, despliegue y reversión reales | Permanecen fuera de la autorización local. La preparación debe dejar artefacto y procedimiento revisables; no afirmar un rollout o una restauración remota ejecutados. | El comportamiento de configuración y recuperación en producción no queda acreditado por el ensayo local y debe verificarse en el corte autorizado. |
| Detección universal de datos sensibles en el chat general | No añadir un clasificador universal en esta entrega. La barrera depende de clasificar correctamente negocios de salud y de usar el formulario para los casos representados. | Un usuario todavía puede escribir datos sensibles en el chat general; avisos y restricciones temáticas no garantizan detectarlos. |
| Centro histórico de autorizaciones específicas después de abandonar el caso | No añadir otro módulo de historial. Se conservan recibos privados y el canal de derechos para obtener la evidencia; la UI del caso no se presenta como archivo histórico completo. | Recuperar una constancia antigua puede requerir atención manual y un procedimiento operativo capaz de localizarla y entregarla. |
| Documentos, capturas y manifiesto todavía en preparación | No calificarlos como defecto de runtime ni declarar terminada la aceptación. Completar evidencia y un manifiesto propio antes de identificar la candidata final. | Cerrar antes dejaría resultados incompletos o podría atribuir funciones de salud a una imagen que no las contiene. |
| Configuración manual de un negocio de salud por su dueño | No modificar el contrato por esta observación: la revisión no encontró un defecto y hay pruebas focalizadas; se verificó también el guardado manual en el navegador. | Un problema de interacción no detectado por las pruebas aisladas podría requerir corrección en otros recorridos no cubiertos por esta aceptación. |

Las dos observaciones menores se difieren como tales; no se convierten en decisiones de alcance ni se incluyen en la pasada de corrección de los hallazgos importantes.


## Límites operativos y reversión

La aceptación técnica no acredita suficiencia jurídica, habilitación sanitaria ni consentimiento médico. Antes de usar datos reales deben cerrarse el procedimiento proporcionado de representación/participación, instrucciones y contacto de cada negocio, conservación y condiciones efectivas de proveedores. No existe todavía un centro histórico web de constancias por caso; se preservan los recibos y el canal de derechos.

Se mantienen los límites aceptados: USD 0,50/día y USD 8/mes globales; USD 0,10/día y USD 2/mes por negocio, con consulta y ajuste individual. Son límites simultáneos de IA, separados del alojamiento. La compuerta monetaria no se activó en producción. WhatsApp y marketplace permanecen deshabilitados; una réplica. Sin llamadas pagadas ni correos.

No hay autorización de publicación. Cualquier corte posterior requiere mantenimiento, drenaje y respaldo recuperable del [runbook](../cloudflare-no-vps-runbook.md#activación-y-reversión). Conservar políticas/revisiones, constancias y retiradas, bindings, propuestas v1/v2 y `closedAt`, citas/revisión, admisión, cupos y presupuestos. No restaurar un estado que reabra una retirada o permita repetir una confirmación. Una imagen anterior incompatible permanece bajo mantenimiento; no eliminar evidencia para encajar la versión ni cambiar de D1 a Firestore sin reconciliar escrituras. La imagen histórica `pilot-205a771` no contiene salud/representación.
