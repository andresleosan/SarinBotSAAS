# Saludo sin contador — 14 de octubre de 2026

Petición del propietario: quitar la fila «Mensaje 2 de 5» y «Leer los 5 mensajes». Se retiran el contador, el enlace y el modo de lectura asociado. Los cinco textos y el recorrido de vuelo continuo se conservan, junto con las pausas automáticas y la preferencia de movimiento reducido.

Verificación previa a publicación: `npm run build:landing`, `npm run check:landing` (41 archivos), `npm run typecheck` y `git diff --check` aprobados. Chrome local confirma cero elementos de controles/transcripción y animación `sarin-tour-flight` activa de 8,8 s. Consola sin errores ni advertencias. Revisión independiente sin bloqueantes. Sin cambios en dependencias, APIs, credenciales o datos.

Reversión: restaurar el despliegue Pages `496e9e4d-8bbc-4285-87ba-fc23b4dcd455` o revertir el commit de esta eliminación.

Publicación y captura: pendientes de verificar después del despliegue automático.
