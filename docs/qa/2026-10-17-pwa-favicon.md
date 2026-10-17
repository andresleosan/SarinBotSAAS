# Icono de instalación igual al favicon

Cambio publicado y verificado el 17 de octubre de 2026, tras autorización explícita del propietario.

## Causa y cambio

Chrome obtiene el icono de instalación del manifiesto. `src/app/manifest.ts` apuntaba a `/sarin-mark.svg`, el robot verde sobre fondo oscuro de la captura. El favicon de la landing usa la cara original de `public/brand/sarin-face.png`.

El manifiesto ahora apunta a dos versiones PNG de esa misma imagen:

- `public/brand/sarin-face-192.png`, 192 × 192.
- `public/brand/sarin-face-512.png`, 512 × 512.

Se conserva la transparencia y `purpose: any`. No se declara maskable sin una composición específica. Las rutas nuevas evitan reutilizar la URL anterior. No hay service worker propio que requiera actualización.

![Cara utilizada en el nuevo icono](../../public/brand/sarin-face-192.png)

## Validación

- Node 24.18.0 y pnpm 11.23.0.
- `pnpm run typecheck`: aprobado, incluida una nueva ejecución después del build.
- `pnpm run build`: aprobado; `/manifest.webmanifest` prerenderizado.
- Inspección de `.next/server/app/manifest.webmanifest.body`: referencias, tamaños, MIME y purpose correctos.
- Servidor temporal de producción: manifiesto y ambos iconos HTTP 200, MIME correctos y bytes iguales a los archivos de `public`. Servidor temporal detenido.
- Comparación de píxeles decodificados: ambos PNG coinciden con el redimensionado del original; el redimensionado a 180 coincide con el favicon Apple existente de la landing.
- Inspección visual del original y resultado 512; revisión independiente sin hallazgos sustantivos.
- `git diff --check -- src/app/manifest.ts`: aprobado.
- Seguridad: solo referencias a recursos públicos locales; sin nuevas entradas, permisos, endpoints, dependencias ni secretos.

No se reprodujo el aviso nativo de Chrome Android. Chrome de escritorio sí leyó el manifiesto local y el de producción sin errores, con ambos iconos nuevos. Las comprobaciones HTTP finales acreditan los bytes publicados; no prueban cuándo actualizará su caché una instalación Android existente.

El build regeneró `next-env.d.ts`, que ya estaba modificado antes de la tarea. Se restauraron sus dos referencias estándar de desarrollo (`.next/dev/types`) con apoyo de los archivos previos existentes; no se disponía de una copia exacta anterior. La comprobación de tipos posterior pasó.

## Publicación y reversión

El gateway de Pages reenvía las solicitudes, incluidos manifiesto e imágenes, al binding `SARIN_APP_HOST`. `build:pages` solo prepara landing/gateway; publicar únicamente esos estáticos no entrega este cambio. La aplicación necesita una imagen Next reconstruida y despliegue del Worker/contenedor según el [runbook](../cloudflare-no-vps-runbook.md).

El despliegue se aisló del checkout mixto. La base real era más reciente que los informes iniciales: Worker `d5a704e7-5bc3-4484-bc58-3c3f334ee3a7`, imagen `a319ac8b2b8b4188746e0f00bcc41439b40fc5c807463ee6d798c5bedeaae90e`, aplicación versión 7 y fuentes `6315379b8c0482af57fea20abd8e2e1af0c00ff1`. Se extrajo su archivo fuente privado verificado (`d3aeb8ed66e124a07fd5633c5d1a216e7521a0114eefbf7c47e41d2b48bb6a3b`). La revisión independiente comparó todos los archivos: exactamente el manifiesto modificado y dos PNG añadidos; sin otros cambios. Los demás campos del manifiesto quedaron idénticos.

Se reconstruyó Linux/amd64 con el lockfile congelado y los mismos cuatro argumentos públicos Firebase. El build Next y TypeScript pasaron. La variante enviada al registro desactiva attestations/provenance para conservar un manifiesto de imagen de una sola plataforma. La verificación de Chrome local y las respuestas HTTP de la imagen reconstruida pasaron antes de publicar. La aceptación funcional previa pertenece a la misma base de fuentes: sus resultados se conservaron como evidencia histórica, sin afirmar que se repitieron todos los recorridos para este cambio de recursos.

Publicación:

- Imagen: `registry.cloudflare.com/05fb22c155667de064b55c4e287b21d8/sarin-bot@sha256:1faafea1cc8bce41a6a7ab284807e932b604547528424525e1f9041384039c72`.
- Mantenimiento inicial: Worker `09828ee6-2c28-44aa-8b9d-43889328f52c`. Cola autenticada: cero activas y cero en espera antes y después del cierre.
- Rollout bajo mantenimiento: Worker `2782587f-2463-4f8f-837c-1db92c0ca1da`, aplicación Containers versión 8. Se esperó a su promoción efectiva y arranque; no se confundió la aceptación del comando con un rollout completo.
- Reapertura: Worker **`218fa37f-9589-4cfa-bd80-b5a51bea4212`**, mantenimiento desactivado.
- Revisión independiente final a las **13:13:17 UTC / 08:13:17 Colombia**: imagen correcta, una asignación en ejecución conectada al singleton, máximo una instancia y cero asignaciones antiguas; paginación completa. Trece secretos y todos los bindings iguales a la base, incluidos D1/R2, presupuesto de IA y origen público. Pages no se redesplegó.
- `/`, `/ayuda`, `/privacidad`, página del negocio QA y `/manifest.webmanifest`: HTTP 200 y `no-store`; `/api/session` anónimo: 401. Iconos: HTTP 200, `image/png`, SHA-256 iguales a los archivos revisados. Chrome interpretó el manifiesto público sin errores. La sesión administrativa volvió a cargar con DeepSeek activo y cola vacía.
- Se retiró la inspección temporal de salud del navegador y se cerraron las pestañas/servidor local de prueba. No se hicieron reservas, llamadas de generación IA ni migraciones de datos.

![Icono servido por producción, capturado en Chrome](2026-10-17-pwa-icon-live.jpg)

Los checkpoints, configuraciones de reversión, imagen y fuentes aisladas se conservan fuera de Git en `%LOCALAPPDATA%/SarinBot/pwa-favicon-20261017`. No contienen exportaciones nuevas de datos comerciales. La configuración anterior del checkout mixto no representa la versión pública: no utilizarla para una reversión general.

Para revertir el despliegue, activar mantenimiento con la configuración exacta de la versión publicada, drenar la cola y volver a la imagen base `a319ac8b…` con el mismo Worker/configuración comercial; comprobar una sola instancia antes de reabrir. D1/R2, secretos, identidad y límites se conservan. No volver a imágenes históricas anteriores a esa base ni a la VPS.

Reversión del código: restaurar únicamente la entrada anterior de icons hacia `/sarin-mark.svg` y reconstruir/desplegar la aplicación. Los PNG nuevos pueden permanecer sin referencias. No borrar datos, credenciales ni configuración de negocio.
