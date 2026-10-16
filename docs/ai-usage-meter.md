# Consumo de DeepSeek y Gemini en administración

El panel privado muestra las llamadas y tokens registrados por mes de `America/Bogota`, tanto en total como por negocio. El acceso requiere el UID superadministrador verificado en el servidor. El selector consulta el historial de DeepSeek o Gemini y no cambia la IA activa. No es una factura ni consulta el saldo de las cuentas de proveedores. WhatsApp todavía no está conectado y su consumo no se incluye.

## Qué se mide

Cada intento de llamada a DeepSeek o Gemini desde chat de cliente, copiloto u onboarding tiene un identificador aleatorio del servidor. Cada ronda de herramientas cuenta por separado. Ollama y Vault quedan fuera de esta medición de API de pago. Un intento que devuelve tokens válidos se registra aunque después falle la validación de la respuesta del asistente. Un fallo de conexión o respuesta sin consumo válido se muestra como consumo desconocido, no como inferencia gratuita.

Se conservan solo metadatos numéricos, modelo, fecha, resultado y referencia de negocio; no mensajes, prompts, respuestas, nombres, teléfonos, correos, UID de clientes, argumentos de herramientas ni credenciales. Los nombres de negocios en pantalla provienen de la lista administrativa existente.

La medición empieza con el primer registro persistido. No reconstruye llamadas anteriores. Los errores al confirmar escrituras se informan desde el inicio del proceso; una confirmación fallida no demuestra que Firestore no haya guardado el registro. Un reinicio borra ese contador en memoria. Por eso la cobertura se presenta como mejor esfuerzo y nunca como conciliación contable completa.

## Estimación de costo

Tarifas verificadas el 15 de octubre de 2026 para `deepseek-flash`, USD por millón de tokens:

| Tipo | Fuera de pico | Pico |
| --- | ---: | ---: |
| Entrada con acierto de caché | 0,003 | 0,006 |
| Entrada sin acierto de caché | 0,15 | 0,30 |
| Salida | 0,60 | 1,20 |

El panel muestra un rango aplicando ambas tarifas a los tokens registrados. No intenta inferir los festivos chinos ni reproducir la liquidación por horario de DeepSeek. Los acumulados usan unidades enteras de milmillonésimas de USD para evitar redondeo por llamada. Una respuesta con modelo desconocido conserva los tokens válidos pero no recibe una tarifa inventada. Los costos desconocidos se excluyen de la suma y se señalan explícitamente; si ninguna llamada tiene costo estimable, el costo es desconocido.

Fuente: [precios oficiales de DeepSeek](https://api-docs.deepseek.com/quick_start/pricing/) y [campos de consumo de la respuesta](https://api-docs.deepseek.com/api/create-chat-completion/). La tarifa es una referencia versionada en código; debe revisarse cuando el proveedor anuncie cambios. El panel usa USD y no presupone una TRM actual. Los ejemplos en COP y la propuesta comercial están en [Premium WhatsApp](whatsapp-premium-proposal.md).

### Gemini

Para `gemini-3.5-flash-lite` Standard, la tarifa verificada el 16 de octubre de 2026 es USD 0,30 por millón de tokens de entrada, USD 0,03 de entrada recuperada de caché y USD 2,50 de salida, incluidos los tokens de razonamiento. Se estima solo cuando la respuesta confirma ese modelo y `serviceTier=standard`; otro modelo, tarifa desconocida o tokens inconsistentes quedan sin costo estimable. Fuente: [precios oficiales de Gemini](https://ai.google.dev/gemini-api/docs/pricing).

El transporte normaliza la entrada como `promptTokenCount + toolUsePromptTokenCount` y la salida como `candidatesTokenCount + thoughtsTokenCount`, sin contar dos veces el razonamiento. El total debe coincidir con entrada más salida; los aciertos de caché se descuentan de la entrada normal. El panel usa una estimación bruta de API: no descuenta créditos ni beneficios del plan de Google, cuya aplicación a la cuenta todavía no está verificada. No incluye almacenamiento explícito de caché, herramientas facturadas por Google ni impuestos. Cada respuesta de Sarin puede originar varias llamadas. La [configuración de Gemini](gemini-provider.md) es independiente del selector de historial.

## Persistencia y límites

- `aiUsageCalls/{callId}`: registro idempotente de una llamada; el identificador se genera en el servidor, nunca se toma del cliente.
- `aiUsageMonths/{YYYY-MM}`: acumulado mensual, actualizado en la misma transacción que el registro.
- `aiUsageMonths/{YYYY-MM}/businesses/{id}`: acumulado por negocio, con una referencia separada para configuración inicial sin negocio.
- `aiUsageMeta/main`: inicio de medición de DeepSeek.
- Gemini usa `aiUsageCalls/gemini_{callId}`, `aiUsageMonths/gemini_{YYYY-MM}` y su subcolección `businesses`, además de `aiUsageMeta/gemini`. Conserva el historial de DeepSeek sin migrarlo ni sobrescribirlo.

Las reglas deniegan acceso directo desde Firebase cliente a todas estas rutas, incluso con claims de administrador. `GET /api/admin/ai/usage?month=YYYY-MM&provider=gemini` usa autenticación de servidor, valida el mes y el proveedor y devuelve `no-store`; omitir `provider` conserva DeepSeek. Parámetros de proveedor duplicados o desconocidos se rechazan después de autorizar al solicitante. Lee acumulados, no escanea llamadas históricas. La lista por negocio se limita a 500 filas y avisa si hay más; el total mensual incluye todas. El inicio de medición y los fallos al confirmar escrituras se mantienen separados por proveedor.

Las transacciones evitan contar dos veces el mismo identificador. Una nueva llamada real, incluso si el usuario reintenta una solicitud, tiene otro identificador y puede generar nuevo consumo. Los fallos del registro no reintentan inferencias ni herramientas y no convierten una reserva ya confirmada en un error de chat.

Tres escrituras por llamada habitual (registro, mes y negocio), más el inicio de medición cuando corresponda. El escenario alto ilustrativo de 36.000 llamadas al mes supone unas 108.000 escrituras adicionales, además de lecturas transaccionales y la actividad normal de Sarin. No hay borrado automático ni TTL habilitado; los registros crecen con el uso y requieren una política de retención antes de crecer a muchos negocios. No se modifica el plan Firebase ni se habilita facturación.

No se añade una recarga, límite monetario, alerta de saldo ni corte por presupuesto. La cola, cuatro rondas y límites de tokens existentes se conservan. El operador sigue controlando las cuentas y presupuestos de los proveedores. Una estimación no autoriza cobros adicionales a clientes.

## Reversión

Antes de volver a una imagen que no admita Gemini, seleccionar IA local o DeepSeek desde administración si Gemini estaba activo. Esa imagen conserva el medidor anterior de DeepSeek; no mostrará los registros de Gemini, que permanecen guardados. No hay migración, sobrescritura de negocios ni eliminación de datos. Consultar el medidor no cambia la selección de IA, las suscripciones ni las cuentas de pago.
