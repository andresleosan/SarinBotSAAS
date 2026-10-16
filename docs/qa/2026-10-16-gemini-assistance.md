# Gemini manual y ayudas del formulario

## Alcance verificado

Commit `3e516110e475c226a16b789dd13f1736bb15ba62`: seis sugerencias para preguntas y seis para indicaciones, horarios de ancho acotado, Gemini como tercera opción manual y medidor independiente por proveedor. Las sugerencias conservan el texto propio, evitan duplicados y no guardan el negocio automáticamente.

Gemini usa el modelo `gemini-3.5-flash-lite` y su API nativa. La selección exige clave privada y confirmación operativa de facturación de pago. No hay fallback automático. Vault sigue exclusivamente con Ollama. Las firmas de herramientas se conservan en memoria durante el turno; no llegan al navegador ni al registro de consumo.

## Comprobaciones

- `pnpm test`: 516 correctas, 18 opcionales omitidas en la ejecución local.
- `pnpm run typecheck`: correcto.
- Revisión independiente del motor, autorización, consumo y scripts de actualización sin bloqueadores.
- [Verify Sarin, ejecución 38848347244](https://github.com/andresleosan/SarinBotSAAS/actions/runs/38848347244): los tres trabajos correctos, incluidos reglas Firebase, recorrido local, builds y dry-run Cloudflare.
- Cloudflare Pages mostró `skipped` para el commit exacto; la publicación existente siguió en `04d57cd22f9243b9e4e93c0c20ceb373f408178e`.
- Navegador aislado con Firebase emulado: Gemini deshabilitado sin credencial, selector de historial separado de IA activa y sugerencias que añaden texto sin borrar el propio.
- Escritorio: horarios de 140 px y filas compactas. Vista móvil de 390 px: documento de 375 px sin desbordamiento horizontal, campos de 140 × 44 px.
- Instancia privada real: cuenta del negocio autenticada, doce sugerencias visibles y horarios compactos. Solo lectura; no se guardó configuración de prueba. El panel de administrador se comprobó con la cuenta sintética de emuladores.

Las capturas y los manifiestos completos se conservan fuera de Git en el directorio privado de despliegue del operador.

## Instancia privada

Imagen `sarin-bot:gemini-assistance-20261016t040044z`, ID `sha256:dd16ebe98eed02fdb27e270d8f63f136817522ffb69b9dabc35cf1b895c83289`. Fuente exacta del commit anterior, archivo SHA-256 `b902bc8190ba8e94715fcdc78f0ef1c159f12e1531269cab83467421c33f2f27`.

Actualización de imagen completada: 28 límites de autenticación y 34 verificaciones HTTP, además de lecturas Firebase y catálogo de Ollama a través de Access. El catálogo devolvió 200 y el endpoint de administración no publicado devolvió 404. Se conservaron entorno, administrador, selección base Ollama, DNS, una sola réplica, usuario no root y acceso por loopback.

Entorno SHA-256 `2e38c04933bd69d0c1b03ea1ef152a433f90bd0f1589a8e917ffee2f34cc05f3` y Compose actualizado SHA-256 `3b3b49e3153415d444ec0f360639804bc3195cf5355bcedd079ebb5aca49b536`. Reversión preparada en `/opt/sarin-bot/runtime/rollbacks/gemini-assistance-image-update-20261016T035945Z-b59cf94d`; imagen anterior preservada. No se abrió el backend públicamente.

## Activación real de Gemini pendiente

El titular creó un proyecto exclusivo para Gemini, separado del Firebase de Sarin, y aplicó sus dos bonos de USD 10. Google mostró COP 66.784 de créditos elegibles tras recargar la página. AI Studio todavía exige prepago; su formulario quedó cargando durante la revisión. No se completó ningún pago desde el agente.

La clave dedicada aún no está instalada y no se habilitó `GEMINI_BILLING_VERIFIED`. No se enviaron conversaciones a Google ni se ejecutó una inferencia real. Falta completar el prepago, guardar la clave privada, verificar el acceso al modelo y realizar la prueba sintética de conversación con herramientas y consumo antes de habilitar su selección para clientes. Ver [procedimiento y condiciones](../gemini-provider.md).
