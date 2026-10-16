# Cuotas comerciales e integración WhatsApp

Alcance: implementar la [estructura comercial aprobada](../../commercial-plans.md), autorizado expresamente por el propietario con «implementemos todo». Confirmó prueba de siete días con 700 respuestas, copiloto en la bolsa del negocio y un límite separado antes de crear el negocio. WhatsApp se prepara completamente en código y pruebas sintéticas; el propietario todavía no tiene el número y avisará para conectar una prueba real.

Se usan los precios y capacidades aprobados. Se mantienen Firebase, una réplica de aplicación, selección manual Ollama/DeepSeek y Vault exclusivamente en el navegador. No se habilitan cargos automáticos ni envíos reales de WhatsApp en esta entrega.

## Responsabilidades y contratos

### 1. Períodos, capacidad y comprobantes

Archivos: `src/lib/billing-plans.ts`, `src/types/firestore.ts`, `src/lib/server/response-quota.ts`, `src/lib/server/billing.ts`, esquemas y rutas administrativas/de facturación; pruebas de cuotas, pagos, reglas y Firestore emulado.

- Períodos privados por negocio: inicio, vencimiento, plan, respuestas incluidas, ampliadas, consumidas y reservadas. Trial: 700; semanal: 700; quincenal: 1.500; mensual: 3.000; WhatsApp: 4.500. Onboarding previo al negocio: 30 respuestas por cuenta, sin reinicios para obtener más capacidad.
- Renovación anticipada crea un período futuro y conserva la bolsa actual. Compra de paquetes fija el período destinatario al enviar el comprobante; aprobar añade 1.000 respuestas sin ampliar fechas. Un período ya vencido exige revisión del pago, no transferencia silenciosa a otro período.
- Recibos discriminan suscripción y ampliación; preservan precio, días, capacidad y período al momento de compra. La gracia por un comprobante de suscripción no repone capacidad agotada. Las ampliaciones no conceden gracia.
- `reserveResponseQuota({businessId,actorUid,mode,requestId,fingerprint,channel}, db?)`: reserva atómica o resultado ya completado. Mismo identificador con otro contenido: 409. Concurrencia no permite superar capacidad.
- `commitResponseQuota(reservation, response?, db?)` y `releaseResponseQuota(reservation, db?)`: transición idempotente. Sin cuerpos de conversaciones en el registro comercial. Las reservas interrumpidas por caída quedan identificadas; no se liberan por reloj sin saber si hubo una operación confirmada.
- `getResponseQuota(businessId, db?)`: resumen calculado para propietario/administrador, con estados normal, aviso al 80%, agotado y sin período; GET no genera un nuevo período ni escrituras.

Pruebas: última respuesta concurrente; repetir confirmación/liberación; IDs con contenido diferente; cuotas de prueba y onboarding; renovación anticipada; paquete aprobado dos veces; paquete vencido; rechazo sin cambios de vigencia; 79/80/100%; acceso cruzado denegado.

### 2. Chat compartido y conteo de respuestas

Archivos: nuevo `src/lib/server/chat.ts`, `src/types/chat.ts`, adaptador `src/app/api/sarin/chat/route.ts`, tipos mínimos del actor en reservas/negocios y `tests/chat-route.test.ts`.

- `runSarinChat({user,body,signal?,channel})` comparte herramientas e inferencia entre web autenticada y trabajador WhatsApp autenticado por servidor. `ChatActor` contiene identidad verificada por cada transporte, no un token Firebase ficticio.
- Reservar una unidad dentro de la cola, antes de inferir. Todas las rondas consumen esa misma unidad. Respuesta completa o confirmación verificable de una reserva guardada: confirmar una unidad; fallo sin resultado ni mutación: liberar.
- Reintentos ya completados no vuelven a inferir. Caché acotada solo en memoria para repetir una respuesta; las citas se vuelven a leer para no reconfirmar una cancelada. Sin caché ni operación reconstruible se informa que el turno ya fue atendido, sin inventar su texto.
- Fallos del contador posteriores a una reserva guardada no hacen que el cliente repita una operación confirmada. Mantener reserva retenida para conciliación.
- WhatsApp usa solo modo cliente y fuerza el teléfono de la reserva al remitente verificado. No puede invocar herramientas administrativas ni configuración inicial.

