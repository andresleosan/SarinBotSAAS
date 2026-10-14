# Sarin Core y Vault Implementation Plan

**Goal:** completar el Core SaaS y añadir una bóveda personal local, siguiendo `arquitectura_maestro_sarin_bot.md` y los requisitos del usuario.
**Architecture:** monolito modular Next.js App Router; Admin SDK para toda mutación y autorización; IndexedDB exclusivamente para contenido Vault. Inferencias transitorias por túnel privado, con cola FIFO por prioridad en un único proceso Node.
**Tech Stack:** Next.js 16, React 19, TypeScript estricto, Tailwind CSS, Firebase Client/Admin, Ollama OpenAI-compatible, Web Crypto e IndexedDB.
**Spec:** `../../../arquitectura_maestro_sarin_bot.md` y ampliación Sarin Vault solicitada el 2026-10-13. El usuario indicó ejecución directa por fases.

## Restricciones

- Sin mocks ni datos bancarios ficticios. Sin Firebase Storage, Google Calendar API ni contenido Vault en Firestore.
- UID superadmin solo de entorno servidor. Tokens Bearer verificados con revocación.
- Horarios America/Bogota. Prueba única de 7 días; gracia preventiva de 24 horas limitada por período; aprobación idempotente de 30 días.
- `CRITICAL` adelanta espera `NORMAL`, conserva FIFO y no interrumpe inferencias activas. Cola en memoria exige una instancia/proceso.

## Tareas y contratos

- [x] Auditar todos los archivos existentes. Hallazgo: todos los flujos operativos eran prototipos con estado local y contexto ficticio; faltaban auth, reglas, escrituras y Vault.
- [x] Core compartido: `types/firestore.ts`, `types/chat.ts`, Firebase lazy singleton; `server/auth.ts` (`requireUser`, `requireSuperadmin`), `server/http.ts` (validación/errores), `sarin/subscription.ts` (expiración real).
- [x] Inferencia: `PriorityFifoQueue.run(task, priority, {signal})`, `engine.completeChat` (credenciales CF solo servidor, modelo principal/visión local, no-store, timeouts, redirecciones prohibidas), `health` real. Pruebas: prioridad/FIFO/capacidad/cancelación, motor caído, visión, credenciales y respuestas inválidas.
- [x] Backend SaaS: configuración validada, proyección pública sin correo dueño, calendario y herramientas ejecutables. Reservar con bloqueo recurso/día y recalcular dentro de transacción; pruebas de carreras y buffers. Recibos Base64 separados y revisión transaccional, sin doble extensión o gracia repetida.
- [x] UI SaaS: AuthProvider, isla realtime, chat serializado con lotes de 2.5 segundos, onboarding formulario y chat, agenda/bloqueos, descarga QR, pago real, admin con bancos/aprobación/monitor. Verificar sin credenciales: estados de configuración y acceso; con emulador: aislamiento.
- [x] Vault: IndexedDB por UID, CRUD de hilos, adjuntos optimizados, API exclusiva `CRITICAL`, análisis financiero estructurado, tablas y recordatorios `.ics`; exportación limpia o AES-GCM/PBKDF2 e importación transaccional. Pruebas de aislamiento, persistencia, corrupción/contraseña, esquema y auth antes de body.
- [x] Cierre: TypeScript, suite completa, emulador Firestore, auditoría npm, build y revisión independiente de seguridad; documentar límites y configuración pendiente para despliegue real.

## Riesgos que las pruebas deben resolver

1. Dos clientes reservan el mismo recurso/día sin citas previas: una sola reserva confirmada.
2. Dos aprobaciones del mismo recibo: una sola extensión de 30 días.
3. Mensajes enviados mientras el modelo genera: siguiente lote, sin solicitudes superpuestas ni texto perdido.
4. Importación maliciosa/corrupta o contraseña incorrecta: ninguna escritura parcial ni reemplazo silencioso de hilos existentes.
5. Usuario autenticado ajeno al UID admin: 403 antes de procesar contenido personal.

No hay repositorio Git inicializado en el directorio entregado; no se crean commits ni worktrees artificiales. No se aplican migraciones a datos reales durante esta implementación.
