# QA del cambio DNS y protección del motor — 2026-10-15

Resultado: `alsdevstudio.com` ya delega en Cloudflare y la zona aparece activa. Se creó Access para todo el hostname del motor antes de publicar su ruta. El acceso HTTPS sin credenciales y con credenciales inválidas devuelve 403. La conexión completa con Ollama sigue pendiente: el túnel aparece `Down`, con cero réplicas, y algunos resolvers conservan NXDOMAIN para el hostname nuevo.

## Alcance y autorización

El propietario había autorizado retirar el DS, esperar 24 horas, cambiar los NS y esperar otras 48 horas antes de publicar el DS Cloudflare. El 2026-10-15 solicitó cambiar los NS después de verificar nuevamente los DNS. Solo se utiliza `alsdevstudio.com` para el motor. La prueba de reinicio de la Mac sigue pospuesta; no se provocó un reinicio ni se reinstaló el conector.

## Verificación previa

- Retirada del DS confirmada el 2026-10-14 a las 21:28:40.297 UTC; corte operativo permitido desde el 2026-10-15 a las 21:30 UTC, 16:30 Colombia.
- Consulta directa del 2026-10-15 a `a.gtld-servers.net` (`192.5.6.30`) a las 22:40:56.891634 UTC y a `j.gtld-servers.net` (`192.48.79.30`) a las 22:40:56.892872 UTC: tipo DS, NOERROR, AA=true, TC=false, cero respuestas DS y autoridad con NSEC3, SOA y RRSIG.
- Ambos `.com` todavía delegaban en los cuatro NS Porkbun. Google `8.8.8.8` y Cloudflare `1.1.1.1` también devolvieron NOERROR sin DS.
- Se cotejaron los siete registros en ambas interfaces, contra el respaldo y mediante consultas a los cuatro NS Porkbun y los dos Cloudflare. Los siete registros existentes se conservaron DNS only y TTL 600.

| Registro | Valor conservado |
| --- | --- |
| Apex ALIAS → CNAME aplanado | `uixie.porkbun.com` |
| CNAME `www` | `alsdevstudio.pages.dev` |
| MX apex, prioridad 10 | `fwd1.porkbun.com` |
| MX apex, prioridad 20 | `fwd2.porkbun.com` |
| TXT SPF apex | `v=spf1 include:_spf.porkbun.com ~all` |
| TXT `_acme-challenge`, primero | Coincide íntegramente con el respaldo local |
| TXT `_acme-challenge`, segundo | Coincide íntegramente con el respaldo local |

El apex resolvió en los seis NS a `207.207.210.23`, `207.207.210.36` y `207.207.210.50`; las consultas AAAA no devolvieron direcciones. El ALIAS/CNAME aplanado no publica un CNAME en el apex. Una consulta UDP adicional a una dirección de Sullivan agotó el tiempo de espera; otra dirección del mismo NS devolvió NOERROR y SOA para esa consulta. Esto no se interpretó como ausencia probada a partir del timeout.

Los cuatro NS Porkbun todavía publicaban DNSKEY y RRSIG antes del cambio. `https://alsdevstudio.com/` terminó en `https://www.alsdevstudio.com/`, con HTTP 200; `www` también respondió 200 directamente.

## Cambio y plazo DNSSEC

Se guardaron en Porkbun únicamente `june.ns.cloudflare.com` y `sullivan.ns.cloudflare.com`. La delegación `.com` devolvió ambos NS nuevos a las siguientes horas:

| Servidor consultado | Primera observación UTC |
| --- | --- |
| `a.gtld-servers.net` | 2026-10-15 22:41:41.959269 |
| `j.gtld-servers.net` | 2026-10-15 22:41:41.959739 |

T0 común: **2026-10-15 22:41:41.959739 UTC**. El DS Cloudflare no debe publicarse antes del **2026-10-17 22:41:41.959739 UTC**, equivalente a **17:41:41.959739 Colombia**. Se adopta como margen operativo **22:45 UTC / 17:45 Colombia**, después de volver a verificar el estado DNS. No se publicó un DS nuevo ni se programó una automatización.

Tras el cambio, las consultas TCP DS a ambos servidores `.com` a las 22:42:29.133833 y 22:42:29.252911 UTC devolvieron NOERROR, AA=true, TC=false, cero DS y pruebas NSEC3/SOA/RRSIG. Se usó TCP para resolver dos timeouts UDP de `j.gtld`; los timeouts no se tomaron como prueba negativa.

La UI de Cloudflare confirmó la zona activa. Los recursivos mostraron cachés distintas: Google devolvió los NS nuevos en una consulta y los anteriores en otra; Cloudflare aún devolvía los anteriores. La delegación del padre sí estaba actualizada. Mantener los siete registros equivalentes y su respaldo durante la transición de 48 horas.

