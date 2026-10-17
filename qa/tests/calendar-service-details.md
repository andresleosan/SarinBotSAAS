# Protocolo: detalles del servicio

Usar exclusivamente `demo-sarin-bot`, Auth/Firestore en loopback y las cuentas sintéticas locales. Mantener intacta la sesión administrativa real. Ejecutar mediante CUA; no aceptar acuerdos de usuarios reales.

1. Crear una fixture exclusiva con servicios de metadatos completos, campos opcionales ausentes/precio cero y descripción larga con Unicode, saltos de línea y etiquetas HTML literales. Incluir buffer para distinguirlo de la duración. Registrar sus identificadores y rutas creadas.
2. Compilar e iniciar la preview emulada sin Next dev simultáneo. Entrar con Cliente local, abrir el negocio de la fixture y elegir calendario con los consentimientos sintéticos previos de la fixture.
3. Comprobar que no aparece resumen sin servicio; seleccionar uno y verificar categoría, descripción, duración sin buffer y precio COP, antes del profesional.
4. Consultar horarios y seleccionar uno. Cambiar de servicio: resumen actualizado, recurso/hora/disponibilidad anteriores limpios y propuesta deshabilitada hasta elegir otra hora. Comprobar precio cero y ausencia de párrafos vacíos.
5. Seleccionar texto largo y comprobar que las etiquetas siguen siendo texto, los saltos de línea se conservan y no hay desbordamiento horizontal. Revisar 320×740, 390×844 y escritorio; comprobar navegación con teclado y foco visible.
6. Preparar una propuesta: selección congelada y detalles legibles; teléfono y preguntas mantienen sus campos existentes. Iniciar otra reserva cuando esté permitido y comprobar selección/resumen vacíos.
7. Revisar consola y red para errores de la interfaz y ausencia de solicitudes de inferencia. Complementar con pruebas de componente para datos históricos malformados, identidad, permisos y recuperación; no atribuir esas simulaciones al navegador.
8. Guardar capturas sintéticas, reporte Markdown y HTML ignorado; restaurar viewport. Limpiar solo rutas que la fixture acredita como propias y detener únicamente procesos creados para la prueba.

Verificación automatizada: `pnpm test -- tests/structured-booking.test.tsx`, `pnpm test`, `pnpm run typecheck`, `pnpm audit --audit-level=high` y `git diff --check`. La imagen de producción congelada debe compilar y pasar humo aislado sin red/credenciales antes de solicitar publicación.
