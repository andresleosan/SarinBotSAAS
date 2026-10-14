# Sarin — Agenda clara

Dirección elegida por el propietario el 13 de octubre de 2026 entre las tres propuestas presentadas. Cambio acotado a la portada, con su variante temporal `comingSoon`.

- Fondo `#f7f9ff`: da aire al contenido y separa Sarin de la identidad oscura de ALS DevStudio.
- Superficies `#ffffff` y líneas `#e0e6f1`: hacen legible la agenda sin decoración orbital.
- Texto `#162344` y secundario `#52617d`: jerarquía y contraste sobre fondos claros.
- Azul `#315ff3` y suave `#edf1ff`: acciones, citas ilustrativas y selección de horario, según la propuesta aprobada.
- Tipografía: DM Sans local para títulos, cuerpo y datos; mantiene el carácter geométrico de la propuesta sin añadir descargas externas. Pesos 400–700; horas con cifras tabulares.
- Composición: navegación horizontal con separador, titular centrado y agenda blanca como elemento principal. Bordes de 10–20 px, sombras suaves y espacios amplios.
- Firma: la semana ilustrativa y un selector local de horarios muestran la relación entre conversación y agenda. La mascota y el favicon con la cara de Sarin conservan su identidad.
- Ajuste solicitado: la cara del favicon identifica también cabecera y pie. Bajo la agenda, Sarin entra desde fuera por la izquierda, frena con un giro, aterriza y sale por la derecha, siguiendo la traslación de ALS DevStudio. La escena aprovecha el ancho disponible; en móvil se acorta el recorrido conservando entrada/salida completas. Explica cinco aspectos de la app: presentación, servicios/horarios, enlace/QR, conversación y agenda. Cada escena dura 8,8 segundos y las cinco se repiten continuamente por elección del propietario. El texto avanza con la vuelta completa, sin temporizadores independientes; se pausa al salir de pantalla o al ocultar la pestaña. Movimiento reducido y HTML sin JavaScript muestran el saludo estático. Una opción textual «Leer los 5 mensajes» detiene el recorrido y presenta todo el contenido; no vuelve el botón circular.
- La portada temporal mantiene el aviso de lanzamiento. Los horarios son ejemplos sin conexión con datos, registro o reservas. El componente compartido conserva sus enlaces SaaS cuando `comingSoon` es falso.
- Calidad: adaptación desde 320 px, controles de al menos 44 px, foco azul visible, tabla semántica, selección anunciada y movimiento reducido respetado.

Verificación prevista: build/export de Pages, validación del artefacto sin configuración privada y revisión real en navegador de escritorio/móvil, enlaces y selección de horario. Reversión: despliegue anterior `a57cacb9` de Pages o reversión del commit de diseño.