Los MX y SPF conservados coinciden con la [guía oficial de Porkbun para email y forwarding con DNS externos](https://kb.porkbun.com/article/47-how-to-use-porkbun-email-when-your-dns-is-hosted-elsewhere). No se envió correo de prueba ni se verificó entrega extremo a extremo.

## Access y ruta del motor

- Aplicación: `Sarin — motor Ollama ALS`, ID `da69b6e4-7ca0-4590-92fe-380f589ac6bc`.
- Dominio protegido completo: `ia-sarin.alsdevstudio.com`, sin limitar Access a una ruta.
- Política: `Sarin backend únicamente`, ID `10e637f9-b3c6-441c-83f0-8c9170e13fba`, acción `Service Auth` y único selector `Service Token` para `sarin-local-backend`. El selector se inspeccionó antes de guardar; la asociación de la política y el dominio completo se confirmaron después en el listado guardado.
- Ruta creada después de Access: `^/v1/(chat/completions|models)$` hacia `http://127.0.0.1:11434`, con `httpHostHeader: 127.0.0.1:11434`.
- DNS nuevo del motor: CNAME con proxy y TTL Auto a `baac8f41-73ac-45e9-a394-59260ea07e25.cfargotunnel.com`. El listado final de Cloudflare mostró ocho registros: este registro nuevo y los siete originales, conservados DNS only y TTL 600.

La UI consultada no mostró la regla final del túnel. El requisito sigue siendo terminar en `http_status:404`; no se afirma que esa configuración efectiva ni el rechazo autenticado de `/api/tags` se hayan verificado.

Ambos NS Cloudflare resolvieron `ia-sarin.alsdevstudio.com` a `172.67.189.108` y `104.21.49.86`. El resolver local y `1.1.1.1` conservaron NXDOMAIN durante la comprobación. Se consultó HTTPS mediante `curl --resolve`, fijando una dirección obtenida del NS autoritativo y manteniendo el hostname, SNI y validación normal de TLS; no se utilizó `--insecure`.

| Prueba HTTPS | Resultado |
| --- | --- |
| `/v1/models`, sin credenciales Access | HTTP 403 |
| `/v1/models`, con credenciales deliberadamente inválidas | HTTP 403 |
| `/`, sin credenciales Access | HTTP 403 |
| `/api/tags`, sin credenciales Access | HTTP 403 |
| `/v1/chat/completions`, sin credenciales Access | HTTP 403 |
| `/v1/models`, con credenciales válidas desde la VPS | Pendiente |

Los 403 verifican rechazo en Cloudflare. No demuestran que el token válido sea aceptado, que el conector llegue a Ollama ni que la inferencia funcione.

## Pendientes y límite de esta revisión

Cloudflare mostró `sarin-mac-ollama` en estado `Down`, con cero réplicas; la nueva revisión de las 22:47:43 UTC mantuvo ese estado. La consulta de solo lectura desde la VPS de las 22:47:52 UTC identificó el peer exacto `MacBook Pro de Luis`, con `Online=false` y `LastSeen=2026-10-15T22:40:00.1Z`; también verificó la configuración correcta del backend y obtuvo `ENOTFOUND` al resolver el motor. El propietario confirmó que la Mac está encendida, tiene Internet y mantiene la sesión de Luis iniciada. Esa confirmación no demuestra que el conector esté activo. Se solicitó la lectura local del LaunchAgent limitada a estado, PID y código de salida, y el código HTTP de `/v1/models`; sus resultados siguen pendientes. Las cuatro conexiones y HTTP 200 del 2026-10-14 se conservan como evidencia histórica; no prueban disponibilidad actual. No se determinó la causa de la desconexión.

La nueva comprobación DNS del backend a las **22:44:56 UTC** del 2026-10-15 todavía devolvió `ENGINE_HOSTNAME_NOT_FOUND`. Las pruebas mediante IP explícita no sustituyen la resolución y conexión normal desde la VPS.

Cuando la Mac esté conectada, comprobar primero el LaunchAgent existente, sus registros, sesión, alimentación, red y Ollama. Después verificar la resolución desde la VPS, `/v1/models` autenticado con HTTP 200, `/api/tags` autenticado con HTTP 404, `pnpm run doctor --engine` y `pnpm run doctor --generate`. El recorrido completo de Sarin y su publicación pública siguen pendientes. No se modificaron permisos de Tailscale ni se reinició la Mac.

## Evidencia y reversión

La evidencia DNS pública y los respaldos completos se guardaron fuera de Git, bajo `%LOCALAPPDATA%/SarinBot/dns-backups`:

- `alsdevstudio.com-before-cloudflare-2026-10-14.json`
- `alsdevstudio.com-preflight-2026-10-15.json`
- `alsdevstudio.com-preflight-followup-2026-10-15.json`
- `alsdevstudio.com-postcutover-2026-10-15T224148Z.json`
- `alsdevstudio.com-postcutover-2026-10-15T224206Z.json`
- `alsdevstudio.com-ds-postcutover-tcp-2026-10-15T224229Z.json`

Las pruebas de rechazo HTTPS se registraron en `%LOCALAPPDATA%/SarinBot/cloudflare/sarin-access-negative-probes-2026-10-15.json`. El plan privado `%LOCALAPPDATA%/SarinBot/cloudflare/sarin-als-connection-plan.json` se actualizó con el nuevo estado. La revisión adicional del backend y la Mac se conserva en `%LOCALAPPDATA%/SarinBot/deployment/sarin-engine-and-mac-recheck-2026-10-15T224752Z.txt`. Las credenciales de Access y del conector permanecen fuera de Git y no se incluyen en esta evidencia. Los IDs de configuración documentados no son credenciales.

Para retirar el motor, mantener Access hasta quitar la ruta y el DNS; después revocar el token si corresponde. Si fuera necesario revertir la delegación, verificar DS ausente y restaurar exclusivamente `curitiba.ns.porkbun.com`, `fortaleza.ns.porkbun.com`, `maceio.ns.porkbun.com` y `salvador.ns.porkbun.com`, conservando los registros respaldados. No publicar un DS incompatible durante la reversión ni considerar que quitar Access sea un mecanismo de rollback seguro.

Contexto y restricciones: [conexión de la Mac](../remote-ollama-connection.md). La [QA del 2026-10-14](2026-10-14-vps-pre-dns.md) conserva el estado histórico anterior al cambio.
