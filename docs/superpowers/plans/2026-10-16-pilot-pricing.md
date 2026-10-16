# Public commercial pricing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar en la landing las tarifas guardadas en administración y evitar que un formulario nuevo envíe un comprobante con un precio que cambió mientras estaba abierto.

**Architecture:** Proyección pública mínima derivada de los mismos ajustes que usa facturación. Un componente cliente consulta la API en runtime; la exportación estática nunca consulta datos privados durante el build. El servidor conserva el precio efectivo en cada comprobante y devuelve un conflicto de tarifa antes de escribir cuando recibe una cotización obsoleta.

**Tech Stack:** Next.js 16.4.0, React 19.3.0, TypeScript, Zod 4.6.7, Vitest, abstracción Database D1/Firestore; sin dependencias nuevas.

**Spec:** [Brief aprobado](../../product/BRIEF.md), secciones «Precios administrables en la landing», «Prioridad y roadmap» y «Pendientes operativos».

## Global Constraints

- Node 24 y pnpm 11.23.0. Conservar el lockfile compartido; no actualizar el framework para esta tarea.
- Prueba fija de 5.000 COP, diez citas y 700 respuestas totales, sin vencimiento por días. No volver editable el precio de prueba.
- No publicar `PlatformSettings`, bancos, documentos del titular, estado del túnel ni disponibilidad del motor.
- No anunciar WhatsApp como canal disponible ni crear rutas de marketplace.
- La landing sigue siendo una exportación estática sin Firebase ni secretos en el artefacto.
- Reutilizar Agenda clara y DM Sans; sin nuevos textos decorativos, emojis o iconos de relleno.
- Los comprobantes existentes y los reintentos exitosos conservan su precio original.
- No desplegar ni modificar las tarifas reales mientras se implementa/verifica este plan.

## Review Focus

- Ajuste almacenado corrupto: la API falla de forma controlada y no publica `NaN`, cero o una constante de reemplazo como precio vigente; prueba en tarea 1.
- Visitante sin sesión: obtiene solo la oferta comercial y no necesita inicializar Firebase; pruebas de API y artefacto en tareas 1 y 2.
- Error después de una lectura exitosa: la landing deja de presentar el precio anterior como vigente y permite reintentar; prueba en tarea 2.
- Respuesta tardía después de desmontar/cambiar origen: no reemplaza la oferta actual; prueba en tarea 2.
- Tarifa cambia entre elegir un plan y subir una imagen: no se escribe comprobante/borrador ni se pierde la imagen local; revisión explícita y segundo envío en tarea 3.

---

## File Structure

| Archivo | Responsabilidad |
| --- | --- |
| Crear `src/lib/commercial-offer.ts` | Contrato público y cálculo/validación pura de importes, sin acceso a DB o Firebase. |
| Crear `src/lib/server/commercial-offer.ts` | Leer ajustes actuales y proyectarlos al contrato público. |
| Crear `src/app/api/public/commercial-offer/route.ts` | GET anónimo dinámico, sin caché y con errores sanitizados. |
| Crear `src/lib/client/use-public-commercial-offer.ts` | Lectura pública con `fetch`, validación, cancelación y polling visible. |
| Crear `src/components/marketing-pricing.tsx` | Estado de carga/error y tarifas actuales dentro de la sección existente. |
| Modificar `src/components/marketing-home.tsx` | Sustituir solo los importes variables por el componente público. |
| Modificar `src/lib/server/schemas.ts`, `billing.ts`, `src/app/dashboard/billing/page.tsx` | Verificar cotización anterior y pedir revisar el cambio antes de enviar. |
| Modificar `tests/marketing-home.test.tsx`, `tests/billing.test.ts`, `tests/billing-pages.test.tsx`, `tests/schemas.test.ts` | Regresiones de enlaces, cotización e idempotencia. |
| Crear `tests/commercial-offer.test.ts`, `tests/public-commercial-offer-route.test.ts`, `tests/marketing-pricing.test.tsx` | Contrato, permisos públicos y estados de runtime. |
| Modificar `scripts/verify-landing.mjs`, `landing/README.md`, `docs/commercial-plans.md` | Artefacto sin tarifas variables empotradas y operación de la lectura pública. |

