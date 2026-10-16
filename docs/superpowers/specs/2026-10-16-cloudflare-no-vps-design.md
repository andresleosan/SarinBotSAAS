# Sarin en Cloudflare sin VPS

Fecha: 16 de octubre de 2026. El propietario autorizó migrar lo posible para eliminar la dependencia de la VPS y mantener conexión directa Cloudflare–Ollama. Presupuesto objetivo confirmado: **hasta USD 15 mensuales**.

## Resultado

El navegador utiliza `https://sarinbotsaas.pages.dev`. Pages reenvía HTML, assets y API mediante un service binding privado al Worker `sarin-bot-app`. Ese Worker utiliza una única instancia Node 24 de Cloudflare Containers, con la misma aplicación y datos actuales. El contenedor conecta directamente al hostname de Ollama bajo `alsdevstudio.com`, protegido por Tunnel y Access en la Mac.

Firebase Auth y Firestore se conservan: mover los datos no es necesario para retirar la VPS y añadiría una migración independiente de permisos, transacciones y lecturas en vivo. Vault permanece exclusivamente en el navegador. No se copian datos comerciales ni contenido Vault al almacenamiento del coordinador.

## Identidad sin archivos de la VPS

La identidad X.509 anterior dependía de renovación y archivos privados del host. Se reemplaza para este destino por Google Workload Identity Federation con OIDC emitido en Cloudflare:

- Issuer fijo: `https://sarinbotsaas.pages.dev`.
- Discovery: `/.well-known/openid-configuration`; claves públicas: `/.well-known/jwks.json`.
- Un Durable Object `SarinIdentity` conserva las claves de firma, publica solo las públicas y emite JWT ES256 de cinco minutos, con sujeto fijo `sarin-cloudflare-production`.
- El contenedor obtiene el JWT con `GET http://sarin-google.internal/token`, interceptado por `ContainerProxy` dentro de Cloudflare. Solo el ID del contenedor singleton y clase esperados pueden solicitarlo. No hay ruta pública de emisión ni secreto de broker.
- La audiencia es el recurso Google de `projects/153690559048/locations/global/workloadIdentityPools/sarin-cloudflare/providers/worker-oidc`. El proyecto es `sarinbotsaas`; su número se cotejó con el identificador público Firebase.
- El arranque materializa configuración ADC de tipo `external_account` en un archivo temporal 0600, sin claves privadas Google, tokens ni archivos de la VPS. Google Auth renueva automáticamente mediante el endpoint interno, STS e impersonación de `sarin-runtime@sarinbotsaas.iam.gserviceaccount.com`.
- Se mantiene solo el acceso Firebase Auth de lectura y Firestore existente de esa cuenta. La nueva confianza Google debe limitarse al issuer, audiencia y sujeto exactos; no se modifica ni elimina la confianza de reversión hasta aceptar la migración.

El issuer publica la siguiente clave antes de usarla y retiene la anterior al rotar. La rotación, reinicios, llamadas concurrentes y verificación criptográfica tienen pruebas; la confianza y renovación reales requieren aceptación posterior en Google/Cloudflare. No se presenta la identidad de aplicación como atestación nativa de Cloudflare.

## Runtime y ciclo de vida

Se conserva `@cloudflare/containers` 0.3.7 y el lockfile compartido. La lista explícita de variables transmite proveedores, perfiles de prueba y WhatsApp sin incluir secretos arbitrarios o rutas de ADC humano. ADC admite solo la fuente federada interna preparada para este destino.

Se mantiene un contenedor `basic`, máximo una instancia y nombre constante de DO. El tiempo de inactividad baja a dos minutos. Las peticiones activas conservan su stream; reinicios pueden interrumpir inferencias y perder la cola en memoria, igual que el proceso anterior. No se reintentan automáticamente POST.

WhatsApp y retención permanecen desactivados en esta salida. Si se habilitan posteriormente, los temporizadores del proceso necesitan mantenerlo despierto y recuperarlo mediante cron; el comportamiento debe ser explícito y probado. Esa modalidad altera el costo y requiere revisar el presupuesto. No se habilitan servicios nuevos por esta migración.

## Presupuesto

Tarifas oficiales verificadas el 16 de octubre: Workers Paid USD 5/mes; memoria adicional USD 0,0000025/GiB-segundo, disco USD 0,00000007/GB-segundo y CPU USD 0,000020/vCPU-segundo, con bolsas incluidas. Una instancia `basic` tiene 1 GiB, 4 GB y hasta 1/4 vCPU. Mantenerla todo el mes cuesta aproximadamente USD 11,93 por base/memoria/disco antes de CPU; actividad CPU elevada puede llevarlo por encima de USD 15. Dormir a los dos minutos y comenzar con poco tráfico reduce consumo, pero **no equivale a un límite automático de gasto**.

No se contrata ni amplía facturación sin comprobar el plan existente y su compatibilidad con el máximo del propietario. Antes de activar, registrar estimación por uso, alertas disponibles y qué se detiene si la proyección supera USD 15. El presupuesto es condición de esta migración, no una promesa de un tope técnico inexistente. Fuente: https://developers.cloudflare.com/containers/platform/pricing/.

## Aceptación y reversión

Pruebas locales: runtime allowlist, restricción de host, identidad criptográfica/rotación, fuente ADC acotada, gateway por binding, streaming y ausencia de reintentos, acceso público solo a discovery/JWKS, y background desactivado sin despertadores. Tipos, suite general, build Next, dry-run Worker y build Pages deben pasar.

Aceptación externa: permisos de Containers, plan/costos, issuer público accesible, confianza Google acotada, STS/impersonación, Auth/Firestore, renovación después de expirar un token, conexión directa a Ollama, OAuth público y recorrido de citas/pagos de prueba autorizado. El contenedor nuevo debe funcionar con la VPS fuera de su ruta antes de considerarla prescindible.

La VPS existente, su contenedor y sus respaldos se conservan mientras se valida. La reversión restaura Pages y su binding/versión anteriores; no borra citas, pagos ni identidades anteriores. Retirar Sarin de la VPS será un paso posterior a la aceptación, sin afectar otros proyectos del host.
