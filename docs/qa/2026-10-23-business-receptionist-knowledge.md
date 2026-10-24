# P4: información empresarial para recepción

Jornada del 23 de octubre de 2026, Colombia; recibos UTC del 24 de octubre. Base aislada `8daa77e5582302e6fab3d812ba9447e4308566ee`, ya verificada en producción por CI #42. El checkout original de E: se conserva sin modificaciones. Protocolo: [business-receptionist-knowledge.md](../../qa/tests/business-receptionist-knowledge.md).

## Alcance

Las respuestas de ubicación, modalidad, catálogo, precio y detalle de servicio utilizan la configuración guardada y autorizada del negocio. El clasificador selecciona una intención; el servidor compone la respuesta con formatos cerrados. Descripciones, categorías e indicaciones no se añaden al contexto del proveedor. No se incorpora FAQ editable, otra inferencia, canal, campo persistido o migración.

La guía del dueño explica qué información se usa, la diferencia entre edición y guardado, la confirmación de citas y los límites del tono. Las variantes de salud y representación de menores conservan el formulario y las autorizaciones existentes.

## Evidencia automatizada

- Formato puro, `2997954`: RED por módulo ausente; GREEN 18 casos. Revisión independiente aprobada sin hallazgos.
- Guía y composición real, `2d4c56b`: RED por componente/composición ausentes; GREEN 170 casos en 12 archivos. Revisión independiente aprobada; sólo avisos preexistentes de react-test-renderer y rendimiento del runner.
- Integración del chat, `d442558`: 183 casos en 12 archivos aprobados. Cubre ID explícito, recursos heredados/expresos, descarte de borrador, relectura después del motor simulado, replay estable y bloqueo por políticas.
- La integración detectó el último servicio eliminado: el helper devolvía catálogo vacío. `5c22ce2` prioriza el fallback de ID eliminado; dos regresiones fallaron antes del cambio y los 20 casos del helper pasaron después. La revisión de esa corrección quedó aprobada. La ruta cubre tanto catálogo con otro servicio como catálogo vacío, sin rescatar una selección.
- TypeScript sobre `d442558`: `tsc --noEmit`, exit 0, 7,541 s. Build de producción: `next build`, exit 0, 21,907 s, red externa/credenciales bloqueadas. Lockfile sin cambios; se restaura únicamente el archivo generado `next-env.d.ts`.
- Las tres revisiones focales, la corrección del helper y la revisión final de `8daa77e..d442558` quedaron aprobadas, sin hallazgos pendientes. La revisión final comprobó además la relectura autorizada de `chat.ts`, los normalizadores existentes y la presentación como texto de React.
- Suite general sobre `d442558`: **3610 pruebas aprobadas, 28 omitidas; 228 archivos aprobados y 4 omitidos**, exit 0. Vitest 233,49 s; runner 234,034 s. Las pruebas condicionadas a emuladores/journey se ejecutan en su gate dedicado de CI; no se habilitó la prueba de proveedor real. Avisos preexistentes de react-test-renderer y rendimiento del runner, sin fallos. Lockfile SHA-256 `f035b6bd0ddb862b899be3e15ec8115cf0a47ac508f8d1e644899aa902e12358` conservado.

Node 24.22.0, pnpm 11.23.0, Vitest 5.0.4, TypeScript 5.9.3 y Next 16.4.1. Se usan los binarios instalados tras verificar versiones y lockfile, sin instalaciones. Los recuentos focales se solapan y no se suman.

## Navegador y límites

Chrome sobre `http://127.0.0.1:3046`. El montaje utilizó Auth/Firestore emulados, proyecto `demo-sarin-bot`, negocio sintético, servicios con descripción/categoría y ubicación ficticia. La red externa del servidor y Ollama estuvieron bloqueados; no se enviaron mensajes reales ni se realizaron pagos o inferencia. El consentimiento sintético se sembró en el fixture; no se aceptaron acuerdos en el navegador.

