# Seleccionar IA local o DeepSeek

El superadministrador elige IA local (Ollama) o DeepSeek desde `/admin` para chat de negocio, copiloto y onboarding. El proveedor predeterminado sigue siendo Ollama. No hay conmutación automática ni reintento de un turno con otro proveedor.

Antecedente del 15 de octubre de 2026: DeepSeek se activó temporalmente mientras se recuperaba la conexión con la Mac. Después se verificaron Ollama y el chat autenticado y se volvió a **Ollama**, conservando la clave DeepSeek en el runtime privado; [evidencia histórica](qa/2026-10-15-dns-cutover.md). La selección desde el panel sustituye la edición del entorno para alternar proveedores.

## Límite de privacidad

Cuando se selecciona DeepSeek, la API recibe las instrucciones, el historial enviado en la solicitud, el contexto del negocio y los resultados de herramientas que necesite el chat. Esto puede incluir los datos de contacto y reserva que el usuario introduzca. No debe describirse este modo como inferencia local.

Vault conserva su almacenamiento en el navegador y fuerza Ollama para texto, imágenes y análisis de transcripciones. Si la Mac falla, Vault muestra indisponibilidad; sus consultas no se redirigen a DeepSeek. Las credenciales Cloudflare Access se usan exclusivamente para el transporte Ollama. DeepSeek recibe solo su clave Bearer, nunca los headers de Access.

## Configuración de servidor

```dotenv
SARIN_CHAT_PROVIDER=ollama
DEEPSEEK_MODEL=deepseek-flash
DEEPSEEK_API_KEY=<clave privada fuera de Git>
```

El único modelo admitido inicialmente es `deepseek-flash`. El destino está fijado a `https://api.deepseek.com/chat/completions`; no se permite configurar un destino externo arbitrario. Se usa `thinking: {type: "disabled"}`, herramientas compatibles con OpenAI y respuestas sin streaming. Esta integración acepta texto; la visión continúa exclusivamente en Vault/Ollama. [Modelos y tarifas](https://api-docs.deepseek.com/quick_start/pricing/), [modo de razonamiento](https://api-docs.deepseek.com/guides/thinking_mode/) y [herramientas](https://api-docs.deepseek.com/guides/tool_calls/).

No añadir la clave a `NEXT_PUBLIC_*`, Docker ARG, comandos pegados en el historial, archivos del repositorio, logs ni capturas. Guardarla en el archivo runtime privado, con acceso solo del administrador del servidor. La imagen no contiene secretos. Instalar o rotar una credencial requiere recrear únicamente `app` para cargarla; el selector no admite ni devuelve claves.

La selección se guarda en `serverSettings/ai` mediante `GET/PATCH /api/admin/ai`, exclusivamente para el UID superadministrador. Los clientes Firebase no pueden leer ni escribir ese documento directamente. Si no existe, el servidor utiliza `SARIN_CHAT_PROVIDER` y luego Ollama por defecto. Una selección guardada prevalece sobre el entorno: cambiar ese env no la sustituye. Un valor persistido inválido falla de forma controlada.

## Activación, verificación y retorno

1. Desplegar una imagen con el soporte y conservar la imagen anterior y una copia privada del runtime para rollback.
2. Verificar la configuración privada del destino, incluida la clave DeepSeek si se va a seleccionar. Mantener la configuración Ollama/Access intacta.
3. Con una sesión de superadministrador, seleccionar el destino y guardar desde `/admin`. El servidor valida configuración y catálogo antes de persistir. El cambio no reinicia la aplicación: afecta nuevas solicitudes, y cada turno en curso conserva su proveedor hasta terminar las herramientas.
4. Con una sesión válida, comprobar `/api/sarin/health`: proveedor elegido y estado online. La prueba de catálogo valida clave y modelo, pero no garantiza saldo ni capacidad de generar. Realizar después una única conversación sintética autorizada y comprobar una llamada de herramienta sin escrituras reales.
5. Como superadministrador, comprobar `/api/sarin/health?scope=vault`: proveedor `ollama`, estado independiente. Nunca debe presentarse DeepSeek como salud de Vault.
6. Para volver a IA local, verificar modelo y respuesta de la Mac y seleccionar Ollama desde el mismo panel. El selector no modifica DNS, rutas Cloudflare, variables de entorno, facturación ni cuentas bancarias.

`docker compose restart` no recarga las variables del archivo runtime. `doctor` diagnostica la configuración base de Ollama/Vault y no consulta la selección privada del panel; `--generate` utiliza Ollama y no prueba DeepSeek. Para conocer el proveedor efectivo del chat, utiliza las API autenticadas del panel o de salud.

Una reversión a una imagen anterior al selector vuelve al comportamiento basado en `SARIN_CHAT_PROVIDER` e ignora `serverSettings/ai`. Comprueba la salud y el proveedor efectivo después de ese rollback. Conserva el documento y sus cambios salvo que se autorice una reversión específica.

`pnpm run dev:local` fija Ollama y neutraliza las variables DeepSeek heredadas o de dotenv. El ensayo `test:journey` también rechaza claves o selección de proveedor cloud. Las pruebas automatizadas de la integración utilizan respuestas sintéticas, sin consumir saldo.

Ante errores de clave, saldo, límites o conexión, Sarin devuelve un error controlado. No registra ni devuelve el cuerpo de error del proveedor. No cambia de proveedor ni repite acciones ya realizadas por herramientas.

## Coste y límites

Tarifa oficial consultada el 15 de octubre de 2026, por millón de tokens de Flash sin aciertos de caché: entrada USD 0,15–0,30 y salida USD 0,60–1,20 según horario. Un ejemplo de 1.000 llamadas de 2.000 tokens de entrada y 500 de salida cuesta aproximadamente USD 0,60–1,20 antes de impuestos. Son llamadas al modelo, no conversaciones completas: las rondas de herramientas y el historial aumentan el consumo. La tarifa puede cambiar; revisar el [precio vigente](https://api-docs.deepseek.com/quick_start/pricing/).

Se conservan límites por usuario, cola de inferencia, cuatro rondas por turno y hasta 4.096 tokens de salida por llamada. Estos límites no equivalen a un presupuesto mensual. Esta implementación no crea recargas, alertas ni un límite monetario propio; controlar saldo y consumo en la plataforma DeepSeek.

El [medidor de administración](ai-usage-meter.md) muestra llamadas y tokens registrados por negocio y mes, y un costo estimado en USD. Cuenta las rondas de herramientas por separado y avisa sobre uso desconocido. No reconstruye el pasado, consulta saldo ni reemplaza la liquidación del proveedor. DeepSeek descuenta el costo por tokens del saldo otorgado/recargado; no cobra una mensualidad fija por usar su API.
