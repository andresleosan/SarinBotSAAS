# Sarin Bot — Multi-Tenant AI Appointment Platform (MVP Blueprint)

## 1. Visión del Producto
Plataforma SaaS Multi-Tenant donde cualquier negocio de servicios por citas (barberías, peluquerías caninas, consultorios, talleres, etc.) opera como una **Isla Privada accesible vía código QR / Link único**.
El corazón del sistema es **Sarin Bot**, ejecutado localmente en una **Mac con 48GB de RAM Unificada** mediante **Ollama** (corriendo **Qwen 3.8 en su versión de 32B parámetros**) y expuesto de forma segura mediante **Cloudflare Tunnel**.

### Reglas de Oro del MVP
1. **Cero Google Calendar API:** Toda la agenda vive en tiempo real dentro de nuestra PWA usando Firestore `onSnapshot` + descarga de archivo `.ics` y notificaciones por correo.
2. **Doble Autenticación con Google (Firebase Auth):** Tanto dueños de negocio como clientes finales (al escanear el QR) inician sesión con 1 clic en Google.
3. **Cero Límites Diarios de Mensajes:** El cliente chatea libremente con Sarin Bot. La saturación se controla con **Debounce de 2.5s en el frontend** + **Cola FIFO en memoria (máx. 4 slots concurrentes)** en el backend hacia Ollama.
4. **Suscripción con Trial de 7 Días + Pago por Capture:** Al terminar el onboarding con Sarin Bot se activan 7 días gratis. Para renovar la mensualidad, el dueño ve los datos bancarios, sube captura del pago (comprimida en el navegador a `.webp`), recibe **24h de desbloqueo preventivo** y el `superadmin` aprueba (+30 días) o rechaza desde `/admin`.

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

## 3. Estructura de Carpetas del Proyecto

- `src/types/firestore.ts`: Esquema completo de colecciones en Firestore.
- `src/lib/sarin/queue.ts`: Semáforo y Cola FIFO en memoria (máximo 4 peticiones paralelas hacia la Mac).
- `src/lib/sarin/availability.ts`: Motor matemático de cálculo de disponibilidad (cruza horarios de apertura, duración del servicio, `bufferMinutes` de limpieza y citas confirmadas).
- `src/lib/sarin/prompts.ts`: Generador de System Prompts con directiva `/no_think`, calendario pre-calculado de 14 días en zona `America/Bogota` y los 3 modos (`sarin_onboarding`, `sarin_client`, `sarin_owner_copilot`).
- `src/lib/sarin/tools.ts`: Definición de herramientas JSON para Function Calling en Ollama.
- `src/hooks/useDebouncedChat.ts`: Agrupador de ráfagas de mensajes (espera 2.5 segundos desde el último mensaje del usuario antes de disparar al backend).
- `src/lib/utils/imageCompression.ts`: Compresor de comprobantes de pago a formato `.webp` (<150KB) en el navegador.
- `src/lib/utils/icsGenerator.ts`: Generador de archivo `.ics` para agregar la cita al calendario del teléfono con un toque.
- `src/app/api/sarin/chat/route.ts`: Endpoint orquestador que valida la suscripción del negocio, encola la petición hacia el Cloudflare Tunnel y ejecuta Tools.
- `src/app/dashboard/*`: Panel del dueño del negocio (Onboarding conversacional, Agenda en vivo, Kit QR y Facturación por Capture).
- `src/app/b/[slug]/page.tsx`: Isla privada del cliente final accesible por QR.
- `src/app/admin/page.tsx`: Consola Super-Admin para aprobar pagos (+30 días), gestionar negocios y monitorear la Mac de 48GB.
