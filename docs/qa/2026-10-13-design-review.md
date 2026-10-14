# Revisión visual e integración — 13 de octubre de 2026

Entorno: Chrome, Next en `127.0.0.1:3030`, Auth y Firestore Emulator oficiales y administrador local. Sin negocio, pagos ni conversaciones inventados; no se ejecutó inferencia. El modelo desconectado se muestra explícitamente.

## Resultado

- Portada comprobada en escritorio y a 360 px; tipografías y mascota cargan desde el mismo origen.
- Vault comprobado a 360, 768 y 1280 px. Sin desbordamiento horizontal; a 1280 px muestra historial de 210 px, chat de 715 px y resumen de 260 px.
- Historial y cuentas móviles se abren y cierran con controles nativos. La exportación abre su diálogo y mantiene el cifrado activado por defecto; se cerró sin crear una copia.
- Una sugerencia prepara el borrador y activa Enviar. Se limpió sin enviar ni guardar un hilo. Mensajes, archivos y cuentas no cambiaron.
- Foco de teclado visible; los paneles claros usan verde oscuro para su contorno. El selector de archivos oculto se acciona desde el botón visible Adjuntar.
- Dashboard comprobado en escritorio y a 360 px: navegación activa, estado vacío y enlaces reales. La consola de Chrome no registró excepciones en este recorrido.
- Se corrigieron durante la revisión caracteres de texto dañados, un salto automático al final del estado vacío y el ajuste de la marca en móvil.

## Evidencia

- [Portada escritorio](landing-als-desktop.png).
- [Portada móvil](landing-als-mobile.png).
- [Vault escritorio](vault-als-desktop.png).
- [Vault móvil](vault-als-mobile.png).
- [Dashboard escritorio](dashboard-als-desktop.png).

## Comprobaciones de código y empaquetado

142 pruebas locales, 7 de Firestore Emulator y 8 de Cloudflare aprobadas. TypeScript de ambos paquetes, build Next, auditorías npm y dry-run completo de Wrangler aprobados. La imagen Docker se construyó y arrancó con usuario sin privilegios, filesystem de solo lectura y cachés temporales: portada, Vault e imágenes respondieron 200, y cinco API protegidas rechazaron solicitudes sin token con 401. El contenedor de esa prueba se detuvo y eliminó al finalizar.

La revisión no simula una aceptación con datos de negocio reales: quedan Firebase/Google OAuth, Ollama, visión y red de Cloudflare reales. No hay despliegue activo ni validación en un dispositivo móvil físico. Los ajustes de viewport del navegador se restauran al finalizar.
