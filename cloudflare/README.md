# Hospedar la aplicación en Cloudflare Containers

Este kit conserva el Dockerfile Node 24 de la raíz y Firebase Admin nativo. Añade un Worker frontal y un Durable Object de identidad constante que dirige **todas** las solicitudes al mismo contenedor. No usa OpenNext, Pages Functions ni la política beta `durable_object`: la política `default` permite fijar `basic` y `max_instances: 1`. No se ha desplegado, conectado una cuenta ni habilitado un dominio.

## Revisar sin cuentas ni secretos

Desde la raíz del workspace, con Node 24 y pnpm 11.23.0. La aplicación y este paquete comparten el lockfile de la raíz:

```sh
pnpm install --frozen-lockfile
pnpm --filter sarin-cloudflare-host types
pnpm --filter sarin-cloudflare-host check
pnpm audit
```

`check` ejecuta pruebas, TypeScript y el dry-run **del Worker** con `--containers-rollout=none`. Valida configuración y bundle sin publicar recursos. No valida la imagen. `pnpm --filter sarin-cloudflare-host dry-run` también construye la imagen y necesita Docker CLI y su motor activos, incluso con `--dry-run`. Se verificó ese ensayo completo en Docker Linux local; además se arrancó la imagen standalone con usuario sin privilegios, filesystem de solo lectura y cachés temporales. Portada, Vault e imágenes responden 200; las API rechazan solicitudes sin sesión con 401. La prueba usa build sin credenciales reales: no valida conexiones Firebase/Ollama ni comportamiento de la red de Cloudflare. Los tipos de `worker-configuration.d.ts` los genera Wrangler; no se editan manualmente. [Despliegue](https://developers.cloudflare.com/containers/guides/deploy/) y [desarrollo local](https://developers.cloudflare.com/containers/guides/local-dev/).

## Preparar el build público

El fichero versionado `wrangler.jsonc` deja vacíos los cuatro argumentos públicos Firebase. `configure:build` exige sus valores y genera `wrangler.build.json`, ignorado por Git. No lee archivos de secretos ni incluye credenciales Admin, tokens Cloudflare o variables arbitrarias.

Para preparar únicamente esa configuración usando una copia local de `deploy/firebase.public.env.example`, desde la raíz del workspace. `--filter` ejecuta el comando dentro de `cloudflare/`, por eso el archivo de entorno usa `../deploy/`:

```sh
pnpm --filter sarin-cloudflare-host exec node --env-file=../deploy/firebase.public.env scripts/configure-build.mjs
```

El script acepta exclusivamente `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID` y `NEXT_PUBLIC_FIREBASE_APP_ID`. Rechaza proyectos `demo-*` y modo emulador. El Dockerfile existente ya declara esos cuatro `ARG`; los `image_vars` de Wrangler los transmiten como argumentos de Docker, sin introducir secretos de runtime. [Configuración de imágenes](https://developers.cloudflare.com/workers/wrangler/configuration/#containers).

## Runtime y privacidad

Configura fuera de Git los valores de `deploy/runtime.env.example` como variables/secretos del Worker. Los obligatorios son las tres credenciales Firebase Admin, `SUPERADMIN_UID`, URL HTTPS privada del motor, los dos modelos locales y las dos credenciales de Access. La clave PEM puede contener saltos reales o `\n` literales. El DO pasa únicamente una lista explícita de parámetros del servidor al entorno del contenedor; fija producción y puerto 3000 y rechaza cualquier variable de emuladores. El Worker devuelve 503 de forma cerrada si faltan los obligatorios.

El contenedor requiere salida a Internet para Firebase Auth, Firestore gRPC/TLS y el túnel. Se conserva `enableInternet = true` sin interceptar HTTPS ni instalar una CA adicional; hay que comprobar estas conexiones en el despliegue real. El motor de inferencia continúa en la Mac, protegido por Access. [Variables y secretos](https://developers.cloudflare.com/containers/examples/env-vars-and-secrets/) y [salida de red](https://developers.cloudflare.com/containers/configuration/outbound-traffic/).

El wrapper no lee, copia, registra ni guarda cuerpos, tokens o conversaciones. Devuelve el stream original y `no-store`, desactiva logs/trazas y elimina la cabecera pública que permitiría elegir otro puerto del contenedor. El SDK usa SQLite del DO para metadatos de su ciclo de vida; no se le entregan prompts para almacenamiento. No se incorporan KV, R2, colas de trabajos, snapshots ni replay. Vault sigue en IndexedDB. Su contenido transita por Cloudflare y memoria de Node; esta arquitectura garantiza ausencia de persistencia por la aplicación, no ausencia de procesamiento transitorio en infraestructura cloud.

## Reintentos, reinicios y prioridad

El proxy del Worker llama una sola vez a `fetch`, preserva errores HTTP y no reenvía un POST fallido. Se revisó el código instalado de `@cloudflare/containers` **0.3.7**: el arranque comprueba/reintenta disponibilidad de instancia y puerto, y su proxy efectúa una llamada HTTP al proceso. La versión queda fijada. Antes de actualizar el SDK, vuelve a revisar si introduce replay de solicitudes inseguras; no supongas semántica de exactamente una ejecución en toda la red.

El SDK puede emitir diagnósticos de transporte; la observabilidad está desactivada y el wrapper oculta respuestas internas de error en texto. No actives tail, APM de cuerpos, prompt logging ni herramientas de replay sobre Vault. Las API Next siguen validando Bearer y UID, y las mutaciones de reserva/pagos conservan su idempotencia en Firestore.

El proceso duerme tras 15 minutos sin actividad. Un reinicio, despliegue o fallo de host pierde la cola en memoria y puede interrumpir inferencias; **no** se promete continuidad de trabajos en curso. La prioridad se mantiene mientras el proceso vive. `max_instances: 1` y el nombre constante impiden dividir la cola por usuario; tampoco ejecutes un servidor anterior o staging contra la misma Mac simultáneamente. Los reinicios de la plataforma siguen siendo posibles. [Ciclo de vida y límites](https://developers.cloudflare.com/containers/faq/), [ruteo](https://developers.cloudflare.com/containers/configuration/scaling-and-routing/) y [rollouts](https://developers.cloudflare.com/containers/configuration/rollouts/).

## GitHub y activación pendientes

Workers Builds admite construir el Dockerfile en Cloudflare: no requiere Docker local para ese camino. La configuración externa mínima es conectar el repositorio, seleccionar la rama de producción y mantener la raíz del repositorio como directorio de build. Comandos revisables para esa integración:

- Versión del entorno: `NODE_VERSION=24` y `PNPM_VERSION=11.23.0`, mediante las [variables oficiales de la imagen de build](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/).
- Instalación: `pnpm install --frozen-lockfile`.
- Build: `pnpm --filter sarin-cloudflare-host configure:build` con las cuatro variables públicas de build.
- Deploy de producción: `pnpm --filter sarin-cloudflare-host exec wrangler deploy --config wrangler.build.json`.

Mantén estos comandos y el lockfile único en la raíz del workspace; no instales un paquete Cloudflare por separado ni regeneres un `package-lock.json`.

Estos comandos no se ejecutan automáticamente al instalar este kit. No hay workflow de GitHub ni script de autodeploy. El nombre del proyecto Worker debe coincidir con `sarin-bot-app` o actualizarse en la plantilla antes de vincularlo. No uses `wrangler versions upload` para actualizar la imagen: las ramas de preview no generan una URL completa para este Worker con DO. Usa un entorno separado para staging si se define posteriormente. [Workers Builds con Containers](https://developers.cloudflare.com/containers/guides/deploy/#deploy-with-workers-builds).

`workers_dev` y `preview_urls` están desactivados y no hay rutas/dominio/account ID configurados. Antes de activar tráfico hacen falta plan Workers Paid, cuenta destino, dominio, configuración Firebase real y sus reglas/índices, secretos de runtime y túnel Access operativo. Al probar, verifica un request de más de dos minutos, inicio frío, memoria con concurrencia, denegación 403 de Vault a otro UID y comportamiento al reiniciar. El Worker HTTP no tiene un límite fijo de duración mientras el cliente permanece conectado; hay que verificar el recorrido completo y los límites del túnel por inferencia. [Límites de Workers](https://developers.cloudflare.com/workers/platform/limits/#duration).

## Costo orientativo

Con tarifas verificadas el 13 de octubre de 2026, `basic` dispone de 1 GiB, 0.25 vCPU y 4 GB de disco. El plan Workers Paid parte de USD 5/mes. Para un mes de 30 días siempre activo, memoria y disco más el plan suman aproximadamente **USD 11.93** antes de CPU adicional y otros consumos; un rango inicial para tráfico ligero es **USD 12–20/mes**. Dormir reduce el consumo, mientras páginas abiertas o monitorización pueden mantenerlo activo. Esta es una estimación propia, no un presupuesto cerrado. Firestore, dominio, energía de la Mac y consumos adicionales se evalúan aparte. [Tarifas Containers](https://developers.cloudflare.com/containers/platform/pricing/).

Workers y DO también se facturan según sus propios cupos. Workers Builds incluye 6000 minutos mensuales en planes de pago y cobra USD 0.005 por minuto adicional; sus builds tienen un máximo de 20 minutos. Antes de activar gasto, configura alertas y revisa consumo: no se ha comprobado ni modificado la facturación de ninguna cuenta. [Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/) y [Builds](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/).
