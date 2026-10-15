# Gemini como opción C manual

Estado verificado el 15 de octubre de 2026: soporte preparado para chat de negocio, copiloto y onboarding, con pruebas reales de catálogo y herramientas usando exclusivamente datos sintéticos. El proyecto Google permanece en nivel gratuito y Gemini no está seleccionado como proveedor activo de Sarin. No se ha autorizado ni habilitado facturación Google. El proveedor predeterminado del código sigue siendo Ollama; la selección es manual desde el servidor, sin fallback automático.

## Privacidad y nivel gratuito en Colombia

Colombia figura entre las [regiones disponibles de Gemini API](https://ai.google.dev/gemini-api/docs/available-regions). En el nivel gratuito, Google puede utilizar entradas y respuestas para mejorar sus productos y revisores humanos pueden procesarlas. Sus condiciones indican que no se envíe información personal, confidencial o sensible a ese nivel. La excepción regional de EEE, Suiza y Reino Unido no aplica por estar en Colombia. En la API de pago, mediante un proyecto con facturación activa, Google no utiliza prompts ni respuestas para mejorar productos; conserva tratamiento limitado para seguridad y obligaciones legales. [Condiciones oficiales sobre datos](https://ai.google.dev/gemini-api/terms).

El chat real de Sarin puede enviar historial, contexto del negocio, teléfonos, datos de reserva y resultados de herramientas. Por eso, el estado gratuito preparado se limita a pruebas sintéticas: no activar Gemini para conversaciones reales con esos datos. La decisión de vincular facturación Google y usar la API de pago queda pendiente; configurar una clave o completar estas pruebas no autoriza ese cambio.

La clave dedicada pertenece a `sarinbotsaas`, el mismo proyecto de Firebase. Vincular facturación a este proyecto también cambia Firebase de Spark a Blaze; no hacerlo como un ajuste aislado de Gemini. Deben revisarse el alcance y los costes antes de decidirlo. [Planes Firebase](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans).

Vault conserva sus datos en IndexedDB y fuerza Ollama para texto, imágenes y transcripciones. Sus solicitudes nunca se redirigen a Gemini ni DeepSeek. La integración Gemini de Sarin acepta solo texto, aunque el modelo admita otras modalidades. Las claves de los proveedores y los headers Cloudflare Access permanecen separados en el servidor.

## Configuración manual

Valores para el archivo runtime privado, únicamente cuando el operador haya elegido este proveedor y el uso permitido:

```dotenv
SARIN_CHAT_PROVIDER=gemini
GEMINI_MODEL=gemini-3.5-flash-lite
GEMINI_API_KEY=<clave privada fuera de Git>
```

Solo se admite `gemini-3.5-flash-lite`, publicado como modelo estable con function calling. No se habilitan modelos alternativos automáticamente. [Ficha oficial](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite).

El POST está fijado a `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions` y el catálogo a `https://generativelanguage.googleapis.com/v1beta/openai/models`. Ambos usan exclusivamente Bearer con la clave Gemini. Las respuestas son sin streaming, con `reasoning_effort: "minimal"` y `max_tokens: 4096`; no se envían temperatura ni los ajustes de razonamiento de Ollama o DeepSeek. [Compatibilidad OpenAI](https://ai.google.dev/gemini-api/docs/openai), [ajustes del modelo](https://ai.google.dev/gemini-api/docs/generate-content/whats-new-gemini-3.6).

La firma `tool_calls[].extra_content.google.thought_signature` se conserva exactamente durante las rondas de herramientas, con validación y límite de tamaño. Al enviar historial a otro proveedor, se retiran esos metadatos sin modificar el original. La API Gemini exige conservar las firmas del turno actual. [Contrato de firmas](https://ai.google.dev/gemini-api/docs/generate-content/thought-signatures#openai).

No guardar claves en `NEXT_PUBLIC_*`, argumentos de build, Git, logs, capturas ni comandos del historial. Mantener intactos la URL y los secretos de Ollama/Access. Tras cambiar variables, recrear únicamente el servicio `app` con el Compose privado existente y mantener una réplica; `docker compose restart` no recarga `env_file`. Conservar la imagen y el runtime anteriores para rollback. Para volver a la Mac, verificar primero su inferencia y seleccionar `SARIN_CHAT_PROVIDER=ollama` antes de recrear `app`. Ninguno de estos cambios requiere modificar DNS.

## Verificación realizada y alcance

La prueba real sintética del 15 de octubre pasó el catálogo autenticado, la generación de una herramienta de prueba y la respuesta posterior al resultado de esa herramienta, reenviando la firma de Google. No se utilizaron conversaciones de clientes ni se crearon reservas. El catálogo devuelve identificadores como `models/gemini-3.5-flash-lite`; el probe reconoce un único prefijo `models/` solo para Gemini y conserva comparación exacta en los otros proveedores.

Estas pruebas comprueban el contrato de transporte y las rondas de herramientas; no activan Gemini en producción ni garantizan capacidad permanente. Después de una futura selección autorizada, `/api/sarin/health` debe informar `provider: gemini`. El catálogo por sí solo no acredita disponibilidad de generación. `/api/sarin/health?scope=vault` exige superadministrador e informa exclusivamente Ollama.

`pnpm run dev:local` fija Ollama y neutraliza las variables cloud; `test:journey` rechaza esas credenciales y selecciones. `doctor` sigue siendo el diagnóstico de Ollama/Vault, no una prueba de Gemini. Los tests automatizados del motor utilizan fetch simulado y no consumen cuota.

## Cuota y coste

La tarifa estándar consultada el 15 de octubre de 2026 ofrece entrada y salida sin cargo dentro del nivel gratuito. Los límites dependen del proyecto y modelo; se revisan en AI Studio y no se multiplican creando otra clave del mismo proyecto. Un HTTP 429 indica cuota o límite alcanzado: Sarin devuelve un error controlado, sin repetir la petición ni pasar a otro proveedor. [Tarifa](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.5-flash-lite), [límites](https://ai.google.dev/gemini-api/docs/rate-limits).

Como referencia para una eventual API de pago, la tarifa estándar es USD 0,30 por millón de tokens de entrada y USD 2,50 por millón de salida, incluyendo razonamiento. Un escenario de 1.000 llamadas al mes, con 2.000 tokens de entrada y 500 de salida facturable por llamada, equivale a **USD 1,85/mes antes de impuestos**: USD 0,60 de entrada y USD 1,25 de salida. No son 1.000 conversaciones: historial y rondas de herramientas pueden añadir varias llamadas. No incluye búsquedas, caché ni otros servicios; la integración no los habilita.

La cola, el límite por usuario, las cuatro rondas por turno y el máximo de salida por llamada no son un presupuesto monetario. No se ha configurado un límite mensual propio ni alertas de gasto Google para esta opción. El estado actual sigue siendo gratuito e inactivo para el chat real; cualquier cambio a pago requiere una decisión separada del operador.