| Comprobación | Resultado observado |
| --- | --- |
| Guía inicial y teclado | Cerrada al entrar; Enter abre/cierra. Resumen de 44 px, foco visible con anillo azul. Tab avanza al control siguiente sin activarlo. |
| 1280 / 390 / 320 px | Documento de 1265 / 375 / 305 px; sin desbordamiento horizontal. Texto ajustado a una columna. |
| Edición de reglas | El formulario muestra «Cambios sin guardar» y la guía explica la diferencia. Abrir/cerrar y editar produjo sólo tres GET de comprobación, ningún POST ni chat. Al recargar vuelve el valor publicado. |
| Edición de ubicación | Cambiar la dirección y abrir la guía produjo cero peticiones API en el intervalo observado. La ficha pública conserva la dirección original. |
| Salud | Desaparecen tono, indicaciones y Preparar con Sarin. La guía explica formulario sin IA y ubicación/contacto públicos. |
| Menores | En general con representación habilitada aparece el uso del formulario y representación autorizada; en general sin esa opción desaparece el texto. |
| Configuración inicial | Con onboarding incompleto: Configurar manualmente → datos ficticios → revisión → Cómo responde Sarin. La guía muestra que guardar actualiza la página de reservas. No se guardó el borrador. |
| Ficha pública | Ubicación e indicaciones originales y catálogo básico visibles. Nuevas reservas siguen bloqueadas hasta el consentimiento de negocio; no se abrió chat ni se aceptó ese consentimiento. |

Capturas sintéticas: [guía](2026-10-23-business-receptionist-preview.png), [1280 px](2026-10-23-business-receptionist-1280.png), [320 px](2026-10-23-business-receptionist-320.png), [salud](2026-10-23-business-receptionist-health.png). Sin errores de consola observados al cierre.

El zoom nativo al 200 % no quedó verificado: los atajos no cambiaron el DPR observado (1). El viewport no se presenta como sustituto; tampoco se acredita una sesión audible de lector de pantalla. La primera búsqueda del botón de secciones en onboarding incompleto no encontró coincidencias porque el flujo inicial exige formulario y revisión; se comprobó después por esa navegación real.

Se restauró el viewport y se cerró la pestaña propia. No se instalaron interceptores. El recibo del launcher quedó `stopped` y los seis puertos 3046/8080/9099/4400/4500/9150 libres. Los avisos de tipo de módulo y metadata lookup pertenecen al montaje emulado y su bloqueo de credenciales/red; el seed y las variantes confirmaron sus escrituras sintéticas.

Los cambios durante interpretación, relectura autorizada y replay se verificaron con motor simulado en pruebas de ruta. Una prueba de intención forzada no demuestra precisión de un proveedor real ni comprensión de cualquier paráfrasis. La emulación Firestore tampoco acredita el runtime D1 de producción.

## Decisiones de ejecución

1. Se ejecutó el diseño P4 ya delegado con la autorización de continuar y publicar. Coste si la interpretación fuera incorrecta: retirar el incremento de aplicación, sin migrar datos.
2. Se reutilizó el worktree aislado y la versión vigente de dependencias, conservando sólo `main` en el remoto. El checkout original continúa separado y necesita su propia reconciliación.
3. CI #42 sobre la base exacta sustituyó la repetición de una suite basal sin cambios. La fuente final debe superar todas las comprobaciones antes de publicar.
4. PowerShell preparó los briefs y paquetes de revisión equivalentes. Un error al recortar contexto podría omitir un contrato; las revisiones focales y final contrastan los límites.
5. Formato y guía se implementaron en paralelo con archivos independientes; el chat consume el helper revisado. Una incompatibilidad exige corregir antes de publicar.
6. Cada implementador ejecutó pruebas focales; la raíz conserva suite completa, tipos, build, navegador y despliegue. Falta de evidencia integrada bloquea la publicación.
7. Se conserva el scratch local y se archivará fuera de Git. La limpieza análoga de P3 fue rechazada por revisión automática; no se repite el borrado. El coste es espacio local, sin afectar la fuente publicada.

## Publicación

Entrega validada localmente y preparada para el push autorizado a `main`. El [workflow existente](https://github.com/andresleosan/SarinBotSAAS/actions/workflows/verify.yml) vuelve a verificar calidad/builds, Firebase/journey y Cloudflare antes de desplegar el mismo SHA en Worker, contenedor y Pages. Esta evidencia local no atribuye a P4 el despliegue anterior ni anticipa el resultado remoto; el run asociado al commit y el recibo externo de release registran ese resultado.
