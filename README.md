# Sarin Bot

Core SaaS de agenda multi-tenant y Sarin Vault personal. El documento rector es [arquitectura_maestro_sarin_bot.md](arquitectura_maestro_sarin_bot.md). Los contratos y decisiones de operación están en [STACK.md](STACK.md).

La interfaz sigue la identidad de ALS DevStudio: marino, menta, Space Grotesk, DM Sans y la mascota de Sarin. Se consultaron referencias reales mediante el MCP oficial de Mobbin para navegación, agenda y chat; las decisiones y fuentes están en [el sistema visual](docs/design-system.md). Fuentes y mascota se sirven desde este proyecto.

## Desarrollo

Puedes desarrollar y recorrer la aplicación **sin crear un proyecto Firebase**:

```sh
npm run dev:local
```

Abre `http://127.0.0.1:3030`. El comando inicia los emuladores oficiales Auth y Firestore en loopback y Next en desarrollo, con el proyecto aislado `demo-sarin-bot`. La primera ejecución descarga Firebase CLI 15.33.0 en la caché externa de npm; no la incorpora a las dependencias de la aplicación. Requiere Node 24 y Java 21+; en Windows busca un JDK Adoptium instalado si el Java predeterminado es antiguo, sin cambiar el PATH del sistema. No necesita `.env.local`, claves ni acceso a tus cuentas.

Hay tres cuentas de prueba: `admin@sarin.local`, `negocio@sarin.local` y `cliente@sarin.local`. Usa los botones **Administrador local**, **Negocio local** y **Cliente local** para iniciar sesión mediante Auth Emulator; también está disponible el popup Google emulado. La primera permite abrir `/admin/vault` y `/admin`; las otras permiten comprobar los roles y la isla. La interfaz identifica el entorno local. Los negocios y cuentas son temporales y se reinician al detener los emuladores; Vault conserva su IndexedDB en ese navegador. **Exporta una copia de Vault antes de pasar al UID o dominio real**, ya que cada uno tiene su propio almacenamiento. Ctrl+C detiene los procesos de esta sesión. Puedes elegir otro puerto web con `npm run dev:local -- --port 3040`.

