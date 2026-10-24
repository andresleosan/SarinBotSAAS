# Sarin Bot

Última actualización publicada: **Guardar imagen de la cita** sustituye la descarga ICS del cliente por un PNG generado en su navegador. [Validación y versión](docs/qa/2026-10-16-appointment-image.md). Los resultados de ICS citados en aceptaciones anteriores son históricos.

SaaS de agenda multi-tenant para negocios de servicios: reservas, calendario e historial de clientes, asistente comercial y facturación. El documento rector es [arquitectura_maestro_sarin_bot.md](arquitectura_maestro_sarin_bot.md). Los contratos y decisiones de operación están en [STACK.md](STACK.md).

Estado de la entrega del 16 de octubre de 2026: **candidata a un piloto comercial controlado**, con DeepSeek seleccionado por decisión del propietario, D1/R2 y Google Auth activos. Antes del cambio de exportación a PNG se verificaron reservas, calendario `.ics` y cancelación mediante la interfaz pública con Ollama y DeepSeek, con los alcances distintos de cada sesión documentados en [la aceptación comercial de esa fase](docs/qa/2026-10-16-commercial-e2e.md). La aprobación de un comprobante sintético validó la prueba de 10 citas y 700 respuestas; **no acredita una transferencia ni dinero conciliado**.

Cambio de producto del 16 de octubre de 2026: **«Guardar imagen de la cita» sustituye la descarga `.ics`**. Para una cita futura confirmada, genera en el navegador un PNG con negocio, servicio, fecha y hora de Colombia y profesional o recurso asignado si corresponde, sin correo, teléfono ni respuestas del formulario. La imagen es estática: «Mis citas» conserva el estado actualizado. No añade eventos al calendario ni activa recordatorios automáticos. Los resultados `.ics` de los informes anteriores se conservan como evidencia histórica del comportamiento sustituido.

La interfaz usa **Agenda clara**, elegida por el propietario: fondo claro, superficies blancas, azul, DM Sans y el rostro de Sarin. La portada y las pantallas internas comparten esta identidad. Se consultaron referencias reales mediante el MCP oficial de Mobbin para navegación, agenda y chat; las decisiones y fuentes están en [el sistema visual](docs/design-system.md). Fuentes y mascota se sirven desde este proyecto.

## Desarrollo

Puedes desarrollar y recorrer la aplicación **sin crear un proyecto Firebase**:

Usa **Node 24 y pnpm 11.23.0**. El workspace reúne la aplicación de la raíz y `cloudflare/` con un único `pnpm-lock.yaml`; instala siempre desde la raíz:

```sh
pnpm install --frozen-lockfile
pnpm run dev:local
```

Abre `http://127.0.0.1:3030`. El comando inicia los emuladores oficiales Auth y Firestore en loopback y Next en desarrollo, con el proyecto aislado `demo-sarin-bot`. La primera ejecución descarga Firebase CLI 15.33.0 en la caché externa de pnpm; no la incorpora a las dependencias de la aplicación. Requiere Java 21+; en Windows busca un JDK Adoptium instalado si el Java predeterminado es antiguo, sin cambiar el PATH del sistema. No necesita `.env.local`, claves ni acceso a tus cuentas.

Hay tres cuentas de prueba: `admin@sarin.local`, `negocio@sarin.local` y `cliente@sarin.local`. Usa los botones **Administrador local**, **Negocio local** y **Cliente local** para iniciar sesión mediante Auth Emulator; también está disponible el popup Google emulado. La primera permite abrir `/admin`; las otras permiten comprobar los roles y la isla. La interfaz identifica el entorno local. Los negocios y cuentas son temporales y se reinician al detener los emuladores. Ctrl+C detiene los procesos de esta sesión. Puedes elegir otro puerto web con `pnpm run dev:local --port 3040`.

