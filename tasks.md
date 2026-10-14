# Estado de implementación — 2026-10-13

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
- [ ] Publicar y verificar la portada temporal en `sarinbotsaas.pages.dev`.
- [ ] Pruebas de aceptación con Firebase/Ollama reales y despliegue en servidor/dominio indicado por el usuario. No se ha aplicado ningún cambio externo.

## Evidencia final

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
