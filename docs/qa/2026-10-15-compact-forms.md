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

CI y actualización privada: pendientes al preparar este commit.
