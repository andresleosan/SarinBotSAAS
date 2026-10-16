# Pilot Business Branding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada propietario configura logo/contactos y exporta la tarjeta **A / Agenda clara** en PDF, PNG y QR SVG dentro de Sarin, antes de incorporar negocios al piloto.

**Architecture:** Identidad comercial en `Business`, proyección pública explícita y logos normalizados en una colección privada externalizada a R2 mediante el adaptador existente. El navegador genera las tarjetas desde datos guardados y una URL canónica del servidor, sin almacenar PDFs por negocio.

**Tech Stack:** Next/React/TypeScript, Zod, `qrcode.react`, Canvas, Database D1/Firestore y R2; dependencias de ejecución justificadas abajo.

**Spec:** [Brief](../../product/BRIEF.md), «Identidad y tarjeta del negocio», decisiones «1 y 2» y «usemos la A». Baseline, integración y release: [índice general](2026-10-16-commercial-pilot.md).

## Global Constraints

- Node **24**, pnpm **11.23.0**, lockfile compartido.
- «Separar la cuenta personal Google de la identidad comercial». No cambiar `UserProfile.photoURL`.
- «El propietario solo cambia imágenes de su negocio». «Las imágenes públicas no reutilizan las rutas de comprobantes privados de R2».
- «El QR contiene únicamente el enlace permanente de reservas; teléfono y redes se muestran en la tarjeta y en el perfil».
- «Actualizar el teléfono o logo no debe obligar a cambiar el QR impreso». «La marca del negocio tiene prioridad; Sarin queda como firma discreta».
- Entrada PNG/JPEG/WebP, máximo **2 MiB**, sin SVG ni animación. Servidor normaliza sin recortar a WebP **512 × 512**, sin EXIF, máximo **256 KiB**.
- Tarjeta A6 **105 × 148 mm**, información a **5 mm** del corte, sin sangrado. PNG **1241 × 1749 px** (300 ppp redondeados); PDF de una página que contiene ese mismo PNG, sin prometer texto vectorial/seleccionable.
- QR puro negro/blanco, nivel M, cuatro módulos libres, sin logo superpuesto, cuadrado total **50 mm**; su símbolo útil supera 35 mm incluso en versión 1.
- **A / Agenda clara es la plantilla elegida** para el primer piloto: fondo blanco, tinta `#162344` y azul `#315FF3`. Sin selector de estilos. B/C de las [muestras anteriores](../../design/2026-10-16-qr-cards/README.md) se conservan como referencias; no se implementan ni se importan sus datos sintéticos.
- Fuentes locales, sin IA, servicios nuevos, PDFs persistentes ni solicitudes a URLs sociales. Conservar cambios previos, datos, suscripciones y slug; no modificar artes anteriores.
- **Solo plan**: no producto, instalaciones, pruebas de implementación, commits ni producción hoy. Onboarding progresivo completo y perfil antes de Google quedan fuera.

## Review Focus

1. Negocio anterior sin branding y payload antiguo de Sarin: conservar contactos/logo existentes cuando se omitan campos nuevos (tareas 1 y 5).
2. Imagen corrupta, disfrazada, animada o enorme y otra cuenta: rechazar antes de publicar bytes (tarea 2).
3. Nombre de 120 caracteres, palabra sin espacios, tildes y tres redes: mantener QR y márgenes legibles (tarea 4).
4. Fuente/logo fallidos o redirección externa: error recuperable, sin exportación parcial ni Canvas contaminado (tareas 4 y 5).
5. Cambio de cuenta, cargas simultáneas y exportación obsoleta: no sobrescribir datos nuevos ni borrar formularios en edición (tareas 2 y 5).

---

## Dependencias

