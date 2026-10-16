# Claridad de las etiquetas del negocio

El propietario pidió mostrar «Enlace» sin `/b/` y aclarar la diferencia entre duración y limpieza.

- «Limpieza» ahora se llama «Tiempo entre citas (min)», con ayuda sobre el margen posterior opcional. La duración sigue siendo el tiempo de atención; el margen reserva el puesto después del servicio.
- Solo cambian textos, asociación accesible de la ayuda y alineación de campos. Valores guardados, URL, validaciones y cálculo de reservas permanecen iguales.
- `pnpm run typecheck` y las dos pruebas existentes de `tests/chat-surfaces.test.tsx`: aprobados. No se añadieron pruebas que solo repitan las etiquetas.
- [CI 38844556835](https://github.com/andresleosan/SarinBotSAAS/actions/runs/38844556835), commit `1b7973c3dc94a3e327348ac77d67c6ba12c4007c`: tres trabajos correctos.
- Chrome con negocio sintético y Firebase emulado: «Enlace», nuevo nombre y ayuda comprobados; escritorio y 320 px sin desbordamiento. Duración y margen alineados incluso cuando una etiqueta ocupa dos líneas; controles de 44 px.
- Revisión independiente de copy, accesibilidad y scripts privados: sin bloqueadores. Captura móvil privada `C:/Users/USER/AppData/Local/SarinBot/deployment/service-labels-mobile.png`.

Imagen privada activa `sarin-bot:service-labels-20261016t031651z`, ID `sha256:78d8ae8e4c3a0f31c2d6b4311bcf974324de7853027ab9b635a5d727a8e0ad0c`. Snapshot de 109 archivos del commit exacto, SHA256 `5d046fd22db76056025d8d6e8db56cbbaabc80988b166f2b01affbe883ffc82d`.

Activación verificada con los 28 límites de autenticación, páginas/recursos, Firebase y catálogo del motor local. Chrome autenticado muestra «Enlace», «Tiempo entre citas (min)» y la ayuda, conservando los valores del servicio. No se guardó el negocio ni se ejecutó inferencia. Captura privada: `C:/Users/USER/AppData/Local/SarinBot/deployment/service-labels-sarin-pruebas.png`.

Rollback revisado: `/opt/sarin-bot/runtime/rollbacks/service-labels-image-update-20261016T031519Z-a970b132`, hacia `phone-country-20261016t030925z`. Baseline privado `service-labels-activated-baseline-20261016.json`; SHA256 `e86ee74dd918e876db45bcbb479fb2745c8c89ab9eabfbbac10ee3c1264cad04`. QA cerrado y túnel 3032 conservado.
