# Reutilizar el motor local de Sarin

Puedes conectar varios proyectos al mismo motor Ollama de la Mac. Cada proyecto necesita su propia integración de servidor, instrucciones, contexto y controles de acceso.

## Motor, aplicación y herramientas

Ollama ejecuta los modelos descargados y ofrece una API compatible con OpenAI. El modelo principal verificado en la Mac es `qwen3.8:27b-q4_K_M`. Compartirlo no copia usuarios, negocios ni conversaciones.

Sarin SaaS añade autenticación, agenda y herramientas para consultar disponibilidad, crear citas y configurar negocios. El dueño también puede consultar resúmenes y bloquear horarios. Estas operaciones existen porque la aplicación las implementa, valida y autoriza; un prompt por sí solo no las proporciona. Sarin no incluye un agente general que inspeccione repositorios, escriba código o despliegue otros proyectos.

Cada integración debe definir qué información puede consultar y qué acciones puede ejecutar. Mantén separados los usuarios, datos y permisos de cada proyecto. Solicita al operador una credencial Access dedicada y su autorización en la política correspondiente; no reutilices el token de Sarin. Coordina también la concurrencia: la cola de Sarin vive en su proceso y no coordina otras aplicaciones.

## Prompt para el integrador de otro proyecto

> Integra el motor Ollama existente de Sarin en **[nombre del proyecto]** para **[objetivo concreto]**. Realiza las peticiones desde el servidor hacia la URL HTTPS autorizada terminada en `/v1/chat/completions`, usando el modelo `qwen3.8:27b-q4_K_M`. Guarda la URL y las credenciales propias del proyecto en configuración privada del servidor; envía `CF-Access-Client-Id` y `CF-Access-Client-Secret` sin exponerlos al navegador, Git ni logs. Define como instrucciones del asistente: **[rol, idioma, contexto permitido, límites y formato esperado]**. Conserva el aislamiento de datos y autentica cada operación. Habilita únicamente herramientas implementadas y autorizadas por este proyecto; confirma sus resultados antes de comunicar éxito. Documenta las pruebas realizadas y las dependencias pendientes.

## Orden de validación

1. Consulta `/v1/models` desde el servidor y comprueba el identificador exacto del modelo.
2. Ejecuta una respuesta sintética breve, sin herramientas ni información personal. En Sarin, `doctor --engine` comprueba el catálogo y `doctor --generate` solicita texto sintético; ninguno necesita Firebase.
3. Prueba las herramientas con datos aislados y emuladores antes de habilitar escrituras reales. El chat de Sarin no ofrece un modo `dry-run`: puede crear negocios, citas o bloqueos. `GET /api/session` también puede escribir el perfil del usuario.

El cambio de DNS que estaba pendiente el 14 de octubre de 2026 se aplicó el día 15; ver [QA del cambio DNS](qa/2026-10-15-dns-cutover.md). La recuperación del conector de la Mac y la inferencia remota con Ollama siguen pendientes. Las comprobaciones parciales no acreditan un recorrido completo entre otro proyecto, Access, el túnel y Ollama. Verifica ese recorrido antes de anunciar la integración disponible.
