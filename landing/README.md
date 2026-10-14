# Portada temporal — Cloudflare Pages

Publicación autorizada en `https://sarinbotsaas.pages.dev`. Reutiliza el diseño de ALS DevStudio con un aviso visible de lanzamiento pendiente. No contiene AuthProvider, Firebase, rutas API, registro ni acceso administrativo. El sitio completo continúa en `src/app` con su build habitual.

Desde la raíz, con Node 24 y dependencias instaladas:

```sh
npm run build:landing
npm run check:landing
```

En el formulario de **Pages**, rama `main`, directorio raíz `/`, preset `None`, build command `npm run build:landing && npm run check:landing`, output `landing/out`. Añadir solo la variable de build `NODE_VERSION=24`. No se requieren variables Firebase ni secretos. La instalación usa el `package-lock.json` de la raíz; no instalar desde `landing/`.

La exportación incluye `404.html` para que las rutas desconocidas devuelvan 404 y `_headers` para seguridad/caché. Nunca subir la raíz del repositorio, `.next`, `cloudflare/` ni archivos de entorno como salida pública. La CSP admite scripts inline del render de Next; no hay analítica ni servicios externos en la portada.

Vista previa estática local desde la raíz (Python 3):

```sh
python -m http.server 3031 --bind 127.0.0.1 --directory landing/out
```

El servidor local comprueba HTML y assets; los headers de `_headers` se verifican en Pages tras publicar.

## Reversión y lanzamiento completo

Esta publicación crea un proyecto Pages separado y no modifica la infraestructura de otros sitios. En futuras actualizaciones, usar **Rollback** sobre un despliegue de producción anterior aprobado en Pages. Para retirar contenido de esta primera publicación, sustituir la portada por una página estática de mantenimiento y desplegarla con el mismo comando; el repositorio conserva la versión previa. El lanzamiento completo se despliega en el Worker preparado, después de configurar y probar Firebase y el túnel real. No cambiar la salida de este proyecto Pages a la aplicación standalone.
