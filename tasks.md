# Estado de implementación — 2026-10-17

## Entrada por servicio y disponibilidad vacía — publicado

- [x] Implementar las dos mejoras aceptadas: mensaje único para consultas correctas sin horarios y «Reservar este servicio» conservando la elección después del acceso y permisos. [Diseño](docs/design/2026-10-17-booking-service-entry.md).
- [x] Validar catálogo, consumir intención una vez y descartar cambios de UID/negocio/caso; conservar confirmación, recuperación y salud/menores. Revisión independiente PASS tras ajustar nombres accesibles con regresión RED/GREEN.
- [x] 986 pruebas aprobadas/26 omitidas, tipos y audit limpios. CUA con 29 controles en 320/390/1280, día cerrado y mañana con horarios, precio cero, reinicio/salida y cero inferencia/propuestas/citas. Seis documentos propios limpiados. [Evidencia](docs/qa/2026-10-17-booking-service-entry.md).
- [x] Congelar `2440af5`, construir imagen Linux `3c8e555d…` y pasar humo aislado; reversión compatible `f47daf4`/`6b9dacd5…`, sin migraciones.
- [x] Publicar tras autorización específica: imagen `3c8e555d…`, Worker `bb969dc5…`, Containers v13. Cuatro colas default/engine/engine/default vacías, una instancia conectada y cero antiguas; HTTP, bundles e iconos verificados. Permiso real del negocio pendiente conservado, sin aceptar consentimientos, crear citas ni editar negocio; sesión administrativa preservada. UI completa probada localmente con 29 controles, sin atribuirla como visible en producción. [Publicación y reversión](docs/qa/2026-10-17-booking-service-entry.md).

Rama `codex/booking-selection-and-availability-20261017`, worktree existente del catálogo; el checkout original se conserva.

## Detalles del servicio en calendario — publicado

- [x] Diseño acotado autorizado: categoría y descripción opcionales, duración sin buffer y precio COP debajo del servicio seleccionado. [Decisión](docs/design/2026-10-17-calendar-service-details.md).
- [x] Reutilizar datos y normalización del catálogo; omitir metadatos inválidos, conservar permisos, propuesta, confirmación y recuperación. Revisión independiente PASS después de corregir datos históricos malformados.
- [x] 12 pruebas focalizadas y 960 de aplicación aprobadas/26 omitidas; tipos, audit y diff-check correctos. CUA con 16 comprobaciones en 320/390/1280, sin errores ni inferencia; sin confirmar citas. [Evidencia](docs/qa/2026-10-17-calendar-service-details.md).
- [x] Congelar runtime `f47daf4`, construir imagen Linux `6b9dacd5…` y pasar humo aislado sin red/credenciales. Reversión compatible al calendario publicado `98629e1`/`b6bc75f9…`; sin migraciones.
- [x] Publicar después de «Sí, publicar esta versión»: imagen `6b9dacd5…`, Worker `795cd3ac…`, Containers v12. Cola drenada, instancia conectada única y cero antiguas; HTTP, bundles e iconos correctos. Permisos reales pendientes conservados, sin crear citas ni editar negocio; sesión administrativa preservada. [Publicación y reversión](docs/qa/2026-10-17-calendar-service-details.md).

Rama `codex/calendar-service-details-20261017`, worktree existente del catálogo. Runtime publicado `f47daf4`; reversión compatible a `98629e1`/`b6bc75f9…`. El checkout original permanece intacto.

## Calendario de reserva directa — publicado

- [x] Diseño acotado aprobado: calendario general para el adulto que reserva para sí mismo, después de Google y permisos; chat como elección manual. [Decisión y fuente oficial Fresha](docs/design/2026-10-17-direct-booking-calendar.md).
- [x] Reutilizar servicio/profesional/día/hora, propuesta, teléfono e intake, con confirmación explícita. Salud/menores y sus autorizaciones conservados; sin API, esquema, dependencia o proveedor nuevos.
- [x] Conservar operación incierta, cuerpo original y UID esperado ante retirada de permisos, error de política o cambio a salud; bloquear rutas/destinatario y campos hasta recuperar. Regresiones RED/GREEN y revisión independiente PASS.
- [x] 955 pruebas aprobadas/26 omitidas, tipos, 129 comprobaciones de recorrido, 74 pruebas Worker/dry-run y audit limpios. CUA compilado en 320/390/1280, cita sintética confirmada y lectura de persistencia con 24 controles; sin inferencia. [Evidencia](docs/qa/2026-10-17-direct-booking-calendar.md).
- [x] Congelar `98629e1`, construir imagen Linux `b6bc75f9…` y comprobar humo aislado sin red/credenciales antes de autorizar producción; rollback compatible `accab511`/`b2b925f5…` y paquete privado preparados.
- [x] Publicar tras autorización específica: imagen `b6bc75f9…`, Worker `08a0183f…`, Containers v11; cola drenada, una instancia conectada y cero antiguas. HTTP/bundles/iconos y selector/permisos en Chrome verificados; sesión administrativa conservada. [Cierre y reversión](docs/qa/2026-10-17-direct-booking-calendar.md).

Rama `codex/direct-booking-calendar-20261017`, basada en `b91c545`, en el worktree existente del catálogo. Runtime publicado del archivo Git congelado `98629e1`; el checkout original permanece intacto. La imagen anterior `accab511`/`b2b925f5…` es el rollback compatible.

## Categorías y descripciones — publicado

