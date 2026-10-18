# Implementación de lista de espera

Spec: [Diseño autorizado](../specs/2026-10-17-in-app-waitlist-design.md).
Base `711dab5`, worktree existente `service-catalog`, rama `codex/in-app-waitlist-20261017`. Estado: implementación y validación local aprobadas; artefacto y publicación pendientes.

## Restricciones globales

Una solicitud activa por cuenta/negocio; una selección, un documento privado. Sin reserva automática, dato personal adicional, IA, envío externo, sondeo nuevo ni migración SQL prevista. No modificar Appointment/propuestas/confirmación. Mantener permisos y roles de salud/menores. Sin tocar el workspace original ni el paquete v19. Implementar, probar y publicar según autorización existente. Trabajos paralelos solo con propiedad de archivos separada y contrato acordado; root integra y realiza revisión final.

## Task 1 — Backend privado y contratos

Archivos: crear `src/types/waitlist.ts`, `src/lib/server/waitlist.ts`, rutas `src/app/api/businesses/[id]/waitlist/route.ts` y `cancel/route.ts`; extender `shared/data-protocol.ts`, admisión de booking y sus tests. Pruebas nuevas `tests/waitlist.test.ts`, `tests/waitlist-routes.test.ts`, `tests/waitlist-d1.test.ts`, ampliar reglas privadas.

Interfaces: DTO y las tres funciones/rutas definidos literalmente en el spec; schemas runtime compartidos o validador cliente estricto. Inyectar Database. Revisión monotónica/lastOperation, anclas verificadas, no GET writes. Cancel válido sin negocio. Estado suspendido no oculta corrupción.

- [x] Escribir y observar fallar pruebas del comportamiento nuevo.
- [x] Implementar contrato, privacidad, transacciones e idempotencia.
- [x] Cubrir fecha/filtros/consentimiento/casos/restricciones, errores y concurrencia real D1.
- [x] Ejecutar pruebas focales y revisión independiente; corregir admisión al reutilizar requestId con otra revisión.

Comando: `pnpm exec vitest run tests/waitlist*.test.ts`; Expected: PASS, incluyendo D1 real y fallos representativos. Reglas mediante runner del proyecto; Expected: acceso privado denegado y regresiones verdes.

## Task 2 — UI y continuación de reserva

Archivos: crear `src/hooks/use-waitlist.ts`, `src/components/client-waitlist.tsx`; modificar `structured-booking.tsx`, `client-appointments.tsx`, `booking-journey.tsx` si aplica, `src/app/b/[slug]/page.tsx`, `src/hooks/useStructuredBooking.ts`; pruebas nuevas waitlist UI/lifecycle y ampliar rebooking.

Consume WaitlistState y rutas de Task 1. Initial hint `{serviceId,dateKey,resourceId?,subjectKind,representativeRole?}` solo una vez, nuevo bookingRequestId, sin hora/PII/consentimientos anteriores. Añadir join solo después de éxito vacío de selección actual; respetar mutex central de workspace. Consulta/retirada disponibles sin permisos de reserva.

- [x] Observar pruebas fallar antes de implementación.
- [x] Crear hook con scope epochs, abort/late discard, latch y reconciliación GET de respuesta incierta.
- [x] Añadir panel/trigger, estados/copias del spec y resumen de selección.
- [x] Integrar continuidad y validar catálogo/día/recurso/caso actuales sin autoselección de hora.
- [x] Pruebas focales, revisión independiente y typecheck; revisión UI final 109/109. Corregir mensaje 5xx reconciliado, recurso activo en selección indiferente y fixture con timestamps coherentes (24/24).

Comando: `pnpm exec vitest run tests/waitlist-ui.test.tsx tests/waitlist-lifecycle.test.tsx tests/client-rebooking-entry.test.tsx`; adaptar nombres solo con registro. Expected: PASS con ámbitos A→B→A, permisos, error ≠ vacío, callbacks retenidos, locks, caso nuevo.

## Task 3 — Ciclo de datos y QA integrada

Archivos: crear helper privado de conservación waitlist siguiendo reminder-data-maintenance, documento `docs/waitlist-data-lifecycle.md`, tests reales; fixture/navegador y evidencia privada en `qa/reports/in-app-waitlist*` (ignorados), capturas sanitizadas en docs/qa.

- [x] Exportar/eliminar inventario exacto por cuenta/negocio, verificar ausencia y preservar vecinos; nunca filtrar por cita no vinculada. Validar también el propietario del documento canónico para evitar ausencia falsa; 11/11 finales.
- [x] Medir D1 con historial y carreras; 30 filas/0 escrituras/28 sentencias con y sin 1.001 citas históricas, usando índice existente y sin truncar.
- [x] Probar UI local 320/390/1280 con datos sintéticos, relectura, cancelación, disponibilidad tras liberar hueco y continuación explícita: 21 controles anteriores a las correcciones de revisión, conservados como tales.
- [x] Limpiar datos/procesos propios y registrar evidencia.
- [x] Ejecutar suite aplicación (1.575 aprobadas/28 omitidas), typecheck, Cloudflare (76 aprobadas) y revisión integral PASS de 25 archivos.

Expected: todo comportamiento nuevo probado; sin cambios de datos reales en QA; conteos/salidas se registran cuando existan, nunca anticipados.

Evidencia consolidada: [aceptación local y límites](../../qa/2026-10-17-in-app-waitlist.md). Las correcciones posteriores al recorrido visual se comprobaron con regresiones automatizadas; no se atribuyen a una nueva corrida de navegador.

## Task 4 — Artefacto y publicación autorizada

Archivos: helpers privados nuevos, paquete `in-app-waitlist-release-20261017`, `docs/qa/2026-10-17-in-app-waitlist.md`, tasks/STACK/spec/plan finales. No modificar paquete reminders.

- [ ] Huella inicial/final inmutable de v19, fuente limpia y publicada, imagen exacta, smoke aislado, auditoría independiente.
- [ ] Conservar configuración/bindings/secretos/Pages/instancia única y reversión a v19; mantener excepción exacta GET /api/session durante mantenimiento.
- [ ] Auditar estado real, drenar cola, publicar imagen, esperar asignación efectiva sin instancia anterior, comprobar salud/cola y reabrir.
- [ ] Verificar HTTP y navegador productivo, restaurar viewport/interceptación y acceso admin.
- [ ] Documentar IDs/hash/alcance/límites, cerrar paquete y sincronizar commit documental.

## Review Focus

No dar por seguro que un case antiguo se puede autorizar con un consentimiento nuevo. Verificar todas las anclas, clasificación y rol. No convertir corrupción/503 en suspensión ni ausencia. Comprobar carreras de disponibilidad/admisión/revisión, reintentos antiguos después de cancelar y reemplazar, y cancelación con negocio eliminado. Contrastar queries D1 reales con historial y aislamiento de exportación/eliminación. En UI, revisar handlers de render viejo, A→B→A y cambios de catálogo mientras hay una operación; el calendario reanudado no copia datos sensibles ni concede permisos. Revisar artefacto por bytes y no solo commit/etiqueta, asignación real y sesión en mantenimiento, paquete v19 intacto.
