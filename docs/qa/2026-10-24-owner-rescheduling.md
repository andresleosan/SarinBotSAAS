# S07: reprogramación del dueño y recuperación

Verificación del 24 de octubre de 2026, hora de Colombia. Implementación revisable en `codex/owner-rescheduling-20261024`, base publicada `cbca4b580549231f9293978ad65602844eaca5e7`; código comprobado `5d82dea0895047afad1ef362dd8ef816b783aff7`. Este reporte y sus imágenes se añaden después de ese pin. No acredita publicación de S07.

Fuente: worktree reconciliado `C:/Users/Drean Skate/AppData/Local/SarinBot/fresha-p2-20261023/source`. El checkout mixto E: se conserva. [Diseño](../superpowers/specs/2026-10-22-owner-rescheduling-design.md), [plan](../superpowers/plans/2026-10-22-owner-rescheduling.md), [composición](../product/sarin-admin-extension-composition.md) y [protocolo reproducible](../../qa/tests/owner-rescheduling.md).

## Comprobaciones ejecutadas

Node 24.22.0, pnpm 11.23.0; herramientas instaladas según lock: Next 16.4.1, TypeScript 5.9.3 y Vitest 5.0.4. Java oficial 21.0.12.1 para emuladores. Sin instalar dependencias. SHA256 de `pnpm-lock.yaml`: `f035b6bd0ddb862b899be3e15ec8115cf0a47ac508f8d1e644899aa902e12358`, sin cambios.

| Gate | Resultado observado |
| --- | --- |
| Suite completa de aplicación, equivalente a `pnpm test` | **4.120 pasan, 0 fallan, 34 omitidas**, 4.154 casos en 263 archivos; exit 0, 347.449 ms |
| `pnpm run typecheck` | `tsc --noEmit`, exit 0 |
| `pnpm run build` | Build de producción, exit 0; compilación, TypeScript y generación de páginas completas; dashboard bajo Suspense |
| `pnpm run test:rules` | **32/32**, exit 0, Firestore oficial y Admin SDK con proyecto `demo-sarin-bot` |
| Check de `sarin-cloudflare-host` | **159/159**, sin omitidas; TypeScript y Wrangler dry-run con `--containers-rollout=none`, todos exit 0 |
| Almacenamiento S07, cliente y migración | 90/90 en la ejecución de Task4; incluye 14 casos D1 reales; incluidos también en la suite completa |
| UI S07 y regresiones afectadas | 332/332 en 17 archivos de Task5; incluidos en la suite completa, no se suman otra vez |

Se invocaron los entrypoints ya instalados con un runner externo de entorno estéril, sin credenciales de proveedor, para evitar que la política automática de pnpm alterase la instalación compartida. Los comandos exactos, versiones, duración y hash del lock están en recibos externos `work/s07-*-result.json`; logs `work/s07-*-final.log`. Reglas: `work/s07-rules-complete.log` y recibo de `s07-qa-runs/2026-10-25T01-25-13-316Z-a18233`.

La primera suite completa encontró tres mocks antiguos del dashboard en `chat-surfaces`: 4.117 pasan, 3 fallan, 34 omitidas. Se actualizaron únicamente sus dobles al contrato vigente de sesión/Next y callback de estado; el archivo pasó 27/27 y después se repitió la suite completa con el resultado verde de la tabla. Se conserva el primer resultado externo. La prueba Admin SDK inicial mezclaba un `Date.now` ficticio de 2030 con el reloj real de gRPC y agotaba su deadline; se ajustaron únicamente las fechas sintéticas, luego pasaron las 32 reglas. No se atribuyen esos fallos al producto ni se ocultan.

## QA de navegador observada

Chrome, Next local en `127.0.0.1:3047`, Auth/Firestore emulados, proyecto `demo-sarin-bot`. Run propio `2026-10-25T02-35-47-125Z-6f3ba5`. Guardas de red restringidas a loopback, puerto de inferencia bloqueado, proveedores y envíos deshabilitados. El escritor S09 estuvo en **false**. Dieciocho registros sintéticos iniciales, cinco citas, dos recursos activos y uno retirado; ninguna cuenta o contacto real.

