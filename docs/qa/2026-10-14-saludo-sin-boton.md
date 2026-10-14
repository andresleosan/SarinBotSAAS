# Saludo sin botón — 14 de octubre de 2026

Se elimina el botón circular de pausa solicitado por el propietario, junto con sus iconos, estado y estilos. La entrada dura 3,8 segundos, se ejecuta una vez y conserva la pose de saludo y el globo visibles. Mantiene pausa automática fuera de pantalla y en pestaña oculta, movimiento reducido y respaldo estático sin JavaScript.

Validación previa: `npm run build:landing`, `npm run check:landing` (41 archivos), `npm run typecheck` y `git diff --check` aprobados. Revisión independiente sin bloqueantes. Chrome real confirma cero botones dentro de la escena, duración 3,8 s, una sola iteración, mascota y globo con opacidad final 1; consola sin errores ni advertencias. No se añaden dependencias ni integraciones; no cambian datos, autenticación o APIs.

Publicado en [sarinbotsaas.pages.dev](https://sarinbotsaas.pages.dev/#tu-agenda), commit `345f8e7f29e31544955a3fcb725d54fb17c0a68f`, despliegue de producción [40a8f9d6](https://40a8f9d6.sarinbotsaas.pages.dev/). HTTP 200; CSS público sin estilos del control y con la entrada de 3,8 s. Chrome en producción confirma cero botones en la escena, una iteración y saludo/mascota con opacidad 1; consola limpia. [Captura publicada](sarin-saludo-sin-boton-publicado.png).

Reversión disponible: despliegue anterior `ba6690e7` o reversión del commit.
