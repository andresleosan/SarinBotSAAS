# Sarin Bot — Multi-Tenant AI Appointment Platform (MVP Blueprint)

## 1. Visión del Producto
Plataforma SaaS Multi-Tenant donde cualquier negocio de servicios por citas (barberías, peluquerías caninas, consultorios, talleres, etc.) opera como una **Isla Privada accesible vía código QR / Link único**.
El corazón del sistema es **Sarin Bot**, ejecutado localmente en una **Mac con 48GB de RAM Unificada** mediante **Ollama** (corriendo **Qwen 3.8 en su versión de 32B parámetros**) y expuesto de forma segura mediante **Cloudflare Tunnel**.

El alcance vigente se centra en la operación comercial de los negocios y las citas de sus clientes. El chat personal y Sarin Vault quedan retirados; no se construirá un servicio independiente de consultas personales dentro de este producto. Los datos que versiones anteriores hayan guardado en navegadores no se borran automáticamente al retirar el módulo.

### Reglas de Oro del MVP
1. **Cero Google Calendar API:** La agenda se consulta mediante API autorizadas y se refresca cada 15 segundos tras cada lectura mientras la pestaña está visible. Se pausa en segundo plano y se actualiza al recuperar foco. Las citas futuras confirmadas permiten descargar `.ics`; no hay un proveedor de correo configurado.
2. **Doble Autenticación con Google (Firebase Auth):** Tanto dueños de negocio como clientes finales (al escanear el QR) inician sesión con 1 clic en Google.
3. **Cero Límites Diarios de Mensajes:** El cliente chatea libremente con Sarin Bot. La saturación se controla con **Debounce de 2.5s en el frontend** + **Cola FIFO en memoria (máx. 4 slots concurrentes)** en el backend hacia Ollama.
4. **Prueba pagada de $5.000 COP y 10 citas + suscripción:** La prueba se activa únicamente al aprobar el pago y permite configurar un negocio y crear diez citas, sin vencimiento por días. No se concede acceso inicial gratuito ni por subir una captura. Al agotar los cupos, el dueño debe contratar un plan. El contador se actualiza atómicamente al crear la cita; cancelaciones y edición de configuración no lo reinician. Los comprobantes se revisan desde `/admin`; las suscripciones conservan sus planes actuales y solo las renovaciones con historial pagado pueden recibir la gracia preventiva existente.

---

## 2. Configuración Local de Ollama en Mac (48GB RAM Unificada)

```bash
export OLLAMA_NUM_PARALLEL=4
export OLLAMA_MAX_LOADED_MODELS=1
export OLLAMA_KEEP_ALIVE=-1
export OLLAMA_FLASH_ATTENTION=1
export OLLAMA_KV_CACHE_TYPE=q8_0
```

Modelo principal recomendado en tus 48GB:
- `qwen3:32b` (o `qwen3:32b-q5_K_M` para máxima fidelidad en Tool Calling JSON).

---

## 3. Arquitectura de datos y ejecución

La arquitectura de producción es Pages → service binding privado → Worker → una instancia Next/Node 24 en Cloudflare Containers. El corte D1/R2 quedó activado y aceptado el 16 de octubre de 2026 con `SARIN_DATA_BACKEND=d1`. D1 es la única fuente comercial, incluidas las proyecciones públicas; R2 privado guarda las imágenes de comprobantes. Firebase se conserva solo para Google Auth y verificación de sesión/revocación. Firestore queda para emuladores y reversión explícita, sin fallback automático autorizado. Se verificaron por hash 19 de 19 documentos, sin archivos, y se aceptaron sesión, lecturas de API y descarga `.ics` en el runtime nuevo. Consulta la [evidencia de datos](docs/qa/2026-10-16-cloudflare-data-migration.md) y el [procedimiento de reversión](docs/cloudflare-data-migration.md).

El contenedor accede al puente privado `sarin-data.internal`; el navegador usa el ID token de Firebase y las API de aplicación. La vista pública solo devuelve `publicBusinesses`, y la agenda/historial filtran UID y negocio en el servidor. Las lecturas periódicas abortan y descartan respuestas al cambiar de identidad o negocio. La interfaz propia conserva el contrato documental; las transacciones D1 usan revisión global, batch atómico y UUID de commit. El puente devuelve `413 DATA_LIMIT` si una lectura supera 1.000 documentos, sin truncamiento silencioso. Las imágenes se suben a R2 antes de confirmar su referencia D1; ambos recursos no comparten transacción.

Se mantiene un proceso y una cola de inferencias en memoria: la atomicidad D1 no habilita varias réplicas de aplicación. Ollama se conecta directamente a la Mac por Tunnel y Access bajo `alsdevstudio.com`; el proceso Sarin de la VPS está detenido y conservado para reversión. Ollama estuvo fuera de línea durante el corte de datos; el 16 de octubre de 2026, hacia las 11:37 UTC, el diagnóstico autenticado volvió a mostrar `online:true` y la cola vacía durante el retiro de Vault. La aceptación de una conversación comercial completa sigue pendiente; consulta la [evidencia del enfoque comercial](docs/qa/2026-10-16-commercial-focus.md). La aceptación del corte no cierra los pendientes comerciales, alertas de gasto ni publicación del código en Git.

## 4. Estructura de Carpetas del Proyecto

- `src/types/firestore.ts`: Contratos de entidades persistidas; el nombre se conserva por compatibilidad histórica y no impone Firestore como almacenamiento.
- `src/lib/storage/`: Interfaz de datos propia y adaptador del puente D1/R2.
- `shared/data-protocol.ts`: Comandos, validación y límites compartidos del puente privado.
- `cloudflare/migrations/0001_data.sql`: Esquema documental D1 e índices de consulta.
- `src/lib/client/api-polling.ts` y `use-api-poll.ts`: Refresco API acotado, pausa en pestañas ocultas y guardas de identidad/negocio.
- `src/lib/sarin/queue.ts`: Semáforo y Cola FIFO en memoria (máximo 4 peticiones paralelas hacia la Mac).
- `src/lib/sarin/availability.ts`: Motor matemático de cálculo de disponibilidad (cruza horarios de apertura, duración del servicio, `bufferMinutes` de limpieza y citas confirmadas).
- `src/lib/sarin/prompts.ts`: Generador de System Prompts con directiva `/no_think`, calendario pre-calculado de 14 días en zona `America/Bogota` y los 3 modos (`sarin_onboarding`, `sarin_client`, `sarin_owner_copilot`).
- `src/lib/sarin/tools.ts`: Definición de herramientas JSON para Function Calling en Ollama.
- `src/hooks/useDebouncedChat.ts`: Agrupador de ráfagas de mensajes (espera 2.5 segundos desde el último mensaje del usuario antes de disparar al backend).
- `src/lib/utils/imageCompression.ts`: Compresor de comprobantes de pago a formato `.webp` (<150KB) en el navegador.
- `src/lib/utils/icsGenerator.ts`: Generador de archivo `.ics` para agregar la cita al calendario del teléfono con un toque.
- `src/app/api/sarin/chat/route.ts`: Endpoint orquestador que valida la suscripción del negocio, encola la petición hacia el Cloudflare Tunnel y ejecuta Tools.
- `src/app/dashboard/*`: Panel del dueño del negocio (Onboarding conversacional, agenda con refresco periódico, Kit QR y Facturación por Capture).
- `src/app/b/[slug]/page.tsx`: Isla privada del cliente final accesible por QR.
- `src/app/admin/page.tsx`: Consola Super-Admin para aprobar pagos (+30 días), gestionar negocios y monitorear la Mac de 48GB.
