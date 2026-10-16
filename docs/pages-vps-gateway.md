# Pages como entrada única al VPS

Estado: implementación local preparada y probada con tráfico sintético. Este trabajo no configura Pages, DNS, Tunnel, Access, Firebase ni el VPS y no publica el servicio. El origen público acordado es `https://sarinbotsaas.pages.dev`.

El navegador usa ese mismo origen para `/`, `/dashboard`, `/b/<slug>`, `/admin`, `/_next/*` y `/api/*`. Pages ejecuta un gateway pequeño que reenvía las peticiones al Next.js del VPS. Firebase Admin, las cuotas, las herramientas, la cola y las integraciones siguen en Node 24, con una única réplica de la aplicación. No se intenta ejecutar Next ni Firebase Admin en el edge.

En modo activo, **todas** las rutas y todos los archivos vienen del mismo build Next del VPS. Esto evita mezclar HTML del SaaS con archivos `/_next` de la landing exportada. El gateway tampoco combina respuestas ni reintenta peticiones.

Cloudflare documenta que el modo avanzado usa `_worker.js` en el directorio de salida y que el Worker controla todas las peticiones. Los archivos estáticos se obtienen explícitamente mediante `env.ASSETS.fetch(request)`. Referencia: [Pages advanced mode](https://developers.cloudflare.com/pages/functions/advanced-mode/).

## Configuración privada de Pages

| Variable | Uso |
| --- | --- |
| `SARIN_PUBLIC_ORIGIN` | Valor exacto `https://sarinbotsaas.pages.dev`. Obligatorio al activar el backend. |
| `SARIN_APP_ORIGIN` | Origen HTTPS de un subdominio de `alsdevstudio.com` dedicado a Next en el VPS; por ejemplo, un nombre de aplicación que el operador haya creado y verificado. |
| `SARIN_APP_ACCESS_CLIENT_ID` | Identificador del service token de Access dedicado a este gateway. |
| `SARIN_APP_ACCESS_CLIENT_SECRET` | Secreto de ese service token, almacenado como secreto de Pages Functions. |

Estas variables son de **runtime del servidor**. No se agregan a `NEXT_PUBLIC_*`, al código cliente, a Docker ARG ni al artefacto público. El empaquetador no lee sus valores. El token de aplicación debe ser distinto al usado por el motor Ollama; la separación operacional se comprueba en Access, no comparando secretos dentro del gateway.

`SARIN_APP_ORIGIN` acepta solamente el origen, sin barra final, puerto explícito, usuario, contraseña, ruta, consulta ni fragmento. Rechaza dominios externos, el dominio raíz y el hostname de motor `ia-sarin.alsdevstudio.com`. La validación del sufijo no crea un hostname ni confirma quién lo opera: el operador debe verificar que es el túnel de **Next del VPS**, nunca el motor `/v1/chat/completions`.

Guardar el ID y el secreto exclusivamente en la configuración privada de Pages Functions. Aplicar las mismas restricciones a producción y a cualquier entorno de prueba que se decida habilitar; el gateway activo rechaza peticiones cuyo origen público sea otro hostname, incluidas URLs preview de Pages.

Configurar explícitamente **`compatibility_date: 2026-10-13`** en el runtime de Pages Functions antes de activarlo, y repetir una comprobación local en Workerd/Miniflare con esa misma fecha. La revisión local ha verificado este gateway con esa fecha y ha reproducido `503` con la fecha histórica `2022-01-01`; no aceptar el valor predeterminado sin revisar. El `_worker.js` y `_routes.json` no fijan por sí mismos la fecha de compatibilidad. Si se usa configuración Wrangler para desplegar, registrar allí el valor; si se configura en Pages, comprobar el valor efectivo del entorno de producción y el de preview por separado. No cambiar de fecha posteriormente sin repetir la comprobación del runtime y las pruebas de límites. Esta preparación no ha modificado ninguna configuración de la cuenta.

La documentación de Cloudflare explica las [variables y bindings de Pages](https://developers.cloudflare.com/pages/functions/bindings/) y los [service tokens y políticas Service Auth](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/).

## Comportamiento ante configuración ausente o fallos

- Si no hay ninguna variable de backend, solo `GET`/`HEAD` de la landing y de sus archivos conocidos usa `ASSETS`. `SARIN_PUBLIC_ORIGIN` puede estar ausente o tener el valor canónico.
- `/dashboard`, `/b/*`, `/admin`, `/api/*`, los archivos privados, las rutas desconocidas y cualquier escritura devuelven `503` sin caché. No se simula una sesión ni se oculta la falta de backend con un `404` de la landing.
- Una configuración parcial o inválida falla con `503` también en `/`. Si el backend está configurado, una caída del VPS no muestra la landing como si la aplicación siguiera disponible.
- Las respuestas `5xx`, los desafíos de Access/WAF, los errores de transporte y las denegaciones HTML de Access se convierten en un `503` genérico. Los errores JSON de autenticación de la aplicación conservan su estado y contenido.
- Hay un único intento por petición, incluidos `GET` y `POST`. Se espera hasta once minutos por las cabeceras, para admitir la cola actual de hasta 120 segundos y varias rondas del modelo. Es un límite técnico del gateway, no un SLA ni una garantía de los límites de otros proxies. Los timeouts de la aplicación y de los proveedores siguen aplicándose. Cambiarlos exige revisar también este techo.
- La cancelación de la petición se transmite al `fetch` del backend. Después de recibir las cabeceras, el cuerpo se transmite como stream, sin leerlo completo, almacenarlo ni registrarlo. La propagación del cierre del cliente depende además del soporte de señal habilitado en el runtime de Pages.

Cloudflare documenta un **Proxy Read Timeout predeterminado de 125 segundos** para conexiones a origen que pueden terminar en `524`; el techo de once minutos del código no amplía ese límite. La aplicabilidad concreta y los valores efectivos del tramo Access/Tunnel deben comprobarse en la configuración contratada. Una solicitud que permanezca en cola y ejecute varias rondas puede superar 125 segundos: la aceptación de ese recorrido largo sigue pendiente y requiere una prueba sintética controlada posterior. No se ha demostrado con esta suite local que una conversación de varios minutos complete en la red pública. Si ese recorrido no cumple el tiempo efectivo, será necesario limitar el tiempo total o diseñar una entrega asíncrona; no resolverlo reintentando automáticamente una reserva. Referencia: [Cloudflare error 524 y límites de conexión](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-524/).

## Frontera de confianza

El destino de red y `Host` son los del túnel de aplicación. El gateway fija `X-Forwarded-Host: sarinbotsaas.pages.dev` y `X-Forwarded-Proto: https` para que Next genere URLs públicas coherentes y compare el origen del navegador. Elimina las versiones aportadas por el cliente, `Forwarded`, encabezados de identidad Access, IPs reenviadas y el selector de puerto del contenedor. Añade únicamente su service token dedicado.

Configurar el túnel de aplicación hacia el puerto de Next publicado solo en loopback del VPS, conservando el aislamiento del contenedor. Si existe otro reverse proxy entre el túnel y Next, debe preservar los valores públicos confiables anteriores; sobrescribirlos con el hostname interno rompe las comprobaciones de origen y los enlaces. Verificarlo antes de activar el gateway, sin exponer un puerto público para evitar Access.

Se conservan `Authorization: Bearer` de Firebase, cookies de aplicación, el `Origin` original y la firma del webhook. Las cookies Access entrantes no se usan como autenticación de aplicación. Una operación con `Origin` presente debe coincidir exactamente con el origen público o devuelve `403` antes de contactar el VPS. Los webhooks sin `Origin` siguen necesitando la verificación HMAC en Next. El gateway no sustituye la autorización Firebase, las reglas Firestore, las cuotas ni los controles contra abuso.

El `fetch` usa redirecciones manuales: nunca sigue una redirección con las credenciales de Access/Firebase. Solo permite destinos relativos, del origen público o del origen backend. Estos últimos se convierten al origen público. Se bloquean redirecciones de Access y destinos externos; Google se abre desde el flujo Firebase del navegador, sin añadir un redirect HTTP arbitrario al proxy. Si se implementa en el futuro un callback OAuth del servidor con destino externo, debe diseñarse una lista explícita y revisarse con pruebas antes de habilitarlo. Cloudflare advierte del reenvío de encabezados sensibles al seguir redirects: [Request y redirect mode](https://developers.cloudflare.com/workers/runtime-apis/request/).

Las respuestas de aplicación incluyen `no-store` para navegador y CDN, además de `nosniff`, protección de frames y `Cross-Origin-Opener-Policy: same-origin-allow-popups` compatible con la ventana Google. El gateway elimina encabezados de credenciales, diagnósticos con el hostname interno, cookies Access y destinos de reporte/redirección no aprobados. Las cookies propias del backend pueden convertirse en cookies del host público eliminando su atributo Domain; cookies de dominios ajenos se descartan. El contenido de Next es contenido de un backend confiable: no se inspecciona ni reescribe HTML, JSON o JavaScript para buscar secretos. Nunca incorporar valores privados en esas respuestas.

No hay logs de peticiones, cuerpos, tokens ni respuestas en este código. Mantener desactivada la captura de cuerpos y prompts en cualquier proxy/APM. Los metadatos operacionales y registros de Access deben tener su propia política de acceso y retención.

## Preparación del artefacto

Desde la raíz, `pnpm run build:pages` ejecuta el build de landing con el origen público aprobado, valida HTML/links/ausencia de configuración backend y añade el gateway revisado. `wrangler.jsonc` fija `name: sarinbotsaas`, `pages_build_output_dir: ./landing/out` y `compatibility_date: 2026-10-13`. No incluye valores privados. El comando de build de Pages debe seleccionarse explícitamente al activar esta modalidad; el build estático anterior no cambia por haber preparado los archivos locales.

El build estático conserva su comportamiento habitual. El gateway se añade únicamente mediante una decisión explícita después de generar y validar la landing:

```powershell
node --test pages-gateway/tests/*.test.mjs
node scripts/package-pages-gateway.mjs --enable
```

La segunda orden requiere que ya exista `landing/out/index.html`. Sin `--enable`, el script no modifica el artefacto. Copia únicamente la fuente revisada `pages-gateway/worker.mjs` a `landing/out/_worker.js` y genera este manifiesto `landing/out/_routes.json`:

```json
{ "version": 1, "include": ["/*"], "exclude": [] }
```

El empaquetador comprueba que el Worker resultante coincide byte por byte con la fuente y se niega a sobrescribir un Worker o manifiesto ajenos. No copia el repositorio ni archivos de entorno. Su función `packagePagesGateway({ enabled: true, outputDirectory })` se puede importar desde un build optativo sin ejecutar el CLI ni imprimir mensajes al importarla. La validación estática de la landing debe ejecutarse **antes** de empaquetar: esa validación rechaza deliberadamente `_worker.js` en una exportación puramente estática. No insertar una exclusión de `/_next/*` en `_routes.json`: volvería a mezclar los dos builds.

## Activación y comprobación antes de abrir el servicio

Estas son instrucciones para una activación posterior autorizada; no se han ejecutado como parte de esta preparación.

1. Conservar la imagen/build Next anterior, el artefacto Pages anterior, una copia privada de la configuración runtime y una copia/exportación recuperable de los datos de negocio. Mantener las credenciales y las copias de comprobantes fuera de Git y de cualquier artefacto Pages. Verificar cómo se restaura la copia; no borrar datos para probar el rollback.
2. Preparar y verificar un hostname de aplicación dedicado bajo `alsdevstudio.com`, su túnel al VPS y una aplicación Access que proteja **todo el hostname**. Usar una política Service Auth que permita únicamente el service token del gateway, sin Bypass ni Allow público. Comprobar rechazo sin token y con token inválido; comprobar acceso con el token dedicado sin imprimirlo ni pegarlo en historial de shell.
3. Comprobar Next Node 24 con una sola réplica, Firebase Admin y reglas/índices efectivos. El proceso debe incluir el build completo del SaaS y sus archivos estáticos, usar sus variables públicas Firebase reales y aceptar el host público reenviado. No trasladar secretos Firebase Admin a Pages.
4. Añadir `sarinbotsaas.pages.dev` a los dominios autorizados de Firebase Authentication y revisar el proveedor Google del proyecto correcto. Si existen restricciones OAuth adicionales configuradas por el operador, alinear sus orígenes de JavaScript y redirects permitidos con el flujo Firebase utilizado. Documentación: [Google Sign-In para Firebase Web](https://firebase.google.com/docs/auth/web/google-signin).
5. Preparar el artefacto con el gateway, establecer la fecha de compatibilidad explícita y verificar el smoke local Workerd/Miniflare. Registrar los cuatro valores de runtime en Pages, sin incluirlos en la salida del build. Publicar únicamente cuando el operador autorice el despliegue y se haya revisado el artefacto concreto. La entrada canónica y los QR públicos deben usar `https://sarinbotsaas.pages.dev/b/<slug>`, nunca el hostname privado de Next ni el del motor.
6. Después de la activación autorizada, comprobar desde el origen canónico: HTML y `/_next` del mismo build, popup Google, inicio/cierre de sesión, `/api/session` sin sesión con `401`, acceso ajeno a `/api/admin` con `403`, dashboard, facturación, QR e isla del negocio. Utilizar datos sintéticos; cualquier inferencia con proveedor pago o envío real requiere su autorización y límites correspondientes. Confirmar que no aparece el hostname privado ni un login de Access en la interfaz, redirects, encabezados o QR.
7. Comprobar las respuestas de caída/Access denegado y ausencia de caché con un entorno o ventana operacional controlados. No probar fallos rompiendo el servicio de clientes sin coordinación. Conservar evidencia redactada de los estados HTTP y de la navegación.

## Reversión

Para cerrar temporalmente la aplicación conservando la landing, retirar juntas las tres variables de backend y mantener el gateway con su fallback explícito: las rutas de aplicación responderán `503`. No dejar una configuración a medias ni usar un redirect al hostname privado como atajo.

Para deshacer una versión de Next, volver a la imagen anterior y comprobar su compatibilidad con los datos persistidos y las cuotas antes de atender clientes. Para deshacer el gateway, restaurar el artefacto Pages anterior conocido; recordar que un artefacto exclusivamente estático no ofrece el SaaS. Conservar Firebase y la información de pagos/citas: no borrar datos ni revocar el token del motor al retirar el token dedicado a este gateway. Registrar cuándo se realizó la reversión y volver a verificar Google, origen público y QR.