Pruebas: una cuota para varias llamadas; fallo de proveedor; reserva guardada antes del fallo; repetición y cambio de payload; agotamiento antes de inferencia; identidad WhatsApp y teléfono; aislamiento entre negocios.

### 3. Cliente y administración

Archivos: páginas de facturación y administración, nuevos componentes de capacidad/WhatsApp, cliente HTTP y hook de chat.

- Mostrar capacidad por vigencia separada del medidor técnico mensual. Ampliación por comprobante con precio y vencimiento visibles. Recibos y aprobación identifican correctamente paquete o renovación.
- Al 80%, aviso visible; agotado, pausa de IA con agenda accesible. Chat público no expone precios, consumo privado ni credenciales.
- Mostrar preparación WhatsApp y catálogo contratado solo cuando el servidor confirme elegibilidad. Cotización de mayor volumen sin inventar tarifas a medida.

Pruebas UI con datos sintéticos de cada estado, errores, recibos pendientes, WhatsApp no conectado y revisión visual a 320 px.

### 4. WhatsApp Cloud API

Archivos del módulo `src/lib/server/whatsapp-*`, webhook público firmado, API administrativa protegida, inicialización de trabajador y pruebas dedicadas.

- API oficial de Meta; verificación de challenge y HMAC-SHA256 sobre bytes crudos. Límite de payload, validación, deduplicación por identificador Meta y asociación autorizada número/negocio.
- Bandeja persistente y salida persistente con reclamación transaccional, recuperación del trabajador y concurrencia acotada. Responder dentro de la ventana de 24 horas; sin campañas ni recordatorios proactivos.
- Cifrar contenido necesario de mensajes con clave exclusiva del servidor; historial acotado y limpieza documentada. Secretos fuera de Git y del navegador. Estado sin configuración no simula conexión.
- Distinguir envío aceptado, entrega y lectura; fusionar estados fuera de orden por identificador, sin contar dos veces una entrega. Un timeout ambiguo al enviar no desencadena repetición automática que pueda duplicar el mensaje.
- Preparar lectura de uso Meta indicando si faltan tarifas/datos; no presentarlo como factura exacta. El consumo de entrega es separado del costo de IA.

Pruebas sintéticas: firma inválida, challenge, webhook duplicado, tenant incorrecto, estado read sin delivered, ventana vencida, respuesta lenta/fallo/timeout ambiguo, recuperación tras interrupción y ausencia de credenciales. Ninguna prueba envía mensajes reales.

## Integración, revisión y publicación

Cada área empieza con pruebas que fallen por el comportamiento nuevo y entrega evidencia dirigida. Ejecutar después tipos, suite completa, reglas/transacciones con emuladores, recorrido local, build y revisión independiente de autorización, cuotas y webhooks. Conservar lockfile y trabajo previo del usuario.

Revisión visual de propietario, administración y estados de consumo. Actualizar documentación y estado real de tareas. Push y CI; despliegue de la instancia privada solo con comprobaciones y rollback de imagen revisables. La publicación comercial de funcionalidades depende de su verificación. WhatsApp permanece sin conexión real hasta que el propietario entregue el número para la prueba acordada.

## Focos de revisión

1. Reservar atómicamente antes de llamadas o herramientas: una última unidad no permite dos respuestas concurrentes.
2. Un fallo después de guardar una cita no provoca una segunda cita ni una devolución insegura de capacidad.
3. Renovaciones y paquetes no alteran el período o precio de un comprobante pendiente.
4. Ni el navegador ni un webhook pueden elegir otro negocio, actor administrativo o proveedor.
5. Reentregas de Meta y estados fuera de orden no duplican inferencia, envío ni consumo.