### Task 1: Contrato público y endpoint

**Files:** crear contrato, servicio, ruta y sus dos tests según el mapa; modificar `billing.ts` solo para reutilizar el cálculo puro de importe, conservando la lectura transaccional existente.

**Interfaces:**
- Consume `getSettings(db?: Database): Promise<PlatformSettings>` y constantes de `billing-plans.ts`/`paid-trial.ts`.
- Produce `PublicCommercialOffer`: `{ currency: 'COP'; trial: { priceCOP: 5000; appointmentLimit: 10; includedResponses: 700; expiresByDays: false }; plans: Array<{ id: 'weekly' | 'fortnightly' | 'monthly'; label: string; periodDays: number; includedResponses: number; priceCOP: number }>; responsePack: { responses: 1000; priceCOP: number } }`.
- Produce `publicCommercialOfferSchema`, `buildPublicCommercialOffer(settings: PlatformSettings): PublicCommercialOffer` y `commercialPriceCOP(settings: PlatformSettings, kind: 'subscription' | 'response_pack' | 'paid_trial', planId?: SubscriptionPlanId): number` en `src/lib/commercial-offer.ts`.
- Produce `readPublicCommercialOffer(db?: Database): Promise<PublicCommercialOffer>` y GET `/api/public/commercial-offer`. El precio de WhatsApp solo se calcula internamente para conservar facturación; no aparece en `plans`.

- [ ] **Step 1:** En `commercial-offer.test.ts`, usar `memoryFirestore` y los fixtures de ajustes de `billing.test.ts`: guardar mensual 65000 y ampliación 23000, exigir esos importes; exigir prueba 5000/10/700; comprobar que no hay bancos/túnel y que leer no escribe filas. Parametrizar mensual `0`, `-1`, `1.5`, `NaN` y `100000001`: el cálculo rechaza el dato.

  Assertions centrales, con `settings` obtenido mediante `getSettings(memoryFirestore().db)` en el setup del test:
  ```ts
  const offer = buildPublicCommercialOffer({ ...settings, monthlyPriceCOP: 65000, responsePackPriceCOP: 23000 });
  expect(offer.plans.find(plan => plan.id === 'monthly')?.priceCOP).toBe(65000);
  expect(offer.responsePack.priceCOP).toBe(23000);
  expect(offer.trial).toEqual({ priceCOP: 5000, appointmentLimit: 10, includedResponses: 700, expiresByDays: false });
  expect(offer).not.toHaveProperty('bankAccounts');
  expect(() => buildPublicCommercialOffer({ ...settings, monthlyPriceCOP: 0 })).toThrow();
  ```
- [ ] **Step 2:** Añadir en `public-commercial-offer-route.test.ts` mocks de DB siguiendo `tests/business-read-routes.test.ts`; GET sin credenciales devuelve 200 y exactamente el contrato permitido, `Cache-Control: no-store`. Error de DB devuelve 503 sin contenido interno. `POST` no está exportado.
- [ ] **Step 3:** Ejecutar `pnpm test tests/commercial-offer.test.ts tests/public-commercial-offer-route.test.ts`; esperar RED por módulos ausentes o assertions de contrato, nunca por credenciales externas.
- [ ] **Step 4:** Implementar las interfaces. Validar precios enteros seguros en `[1,100000000]`. La ruta usa `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`; el error público no revela valores/stack. `submitReceipt` usa `commercialPriceCOP` con sus ajustes leídos en la misma transacción; conservar la rama de WhatsApp verificado existente y el orden de recuperación idempotente.
- [ ] **Step 5:** Ejecutar los dos tests nuevos y `pnpm test tests/billing.test.ts tests/billing-paid-trial.test.ts`; esperar todo PASS, incluidos importes históricos e idempotencia.
- [ ] **Step 6:** Revisar diff y crear un commit enfocado `feat: expose current public commercial pricing`, incluyendo solo los archivos de esta tarea y su documentación asociada. No incorporar cambios previos ajenos.

