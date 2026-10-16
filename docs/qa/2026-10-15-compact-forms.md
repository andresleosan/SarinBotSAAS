# Formularios compactos — 15 de octubre de 2026

Solicitud: reducir el espacio excesivo de los formularios existentes. Se conserva Agenda clara; referencia visual inspeccionada mediante Mobbin: [Square, horarios](https://mobbin.com/screens/6b2d38fe-14c7-4c70-9982-fb8aafab787c).

## Cambios

- Menos margen del área de trabajo, separación entre grupos y relleno de tarjetas; campos y botones de al menos 44 px.
- Administración: acciones en cabeceras, cinco tarifas en una fila cuando hay ancho y cuentas de pago en dos columnas en escritorio.
- Suscripción: actualización junto al precio, datos de transferencia agrupados y carga de comprobante compacta.
- Negocio: mayor ancho para el formulario, menos altura vacía del chat y horarios por filas. En contenedores menores de 24 rem las horas se apilan para conservar AM/PM y el selector nativo; desde 32 rem el día ocupa una columna propia.
- Bloqueos: menor relleno y separación de campos.

No se modifican precios, cuotas, permisos, llamadas de API, validaciones, credenciales ni selección del proveedor. La revisión independiente del diff no encontró bloqueadores.

## Verificación

- `pnpm run typecheck`: correcto después de los ajustes finales.
- `pnpm test`: 408 aprobadas y 18 omitidas por requerir los runners de integración. No se añadieron pruebas que comparen clases CSS.
- Pruebas focales de administración/facturación: 31 aprobadas; chat y debouncing: 10 aprobadas.
- Chrome con Firebase Auth/Firestore emulados, proyecto `demo-sarin-bot`, datos sintéticos y servicios externos deshabilitados. Revisión de administración a 320/1280 px y escritorio; negocio a 320/640/1280 px; suscripción a 320/1280 px; bloqueo abierto a 320 px.
- Sin desbordamiento horizontal de página: 305 px útiles a un viewport de 320 px; la tabla administrativa conserva su desplazamiento interno. Campos de formularios de 44 px.
- Se probó seleccionar el plan semanal (precio y período actualizados), añadir una cuenta de pago sin guardar y añadir/eliminar un segundo intervalo sin guardar. No se enviaron mensajes ni comprobantes ni se modificaron datos reales.
- Hallazgo corregido: horas de 85 px recortaban AM/PM a 320 px; ahora miden 189 px y muestran el valor completo con selector nativo. A 640/1280 px mantienen la fila horizontal.

## Publicación y verificación privada

- Commit de código `ac478e4ba1228028ec0033bf885f8ca6223807ee`, enviado a `main`. [CI 38842485486](https://github.com/andresleosan/SarinBotSAAS/actions/runs/38842485486): tipos/pruebas/builds, reglas/recorrido con emuladores y configuración Cloudflare aprobados. La portada pública se omite mediante `[CF-Pages-Skip]`.
- Imagen `sarin-bot:compact-forms-20261016t025030z`, ID `sha256:36547e6c6a40cab94d03a415c14f0cc51d9b3ffbbc925347e4a464a8a099e012`. Fuente exacta de 107 archivos del commit; archivo de construcción SHA-256 `04e47526f2c3f375da6f4308e1469dd50b6bcc0313491b37233abc6ccc709369`.
- Actualización de imagen revisada independientemente: 28 límites de autenticación, páginas/recursos, lecturas Firebase y catálogo Ollama correctos antes y después. Webhook WhatsApp sigue deshabilitado (GET/POST 503); ninguna inferencia ni envío de mensajes.
- Se conserva una instancia, el entorno, administrador, proveedor, credenciales y DNS. Hash del entorno `2e38c04933bd69d0c1b03ea1ef152a433f90bd0f1589a8e917ffee2f34cc05f3`; nuevo hash Compose `e0461c0548942f7f4cbfa92d9833fae920a0d6e2760407312d450772014e0457`.
- Rollback privado preparado en `/opt/sarin-bot/runtime/rollbacks/compact-forms-image-update-20261016T024836Z-f1028030`, con la imagen previa conservada. El wrapper privado revisado `run-reviewed-compact-forms-image-update.py rollback RUTA` restaura el Compose respaldado y comprueba el servicio.
- Chrome autenticado en la instancia privada: campos, dos cuentas de pago, precios y proveedor local confirmados sin guardar cambios. A 1.772 px de viewport, el formulario de facturación pasó de 1.132 a 660 px de alto (−42 %); el panel completo, de 3.713 a 2.834 px (−24 %), con el mismo contenido real.
- Capturas privadas fuera de Git: `compact-forms-admin-private.png`, `compact-forms-onboarding-desktop.png`, `compact-forms-hours-mobile.png`, bajo `%LOCALAPPDATA%/SarinBot/deployment/`. Las de negocio y móvil usan datos sintéticos.
- QA detenido; puertos 3040/8080/9099/4400/4500 libres y acceso privado por 3032 conservado.