- [x] Diseño acotado aprobado por el propietario: descripción y categoría opcionales por servicio, edición y agrupación en la ficha pública. [Decisión y fuentes](docs/design/2026-10-17-service-catalog.md).
- [x] Validación 300/60, texto plano, omisión compatible por ID y borrado explícito; catálogo histórico plano, datos operativos de IA y citas confirmadas conservados. Sin migraciones ni dependencias.
- [x] Corregir pérdida del borrado al aplicar borrador omiso con regresión RED/GREEN y revisión independiente sin bloqueantes. 927 pruebas aprobadas/26 omitidas, tipos y build; 129 comprobaciones locales. Chrome en 320/390/1280 px. [Evidencia](docs/qa/2026-10-17-service-catalog.md).
- [x] Congelar candidato `accab51` y respaldo compatible `929c43e`; construir y comprobar ambas imágenes Linux sin red/credenciales. Respaldo con 919 pruebas aprobadas/26 omitidas; 74 pruebas Worker y dry-run correctos. Imágenes aún locales, sin cambios de producción.
- [x] Publicar tras autorización específica del propietario: imagen `b2b925f5…`, Worker `274d9bf2…`, Containers v10; cola drenada, una instancia conectada y cero antiguas. Campos visibles en Chrome, perfil/API públicos e iconos verificados; sesión administrativa conservada y respaldo compatible `8575a007…` disponible. [Publicación y reversión](docs/qa/2026-10-17-service-catalog.md).

Rama de este incremento: `codex/service-catalog-20261017`, worktree `F:/Proyectos/SarinBot-worktrees/service-catalog`, basada en `d942e90`. Las fuentes del checkout original se conservan; el runtime publicado procede del archivo Git congelado `accab51`.

## Perfil público antes del acceso — publicado

- [x] Continuar la investigación de Fresha contra las fuentes reales publicadas y registrar la elección del propietario: perfil del negocio antes de Google. [Hallazgos](docs/qa/2026-10-17-fresha-services-and-team.md).
- [x] Mostrar identidad, servicios con precio/duración, horario Colombia y contacto público desde el enlace/QR actual; contrato mínimo `view=profile`, sin migraciones ni datos de clientes.
- [x] Conservar acceso y consentimientos vigentes al pulsar Reservar; mantener Mis citas cuando las nuevas reservas están en pausa. Volver al negocio, salida de sesión, cambio de slug y reintento verificados.
- [x] Seguridad y revisión independiente sin bloqueantes; 904 pruebas aprobadas/26 omitidas, tipos y build correctos; 117 comprobaciones del recorrido local con emuladores. Navegador limpio en 320/390/1280 px. [Evidencia](docs/qa/2026-10-17-public-business-profile.md).
- [x] Publicar tras autorización específica del propietario: imagen `0ce3ac0a…`, Worker `bd604e53…`, Containers v9; cola drenada, una instancia y cero antiguas. Perfil/API públicos y navegador real correctos; configuración, trece secretos, presupuesto y favicon conservados. [Publicación y reversión](docs/qa/2026-10-17-public-business-profile.md).

Se trabaja en `codex/public-business-profile-20261017`, basado en el piloto `9e21f6d`, en `F:/Proyectos/SarinBot-worktrees/public-business-profile`. El checkout mixto original se conserva sin sustituir sus fuentes.

## Icono de instalación — publicado

- [x] Icono PNG 192/512 derivado del favicon y manifiesto vigente. Publicación del 17 de octubre: Containers v8, Worker `218fa37f-9589-4cfa-bd80-b5a51bea4212`; evidencia HTTP/Chrome y reversión documentadas. [Registro](docs/qa/2026-10-17-pwa-favicon.md).

## Cierre actual: piloto comercial publicado

- [x] Push de rama y `main` inicialmente en `bf76ee20`, después `main` en `4eed34f`; publicación y reapertura autorizadas tras «solucionalo». Runtime `6315379`, Containers versión 7, imagen de plataforma `sha256:a319ac8b…aae90e`, Worker `d5a704e7-5bc3-4484-bc58-3c3f334ee3a7` y Pages `a461b670-5130-41e7-8c75-957f5439cfd7`. [Informe de producción](docs/qa/2026-10-16-production-commercial-pilot.md).
- [x] Mantenimiento/drenaje, respaldo final comprobado y proceso anterior terminado; instancia efectiva versión 7, origen público 200 y sesión anónima 401.
- [x] Presupuesto activo guardado y leído: USD 0,50/día y USD 8/mes globales, USD 0,10/día y USD 2/mes por negocio. D1 a las 04:47 UTC: versión 1 sin pausa, límites de tokens conservados; dos políticas QA explícitas general/adultos, menores deshabilitados, revisión 1; aplicación revisión 36 tras tres escrituras administrativas, sin reiniciar consumos.
- [x] Corregir el harness para las nuevas autorizaciones sin debilitar runtime: `4eed34f`, CI 39003955233 con tres jobs verdes; 888 pruebas de aplicación, 24 Firestore, 117 comprobaciones del recorrido y 74 Worker.
- [x] Completar evidencia final de UI/API, comprobación posterior y commit/push documental de cierre. [Operación por negocio](docs/product/2026-10-16-production-pilot-operation.md).

Salud/representación están instalados; su incorporación real requiere revisión por establecimiento. WhatsApp y marketplace siguen deshabilitados. Los apartados siguientes conservan estados históricos de sus fases; sus menciones de producción pendiente no sustituyen este estado actual.

## Seguimiento: crédito ALS, códigos cortos y datos