### Task 2: Lectura de tarifas en la landing estática

**Files:** crear hook y componente de precios; modificar MarketingHome, sus tests, verificador de landing y documentación de exportación.

**Interfaces:**
- Consume contrato y endpoint de tarea 1, `publicApplicationOrigin(value?: string): string | null` y `startApiPolling<T>(load, onValue, onError)` de `src/lib/client/api-polling.ts`.
- Produce `usePublicCommercialOffer(endpoint: string | null): { offer: PublicCommercialOffer | null; loading: boolean; error: string | null; refresh: () => void }`.
- Produce `MarketingPricing({ endpoint }: { endpoint: string | null })`; en app completa endpoint relativo `/api/public/commercial-offer`; en standalone con origen aprobado, origen más ruta. Sin origen aprobado, no consultar una URL alternativa y mostrar «Consulta el precio vigente».

- [ ] **Step 1:** Crear `marketing-pricing.test.tsx` con React Test Renderer, `act`, fake timers y `fetch` mock. Primer fetch mensual 65000 muestra `$65.000 COP`, nunca 59900; renovación visible a 15 segundos muestra 68000. Verificar petición sin `Authorization` con `cache: 'no-store'` y `credentials: 'omit'`.
- [ ] **Step 2:** Añadir casos: primera carga sin importe variable; respuesta inválida y error después de éxito ocultan importes anteriores; «Reintentar» recupera; desmontar o cambiar endpoint descarta respuesta tardía; pestaña oculta pausa las consultas usando el polling existente. Preservar las acciones/enlaces de prueba fija 5000 en `marketing-home.test.tsx`.

  Usar el helper `text(node)` y montaje con `act` de los tests de pantallas existentes. Después de una lectura mensual 65000 y después del error de red, respectivamente:
  ```ts
  expect(text(renderer.root)).toContain('$65.000 COP');
  // Tras rechazar el fetch de renovación y resolver act:
  expect(text(renderer.root)).not.toContain('$65.000 COP');
  expect(text(renderer.root)).toContain('Reintentar');
  ```
- [ ] **Step 3:** Ejecutar `pnpm test tests/marketing-pricing.test.tsx tests/marketing-home.test.tsx`; esperar RED por la ausencia del componente/hook o por los valores fijos previos.
- [ ] **Step 4:** Implementar hook con `startApiPolling` y `fetch` directo. No importar `apiFetch`, `useApiPoll` o `auth-provider`: arrastran Firebase al artefacto estático. Validar el JSON completo con el esquema de tarea 1; en error poner `offer: null`. MarketingHome conserva el HTML principal/CTA y mueve únicamente planes y precio variable de ampliación a `MarketingPricing`; eliminar los precios variables hardcoded, incluidos los de textos de ampliación.
- [ ] **Step 5:** Actualizar el verificador estático para exigir una sección de precio con estado accesible, ausencia de importes de planes renderizados como vigentes en el HTML y ausencia de Firebase/secretos en bundles. No alterar el allowlist de dominios. Actualizar README para indicar lectura runtime y revalidación visible de 15 segundos.
- [ ] **Step 6:** Ejecutar los dos tests, `pnpm run build:landing` y `pnpm run check:landing`; esperar PASS y exportación válida sin servidor de precios embebido. En navegador, simular la oferta sintética y el error a 320 px y escritorio; comprobar navegación, estados y ausencia de desbordamiento. Guardar evidencia con datos sintéticos.
- [ ] **Step 7:** Revisar diff y crear commit `feat: load live commercial prices on the landing` solo con los archivos de la tarea.

### Task 3: Cotización obsoleta durante el envío del comprobante

**Files:** modificar `schemas.ts`, `billing.ts`, `dashboard/billing/page.tsx`, tests de esquemas/facturación/pantallas y documentación comercial.

