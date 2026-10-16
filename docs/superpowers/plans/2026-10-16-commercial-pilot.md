# Commercial pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preparar el piloto con invitaciones gratuitas, tarifas sincronizadas, logo y tarjetas autogestionados y protección de chat/reservas, manteniendo el marketplace aplazado.

**Architecture:** Cuatro incrementos sobre la aplicación Next actual y su almacenamiento D1/R2, con Auth Google. Cada incremento conserva el contrato de los existentes y se prueba de forma independiente; la aceptación comercial conjunta determina la versión candidata antes de cualquier publicación. No introduce marketplace, nuevo proveedor de IA ni servicios separados.

**Tech Stack:** Node 24, pnpm 11.23.0, Next.js/React/TypeScript existentes, Firebase Auth, Database D1/Firestore, Cloudflare R2, Vitest y tests Node del Worker/gateway.

**Spec:** [Diseño aprobado del piloto](../../product/BRIEF.md). Respuesta del propietario «1 y 2»: piloto acompañado y logo/tarjeta autogestionados dentro de la app antes de abrirlo. Las elecciones técnicas y valores operativos de los planes siguientes se someten ahora a revisión; no se presentan como implementación publicada.

## Global Constraints

- Conservar la oferta de prueba de 5.000 COP, diez citas y 700 respuestas totales sin caducidad por días; el código regala esa capacidad.
- Conservar citas, comprobantes, consumo, suscripciones pagadas y datos de navegador históricos.
- Marketplace fuera de producción hasta revisión posterior al alcanzar al menos diez negocios registrados reales.
- Mantener la aplicación única con su cola local y el proveedor actual; no reactivar VPS ni cambiar el backend a Firestore.
- No usar otro dominio de motor que `alsdevstudio.com`; no mezclar la URL del motor con las reservas públicas.
- No mostrar cuerpos del chat, secretos, códigos completos de invitación, cookies o exportaciones privadas en logs/Git.
- Node 24, pnpm 11.23.0 y lockfile compartido; dependencias nuevas solo las justificadas para normalización de imágenes y exportación PDF.
- Las tarjetas del 16 de octubre son muestras; la app genera el QR del negocio real con URL canónica, nunca copia el QR demo de los PDF.
- La revisión de planes no activa automáticamente un despliegue, una nueva tarifa ni invitaciones reales.

## Review Focus

- Prueba pagada histórica y nueva cortesía coexistiendo: conservar cuotas y dejar que un plan pagado posterior prevalezca; tests en plan de invitaciones, tareas de derecho de prueba/canje.
- Varias pestañas cambian o reenvían la misma acción: idempotencia y ausencia de descuento doble; tests de invitaciones/cotización/confirmación de reserva.
- Usuario cambia de cuenta durante carga/exportación: descartar resultados anteriores sin exponer imágenes o datos de otro tenant; tests de branding y estado del chat.
- Falta de imagen, precio corrupto o error del proveedor: mostrar error recuperable sin usar datos obsoletos ni escribir una reserva/pago aparente; tests de precios, branding y protección.
- Datos anteriores que superan un límite nuevo: conservarlos y restringir solo acciones nuevas; tests de límites de reservas/cortesías.

---

## Orden de implementación

| Orden | Plan independiente | Resultado comprobable |
| --- | --- | --- |
| 1 | [Tarifas públicas y cotización](2026-10-16-pilot-pricing.md) | Cambio administrativo reflejado en runtime; recibos conservan importes y se revisan cotizaciones antiguas. |
| 2 | [Invitaciones gratuitas](2026-10-16-pilot-invitations.md) | Emisión/canje/seguimiento/suspensión sin pagos ficticios ni repetición de cupos. |
| 3 | [Identidad y tarjetas](2026-10-16-pilot-business-branding.md) | Logo y datos comerciales propios, vista previa y exportación desde el panel del negocio. |
| 4 | [Protección de chat y reservas](2026-10-16-pilot-abuse-controls.md) | Reglas de servidor, confirmación vinculada a propuesta, límites y consumo controlado. |

Los cuatro forman parte del alcance previo a la apertura. Se pueden revisar por separado. La lectura de precios no depende de invitaciones; branding y protección deben integrar los cambios de `Business`, esquemas, cuotas y proyecciones que deje el plan de invitaciones. No ejecutar cambios paralelos sobre `schemas.ts`, `billing.ts`, `types/firestore.ts`, el protocolo de datos o los mismos fixtures sin coordinar su integración.

No se incluye en este incremento el registro completo de Fresha, un editor gráfico libre, el perfil visible antes de Google ni verificación SMS. Turnstile/IP y deduplicación de personas entre cuentas se escalonan según las reglas del plan de protección; la invitación individual y revisión del administrador son el control inicial de admisión. No prometer que un nombre parecido o la misma IP identifican fraude.

## Task 1: Preparar una base reproducible y ejecutar los incrementos

**Files:** los paths explícitos de cada subplan; no tocar archivos ajenos al alcance.

**Interfaces:** consume el checkout local que contiene las fuentes publicadas y los cuatro planes; produce una versión integrada verificable y commits enfocados de los incrementos.

