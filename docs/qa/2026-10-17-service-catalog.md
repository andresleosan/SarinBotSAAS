# Categorías y descripciones: aceptación local

Fecha: 17 de octubre de 2026. Estado: publicado y verificado tras autorización específica del propietario. Runtime `accab51`, rama `codex/service-catalog-20261017`, basada en `d942e90`, continuación del perfil público publicado. El checkout original mixto se conserva.

## Resultado

El dueño puede añadir descripción y categoría opcionales a cada servicio. La ficha anónima muestra las descripciones y agrupa el menú cuando hay categorías. Los servicios históricos mantienen la lista plana si no tienen categorías. Precio, duración, recursos, horarios y citas confirmadas conservan sus contratos.

[Diseño y fuentes oficiales de Fresha](../design/2026-10-17-service-catalog.md). Se usaron guías oficiales para este incremento; la pestaña de la cuenta Fresha no pudo inspeccionarse de nuevo por un fallo de conexión del control del navegador. No se atribuyen hallazgos nuevos a esa sesión privada.

## Evidencia ejecutada

| Comprobación | Resultado |
| --- | --- |
| RED previo al código | Backend: cinco fallos por campos desconocidos, pérdida de metadatos y envío de textos al contexto del asistente. UI: seis fallos por campos, conservación y agrupación ausentes. Propuestas: cuatro fallos por esquema estricto. |
| Revisión independiente | Detectó pérdida del borrado explícito al aplicar un borrador omiso. Se reprodujo, se añadió una regresión UI que falló y se corrigió la combinación. Segunda revisión sin bloqueantes; 38 pruebas enfocadas aprobadas. |
| `pnpm test` final | **927 aprobadas, 26 omitidas**; 115 archivos aprobados y cuatro omitidos. Las integraciones opt-in no se cuentan como ejecutadas por este comando. |
| `pnpm run typecheck` | Sin errores; el build final repitió TypeScript correctamente. |
| `pnpm run build` final | Next 16.4.0 compiló y generó las rutas de producción. |
| `pnpm run test:journey --port 3040` | **129 comprobaciones** con Auth y Firestore oficiales en loopback. Incluye 12 comprobaciones HTTP del catálogo, permisos, reservas, carrera concurrente, cancelación, comprobantes sintéticos e idempotencia. Limpieza del recorrido correcta. |
| `pnpm audit --audit-level=high` | Sin vulnerabilidades conocidas. Dependencias y lockfile sin cambios. |
| `pnpm --filter sarin-cloudflare-host run check` | 74 pruebas aprobadas, tipos y dry-run del Worker correctos. También pasó el dry-run de la configuración preparada con la imagen publicada de referencia. |
| `git diff --check` | Sin errores. |

Las regresiones HTTP se añadieron después de implementar el contrato. Su primera ejecución esperaba por error propiedades ausentes en el documento privado tras vaciar; el contrato aprobado conserva `''` privado y omite los campos en la ficha anónima. Se corrigieron esas expectativas y se repitió el recorrido completo, que pasó. No se cambió producción para verificarlo.

La revisión de seguridad comprobó validación independiente del servidor, autorización del dueño y consentimiento existentes, cuerpo máximo de 64 KiB, lista pública explícita, texto React sin interpretación HTML y contextos de IA limitados a datos operativos. No hay endpoints, permisos, secretos, dependencias, proveedor ni migraciones nuevos. No se añadieron campos de cliente ni clasificación automática de salud o menores.

## Chrome local mediante CUA

Origen exclusivo `http://127.0.0.1:3040`, proyecto `demo-sarin-bot`, cuenta Negocio local y negocio sintético `catalogo-qa-20261017`. No se usó una cuenta real para editar ni se llamó al motor.

- Perfil anónimo con cinco servicios: agrupación de `Cortes` y `cortes`, orden estable, grupo «Sin categoría», descripción literal con etiquetas HTML y texto de 300 caracteres sin espacios.
- 320×740: perfil y formulario sin desbordamiento horizontal; botón de reserva y categoría de 44 px, descripción de 80 px; máximos HTML 300/60 y foco visible.
- 390×844: perfil tras borrar ambos textos del primer servicio; ese servicio conserva precio/duración y aparece en «Sin categoría», sin recuperar textos anteriores.
- 1280×900: perfil centrado con ancho máximo de 896 px y columnas de servicios/horario.
- Edición real de descripción/categoría, Guardar, mensaje de éxito y recarga: los valores persistieron. Se vaciaron ambos campos y se verificó la respuesta anónima 200/no-store sin ellos.
- Navegación a Enlace y QR, Mi agenda y Suscripción: pantallas esperadas disponibles. Enter en Reservar y Volver al negocio verificó acceso y regreso sin enviar mensajes.
- Sin errores o advertencias de consola capturados. La notificación visual del emulador es esperada.

