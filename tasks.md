# Estado de implementación — 2026-10-14

## Estructura comercial — 2026-10-15

- [x] Estructura aprobada por el propietario: Esencial 7/15/30 días a $20.000/$35.000/$59.900 con 700/1.500/3.000 respuestas; WhatsApp 30 días a $149.900 + Meta con 4.500; ampliaciones de 1.000 por $20.000. Referencia: `docs/commercial-plans.md`.
- [x] Cuotas por vigencia, paquetes, aviso al 80%, pausa de IA y visualización de capacidad implementados y verificados. Trial de 700 respuestas y copiloto compartido confirmados por el propietario. Evidencia: `docs/qa/2026-10-15-commercial-quotas.md`.
- [x] Código WhatsApp preparado: webhook firmado, colas cifradas, reintentos seguros, cuota compartida, estados y mantenimiento. Pruebas sintéticas y Firestore emulado; sin activar envíos. Operación: `docs/whatsapp-cloud-api.md`.
- [ ] Enlazar el número Meta cuando el propietario lo tenga, validar recepción/entrega real y conciliación de consumo antes de ofrecer WhatsApp como disponible. Mayor volumen por cotización.

## Consumo de IA — 2026-10-15

- [x] Medición privada de llamadas y tokens DeepSeek por negocio y mes, rango estimado USD y avisos sobre cobertura incompleta; sin cuerpos de conversaciones ni cambios de proveedor.
- [x] Tipos, 314 pruebas, 13 pruebas Firestore y 75 comprobaciones del recorrido; idempotencia, permisos, fallos de telemetría y revisión visual a 320 px. Evidencia: `docs/qa/2026-10-15-ai-usage.md`.
- [x] Imagen de `59a716a` construida y activada en la instancia privada; contexto idéntico a `4c9dd26`, CI con tres jobs verdes, 22 controles posteriores y verificación autenticada del medidor. IA local conservada; lanzamiento público y WhatsApp pendientes.
- [x] Proyección de barbería para 15–50 conversaciones diarias y 6–12 respuestas, sin notificaciones proactivas; costos de Meta/DeepSeek y precio al cliente separados en `docs/whatsapp-premium-proposal.md`.

## Control administrativo — 2026-10-15

- [x] Selector global manual Ollama/DeepSeek para superadministrador, persistencia privada y Vault exclusivamente local. Gemini retirado y su clave dedicada revocada; OAuth/Firebase intactos.
- [x] Verificación: tipos, 288 pruebas, 11 pruebas con Firestore Emulator, 72 comprobaciones del recorrido y acceso por roles en Chrome. Evidencia: `docs/qa/2026-10-15-admin-ai.md`.
- [x] Imagen del commit `9a3e66f` construida y activada en la instancia privada; tres jobs CI y controles posteriores correctos. El lanzamiento público y WhatsApp Premium siguen pendientes; precio y consumo propuestos en `docs/whatsapp-premium-proposal.md`.

## Historial inicial