- [ ] **Step 1:** Después de la revisión del usuario y elección de ejecución, leer el workflow de aislamiento correspondiente. Inventariar cambios previos y preparar snapshot privado con manifiesto de las fuentes pertinentes, excluyendo secretos/exportaciones. No partir de un worktree basado solo en HEAD: todavía faltan allí muchas fuentes actualmente publicadas. No hacer `git reset`, limpieza ni commit masivo del checkout compartido.
- [ ] **Step 2:** Comprobar Node/pnpm requeridos y ejecutar `pnpm run typecheck`, `pnpm test`, `node --test pages-gateway/tests/*.test.mjs` y `pnpm --filter sarin-cloudflare-host run check` sobre la base elegida. Registrar resultados como baseline, sin llamar PASS a integraciones omitidas. Si falla, diagnosticar y separar el fallo previo del incremento.
- [ ] **Step 3:** Ejecutar el plan 1 con sus ciclos RED/GREEN y revisión de diff; solo tras resolver sus hallazgos pasar al plan 2.
- [ ] **Step 4:** Ejecutar el plan 2 con sus ciclos RED/GREEN y revisar la compatibilidad de prueba pagada/cortesía; solo tras resolver hallazgos pasar al plan 3.
- [ ] **Step 5:** Ejecutar el plan 3 y revisar permisos de imágenes, exportación y QR; solo tras resolver hallazgos pasar al plan 4.
- [ ] **Step 6:** Ejecutar el plan 4 y verificar que contempla las estructuras finales de prueba y branding, sin aceptar datos del navegador como autoridad de tenant, cuota o confirmación.
- [ ] **Step 7:** Revisar commits y manifiesto de la versión integrada. Nunca incluir cambios anteriores ajenos por haber añadido un archivo completo al staging: usar la base aislada acordada y paths/hunks revisados.

## Task 2: Aceptación comercial conjunta y preparación de release

**Files:** crear `docs/qa/2026-10-16-commercial-pilot-acceptance.md` si se ejecuta en esta fecha; si se ejecuta otro día, usar la fecha real. Actualizar `tasks.md`, `docs/product/BRIEF.md` y documentos operativos solo con evidencia nueva.

**Interfaces:** consume los cuatro incrementos; produce evidencia de la versión candidata, riesgos operativos y paquete de reversión. No genera ingresos, invitaciones reales ni cambios de producción durante QA local.

- [ ] **Step 1:** Ejecutar secuencialmente el recorrido local sintético: emitir invitación vinculada al correo de dueño demo → canjear → configurar → cargar logo/contactos → exportar cada estilo → abrir la URL QR → consultar como cliente distinto → revisar propuesta → confirmar una reserva → consultar historial/cancelar. Comprobar contadores y que la siguiente reserva sí puede seguir después de cancelar aunque el cupo de prueba no se devuelve. No ejecutar `smoke` y `journey` simultáneamente sobre el mismo perfil sembrado.
- [ ] **Step 2:** Cambiar una tarifa solo en el entorno sintético y verificar landing abierta a menos de un minuto y envío con cotización antigua; comprobar recuperación sin duplicados. Suspender la cortesía y comprobar que no borra citas; aprobar un plan sintético y comprobar precedencia pagada. Desafíos de permisos se prueban con otra cuenta real de emulador, sin impersonar usuarios de producción.
- [ ] **Step 3:** Ejecutar `pnpm run typecheck`, `pnpm test`, `pnpm run test:rules`, `pnpm run test:local` y `pnpm run test:journey` según sus runners/puertos aislados; después `pnpm run build`, `pnpm run build:landing`, `pnpm run check:landing`, `pnpm run build:pages`, `node --test pages-gateway/tests/*.test.mjs` y `pnpm --filter sarin-cloudflare-host run check`. Revisar `.github/workflows/verify.yml` para paridad con CI. Todos los checks requeridos deben pasar; no es prueba de capacidad masiva.
- [ ] **Step 4:** Aplicar self-critique-loop, revisión de seguridad y una revisión independiente de la versión integrada. Corregir bloqueantes; repetir solo las pruebas afectadas y los checks requeridos por las correcciones. Revisar móvil/escritorio, errores y accesibilidad de las acciones nuevas.
- [ ] **Step 5:** Si hace falta probar el comportamiento del modelo, usar DeepSeek con un conjunto pequeño de datos sintéticos: consulta normal, tema fuera de alcance, inyección, intento de reserva sin confirmar y confirmación legítima. Registrar latencia/coste agregado y resultados de reglas, sin cuerpos ni datos de clientes en logs. Pasar tests deterministas no acredita por sí solo ese comportamiento del proveedor real.
- [ ] **Step 6:** Preparar release mediante deploy-checklist: backup actual verificado, versión exacta, política de límites/presupuesto configurada, una sola instancia, mantenimiento y reversión compatible con cortesías/confirmación. Revisar la recuperación D1/R2 y configuración por separado de Auth. La publicación requiere su decisión concreta cuando la versión candidata esté preparada.
- [ ] **Step 7:** Registrar por separado pendientes comerciales no sustituibles por QA: conciliación bancaria auténtica, condiciones de devolución/conservación, integración de fuentes y capacidad observada con los primeros negocios. No activar WhatsApp ni marketplace para cerrar esta lista.

## Self Review

El alcance aprobado se divide en cuatro entregas que pueden comprobarse por separado. Los cambios de producto todavía no están ejecutados. El índice agrega integración/aceptación, sin duplicar las implementaciones de los subplanes. Conserva el contrato de prueba y la producción actual, identifica la base local distinta de HEAD y asigna pruebas a las cinco clases Review Focus.

## Revisión y ejecución

Recomendación: **ejecución nativa en esta sesión**, con delegación de auditorías independientes. Las cuatro entregas comparten tipos, cuotas, protocolos y pantallas; una implementación coordinada evita que agentes distintos modifiquen simultáneamente esos contratos. La alternativa por subagentes usa implementador y revisor nuevos por tarea y tiene mayor coste de contexto. La elección del método no cambia los criterios de aceptación ni el alcance aprobado.
