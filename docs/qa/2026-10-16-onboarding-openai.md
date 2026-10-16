# Sugerencias, perfil Google y OpenAI — revisión privada

## Alcance

Ejemplos editables para preguntas de reserva e indicaciones; foto de Google con alternativa de inicial; tercer proveedor manual OpenAI con GPT-6 Luna; consumo separado por proveedor y mes. Se conserva la selección existente, Vault local, suscripciones y datos del negocio. Sin activación de OpenAI, inferencia real ni publicación del backend.

## Evidencia previa al release

- 507 pruebas de aplicación pasan; 18 pruebas de integración optativas no forman parte de esa ejecución.
- TypeScript y auditoría de dependencias pasan; sin vulnerabilidades conocidas en la consulta.
- Recorrido en emuladores: autenticación y permisos, onboarding, reserva/idempotencia/concurrencia, cancelación, bloqueos, facturación sintética y aislamiento. 84 comprobaciones verificadas y limpieza de sus datos aprobada.
- Revisión independiente de motor, medidor, API, selección, aislamiento local y scripts de release: sin bloqueadores.
- Chrome sobre snapshot aislado: añadir ejemplos conserva el texto propio, deshabilita duplicados y no guarda automáticamente (recarga recupera los valores previos). Vista de 390 px sin desbordamiento horizontal del documento.
- Administración emulada: tres opciones visibles; OpenAI sin clave aparece deshabilitado. Selector del medidor cambia entre OpenAI y DeepSeek sin cambiar la IA activa. Ausencia de medición se indica explícitamente.
- Foto válida/ausente/error y cambio de URL cubiertos por pruebas de componente sin red. La foto real se comprobará tras la actualización privada.

Capturas y manifiestos se conservan en la carpeta privada de despliegue, fuera de Git. Las pruebas del motor usan respuestas simuladas, no demuestran acceso, saldo, latencia ni calidad de la cuenta OpenAI. La API se factura por separado de ChatGPT. Prueba sintética de API y recorrido completo del negocio real permanecen pendientes.

## Actualización privada y reversión

Construir desde un commit exacto, pasar CI y sustituir solo la imagen de la instancia privada. Conservar entorno, proveedor, UID administrador, DNS, exposición loopback y número de réplicas. Verificar copia de Compose y entorno antes del cambio y comprobaciones de HTTP/autorización, Firebase y catálogo Ollama después.

El rollback restaura la imagen `sarin-bot:service-labels-20261016t031651z`. Si en el futuro se activa OpenAI, volver primero a un proveedor compatible antes de restaurar código anterior; este release no cambia la selección.
