# Sarin Bot — portada de producto en Cloudflare Pages

La portada de `https://sarinbotsaas.pages.dev/` presenta las funciones implementadas: reservas por conversación, agenda del negocio, enlace y QR, próximas citas e historial del cliente dentro de cada negocio, consulta por fecha, cancelación confirmada y «Guardar imagen de la cita». Esta acción descarga un PNG generado en el navegador para una cita futura confirmada; sustituye la descarga `.ics`. La imagen es estática y los cambios se consultan en «Mis citas»; no añade eventos al calendario ni activa recordatorios automáticos. Conserva Agenda clara y la mascota de Sarin. Explica la prueba pagada y los planes Esencial; no anuncia WhatsApp ni copiloto.

Para preparar el sitio completo bajo ese mismo origen, usar `pnpm run build:pages` y seguir [el gateway Pages/VPS](../docs/pages-vps-gateway.md). Ese comando genera la portada con enlaces al origen aprobado y añade el worker revisado. La VPS conserva el runtime Next. No activar el artefacto sin preparar y probar la configuración de backend descrita en esa guía.

Esta exportación sigue siendo estática: no contiene AuthProvider, configuración Firebase, API ni administración. La aplicación completa continúa en `src/app`. Publicar la portada no habilita por sí solo sus rutas.

Desde la raíz del workspace, con Node 24 y pnpm 11.23.0:

```sh
pnpm install --frozen-lockfile
pnpm run build:landing
pnpm run check:landing
```

En el formulario de **Pages**, rama `main`, directorio raíz `/`, preset `None`, build command `pnpm run build:landing && pnpm run check:landing`, output `landing/out`. Variables de build: `NODE_VERSION=24` y `PNPM_VERSION=11.23.0`, según la [imagen de build de Pages](https://developers.cloudflare.com/pages/configuration/build-image/). No se requieren variables Firebase ni secretos. La instalación usa el único `pnpm-lock.yaml` de la raíz y `pnpm install --frozen-lockfile`; no instalar desde `landing/` ni `cloudflare/`.

## Acceso a la aplicación

Sin `SARIN_PUBLIC_APP_URL`, los botones conducen a los planes y a la sección para coordinar el acceso con ALS DevStudio. No apuntan a rutas de aplicación inexistentes ni afirman que el registro público esté abierto.

Después de verificar las rutas reales de aplicación bajo el mismo origen, configurar **solo en el build** `SARIN_PUBLIC_APP_URL=https://sarinbotsaas.pages.dev` y volver a exportar. Así se habilitan «Mi negocio» y «Empezar por $5.000 COP» hacia `/dashboard` y `/dashboard/onboarding` de ese origen. Esta variable es pública y no es una credencial. El build rechaza otro dominio, HTTP, rutas, credenciales, parámetros o fragmentos. No habilitarla antes de comprobar que esas rutas sirven la aplicación con HTTPS y OAuth correctos.

Los precios variables se consultan en runtime mediante GET `/api/public/commercial-offer` del origen aprobado, sin sesión ni Firebase. Proceden de los mismos ajustes administrativos que usa facturación: cambiar una tarifa no exige volver a publicar la portada. La consulta se renueva cada 15 segundos mientras la pestaña está visible y al volver a ella. Durante la carga o un error no se presenta una tarifa anterior como vigente; se permite reintentar. Sin `SARIN_PUBLIC_APP_URL` se muestra «Consulta el precio vigente», sin consultar otro servidor.

La prueba de $5.000 COP incluye diez citas y 700 respuestas totales independientes, sin vencimiento por días; cada cita creada consume un cupo aunque se cancele. La activación de prueba, planes y ampliaciones por transferencia exige aprobación manual del comprobante. No hay cargos automáticos.

La exportación incluye `404.html` para que las rutas desconocidas devuelvan 404 y `_headers` para seguridad/caché. Nunca subir la raíz del repositorio, `.next`, `cloudflare/` ni archivos de entorno como salida pública. La CSP admite scripts inline del render de Next; no hay analítica ni servicios externos en la portada.

Vista previa estática local desde la raíz (Python 3):

```sh
python -m http.server 3031 --bind 127.0.0.1 --directory landing/out
```

El servidor local comprueba HTML y assets; los headers de `_headers` se verifican en Pages tras publicar.

## Verificación y reversión

`check:landing` valida las secciones, los destinos de navegación, los archivos y los iconos; rechaza rutas privadas relativas, destinos externos no aprobados, configuración backend, secretos conocidos, sourcemaps y symlinks. Los tests de `tests/marketing-home.test.tsx` comprueban el acceso coordinado, la habilitación explícita del origen aprobado y el rechazo de destinos inválidos. El preview estático no demuestra funcionamiento de OAuth, reservas o pagos.

Para revertir únicamente la portada, usar **Rollback** sobre una publicación anterior revisada de Pages. Conservar por separado la reversión de la aplicación y su configuración de rutas. No publicar la raíz del repositorio ni la salida standalone de Next como si fueran archivos estáticos de esta portada.
