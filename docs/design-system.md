# Identidad visual de Sarin

La dirección vigente es **Agenda clara**, elegida por el propietario el 13 de octubre de 2026. Sustituye la primera propuesta inspirada en [ALS DevStudio](https://www.alsdevstudio.com/) para dar identidad propia a Sarin. La mascota y el vuelo conservan el vínculo con el estudio. Sarin organiza citas y conversaciones, por lo que la interfaz de trabajo prioriza lectura y acciones.

## Sistema

- Fondo `#f7f9ff`: continuidad con la portada clara. Papel `#fff`: superficies de lectura y edición.
- Tinta `#162344` y secundario `#52617d`: contraste sobre blanco. Azul `#315ff3`: acción principal, foco y sección activa. Líneas `#e0e6f1` y fondo suave `#edf1ff`: organización discreta de datos.
- DM Sans en títulos, cuerpo y formularios; horas e importes con cifras tabulares. Archivos WOFF2 latinos servidos desde este proyecto, con licencias OFL adjuntas; ninguna llamada a Google Fonts desde el navegador.
- Navegación lateral en escritorio y desplazable en móvil. Encabezados claros, una acción principal por bloque, ayudas y estados con texto además de color.
- Firma visual: rostro de Sarin en la marca, agenda ilustrativa y recorrido de vuelo de cinco mensajes en la portada. En la agenda y los asistentes comerciales se reserva el espacio para datos y conversación. Las etiquetas e iconos decorativos retirados por el propietario se mantienen fuera de la portada.
- Foco azul visible, controles con área táctil suficiente, movimiento reducido y adaptación desde 320 px. Sin métricas o clientes inventados en el producto; los datos de aceptación son explícitamente sintéticos y exclusivos de emuladores.

## Referencias consultadas mediante el MCP oficial de Mobbin

### Estado de las conexiones de IA (16 de octubre de 2026)

Administración conserva Agenda clara y DM Sans. Una franja suave y la etiqueta «En uso» distinguen la selección guardada del radio que se está editando. «Gemini · Clientes» permanece entre las tres opciones para negocios; «Gemini · Pruebas» se presenta debajo, separado por una línea, con estado de clave y conexión por separado. No se usa color como único indicador ni una cuarta opción de selección que pudiera enviar conversaciones reales al perfil de pruebas.

### Densidad de formularios (15 de octubre de 2026)

A petición del propietario, los formularios aprovechan mejor el ancho disponible: 12 px entre campos relacionados, 16 px entre grupos y 24 px entre secciones. Se conserva Agenda clara, DM Sans, el azul de acción y controles de al menos 44 px. Las acciones secundarias comparten la cabecera cuando caben; los bloques se ajustan a su contenido, sin alturas vacías. Los horarios se alinean por día en escritorio y se apilan en móvil. La configuración del negocio prioriza el formulario frente al espacio vacío del asistente.

Referencia adicional inspeccionada con el MCP de Mobbin: [Square: edición de horarios](https://mobbin.com/screens/6b2d38fe-14c7-4c70-9982-fb8aafab787c), por sus filas de día, inicio y fin, separadas con líneas discretas.

### País y número de WhatsApp (15 de octubre de 2026)

El formulario del negocio separa el país y su indicativo del número nacional en una fila compacta. El selector muestra una bandera SVG y el indicativo, con nombres de países en español al abrir la lista. Colombia es el valor inicial para campos vacíos; los teléfonos existentes conservan su valor internacional. Se mantienen Agenda clara, DM Sans, foco azul y altura táctil de 44 px. Las banderas se incluyen en la aplicación y no dependen de servidores externos ni del soporte de emojis del dispositivo.

### Referencias iniciales

La conexión oficial `https://api.mobbin.com/mcp` se autenticó mediante OAuth. Las búsquedas se ejecutaron con un host MCP CLI de solo lectura porque la sesión de trabajo ya abierta no incorpora herramientas nuevas dinámicamente.

- [Unify: historial y conversación](https://mobbin.com/screens/09c29920-400c-4d21-9eba-b057f8759c50): historial lateral, ancho de lectura limitado y compositor inferior.
- [Gumloop: chat con adjunto](https://mobbin.com/screens/cc947af7-dfb4-46ca-8496-d2ea3e044fc5): adjuntos junto al mensaje y controles compactos.
- [Square: disponibilidad semanal](https://mobbin.com/screens/784bbf80-5fb1-4250-af8f-5e15f49745c3): horarios alineados y diferencias claras entre bloques.
- [Calendly: presentación de reservas](https://mobbin.com/screens/5c90bdb0-4b1c-4c4c-adb3-1a63581d6ed1): explicar el producto con un recorrido de reserva junto al CTA.

Se adaptan patrones de interacción. La paleta actual es Agenda clara y la mascota procede de la web del propietario; las capturas de terceros no se incorporan al producto ni al repositorio.

## Imagen de la cita — 16 de octubre de 2026

«Guardar imagen de la cita» sustituye la exportación `.ics` para reservas futuras confirmadas. La tarjeta PNG se genera en el navegador con Agenda clara —fondo `#f7f9ff`, papel blanco, tinta `#162344` y azul `#315ff3`— y DM Sans autoalojada. Prioriza negocio, servicio, fecha y hora en `America/Bogota`; añade el profesional o recurso asignado solo si está disponible. No incluye correo, teléfono ni respuestas del formulario del cliente. Es una copia estática, sin integración de calendario ni recordatorios automáticos: debe remitir a «Mis citas» para consultar cambios o cancelaciones.
