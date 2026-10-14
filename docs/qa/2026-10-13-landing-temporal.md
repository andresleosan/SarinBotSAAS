# Portada temporal de Sarin — 13 de octubre de 2026

Alcance aprobado: publicar la presentación estática en `sarinbotsaas.pages.dev` mientras Firebase sigue pendiente. No se activa registro, reservas ni chats. Reutiliza la identidad visual existente; el SaaS mantiene su build y sus rutas.

## Comprobaciones previas

- `npm run build:landing`: exportación Next correcta de portada, 404, robots y sitemap; sin credenciales Firebase.
- `npm run check:landing`: 31 archivos públicos, aviso de lanzamiento visible, assets locales existentes, sin enlaces privados, configuración de backend, mapas de código ni Worker ejecutable.
- `npm run typecheck`, `npm run build`: aplicación principal aprobada.
- `npm test`: 142 aprobadas y 7 pruebas de emulador omitidas; esta tarea no cambia reglas ni lógica Firebase.
- `npm audit --audit-level=high`: cero vulnerabilidades conocidas.
- Revisión independiente de seguridad: sin bloqueantes. AuthProvider no se importa en el sitio temporal.
- Chrome en exportación real servida localmente: escritorio y 360 px sin desbordamiento horizontal; fuentes e ilustración cargadas. Enlaces internos llevan a secciones reales. El primer Tab enfoca «Saltar al contenido» con contorno visible. Consola sin errores.
- La revisión visual detectó clases Tailwind no incluidas por compartir componentes fuera del directorio de la portada; se declararon fuentes `@source` explícitas, se recompiló y se verificó de nuevo.

Evidencia: [escritorio](landing-temporal-desktop.png), [móvil](landing-temporal-mobile.png). Se restauró el viewport del navegador.

## Publicación y reversión

Pages publica exclusivamente `landing/out`; los datos y secretos del SaaS no forman parte del artefacto. No hay migración de datos. El comando y la reversión están documentados en `landing/README.md`. La primera publicación puede sustituirse por mantenimiento; futuras versiones se revierten desde el historial de Pages. Al revertir una emergencia, pausar los builds automáticos hasta corregir la rama evita que un nuevo push reemplace esa reversión.

## Resultado de producción

Publicada y verificada el 13 de octubre de 2026 en [sarinbotsaas.pages.dev](https://sarinbotsaas.pages.dev/). Pages muestra producción `main`, commit `1d4890aa5b4e77ec896055ee1d1a0dd2c485dc7c` y despliegue [7f2b08d0](https://7f2b08d0.sarinbotsaas.pages.dev/), con integración automática de GitHub activada.

- HTTP 200: `/`, ilustración, `robots.txt` y `sitemap.xml`.
- HTTP 404: `/admin`, `/dashboard` y `/api/sarin/chat`.
- Comprobadas en el dominio público: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` y CSP con `frame-ancestors 'none'`.
- Chrome sobre HTTPS: fuentes e ilustración cargadas, sin errores ni advertencias en consola y sin scripts, hojas de estilo o imágenes de terceros en el DOM. Aviso de funciones pendientes visible.
- [Captura de la portada publicada](landing-temporal-publicada.png).

La portada está disponible sin Firebase; no se ha activado la aplicación SaaS ni se han configurado sus credenciales. El servidor estático local utilizado en QA no aplica `_headers`; las comprobaciones anteriores se ejecutaron contra Pages real.