**Interfaces:**
- Consume `commercialPriceCOP` de tarea 1 y `submitReceipt` existente, cuya firma pública se conserva.
- Produce campo opcional `quotedPriceCOP?: number` en `receiptSchema` con entero `[1,100000000]`; clientes nuevos lo envían siempre para suscripción y ampliación. La prueba fija no requiere cotización variable. La opcionalidad conserva clientes anteriores; omitirlo nunca permite elegir el importe del recibo, que calcula el servidor.
- Produce `HttpError(409, 'El precio cambió. Revisa el importe actualizado antes de enviar.', 'OFFER_PRICE_CHANGED')` cuando la cotización recibida difiere del importe actual. Recuperar un `requestId` ya aceptado prevalece sobre esta comprobación.

- [ ] **Step 1:** Añadir tests de servidor: mensual cotizado 59900 y actual 65000 devuelve conflicto y no crea filas de recibo/imagen/borrador; reintento de recibo aceptado a 59900 devuelve el mismo tras cambiar a 65000; un cliente anterior sin cotización obtiene 65000 calculado por servidor; ampliación tiene la misma protección y prueba sigue a 5000. Añadir validación de cotizaciones inválidas en schemas.

  Sobre el fixture `submissionDatabase()`/`upload` de `billing.test.ts`, guardar mensual 65000 antes de ejecutar:
  ```ts
  await expect(submitReceipt(owner, { ...upload, planId: 'monthly', quotedPriceCOP: 59900 }, db))
    .rejects.toMatchObject({ status: 409, code: 'OFFER_PRICE_CHANGED' });
  expect([...rows.keys()].filter(path => path.startsWith('paymentReceipts/'))).toHaveLength(0);
  expect([...rows.keys()].filter(path => path.startsWith('paymentImages/'))).toHaveLength(0);
  ```
- [ ] **Step 2:** Añadir test de pantalla usando fixtures existentes de `billing-pages.test.tsx`: primer POST incluye `quotedPriceCOP: 59900`; responder `ApiError` 409 con código; GET refresca mensual a 65000, conserva la imagen local y muestra aviso; no se reenvía automáticamente. Segundo clic explícito envía 65000. Comprobante pendiente sigue bloqueando otro envío.
- [ ] **Step 3:** Ejecutar `pnpm test tests/billing.test.ts tests/billing-pages.test.tsx tests/schemas.test.ts`; esperar RED en cotización/error, con los casos existentes sin regresión.
- [ ] **Step 4:** Implementar chequeo dentro de la transacción después de recuperar petición existente y antes de cualquier escritura. No guardar `quotedPriceCOP` como fuente de precio ni modificar recibos pasados. En UI, refrescar ajustes al recibir el código, mantener imagen/banco y esperar otro envío explícito; distinguir fallo de refresco de fallo de subida.
- [ ] **Step 5:** Ejecutar tests afectados, `pnpm run typecheck` y `pnpm test`; esperar PASS. Ejecutar `pnpm run build`, `pnpm run build:landing`, `pnpm run check:landing` y `node --test pages-gateway/tests/*.test.mjs`; esperar salidas sin fallos. El gateway actual ya reenvía `/api/`; no necesita abrir otro origen/CORS.
- [ ] **Step 6:** Registrar aceptación sintética de cambio de tarifa entre lectura y POST en entorno local; documentar que no se cambiaron tarifas reales. Revisar diff y commit `fix: require review when a quoted plan price changes` con paths explícitos.

## Self Review

Cobertura: proyección pública y fuente única (tarea 1), actualización runtime sin republicar/error sin precio antiguo (tarea 2), importe vigente en transacción y conservación de recibos (tarea 3). Las cinco entradas Review Focus tienen casos asignados. La API de facturación privada sigue autenticada. No añade caché compartida, dependencia, acceso CORS, cambio de plan comercial ni despliegue. Los contratos consumidos se definen en la tarea anterior.

Referencia técnica consultada al planificar: la [exportación estática de Next.js](https://nextjs.org/docs/app/guides/static-exports) permite lectura desde componentes cliente; no se debe convertir el handler dinámico en archivo estático del build.
