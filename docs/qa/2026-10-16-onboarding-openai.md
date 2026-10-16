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

## Resultado de la actualización privada

- Commit de código `eb15c8250424dcfb86807feb23af914d9c92f1b0`, subido a `main`.
- [CI 38845972774](https://github.com/andresleosan/SarinBotSAAS/actions/runs/38845972774): tres jobs correctos, incluidos build, reglas Firebase, recorrido local y dry-run Cloudflare. Las reglas cubren también las rutas de consumo OpenAI.
- Cloudflare Pages confirmó el commit como `skipped / No deployment available`; la portada pública conservó su versión anterior.
- Imagen privada `sarin-bot:onboarding-openai-20261016t033210z`, ID `sha256:3a0d6379b8b02b1f20c3e2d0efc42fd888ad3159537f22ccd974f291c568a48c`; 111 archivos desde los blobs exactos del commit. Archivo fuente SHA-256 `69e52d163d5822d24c6a5aba3309e31e5686ee6687768bd511d8e98c7b44b513`.
- Activación satisfactoria: 28 comprobaciones de autenticación y 34 HTTP, assets, lecturas Firebase y catálogo de Ollama. Entorno byteidéntico, una réplica, usuario Node, raíz de solo lectura y acceso loopback conservados. Sin clave OpenAI ni cambio de proveedor.
- Copia privada de reversión verificada: `/opt/sarin-bot/runtime/rollbacks/onboarding-openai-image-update-20261016T033136Z-75851414`.
- Se detuvieron los nueve procesos del entorno QA; túnel privado 3032 conservado.

La comprobación visual posterior con la sesión Google real quedó pendiente: el control de Chrome exigió actualizar la extensión de ChatGPT. Se avisó al usuario. La revisión visual anterior en emuladores y las pruebas de foto/fallback sí se completaron; no se afirma haber visto aún la foto real cargada.
