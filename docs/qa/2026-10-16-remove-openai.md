# Retirada de OpenAI — revisión privada

El propietario solicitó retirar la opción pendiente porque buscaba aprovechar su suscripción, no contratar consumo API independiente ni esperar acceso comercial a Sign in with ChatGPT.

## Alcance

Retirar proveedor, tarjeta administrativa, selector y cálculo de consumo OpenAI, variables de ejemplo, guía operativa y archivo privado vacío de preparación. Conservar IA local, DeepSeek, sugerencias editables, foto de Google, autorización del administrador, datos del negocio y selección efectiva de Ollama. No se eliminan documentos de Firestore ni evidencias históricas de QA.

## Verificación

- Suite de aplicación: 464 pruebas pasan; 18 pruebas optativas de integración se omiten sin su entorno dedicado. TypeScript pasa.
- Regresiones verifican que OpenAI se rechaza aunque existan variables o una selección antigua, sin solicitudes externas ni fallback silencioso. Panel restringido al administrador y dos proveedores disponibles.
- Revisiones independientes de motor, medición y scripts privados sin bloqueadores. Se conserva la protección del medidor DeepSeek frente a respuestas tardías.
- El archivo privado de preparación estaba vacío y se eliminó sin leer ni exponer credenciales.

Pendientes CI, revisión visual y actualización privada. La actualización sustituirá únicamente la imagen; no cambia credenciales, DNS, Firebase ni exposición del servicio.
