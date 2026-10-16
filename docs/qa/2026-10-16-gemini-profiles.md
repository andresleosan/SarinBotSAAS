# Perfiles Gemini separados en administración

Solicitud: distinguir Gemini de AI Studio para pruebas del Gemini que podrá atender a clientes, y reconocer la IA que está en uso.

## Resultado

- «Gemini · Clientes» conserva la selección manual y la exigencia de facturación verificada. El historial usa la misma etiqueta y conserva sus datos.
- «En uso para los negocios» y la etiqueta de la tarjeta representan la selección guardada, no el radio que todavía no se ha guardado.
- «Gemini · Pruebas» es un bloque informativo independiente. Solo lee `GEMINI_TEST_API_KEY` y `GEMINI_TEST_MODEL`; no hereda configuración de clientes, no consulta Google ni modifica la selección de negocios. Una clave configurada no acredita conexión, plan ni cuota.
- El perfil de pruebas no añade un chat dentro de Sarin. El enlace a AI Studio abre las pruebas manuales externas, únicamente con datos ficticios. No se instalaron claves ni se habilitó facturación.

## Validación

- TDD: fallos previos observados para el nuevo perfil, su representación en UI y el aislamiento de los runners. Los casos añadidos cubren claves independientes, ausencia de fallback, valores inválidos, rechazo del cuarto proveedor y preservación de la selección.
- `pnpm exec vitest run tests/admin-ai.test.ts tests/admin-ai-page.test.tsx tests/admin-ai-usage.test.tsx tests/local-development.test.ts tests/engine-gemini.test.ts tests/engine-health.test.ts`: 105 pruebas aprobadas.
- Delta posterior de aislamiento de `GEMINI_TEST_*`: `admin-ai`, `local-development` y `local-journey`, 58 pruebas aprobadas, incluidas las 11 del recorrido local aislado. No se hizo ninguna generación real con Gemini.
- `pnpm run typecheck`: aprobado. Revisión independiente de seguridad/UI y scripts de despliegue sin bloqueadores.
- [CI del commit 90cf4ca](https://github.com/andresleosan/SarinBotSAAS/actions/runs/38857693310): los tres trabajos aprobados, incluidos tipos/pruebas/builds, reglas Firebase y recorrido completo local, y dry-run de Cloudflare.

## Navegador

Chrome, copia aislada del commit con Firebase emulado en `127.0.0.1:3040`, administrador sintético. Tres radios de clientes, ningún campo ni selector en el perfil de pruebas. Actualizar el estado conserva los perfiles pendientes. Consultar el historial «Gemini · Clientes» conserva la selección de Ollama. Consola sin errores observados.

Escritorio: viewport 1474 px, documento 1459 px. Móvil: viewport 390 px, documento 375 px, bloque de pruebas de 309 px y enlace de 44 px de altura; sin desbordamiento horizontal. Vista y controles legibles. Override de viewport restablecido; QA cerrada y puertos liberados, conservando el túnel privado 3032.

Capturas privadas, fuera de Git, en `%LOCALAPPDATA%/SarinBot/deployment/`: `gemini-profiles-qa-desktop.png` y `gemini-profiles-qa-mobile.png`.

## Instancia privada

Código `90cf4ca89704916bf258b8da08ca930cf1a09d36`, imagen `sarin-bot:gemini-profiles-20261016t055009z`, ID `sha256:67816e580e223d095e9523491120c3e092fa62b70682339706fc0d7569c592e3`. Fuente exacta de 112 archivos; archivo SHA-256 `73b64749cf7919256506d8fc09b28f35c9041a5c45dae887cd1fedf30cd3435d`.

Activación privada aprobada: 28 comprobaciones de autorización, 34 HTTP, lecturas Firebase y catálogo de Ollama con modelo presente, antes y después. Entorno, administrador, proveedor base, DNS y réplica única conservados. No se publicó el backend público. Rollback preparado en `/opt/sarin-bot/runtime/rollbacks/gemini-profiles-image-update-20261016T054746Z-c4be5085`.

La verificación visual autenticada del panel privado queda pendiente de completar el selector de Google del propietario. La UI descrita arriba fue verificada en el entorno aislado, no se presenta como una captura de la sesión real.
