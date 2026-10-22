# Migración de Sarin a Cloudflare sin VPS

Actualización posterior: los datos comerciales ya se trasladaron a D1 y los comprobantes usan R2 privado; Firebase permanece para Auth. El [runbook de datos](cloudflare-data-migration.md) prevalece para cualquier reversión: la imagen antigua de la VPS usa una copia Firestore que quedó congelada al corte. No basta reactivar ese runtime después de nuevas escrituras D1. [Aceptación actual](qa/2026-10-16-cloudflare-data-migration.md). Al terminar el corte de datos, el Mac está apagado y el túnel Down; la comprobación Healthy de esta fase se conserva como evidencia histórica.

Estado al 16 de octubre de 2026: **migración de infraestructura operativa y validada** según el [diseño aprobado](superpowers/specs/2026-10-16-cloudflare-no-vps-design.md). Se comprobaron login Google real, acceso autenticado Google/Firestore y conexión directa Cloudflare→Mac, incluso después de detener el runtime Sarin de la VPS. El máximo autorizado para Sarin sigue en **USD 15 mensuales**. La instancia VPS, sus respaldos, archivos e identidad anterior se conservan para reversión; el proceso Sarin anterior está detenido. Evidencia detallada en [QA de la migración](qa/2026-10-16-cloudflare-migration.md). La apertura comercial completa tiene pendientes propios.

## Destino e inventario

| Elemento | Configuración publicada |
| --- | --- |
| Origen público | `https://sarinbotsaas.pages.dev` |
| Pages | Proyecto `sarinbotsaas`, raíz del repositorio, salida `landing/out` |
| Build Pages | `pnpm run build:pages`; Node 24, pnpm 11.23.0 |
| Binding Pages | `SARIN_APP_HOST` → Worker `sarin-bot-app` |
| Worker | Sin `workers.dev`, previews ni rutas públicas propias |
| Aplicación | `SarinApp`, nombre `sarin-global-app`, `basic`, máximo una instancia |
| Identidad | DO separado `SarinIdentity`, binding `SARIN_IDENTITY` |
| Datos actuales | D1 `sarin-bot-data`, R2 privado `sarin-bot-files`; Firebase Auth en `sarinbotsaas` |
| Motor | Ollama en la Mac; HTTPS bajo `alsdevstudio.com`, Tunnel y Access |
| Tunnel Mac | `sarin-mac-ollama`, ID `baac8f41-73ac-45e9-a394-59260ea07e25`; Healthy en esta aceptación, Down al corte posterior con el Mac apagado |
| Versión inicial Worker | `141cb9ba-d7ff-49d5-9d75-4a9f094cc912` |
| Aplicación Containers | `a032778c-ce3d-4673-b65a-4bf13fa3e02c` |
| Imagen | `sha256:02139a229a44638339fc0e28dd96097a34df696b4574b28436d145912bc45164` |
| Pages producción | `054fe0f0-5b12-42fb-84c7-e7b193118401` |
| Runtime VPS anterior | `sarin-bot-app-1`, detenido; imagen/configuración conservadas |

La inspección de Billing en Chrome confirmó **Workers Paid activo, con renovación el 22 de octubre de 2026**. No se cambió facturación. La misma cuenta tiene servicios R2/Images/Stream de otras aplicaciones: esos cargos no se atribuyen a Sarin. El propietario autorizó renovar los scopes de Wrangler y el despliegue Containers se realizó con esa autorización. El binding `SARIN_APP_HOST` se confirmó mediante lectura de la configuración de producción Pages, cuyo build es `pnpm run build:pages`.