| Caso | Observación |
| --- | --- |
| Origen fresco y selección | Fecha original 25/10, recurso original A, hora vacía. Consultar no prepara ni mueve. El origen retirado deja el recurso destino vacío y exige selección explícita activa. |
| Ocupación y S09 | A las 12:00 no se ofrece el destino ocupado; tampoco 14:00 durante el cierre A de 14–15, ni intervalos cuyo margen lo atraviesa. Escritor apagado mantiene enforcement. |
| Revisión | Antes 09:00–09:30/A/20.000 COP; propuesto 10:00–10:30/A/25.000 COP, preparación 15 min y duración 30 min. Sin pedir contacto ni respuestas históricas. |
| Independencia de la tarjeta | Cerrar sus detalles nativos, cambiar el día y filtrar por B conserva la propuesta, URL y revisión A/10:00. Cancelación y segunda entrada quedan deshabilitadas. |
| Respuesta perdida después del commit | Se pausó la respuesta HTTP 200 de confirmación mediante CDP Fetch y se entregó `{}`. Aparece «Resultado por comprobar», mismo ID opaco; cerrar queda deshabilitado. Se retiró la interceptación antes de recargar. |
| Recarga y recuperación | La URL recupera «Cambio comprobado», prueba de 10:00 y cita actual, sin reenviar confirmación. Inspección de almacenamiento: una aplicación, cinco citas. |
| Movimiento posterior | La misma cita se mueve explícitamente A/10:00 → B/13:00. Abrir el primer recibo sigue mostrando su prueba A/10:00 y, separadamente, **Estado actual** B/13:00. |
| Recurso retirado | Cita de 10:00 en recurso retirado se mueve a B/15:00 con revisión explícita de precio; el origen se presenta como recurso anterior no disponible. |
| Expiración | GET del fixture vencido sigue preparado e incierto. Confirmación explícita devuelve cierre; consultar resultado muestra «Propuesta cerrada», sin aplicar el destino de ese recibo. |
| Menores, pasado y salud | Menor y cita pasada muestran explicación sin botón operativo. Al cambiar la política sintética a salud, un origen fresco muestra restricción y ningún control de confirmación. Se restauró política general mediante CAS. |
| Denegación provisional | Se sustituyó una respuesta GET del origen por un 403 sintético. Se oculta el árbol privado y aparece «Comprobar acceso». La comprobación explícita del mismo dueño restaura lecturas y conserva el flujo; no reenvía mutaciones. Interceptación retirada. |
| Sin plan y consentimiento | Se suspendió el plan y se escribió revocación sintética con revisión/recibo coherentes. Abrir el primer recibo conserva la lectura del histórico y la cita actual. Una entrada nueva muestra que la suscripción no permite el cambio. No se aceptó ningún acuerdo legal en la UI. |
| Cliente | Inicio con Cliente local y lectura de Mis citas: conserva las cuatro próximas, posiciones actualizadas B/13 y B/15, cancelar y exportar. Con negocio pausado, nuevas reservas y cambio propio están deshabilitados; el recorrido de confirmación del cliente activo se acredita por las suites, no por este recorrido manual. |

Inspección final de solo lectura: **cinco citas; tres propuestas aplicadas, una cerrada y cero preparadas**. Conservados ID, cliente, creador, estado, beneficiario y metadatos históricos; negocio/catálogo sin writes provenientes de movimientos. La única modificación intencional adicional del negocio fue el escenario de suscripción. Propuestas privadas sin copias de contactos ni respuestas. La cuota no se sembró como contador en el navegador: su invariancia se acredita en dominio/D1, sin atribuir una medición manual inexistente.

El recibo vencido se sembró para ejercitar únicamente recuperación/cierre; su huella de calendario es deliberadamente sintética y nunca se aplica. No acredita validación de disponibilidad. Las otras tres propuestas se prepararon y confirmaron mediante las rutas reales de la aplicación.

## Accesibilidad y capturas

Observados 320, 390 y 1280 px, sin desbordamiento horizontal del documento o del workspace. A 320/390 las columnas se apilan; a 1280 se comparan juntas. Revisar mediante Enter, tabulación desde el encabezado enfocado al botón de salida y foco visible observados. El cambio de paso enfoca su título. Se inspeccionaron capturas reales.

- [Revisión 320 px](2026-10-24-owner-rescheduling/review-320.png)
- [Revisión 390 px](2026-10-24-owner-rescheduling/review-390.png)
- [Revisión 1280 px](2026-10-24-owner-rescheduling/review-1280.png)
- [Recuperación aplicada](2026-10-24-owner-rescheduling/recovered-applied.png)
- [Prueba original y cita actual](2026-10-24-owner-rescheduling/original-proof-current-appointment.png)

El atajo de zoom enviado por la superficie DOM no cambió el viewport ni devicePixelRatio. **Zoom nativo al 200% no observado**; no se presenta la emulación de ancho como sustituto. Tampoco se observó lector de pantalla audible. Las capturas móviles muestran la parte superior y requieren desplazamiento vertical normal para llegar al destino y confirmar. El viewport temporal se restableció y la pestaña de QA se cerró.

## Review Focus, respaldo y reversión

Las cinco áreas del plan tienen evidencia: (1) expectativa/fingerprint obsoletos y decisiones concurrentes de cancelación/atención/representación en dominio/D1; (2) cambios de catálogo y política S09 en transacciones reales con dos handles; (3) commit ambiguo, replay, expiración y prueba frente a cita actual en D1 y navegador; (4) actor/tenant, traslado de dueño, UID/época y URL malformada en rutas/modelo/hooks, más 403/probe en navegador; (5) polling, cambio de día y callbacks antiguos en pruebas UI, más cierre de tarjeta/día/filtro en navegador. Los casos de traslado real de dueño, JSON manipulado, timeout prolongado y carreras simultáneas se acreditan por pruebas automatizadas; no se simulan como observaciones humanas.

El respaldo/reconciliación SQL/R2 sintético incluye recibos preparados/cerrados/aplicados y revisiones de citas. Un Worker anterior sin la nueva colección falla cerrado, sin escritura parcial ni fallback. No cambia SQL, índices, rutas cliente ni reglas para exponer recibos.

Orden de una futura entrega: **Worker compatible primero, aplicación después**; mantener una réplica y los recibos privados. Reversión de app conserva lector y enforcement S09, revisiones y comprobación de resultados; no volver al lector histórico que ignora políticas ni restaurar un respaldo sobre writes nuevos. Apagar el escritor S09 no apaga enforcement. Esta tarea no ejecuta despliegue, migración remota ni restauración de producción. Los procesos locales propios se detuvieron mediante su launcher; evidencia externa preservada.

La revisión independiente del diff completo se registra en el ledger de ejecución y se incorporará antes de integrar. Los límites futuros siguen vigentes: salud/menores, clear-outcome de S05 tras S12, series, plazos configurables y mensajes externos no se habilitan aquí.