- [x] Runtime local `df2a1f2`: pie «Desarrollado por www.alsdevstudio.com» y QR secundario de 18 mm; QR de reservas de 50 mm conservado. PDF/PNG reales con ambos destinos decodificados.
- [x] Códigos aleatorios de seis dígitos en servidor, asignación privada atómica, compatibilidad anterior, canje por correo verificado y límites por UID/correo de 5/min, 20/h y 50/día. Ceros, colisiones, concurrencia y replay verificados.
- [x] Responsable de privacidad actualizado a ALS Dev Studio y correo confirmado; hechos de conservación/IA corregidos. [Revisión legal y textos propuestos](docs/product/2026-10-16-legal-consent-review.md).
- [x] 794 pruebas de aplicación aprobadas/25 omitidas, 23 Firestore y build correctos; revisión independiente sin P1/P2 abiertos.
- [x] Completar identificación y contacto de ALS desde su política pública indicada por el propietario: titular del nombre comercial, NIT, dirección en Medellín, teléfono y correo. Versión local; sin publicación nueva.
- [x] Implementar localmente aceptación de condiciones y autorización de datos separadas para cuenta y cliente por negocio, constancias privadas versionadas, retirada, descarga y controles transaccionales/antes de IA. Historial y cancelación se conservan. [Evidencia](docs/qa/2026-10-16-consent-acceptance.md).
- [x] Verificar consentimiento: 827 pruebas aprobadas/25 omitidas, 23 Firestore oficiales, TypeScript y build correctos; navegador en escritorio/móvil. Correcciones de retirada concurrente, identidad, origen Pages y huellas verificadas con regresiones.
- [x] Construir imagen Linux de `11315b7` con el runtime de consentimiento y comprobar sin red externa páginas legales, decisión afirmativa/origen y rutas privadas; [artefacto y secuencia del corte](docs/qa/2026-10-16-consent-release.md). Sin publicar ni activar presupuesto. [Propuesta de operación, conservación y proveedores](docs/product/2026-10-16-pilot-operation.md) preparada para concretar decisiones.
- [ ] Completar decisiones de conservación/proveedores, datos/roles de cada negocio y revisión final de textos antes de publicar el control de aceptación. No atribuir consentimiento a cuentas anteriores.
- [x] Aclarar y acordar el presupuesto: el propietario acepta USD 0,50/día y USD 8/mes globales; USD 0,10/día y USD 2/mes por negocio, con consumo individual y aumento de topes desde administración. Panel, herencia/restauración y reserva transaccional verificados localmente: 838 pruebas de aplicación, 73 Worker, tipos y build. [Evidencia](docs/qa/2026-10-16-business-ai-budget.md). En aquella fase el gate no estaba activado y no había autorización de publicación; el [corte posterior](docs/qa/2026-10-16-production-commercial-pilot.md) registra autorización, configuración y gate activo actuales.
- [x] Diseño y plan de salud/menores aprobados, ejecutados y aceptados localmente: runtime `6315379`, 887 pruebas aprobadas/26 omitidas, Firestore 24/24, build e imagen Linux correctos; tres importantes corregidos y dos mejoras menores diferidas. [Evidencia y pendientes operativos](docs/qa/2026-10-16-health-and-represented-booking.md). Sin publicación ni habilitación de datos reales; autorizaciones específicas independientes de las generales.

[Evidencia de seguimiento](docs/qa/2026-10-16-pilot-followup.md). Las candidatas y publicaciones descritas más abajo conservan el estado de sus respectivas fases.

## Seguimiento del nuevo piloto — implementación local, sin publicar

Trabajo en `F:/Proyectos/SarinBot-worktrees/commercial-pilot`, separado del checkout principal. Candidata de runtime `ecec028`, con los cuatro incrementos y recuperación de logos. Imagen Linux reproducible construida y verificada. Las publicaciones descritas más abajo son históricas; esta sección no afirma cambios en producción.

- [x] Implementar invitaciones de cortesía con canje sin comprobante, diez citas y 700 respuestas, trazabilidad y suspensión/reactivación sin reiniciar consumo. Verificado localmente **1/10 citas y 3/700 respuestas** después de cancelar y suspender/reactivar.
- [x] Conectar la landing con la oferta administrada y conservar cotización/validación de importes. Landing sintética abierta: **65.000 → 68.000 COP sin recarga**; no son tarifas cambiadas en producción.
- [x] Implementar logo/contactos y kit autogestionado **A / Agenda clara**, sin selector de estilos. PDF/PNG/SVG reales descargados; A6 y QR local verificados, kit/perfil a 320 px sin desbordamiento. B/C siguen como referencias; impresión física pendiente.
- [x] Implementar política de cliente, límites persistentes antes de cola, estado autoritativo, plantillas de servidor, propuesta y confirmación explícita, y presupuesto operativo privado. En esta fase histórica el gate estaba en **`PILOT_AI_BUDGET_ENFORCED=false`**; el [estado actual de producción](docs/qa/2026-10-16-production-commercial-pilot.md) tiene compuerta activa y presupuesto guardado.
- [x] Verificar contratos D1 de prueba pagada/cortesía preservando cinco citas históricas; recorrido local de 97 comprobaciones y limpieza del runner; 23 pruebas Firestore. Chrome real con **motor fixture local**, separado del ensayo DeepSeek.
- [x] Registrar ocho llamadas DeepSeek sintéticas con base en memoria: benchmark estricto **6/8**, dos `clarify` contenidos por plantillas. Regresión de `clarify`/`out_of_scope` corregida sin repetir la prueba pagada; no se declara 8/8 ni conversación DeepSeek integrada con el navegador.
- [x] Cerrar checks: **783 pruebas de aplicación aprobadas/25 omitidas**, tipos, builds de aplicación/landing/Pages, **72 Worker**, **25 gateway** y auditoría con **0 vulnerabilidades**. Revisión independiente sin P1/P2.
- [x] Verificar recuperación de logos y comprobantes: 21 pruebas; respaldo preliminar de producción solo lectura restaurado localmente, revisión 33, 48 documentos y un objeto R2. [Aceptación y manifiesto](docs/qa/2026-10-16-commercial-pilot-acceptance.md).
- [x] Preparar candidata exacta, imagen Docker, límites propuestos y reversión compatible con datos nuevos.
- [ ] Obtener confirmación concreta de producción y ejecutar mantenimiento/drenaje, respaldo final recuperable, publicación y configuración/activación del gate antes de reabrir. Conciliación bancaria real, retención/devoluciones y capacidad con negocios reales permanecen pendientes.
- [ ] Validar impresión al 100 % en el acrílico y dominio estable antes de distribuir material comercial.

