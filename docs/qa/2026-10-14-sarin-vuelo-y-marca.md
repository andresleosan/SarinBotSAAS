# Cara de Sarin y secuencia de vuelo — 14 de octubre de 2026

Solicitud: sustituir los símbolos de calendario de cabecera y pie por la cara del favicon, y añadir la entrada volando con saludo de la web del propietario bajo la agenda.

## Implementación

- Cabecera y pie: `public/brand/sarin-face-mark.png`, copia binaria del favicon Apple de 180 px aprobado. Se sirve desde el propio proyecto.
- Vuelo: `public/brand/sarin-flight.png`, recurso original de `https://www.alsdevstudio.com/assets/brand/mascot-flight.png`, 320 × 383 con alfa y 35 KB. Aterrizaje: mascota de saludo ya existente.
- Secuencia inspirada en el módulo público `scripts/modules/mascot-scenes.js` de ALS DevStudio: entra, aterriza, muestra el globo y sale; ciclos de 8,8 s en escritorio y 8 s en móvil.
- Implementación propia con CSS y un componente pequeño de React, sin bibliotecas ni conexiones externas. El globo conserva el estilo claro/cobalto y el saludo de Sarin.
- Inicio con al menos 30 % de escena visible e imágenes cargadas; pausa manual, al salir de pantalla y al ocultar la pestaña. Se limpian observer y listeners al desmontar.
- Movimiento reducido y HTML sin JavaScript: pose de saludo y texto estáticos. Control de pausa accesible de 44 px.

## Verificación previa

- `npm run typecheck`: aprobado.
- `npm run build:landing`: aprobado después del último cambio de CSS.
- `npm run check:landing`: aprobado, 41 archivos públicos y sin configuración de backend ni enlaces privados.
- `git diff --check`: aprobado.
- Revisión independiente de lógica, ciclo de vida, seguridad y accesibilidad: sin bloqueantes.
- Chrome real: vuelo observado, aterrizaje y globo con opacidad 1; pausa conserva exactamente el transform y el estado de reproducción; reanudación correcta.
- Emulación de movimiento reducido: `data-motion=static`, sin animación ni control, saludo visible. Emulación retirada al finalizar.
- Anchos de 360 y 320 px: sin desbordamiento, globo debajo de la mascota y ciclo móvil de 8 s. Preferencia reducida y tamaño de viewport restaurados después de las pruebas.
- Navegar a lanzamiento deja la escena en pausa y carga correctamente la cara del pie. Cabecera 40/36 px y pie 32 px; enlaces de marca con objetivo mínimo de 44 px.
- Consola sin errores ni advertencias. Sin cambios de dependencias, API, Firebase, datos o autenticación.

## Publicación

Pendiente de registrar el resultado de Pages tras el push.

Reversión: volver al despliegue anterior `42f0e736` de Pages o revertir el commit de este cambio. No hay migraciones.
