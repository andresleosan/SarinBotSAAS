# Dominio definitivo de AgendIA

El propietario eligió expresamente `https://agendia-app.pages.dev` el 7 de noviembre de 2026. Cloudflare confirmó ese hostname exacto al crear Pages `agendia-app` en la cuenta existente. El nombre inicial `agendia.pages.dev` ya servía otra aplicación; el primer proyecto vacío recibió `agendia-l75.pages.dev` y no es el destino de publicación.

La API compartida permite únicamente el nuevo origen para la preautorización de AgendIA y genera sus QR mediante `?application=agendia`. Los enlaces históricos de Sarin mantienen su configuración existente. Los tests rechazan los dos hostnames descartados, previews, puertos explícitos y dominios similares.

Firebase Auth conserva el proyecto `sarinbotsaas` y los dominios anteriores. Se retiró la autorización provisional de `agendia.pages.dev` y se añadió únicamente `agendia-app.pages.dev`, verificando la lista después de cada operación. No se copiaron credenciales Admin ni tokens al nuevo repositorio.

Verificación: las tres pruebas del nuevo dominio fallaron antes del cambio; después pasaron las 20 pruebas de `booking-url`, `consent-routes` y `qr-kit-route`. TypeScript pasó. No se cambiaron los archivos protegidos de Cloudflare, inferencia, administración de API o WhatsApp, ni el lockfile.

Este registro documenta la configuración y las pruebas previas al despliegue; no acredita recorridos autenticados ni envíos reales.
