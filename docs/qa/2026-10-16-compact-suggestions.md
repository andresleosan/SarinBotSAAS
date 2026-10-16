# Sugerencias y formulario compactos

Commit `8220581a64a3dedecb525ce6e91523ff035a7485`: cada campo muestra tres botones y un selector «Más sugerencias» con las otras tres opciones. El formulario limita su ancho y reserva 18 rem para la ayuda de Sarin en escritorio.

Las sugerencias conservan el texto propio, indican las opciones ya añadidas y respetan el máximo de caracteres. Seleccionar una opción no guarda el negocio; el selector vuelve a su texto inicial para permitir otra elección.

## Validación

- Nueve pruebas de componentes e integración correctas; `pnpm run typecheck` correcto.
- [Verify Sarin, ejecución 38849361639](https://github.com/andresleosan/SarinBotSAAS/actions/runs/38849361639): los tres trabajos correctos, incluidos builds, reglas Firebase, recorrido local y dry-run Cloudflare.
- Revisión independiente de implementación y scripts de actualización sin bloqueadores.
- Navegador con Firebase emulado y cuenta sintética: ambos selectores añaden su opción al texto existente; las opciones usadas quedan deshabilitadas. Selección por teclado con flecha abajo verificada.
- Escritorio de 1772 px: formulario de 716 px, tres botones y selector en una fila. Escritorio de 1280 px: formulario de 657 px; campos horarios de 140 × 44 px.
- Móvil de 390 px: documento de 375 px sin desbordamiento horizontal; botones y selectores con altura de 44 px. Las ayudas se distribuyen en dos filas.
- No se guardó ningún negocio durante la prueba. Emuladores aislados; sesión real y túnel privado preservados.
- Cloudflare Pages mostró `skipped` para el commit exacto. La publicación existente siguió en `04d57cd22f9243b9e4e93c0c20ceb373f408178e`.

Las capturas y manifiestos completos permanecen fuera de Git en el directorio privado de despliegue del operador.

## Compilación privada

Imagen `sarin-bot:compact-suggestions-20261016t041202z`, ID `sha256:b3038acb0ed0d0a5b28741490b752d98abdb432fc855274ac58226ca43df01f0`. Snapshot de 111 archivos del commit exacto, archivo SHA-256 `dd64d03cf045dda74be2634d781521126f96f7df9dac409b2877c2fdd6518d78`. Compilación y comprobación aislada correctas; sin archivos privados, credenciales ni fixtures de pruebas en la imagen.

## Actualización y reversión

Imagen activada en la instancia privada. Pasaron 28 límites de autenticación, 34 comprobaciones HTTP, lecturas Firebase y el catálogo de Ollama a través de Access. El catálogo devolvió 200 y el endpoint de administración no publicado devolvió 404. Entorno, administrador, selección de IA, DNS y una sola réplica conservados.

Entorno SHA-256 `2e38c04933bd69d0c1b03ea1ef152a433f90bd0f1589a8e917ffee2f34cc05f3`; Compose SHA-256 `1014f50aca55a8140cf20b58e245c5265e533385fc0047004389a5bf249083ca`. Reversión preparada en `/opt/sarin-bot/runtime/rollbacks/compact-suggestions-image-update-20261016T041039Z-e14d5973`, con la imagen anterior preservada.

Panel privado verificado con la sesión real del negocio: formulario de 716 px y tres botones más tres opciones adicionales en cada selector. Revisión de solo lectura, sin guardar cambios. La configuración de Gemini sigue pendiente del prepago y la clave privada; esta actualización no modifica proveedores ni facturación.
