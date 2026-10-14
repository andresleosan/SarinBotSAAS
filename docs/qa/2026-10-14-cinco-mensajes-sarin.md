# Cinco mensajes de Sarin — 14 de octubre de 2026

El propietario pidió vuelo, vuelta, aterrizaje y cinco textos sobre la app, con repetición continua confirmada. Se conservan los assets originales, la cara de cabecera/pie y la identidad Agenda clara.

Los temas son presentación, configuración de servicios/profesionales/horarios, enlace/QR, consulta por conversación y control de citas/bloqueos. `comingSoon` usa futuro; el SaaS usa presente.

Cada escena dura 8 s: vuelo y vuelta al inicio, después unos cinco segundos de texto quieto. El evento de la vuelta del actor avanza el índice módulo cinco; los eventos de las imágenes se ignoran. La altura del globo queda reservada para evitar saltos entre mensajes. No se usan temporizadores para avanzar contenido.

«Leer los 5 mensajes» es una acción textual que detiene el movimiento y expande la lista completa. Volver reinicia en el primero. Se conserva pausa fuera de pantalla/pestaña y preferencia de movimiento reducido. No se recupera el control circular.

## Verificación previa

- `npm run build:landing`, `npm run check:landing` (41 archivos), `npm run typecheck` y `git diff --check`: aprobados.
- Revisión independiente de lógica, seguridad y accesibilidad: sin bloqueantes. Sin dependencias, red, Firebase o persistencia añadidas.
- Chrome real: observados los cinco textos y el orden `2 → 3 → 4 → 5 → 1 → 2`, confirmando el reinicio y un avance por vuelta. Globo estable de 132 px en escritorio.
- Lectura completa: pausa estática, cinco elementos visibles y foco conservado. Enter vuelve al recorrido y reinicia en el primero.
- Ancho 320 px: sin desbordamiento; globo reservado de 158 px y acción de 44 px. Captura móvil inspeccionada.
- Movimiento reducido: animación desactivada, saludo estático y acceso a los cinco mensajes. Preferencia y viewport restaurados después de verificar.
- Consola sin errores ni advertencias.

## Publicación

Pendiente de registrar el resultado de Pages tras el push.

Reversión: volver al despliegue anterior `40a8f9d6`, o revertir el commit del recorrido. No hay migraciones ni cambios en APIs o datos.