**Fuera de este incremento:** protección por IP/red y Turnstile no están implementados; una IP compartida o nombre parecido no identifican fraude. Marketplace permanece deshabilitado: **diez negocios registrados reales habilitan una revisión manual**, nunca activación automática. WhatsApp sigue deshabilitado.

Evidencia: [aceptación integrada](docs/qa/2026-10-16-commercial-pilot-acceptance.md), [protecciones y límites del ensayo DeepSeek](docs/qa/2026-10-16-pilot-abuse-controls.md), [branding y tarjeta A](docs/qa/2026-10-16-business-branding.md).

## Imagen de la cita — actualización publicada

- [x] Sustituir ICS por **Guardar imagen de la cita**, PNG local con negocio, servicio, fecha/hora Colombia y profesional o estación disponible; sin contacto privado ni respuestas del formulario.
- [x] Bloquear acciones simultáneas y descartar exportaciones tardías tras cambios de cuenta, negocio, estado u horario. Aclarar que la imagen es estática y los cambios se consultan en Mis citas.
- [x] Verificar 682 pruebas aprobadas/20 omitidas, tipos, build Docker congelado, landing y PNG reales en Chrome/escritorio y viewport móvil; revisión independiente sin bloqueantes.
- [x] Publicar imagen `7fbae3dc…bf96f7`, Worker `82361d3f-2e3a-4830-8785-ecfc678bfc68`, versión Containers 5. D1, 13 secretos y DeepSeek conservados; mantenimiento desactivado, cero registros antiguos y textos/recursos publicados verificados. [Evidencia y reversión](docs/qa/2026-10-16-appointment-image.md).

La aceptación comercial siguiente corresponde a la fase anterior; sus resultados de ICS son históricos y su imagen fue sustituida por esta entrega.

## Entrega comercial vigente — piloto controlado

La [aceptación comercial vigente](docs/qa/2026-10-16-commercial-e2e.md) prevalece sobre los dictámenes de fases anteriores. Resultado: candidata a un **piloto comercial controlado**, no una garantía de disponibilidad o costo para cualquier volumen. Los conteos y estados históricos de abajo corresponden a sus respectivas fases.

- [x] Publicar imagen `sha256:3c416933dbc6ec618e71fd6d6199ae162a17889fb87ea24f58aab3c89ef44c01`, Worker `5beb7020-fb82-42b7-a618-ea0406e5803a` e instancia versión 4, conservando D1/R2 y Google Auth.
- [x] Dejar **DeepSeek activo** por elección explícita del propietario, sin fallback automático. Ollama permanece como alternativa manual con conexión verificada.
- [x] Completar el E2E público de Ollama con un cliente externo; completar en DeepSeek reserva, `.ics` y cancelación con la sesión del propietario. En esta última prueba, el UID compartido explica «cancelada por el negocio»; no se presenta como cliente distinto.
- [x] Probar envío y aprobación manual de un comprobante sintético, con activación de 10 citas y 700 respuestas. **Sin transferencia bancaria ni dinero conciliado.**
- [x] Publicar información factual de privacidad/ayuda y contacto `alsdevstudio@alsdevstudio.com`, Andrés Santiago. Revisión de pagos únicamente en bandeja administrativa; no hay avisos automáticos por correo.
- [x] Verificar 679 pruebas de aplicación aprobadas con 20 integraciones omitidas, 68 del Worker y 25 del gateway. Recorrido local de 96 comprobaciones y E2E público documentados por separado.
- [x] Activar alertas Cloudflare de USD 5/USD 8 y alerta DeepSeek de saldo de USD 2. No constituyen un tope automático garantizado de USD 15.
- [x] Conservar copia privada de 123 archivos de las fuentes publicadas.
- [x] Cancelar las dos citas nuevas y cerrar los siete días del negocio QA mediante la interfaz. Lectura independiente D1: cero confirmadas, dos canceladas y cita original del otro negocio intacta.
- [x] Integrar en Git las fuentes del checkout mixto publicado; incorporadas en la rama del piloto y en `main`, actualmente `4eed34f`. La CI y el runtime exactos se distinguen en el [informe de producción](docs/qa/2026-10-16-production-commercial-pilot.md).
- [ ] Decidir y documentar plazos formales de conservación/eliminación y condiciones de devolución.
- [ ] Realizar y conciliar una transferencia bancaria real si se acuerda ese ensayo; el comprobante sintético no la sustituye.
- [ ] Ampliar validación de capacidad/latencia y controles contra abuso según el tráfico del piloto; no se acreditó una capacidad comercial por número de negocios.
- [ ] Antes de captación amplia, definir máximo de citas futuras activas por cliente y protección frente a varias cuentas; el límite actual por UID no verifica teléfonos ni cubre esos casos.
- [x] Mantener WhatsApp deshabilitado y registrar el marketplace como análisis únicamente, sin implementación ni oferta activa.

