# Auditoría Sarin Bot — 2026-10-13

## Estado inicial

Las rutas operativas existían como prototipos visuales. Ningún flujo UI persistía negocio, reserva o pago. El chat ignoraba `tenantId`, aceptaba `tenantOverride`, carecía de autenticación y retornaba simulaciones con HTTP 200 ante fallos. Firebase cliente usaba claves demo; Admin podía quedar en null. La cola no tenía prioridad ni protección ante configuración inválida. No existían reglas ni Sarin Vault.

## Correcciones implementadas

- `Business`/`PaymentReceipt` canónicos y aliases compatibles; estados de suscripción requeridos y final de ocupación distinto al final del servicio.
- Singleton Firebase diferido, Admin solo servidor, Bearer con revocación y autorización exclusiva por UID de entorno. Sin Firebase Storage.
- Cola con prioridad FIFO, máximo cuatro slots, espera/cancelación, límites de memoria y un puesto VIP reservado. Un turno pendiente/en curso por UID.
- Disponibilidad en Colombia, validación estricta, buffers y transacciones con lock por recurso/día. Idempotencia por turno, resistente a argumentos LLM diferentes en el reintento.
- Prueba única de siete días por propietario, gracia limitada de 24 horas y revisión transaccional de treinta días. Capturas separadas de los documentos consultados por listas.
- Google Auth, agenda en vivo, isla privada con expiración recalculada, agrupación y serialización del chat, configuración por formulario/herramienta, QR descargable, facturación y consola administrativa reales.
- Vault local por UID en IndexedDB, imágenes, estados de cuenta, análisis por moneda y recordatorios ICS. Pipeline visión→modelo principal local, importación atómica y copias limpias/cifradas. Sin contenido personal en Firestore ni logs.
- Reglas denegando escrituras del navegador, proyecciones públicas explícitas, índices y empaquetado standalone/Docker. Dependencias actualizadas; CLI de despliegue separada del runtime.

## Seguridad y privacidad

La revisión independiente encontró y corrigió el rechazo de Vault cuando la cola normal estaba llena. La revisión de herramientas corrigió una duplicación posible cuando un reintento del mismo turno producía otra hora. Se corrigió la importación de hilos superiores al límite y la recuperación de conexiones IndexedDB bloqueadas. La UI de onboarding solo informa guardado si la herramienta devuelve el negocio persistido.

Las reglas no usan una bandera de perfil para otorgar privilegios globales: el Superadmin opera mediante APIs con Admin SDK y comprobación estricta de `SUPERADMIN_UID`. No se imprimieron ni solicitaron secretos reales. La búsqueda de `any`, datos demo y marcadores de implementación en `src/` no encontró placeholders operativos.

## Verificación

La evidencia final se registra en `tasks.md`. La suite local incluye pruebas de concurrencia, disponibilidad, suscripción, pagos, validación, autorización, debounce, sesión, motor, calendarios, IndexedDB y cifrado. El runner del emulador prueba aislamiento real y carreras de reservas/aprobaciones sin proyecto Firebase de producción. Se verificó en Chrome la portada y que `/admin/vault` exige login y muestra el diagnóstico de Firebase ausente.

Medición local de humo con `Invoke-WebRequest` sobre `next start`: portada HTTP 200 en 321 ms (primera petición medida, 18.551 bytes HTML), entrada protegida de Vault HTTP 200 en 20 ms (7.779 bytes HTML). Estos números no son Core Web Vitals ni latencias de inferencia. Las siete rutas API principales respondieron 401 sin Bearer, incluyendo Vault. No se aplicaron optimizaciones especulativas a partir de esta muestra.

## Límites pendientes de configuración externa

La ampliación solicitada para continuar sin el proyecto cloud agrega `dev:local`, accesos de prueba mediante Auth Emulator y `doctor`. Se verificó el recorrido completo de autenticación → API Next → Admin SDK → Firestore local y que el cliente reciba 403 en las API admin/Vault. Los emuladores se rechazan en producción, exigen proyectos `demo-*`, direcciones loopback y configuración cliente/servidor consistente. Los puertos 3030, 8080, 9099, 4400, 4500 y 9150 se comprobaron escuchando exclusivamente en `127.0.0.1`.

Se verificó Vault en Chrome con la cuenta local administradora y el estado de motor offline, además de la consola y el formulario de negocio. La captura está en `docs/qa/vault-local.png`. La suite actual suma 142 pruebas locales y 7 pruebas del emulador aprobadas. TypeScript, build y auditoría npm pasan. Compose y la sintaxis del lanzador Mac se validaron; las configuraciones Caddy/Cloudflared aún requieren sus binarios reales y valores externos.

No existe `.env.local` real en el proyecto y no se ha indicado el proyecto Firebase. El usuario eligió Cloudflare como hosting, además del dominio/túnel. No se ha probado Google OAuth real ni inferencia sobre la Mac real y no se ha desplegado a producción. No se editaron recursos Firebase, Cloudflare u Ollama externos.

Se inició Docker Desktop y se construyó la imagen Linux, además de verificar Next.js y su salida standalone. Se probó en loopback con filesystem de solo lectura: páginas e imágenes 200, APIs sin sesión 401. El dry-run completo de Wrangler construyó la imagen sin publicar recursos. El kit Cloudflare añade ocho pruebas aprobadas, Worker con streaming sin replay y un DO singleton para conservar la cola de un proceso. La revisión independiente confirmó preservación de Host/Origin/Bearer y denegación 403 sin repetir POST. Configuración y costes están en `cloudflare/README.md`.

La referencia visual elegida es ALS DevStudio. Se consultaron pantallas reales de Square, Unify, Gumloop y Calendly mediante el MCP oficial Mobbin, conectado con OAuth; su configuración local y las credenciales no forman parte del repositorio. Portada, navegación, acceso, agenda y Vault se adaptaron a marino/menta, fuentes autoalojadas y mascota del propietario. La evidencia responsive y de interacción está en `docs/qa/2026-10-13-design-review.md`.

La cola exige un único proceso/réplica y pierde solicitudes pendientes al reiniciar. IndexedDB permanece legible en el perfil local; AES-GCM protege las exportaciones cifradas. El hosting/proxy no debe registrar cuerpos ni capturar sesiones Vault. Los listados globales admiten hasta 500 registros por consulta. El correo del blueprint requiere definir proveedor y no se envía; los recordatorios actuales son archivos `.ics` que el usuario importa.
