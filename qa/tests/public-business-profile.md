# Recorrido de la ficha pública

Suite de aceptación para Chrome mediante CUA. Usar exclusivamente `dev:local`, proyecto `demo-sarin-bot`, cuentas emuladas y negocios sintéticos; no enviar mensajes al motor ni aceptar condiciones de producción.

1. Abrir `/b/[slug]` sin sesión: nombre, categoría, catálogo, precio COP, duración, horario Colombia y contacto aparecen antes de Google.
2. Comprobar 320 y 390 px con nombre largo y servicio sin espacios: sin desbordamiento horizontal, acción de 44 px visible después de la identidad.
3. Comprobar escritorio: ancho máximo 896 px y columnas catálogo/horario.
4. Pulsar Reservar: aparece el acceso existente. Volver al negocio recupera el perfil.
5. Activar Reservar y Volver al negocio con Enter.
6. Entrar como Cliente local: se mantienen permisos, chat general y Mis citas; la cita sintética existente aparece sin aceptar nuevas autorizaciones.
7. Salir: reaparece el perfil público.
8. Abrir negocio pausado: conserva información y cambia la acción a Ver mis citas.
9. Entrar desde Ver mis citas: la cita existente sigue disponible y la entrada de nuevas solicitudes está deshabilitada.
10. Abrir slug inexistente: aviso y retorno al inicio sin exigir Google.
11. Inspeccionar consola: sin errores inesperados; mantener inferencia deshabilitada.
12. Restaurar viewport y opciones temporales de prueba; cerrar pestaña y retirar exclusivamente datos sintéticos del fixture.

El error/reintento, la sesión aún pendiente y el cambio de negocio tienen además pruebas automatizadas en `tests/public-business-entry.test.tsx`; la lista permitida y los límites de autorización se verifican en `tests/business-read-routes.test.ts` y el recorrido local existente.