## Foco comercial y retiro de Vault — 2026-10-16

- [x] Descartar el proyecto de chat personal y retirar pantalla, API, almacenamiento, finanzas, copias, accesos y dependencias exclusivas de Vault. No purgar datos de navegadores anteriores.
- [x] Conservar diagnóstico administrativo del motor como `scope=engine`, sincronizado con el Worker y protegido por Firebase/superadmin; preservar cola y proveedores comerciales.
- [x] Verificar 659 pruebas de aplicación, 68 del Worker, 23 del gateway, tipos, build, imagen, auditoría de dependencias y revisión independiente. Recorrido comercial local con 96 comprobaciones y smoke de rutas retiradas correcto.
- [x] Publicar el retiro y verificar sesión, consola y cita existente en el origen público; página/API retiradas 404, Ollama online y una instancia comercial nueva activa. [Evidencia](docs/qa/2026-10-16-commercial-focus.md).

## Datos en Cloudflare — 2026-10-16

- [x] Migrar datos comerciales a D1 y preparar R2 privado para comprobantes; Firebase cliente y servidor conservan Auth Google. Sin fallback automático a Firestore. Vault permaneció local en esa fase y fue retirado después.
- [x] Sustituir listeners del navegador por APIs autorizadas y refresco acotado de 15 segundos, suspendido con la pestaña oculta; mantener permisos y aislamiento de sesión/negocio.
- [x] Copia final privada con hora del servidor, drenaje verificado y proceso anterior ausente; importar y verificar los 19 documentos por hash, con cero reservas pendientes. Firestore y backups se conservan.
- [x] Retirar únicamente el permiso Firestore de la cuenta runtime tras la aceptación; conservar Auth/WIF y documentar la recuperación del permiso mínimo. Nueva sesión y citas verificadas después.
- [x] Activar imagen nueva en una instancia Cloudflare y verificar sesión, administración, cita existente, historial, calendario e ICS. Aplicación: 675 pruebas pasan y 20 omitidas en ese comando; Worker 67; CLI 18; tipos y builds correctos. [Evidencia](docs/qa/2026-10-16-cloudflare-data-migration.md).
- [x] Completar inferencia comercial real en la aceptación posterior: E2E Ollama con cliente externo y DeepSeek con sesión del propietario; WhatsApp permanece deshabilitado. [Evidencia vigente](docs/qa/2026-10-16-commercial-e2e.md).
- [x] Configurar alertas de gasto Cloudflare y saldo DeepSeek; USD 15 no es un corte automático.
- [x] Integrar el checkout mixto en Git; fuentes incorporadas posteriormente en la rama del piloto y en `main` (`4eed34f`). [Cierre de publicación](docs/qa/2026-10-16-production-commercial-pilot.md).

## Preparación pública, landing y cliente — 2026-10-16

- [x] Auditoría inicial con dictamen, hallazgos priorizados y evidencia repetida: `docs/qa/2026-10-16-production-readiness.md`. La entrega posterior se evalúa en el informe comercial vigente como candidata a piloto controlado.
- [x] Landing de producto con funciones/precios/condiciones reales y metadatos sin «Próximamente»; CTA de aplicación habilitado solo con origen público aprobado.
- [x] «Mis citas» dentro de cada negocio: próximas, histórico, consulta por fecha, cancelación confirmada y calendario .ics; permisos y estados independientes de cuota/motor.
- [x] Fase previa: gateway Pages→VPS y artefacto optativo `build:pages`, fecha de compatibilidad explícita, pruebas y guía de activación/reversión. Sustituido por el binding privado de la migración Cloudflare publicada, descrita abajo.
- [x] 605 pruebas generales, 17 del gateway, TypeScript, build Next y build Pages correctos; 19 de Firestore y 96 comprobaciones de integración ejecutadas durante la auditoría. QA Chrome de cliente/landing y móvil 320 px, descarga ICS real y smoke local Workerd. Revisión independiente sin bloqueantes en cambios nuevos.
- [x] Publicar información factual de privacidad/ayuda y contacto; conservar respaldos y activar alertas iniciales.
- [ ] Formalizar retención/devoluciones, conciliar un pago real y ampliar controles de abuso/capacidad según el tráfico. No se agrupan estos pendientes como si la publicación del aviso los resolviera.
- [x] Completar inferencia y nueva reserva/cancelación públicas con cliente externo usando Ollama. Repetición DeepSeek con sesión del propietario documentada con su límite de identidad; `.ics` verificado.
- [x] Verificar el flujo manual de aprobación y activación de la prueba con comprobante sintético, sin afirmar cobro real.
- [ ] Conciliar transferencia bancaria real; WhatsApp sigue sin aceptación operativa.

## Prueba pagada de diez citas — 2026-10-16