La conexión local utiliza los SDK de Firebase y las reglas reales; el modo está bloqueado en producción y no sustituye la inferencia con respuestas simuladas. El chat necesita Ollama disponible, mientras que formularios, agenda, pagos y almacenamiento de Vault pueden probarse sin él. [Emuladores oficiales de autenticación](https://firebase.google.com/docs/emulator-suite/connect_auth).

Para revisar lo que ya puedes configurar sin Firebase:

```sh
npm run doctor
npm run doctor -- --engine
npm run doctor -- --generate
npm run doctor -- --vision
```

El diagnóstico predeterminado solo comprueba configuración, sin conexiones. `--engine` consulta el catálogo real; `--generate` y `--vision` hacen una petición sintética explícita por modelo. Carga `.env.local` si existe, no necesita Firebase y no imprime secretos, endpoints ni contenido del modelo. Usa `npm run doctor -- --help` para detalles. Las plantillas de Mac, Tunnel, Caddy y Compose están en [deploy/README.md](deploy/README.md).

Para conectar con Firebase real, copia `.env.local.example` a `.env.local` y completa la configuración real sin compartir secretos en chats ni versionarlos.

```sh
npm ci
npm run dev
```

Habilita Google como proveedor en Firebase Authentication y agrega el dominio de desarrollo/producción a Authorized domains. Crea Firestore y configura la cuenta de servicio Admin en el servidor. `SUPERADMIN_UID` es el UID exacto de tu cuenta Firebase Auth, no tu email. No existe un login demo: si falta configuración la interfaz lo indica y los endpoints fallan de forma explícita.

En `/dashboard/onboarding` se configura un negocio por propietario, con prueba única de siete días; editar conserva sus fechas y enlace. `/dashboard` muestra citas en vivo, bloqueos y cancelaciones, `/dashboard/qr-kit` descarga el QR SVG y `/dashboard/billing` permite subir el comprobante. Configura primero cuentas bancarias reales en `/admin`: el sistema no inventa números de cuenta ni simula pagos recibidos.

## Motor local y túnel

Usa la API OpenAI-compatible **de tu propia Mac** y los modelos descargados. Ejemplo de entorno Ollama en la Mac:

```sh
export OLLAMA_NO_CLOUD=1
export OLLAMA_NUM_PARALLEL=4
export OLLAMA_MAX_LOADED_MODELS=1
export OLLAMA_KEEP_ALIVE=-1
export OLLAMA_FLASH_ATTENTION=1
export OLLAMA_KV_CACHE_TYPE=q8_0
```

Configura `OLLAMA_MAIN_MODEL`, `OLLAMA_VISION_MODEL` y `SARIN_TUNNEL_URL` en Next. Para un hostname remoto se exige HTTPS, `CF_ACCESS_CLIENT_ID` y `CF_ACCESS_CLIENT_SECRET`. Configura una aplicación Cloudflare Access con política **Service Auth** que acepte ese service token; no publiques Ollama directamente ni uses una política Bypass. Loopback permite HTTP para desarrollo. No se usa el servicio cloud de Ollama. [API local oficial](https://docs.ollama.com/api/openai-compatibility), [configuración de Ollama](https://docs.ollama.com/faq), [service tokens de Cloudflare](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/).

`/api/sarin/health` comprueba realmente `/v1/models`, el modelo principal y la visión, con caché interna de diez segundos. Requiere sesión y devuelve 503 cuando el motor/túnel no responde. Las credenciales y la URL del túnel nunca se devuelven al navegador. La visión primero transcribe localmente sin herramientas; el modelo principal interpreta esos datos y devuelve análisis estructurado.

La prioridad es FIFO dentro de `NORMAL` y `CRITICAL`. Vault dispone de un puesto de espera reservado aun cuando la cola normal esté llena y usa el próximo slot libre, sin interrumpir inferencias activas. Se admite una consulta pendiente/en curso por UID, sin cuota diaria. El debounce de 2.5 segundos agrupa ráfagas y serializa turnos.

## Sarin Vault

Accede a `/admin/vault` con el UID configurado. Los hilos, imágenes comprimidas, movimientos y vencimientos viven exclusivamente en IndexedDB del perfil y dominio actuales. Ningún contenido de Vault se escribe en Firestore, Firebase Storage, logs ni localStorage. El backend procesa las peticiones transitoriamente y usa `no-store`. Configura también tus proxies/APM sin registro de cuerpos, capturas ni replay de sesiones en esta ruta.

Las copias JSON pueden ser limpias o cifradas con AES-GCM y PBKDF2-SHA256; la importación valida todo antes de añadir hilos nuevos en una transacción. Una contraseña incorrecta o un fallo de almacenamiento no modifica los datos existentes. IndexedDB **no está cifrado en reposo por la aplicación**; la exportación cifrada protege el archivo de copia. Borrar datos del navegador elimina la bóveda; cambiar de dominio/perfil no la transfiere. Exporta antes de hacerlo.

Límites explícitos: imágenes hasta 150 KiB después de compresión, cuatro por turno, 10 MiB por hilo, 50 MiB por bóveda y 200 hilos. Los recordatorios `.ics` deben importarse al calendario: no hay avisos automáticos enviados por la plataforma. Los importes estructurados se suman determinísticamente por moneda; confirma lecturas ambiguas de facturas antes de usarlas.

## Verificación

```sh
npm run typecheck
npm test
npm run test:rules
npm run test:local
npm audit
npm run build
```

`test:rules` necesita Java 21+ seleccionado por `JAVA_HOME`. Descarga el emulador oficial Firestore 1.22.0 a la caché del usuario, verifica SHA-256 y usa solo proyectos `demo-*` y datos sintéticos. Prueba reglas de aislamiento y carreras reales de reserva/aprobación. Las siete pruebas del emulador se omiten en `npm test` cuando no está activo y se ejecutan con `test:rules`; no necesitan credenciales reales.

`test:local` requiere `dev:local` activo. Comprueba el recorrido real Auth Emulator → APIs Next → Admin SDK → Firestore, el UID superadmin y el rechazo 403 del cliente en administración y Vault. No crea negocios ni pagos, no modifica la bóveda y no ejecuta inferencia. Admite `--port` si elegiste otro puerto web.

## Producción

El destino solicitado es **Cloudflare Containers**, conservando **Node 24 en una sola réplica**. El [kit Cloudflare](cloudflare/README.md) incluye Worker frontal, contenedor y un Durable Object con nombre constante: todas las peticiones comparten el mismo proceso y la misma cola de inferencias. Firebase Admin continúa en Node nativo. El repositorio de origen es [andresleosan/SarinBotSAAS](https://github.com/andresleosan/SarinBotSAAS).

En Workers Builds, conecta GitHub con raíz de build en el repositorio, instalación `npm --prefix cloudflare ci`, build `npm --prefix cloudflare run configure:build` y deploy `cd cloudflare && npx wrangler deploy --config wrangler.build.json`. La guía detalla las cuatro variables públicas de build y los secretos de runtime separados. Hace falta plan Workers Paid, configuración Firebase real, túnel operativo y dominio antes de habilitar tráfico. Este repositorio prepara la configuración; subir código no activa ni contrata esos recursos.

El Worker solo enruta al contenedor. La aplicación Next no se ejecuta como función Workers ni como exportación estática de Pages. El kit [tradicional de servidor y Caddy](deploy/README.md) sigue disponible como alternativa; su indicación **DNS only** aplica a ese camino, no al dominio del Worker de Containers.

Usa **un proceso Node de larga vida y una sola réplica** para la aplicación. No ejecutes la cola en funciones aisladas, PM2 cluster ni múltiples contenedores: cada proceso tendría su propio contador. Para varias réplicas hace falta mover la cola a un coordinador compartido. Configura HTTPS, límites del proxy de al menos 2 MiB para Vault y timeouts suficientes para espera en cola e inferencias locales. No reintentes automáticamente POST en el proxy. Con un solo slot la inferencia VIP es el turno siguiente a la actual; con cuatro slots espera al primero que se libere. Reinicios y despliegues pueden interrumpir solicitudes en curso; no hay persistencia de la cola.

Despliega `firestore.rules` y `firestore.indexes.json` en el **proyecto correcto** con Firebase CLI oficial, por separado del runtime:

```sh
firebase deploy --project TU_PROYECTO --only firestore:rules,firestore:indexes
```

Espera que los índices estén listos antes de habilitar tráfico. Las reglas permiten proyecciones de islas a usuarios autenticados y datos privados solo a sus dueños/clientes. El Superadmin lee los datos globales exclusivamente mediante las API protegidas con Admin SDK; no existe una bandera editable que conceda privilegios en Firestore.

Para despliegue tradicional: configura `.env.local` en el servidor antes de `npm run build` (las cuatro variables `NEXT_PUBLIC_FIREBASE_*` se incorporan durante el build) y ejecuta `npm start`. También se incluye Dockerfile con salida standalone; pasa las cuatro variables públicas como build args y las credenciales servidor solamente como entorno del contenedor. No incluyas `.env.local` en la imagen. [Salida standalone de Next](https://nextjs.org/docs/app/api-reference/config/next-config-js/output).

Antes de abrir producción, verifica una cuenta propietaria, otra cliente y el UID administrador en Firebase real; prueba una cita y un recibo propios, comprueba estado offline deteniendo Ollama, y prueba exportar/reimportar Vault. Configura presupuestos/alertas del proyecto y revisa los avisos de seguridad de Next/Firebase vigentes en la fecha del despliegue. No se han creado proyectos externos ni aplicado cambios a datos reales durante la implementación.

## Datos y reversión

Colecciones: `businesses/{id}`, `businessSlugs/{slug}`, `publicBusinesses/{slug}`, `businesses/{id}/appointments`, `businesses/{id}/bookingLocks`, `paymentReceipts`, `paymentImages`, `users` y `platformSettings/main`. Los locks por recurso/día se actualizan en cada mutación de agenda para impedir reservas simultáneas sobre una consulta vacía. Las imágenes de pago se leen bajo demanda en una consulta separada; los listados nunca incluyen Base64. La gracia preventiva se consume una sola vez por período y el rechazo la revoca sin reiniciarla. Una aprobación concurrente del mismo recibo no suma dos mensualidades.

No hay migración destructiva automática. Si existe una base antigua con `tenants` o estados `trialing`, exporta y verifica un backup primero y diseña una migración explícita antes de conectar esta versión. Para revertir un despliegue conserva la imagen/build y las reglas/índices anteriores; vuelve a desplegarlos sin borrar colecciones. No cambies el origen público sin exportar primero la bóveda de cada dispositivo. El estado de suscripción se evalúa por fecha en servidor y cliente aunque la etiqueta `trial`/`active` todavía no se haya actualizado; no depende de un cron.

Los listados administrativos están limitados a 500 registros por consulta; se requiere paginación antes de superar ese volumen. La referencia a notificaciones por correo del blueprint no configura un proveedor de email. Esta versión entrega `.ics` y enlaces WhatsApp operados por el usuario; no promete enviar correos. Añadir email requiere definir proveedor, credenciales y política de envío explícitamente.
