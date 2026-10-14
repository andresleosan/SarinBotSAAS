# Cara de Sarin como favicon — 13 de octubre de 2026

Solicitud: usar la cara de la mascota existente como favicon de la portada temporal.

## Preparación

- Referencia: `public/brand/sarin-welcome.png`, mascota del propietario.
- Herramienta: `imagegen` integrada, edición con referencia local y fondo transparente. No requiere claves ni dependencias nuevas.
- Original generado: `public/brand/sarin-face.png`, 1254 × 1254, canal alfa.
- Derivados con Sharp: `landing/public/sarin-face-32.png` (32 × 32), `sarin-face-48.png` (48 × 48), `sarin-face-apple.png` (180 × 180) y `sarin-face.ico` (16/32/48).
- Los nombres nuevos y `?v=1` actualizan la selección del navegador. Se actualizan también los archivos de compatibilidad `favicon.ico`, `favicon.png` y `apple-touch-icon.png`. Se elimina el SVG anterior.

Prompt exacto usado con la imagen de referencia:

```text
Edit the provided Sarin robot mascot image into a favicon asset. Input image is the edit target and the exact identity reference. Isolate ONLY this same robot's HEAD and headphones, with a clean genuinely transparent background. Preserve the recognizable glossy near-black faceplate, exactly two luminous cyan/turquoise oval eyes, white and silver helmet, dark blue outlines, proportions, existing three-quarter viewing angle and friendly expression. Remove the entire torso, shoulders, arms, waving hand, legs and all lettering. Do not redesign the mascot and do not add antennae, mouth, symbols, text or logos. Square composition, head centered and filling about 88–92% of the canvas with a small safe margin so no part of the headphones or helmet is clipped. Crisp silhouette and clear eyes suitable for a tiny browser tab favicon. No opaque background, no badge, no circle behind the head, no cast shadow beyond the silhouette. Preserve the original character's clean shaded illustration style.
```

## Validación local

- `npm run build:landing`: aprobado; incluye compilación y comprobación de TypeScript.
- `npm run check:landing`: aprobado, 38 archivos públicos.
- Revisión visual de PNG 32 y 180: cara legible y ojos turquesa reconocibles.
- Revisión independiente: dimensiones PNG correctas, directorios y offsets ICO válidos; exportación idéntica a los assets originales y metadata sin selección del SVG anterior.
- `git diff --check`: aprobado.

## Publicación

Publicado en [sarinbotsaas.pages.dev](https://sarinbotsaas.pages.dev/) desde el commit `18bd4fdfa6ad5f7e81aa3fd40c35a6d2fb80ab6c`, despliegue [a57cacb9](https://a57cacb9.sarinbotsaas.pages.dev/). Cloudflare lo muestra como producción actual.

- HTML público HTTP 200: tres enlaces `rel=icon` a los nuevos ICO/PNG y un `rel=apple-touch-icon`; no selecciona el SVG anterior.
- Los cuatro nuevos iconos y `/favicon.ico` devuelven HTTP 200, MIME correcto y contenido binario idéntico a los archivos locales verificados.
- Portada recargada en Chrome: contenido correcto, sin errores ni advertencias de consola.
- PNG público inspeccionado visualmente, 180 × 180. [Captura del favicon publicado](favicon-cara-sarin-publicado.png).

SHA-256 del ICO publicado: `b30c672396aceca3067bec88363d2c65465d678cbffd4cc17704364d507efd25`.

Reversión disponible: volver al despliegue anterior `027d8f92` o revertir el commit del favicon. Las pestañas antiguas pueden conservar temporalmente el icono anterior en caché.