- [x] Auditoría inicial del documento rector, dependencias y todos los módulos existentes. Detalle: `AUDITORIA.md`.
- [x] Core: tipos, Firebase singleton, autenticación Admin, suscripción, cola FIFO priorizada y entorno de ejemplo.
- [x] Agenda: disponibilidad Colombia, buffer, reservas atómicas, bloqueos/cancelación y herramientas ejecutables.
- [x] SaaS: Google Auth, onboarding, isla, agenda realtime, QR, capturas comprimidas y revisión de suscripciones.
- [x] Sarin Vault: IndexedDB por UID, imágenes, visión→modelo principal local, cuentas, Markdown, ICS y copias cifradas/limpias.
- [x] Seguridad: reglas, proyección pública explícita, cabeceras, límites de payload y concurrencia, reintentos idempotentes y revisión independiente.
- [x] Documentación y empaquetado: README, STACK, Dockerfile y salida standalone.
- [x] Desarrollo sin proyecto Firebase: Auth + Firestore oficiales locales, cuentas aisladas, accesos por rol, guardas de producción y runner con Java 21.
- [x] Kit revisable de infraestructura: Compose, Caddy, Cloudflared y lanzador Ollama nativo para Mac, con pruebas de configuración.
- [x] Diagnóstico independiente de Firebase: `npm run doctor`, consulta de modelos y pruebas sintéticas explícitas de texto/visión.
- [x] Referencias de diseño mediante MCP oficial Mobbin autenticado; identidad de ALS DevStudio aplicada a portada, navegación, acceso, agenda y Vault.
- [x] Kit Cloudflare Containers con Worker, DO singleton, tipos generados, secretos de runtime separados, ocho pruebas y dry-run del Worker.
- [x] Imagen Docker Linux construida, iniciada en loopback con filesystem de solo lectura y comprobada por HTTP; dry-run completo de Wrangler con imagen aprobado.
- [x] Verificación de código: TypeScript, suite local, suite de emulador Firestore, npm audit y build. Resultados finales abajo.
- [ ] Configurar proyecto Firebase real, Google OAuth, credenciales Admin, UID superadmin, bancos y túnel/modelos de la Mac.
- [x] Portada temporal independiente para Pages: aviso de lanzamiento, exportación sin Firebase, 404, headers, revisión móvil y controles de artefacto. Evidencia: `docs/qa/2026-10-13-landing-temporal.md`.
- [x] Publicar y verificar la portada temporal en `sarinbotsaas.pages.dev`: producción `1d4890a`, despliegue `7f2b08d0`, HTTP 200 y headers correctos; rutas privadas HTTP 404.
- [x] Favicon propio de Sarin integrado y publicado: SVG, ICO 16/32/48, PNG 32 y Apple 180; producción `ccf5193`, despliegue `027d8f92`. Evidencia: `docs/qa/2026-10-13-favicon.md`.
- [x] Favicon sustituido por la cara de la mascota a petición del propietario: ICO 16/32/48, PNG 32/48 y Apple 180; producción `18bd4fd`, despliegue `a57cacb9`. Evidencia: `docs/qa/2026-10-13-favicon-cara-sarin.md`.
- [x] Diseño Agenda clara elegido por el propietario, aplicado y publicado: fondo claro, acento azul, agenda ilustrativa accesible y selector local; revisión responsive/seguridad aprobada. Producción `776bc81`, despliegue `42f0e736`. Evidencia: `docs/qa/2026-10-13-agenda-clara.md`.
- [x] Cara del favicon en cabecera y pie; secuencia de vuelo, aterrizaje y saludo con recursos originales de ALS, pausa y movimiento reducido. Publicación `9c4a2f8`, despliegue `ba6690e7`. Evidencia: `docs/qa/2026-10-14-sarin-vuelo-y-marca.md`.
- [x] Botón de pausa retirado por petición del propietario; entrada única de 3,8 s con saludo permanente. Publicación `345f8e7`, despliegue `40a8f9d6`. Evidencia: `docs/qa/2026-10-14-saludo-sin-boton.md`.
- [x] Recorrido continuo de cinco mensajes sobre la app, vuelo/vuelta/aterrizaje y lectura completa accesible, según nueva elección del propietario. Publicación `2234442`, despliegue `4d3627ba`. Evidencia: `docs/qa/2026-10-14-cinco-mensajes-sarin.md`.
- [x] Vuelo corregido según ALS: entrada lateral desde fuera, giro al frenar y salida por el otro borde; cinco mensajes conservados. Publicación `888773e`, despliegue `496e9e4d`. Evidencia: `docs/qa/2026-10-14-vuelo-con-desplazamiento.md`.
- [x] Contador y enlace «Leer los 5 mensajes» retirados por petición del propietario; vuelo y mensajes continuos conservados. Publicación `1097112`, verificada en Pages. Evidencia: `docs/qa/2026-10-14-saludo-sin-contador.md`.
- [x] Iconos, etiquetas «Paso 1/2/3» y rótulo «De un enlace a tu agenda» retirados según la captura del propietario. Publicación `bbd4c2e`, verificada en Pages, escritorio y móvil. Evidencia: `docs/qa/2026-10-14-seccion-sin-iconos.md`.
- [x] Agenda clara en pantallas internas: acceso, agenda, configuración, QR, facturación, administración, isla y Vault; revisión local desde 320 px. Evidencia: `docs/qa/2026-10-14-agenda-clara-interna-y-ci.md`.
- [x] Ensayo local opt-in completo: 61 comprobaciones de reservas/pagos/permisos con Auth y Firestore oficiales, limpieza limitada y cero inferencia; ocho pruebas de aislamiento.
- [x] CI real de GitHub: tres jobs verdes para tipos, pruebas, builds, reglas, recorrido local y dry-run del Worker. Commit `d761de4`, ejecución `38523876656`.
- [ ] Pruebas de aceptación con Firebase/Ollama reales y despliegue de la aplicación completa. La portada temporal ya está publicada por separado en Pages.

