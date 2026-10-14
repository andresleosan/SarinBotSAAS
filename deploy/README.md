# Kit de infraestructura de Sarin

Estos archivos son plantillas revisables. No crean cuentas, DNS, certificados, túneles ni servicios al añadirlos al repositorio. Los dominios `example.invalid`, el UUID y las rutas de credenciales deben sustituirse fuera de los ejemplos. No se necesita Firebase real para revisar y validar la estructura.

El diseño separa una aplicación Next con un único proceso, Caddy en su host y Ollama nativo en la Mac. La cola no coordina réplicas: conserva un contenedor y evita cluster/autoscaling. El puerto web queda publicado exclusivamente en `127.0.0.1:3000`; Caddy expone HTTPS para el dominio web.

El hostname web debe usar **DNS only** en esta primera configuración. La espera de cola y las rondas de herramientas pueden superar el tiempo de lectura del proxy de Cloudflare, y ampliar el timeout de Caddy no amplía el del CDN. Esto permite administrar el dominio en Cloudflare y conectar el navegador directamente al HTTPS de Caddy. El hostname del **motor** sí usa Tunnel + Access; cada inferencia tiene un timeout propio de 120 segundos. Si se quiere activar el proxy naranja también para la web, primero hay que adaptar el chat a trabajos asíncronos con consulta de estado o streaming con actividad periódica. No se cambia ninguna configuración de Cloudflare al añadir esta plantilla. [Límites de conexiones](https://developers.cloudflare.com/fundamentals/reference/connection-limits/) y [peticiones largas y error 524](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-524/).

## Mac: preparar Ollama existente

Con Ollama nativo ya instalado, copia `ollama.env.example` a un archivo propio y revísalo. No sobrescribas una configuración existente. Desde la raíz del proyecto:

```sh
sh deploy/macos/serve-ollama.sh --check /ruta/privada/ollama.env
# Cuando quieras iniciar el proceso en primer plano:
sh deploy/macos/serve-ollama.sh /ruta/privada/ollama.env
```

El lanzador verifica macOS, un binario existente y valores permitidos; trata el archivo como datos, sin `source` ni `eval`. Usa loopback, desactiva cloud y debug y limpia el entorno del proceso hijo. No instala Ollama, modifica `launchctl`, descarga modelos ni detiene procesos ajenos. Si la aplicación de Ollama ya ocupa el puerto, ciérrala manualmente antes de usar el lanzador.

Los cinco ajustes del documento rector se conservan: paralelismo cuatro, un modelo cargado, permanencia `-1`, Flash Attention y KV `q8_0`. Contexto inicial 8192 y cola interna cuatro son límites adicionales revisables. Reduce el paralelismo y el contexto si las mediciones de memoria/latencia lo requieren; 48 GB no garantizan cualquier combinación. Los modelos principal y de visión deben existir en la Mac y coincidir con los nombres de runtime de Next. [Configuración oficial de Ollama](https://docs.ollama.com/faq).

## Túnel del motor: configuración externa pendiente

Un túnel localmente gestionado requiere `cloudflared` instalado, un túnel nombrado y sus credenciales privadas. Copia `cloudflared/config.yml.example` a una ubicación propia, introduce su UUID real, la ruta absoluta del JSON y el hostname del motor. Mantén ese JSON fuera del repositorio.

La única regla permite `/v1/chat/completions` y `/v1/models` hacia `127.0.0.1:11434`. El catch-all devuelve 404; la API nativa de administración de modelos no se publica. El encabezado Host del origen también usa loopback. Validaciones locales, sin iniciar el túnel:

```sh
cloudflared tunnel --config /ruta/privada/config.yml ingress validate
cloudflared tunnel --config /ruta/privada/config.yml ingress rule https://sarin-engine.example.invalid/v1/models
cloudflared tunnel --config /ruta/privada/config.yml ingress rule https://sarin-engine.example.invalid/api/pull
```

La última URL debe seleccionar el catch-all. Sustituye el hostname por el real en tus comprobaciones. La creación del túnel, su ruta DNS y su ejecución quedan pendientes del operador; usa la [guía oficial de túneles locales](https://developers.cloudflare.com/tunnel/features/locally-managed-tunnels/create-local-tunnel/) y la [referencia de ingress](https://developers.cloudflare.com/tunnel/features/locally-managed-tunnels/configuration-file/).

Antes de publicar DNS o ejecutar el túnel, protege **todo el hostname del motor** con una aplicación self-hosted de Cloudflare Access. Configura una política **Service Auth** que incluya exclusivamente el service token del backend; conserva denegación para el resto y evita Bypass o políticas Allow públicas. El token y las credenciales del túnel son secretos distintos. Guarda el Client ID y Client Secret solo en el runtime del servidor Next; este envía ambas cabeceras `CF-Access-Client-Id` y `CF-Access-Client-Secret`. Valida que peticiones sin token o con token inválido sean rechazadas. [Service tokens y Service Auth](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/).

## Aplicación: build público y secretos de runtime separados

Compose requiere versión 2.30 o posterior por `env_file.format: raw`. Completa una copia `deploy/firebase.public.env` con las cuatro claves públicas. Crea `.env.production` a partir de `runtime.env.example` únicamente cuando tengas los valores reales: formato `KEY=value`, sin comillas, sin interpolación; la clave privada PEM ocupa una línea con `\n` literales. No uses este archivo como `--env-file` del build. [Formato raw oficial de Compose](https://docs.docker.com/reference/compose-file/services/#format).

Revisa la estructura ahora sin resolver variables ni leer secretos:

```sh
docker compose -f compose.yaml --env-file deploy/firebase.public.env.example config --no-interpolate --no-env-resolution --quiet
```

Cuando los valores externos estén preparados, estos comandos construyen e inician la aplicación; no forman parte de la validación anterior:

```sh
docker compose --env-file deploy/firebase.public.env build app
docker compose --env-file deploy/firebase.public.env up -d --no-build app
```

El Dockerfile solo recibe argumentos `NEXT_PUBLIC_*`. `.dockerignore` excluye los `.env*` reales; el contenedor recibe `.env.production` al arrancar. Dentro del contenedor, `127.0.0.1` identifica al propio contenedor: configura `SARIN_TUNNEL_URL` con la URL HTTPS real del motor, no el loopback de la Mac. No añadas variables de emuladores al runtime de producción.

## Caddy y privacidad

Copia `Caddyfile.example` a una ruta propia y sustituye el dominio. Caddy debe ejecutarse en el host para alcanzar el puerto publicado en loopback. Antes de activarlo, valida con `caddy validate --config /ruta/Caddyfile --adapter caddyfile`. DNS, TLS, firewall y activación del servicio siguen pendientes.

La plantilla no activa access logs ni caché; añade `no-store` para API y áreas privadas y excluye Vault de access logs si posteriormente se habilitan. No reintenta mutaciones POST. Los tiempos del proxy admiten cola y varias rondas; cualquier CDN o proxy adicional debe aceptar esos tiempos y evitar caché de API. [Reverse proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy), [access logs](https://caddyserver.com/docs/caddyfile/directives/log) y [exclusión de logs](https://caddyserver.com/docs/caddyfile/directives/log_skip).

Vault persiste en el dispositivo, pero las peticiones transitan temporalmente por Next, Cloudflare y la Mac. Desactiva captura de cuerpos en proxies/APM y cualquier función de AI prompt logging, y evita caché del hostname del motor. Los registros de autenticación de Access son metadatos distintos del contenido de conversaciones. No publiques prompts o facturas en comandos de diagnóstico. Verifica modelo local, headers de Access, rechazo sin token, ruta nativa bloqueada y funcionamiento autenticado antes de habilitar uso real.