- [x] Sustitución de la prueba gratuita por compra única de $5.000 COP, configuración y diez citas sin vencimiento por días; activación únicamente tras aprobar el comprobante.
- [x] Contador transaccional compartido entre recursos y fechas, reintento de la décima cita, cancelación sin devolución y bloqueo de nuevas citas/configuración/IA al agotarse. Las citas existentes se conservan.
- [x] Facturación antes de configurar el negocio, borrador privado, protección de campos de pago, prueba no renovable y planes que sustituyen la prueba inmediatamente.
- [x] Portada, configuración, agenda, facturación, administración y estado público actualizados. Se conserva la bolsa total independiente de 700 respuestas; desaparece el onboarding gratuito. Vault administrativo se preservó en esa fase y fue retirado después.
- [x] 578 pruebas unitarias, 19 pruebas en Firestore Emulator y recorrido local de 96 comprobaciones aprobados; TypeScript, compilación de producción, exportación de landing, auditoría y revisión independiente correctos. QA visual en escritorio y móvil de 320 px. Evidencia: `docs/qa/2026-10-16-paid-trial.md`; compatibilidad: `docs/paid-trial.md`. Esa fase fue local; la imagen publicada posteriormente en Cloudflare incluye estos cambios, sin probar cobros reales.

## País de WhatsApp — 2026-10-15

- [x] Selector con bandera SVG, nombres de países en español y prefijo separado del número nacional. Teléfonos existentes conservados; pegado internacional y países con indicativos compartidos cubiertos.
- [x] 438 pruebas, TypeScript, auditoría sin vulnerabilidades, revisión independiente y QA Chrome en escritorio/320 px aprobados. CI con tres jobs correctos y actualización privada `phone-country-20261016t030925z` verificada en Sarin Pruebas. Evidencia: `docs/qa/2026-10-15-whatsapp-country-selector.md`.
- [x] Etiqueta «Enlace» sin prefijo técnico; «Limpieza» aclarada como «Tiempo entre citas» con ayuda de margen posterior opcional. Revisión móvil, CI y actualización privada `service-labels-20261016t031651z` aprobados. Evidencia: `docs/qa/2026-10-15-business-form-labels.md`.

## Formularios compactos — 2026-10-15

- [x] Espaciado y agrupación en administración, suscripción, configuración del negocio y bloqueos de agenda. Horarios alineados según el ancho del formulario; controles de 44 px y estilo Agenda clara conservados.
- [x] Revisión independiente de presentación y seguridad, TypeScript, 408 pruebas y QA visual en Chrome a 320/640/1280 px y escritorio. Recorte de AM/PM en móvil detectado y corregido. Evidencia: `docs/qa/2026-10-15-compact-forms.md`.
- [x] Push `ac478e4`, CI con tres jobs aprobados e imagen privada `compact-forms-20261016t025030z` activada con rollback. Panel real verificado; facturación pasó de 1.132 a 660 px de alto en el mismo viewport de escritorio.

## Estructura comercial — 2026-10-15

- [x] Estructura aprobada por el propietario: Esencial 7/15/30 días a $20.000/$35.000/$59.900 con 700/1.500/3.000 respuestas; WhatsApp 30 días a $149.900 + Meta con 4.500; ampliaciones de 1.000 por $20.000. Referencia: `docs/commercial-plans.md`.
- [x] Cuotas por vigencia, paquetes, aviso al 80%, pausa de IA y visualización de capacidad implementados y verificados. Trial de 700 respuestas y copiloto compartido confirmados por el propietario. Evidencia: `docs/qa/2026-10-15-commercial-quotas.md`.
- [x] Código WhatsApp preparado: webhook firmado, colas cifradas, reintentos seguros, cuota compartida, estados y mantenimiento. Pruebas sintéticas y Firestore emulado; sin activar envíos. Operación: `docs/whatsapp-cloud-api.md`.
- [x] Push `c509b26`, tres jobs CI aprobados y nueva imagen activada en la instancia privada con rollback. Panel real verificado, tarifas guardadas $20.000/$35.000/$59.900 y 700 respuestas de prueba; WhatsApp desactivado.
- [ ] Enlazar el número Meta cuando el propietario lo tenga, validar recepción/entrega real y conciliación de consumo antes de ofrecer WhatsApp como disponible. Mayor volumen por cotización.

## Consumo de IA — 2026-10-15

- [x] Medición privada de llamadas y tokens DeepSeek por negocio y mes, rango estimado USD y avisos sobre cobertura incompleta; sin cuerpos de conversaciones ni cambios de proveedor.
- [x] Tipos, 314 pruebas, 13 pruebas Firestore y 75 comprobaciones del recorrido; idempotencia, permisos, fallos de telemetría y revisión visual a 320 px. Evidencia: `docs/qa/2026-10-15-ai-usage.md`.
- [x] Imagen de `59a716a` construida y activada en la instancia privada; contexto idéntico a `4c9dd26`, CI con tres jobs verdes, 22 controles posteriores y verificación autenticada del medidor. IA local conservada; lanzamiento público y WhatsApp pendientes.
- [x] Proyección de barbería para 15–50 conversaciones diarias y 6–12 respuestas, sin notificaciones proactivas; costos de Meta/DeepSeek y precio al cliente separados en `docs/whatsapp-premium-proposal.md`.

## Control administrativo — 2026-10-15

- [x] Selector global manual Ollama/DeepSeek para superadministrador, persistencia privada y Vault exclusivamente local. Gemini retirado y su clave dedicada revocada; OAuth/Firebase intactos.
- [x] Verificación: tipos, 288 pruebas, 11 pruebas con Firestore Emulator, 72 comprobaciones del recorrido y acceso por roles en Chrome. Evidencia: `docs/qa/2026-10-15-admin-ai.md`.
- [x] Imagen del commit `9a3e66f` construida y activada en la instancia privada; tres jobs CI y controles posteriores correctos. El lanzamiento público y WhatsApp Premium siguen pendientes; precio y consumo propuestos en `docs/whatsapp-premium-proposal.md`.

## Historial inicial

