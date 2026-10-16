# Consumo de DeepSeek en administración

El panel privado muestra las llamadas y tokens registrados por mes de `America/Bogota`, tanto en total como por negocio. El acceso requiere el UID superadministrador verificado en el servidor. No es una factura ni consulta el saldo de la cuenta DeepSeek. WhatsApp todavía no está conectado y su consumo no se incluye.

## Qué se mide

Cada intento de llamada a DeepSeek desde chat de cliente, copiloto u onboarding tiene un identificador aleatorio del servidor. Cada ronda de herramientas cuenta por separado. Ollama y Vault quedan fuera de esta medición de API de pago. Un intento que devuelve tokens válidos se registra aunque después falle la validación de la respuesta del asistente. Un fallo de conexión o respuesta sin `usage` se muestra como consumo desconocido, no como inferencia gratuita.

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

## Persistencia y límites

- `aiUsageCalls/{callId}`: registro idempotente de una llamada; el identificador se genera en el servidor, nunca se toma del cliente.
- `aiUsageMonths/{YYYY-MM}`: acumulado mensual, actualizado en la misma transacción que el registro.
- `aiUsageMonths/{YYYY-MM}/businesses/{id}`: acumulado por negocio, con una referencia separada para configuración inicial sin negocio.
- `aiUsageMeta/main`: inicio de medición global.

Las reglas deniegan acceso directo desde Firebase cliente a todas estas rutas, incluso con claims de administrador. `GET /api/admin/ai/usage?month=YYYY-MM` usa autenticación de servidor, valida el mes y devuelve `no-store`. Lee acumulados, no escanea llamadas históricas. La lista por negocio se limita a 500 filas y avisa si hay más; el total mensual incluye todas.

Las transacciones evitan contar dos veces el mismo identificador. Una nueva llamada real, incluso si el usuario reintenta una solicitud, tiene otro identificador y puede generar nuevo consumo. Los fallos del registro no reintentan inferencias ni herramientas y no convierten una reserva ya confirmada en un error de chat.

Tres escrituras por llamada habitual (registro, mes y negocio), más el inicio de medición cuando corresponda. El escenario alto ilustrativo de 36.000 llamadas al mes supone unas 108.000 escrituras adicionales, además de lecturas transaccionales y la actividad normal de Sarin. No hay borrado automático ni TTL habilitado; los registros crecen con el uso y requieren una política de retención antes de crecer a muchos negocios. No se modifica el plan Firebase ni se habilita facturación.

No se añade una recarga, límite monetario, alerta de saldo ni corte por presupuesto. La cola, cuatro rondas y límites de tokens existentes se conservan. El operador sigue controlando el saldo DeepSeek. Un rango estimado no autoriza cobros adicionales a clientes.

## Reversión

Volver a la imagen anterior desactiva el nuevo registro y su pantalla. Los documentos nuevos se conservan; no hay migración, sobrescritura de negocios ni eliminación de datos. La selección de IA, las suscripciones y las cuentas de pago no cambian con esta ampliación.
