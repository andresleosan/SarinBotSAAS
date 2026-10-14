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

La verificación de HTTP 200, headers de seguridad y HTTP 404 en rutas privadas se realiza sobre Pages después del primer despliegue; el servidor estático local no aplica `_headers`.
