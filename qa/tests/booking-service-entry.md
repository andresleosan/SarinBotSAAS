# Protocolo de entrada por servicio y disponibilidad vacía

Usar CUA, `demo-sarin-bot`, Auth/Firestore oficiales en loopback y cuentas locales sintéticas. No cerrar la sesión real de administración, aceptar sus permisos ni modificar datos de producción.

1. Sembrar fixture exclusiva con dos profesionales, servicios completo/gratuito/texto largo, hoy cerrado y mañana abierto. Constancias de prueba de cuenta/negocio creadas por el helper sintético. Registrar manifiesto, fechas y slug.
2. Compilar preview emulada y servir en 3041 sin Next dev simultáneo. Revisar la ficha a 320/390/1280; botones por servicio accesibles, categorías, texto literal, precio cero y ausencia de desbordamiento.
3. Desde la ficha, elegir el servicio gratuito, acceder mediante Cliente local y comprobar servicio preseleccionado y resumen `0 COP`; profesional/hora vacíos. La navegación sola no debe consultar horarios, proponer, confirmar ni iniciar inferencia.
4. Consultar hoy cerrado: una sola respuesta clara sin horarios, sin error. Cambiar profesional/servicio/día limpia el aviso. Elegir mañana mediante entrada nativa real y consultar: aparecen horas válidas y desaparece el estado vacío.
5. Cambiar manualmente de servicio y comprobar que el sondeo del negocio no restituye la selección de entrada. Iniciar otra reserva deja el servicio vacío. Salir de la cuenta local y volver por «Reservar» general no arrastra el ID anterior.
6. Complementar con pruebas de componente para permisos pendientes, catálogo retirado, cambios de UID/slug/business.id, salud y casos representados; carga, error y respuestas tardías. No atribuir estas simulaciones al navegador si no se ejecutaron allí.
7. Revisar consola y observar solicitudes sin capturar tokens/cuerpos privados. No confirmar citas para probar estas mejoras. Guardar capturas sintéticas y reporte Markdown/HTML; restaurar viewport y cerrar pestaña local.
8. Limpiar solo documentos exactos del manifiesto si no hay cambios posteriores; el helper debe rechazar cualquier selección ajena. Detener únicamente procesos propios y verificar puertos libres.

Comandos: pruebas focalizadas de `public-service-booking-entry`, `public-business-entry`, `business-public-profile`, `structured-booking`, `structured-booking-lifecycle` y `chat-surfaces`; `pnpm test`; `pnpm run typecheck`; `pnpm audit --audit-level=high`; `git diff --check`. Congelar commit limpio, compilar imagen Linux y verificar humo aislado sin red/credenciales antes de solicitar autorización específica de publicación.