## Migración a pnpm verificada

- [x] App y Cloudflare en pnpm 11.23.0 con lockfile único, overrides conservados y Node 24.
- [x] Launcher, Docker, CI, Pages y documentación actualizados; ambos `package-lock.json` y sus metadatos internos de instalación npm retirados tras las verificaciones.
- [x] Instalación congelada, tipos, 153 pruebas unitarias, 7 reglas Firestore, 61 comprobaciones del recorrido, 8 pruebas Worker, builds y Docker aprobados. Cero vulnerabilidades conocidas.
- [x] Push `04d57cd` en `main`; CI `38527082839` con tres jobs verdes y Pages `07bcf4b6` publicado con pnpm. Evidencia: `docs/qa/2026-10-14-migracion-pnpm.md`.

Comandos actuales: `pnpm install --frozen-lockfile`, `pnpm run dev:local`, `pnpm run typecheck`, `pnpm test` y `pnpm --filter sarin-cloudflare-host run check`.

## Evidencia histórica anterior a pnpm

- `npm run typecheck`: pasa, sin errores.
- `npm test`: 142 pruebas aprobadas; 7 pruebas de emulador omitidas en esta invocación por no tener las variables de ese runner.
- `npm run test:rules` con Java 21: las 7 pruebas omitidas anteriormente pasan en Firestore Emulator real (2 archivos, 10,87 s en el cierre de la ampliación local).
- `npm run test:local`: pasa contra la aplicación y ambos emuladores activos. Comprueba autenticación real emulada, UID superadmin, consola, facturación, negocio y rechazo 403 del cliente en las API administrativas/Vault.
- `npm audit`: cero vulnerabilidades conocidas, incluidas dependencias de desarrollo.
- `npm run build`: pasa con Next.js 16.4.0 y salida standalone; genera `/admin/vault`, APIs y manifest.
- Humo HTTP de las siete API protegidas: todas responden 401 sin token; portada y entrada de Vault responden 200 y exigen sesión en interfaz.
- Chrome: Vault abierto con Administrador local y sesión validada por servidor; consola y formulario de onboarding renderizados con datos vacíos reales del emulador. Evidencia `docs/qa/vault-local.png`. Google OAuth real y la Mac/túnel siguen pendientes de configurar.
- `npm run doctor`: pasa sin configuración real, informa dependencias pendientes y no hace peticiones por defecto.
- Sintaxis Node/shell y estructura Compose: validaciones aprobadas; pruebas del lanzador Mac usan binarios sintéticos, sin ejecutar Ollama real.

Ampliación de diseño y hosting: ocho pruebas de Cloudflare aprobadas, TypeScript del Worker y dry-run completo con imagen aprobados. Docker Desktop se inició localmente para construir y probar la imagen, sin configurar servicios remotos. La comprobación de producción con Firebase/Ollama reales y red de Cloudflare sigue pendiente. Ninguno de estos resultados implica un despliegue de producción.