El navegador utiliza Firebase solo para Auth y consulta los datos mediante las API de Next. En este entorno local, el servidor conserva el backend Firestore emulado y sus pruebas de reglas; los emuladores están bloqueados en producción. No se sustituye la inferencia con respuestas simuladas. El chat necesita el proveedor de IA seleccionado disponible, mientras que formularios, agenda y pagos pueden probarse sin él. [Emuladores oficiales de autenticación](https://firebase.google.com/docs/emulator-suite/connect_auth).

Para revisar lo que ya puedes configurar sin Firebase:

```sh
pnpm run doctor
pnpm run doctor --engine
pnpm run doctor --generate
pnpm run doctor --vision
```

El diagnóstico predeterminado solo comprueba configuración, sin conexiones. `--engine` consulta el catálogo real; `--generate` y `--vision` hacen una petición sintética explícita por modelo. Carga `.env.local` si existe, no necesita Firebase y no imprime secretos, endpoints ni contenido del modelo. Usa `pnpm run doctor --help` para detalles. Las plantillas de Mac, Tunnel, Caddy y Compose están en [deploy/README.md](deploy/README.md).

Para conectar con Firebase real, copia `.env.local.example` a `.env.local` y completa la configuración real sin compartir secretos en chats ni versionarlos.

```sh
pnpm install --frozen-lockfile
pnpm run dev
```

Habilita Google como proveedor en Firebase Authentication y agrega el dominio de desarrollo/producción a Authorized domains. Configura la identidad Admin en el servidor para validar sesiones y revocación. Producción tiene activo `SARIN_DATA_BACKEND=d1` desde el 16 de octubre de 2026, con D1 como única fuente comercial y R2 privado para comprobantes. Firestore se conserva para emuladores y reversión explícita, sin fallback automático autorizado. Consulta el [procedimiento de datos](docs/cloudflare-data-migration.md) al preparar otro entorno o una reversión. `SUPERADMIN_UID` es el UID exacto de tu cuenta Firebase Auth, no tu email. No existe un login demo: si falta configuración la interfaz lo indica y los endpoints fallan de forma explícita.

### Firebase Admin sin claves descargables

Si la organización bloquea claves de servicio, el backend admite `FIREBASE_ADMIN_CREDENTIAL_MODE=adc`. El modo predeterminado sigue siendo `cert`; ADC debe seleccionarse explícitamente y no admite mezclar `FIREBASE_ADMIN_CLIENT_EMAIL` o `FIREBASE_ADMIN_PRIVATE_KEY`.

Para desarrollo con Firebase real, usa una cuenta de servicio dedicada con `roles/firebaseauth.viewer`. Añade `roles/datastore.user` solo si seleccionas el backend Firestore para ese entorno; los datos del modo D1 no pasan por Google. El operador necesita `roles/iam.serviceAccountTokenCreator` sobre esa cuenta y la API `iamcredentials.googleapis.com` habilitada. Autoriza ADC de impersonación con la CLI oficial:

```sh
gcloud auth application-default login --impersonate-service-account=CUENTA_DE_SERVICIO --project=ID_DEL_PROYECTO
```

Configura el proyecto, el modo `adc` y `GOOGLE_APPLICATION_CREDENTIALS` con la ruta privada del archivo generado en `.env.local`. Para aislarlo de otros proyectos, configura `CLOUDSDK_CONFIG` en un directorio privado antes de ejecutar la CLI. No copies ese archivo al repositorio: contiene credenciales de la identidad de origen aunque no tenga una clave de servicio. Reinicia Next al cambiar de identidad o modo. `pnpm run doctor` solo inspecciona configuración; no valida ADC ni permisos reales. [Impersonación oficial](https://docs.cloud.google.com/docs/authentication/use-service-account-impersonation).

Esta conexión local no configura la identidad del despliegue de Cloudflare. Producción requiere su propia identidad renovable y validación de Auth, además del puente privado D1/R2. Firestore requiere validación separada cuando se usa para emulación o reversión; las credenciales de un job de GitHub no sustituyen una identidad de runtime.

Para un VPS con ADC, sigue la [configuración de identidad de producción y montaje de solo lectura](deploy/README.md#firebase-admin-identidad-de-producción); no traslades ADC humano de desarrollo al servidor permanente.

En `/dashboard/billing` se compra una prueba única de **$5.000 COP**, con configuración y **10 citas**, sin vencimiento por días, o se elige directamente un plan. El administrador debe aprobar el comprobante antes de habilitar la configuración y Sarin; subirlo no concede acceso inicial preventivo. `/dashboard/onboarding` configura un negocio por propietario y conserva su enlace y consumo al editar. Cada cita creada consume un cupo; cancelar no lo devuelve. Al consumir diez, se necesita una suscripción para continuar. La agenda existente sigue disponible para consulta y cancelaciones. `/dashboard/qr-kit` descarga el QR SVG. Configura primero cuentas bancarias reales en `/admin`: el sistema no inventa números de cuenta ni simula pagos recibidos. Consulta [las condiciones de la prueba pagada y su compatibilidad](docs/paid-trial.md).

## Motor local y túnel

Para conectar otro proyecto al mismo motor, consulta [cómo reutilizar el motor local](docs/reusing-local-engine.md).

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

`/api/sarin/health` comprueba el catálogo del proveedor de chat seleccionado, con caché interna de diez segundos por proveedor. Requiere sesión y devuelve 503 si la comprobación falla. `?scope=engine` exige superadministrador y comprueba Ollama independientemente del proveedor comercial seleccionado. Las credenciales y la URL del túnel nunca se devuelven al navegador.

El superadministrador puede seleccionar **IA local (Ollama)**, **DeepSeek** o **Gemini** en `/admin` para los asistentes comerciales; ver las guías de [DeepSeek](docs/deepseek-option-b.md) y [Gemini](docs/gemini-provider.md). **DeepSeek queda seleccionado en esta entrega por elección explícita del propietario.** La selección se guarda en un documento privado del servidor y se aplica a nuevas solicitudes, sin reiniciar la aplicación. Cada turno conserva el proveedor con el que empezó. Si no existe una selección guardada, se usa `SARIN_CHAT_PROVIDER` y, en su ausencia, `ollama`. No se reintentan turnos automáticamente con otro proveedor. `doctor` continúa siendo el diagnóstico de Ollama; no valida ni consume las APIs externas. El acceso con Google y Firebase se conserva. El backend de copiloto no se ofrece como función con interfaz disponible.

Las solicitudes comerciales se atienden mediante una cola FIFO acotada. El debounce de 2.5 segundos agrupa ráfagas y serializa turnos. Las cuotas del negocio se aplican en el servidor.

## Alcance comercial

El producto se centra en negocios, reservas, agenda e historial de clientes, configuración, pagos y el asistente de cada negocio. El chat personal y Sarin Vault quedan retirados del alcance activo. Las capturas y los informes anteriores que los mencionan son evidencia histórica, no guías de uso vigentes.

La información de [privacidad](https://sarinbotsaas.pages.dev/privacidad) y [ayuda](https://sarinbotsaas.pages.dev/ayuda) describe datos, proveedores y operación actuales. El contacto confirmado es Andrés Santiago, `alsdevstudio@alsdevstudio.com`. Los comprobantes se revisan manualmente en la bandeja administrativa, sin avisos automáticos por correo. WhatsApp continúa deshabilitado y el [marketplace es solo un análisis](docs/qa/2026-10-16-fresha-analysis.md); la pantalla del negocio exige Google antes de mostrar su perfil.

Retirar el módulo no borra automáticamente los datos que versiones anteriores hayan guardado en el navegador de cada usuario. Esa eliminación requiere una acción explícita en el dispositivo correspondiente; no se accede ni se transfieren esos contenidos durante este cambio.

## Verificación

```sh
pnpm run typecheck
pnpm test
pnpm run test:rules
pnpm run test:local
pnpm run test:journey
pnpm audit
pnpm run build
```

`test:rules` necesita Java 21+ seleccionado por `JAVA_HOME`. Descarga el emulador oficial Firestore 1.22.0 a la caché del usuario, verifica SHA-256 y usa solo proyectos `demo-*` y datos sintéticos. Prueba el backend Firestore conservado, con reglas de aislamiento y carreras reales de reserva/aprobación. Las integraciones del emulador se omiten en `pnpm test` cuando no está activo y se ejecutan con `test:rules`; no necesitan credenciales reales. La verificación de esta entrega registra **679 pruebas de aplicación aprobadas y 20 integraciones omitidas**, **68 del Worker** y **25 del gateway**. El recorrido local de **96 comprobaciones** y los E2E públicos se registran por separado; no se suman como si fueran una misma suite. Ver [aceptación comercial vigente](docs/qa/2026-10-16-commercial-e2e.md) y [aceptación histórica del corte de datos](docs/qa/2026-10-16-cloudflare-data-migration.md).

`test:local` requiere `dev:local` activo. Comprueba el recorrido real Auth Emulator → APIs Next → Admin SDK → Firestore, el UID superadmin y el rechazo 403 del cliente en administración. No crea negocios ni pagos y no ejecuta inferencia. Usa `pnpm run test:local --port 3040` si elegiste otro puerto web; `test:journey` admite la misma opción sin un separador `--` adicional.

`test:journey` también requiere `dev:local` activo. Ejecuta el recorrido completo con cuentas y datos sintéticos aislados de cada corrida; prueba reservas, colisiones, cancelaciones, bloqueos y revisión de comprobantes. Usa las implementaciones reales sobre los emuladores y limpia únicamente sus propios datos. No envía conversaciones ni necesita Ollama: las reservas se ejercitan mediante la función real. La conversación con los proveedores se comprobó por separado en el E2E público.

El workflow [Verify Sarin](.github/workflows/verify.yml) ejecuta tipos, pruebas, builds, reglas Firestore, recorrido local y dry-run del Worker en cada push a `main` y cada PR. Usa Node 24, pnpm 11.23.0, Java 21, instalación con lockfile congelado, permisos de lectura y acciones oficiales fijadas por SHA. Los jobs de verificación no usan credenciales de producción. Tras pasar los tres, los pushes a `main` publican Worker/Container y después Pages desde el mismo commit; los PR no despliegan. La configuración inicial, las credenciales y la recuperación están en [el flujo de producción desde main](docs/main-cloudflare-release.md).

## Producción

El origen público es `https://sarinbotsaas.pages.dev/`. Pages usa el service binding privado `SARIN_APP_HOST` hacia el Worker de Cloudflare Containers; `pnpm run build:pages` prepara ese gateway. La infraestructura se aceptó el 16 de octubre de 2026 y el runtime Sarin de la VPS quedó detenido con sus archivos conservados. La exportación estática independiente continúa disponible con `build:landing`. Consulta [el kit Cloudflare](cloudflare/README.md), [la evidencia de infraestructura](docs/qa/2026-10-16-cloudflare-migration.md) y [la auditoría de preparación](docs/qa/2026-10-16-production-readiness.md).

La aplicación usa **Cloudflare Containers**, conservando **Node 24 en una sola réplica**. El Worker frontal y el Durable Object con nombre constante envían todas las peticiones al mismo proceso y a la misma cola de inferencias. El corte D1/R2 quedó **activado y aceptado el 16 de octubre de 2026**: se importaron y verificaron por hash 19 de 19 documentos, sin archivos de comprobante, con revisión inicial 0. D1 es la única fuente comercial y Firebase Admin continúa en Node nativo únicamente para Auth. Se comprobaron sesión, lecturas administrativas, proyección pública, agenda y descarga `.ics` sobre el runtime nuevo. Consulta la [evidencia del corte](docs/qa/2026-10-16-cloudflare-data-migration.md) y el [runbook de datos](docs/cloudflare-data-migration.md). El repositorio de origen es [andresleosan/SarinBotSAAS](https://github.com/andresleosan/SarinBotSAAS).

GitHub Actions coordina la publicación completa desde `main`; no conectar un segundo autodeploy de Workers Builds ni mantener el build Git independiente de Pages una vez activado este flujo. Las cuatro variables públicas Firebase se usan durante el build; los secretos de runtime permanecen en Cloudflare. Workers Paid está confirmado; Auth, los bindings privados de datos y el túnel del motor tienen aceptación independiente. El objetivo de gasto es USD 15/mes; el [cálculo de alojamiento](docs/cloudflare-no-vps-runbook.md#presupuesto-operativo) estima USD 11,93 por 30 días completos antes de CPU adicional y demás consumos. Hay alertas Cloudflare de USD 5 y USD 8 y una alerta DeepSeek de saldo de USD 2, verificadas en esta entrega. Avisan; **no garantizan un corte automático de gasto de USD 15**. Se deben medir D1/R2, inferencia y demás consumos junto con Containers.

El Worker enruta al contenedor y atiende sus puentes privados de identidad y datos. Next consulta D1/R2 por `http://sarin-data.internal/execute`, autorizado solo para la instancia Sarin; el navegador no recibe SQL ni credenciales del bucket. La aplicación Next no se ejecuta como función Workers ni como exportación estática de Pages. El kit [tradicional de servidor y Caddy](deploy/README.md) se conserva para reversión; su indicación **DNS only** aplica a ese camino, no al dominio del Worker de Containers.

El navegador usa Firebase solo para iniciar sesión. Negocio, agenda e historial se consultan con el ID token mediante API y refresco de 15 segundos tras cada lectura; se pausa en pestañas ocultas, se reanuda al recuperar foco y aborta/descarta respuestas al cambiar UID o negocio. La isla pública solo recibe la proyección `publicBusinesses` mediante `/api/public/businesses/[slug]`, sin datos privados del propietario. Las citas siguen visibles cuando la IA está pausada.

Usa **un proceso Node de larga vida y una sola réplica** para la aplicación. No ejecutes la cola en funciones aisladas, PM2 cluster ni múltiples contenedores: cada proceso tendría su propio contador. Para varias réplicas hace falta mover la cola a un coordinador compartido. Configura HTTPS, límites de carga acordes con los comprobantes admitidos y timeouts suficientes para espera en cola e inferencias locales. No reintentes automáticamente POST en el proxy. Reinicios y despliegues pueden interrumpir solicitudes en curso; no hay persistencia de la cola.

Para el backend Firestore conservado, despliega `firestore.rules` y `firestore.indexes.json` en el **proyecto correcto** con Firebase CLI oficial, por separado del runtime. No es un paso del backend D1:

```sh
firebase deploy --project TU_PROYECTO --only firestore:rules,firestore:indexes
```

Antes de devolver tráfico al backend Firestore, verifica que los seis índices compuestos del [manifiesto](firestore.indexes.json) estén en estado `READY` y que la exención de `paymentImages.receiptDataUrl` esté aplicada. Las reglas se conservan para ese backend; las API autorizan los accesos de aplicación en ambos modos. El Superadmin lee datos globales exclusivamente mediante API protegidas; no existe una bandera editable que conceda privilegios.

Para despliegue tradicional: configura `.env.local` en el servidor antes de `pnpm run build` (las cuatro variables `NEXT_PUBLIC_FIREBASE_*` se incorporan durante el build) y ejecuta `pnpm start`. También se incluye Dockerfile con salida standalone; pasa las cuatro variables públicas como build args y las credenciales servidor solamente como entorno del contenedor. No incluyas `.env.local` en la imagen. [Salida standalone de Next](https://nextjs.org/docs/app/api-reference/config/next-config-js/output).

La [aceptación comercial previa al cambio PNG](docs/qa/2026-10-16-commercial-e2e.md) supera la comprobación de catálogo de las fases anteriores: Ollama completó el recorrido con un cliente externo y DeepSeek completó reserva, `.ics` y cancelación desde una sesión del propietario en la interfaz pública. En el segundo caso, compartir el UID del negocio explica el estado «cancelada por el negocio»; no se presenta como otra prueba de cliente distinto. La prueba manual de comprobante fue sintética, sin transferencia de dinero. El resultado permite plantear un **piloto comercial controlado**, manteniendo pendientes la conciliación bancaria real, la política formal de conservación y las condiciones de devolución. Las fuentes publicadas tienen una copia privada de 123 archivos; siguen sin integrarse en un commit de Git. La evidencia anterior de Vault y los conteos previos se conservan como historia, no como alcance vigente.

## Datos y reversión

El contrato documental conserva rutas como `businesses/{id}`, `businessSlugs/{slug}`, `publicBusinesses/{slug}`, `businesses/{id}/appointments`, `businesses/{id}/bookingLocks`, `paymentReceipts`, `paymentImages`, `users` y `platformSettings/main`. En modo D1, una interfaz propia guarda cada entidad por su ruta estable, sin SDK Firestore en esa ruta. Una revisión global y un batch atómico validan las transacciones; un conflicto vuelve a ejecutar su callback. Los UUID de commit permiten resolver respuestas perdidas sin duplicar efectos. Los locks por recurso/día y los controles de cuota conservan sus invariantes de reserva y pago.

Las imágenes de pago se suben primero a R2 privado con clave de hash y luego se referencian desde D1. Los listados nunca incluyen Base64 y la lectura individual recupera la imagen bajo demanda. D1/R2 no comparten una transacción: un fallo puede dejar un objeto privado sin referencia, pero no un registro confirmado pendiente de subir su imagen. No se eliminan blobs automáticamente. La gracia preventiva se consume una sola vez por período y el rechazo la revoca sin reiniciarla. Una aprobación concurrente del mismo recibo no suma dos mensualidades.

No hay migración destructiva ni fallback Firestore automático. El [corte D1/R2](docs/cloudflare-data-migration.md) exige mantenimiento, drain del proceso que sirve tráfico, detener todos los escritores anteriores, copia privada recursiva y correspondencia completa de documentos/archivos antes de activar D1. Firestore se conserva como copia de reversión, sin nuevas escrituras de aplicación después del corte. Si D1 recibió escrituras, volver requiere exportar y reconciliar esos cambios con precondiciones antes de restaurar Firestore; cambiar solo el flag perdería datos. Conserva imágenes/builds y ambas copias. Si existe una base antigua con `tenants` o estados `trialing`, diseña su migración explícita antes de conectarla.

Las suscripciones pagadas se evalúan por fecha; la prueba pagada se evalúa por su activación aprobada y su contador de citas, sin cron. Los registros históricos de prueba gratuita no conceden acceso con esta versión.

Los listados administrativos están limitados a 500 registros por consulta; se requiere paginación antes de superar ese volumen. El puente de datos admite como máximo 1.000 documentos por lectura y devuelve `413 DATA_LIMIT` al excederlos, sin truncar silenciosamente. El historial del cliente filtra UID y negocio en el servidor. «Guardar imagen de la cita» entrega un PNG generado en el navegador para citas futuras confirmadas; es una copia estática y los cambios se consultan en «Mis citas». Se conservan enlaces WhatsApp operados por el usuario, sin recordatorios automáticos ni promesa de envío de correos. Añadir email requiere definir proveedor, credenciales y política de envío explícitamente.