- [x] Auditoría inicial del documento rector, dependencias y todos los módulos existentes. Detalle: `AUDITORIA.md`.
- [x] Core: tipos, Firebase singleton, autenticación Admin, suscripción, cola FIFO priorizada y entorno de ejemplo.
- [x] Agenda: disponibilidad Colombia, buffer, reservas atómicas, bloqueos/cancelación y herramientas ejecutables.
- [x] SaaS: Google Auth, onboarding, isla, agenda realtime, QR, capturas comprimidas y revisión de suscripciones.
- [x] Sarin Vault: IndexedDB por UID, imágenes, visión→modelo principal local, cuentas, Markdown, ICS y copias cifradas/limpias.
- [x] Seguridad: reglas, proyección pública explícita, cabeceras, límites de payload y concurrencia, reintentos idempotentes y revisión independiente.
- [x] Documentación y empaquetado: README, STACK, Dockerfile y salida standalone.
- [x] Desarrollo sin proyecto Firebase: Auth + Firestore oficiales locales, cuentas aisladas, accesos por rol, guardas de producción y runner con Java 21.
- [x] Kit revisable de infraestructura: Compose, Caddy, Cloudflared y lanzador Ollama nativo para Mac, con pruebas de configuración.
- [x] Diagnóstico independiente de Firebase: `npm run doctor`, consulta de modelos y pruebas sintéticas explícitas de texto/visión.
- [x] Referencias de diseño mediante MCP oficial Mobbin autenticado; identidad de ALS DevStudio aplicada a portada, navegación, acceso, agenda y Vault.
- [x] Kit Cloudflare Containers con Worker, DO singleton, tipos generados, secretos de runtime separados, ocho pruebas y dry-run del Worker.
- [x] Imagen Docker Linux construida, iniciada en loopback con filesystem de solo lectura y comprobada por HTTP; dry-run completo de Wrangler con imagen aprobado.
- [x] Verificación de código: TypeScript, suite local, suite de emulador Firestore, npm audit y build. Resultados finales abajo.
- [x] Configurar proyecto Firebase real, Google OAuth, credenciales Admin, UID superadmin, bancos y túnel/modelo principal de la Mac. Ver aceptación Cloudflare del 16 de octubre; visión sigue opcional y sin configurar.
- [x] Portada temporal independiente para Pages: aviso de lanzamiento, exportación sin Firebase, 404, headers, revisión móvil y controles de artefacto. Evidencia: `docs/qa/2026-10-13-landing-temporal.md`.
- [x] Publicar y verificar la portada temporal en `sarinbotsaas.pages.dev`: producción `1d4890a`, despliegue `7f2b08d0`, HTTP 200 y headers correctos; rutas privadas HTTP 404.
- [x] Favicon propio de Sarin integrado y publicado: SVG, ICO 16/32/48, PNG 32 y Apple 180; producción `ccf5193`, despliegue `027d8f92`. Evidencia: `docs/qa/2026-10-13-favicon.md`.
- [x] Favicon sustituido por la cara de la mascota a petición del propietario: ICO 16/32/48, PNG 32/48 y Apple 180; producción `18bd4fd`, despliegue `a57cacb9`. Evidencia: `docs/qa/2026-10-13-favicon-cara-sarin.md`.
- [x] Diseño Agenda clara elegido por el propietario, aplicado y publicado: fondo claro, acento azul, agenda ilustrativa accesible y selector local; revisión responsive/seguridad aprobada. Producción `776bc81`, despliegue `42f0e736`. Evidencia: `docs/qa/2026-10-13-agenda-clara.md`.
- [x] Cara del favicon en cabecera y pie; secuencia de vuelo, aterrizaje y saludo con recursos originales de ALS, pausa y movimiento reducido. Publicación `9c4a2f8`, despliegue `ba6690e7`. Evidencia: `docs/qa/2026-10-14-sarin-vuelo-y-marca.md`.
- [x] Botón de pausa retirado por petición del propietario; entrada única de 3,8 s con saludo permanente. Publicación `345f8e7`, despliegue `40a8f9d6`. Evidencia: `docs/qa/2026-10-14-saludo-sin-boton.md`.
- [x] Recorrido continuo de cinco mensajes sobre la app, vuelo/vuelta/aterrizaje y lectura completa accesible, según nueva elección del propietario. Publicación `2234442`, despliegue `4d3627ba`. Evidencia: `docs/qa/2026-10-14-cinco-mensajes-sarin.md`.
- [x] Vuelo corregido según ALS: entrada lateral desde fuera, giro al frenar y salida por el otro borde; cinco mensajes conservados. Publicación `888773e`, despliegue `496e9e4d`. Evidencia: `docs/qa/2026-10-14-vuelo-con-desplazamiento.md`.
- [x] Contador y enlace «Leer los 5 mensajes» retirados por petición del propietario; vuelo y mensajes continuos conservados. Publicación `1097112`, verificada en Pages. Evidencia: `docs/qa/2026-10-14-saludo-sin-contador.md`.
- [x] Iconos, etiquetas «Paso 1/2/3» y rótulo «De un enlace a tu agenda» retirados según la captura del propietario. Publicación `bbd4c2e`, verificada en Pages, escritorio y móvil. Evidencia: `docs/qa/2026-10-14-seccion-sin-iconos.md`.
- [x] Agenda clara en pantallas internas: acceso, agenda, configuración, QR, facturación, administración, isla y Vault; revisión local desde 320 px. Evidencia: `docs/qa/2026-10-14-agenda-clara-interna-y-ci.md`.
- [x] Ensayo local opt-in completo: 61 comprobaciones de reservas/pagos/permisos con Auth y Firestore oficiales, limpieza limitada y cero inferencia; ocho pruebas de aislamiento.
- [x] CI real de GitHub: tres jobs verdes para tipos, pruebas, builds, reglas, recorrido local y dry-run del Worker. Commit `d761de4`, ejecución `38523876656`.
- [x] Desplegar la aplicación completa y verificar Firebase/Ollama reales mediante sesión, lecturas de datos y salud del motor. El recorrido comercial de escritura se completó después según [la aceptación vigente](docs/qa/2026-10-16-commercial-e2e.md).