La normalización Unicode NFC, el catálogo histórico plano, la combinación de borradores y la idempotencia de propuestas tienen cobertura automatizada; no se presentan como nuevas comprobaciones manuales en Chrome. La suite repetible está en [qa/tests/service-catalog.md](../../qa/tests/service-catalog.md), y el informe HTML local en `qa/reports/2026-10-17-service-catalog.html`, excluido de Git. Se usó CUA; no se presenta como una ejecución de `@playwright/test`.

Una captura con página completa agotó el tiempo de CDP. Se recuperó la evidencia con captura normal y se continuó verificando las pantallas. Se restauró el viewport y se cerró la pestaña local. Los servicios de esta sesión se detuvieron sin exportar datos del emulador; los puertos 3040/8080/9099/4400/4500 quedaron libres. La sesión administrativa de producción no se alteró.

## Capturas sintéticas

- [Ficha en 320 px](2026-10-17-service-catalog-320.png).
- [Ficha de escritorio](2026-10-17-service-catalog-desktop.png).
- [Edición en 320 px](2026-10-17-service-catalog-edit-320.png).
- [Borrado explícito en 390 px](2026-10-17-service-catalog-clear-390.png).

## Publicación y reversión

La base de publicación fue el perfil público `03a4703`, imagen `sha256:0ce3ac0a81a93f7825d56edc7c30bdf8ed1eaf352cc251bac9b2ee0d702dd7f6`, Worker `bd604e53-49aa-40b5-b866-29633cc684bf`, Containers v9. La auditoría independiente previa confirmó esa base sin drift.

La publicación conservó bindings, trece secretos, D1/R2, presupuesto y una única instancia; cerró nuevas solicitudes y drenó la cola antes de sustituir el contenedor.

La revisión de reversión encontró que **no se puede reabrir sin más la imagen `0ce3ac0a…` después de guardar los campos nuevos**: su esquema estricto puede rechazar tanto configuraciones como propuestas de reserva que los contengan. Se preparó una imagen compatible con la interfaz anterior y el contrato nuevo de servidor. No se borran metadatos ni se restauran documentos antiguos para hacer encajar una versión. Una reversión conserva mantenimiento hasta confirmar la imagen compatible, la única instancia efectiva y las lecturas/reservas.

### Artefactos preparados

Se congelaron archivos Git exactos y se construyeron dos imágenes Linux/amd64, con los mismos cuatro argumentos públicos Firebase y sin credenciales de runtime. Tras la autorización se enviaron ambas al registro de Cloudflare; únicamente la imagen del catálogo se activó.

| Uso | Fuente | Imagen local |
| --- | --- | --- |
| Nuevo catálogo | `accab511b34863628b1ad5ebdb079e87e5a30657` | `sarin-bot:service-catalog-20261017`, ID `sha256:b2b925f5965b38e8eca40fccd31087648f97b245e27da9a0e9725c54ae431df0` |
| Respaldo compatible | `929c43e99fae27ba1ef64fc4cdd7c5942efbe879` | `sarin-bot:service-catalog-fallback-20261017`, ID `sha256:8575a0074aa664043a5f81540e9409b752b113d9cd8fec62fba2bcc1cd158cb2` |

El respaldo restaura exclusivamente las dos interfaces y sus dos archivos de pruebas a `d942e90`; todos los contratos de servidor, tipos y pruebas de metadatos/propuestas son idénticos al candidato. Pasó su suite de **919 pruebas y 26 omitidas**, TypeScript y build. La diferencia de ocho pruebas corresponde a los casos de la interfaz nueva, que no existe en ese respaldo.

Ambas imágenes arrancaron con filesystem de solo lectura, red `none` y sin montar credenciales. El humo comprobó páginas 200, APIs protegidas anónimas 401, manifiesto, SHA-256 de ambos iconos y los bundles esperados de cada interfaz. No demuestra acceso real a D1/ADC: los contratos de datos se verificaron con los emuladores y el código de servidor es común a ambas imágenes. Los contenedores de humo se retiraron al terminar.

