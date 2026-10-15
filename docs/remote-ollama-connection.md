# Conexión de Ollama en la Mac remota

Estado al 2026-10-15: nameservers cambiados a Cloudflare y zona activa, después de verificar nuevamente la ausencia de DS y la equivalencia de los siete registros. Access protege todo el hostname del motor y la ruta restringida hacia Ollama está creada. Las pruebas HTTPS sin credenciales y con credenciales inválidas devolvieron 403. El túnel aparece `Down`, con cero réplicas: faltan recuperar el conector de la Mac y verificar modelos, generación y rechazo de rutas no permitidas desde la VPS. La aplicación sigue en una instancia privada de la VPS, con acceso Google y lecturas Firebase comprobados, sin facturación habilitada; su publicación pública sigue pendiente. El reinicio de la Mac continúa pospuesto por el propietario. Evidencia y límites en [QA del cambio DNS](qa/2026-10-15-dns-cutover.md).

## Destinos

Opción B aprobada y activada el 2026-10-15: [DeepSeek manual y temporal](deepseek-option-b.md) para conversaciones de negocio y onboarding, con clave dedicada en el runtime privado y configuración anterior respaldada. Pasaron las pruebas sintéticas del cliente y los controles de acceso/Firebase posteriores al despliegue; [evidencia y límites](qa/2026-10-15-deepseek-option-b.md). Vault sigue ligado a Ollama. [Gemini como opción C](gemini-option-c.md) quedó implementado y probado con datos ficticios, pero inactivo para clientes: la cuenta de Colombia continúa gratuita y no se habilitó facturación. En una comprobación posterior, la Mac volvió a aparecer `Online=true` en Tailscale, pero los puertos 22 y 11434 desde la VPS agotaron el tiempo y el contenedor continuó sin resolver el hostname del motor. No hay una ruta SSH configurada y accesible a la Mac; siguen pendientes los resultados locales solicitados a Luis.

- Web actual: `https://sarinbotsaas.pages.dev/`.
- Motor elegido por el propietario: `https://ia-sarin.alsdevstudio.com/v1/chat/completions`.
- Túnel dedicado: `sarin-mac-ollama`.
- Origen en la Mac: `http://127.0.0.1:11434`.
- Modelo de texto probado en la Mac: `qwen3.8:27b-q4_K_M`.
- Visión: pendiente comprobar capacidades de un modelo instalado.

Restricción expresa del propietario: usar `alsdevstudio.com` para la conexión y nunca `bptjersey.com`, ni siquiera para pruebas temporales. El borrador alternativo fue descartado sin crear aplicaciones Access, rutas ni registros DNS.

La Mac respondió correctamente a `curl --max-time 10 http://127.0.0.1:11434/v1/models` el 2026-10-14 y su catálogo incluyó el modelo de texto elegido. La prueba local de `/v1/chat/completions`, con `stream: false`, `max_tokens: 512` y `reasoning_effort: none`, devolvió `SARIN_OK`, HTTP 200 y `finish_reason: stop` en 7,860402 segundos. Esto verifica la inferencia local por HTTP; el recorrido remoto y el cliente del backend siguen pendientes.

Zero Trust Free está activo. El checkout mostró un precio base de US$0/mes y autorización de cargos por uso excedente, aceptada por el propietario. Esto no representa el costo total del alojamiento de Sarin.

## Protección del motor

Access debe cubrir **todo** `ia-sarin.alsdevstudio.com`, sin limitarlo a una ruta. La política `Sarin backend únicamente` quedó guardada con acción `Service Auth` y un solo selector `Service Token`, limitado a `sarin-local-backend`. El token quedó habilitado con duración `Non-expiring` y vencimiento `Never`, según autorización del propietario. Sigue siendo revocable y reemplazable.