## Migración Cloudflare sin VPS — infraestructura operativa

- [x] Preparar y revisar Pages → binding privado → Worker → Container único; ADC federado sin certificados de la VPS y Ollama por Tunnel/Access.
- [x] Publicar la aplicación y landing real en `sarinbotsaas.pages.dev`; verificar metadata, rutas anónimas, suspensión y nuevo arranque.
- [x] Configurar pool/proveedor Google WIF, grant mínimo de la cuenta runtime y dominio Firebase, conservando acceso anterior.
- [x] Completar login público, lecturas Auth/Firestore y estado de Ollama desde Cloudflare con sesión real; repetir tras suspensión/reinicio y con el Node de la VPS detenido.
- [x] Verificar cita existente, historial, calendario por fecha y descarga real `.ics` en el negocio de pruebas, sin modificar reservas de producción.
- [x] Confirmar ruta Tunnel/Access directa a la Mac; detener solo el contenedor Sarin de la VPS, su timer de certificados y el forward 3032; conservar archivos, imagen y confianza Google para reversión.
- [x] Completar inferencia, reserva y cancelación públicas con cliente externo en Ollama; DeepSeek con sesión del propietario verificado por separado. [Aceptación vigente](docs/qa/2026-10-16-commercial-e2e.md).
- [x] Publicar privacidad/ayuda y activar alertas Cloudflare/DeepSeek; conservar respaldos. La aprobación sintética de comprobante valida el flujo, no el cobro.
- [ ] Conciliar un pago bancario real y cerrar las decisiones formales de retención/devolución; ampliar abuso/capacidad según operación del piloto.
- [x] Integrar en Git las fuentes publicadas; completado en la rama del piloto y en `main` (`4eed34f`). [Cierre de publicación](docs/qa/2026-10-16-production-commercial-pilot.md).
- [ ] Observar renovación natural Google de una hora en el mismo proceso; no se marca resuelta por un nuevo despliegue.

Evidencia: [migración del 16 de octubre](docs/qa/2026-10-16-cloudflare-migration.md).

## Migración a pnpm — evidencia previa

- [x] App y Cloudflare en pnpm 11.23.0 con lockfile único, overrides conservados y Node 24.
- [x] Launcher, Docker, CI, Pages y documentación actualizados; ambos `package-lock.json` y sus metadatos internos de instalación npm retirados tras las verificaciones.
- [x] Instalación congelada, tipos, 153 pruebas unitarias, 7 reglas Firestore, 61 comprobaciones del recorrido, 8 pruebas Worker, builds y Docker aprobados. Cero vulnerabilidades conocidas.
- [x] Push `04d57cd` en `main`; CI `38527082839` con tres jobs verdes y Pages `07bcf4b6` publicado con pnpm. Evidencia: `docs/qa/2026-10-14-migracion-pnpm.md`.

Comandos actuales: `pnpm install --frozen-lockfile`, `pnpm run dev:local`, `pnpm run typecheck`, `pnpm test` y `pnpm --filter sarin-cloudflare-host run check`.

## Evidencia histórica anterior a pnpm

- `npm run typecheck`: pasa, sin errores.
- `npm test`: 142 pruebas aprobadas; 7 pruebas de emulador omitidas en esta invocación por no tener las variables de ese runner.
- `npm run test:rules` con Java 21: las 7 pruebas omitidas anteriormente pasan en Firestore Emulator real (2 archivos, 10,87 s en el cierre de la ampliación local).
- `npm run test:local`: pasa contra la aplicación y ambos emuladores activos. Comprueba autenticación real emulada, UID superadmin, consola, facturación, negocio y rechazo 403 del cliente en las API administrativas/Vault.
- `npm audit`: cero vulnerabilidades conocidas, incluidas dependencias de desarrollo.
- `npm run build`: pasa con Next.js 16.4.0 y salida standalone; genera `/admin/vault`, APIs y manifest.
- Humo HTTP de las siete API protegidas: todas responden 401 sin token; portada y entrada de Vault responden 200 y exigen sesión en interfaz.
- Chrome: Vault abierto con Administrador local y sesión validada por servidor; consola y formulario de onboarding renderizados con datos vacíos reales del emulador. Evidencia `docs/qa/vault-local.png`. Google OAuth real y la Mac/túnel siguen pendientes de configurar.
- `npm run doctor`: pasa sin configuración real, informa dependencias pendientes y no hace peticiones por defecto.
- Sintaxis Node/shell y estructura Compose: validaciones aprobadas; pruebas del lanzador Mac usan binarios sintéticos, sin ejecutar Ollama real.

Ampliación de diseño y hosting: ocho pruebas de Cloudflare aprobadas, TypeScript del Worker y dry-run completo con imagen aprobados. Docker Desktop se inició localmente para construir y probar la imagen, sin configurar servicios remotos. La comprobación de producción con Firebase/Ollama reales y red de Cloudflare sigue pendiente. Ninguno de estos resultados implica un despliegue de producción.
