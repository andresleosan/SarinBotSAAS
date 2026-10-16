# Retirada de OpenAI — revisión privada

El propietario solicitó retirar la opción pendiente porque buscaba aprovechar su suscripción, no contratar consumo API independiente ni esperar acceso comercial a Sign in with ChatGPT.

## Alcance

Retirar proveedor, tarjeta administrativa, selector y cálculo de consumo OpenAI, variables de ejemplo, guía operativa y archivo privado vacío de preparación. Conservar IA local, DeepSeek, sugerencias editables, foto de Google, autorización del administrador, datos del negocio y selección efectiva de Ollama. No se eliminan documentos de Firestore ni evidencias históricas de QA.

## Verificación

- Suite de aplicación: 464 pruebas pasan; 18 pruebas optativas de integración se omiten sin su entorno dedicado. TypeScript pasa.
- Regresiones verifican que OpenAI se rechaza aunque existan variables o una selección antigua, sin solicitudes externas ni fallback silencioso. Panel restringido al administrador y dos proveedores disponibles.
- Revisiones independientes de motor, medición y scripts privados sin bloqueadores. Se conserva la protección del medidor DeepSeek frente a respuestas tardías.
- El archivo privado de preparación estaba vacío y se eliminó sin leer ni exponer credenciales.

- [CI 38847007777](https://github.com/andresleosan/SarinBotSAAS/actions/runs/38847007777) del commit `5a27207ec0fd9ac378192958b6d0b44bc7f119d1`: tres jobs correctos (tipos/pruebas/builds, reglas Firebase/recorrido local y dry-run Cloudflare). Pages confirmó `skipped / No deployment available`; no se publicó una versión pública.
- Chrome sobre snapshot aislado: exactamente dos opciones de IA, ninguna mención visible de OpenAI, y sección Consumo de DeepSeek. No se cambió de proveedor. Captura privada `remove-openai-admin-qa.png`.
- El snapshot de QA usa Webpack para admitir la unión local de dependencias; ese ajuste no pertenece al código del producto. Se detuvieron sus nueve procesos y se conservó el túnel privado 3032.

## Actualización privada

- Imagen activa `sarin-bot:remove-openai-20261016t034442z`, ID `sha256:a761759146bf9aaf1f3b4bc057d6f6f1e6e5072aeb31c1886a23d8065eab4ce7`, construida de 111 blobs del commit exacto. Archivo fuente SHA-256 `c233266fe7a4fd7337954524358a38ccdad7cad4f17e5f24d7eed794324614bd`.
- Actualización satisfactoria: 28 comprobaciones de autorización, 34 HTTP, assets y lecturas Firebase, catálogo Ollama con modelo presente. Entorno, administrador, proveedor base, DNS, única réplica y acceso privado conservados.
- Copia de reversión verificada: `/opt/sarin-bot/runtime/rollbacks/remove-openai-image-update-20261016T034305Z-12d75b54`. Restaura la imagen anterior `sarin-bot:onboarding-openai-20261016t033210z`, que vuelve a mostrar la opción pendiente de OpenAI sin activarla.
- No se habilitó Gemini ni se cambió facturación alguna. La consulta sobre Google AI Pro se respondió con fuentes oficiales; no se comprobó la elegibilidad del beneficio en la cuenta personal.
- Revisión posterior en Chrome: la sesión real del negocio recibe Acceso restringido en `/admin`, como corresponde. La apariencia del panel administrativo se verificó con administrador sintético antes de activar; no se cambió de cuenta ni se afirma haber inspeccionado el panel con el administrador real después del despliegue.
