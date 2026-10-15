# DeepSeek como opción B manual

Decisión del 15 de octubre de 2026: activación manual y temporal desde el servidor para chat de negocio, copiloto y onboarding mientras se recupera la Mac. El proveedor predeterminado sigue siendo Ollama. No hay conmutación automática ni reintento de un turno con otro proveedor.

Estado posterior del mismo día: la conexión con la Mac y el chat autenticado quedaron verificados y el proveedor activo volvió a **Ollama**. La clave DeepSeek permanece en el runtime privado para volver a seleccionarlo manualmente si se necesita. Se conserva la misma imagen; [evidencia y reversión](qa/2026-10-15-dns-cutover.md).

## Límite de privacidad

Cuando se selecciona DeepSeek, la API recibe las instrucciones, el historial enviado en la solicitud, el contexto del negocio y los resultados de herramientas que necesite el chat. Esto puede incluir los datos de contacto y reserva que el usuario introduzca. No debe describirse este modo como inferencia local.

Vault conserva su almacenamiento en el navegador y fuerza Ollama para texto, imágenes y análisis de transcripciones. Si la Mac falla, Vault muestra indisponibilidad; sus consultas no se redirigen a DeepSeek. Las credenciales Cloudflare Access se usan exclusivamente para el transporte Ollama. DeepSeek recibe solo su clave Bearer, nunca los headers de Access.

## Configuración de servidor

```dotenv
SARIN_CHAT_PROVIDER=deepseek
DEEPSEEK_MODEL=deepseek-flash
DEEPSEEK_API_KEY=<clave privada fuera de Git>
```

El único modelo admitido inicialmente es `deepseek-flash`. El destino está fijado a `https://api.deepseek.com/chat/completions`; no se permite configurar un destino externo arbitrario. Se usa `thinking: {type: "disabled"}`, herramientas compatibles con OpenAI y respuestas sin streaming. Esta integración acepta texto; la visión continúa exclusivamente en Vault/Ollama. [Modelos y tarifas](https://api-docs.deepseek.com/quick_start/pricing/), [modo de razonamiento](https://api-docs.deepseek.com/guides/thinking_mode/) y [herramientas](https://api-docs.deepseek.com/guides/tool_calls/).

No añadir la clave a `NEXT_PUBLIC_*`, Docker ARG, comandos pegados en el historial, archivos del repositorio, logs ni capturas. Guardarla en el archivo runtime privado, con acceso solo del administrador del servidor. La imagen no contiene secretos.

## Activación, verificación y retorno

1. Desplegar una imagen con el soporte y conservar la imagen anterior y una copia privada del runtime para rollback.
2. Guardar la clave y la selección en el archivo runtime de la VPS. Mantener la configuración Ollama/Access intacta.
3. Recrear únicamente el servicio `app` con el Compose privado que ya usa el servidor. Mantener una sola réplica; prever que una recreación interrumpe solicitudes en curso.
4. Con una sesión válida, comprobar `/api/sarin/health`: proveedor `deepseek`, estado online. La prueba de catálogo valida clave y modelo, pero no garantiza saldo ni capacidad de generar. Realizar después una única conversación sintética y comprobar una llamada de herramienta sin escrituras reales.
5. Como superadministrador, comprobar `/api/sarin/health?scope=vault`: proveedor `ollama`, estado independiente. Nunca debe presentarse DeepSeek como salud de Vault.
6. Al recuperar la Mac, verificar modelo y respuesta local antes de cambiar `SARIN_CHAT_PROVIDER=ollama` y recrear `app`. No modifica los DNS ni las rutas Cloudflare.

`docker compose restart` no recarga las variables del archivo runtime. `pnpm run doctor -- --engine` sigue diagnosticando exclusivamente Ollama/Vault; `--generate` utiliza Ollama y no realiza una prueba DeepSeek.

`pnpm run dev:local` fija Ollama y neutraliza las variables DeepSeek heredadas o de dotenv. El ensayo `test:journey` también rechaza claves o selección de proveedor cloud. Las pruebas automatizadas de la integración utilizan respuestas sintéticas, sin consumir saldo.

Ante errores de clave, saldo, límites o conexión, Sarin devuelve un error controlado. No registra ni devuelve el cuerpo de error del proveedor. No cambia de proveedor ni repite acciones ya realizadas por herramientas.

## Coste y límites

Tarifa oficial consultada el 15 de octubre de 2026, por millón de tokens de Flash sin aciertos de caché: entrada USD 0,15–0,30 y salida USD 0,60–1,20 según horario. Un ejemplo de 1.000 llamadas de 2.000 tokens de entrada y 500 de salida cuesta aproximadamente USD 0,60–1,20 antes de impuestos. Son llamadas al modelo, no conversaciones completas: las rondas de herramientas y el historial aumentan el consumo. La tarifa puede cambiar; revisar el [precio vigente](https://api-docs.deepseek.com/quick_start/pricing/).

Se conservan límites por usuario, cola de inferencia, cuatro rondas por turno y hasta 4.096 tokens de salida por llamada. Estos límites no equivalen a un presupuesto mensual. Esta implementación no crea recargas, alertas ni un límite monetario propio; controlar saldo y consumo en la plataforma DeepSeek.
