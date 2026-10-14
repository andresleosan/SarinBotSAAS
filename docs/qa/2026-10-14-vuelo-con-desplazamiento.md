# Vuelo con desplazamiento — 14 de octubre de 2026

Corrección solicitada: reproducir el desplazamiento de ALS DevStudio, con el giro al frenar. La versión anterior oscilaba cerca del saludo; ahora entra desde fuera por la izquierda, frena con giro, muestra el mensaje y sale completamente por la derecha. Solo cambia el CSS y su descripción de diseño; se mantienen los cinco textos, contador, lectura completa, pausa automática y movimiento reducido.

Referencia inspeccionada: `https://www.alsdevstudio.com/#sarin-flight` y módulo público `scripts/modules/mascot-scenes.js`. Escena amplia, recorrido lateral, duración 8,8 s; el giro se concentra antes del saludo.

Verificación previa: build de Pages, comprobación de artefacto (41 archivos), TypeScript y revisión de diff aprobados. Revisión independiente sin bloqueantes. Chrome real en escritorio: escena de 1120 px, posiciones observadas desde −214 hasta 1306 px; parada con globo y mascota visibles. Orden observado `3 → 4 → 5 → 1 → 2 → 3`, confirmando reinicio. En móvil de 320 px: escena de 265 px, posiciones de −88 a 331 px y sin desbordamiento de página (305/305 px útiles). Preferencia de viewport restaurada. Consola sin errores ni advertencias.

Publicado en [sarinbotsaas.pages.dev](https://sarinbotsaas.pages.dev/#tu-agenda), commit `888773e2f8147df881b671a29f71671b8d39cda8`, despliegue [496e9e4d](https://496e9e4d.sarinbotsaas.pages.dev/), confirmado como producción. HTTP 200 y CSS lateral de 8,8 s presente. Chrome público confirmó posiciones de −214 a 1306 px en la escena de 1120 px, parada con texto visible y consola limpia. [Captura de la vista pública de lectura](sarin-vuelo-lateral-publicado.png); se devuelve la pestaña al recorrido activo después de comprobarla.

Reversión: despliegue anterior `4d3627ba` o reversión del commit de CSS.