El 2026-10-14 Cloudflare rechazó el alta de la aplicación con `domain does not belong to zone` mientras la zona estaba pendiente. El 2026-10-15, después de activar la zona, se creó `Sarin — motor Ollama ALS` (`da69b6e4-7ca0-4590-92fe-380f589ac6bc`) para **todo** `ia-sarin.alsdevstudio.com`. La política asociada es `Sarin backend únicamente` (`10e637f9-b3c6-441c-83f0-8c9170e13fba`), con acción `Service Auth`. Su único selector, limitado al token `sarin-local-backend`, se inspeccionó antes de guardar; después se confirmaron la asociación de la política y el dominio completo en el listado guardado. La protección se confirmó antes de crear la ruta del motor.

El túnel tiene creada la ruta `^/v1/(chat/completions|models)$` hacia `http://127.0.0.1:11434`, con `httpHostHeader: 127.0.0.1:11434`. Su DNS es un CNAME con proxy a `baac8f41-73ac-45e9-a394-59260ea07e25.cfargotunnel.com`. La última regla debe devolver `http_status:404`, pero la UI consultada no mostró esa regla final: **su configuración efectiva y el rechazo de `/api/tags` siguen pendientes de verificación**. No publicar una ruta adicional sin restricción hacia Ollama.

Las consultas directas a ambos NS de Cloudflare resolvieron el motor a `172.67.189.108` y `104.21.49.86`. El resolver local y `1.1.1.1` todavía conservaban NXDOMAIN para el hostname nuevo. Con `curl --resolve`, conservando el hostname, SNI y la validación TLS, `/v1/models` devolvió 403 sin credenciales y 403 con credenciales inválidas. Las pruebas adicionales sin credenciales contra `/`, `/api/tags` y `/v1/chat/completions` también devolvieron 403. Estas comprobaciones verifican el rechazo en el borde de Cloudflare, no la aceptación de la credencial válida ni la llegada a Ollama.

El token del conector y las credenciales de Access son distintos. Guardarlos fuera de Git y evitar su contenido en chat, capturas y registros. El backend usará ambas cabeceras de Access; el navegador de Sarin nunca recibirá esas credenciales.

Las credenciales están en `%LOCALAPPDATA%/SarinBot/cloudflare`, con permisos restringidos al usuario actual y SYSTEM: `sarin-local-backend.access.json` para el backend y `sarin-mac-ollama.token` para la Mac. El propietario transfirió únicamente el archivo del conector por un canal privado a Luis. Tras confirmar el archivo de 184 bytes en Descargas, creó `$HOME/.cloudflared/sarin` con permisos 700 e instaló su copia `tunnel.token` con permisos 600.

La prueba inicial en primer plano confirmó cuatro conexiones QUIC entre 22:13:51 y 22:13:54 UTC del 2026-10-14, comprobaciones de conectividad PASS y estado `Healthy` en Cloudflare. Después de comprobar que no existía un servicio previo, Luis instaló el LaunchAgent con `cloudflared service install "$(cat "$HOME/.cloudflared/sarin/tunnel.token")"`. `launchctl` mostró `state = running`, PID 71314, y su registro confirmó cuatro conexiones QUIC entre 22:34:58 y 22:35:00 UTC. Tras detener la instancia manual, el propietario consultó `http://127.0.0.1:20242/ready`: HTTP 200 y `readyConnections: 4` a las 23:05:04 UTC. El puerto se obtuvo del registro del servicio; no asumir que siempre será el mismo.

El LaunchAgent arranca al iniciar sesión Luis y no depende de mantener abierta la Terminal. Guarda su token en `$HOME/Library/Application Support/com.cloudflare.cloudflared/token` y sus registros en `$HOME/Library/Logs/com.cloudflare.cloudflared.{err,out}.log`. Esto no verifica el arranque de Ollama ni el funcionamiento durante la suspensión. El aviso `No ingress rules` y la respuesta 503 prevista observados el 2026-10-14 eran coherentes con la ausencia de rutas publicadas en ese momento: no demostraban acceso a Ollama ni disponibilidad completa de Sarin.

