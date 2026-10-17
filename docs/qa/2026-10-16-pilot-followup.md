# Tarjeta ALS, códigos cortos y revisión de datos

Entrega local posterior a la candidata `ecec028`. Runtime actualizado: **`df2a1f2`**, rama `codex/commercial-pilot-20261016`. [Manifiesto de esta revisión](2026-10-16-pilot-followup-release.json). Imagen Linux `sha256:c1c863a5e32c7b4096d1bf7bed22df4bbc5e51641f68e5e834b67b7453e0762a`, **79.578.330 bytes**, construida desde el archivo Git de esa revisión. Smoke sin red y con sistema de archivos de solo lectura correcto: Sharp nativo y sesión sin credenciales HTTP 401.

Sin publicación, cambios de límites monetarios, invitaciones reales ni nuevas llamadas pagadas de IA. La respuesta del propietario al presupuesto fue una solicitud de explicación, no una autorización de producción.

## Tarjeta A

El pie incorpora **«Desarrollado por www.alsdevstudio.com»** y un QR secundario a `https://www.alsdevstudio.com/`. El QR principal de reservas conserva su posición, sus cuatro módulos de margen y sus **50 mm**; el secundario mide **18,03 mm**, también negro/blanco y con margen. Teléfono y redes quedan en una columna separada, sin invadirlo. La descarga SVG sigue siendo exclusivamente el QR del negocio.

La muestra se generó en Chrome usando el exportador real de la app, las fuentes locales y un logo sintético. El harness aislado no usó Auth, base de datos ni IA. El QR grande de esta muestra es **demostrativo** (`https://example.com/reservar`); la app usa la URL canónica del negocio guardado.

- [PNG completo](2026-10-16-card-a-als-footer.png) y [PDF A6](2026-10-16-card-a-als-footer.pdf).
- [Captura real de Chrome](2026-10-16-card-a-als-footer-browser.png) y [render del PDF](2026-10-16-card-a-als-footer-pdf-render.png).
- [Verificación automática](2026-10-16-card-a-als-footer-verification.json): PNG **1241 × 1749**, PDF de una página **105 × 148 mm**; ZXing-C++ decodificó los **dos destinos exactos** desde PNG y PDF renderizado a 300 ppp.

El destino de ALS también se abrió en Chrome y mostró su sitio público. Esto verifica la web y los archivos digitales; no acredita impresión física, lectura con cámara de teléfono ni resistencia del acrílico a reflejos.

## Invitaciones de seis dígitos

El botón **«Generar código de 6 dígitos»** genera el código en servidor con `crypto.randomInt`, conservando ceros iniciales. No hay un código propuesto por el navegador. Sigue vinculado a un correo Google verificado y conserva diez citas/700 respuestas sin comprobante.

La asignación crea atómicamente la invitación y el índice privado `serverSettings/invitation_code_<sha256>`. Solo se guardan digest y referencia, nunca el código completo; administración recibe el código una vez y luego ve cuatro dígitos ocultos y los dos últimos. Se prueban colisiones, concurrencia, agotamiento del generador e idempotencia tras pérdida de respuesta. Hasta 32 candidatos por intento; agotarlos devuelve 503 sin asignaciones parciales.

Los índices **no se reutilizan** tras vencimiento, revocación o canje: preservan la distinción entre códigos y recuperación. El millón de combinaciones es un espacio finito; no representa una credencial de alta entropía. La identidad verificada y los límites son parte esencial del control.

Antes de buscar por código, los nuevos intentos se limitan transaccionalmente a **5/minuto, 20/hora y 50/día**, por UID y por correo verificado. Cambiar UID con el mismo correo no reinicia el límite. La API devuelve 429 y `Retry-After`; contadores corruptos fallan cerrados. Una recuperación legítima se resuelve por el negocio del actor y su invitación, conservando suspensión, consumo y planes posteriores. Los códigos largos anteriores siguen aceptándose sin índice nuevo.

No hay colección, columna SQL ni migración destructiva nueva. Para revertir, conservar invitaciones, índices y contadores; no reabrir canjes con una imagen anterior que solo entienda códigos largos. El backup documental existente incluye estas rutas privadas. No borrar índices para volver a emitir códigos usados.

## Privacidad y aceptación

Por instrucción del propietario, la página local identifica **ALS Dev Studio**, con **alsdevstudio@alsdevstudio.com**. Actualiza el contexto enviado a IA y distingue la vigencia funcional de selección/propuesta del borrado: no existe un TTL general de eliminación.

La [revisión legal y propuesta de aceptación](../product/2026-10-16-legal-consent-review.md) usa fuentes oficiales colombianas. Recomienda separar términos contractuales y autorización informada, sin casillas premarcadas, y conservar constancia versionada en servidor. El cliente autoriza sus datos; el dueño no autoriza automáticamente a todos sus clientes.

**El control de aceptación todavía no está implementado.** La identificación y el contacto de ALS se completaron localmente con la política pública indicada por el propietario: nombre comercial ALS Dev Studio, titular Andrés Leonardo Santiago González, NIT, dirección en Medellín, teléfono y correo. Siguen pendientes la política de conservación, los contactos/roles de cada negocio y la revisión de contratos/roles de proveedores. No se publicó una política contractual incompleta ni se finge autorización de usuarios anteriores.

Para esta actualización de datos de contacto se ejecutaron `pnpm test tests/service-information.test.tsx` (**2 aprobadas**) y `pnpm run typecheck` (salida **0**), además de `git diff --check`. Logs ignorados: `privacy-contact-tests.log` y `privacy-contact-types.log`. Es un cambio local posterior a la imagen de seguimiento; requiere reconstruirla antes de una publicación futura.

## Validación

- Suite completa: **794 aprobadas y 25 omitidas**, 88 archivos aprobados y cuatro omitidos. No se suman las suites focalizadas a este conteo.
- Firestore oficial aislado: **23 aprobadas**, dos archivos, salida 0; emulador cerrado al terminar. Incluye el contrato de invitaciones en el backend real.
- Invitaciones/rutas/UI/D1 y snapshots: **37 aprobadas**; controles de hora/día/concurrencia y recuperación: **26 aprobadas** en la ejecución focalizada posterior. Grupos solapados.
- Build de aplicación, TypeScript e imagen Linux de la revisión exacta correctos; resultados en el manifiesto de seguimiento.
- Revisión independiente sin P1/P2 abiertos. Se corrigió una frase que confundía caducidad de la propuesta con eliminación.

La nueva concurrencia expuso un defecto del adaptador de pruebas: `exists` era fijo pero `.data()` leía datos vivos. Dos regresiones fallaron antes de corregirlo. Ahora cada snapshot captura datos y cada intento transaccional consulta una vista consistente, manteniendo conflictos por versión y sin simular protección contra consultas vacías. No se relajó la validación del negocio en producción.

Logs ignorados: `followup-red.log`, `card-footer-red.log`, `snapshot-red.log`, `followup-all-tests.log`, `followup-security.log`, `followup-build.log`; Firestore en `test-results/catfollowup-firestore.log`. Los servicios de QA son solo loopback y sus datos ficticios no se publican en el backend real.
