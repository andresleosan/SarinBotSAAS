# Portada Agenda clara — 13 de octubre de 2026

El propietario eligió Agenda clara entre tres propuestas. Se adapta el componente de portada compartido y su exportación temporal de Pages: fondo claro, acento cobalto, titular centrado y agenda ilustrativa. La mascota y el favicon con la cara se conservan. Identidad documentada en `design-system.md`.

## Verificación previa al despliegue

- `npm run build:landing`: aprobado; exportación estática y TypeScript correctos.
- `npm run typecheck`: aprobado.
- `npm run check:landing`: aprobado, 39 archivos públicos, sin enlaces privados ni configuración de backend.
- `npm audit --omit=dev --audit-level=high`: 0 vulnerabilidades.
- `git diff --check`: aprobado.
- Revisión de seguridad independiente: sin bloqueantes; selector local sin red, Firebase ni persistencia. No se modifican APIs, autenticación, reglas o datos.
- Revisión visual independiente: aprobada sin bloqueantes; composición fiel a la dirección elegida y estilos acotados a marketing.
- Navegador Chrome real: escritorio, tablet 768 px, móvil 360 px y pantalla estrecha 320 px. Sin desbordamiento horizontal; tabla y controles caben en todos los tamaños comprobados. Un único `h1`, imágenes cargadas y enlaces internos con destino existente.
- Selector: clic cambia a 14:00; Tab + Enter seleccionan 10:30 con foco visible y anuncio de estado. Botones de 44 px como mínimo.
- Navegación Próximamente: llega a `#lanzamiento`. Consola sin errores ni advertencias.
- Los ejemplos están rotulados; registro, reservas y chats siguen pendientes del lanzamiento. La variante SaaS conserva sus enlaces operativos.

## Publicación y reversión

Publicado en [sarinbotsaas.pages.dev](https://sarinbotsaas.pages.dev/) desde `776bc81c588b26207063e3307510c4c474862828`, despliegue [42f0e736](https://42f0e736.sarinbotsaas.pages.dev/). Cloudflare lo muestra como producción actual.

- HTML público HTTP 200 con el nuevo título y diseño. Los 13 recursos enlazados responden HTTP 200.
- `/admin`, `/dashboard` y `/api/sarin/chat` mantienen HTTP 404 en la portada temporal.
- CSP y `nosniff` presentes. El favicon publicado coincide con el ICO de la cara de Sarin aprobado anteriormente.
- Chrome en producción: selector cambia a 14:00, sin errores ni advertencias de consola.
- [Captura de la portada publicada](agenda-clara-publicada.png).

Reversión: volver al despliegue anterior aprobado `a57cacb9` de Pages, o revertir el commit del diseño y publicar la reversión. No hay migraciones ni cambios de configuración o secretos.