En la revisión del 2026-10-15, Cloudflare mostró el túnel `Down` y cero réplicas; la nueva revisión de las 22:47:43 UTC mantuvo ese estado. La consulta de solo lectura desde la VPS de las 22:47:52 UTC mostró el peer exacto `MacBook Pro de Luis` con `Online=false` y `LastSeen=2026-10-15T22:40:00.1Z`. Las cuatro conexiones del día anterior son evidencia histórica, no una comprobación de disponibilidad actual. El propietario confirmó que la Mac está encendida, tiene Internet y mantiene la sesión de Luis iniciada; esto no demuestra que el conector esté activo. Se solicitó consultar localmente el estado del LaunchAgent y el código HTTP de `/v1/models`; esa salida sigue pendiente. No atribuir la desconexión a reposo, cierre de sesión, energía, Internet o fallo del servicio sin comprobarlo. La nueva evidencia se conserva fuera de Git en `%LOCALAPPDATA%/SarinBot/deployment/sarin-engine-and-mac-recheck-2026-10-15T224752Z.txt`; la configuración del backend se verificó correcta y su resolución del motor todavía devolvió `ENOTFOUND`.

El propietario confirmó que Ollama está habilitado en segundo plano. En español de Colombia, la ruta es Configuración del Sistema → General → Elementos de inicio y extensiones → Actividad de app en segundo plano; el nombre puede variar por idioma y versión. La aplicación macOS registra este inicio durante su instalación, según la [FAQ oficial de Ollama](https://docs.ollama.com/faq#how-can-i-stop-ollama-from-starting-when-i-login-to-my-computer). Conservar la instalación existente; una entrada activada no sustituye una prueba posterior de reinicio e inicio de sesión.

El propietario confirmó que activó Configuración del Sistema → Batería → Opciones → «Impedir entrar en reposo automáticamente cuando se apaga la pantalla y se usa el adaptador de corriente». Mantener alimentación e Internet mientras la Mac atienda el motor. Esta comprobación del ajuste no es una prueba de funcionamiento desatendido, no demuestra funcionamiento con la tapa cerrada ni elimina el requisito de iniciar sesión. Fuente: [configuración de reposo de Apple](https://support.apple.com/es-co/guide/mac-help/mchle41a6ccd/mac).

El propietario pospuso expresamente la prueba de reinicio e inicio de sesión. Conservarla como pendiente; no reinstalar servicios ni provocar el reinicio para completarla. La configuración remota del túnel podrá continuarse sin presencia física de Luis mientras la Mac permanezca encendida, conectada y con su sesión iniciada.

## Red privada existente

La Mac, el VPS y la PC de desarrollo ya pertenecen al mismo tailnet. Las reglas consultadas permiten conexiones de equipos `admin` hacia el VPS; no incluyen VPS hacia Mac. En la revisión del 2026-10-14, la Mac aparecía conectada desde el VPS, pero las pruebas TCP a sus puertos 22, 443 y 11434 agotaron el tiempo de espera. El 2026-10-15 primero apareció desconectada y después volvió a `Online=true`; el acceso a Ollama sigue sin comprobarse. No se modificaron permisos de Tailscale.

Se mantiene el enlace del motor mediante Cloudflare ya preparado y Tailscale para administrar el VPS. Adoptar Tailscale Serve como transporte del motor requeriría un modo explícito en el cliente, HTTPS, destino restringido y pruebas que garanticen que no se envíen credenciales de Cloudflare al hostname privado. La pertenencia al tailnet por sí sola no conecta la API de Ollama.

## Configuración del backend pendiente

Se preparó una copia aislada de las fuentes de la aplicación en la VPS existente, se comprobó la integridad del archivo transferido y se validó Compose. La imagen Linux se construyó correctamente con las cuatro variables públicas de Firebase. Después se prepararon un entorno privado de runtime y Compose con el montaje ADC de solo lectura, y se transfirió la credencial de Access por SSH al archivo privado del backend, con permisos 600 y fuera de Git y del contexto de build. La instancia privada ya se inició en loopback y el propietario completó el acceso Google; el Caddy existente permanece sin cambios. El 2026-10-15 se verificó una respuesta de DeepSeek desde el chat autenticado del panel. Siguen pendientes la publicación pública y el recorrido remoto de inferencia con Ollama.

El ADC humano de Windows no se copió a la VPS y la política que bloquea claves de cuenta de servicio se mantiene intacta. Se habilitaron el pool `sarin-vps` y su proveedor X.509, con CA privada dedicada y condición que exige el CN y URI SAN exactos de Sarin. Solo ese sujeto puede impersonar `sarin-runtime` mediante `roles/iam.workloadIdentityUser`; no se concedió acceso a todo el pool. El certificado cliente y su configuración se montan como solo lectura; la clave CA permanece exclusivamente bajo root fuera del montaje.

La imagen real de la aplicación completó `TOKEN_EXCHANGE_OK`, `AUTH_READ_OK` y `FIRESTORE_READ_OK` sin crear usuarios ni documentos. Una prueba con el mismo CN y URI SAN de otro proyecto fue rechazada por la condición del proveedor. Se volvió a verificar facturación desactivada. Esto valida la identidad y lecturas del SDK; no sustituye la prueba del chat, herramientas o UI. Costos y alcance en [STACK.md](../STACK.md).

El cliente recibe certificados de 30 días, renovados automáticamente cuando quedan diez días: no requieren renovación manual mensual. El servicio dedicado terminó con resultado satisfactorio y su timer está habilitado y esperando la siguiente comprobación. Las generaciones son inmutables y el puntero JSON se cambia atómicamente. Una prueba aislada del SDK de la imagen validó certificados A→B, rechazo de fuente ausente y recuperación A con el mismo cliente y proceso, sin modificar el puntero activo. La salida de Next también provocó recuperación automática del contenedor, con lecturas Firebase y sesión correctas después. Quedan pendientes el reinicio completo de la VPS y la notificación de fallos al operador; no afirmar disponibilidad ininterrumpida a partir de estas comprobaciones.

La revisión privada del navegador se hace temporalmente mediante SSH, en `http://localhost:3032/dashboard`. Ese forward depende de la PC mientras se use; el backend y su identidad se ejecutan en la VPS. Evidencia y límites en [QA previa al DNS](qa/2026-10-14-vps-pre-dns.md).

Los seis índices compuestos del repositorio ya están `READY` y la exención de imágenes está aplicada. Se verificaron consultas sintéticas de agenda y comprobantes y la sección autenticada de suscripción, sin crear negocios ni pagos. La dirección pública del panel sigue pendiente de elección; la portada Pages actual permanece separada de esta instancia privada.

Al registrar la CA, Google rechazó el LF final de `pemCertificate` en el JSON del trust store. Quitar únicamente ese salto conservó el certificado DER y permitió crear el proveedor. Los archivos PEM normales del servidor no se modificaron. Conservar el formato del [ejemplo oficial](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-x509-certificates#format_the_certificates).

Aplicar estos valores al entorno privado del backend cuando el túnel y Access estén listos:

```dotenv
SARIN_TUNNEL_URL=https://ia-sarin.alsdevstudio.com/v1/chat/completions
OLLAMA_MAIN_MODEL=qwen3.8:27b-q4_K_M
OLLAMA_VISION_MODEL=
```

La VPS ya tiene `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET` y el modelo principal preparados en su entorno privado, sin incluir sus valores en este documento. La visión permanece vacía hasta comprobar un modelo compatible. El hostname, Access y la ruta ya están creados; falta comprobar la conexión con credenciales válidas y la inferencia cuando el conector vuelva a estar disponible y el DNS resuelva desde la VPS. La nueva comprobación DNS del backend de las 22:44:56 UTC del 2026-10-15 todavía devolvió `ENGINE_HOSTNAME_NOT_FOUND`. No confundir el entorno preparado de la VPS con el servidor local de desarrollo de Windows.

## Validación y reversión

El rechazo sin credenciales o con credenciales inválidas ya devolvió 403 en la revisión del 2026-10-15, usando resolución explícita y TLS válido. Con la Mac conectada y el DNS disponible desde la VPS, comprobar con credenciales válidas que `/v1/models` devuelve 200 y `/api/tags` devuelve 404. Después ejecutar `pnpm run doctor --engine` y `pnpm run doctor --generate` desde el equipo del backend. Estas pruebas no crean negocios ni pagos y siguen pendientes.

La puesta en marcha inicial en primer plano con `cloudflared tunnel run --token-file RUTA_PRIVADA` y la instalación del LaunchAgent ya se completaron el 2026-10-14. Para recuperar la conexión, comprobar primero el servicio existente, sus registros y el estado de la Mac; no reinstalarlo ni crear un segundo conector automáticamente. En macOS, el directorio privado debe mantener permisos 700 y el archivo 600. Revisar suspensión, alimentación e Internet. Evitar caducidad de credenciales no garantiza disponibilidad del equipo ni del servidor de Sarin.

Para el arranque persistente, comprobar primero si existen el LaunchAgent, LaunchDaemon, el token de configuración o un job `com.cloudflare.cloudflared` cargado. El instalador oficial 2026.10.0 puede escribir el token antes de detectar un plist previo; no ejecutarlo encima de un servicio existente. Sin `sudo`, instala un LaunchAgent de Luis y guarda su token con permisos 600. Verificar proceso y conexiones del servicio antes de detener el conector en primer plano. Este modo arranca al iniciar sesión; Ollama, la suspensión y FileVault requieren comprobaciones separadas. Fuentes: [instalador macOS](https://github.com/cloudflare/cloudflared/blob/2026.10.0/cmd/cloudflared/macos_service.go), [plantilla del servicio](https://github.com/cloudflare/cloudflared/blob/2026.10.0/cmd/cloudflared/service_template.go).

Ctrl+C detiene únicamente la instancia manual que ocupa esa Terminal; no detiene el LaunchAgent instalado. Para retirar la publicación, quitar su ruta y DNS y después revocar su token de Access, manteniendo la aplicación y la política de Access hasta retirar la ruta y el DNS. Restaurar los cuatro NS anteriores de Porkbun únicamente si resulta necesario revertir la migración, verificando que el DS siga ausente y conservando los registros respaldados. No publicar un DS incompatible durante la reversión.

Referencias: [Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/), [Service tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/), [token-file](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/run-parameters/).

## Migración DNS de ALS Dev Studio

El dominio mantiene su registro en Porkbun; sus nameservers se cambiaron a Cloudflare el 2026-10-15. Antes del cambio se respaldaron sus siete registros completos fuera del repositorio, en `%LOCALAPPDATA%/SarinBot/dns-backups`: ALIAS del apex, CNAME de `www`, dos MX con prioridades, SPF y dos TXT de ACME. En Cloudflare, el ALIAS del apex se representa como CNAME aplanado; conservar esos siete registros existentes en modo DNS only. El registro nuevo del motor sí utiliza proxy.

La zona gratuita quedó preparada con siete registros persistidos, todos DNS only y TTL 600, con los destinos y TXT del respaldo. El 2026-10-15 se volvió a comprobar su equivalencia en las dos interfaces y mediante consultas directas a los cuatro NS Porkbun y los dos Cloudflare. Después de crear la ruta, el listado de Cloudflare mostró ocho registros: los siete originales DNS only y TTL 600, y el motor con proxy y TTL Auto. Los nameservers `june.ns.cloudflare.com` y `sullivan.ns.cloudflare.com` ya se aplicaron en el registro y la UI de Cloudflare confirmó la zona activa. Los NS anteriores eran `curitiba.ns.porkbun.com`, `fortaleza.ns.porkbun.com`, `maceio.ns.porkbun.com` y `salvador.ns.porkbun.com`.

Las consultas autoritativas del 2026-10-14 mostraron un DS vigente (key tag 2371, algoritmo 13, digest type 2) con TTL de 86400 segundos y una delegación NS en `.com` con TTL de 172800 segundos. El DS público y la delegación anterior también se respaldaron fuera de Git.

El propietario autorizó el 2026-10-14 la migración completa descrita: retirar solamente el DS del registro, mantener Porkbun autoritativo y firmado, confirmar la retirada en `.com` y esperar 24 horas completas antes de cambiar los NS. Después mantener equivalencia de ambas zonas durante 48 horas antes de publicar un DS nuevo de Cloudflare. No repetir la solicitud de autorización para estos mismos pasos.

El propietario confirmó manualmente la retirada en Porkbun. Las consultas UDP directas tipo 43 del 2026-10-14 verificaron ausencia de DS en `a.gtld-servers.net` a las 21:28:40.250 UTC y en `j.gtld-servers.net` a las 21:28:40.297 UTC: NOERROR, AA=true, cero DS y autoridad con NSEC3, SOA y RRSIG. Los cuatro NS Porkbun seguían publicando DNSKEY y RRSIG; `https://www.alsdevstudio.com/` respondió 200.

T0 observado común de retirada del DS: **2026-10-14 21:28:40.297 UTC**. El corte operativo mínimo era el **2026-10-15 a las 21:30 UTC (16:30 en Colombia)**. La nueva revisión de las 22:40:56 UTC verificó DS ausente en ambos servidores `.com`, con NOERROR, AA=true y pruebas NSEC3/SOA/RRSIG, además de equivalencia de los siete registros; se cumplió el plazo antes de cambiar los NS.

El cambio quedó observado en `a.gtld-servers.net` a las **2026-10-15 22:41:41.959269 UTC** y en `j.gtld-servers.net` a las **22:41:41.959739 UTC**, con únicamente los dos NS Cloudflare. Este último instante es el T0 común para las 48 horas: **no publicar el DS nuevo antes del 2026-10-17 a las 22:41:41.959739 UTC (17:41:41.959739 en Colombia)**; corte operativo con margen: **22:45 UTC (17:45 en Colombia)**. Antes de publicarlo, verificar delegación, propagación y el DS correspondiente a la zona Cloudflare. No se publicó un DS nuevo ni se creó una tarea automática. Conservar durante la transición los siete registros equivalentes y el respaldo de la zona anterior.

Las consultas TCP posteriores a ambos `.com`, a las 22:42:29 UTC, confirmaron otra vez NOERROR, AA=true y cero DS. Los recursivos Google y Cloudflare todavía mostraron distintas cachés NS durante la propagación. El apex y `www` respondieron HTTP 200. Los MX y SPF conservados coinciden con la [configuración oficial de Porkbun para email y forwarding con DNS externos](https://kb.porkbun.com/article/47-how-to-use-porkbun-email-when-your-dns-is-hosted-elsewhere); no se realizó una prueba de entrega de correo.

En Windows, usar `Resolve-DnsName alsdevstudio.com -Type DS -Server 192.5.6.30 -DnsOnly -DnssecOk -NoRecursion` y repetir con `192.48.79.30`. Exigir respuesta autoritativa NOERROR sin DS; un error o SERVFAIL no prueba su ausencia. `nslookup -type=DS` no es válido en este entorno y puede consultar A/AAAA en su lugar. Si el DS reaparece, reiniciar el plazo desde una nueva retirada confirmada.

Referencias: [migración con DNSSEC activo](https://developers.cloudflare.com/dns/dnssec/#migrate-to-cloudflare-with-dnssec-active), [Registry DNSSEC](https://kb.porkbun.com/article/93-how-to-install-dnssec).