Los paquetes están fuera de Git en `%LOCALAPPDATA%/SarinBot/service-catalog-release-20261017` y `service-catalog-fallback-release-20261017`, con archivos fuente, hashes, logs, registros de imagen/humo y configuraciones fijadas por digest. Los digests devueltos por ambos pushes coinciden con los ID locales de la tabla. El checkpoint `fallbackSourceValidationCheckpoint` precede al build de Docker; sus flags históricos no sustituyen los registros posteriores de build/humo.

### Publicación verificada

El propietario respondió «si autorizo» a la pregunta explícita de producción de este incremento. Se usó Wrangler 4.150.0, con ayuda instalada y [guía oficial de rollouts](https://developers.cloudflare.com/containers/configuration/rollouts/) verificadas, sin actualizar dependencias. Los dry-runs de los dos digests pasaron antes del mantenimiento.

| Etapa | Referencia y resultado |
| --- | --- |
| Catálogo publicado | `registry.cloudflare.com/05fb22c155667de064b55c4e287b21d8/sarin-bot@sha256:b2b925f5965b38e8eca40fccd31087648f97b245e27da9a0e9725c54ae431df0` |
| Respaldo disponible | `registry.cloudflare.com/05fb22c155667de064b55c4e287b21d8/sarin-bot@sha256:8575a0074aa664043a5f81540e9409b752b113d9cd8fec62fba2bcc1cd158cb2` |
| Mantenimiento | Worker `ec9d164b-029f-407c-81f5-e86c62a2623a`, imagen anterior conservada. HTTP público 503 y cola autenticada cero. |
| Rollout | Worker `49bfb56a-63f0-42d8-aa7e-b2c88dce67db`, imagen nueva con mantenimiento activo. Se esperó hasta confirmar la promoción efectiva. |
| Instancia efectiva | Containers v10; allocation `d03ac9f3-10b0-4719-a7df-c5ef7e1de87c`, running y conectada a `sarin-global-app`. Máximo/configurado uno; cero antiguas tras paginación completa. |
| Reapertura | Worker **`274d9bf2-6b19-4704-99c1-88dbb8ef0e42`**, mantenimiento desactivado, sin otro rollout. |
| Cierre independiente | 15:26:37 UTC / **10:26:37 Colombia**: Worker al 100 %, imagen correcta, una instancia conectada, trece secretos y todos los bindings iguales a la base, presupuesto activo. |
| Pages | Deployment `a461b670-5130-41e7-8c75-957f5439cfd7`, sin redesplegar. |

La cola autenticada estuvo vacía antes del cierre, tras drenarla, en la imagen nueva y después de reabrir. El arranque nuevo pasó salud con ADC real; no hubo llamadas de inferencia. La renovación habitual de OAuth de Wrangler resolvió un token vencido antes del preflight, sin cambiar la cuenta ni sus permisos.

HTTP público posterior: portada, ayuda, privacidad, negocio, configuración y manifiesto 200/no-store; APIs privadas sin token 401. `view=profile` devolvió 200/no-store con lista mínima de campos y servicios válidos, un slug inexistente devolvió `{ business: null }` y una vista inválida devolvió 400. Los bundles publicados contienen los nuevos campos y agrupación. Ambos PNG conservan los SHA-256 del favicon publicado.

Chrome real confirmó un campo de descripción y uno de categoría en el servicio existente de «Mi negocio», vacíos y opcionales, con máximos 300/60. En 390×844 no hubo desbordamiento horizontal: descripción de 80 px, categoría de 44 px y foco visible. No se editaron ni guardaron datos del negocio para fabricar contenido de demostración. «Control de Sarin» y «Mis citas» siguieron disponibles con la sesión existente; no se salió de Google. No hubo errores o advertencias capturados en la pestaña de configuración. Se restauró el viewport y se retiró la intercepción temporal de salud.

[Captura de los campos publicados](2026-10-17-service-catalog-live-edit.png). La prueba de escritura/borrado, agrupación y compatibilidad por ID corresponde al recorrido local documentado arriba; no se presenta como una escritura de aceptación en producción.

Rollback: activar mantenimiento con `wrangler.rollout.json` y `--containers-rollout=none`, drenar la cola y aplicar `wrangler.fallback-rollout.json` con rollout inmediato. Esperar la imagen compatible `8575a007…`, una única allocation efectiva y las comprobaciones autenticadas antes de reabrir con `wrangler.fallback-final.json` y rollout `none`. Conservar D1/R2, secretos, variables y presupuesto. No usar la imagen `0ce3ac0a…` ni borrar campos para revertir después de nuevas escrituras. No hay migración de datos que deshacer.