El protocolo tiene allowlist y D1 columna `blob`: sin tabla nueva. `package.json` no declara normalizador/PDF; `sharp@0.35.5` transitivo requiere declaración directa. `pdf-lib@1.17.1` verificado en [npm](https://registry.npmjs.org/pdf-lib/1.17.1); [API oficial](https://pdf-lib.js.org/docs/api/classes/pdfdocument): `addPage`, `embedPng`, `save`. [Sharp](https://sharp.pixelplumbing.com/api-constructor/) admite límites de píxeles. No se requieren otras bibliotecas.

Orden: 1/3 independientes; 2 depende de 1; 4 de 1/3; 5 integra.

### Task 1: Contratos de identidad y contactos públicos

**Files:**
- Create: `src/lib/business-branding.ts`.
- Modify: `src/types/firestore.ts`, `src/lib/server/schemas.ts`, `src/lib/server/businesses.ts`.
- Test: `tests/business-branding.test.ts`, `tests/schemas.test.ts`, `tests/businesses.test.ts`, `tests/business-read-routes.test.ts`.

**Interfaces:**
- Produce `BusinessSocialPlatform = 'instagram' | 'facebook' | 'tiktok' | 'website'`, `BusinessSocialLink = { platform: BusinessSocialPlatform; url: string }`, `BusinessLogo = { sha256: string }` en el archivo nuevo.
- Produce `normalizeBusinessSocialLinks(value: unknown): BusinessSocialLink[]` (lanza `Error` si inválido), `businessSocialLabel(link: BusinessSocialLink): string` (texto visible: usuario o dominio).
- `Business` añade `socialLinks?: BusinessSocialLink[]`, `logo?: BusinessLogo`. Proyección enumera únicamente esos campos validados, sin bytes, propietario ni claves R2. `BusinessConfig.socialLinks?` omitido conserva; `[]` borra. Config no acepta `logo`.
- Máximo tres redes, plataforma única, URL HTTPS absoluta de hasta 512 caracteres, sin credenciales/puerto/fragmento/control characters. Instagram/Facebook/TikTok admiten solo su dominio exacto y variante `www`; website admite hostname HTTPS con punto. Quitar parámetros de seguimiento de perfiles sociales, pero conservar `id` numérico en `facebook.com/profile.php?id=...`; rechazar ese path sin identificador válido. En `website`, conservar el query funcional que haya proporcionado el propietario. Rechazar esquemas inseguros, URLs relativas y dominios parecidos; nunca fetch de esas URLs. Mantener contrato existente de `phoneWhatsApp`, incluidos valores históricos sin `+`.

- [ ] **RED:** añadir `preserves_omitted_branding`, `clears_only_explicit_links`, `rejects_unsafe_social_links`, `projects_only_safe_logo_metadata`. Con fixture ya identificado y payload antiguo, fijar:
  ```ts
  expect(updated.logo).toEqual(before.logo);
  expect(updated.socialLinks).toEqual(before.socialLinks);
  expect(cleared.socialLinks).toEqual([]);
  expect(JSON.stringify(projection)).not.toMatch(/ownerEmail|logoDataUrl|payment-images/);
  ```
  Rechazar cuarta red, plataforma duplicada, `javascript:` e `instagram.com.evil.test`; incluir una propiedad privada adicional dentro del logo y comprobar que no se proyecta. Añadir `preserves_functional_profile_identifiers`: Facebook `profile.php?id=100123456789&fbclid=tracking` conserva `id=100123456789` y elimina `fbclid`; un website `https://negocio.example/reservas?sede=norte` conserva `sede=norte`.
- [ ] **Verify RED:** `pnpm test -- tests/business-branding.test.ts tests/schemas.test.ts tests/businesses.test.ts tests/business-read-routes.test.ts`; esperar fallos nuevos específicos.
- [ ] Implementar tipos, validación opcional sin default y preservación desde la lectura transaccional más reciente. Publicar junto con configuración; no ampliar herramientas con capacidad de escribir imágenes.
- [ ] **GREEN:** repetir comando y `pnpm run typecheck`; PASS, pruebas previas intactas.

### Task 2: Logo validado, R2 separado y acceso público controlado

**Files:**
- Create: `src/lib/server/business-logos.ts`, `src/app/api/businesses/logo/route.ts`, `src/app/api/public/businesses/[slug]/logo/[sha256]/route.ts`.
- Modify: `shared/data-protocol.ts`, `cloudflare/src/data.ts`, `package.json`, `pnpm-lock.yaml`.
- Test: `tests/business-logos.test.ts`, `tests/business-logo-routes.test.ts`, `tests/storage-backend.test.ts`, `tests/firestore.rules.test.ts`, `cloudflare/tests/data.test.mjs`.

**Interfaces:**
- Consume task 1, `Database`, `requireUser`, `getOwnedBusiness`, `assertOwner`, `isSubscriptionAllowed`, `readJson`.
- Produce `normalizeBusinessLogo(dataUrl: string): Promise<{ dataUrl: string; sha256: string }>`, `saveBusinessLogo(user: Pick<ChatActor, 'uid'>, input: { logoDataUrl: string | null; expectedSha256: string | null }, db?: Database): Promise<Business>`, `readPublicBusinessLogo(slug: string, sha256: string, db?: Database): Promise<Uint8Array>`.
- `POST /api/businesses/logo` recibe ese input JSON, sin ID de negocio; responde `{ business }`. `null` elimina. Autenticar y comprobar propietario/derecho comercial antes de procesar y nuevamente en transacción. Body streaming máximo 3 MiB; raw image máximo 2 MiB. Invalidación 400, exceso 413, sesión/permisos 401/403, digest esperado obsoleto 409 `BRANDING_CHANGED`.
- Colección `businessLogos/<business.id>_<sha256>` con `{ businessId, ownerUid, sha256, logoDataUrl, createdAt }`; objeto R2 `business-logos/<sha256>`. La allowlist añade esa colección. Worker valida WebP/base64 canónico/firma/tamaño/digest y externaliza `logoDataUrl`; solo lectura directa hidrata bytes. Recibos conservan su política de 150 KiB y prefijo propio.
- GET público exige proyección `publicBusinesses/<slug>` completada y digest actual igual al solicitado antes de leer ese asset. 400 inválido, 404 ausente/antiguo/eliminado; nunca fallback a colección privada del negocio. Respuesta WebP `no-store`, `nosniff`, `Cross-Origin-Resource-Policy: same-origin`; sin CORS permisivo ni bucket público.

- [ ] **RED:** añadir `rejects_hostile_images`, `normalizes_without_exif_or_crop`, `rejects_foreign_owner_and_stale_replace`, `binds_public_logo_to_projection`, `separates_r2_logo_and_payment_policy`. Usar fixtures reales: PNG válido, truncado, SVG con MIME PNG, WebP de dos frames y dimensiones excesivas. Afirmar decode 512 × 512, sin EXIF; navegador denegado por reglas; versión antigua pública 404. Dos saves de imágenes distintas con igual digest esperado producen una mutación y un 409; dos envíos de la misma imagen deseada recuperan éxito sin duplicar la mutación. Fallo R2 deja negocio/proyección/revisión sin cambiar.
- [ ] **Verify RED:** `pnpm test -- tests/business-logos.test.ts tests/business-logo-routes.test.ts tests/storage-backend.test.ts`; `pnpm --filter sarin-cloudflare-host test`; fallos nuevos específicos.
- [ ] En ejecución, declarar `sharp@0.35.5` directo. Validar firma antes del decoder; rechazar formato detectado distinto, animación, más de 16.777.216 píxeles o lados mayores de 4096. Usar `sharp` con `limitInputPixels`, `animated: false`, `failOn: 'warning'`; decodificar, orientar, encajar sin recortar con padding transparente a 512 cuadrado, quitar metadatos y codificar WebP calidad 85. Si salida excede 256 KiB, rechazar; no publicar parcialmente.
- [ ] Extender política de blobs por colección, conservando validación completa antes de R2, bytes antes del CAS y comprobación de hash/longitud al hidratar. Firestore mantiene data URL normalizado limitado para emuladores. Comparar digest esperado en transacción; mismo digest deseado ya activo es éxito idempotente. Escribir asset/business/proyección juntos; eliminar documento anterior solo si distinto, sin borrar objetos R2 de rollback. Al quitar logo, omitir propiedad, no guardar `undefined`.
- [ ] **GREEN:** repetir pruebas, `pnpm run typecheck`, `pnpm run test:rules` (Java 21+) y typecheck Worker. Verificar aislación y comprobantes. R2 conserva huérfanos privados tras CAS fallido; sin limpieza destructiva.

### Task 3: URL canónica independiente del navegador

**Files:**
- Create: `src/lib/server/booking-url.ts`, `src/app/api/businesses/qr-kit/route.ts`.
- Modify: `cloudflare/src/router.ts`, `cloudflare/worker-configuration.d.ts`, `.env.local.example`, `deploy/runtime.env.example`, `cloudflare/README.md`.
- Test: `tests/booking-url.test.ts`, `tests/qr-kit-route.test.ts`, `cloudflare/tests/router.test.mjs`.

**Interfaces:**
- Produce `getCanonicalBookingUrl(slug: string, origin?: string): string`; origin por defecto `process.env.SARIN_PUBLIC_BOOKING_ORIGIN`. Validar slug y origen HTTPS sin credenciales/puerto/path/query/fragmento; rechazar IPs, loopback y hosts preview/example en producción. Loopback HTTP con puerto solo en desarrollo y proyecto `demo-*`.
- GET autenticado `/api/businesses/qr-kit` usa negocio propio y responde `{ bookingUrl: string; business: Business }`; configuración incompleta 409 `BUSINESS_NOT_READY`, canonical inválido/ausente 503 `BOOKING_ORIGIN_UNAVAILABLE`. No tomar Host/Forwarded/request URL como fallback.
- Proponer `SARIN_PUBLIC_BOOKING_ORIGIN=https://sarinbotsaas.pages.dev`, dominio publicado documentado; reenviar como runtime server-only. No cambiar configuración real/DNS ahora. Mostrarlo para revisión antes de imprimir; futuro cambio de dominio exige conservar redirección desde el impreso.

- [ ] **RED:** `ignores_spoofed_or_preview_host`, `rejects_missing_or_non_origin_config`, `allows_only_demo_loopback`, `branding_edits_keep_url_equal`, `kit_requires_owner`. Afirmar URL idéntica tras editar nombre/logo/teléfono; slug diferente sigue 409; ningún resultado relativo o `undefined/b/...`.
- [ ] **Verify RED:** `pnpm test -- tests/booking-url.test.ts tests/qr-kit-route.test.ts tests/businesses.test.ts`; `pnpm --filter sarin-cloudflare-host test`.
- [ ] Implementar helper/ruta y runtime allowlist; regenerar tipos al ejecutar, documentar valor local y canónico. Error de configuración bloquea QR/exportaciones sin afectar otras rutas.
- [ ] **GREEN:** repetir comandos y `pnpm run typecheck`; URL exacta estable, sin hostname de motor ni filtración de variables privadas.

### Task 4: Plantilla A y exportación PDF/PNG/SVG

**Files:**
- Create: `src/lib/booking-card.ts`, `src/lib/client/booking-card-assets.ts`, `tests/booking-card.test.ts`, `tests/booking-card-assets.test.ts`.
- Modify: `package.json`, `pnpm-lock.yaml`.

**Interfaces:**
- Produce `BookingCardDetails = { businessId: string; slug: string; businessName: string; phoneWhatsApp: string; socialLinks: BusinessSocialLink[]; bookingUrl: string; logoSha256: string | null }`.
- Produce `getBookingCardLayout(details: BookingCardDetails): BookingCardLayout` para A. Exportar `CardBox = { x: number; y: number; width: number; height: number }`, `CardTextBox = CardBox & { text: string; fontSize: number; color: string }`, `BookingCardLayout = { width: 1241; height: 1749; background: string; logo: CardBox; qr: CardBox; texts: CardTextBox[] }`.
- Produce `buildBookingCardAssets(input: { details: BookingCardDetails; qrSvg: string; signal: AbortSignal }): Promise<{ png: Blob; pdf: Blob; qrSvg: Blob }>`. SVG viene del `QRCodeSVG` propio con `data-booking-url` igual a la instantánea; nunca input del propietario.
- Cargar explícitamente FontFace `SarinCardDM` desde `/fonts/dm-sans-latin.woff2`, esperar carga antes de medir. Logo solo desde ruta task 2 construida con slug/digest: fetch same-origin, `redirect: 'error'`, MIME/bytes limitados, decode Blob. Fuente/logo fallidos abortan todo; URLs sociales no se descargan.
- Nombre hasta cuatro líneas, ajuste 22 a 11 pt por grafemas; tres redes con una línea cada una y elipsis visual, enlaces completos en UI. Iniciales si no hay logo; omitir redes ausentes. Copy «Escanea y agenda tu cita» y firma «Reservas con Sarin». QR de 50 mm no se desplaza por texto. Composición A con DM Sans local y logo/datos del negocio.

- [ ] **RED:** `fits_long_accented_and_unbroken_names`, `renders_selected_agenda_clara_template`, `aborts_on_font_logo_or_signal_failure`, `pdf_contains_same_png_at_a6_size`. Afirmar plantilla A, cajas dentro del margen sin intersectar QR, 1241 × 1749, ausencia de contactos inventados y una página PDF de medidas A6 exactas. Cubrir tres redes, MIME HTML, redirect externo y aborto. SVG negro/blanco con cuatro módulos libres y URL idéntica entre formatos.
- [ ] **Verify RED:** `pnpm test -- tests/booking-card.test.ts tests/booking-card-assets.test.ts`; esperar fallos por contratos ausentes.
- [ ] En ejecución, añadir `pdf-lib@1.17.1` exacto. Canvas dibuja composición y SVG confiable sin smoothing del QR; PNG lossless. Import dinámico de PDF-lib, `embedPng()` del mismo PNG, página `[105 * 72 / 25.4, 148 * 72 / 25.4]`. Revocar URLs temporales y comprobar señal tras cada espera; ninguna imagen/fuente remota ni persistencia de tarjetas.
- [ ] **GREEN:** repetir pruebas y tipos. `PDFDocument.load()` comprueba página e imagen; revisión visual/QR en tarea 5.

### Task 5: Configuración, kit integrado y aceptación local

**Files:**
- Create: `src/components/business-logo-field.tsx`, `src/components/business-social-fields.tsx`, `src/components/booking-card-preview.tsx`, `tests/business-branding-ui.test.tsx`, `tests/qr-kit.test.tsx`, `docs/qa/2026-10-16-business-branding.md` al ejecutar.
- Modify: `src/app/dashboard/onboarding/page.tsx`, `src/app/dashboard/qr-kit/page.tsx`, `src/app/b/[slug]/page.tsx`, `src/hooks/useBusiness.ts`, `tests/onboarding-assistance.test.tsx`, `tests/use-business.test.tsx`.

**Interfaces:**
- `useBusiness()` añade `refresh: () => void`, `setBusiness: (value: SetStateAction<Business | null>) => void`, delegados a `useApiPoll` (conserva retornos actuales).
- `BusinessLogoField({ business, onSaved }: { business: Business; onSaved: (business: Business) => void })`: subir/eliminar, input accesible y errores; JSON mediante `apiFetch`, digest observado al iniciar, sin multipart. `BusinessSocialFields({ value, onChange }: { value: BusinessSocialLink[]; onChange: (links: BusinessSocialLink[]) => void })`: hasta tres filas guardadas solo con submit. Reutilizar teléfono/country selector como teléfono público/WhatsApp.
- `BookingCardPreview({ assets, businessName, filenameStem, qrFilename }: { assets: { png: Blob; pdf: Blob; qrSvg: Blob } | null; businessName: string; filenameStem: string; qrFilename: string })`: preview accesible, «Ver PDF», descargas PDF/PNG/SVG. Nombres `tarjeta-<slug>.pdf/.png`, `qr-<slug>.svg`; URLs Blob revocadas al cambiar/desmontar.
- Kit consume task 3 y muestra solo la plantilla A, URL completa, copiar/abrir y guía A6 al 100%. Sin selector de estilos. Estado error/carga no habilita archivos. Perfil conserva AuthGate y flujo actual, mostrando logo/contactos desde `PublicBusiness`, externos con `noopener noreferrer`.

- [ ] **RED:** `does_not_reset_dirty_form_after_logo_poll`, `socials_save_only_explicitly`, `uploads_removes_and_retries`, `kit_uses_selected_template_without_style_selector`, `discards_old_account_or_branding_export`. Afirmar cero saves automáticos, plantilla A con datos guardados y sin selector, edición intacta tras logo/poll, foto Google intacta y digest correcto en solicitud. Promesa diferida de otro UID o branding anterior no debe habilitar descarga ni sustituir preview.
- [ ] **Verify RED:** `pnpm test -- tests/business-branding-ui.test.tsx tests/qr-kit.test.tsx tests/onboarding-assistance.test.tsx tests/use-business.test.tsx`.
- [ ] Implementar dirty guard: hidratar negocio inicialmente; sondeo solo actualiza campos prístinos; resetear baseline tras submit exitoso. Logo-only usa `setBusiness()` sin reemplazar servicios/reglas/phone editados. Conservar logo anterior ante error y mostrar recarga/reintento ante 409. No añadir editor visual ni configuración de estilos.
- [ ] Integrar exportación con clon de datos guardados, UID/business y contador de generación más AbortController. Invalidar archivos al cambiar branding; aceptar resultado solo si sigue vigente. Cuenta nueva enmascara datos inmediatamente; revocar URLs descartadas. QR propio nivel M/margen cuatro, `data-booking-url` comprobado antes de serializar.
- [ ] **GREEN:** repetir pruebas focalizadas y tipos; ejecutar gates generales del índice. En `dev:local --port 3040`, demo y dos propietarios sintéticos: cargar logo transparente/no cuadrado, cambiar contactos, exportar A en escritorio/390 px, abrir PDF/PNG reales, revisar tildes/márgenes, permisos y fallos. Decodificar QR de render PDF/PNG y SVG con decoder disponible y comprobar URL canónica exacta antes/después de cambiar branding; documentar limitación si queda revisión con móvil. Registrar evidencia sin tokens/datos personales.
- [ ] Revisar autorización, límites, metadata pública, no logs de imágenes, limpieza/aborto y `pnpm audit --audit-level=high` tras añadir dependencias. Antes de tirada real: confirmar dominio y prueba física en acrílico/iluminación. Estos controles no autorizan publicación.

## Self Review

Cobertura: contactos/proyección (1), logo (2), URL (3), exportaciones/preview de A (4–5). Review Focus asignado a pruebas; firmas sin parámetros de estilo. B/C se conservan como referencias, sin selector previo al piloto. Cinco unidades sin editor libre ni infraestructura nueva; PDF descrito como PNG a 300 ppp. Solo documentación en esta fase.

Esperar revisión.
