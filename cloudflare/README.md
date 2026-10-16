# Sarin en Cloudflare Containers, sin VPS

La infraestructura y el corte de datos D1/R2 quedaron **activados y aceptados el 16 de octubre de 2026** en `https://sarinbotsaas.pages.dev`. Este es el recorrido de producción:

```text
Navegador → Pages gateway → SARIN_APP_HOST → Worker sarin-bot-app
                                          ├─ SarinIdentity: claves OIDC
                                          └─ SarinApp: un contenedor Node 24
                                               ├─ Firebase Auth
                                               ├─ sarin-data.internal → Worker → D1 / R2 privado
                                               └─ Tunnel + Access → Ollama en la Mac
```

Pages usa un service binding privado. El Worker conserva `workers_dev: false`, `preview_urls: false` y ninguna ruta pública propia; no necesita hostname de backend ni credenciales Access de la VPS. El motor sigue usando HTTPS bajo `alsdevstudio.com`. Firebase se conserva únicamente para Auth y D1 es la única fuente comercial. Firestore queda como copia de reversión y backend de emuladores, sin fallback automático autorizado. El alcance activo es comercial; Vault y el proyecto de chat personal se retiran sin purgar automáticamente datos locales de versiones anteriores en los navegadores.

Tras aceptar el corte se retiró `roles/datastore.user` de la cuenta runtime dedicada; conserva `roles/firebaseauth.viewer` y WIF. Se repitieron sesión y citas después del retiro. La imagen antigua de la VPS comparte esa cuenta y necesitaría recuperar el permiso mínimo además de reconciliar datos antes de volver a Firestore; no basta arrancarla. Ver [reversión de datos](../docs/cloudflare-data-migration.md#reversión).

Durante la aceptación de infraestructura, previa al corte de datos, se publicaron el Worker, la imagen y Pages con `SARIN_APP_HOST`. Se comprobaron login Google real, lecturas autenticadas Firebase/Firestore y conexión directa Cloudflare→Ollama en la Mac. Tras dormir y arrancar de nuevo el contenedor, sesión y diagnóstico de Ollama volvieron a responder 200. También respondieron 200 después de detener el runtime Sarin de la VPS; la aplicación ya no depende de ese proceso. Los informes de esa fase conservan las pantallas y los nombres anteriores como evidencia histórica.

El contenedor VPS `sarin-bot-app-1` está detenido, su timer X.509 deshabilitado y el forward SSH local anterior cerrado. Imagen, configuración, archivos y confianza Google anterior se conservan para reversión, sin afectar otros proyectos. Se eliminó el archivo temporal usado para transferir los trece secretos; los originales VPS y los secretos Cloudflare permanecen intactos. Workers Paid está confirmado y no hubo cambios de facturación. Quedan pendientes las alertas de presupuesto, guardar el código en Git, observar la renovación natural de credenciales de una hora y los puntos comerciales del informe original. Ollama estuvo fuera de línea durante el corte de datos; el 16 de octubre de 2026, hacia las 11:37 UTC, el diagnóstico autenticado volvió a mostrar `online:true` y la cola vacía durante el retiro de Vault. Sigue pendiente la aceptación de una conversación comercial completa. El corte aceptado no declara una apertura comercial completa. Consulta la [evidencia de infraestructura](../docs/qa/2026-10-16-cloudflare-migration.md), la [aceptación de datos](../docs/qa/2026-10-16-cloudflare-data-migration.md), la [evidencia del enfoque comercial](../docs/qa/2026-10-16-commercial-focus.md) y el [runbook de infraestructura](../docs/cloudflare-no-vps-runbook.md).

## Datos D1/R2

`SARIN_DATA_BACKEND=d1` selecciona explícitamente la interfaz de datos propia del proyecto. Next llama a `http://sarin-data.internal/execute`; el Worker solo acepta ese transporte para la clase SarinApp y su instancia singleton, con bindings `SARIN_DB` y `SARIN_FILES`. El bucket es privado. Las entidades mantienen rutas documentales y JSON, y las consultas usan parámetros e índices del esquema `migrations/0001_data.sql`. No hay acceso SQL ni credenciales de almacenamiento en el navegador, ni fallback automático a Firestore.

El corte importó y verificó por hash **19 de 19 documentos**, con **0 archivos** y revisión inicial **0**. El nuevo contenedor, imagen `2bd1c2d86293…` y versión 2, se confirmó `running` mediante la API a las 11:13:25 UTC. El Worker `17d0d7e0…` quedó sin mantenimiento, con D1 activo y los 13 secretos conservados. Respondieron 200 la sesión, las lecturas administrativas de IA/uso/WhatsApp, la proyección pública y la agenda. La interfaz mostró una cita confirmada existente; el historial del cliente estaba vacío y la descarga de un `.ics` nuevo de 360 bytes se comprobó a las 11:13:47 UTC. No se crearon citas ni pagos de producción para probar. La [evidencia del corte](../docs/qa/2026-10-16-cloudflare-data-migration.md) conserva el detalle.

Las transacciones leen una revisión global y confirman un batch atómico que comprueba e incrementa esa revisión; un conflicto vuelve a ejecutar el callback. Los commits llevan UUID para resolver respuestas perdidas sin duplicar efectos. Las imágenes se suben primero a R2 con clave de hash y luego se referencian desde D1. D1/R2 no tienen una transacción común: un fallo puede dejar un archivo privado sin referencia, que no se elimina automáticamente. Las consultas de lista no cargan los bytes de imágenes.

El navegador conserva únicamente el SDK Firebase Auth y llama a las API con su ID token. Los cuatro listeners Firestore se sustituyeron por refresco de 15 segundos tras cada lectura, pausado en pestañas ocultas y reanudado al recuperar foco. Cambiar UID o negocio aborta y descarta respuestas anteriores. La proyección pública `/api/public/businesses/[slug]` solo devuelve `publicBusinesses`; agenda e historial conservan autorización por UID/negocio. El puente rechaza lecturas de más de 1.000 documentos con `413 DATA_LIMIT`, sin truncamiento silencioso; los listados administrativos conservan su límite explícito de 500 y necesitan paginación antes de crecer.

El [procedimiento de corte de datos](../docs/cloudflare-data-migration.md) exige copia privada verificable, mantenimiento, drain del proceso que sirve tráfico, parada de escritores anteriores e importación íntegra antes de activar D1. Firestore se conserva sin nuevas escrituras después del corte. Si D1 ya recibió escrituras, cualquier reversión requiere exportarlas y reconciliarlas antes de volver a Firestore; no basta con cambiar el flag o arrancar la imagen antigua.

## Verificación local

El kit de impresión usa `SARIN_PUBLIC_BOOKING_ORIGIN=https://sarinbotsaas.pages.dev`, explícito y solo del servidor. La configuración revisada lo reenvía al contenedor y los tipos se generan con Wrangler. La ruta del kit falla de forma controlada si falta o apunta a un origen inválido; no utiliza Host, Forwarded ni el dominio de preview. En emuladores `demo-*` se admite HTTP loopback para QA. Revisar la URL completa antes de imprimir; un cambio futuro de dominio exige conservar la redirección del enlace impreso. Este cambio local no configura recursos reales hasta desplegarlo.

Usa Node 24 y pnpm 11.23.0 desde la raíz del repositorio, con el lockfile compartido:

```sh
pnpm install --frozen-lockfile
pnpm --filter sarin-cloudflare-host types
pnpm --filter sarin-cloudflare-host check
node --test pages-gateway/tests/*.test.mjs
pnpm run typecheck
pnpm test
pnpm run build:pages
```

`types` regenera `worker-configuration.d.ts`; no lo edites manualmente. `check` ejecuta pruebas, TypeScript y un dry-run del Worker con `--containers-rollout=none`. No publica recursos ni construye la imagen. El dry-run completo `pnpm --filter sarin-cloudflare-host dry-run` construye la imagen y requiere Docker activo. Workers Builds ofrece la alternativa de construirla en Cloudflare. La verificación final registró 675 pruebas de aplicación aprobadas con 20 integraciones omitidas, 18 del CLI de migración y 67 del Worker. El gateway conserva sus 25 pruebas de la fase anterior. La evidencia de builds y aceptación externa autenticada se registra por separado en [QA de datos](../docs/qa/2026-10-16-cloudflare-data-migration.md).

## Build y runtime

`cloudflare/wrangler.jsonc` mantiene `@cloudflare/containers` 0.3.7, un contenedor `basic`, máximo una instancia y el nombre constante `sarin-global-app`. `configure:build` genera `cloudflare/wrangler.build.json`, ignorado por Git, con únicamente los cuatro argumentos públicos Firebase:

```sh
pnpm --filter sarin-cloudflare-host exec node --env-file=../deploy/firebase.public.env scripts/configure-build.mjs
```

Ese archivo de entrada contiene la configuración pública de `deploy/firebase.public.env.example`. No incluye secretos Admin, Access, proveedores ni tokens Cloudflare. El Dockerfile conserva Node 24 y un solo proceso de aplicación.

El runtime Cloudflare declara explícitamente ADC, proyecto `sarinbotsaas`, audiencia WIF y cuenta `sarin-runtime@sarinbotsaas.iam.gserviceaccount.com`. La fuente de identidad es `http://sarin-google.internal/token`, interceptada dentro de Cloudflare para el contenedor autorizado. `scripts/container-start.mjs` materializa un ADC `external_account` temporal y privado mediante `scripts/lib/cloudflare-credentials.mjs`; no reutiliza ADC humano, certificados ni archivos de la VPS. El issuer público sirve discovery/JWKS incluso antes de configurar el runtime de aplicación. La emisión de tokens no tiene ruta pública.

La configuración privada de `SUPERADMIN_UID`, `SARIN_TUNNEL_URL`, `OLLAMA_MAIN_MODEL` y el par `CF_ACCESS_CLIENT_ID`/`CF_ACCESS_CLIENT_SECRET` del motor se preparó fuera de Git, conservando los valores del runtime existente. `OLLAMA_VISION_MODEL` es opcional y permanece ausente: las imágenes requieren un modelo de visión configurado y disponible; salud informa `visionAvailable: false`. La lista explícita también admite proveedores cloud, perfil de prueba Gemini, precios, límites de inferencia y WhatsApp. No copia variables arbitrarias ni permite emuladores o rutas ADC externas. `deploy/runtime.env.example` documenta otras modalidades de host; no se debe cargar completo sobre el destino federado de Cloudflare.

## Ciclo de vida y privacidad

El contenedor duerme después de dos minutos sin actividad. El SDK mantiene activos los requests y streams en curso; una caída o despliegue aún puede interrumpirlos y perder la cola en memoria. No se reintentan automáticamente POST. En una reversión, evita ejecutar simultáneamente los runtimes Cloudflare y VPS contra el motor: cada proceso tendría su propia cola y multiplicaría los slots.

`WHATSAPP_ENABLED` y `WHATSAPP_RETENTION_ENABLED` empiezan en `false`. El cron de cinco minutos no obtiene ni arranca un contenedor mientras ambos estén apagados. Habilitar cualquiera mantiene el proceso despierto y permite recuperarlo tras una parada, lo que exige revisar el presupuesto. Si ya existen cuerpos WhatsApp retenidos, no desactives su limpieza para ahorrar: resuelve antes esa operación y su costo.

El gateway y el Worker preservan streams, eliminan cabeceras de transporte sensibles y aplican `no-store`. La observabilidad está desactivada. El DO de aplicación conserva metadatos del SDK; el issuer conserva claves de firma y metadatos de rotación. Ninguno recibe conversaciones para almacenarlas. La salida Firebase/Ollama mantiene TLS nativo: solo se interceptan los hosts HTTP virtuales `sarin-google.internal` para identidad y `sarin-data.internal` para datos, con `interceptHttps = false`.

## Presupuesto y seguimiento

El máximo autorizado para Sarin es **USD 15 al mes**. Una instancia `basic` durante 30 días completos suma aproximadamente **USD 11,93 con la base Workers de USD 5 incluida**, antes de CPU adicional y otros consumos atribuibles a Sarin. Esta estimación propia usa las [tarifas oficiales de Containers](https://developers.cloudflare.com/containers/platform/pricing/), verificadas el 16 de octubre de 2026. El timeout de dos minutos reduce actividad ociosa; no es un límite automático de gasto.

Las [alertas de presupuesto](https://developers.cloudflare.com/billing/manage/budget-alerts/) avisan y no detienen consumo. Falta configurar/verificar alertas y medir la proyección de Sarin, separada de otras aplicaciones de la cuenta; no se ha confirmado un tope técnico de USD 15. El [runbook](../docs/cloudflare-no-vps-runbook.md#presupuesto-operativo) incluye cálculo, margen y qué detener si el consumo proyectado rebasa el máximo.

Al volumen inicial inspeccionado, el incremento esperado de D1/R2 es USD 0 dentro de las cantidades incluidas; no es una garantía para uso comercial. El almacenamiento, las lecturas/escrituras, las operaciones y el tráfico deben medirse junto con Containers. Referencias oficiales verificadas el 16 de octubre de 2026: [D1](https://developers.cloudflare.com/d1/platform/pricing/) y [R2](https://developers.cloudflare.com/r2/pricing/).

Pages tiene confirmado el binding `SARIN_APP_HOST` en producción y el build `pnpm run build:pages`, con salida `landing/out`. El modo HTTPS/Access anterior queda disponible solo para una reversión configurada explícitamente: mezclarlo con el service binding falla cerrado. La copia previa de configuración está fuera de Git. Antes de volver a la VPS, resolver la [reversión de datos](../docs/cloudflare-data-migration.md#reversión) si D1 recibió escrituras. Después, renovar su certificado X.509, rehabilitar su timer y arrancar únicamente el contenedor Sarin conservado, con el runtime Cloudflare detenido. Consulta el [procedimiento de reversión de runtime](../docs/cloudflare-no-vps-runbook.md#reversión-al-runtime-vps-conservado).