Las [service bindings de Pages](https://developers.cloudflare.com/pages/functions/bindings/#service-bindings) permiten llamar al Worker por binding y su alta requiere redeploy. La ruta publicada usa ese modo y no necesita hostname público de aplicación VPS. Firebase Auth incluye ahora `sarinbotsaas.pages.dev` en sus dominios autorizados y conserva los tres dominios anteriores.

## Evidencia actual y límites

| Comprobación | Resultado |
| --- | --- |
| Discovery y JWKS públicos | 200; dos claves públicas ES256 |
| Portada `/` | 200 |
| `/api/session` sin sesión | 401 |
| Inicio frío de API de negocio sin sesión | 401 en aproximadamente 3,0 s |
| Inactividad Cloudflare | Estado inactivo confirmado por API tras dos minutos |
| Motor desde Docker local | 200 mediante Access, modelo principal presente, visión no configurada |
| Login Google real | Completado y confirmado por el propietario |
| `/api/session` autenticado | 200; lectura Firestore de `users` |
| Lecturas admin | `/api/admin`, AI, uso y metadatos WhatsApp: 200 |
| Diagnóstico Ollama desde Cloudflare | 200, proveedor `ollama`, `online: true` |
| Nuevo arranque tras suspensión | Sesión autenticada y diagnóstico Ollama: 200 |
| Después de detener Sarin en VPS | Sesión autenticada y diagnóstico Ollama: 200 |
| Cliente público con reserva existente | Reserva del 17 de octubre, 10:00–10:30, confirmada; filtro de fecha muestra un registro |
| Descarga ICS de esa reserva | 360 bytes, un evento de 15:00–15:30 UTC |
| Suite aplicación | 628 pruebas pasadas; 20 omitidas |
| Suite Cloudflare / gateway Pages | 40 / 25 pruebas pasadas |
| Tipos y builds | Aplicación, Pages e imagen Docker correctos |

Google WIF tiene pool, proveedor y grant de impersonación instalados. La reinspección del planificador devolvió `already-configured` sin cambios y el grant anterior de la VPS se preservó. Las llamadas autenticadas reales de la aplicación confirman que la identidad funciona desde Cloudflare; se repitieron después de un nuevo arranque y del apagado del runtime VPS. La evidencia CDP no conserva cabeceras de autorización.

El Tunnel `sarin-mac-ollama` se confirmó Healthy con dos réplicas `darwin_arm64` de la Mac. La ruta `ia-sarin.alsdevstudio.com`, expresión `^/v1/(chat/completions|models)$`, apunta a `http://127.0.0.1:11434`. El diagnóstico Ollama `online: true` desde la aplicación desplegada comprueba ese enlace directo. No se generó una respuesta LLM para hacer esta verificación. Los informes conservan el nombre de diagnóstico utilizado en aquella fase; el endpoint operativo actual usa `scope=engine`.

El negocio de prueba `sarin-pruebas-20261015` mostró su reserva existente del 17 de octubre de 2026, 10:00–10:30, como confirmada. El calendario filtró un registro para ese día y la descarga ICS real contenía un evento de 15:00–15:30 UTC; el historial vacío era el estado esperado. No se crearon ni modificaron citas, pagos o generaciones de producción.

Se detuvo únicamente `sarin-bot-app-1` después de validar nombre, labels e imagen; `docker stop` tuvo 90 segundos de gracia y terminó en `exited (143)`, consistente con SIGTERM. `sarin-x509-rotate.timer` quedó disabled/inactive y el servicio oneshot inactivo. Se conservaron archivos, imagen/configuración y el grant Google de reversión. Los demás proyectos de la VPS no se tocaron.

También se cerró únicamente el proceso `ssh.exe -N` del forward antiguo `127.0.0.1:3032 → 127.0.0.1:3000` de la VPS. Su checkpoint previo quedó fuera de Git en `%LOCALAPPDATA%/SarinBot/cloudflare-migration-2026-10-16/legacy-forward-before-stop.json`. No se cerraron otras sesiones SSH. Tras cargar los trece secretos en Cloudflare, se borró solo `runtime-secrets.json` temporal de ese directorio; los originales de la VPS, el resto del respaldo y los secretos Cloudflare permanecen intactos. No volver a materializar esa copia temporal para documentar la operación.

Falta observar la renovación natural de credenciales al transcurrir aproximadamente una hora. La renovación concurrente se probó con el SDK y transporte sintético; el arranque fresco autenticado se verificó en producción, pero ninguno sustituye esa observación temporal. Tampoco se modificaron alertas/facturación ni se creó un commit Git. El diagnóstico SSH anterior no se ejecutó por `INSTANCE_NOT_READY` y no se agregaron claves SSH.

## Presupuesto operativo

Tarifas oficiales verificadas el 16 de octubre de 2026. Workers Paid cuesta USD 5/mes e incluye los siguientes consumos Containers:

| Recurso | Incluido al mes | Exceso |
| --- | ---: | ---: |
| Memoria | 25 GiB-h | USD 0,0000025/GiB-s |
| CPU activa | 375 vCPU-min | USD 0,000020/vCPU-s |
| Disco | 200 GB-h | USD 0,00000007/GB-s |

`basic` provisiona 1 GiB, 4 GB y hasta 1/4 vCPU. Para 30 días: base `5` + memoria `(720 − 25) × 3600 × 0,0000025 = 6,255` + disco `(2880 − 200) × 3600 × 0,00000007 = 0,67536` = **USD 11,93**, antes de CPU extra. Quedan aproximadamente USD 3,07 del máximo. CPU sostenida al 100 % de esa instancia añadiría aproximadamente USD 12,51; por eso 24/7 no es una promesa de permanecer bajo USD 15. El consumo se detiene al dormir y memoria/disco dependen de lo provisionado. Fuente: [precios Containers](https://developers.cloudflare.com/containers/platform/pricing/).

También cuentan Workers/DO, builds, egress que exceda sus bolsas e impuestos atribuibles a Sarin; Firebase y proveedores AI mantienen su facturación aparte. La base Workers ya existe en la cuenta: el cálculo anterior la incluye de forma conservadora y no implica contratarla ni pagar otra base. Registrar el criterio de reparto de bolsas/costos compartidos. El binding no añade otra tarifa de requests bajo Workers Standard; sí se acumula CPU de ambos Workers. Fuente: [precios Workers y service bindings](https://developers.cloudflare.com/workers/platform/pricing/#service-bindings).

Durante el seguimiento, registrar el ciclo, los impuestos aplicables y la proyección de Sarin; separar los otros proyectos. Propuesta pendiente de configurar: alertas de **USD 5 y USD 8 de consumo medido**, con el propietario como receptor, y revisión diaria de la proyección inicial. No se crearon alertas en esta migración. Las alertas cubren uso de toda la cuenta, excluyen cargos recurrentes como los USD 5 del plan y pueden llegar al día siguiente; no cortan consumo. Ajustar los umbrales al gasto base de las otras aplicaciones y acompañarlos con métricas de Sarin. Fuentes: [alertas](https://developers.cloudflare.com/billing/manage/budget-alerts/) y [condiciones de evaluación](https://developers.cloudflare.com/changelog/post/2026-06-15-budget-alerts-default-on/).

Si la proyección de Sarin para el ciclo supera USD 15, detener el tráfico hacia el contenedor antes de aumentar capacidad: aplicar la reversión revisada, conservar ambos flags WhatsApp en `false` y detener únicamente la instancia Sarin nueva. Verificar que no recibe requests y duerme/se detiene; otros usuarios o monitores pueden despertarla. El plan base existente continúa. No hay un corte automático de USD 15 implementado, y una alerta tardía no garantiza ese máximo.

## Preparación local

Desde la raíz, con el único lockfile del workspace:

```sh
pnpm install --frozen-lockfile
pnpm --filter sarin-cloudflare-host types
pnpm --filter sarin-cloudflare-host check
node --test pages-gateway/tests/*.test.mjs
pnpm run typecheck
pnpm test
pnpm run build
pnpm run build:pages
```

Guardar la evidencia de esa revisión concreta: revisión/commit, resultados, tamaño de imagen y fecha. `check` solo hace dry-run del Worker; el ensayo de imagen necesita Docker o un build remoto posterior. No confundir las pruebas sintéticas de STS/ADC o Workerd local con autenticación real Google. No leer ni imprimir cuerpos, tokens, claves o exportaciones privadas para conseguir evidencia.

Preparar `cloudflare/wrangler.build.json` con los cuatro valores públicos Firebase, según el [README](../cloudflare/README.md#build-y-runtime). Para Workers Builds: raíz del repositorio, instalación `pnpm install --frozen-lockfile`, build `pnpm --filter sarin-cloudflare-host configure:build`, deploy de producción `pnpm --filter sarin-cloudflare-host exec wrangler deploy --config wrangler.build.json`. Estos comandos de publicación no se ejecutan por instalar el kit. `wrangler versions upload` no sustituye el rollout de imagen.

## Identidad Google instalada y renovación por observar

El contrato federado es fijo:

| Campo | Valor |
| --- | --- |
| Issuer | `https://sarinbotsaas.pages.dev` |
| Discovery | `/.well-known/openid-configuration` |
| JWKS | `/.well-known/jwks.json` |
| Subject | `sarin-cloudflare-production` |
| Audiencia | `//iam.googleapis.com/projects/153690559048/locations/global/workloadIdentityPools/sarin-cloudflare/providers/worker-oidc` |
| Cuenta impersonada | `sarin-runtime@sarinbotsaas.iam.gserviceaccount.com` |
| Fuente ADC | `GET http://sarin-google.internal/token` |

`SarinIdentity` firma ES256 de cinco minutos y conserva claves/rotación; publica la siguiente clave y retiene la pública anterior al rotar. El endpoint interno verifica clase e ID singleton y no admite emisión pública. Solo ese host HTTP se intercepta; Firebase gRPC/TLS y Ollama HTTPS conservan transporte nativo. La identidad la emite esta aplicación; no es atestación nativa de Cloudflare.

`scripts/container-start.mjs` prepara ADC mediante `scripts/lib/cloudflare-credentials.mjs` y carga el servidor en el mismo proceso Node. Materializa `external_account` en un directorio temporal `sarin-google-*`, archivo `adc.json` con modo 0600, fuente interna fija e impersonación de la cuenta anterior; define `GOOGLE_APPLICATION_CREDENTIALS` y `GOOGLE_CLOUD_PROJECT` dentro del proceso. El archivo contiene configuración, no claves Google ni tokens. `FIREBASE_ADMIN_CREDENTIAL_MODE=adc` es explícito; se rechazan certificados mezclados, ADC humano y rutas host. No copiar el archivo X.509/ADC de la VPS.

Bootstrap realizado:

1. Se guardó fuera de Git la configuración Pages anterior y su referencia de deployment para reversión; la VPS y su identidad previa se conservaron.
2. Se prepararon las variables públicas WIF y la configuración privada del runtime existente, sin imprimir valores. `OLLAMA_MAIN_MODEL` permanece obligatorio; `OLLAMA_VISION_MODEL` está ausente de forma intencional, con `visionAvailable: false`. Ambos flags WhatsApp/retención siguen en `false`.
3. Se publicaron Worker, imagen y gateway Pages. Discovery/JWKS públicos devolvieron 200 sin necesitar el runtime autenticado de aplicación.
4. Se instalaron pool `sarin-cloudflare`, proveedor `worker-oidc` y grant de impersonación para el subject exacto, conservando el grant de la VPS. La inspección posterior del planificador no propuso cambios. Las operaciones gcloud necesitaron `--billing-project=sarinbotsaas`; el ajuste quedó incorporado a `scripts/cloudflare-wif-setup.mjs`.
5. Se agregó el origen canónico a Firebase Auth manteniendo los tres dominios ya autorizados.

La sesión Google y el acceso autenticado Firebase desde el contenedor se verificaron y se repitieron tras un arranque fresco. Permanece pendiente observar la renovación natural después de aproximadamente una hora, sin reiniciar el proceso. Registrar solo códigos, tiempos e identificadores no sensibles. No ampliar a Editor/Owner para resolver un error. Cotejar cualquier cambio posterior con la [guía oficial de federación OIDC de Google](https://cloud.google.com/iam/docs/workload-identity-federation-with-other-providers); conservar la confianza anterior mientras se necesite reversión.

## Aceptación de infraestructura y seguimiento

El binding, OAuth real, las lecturas Firebase/Firestore, el enlace Cloudflare→Mac, la suspensión y el nuevo arranque se aceptaron con evidencia. Las comprobaciones autenticadas se repitieron después de detener Sarin en la VPS. El cliente público mostró una reserva existente y descargó su ICS correcto; la migración de infraestructura queda cerrada como operativa.

Quedan separados de ese cierre:

- Observar renovación natural de credenciales tras aproximadamente una hora de vida del mismo proceso durante actividad autorizada; registrar que la instancia no reinició. Si duerme y arranca de nuevo, esa prueba vuelve a ser un arranque fresco, no renovación natural. La prueba sintética del SDK tampoco sustituye esta observación.
- Configurar/revisar alertas y proyección de gasto de Sarin, sin prometer un hard cap de USD 15.
- Guardar el código fuente y configuración revisada en Git; no se creó un commit en esta sesión.
- Resolver los pendientes comerciales del [informe de preparación original](qa/2026-10-16-production-readiness.md). No se generaron nuevas citas, pagos ni respuestas LLM de producción para declarar esta migración operativa.

En cambios posteriores, volver a comprobar que Pages no mezcle binding y variables del gateway antiguo. Mantener WhatsApp/retención en `false` hasta revisar su operación y presupuesto; una limpieza de contenido ya retenido requiere continuidad propia. Evitar dos procesos de aplicación contra la misma Mac y conservar evidencia sin cuerpos ni tokens.

## Reversión al runtime VPS conservado

Este procedimiento describe la reversión de alojamiento anterior a D1. Antes de ejecutarlo ahora, cumplir la reconciliación del [runbook de datos](cloudflare-data-migration.md): bloquear entradas, drenar y detener, exportar D1/R2 y reconciliar/verificar Firestore si existen escrituras posteriores al corte. Mantener una sola instancia. No reabrir una imagen Firestore sobre una copia obsoleta.

El runtime Sarin anterior está detenido; su certificado X.509 puede caducar mientras el timer permanece deshabilitado. Restaurar únicamente un deployment Pages no lo vuelve a arrancar. La copia previa de configuración está fuera de Git. Ante fallo de identidad, motor, aplicación o presupuesto:

1. Retirar el tráfico de aplicación de Cloudflare mediante la configuración de contingencia revisada y detener o dejar dormir su contenedor. Confirmar ambos flags WhatsApp en `false`; no iniciar simultáneamente el runtime VPS contra la misma Mac.
2. En la VPS, comprobar que el contenedor conservado sigue siendo `sarin-bot-app-1` del proyecto Sarin y que conserva su imagen/configuración. No operar sobre contenedores ni timers de otros proyectos.
3. Renovar primero el certificado de Sarin con `systemctl start sarin-x509-rotate.service` y comprobar que el servicio terminó correctamente sin imprimir credenciales. Rehabilitar su programación con `systemctl enable --now sarin-x509-rotate.timer`.
4. Arrancar el contenedor existente con `docker start sarin-bot-app-1`. Confirmar salud/autenticación del backend anterior antes de devolverle tráfico. Si la renovación o el arranque falla, no sustituir permisos por roles amplios ni reconstruir desde secretos impresos.
5. Restaurar el deployment Pages anterior registrado en el respaldo y su configuración de build, variables y bindings. `054fe0f0-5b12-42fb-84c7-e7b193118401` identifica el despliegue Cloudflare nuevo, no el destino de reversión. Si el estado anterior no tenía `SARIN_APP_HOST`, retirarlo de esa configuración; un rollback de artefacto por sí solo no demuestra ese cambio.
6. Para volver a HTTPS/Access, quitar el binding y configurar explícitamente sus tres variables desde la copia privada. Para volver a la landing anterior, restaurar su build/configuración para que el siguiente build Git no republique el gateway. No mezclar modalidades ni esperar fallback automático.
7. Repetir sesión autenticada y salud del motor con el origen público. Conservar los dominios Firebase, grants Google, claves del issuer e imágenes hasta decidir la recuperación completa. Después de migrar datos, los destinos ya no comparten base: aplicar primero la reconciliación y permisos necesarios del runbook de datos.

La parada de `sarin-bot-app-1` y la desactivación del timer retiraron la dependencia del proceso VPS sin borrar la máquina, sus archivos o respaldos. La eliminación definitiva de recursos conservados y cualquier acción sobre otros proyectos quedan fuera de esta migración.

## Drenaje del singleton durante mantenimiento

Con `SARIN_MAINTENANCE=true`, el Worker devuelve 503 antes de obtener el singleton para las rutas de aplicación, salvo las excepciones operativas explícitas. Mantiene discovery/JWKS y `GET /api/sarin/health?scope=engine`, con esa consulta exacta. La candidata local del piloto (`003f5ab` y posteriores) añade `GET` y `PATCH` en la ruta exacta `/api/admin/abuse`: GET admite ausencia de query o únicamente `?cursor=<UUID válido>`, una sola vez; PATCH no admite query. Ambas excepciones requieren `Authorization: Bearer <token>` sin espacios en el token; el Worker conserva el Bearer y Next verifica Firebase y exige el UID superadministrador. El encabezado por sí solo no autoriza. Otros métodos, cursores inválidos, parámetros adicionales/repetidos y rutas siguen bloqueados; la excepción de salud conserva su comportamiento anterior. Esta descripción de la candidata no afirma que ya esté publicada.

Con una sesión válida de superadministrador, consultar ese endpoint operativo para observar `queue.activeSlots` y `queue.queuedRequests` antes y después de activar mantenimiento. Esperar ambos contadores en cero antes de continuar con una operación que requiera drenar solicitudes. Esta consulta solo comprueba el catálogo del motor y la cola; no ejecuta inferencias ni escrituras. Las tareas programadas no arrancan el contenedor durante mantenimiento. La consulta de salud sí puede despertarlo o mantenerlo activo: detener el sondeo al terminar para permitir su suspensión tras dos minutos de inactividad. No hace falta una interfaz de chat personal para este diagnóstico.

Si Ollama está fuera de línea, Next responde 503. Únicamente para esa consulta de mantenimiento, el Worker transforma una respuesta JSON con los cinco contadores de cola válidos en HTTP 200 y devuelve solo `status: 'offline'`, `online: false`, `provider: 'ollama'` y `queue`. Esto permite observar el drenaje a través de Pages; el 200 no indica que el motor esté disponible. No expone modelos, errores ni texto del upstream. Una cola ausente o inválida conserva un fallo genérico, y las respuestas 401/403 de autenticación no se transforman.

## Piloto: presupuesto y operación de la candidata local

Contrato de `003f5ab` y posteriores, publicado con la compuerta activa el 16 de octubre de 2026 a las 23:44 de Colombia. [Aceptación productiva](qa/2026-10-16-production-commercial-pilot.md). El presupuesto monetario es independiente de las respuestas compradas y de los avisos de Cloudflare. `PILOT_AI_BUDGET_ENFORCED=false` o ausente mantiene la compatibilidad anterior; no reserva dinero. Su activación para el piloto requiere mantenimiento, configuración privada válida y verificación explícita. La cola continúa en una sola instancia.

### Administración privada

`GET /api/admin/abuse` y `PATCH /api/admin/abuse` exigen superadministrador. GET presenta configuración, estado de la compuerta y llamadas; su listado admite cursor UUID, páginas de 50 leyendo 51 y orden ascendente por id. **No es un listado de las llamadas más recientes.** Se puede paginar durante mantenimiento mediante `GET /api/admin/abuse?cursor=<UUID válido>`: `cursor` es el único parámetro permitido y no puede repetirse. GET sin query obtiene la primera página; un cursor inválido o cualquier parámetro adicional queda fuera de la excepción. PATCH sigue sin admitir query. Esto no amplía el acceso del navegador a D1 ni sustituye la autorización de Next.

Para configurar, enviar por PATCH un objeto de este contrato, usando la versión vigente leída; los valores siguientes son los previstos para el piloto, no una configuración real aplicada por este documento:

```json
{
  "action": "configure",
  "expectedVersion": 0,
  "paused": false,
  "limits": {
    "globalDayUsd": 0.5,
    "globalMonthUsd": 8,
    "businessDayUsd": 0.1,
    "businessMonthUsd": 2,
    "globalDayTokens": 20000000,
    "globalMonthTokens": 300000000,
    "businessDayTokens": 2000000,
    "businessMonthTokens": 30000000
  },
  "reason": "Configuración revisada del piloto"
}
```

`expectedVersion: 0` corresponde únicamente a configuración inexistente; después debe usarse la versión actual. No reintentar sobrescribiendo una actualización concurrente. Los límites se revisan según financiación y consumo; USD 8 no garantiza cubrir todos los cupos vendidos.

Para conciliar una llamada, PATCH recibe `{ action: 'reconcile', callId, resolution: 'keep_reserved' | 'confirmed_not_charged', reason, evidence }`. `callId` es UUID; motivo y evidencia deben justificar la decisión sin incluir secretos o conversaciones. `keep_reserved` conserva el importe retenido; `confirmed_not_charged` solo procede con evidencia de que el proveedor no cobró. No equivale a marcar una reserva incierta como consumo cero ni a reiniciar cuotas comerciales.

Cada llamada conserva la tarifa versionada y los coeficientes usados para su estimación/conciliación; cambiar tarifas no revaloriza retroactivamente registros previos. Uso o metadatos desconocidos y timeouts retienen la reserva **sin TTL ni pausa global automática por ese solo motivo**. Un modelo/tier explícitamente inesperado o un exceso de la cota reservada sí pausa nuevas llamadas globalmente. No liberar una reserva por antigüedad ni repetir una operación para intentar resolver la incertidumbre.

### Activación y reversión

Seguimiento de presupuesto individual: [contrato y QA](qa/2026-10-16-business-ai-budget.md). `GET /api/admin/abuse?businessId=<id>` permite comprobar un negocio durante mantenimiento con autenticación de superadmin. `PATCH action: configure_business` requiere `businessId`, `expectedVersion` de excepción, `expectedSettingsVersion` general, `limits: {businessDayUsd,businessMonthUsd} | null` y motivo. Usar versiones recién leídas; `null` restaura herencia manteniendo versión. No reiniciar períodos ni conciliar llamadas desconocidas para aumentar margen. La excepción cambia USD del negocio, conserva tokens heredados y topes globales. No reabrir un Worker/runtime anterior que ignore estos contratos.

1. Identificar la candidata y sus checks. Verificar backup recuperable de D1/R2 y, por separado, Auth y configuración; D1/R2 no respalda por sí solo identidades o secretos.
2. Activar `SARIN_MAINTENANCE=true` y observar cola con `activeSlots=0` y `queuedRequests=0`. Conservar una sola instancia y ambos flags WhatsApp desactivados.
3. Publicar la candidata con la entrada pública cerrada y compuerta presupuestaria en `false`. Validar sesión administrativa y las dos excepciones exactas de mantenimiento; no reabrir aún.
4. Leer y configurar `serverSettings/pilotAiBudget` mediante la API autorizada, comprobando versión, ocho límites y pausa. Revisar reservas inciertas; no purgarlas para conseguir saldo disponible.
5. Activar explícitamente `PILOT_AI_BUDGET_ENFORCED=true` manteniendo mantenimiento. Confirmar mediante GET el estado efectivo de compuerta/configuración y repetir drenaje. Las pruebas de la candidata deben acreditar rechazo antes del fetch; un 503 genérico del Worker por mantenimiento no demuestra un corte `AI_BUDGET_*`.
6. Reabrir únicamente después de esas comprobaciones, manteniendo una instancia. Registrar versión y resultados sin tokens; observar gasto, reservas retenidas y agenda.

Un 503 `AI_BUDGET_*` representa una pausa/control operativo; no es el 402 de agotamiento de capacidad comercial. Un rechazo presupuestario antes de inferir no consume una respuesta del plan; no equivale a garantizar recepción de cada respuesta HTTP en el navegador. Si ya existe una operación confirmada, conservar su recuperación e impedir repetirla. La prueba mantiene diez citas y 700 respuestas independientes; cancelar no devuelve un cupo ya consumido.

Al revertir, volver a mantenimiento y drenar. Conservar propuestas y políticas de reserva, invitaciones, períodos, reservas monetarias y contadores; no borrar datos para adaptar una imagen antigua. No reabrir una versión que permita reservar mediante la herramienta antigua confiando solo en el prompt y omita la confirmación de servidor. Si la imagen anterior no interpreta los nuevos contratos, mantener cerradas las nuevas reservas hasta disponer de una versión compatible; restaurar solo imagen/flags no acredita una reversión segura. Este procedimiento documental no ejecuta un despliegue.

## Candidato P2 — secuencia propuesta y reversión compatible

Este procedimiento es una **propuesta para revisión del titular**, no una orden de publicación o activación. El [informe candidato](qa/2026-10-18-whatsapp-adaptation.md) permanece en validación; las pruebas previas con destinatarios reales están cerradas. La aprobación del plan cubre implementación aislada y datos sintéticos. Faltan las comprobaciones globales, revisión independiente y evidencia externa enumeradas allí. Las referencias de artefactos R6/A5 y la entrega comercial v20 en los informes previos son históricas; antes de operar se debe identificar de nuevo el artefacto realmente instalado y el destino anterior verificado.

### Compuertas y costo antes de habilitar

Pedir al titular una revisión concreta del candidato final: commit/árbol y manifiesto de cinco documentos más fuente/tests, resultado completo de tests/types/build/QA, respaldos recuperables de D1/R2, Firebase Auth y configuración, estado del singleton y destino anterior compatible. Confirmar migraciones aditivas `0004_platform_outbox_status.sql`, `0005_platform_work_continuation.sql`, `0006_platform_support.sql`, sin purga. Preparar secretos distintos y privados para contenido, vínculo, soporte y propuesta de pago, cada uno de 32 bytes base64 canónico; conservar sus marcadores estables. No compartir una clave entre propósitos ni rotarla sobre datos vigentes. El vínculo y el pago requieren reautenticación reciente, y el soporte legal `2026-10-21.1` se acepta separadamente de cuenta/negocio `2026-10-18.2`; verificar constancias inmutables y enlace vigente antes del piloto.

Registrar una hoja de costos revisada por el titular, sin cuerpos de mensajes: máximo `maximumMicros` por etapa, presupuesto diario `PLATFORM_WHATSAPP_{AUDIO,GENERATION,SEND}_DAILY_BUDGET_MICROS`, proyección y alertas diarias/mensuales USD en UTC, uso/reservas retenidas/incertidumbre, actividad Containers/D1/R2/Workers y las cuotas comerciales independientes. El máximo de audio se deriva de 120.000 ms por tarifa; el de envío, de una unidad por tarifa; el de generación, de bytes de entrada + 4.096 y 4.096 tokens de salida con las tasas versionadas que exige el código. Definir y revisar `PLATFORM_WHATSAPP_TARIFF_POLICY` con tarifas reales, máximos y evidencia de categoría/destinos de envío; `PLATFORM_WHATSAPP_GENERATION_POLICY` debe listar modelos reales devueltos por DeepSeek. El alias solicitado `deepseek-flash` no demuestra por sí mismo el modelo de respuesta. Un modelo/uso/tarifa desconocido mantiene reserva o cierra el circuito, según la etapa; no liberar por antigüedad ni reintentar para obtener un costo aparente menor. No hay cobro, recarga automática ni presupuesto nuevo aprobado por este texto. Mensajes plantilla fuera de la ventana de servicio permanecen deshabilitados y aquí no se les asigna precio.

[API keys de YCloud](https://docs.ycloud.com/en/documentation/developer/manage-api-keys) documenta una clave a nivel de cuenta, no de usuario/equipo/teléfono; las [claves por activos/permisos](https://docs.ycloud.com/en/documentation/developer/create-and-configure-a-custom-app) requieren plan de pago y no resuelven el alcance Free. Los [webhooks](https://docs.ycloud.com/en/documentation/developer/webhooks) documentan endpoint de cuenta, firma y reenvío por fallo, sin probar duplicación ordinaria de un webhook exitoso. La [consulta pública de número propio](https://docs.ycloud.com/reference/whatsapp_phone_number-retrieve) describe GET por WABA/número y eventos opcionales, pero no prueba titularidad real, propagación, desconexión ni mapeo universal de eventos. Revisión pública de 22-10-2026 UTC, sin llamada autenticada. Permanecen **BLOQUEADAS** la automatización y cualquier activación que dependa de alcance/entitlement real de Free, duplicado exitoso, offboarding/GET en la cuenta y mapeo wire; documentar evidencia contractual y una comprobación autorizada antes de reconsiderarlas.

### Orden propuesto, cada cambio con autorización concreta

1. Fijar candidato y destino de reversión realmente verificados; registrar hash de fuente, tests, documentos, artefacto y respaldo fuera de Git. Mantener una sola réplica. Revisar D1/R2, identidad y configuración por separado, las tres migraciones, estado de retención y datos pendientes. Coordinar mantenimiento y drenaje de cola/outbox para no abandonar un envío o una limpieza.
2. Con aprobación específica de publicación, mantener recepción, procesamiento, transcripción, audio, IA y envío `false`, presupuestos nuevos en cero, y publicar solo el candidato compatible. Verificar migraciones, login/permisos, rutas privadas, estado de las flags, Worker y cron limpiador, sin proveedor ni destinatario. Limitar `SARIN_MAINTENANCE=true` al corte; al retirarlo, verificar limpieza de cuerpos/control y backlog aun con flags de automatización apagadas.
3. Pedir autorización separada para **recepción** con el WABA/número y titularidad exactos, propósito, alcance de la key Free y costo. Verificar firma/alcance, persistencia cifrada, consentimiento, idempotencia y offboarding con evidencia permitida. Un 200 firmado o una prueba sintética no cierra la prueba de duplicado exitoso; si falta, mantener las etapas de automatización apagadas.
4. Solo después de cerrar esas compuertas, pedir autorización separada para **piloto**: destinatarios consentidos y titular vinculado identificados por el titular, acciones exactas, ventana, máximo por etapa, presupuesto y alertas. Después, y también por separado, autorizar audio, botones, intervención humana y confirmación web administrativa de una propuesta de pago. El audio/transcripción no acepta términos ni aprueba pagos; el chat solo prepara una propuesta, cuya confirmación exige web y autenticación reciente. No inferir destinatarios de números usados en ensayos anteriores.

### Reversión sin pérdida ni reactivación

Ante fallo, cerrar entrada/transcripción/IA/envío y capacidades de audio, cancelar trabajo pendiente y revocar autoridad/vínculo antes de cambiar artefacto; mantener el singleton y registrar estados inciertos sin repetir efectos externos. Drenar bajo mantenimiento solo el tiempo necesario. Conservar una versión compatible del Worker que siga limpiando `platformWhatsAppEvents`, `platformWhatsAppConversations`, `platformWhatsAppLinks`, jobs/outbox/presupuestos, `platformSupportConversations`/`platformSupportMessages` y `adminPaymentActions` hasta los vencimientos originales aunque las flags estén apagadas. Reanudar el cron tras mantenimiento: en `cloudflare/src/index.ts` pago se limpia siempre fuera de mantenimiento; soporte se limpia directamente si la flag de retención plataforma está apagada o por el despacho de retención plataforma si está encendida. Auditar `morePending`/errores y continuar páginas acotadas; la pausa de mantenimiento no extiende el plazo de lectura de texto expirado.

Conservar cifrados contacto, contenido, descriptor de audio y transcripción hasta su límite original de 24 h y controles mínimos hasta 30 días; audio bruto solo estuvo en RAM. Preservar marcadores de claves, recibos legales bajo política separada, índices/migraciones aditivas, períodos/reservas y datos locales de navegador de versiones retiradas. Nunca revivir un cuerpo borrado ni purgar datos para que una imagen vieja arranque. Si el artefacto anterior no entiende los nuevos registros o no ejecuta su limpieza, mantener las capacidades cerradas y el limpiador compatible activo hasta expirar los datos; reconciliar D1/R2 y Auth/configuración antes de cualquier reversión a Firestore/VPS conforme al runbook de datos. Un rollback de código o flags por sí solo no valida la reversión.
