# Producción desde main

`main` es la rama de publicación de Sarin. El workflow [Verify Sarin](../.github/workflows/verify.yml) ejecuta tipos, pruebas, builds, emuladores y dry-run del Worker. Solo cuando los tres jobs pasan, publica la imagen Node 24 y el Worker `sarin-bot-app`, verifica su rollout y publica el gateway Pages `sarinbotsaas` desde el mismo commit. Un PR solo valida. También se puede ejecutar manualmente el workflow sobre `main` para recuperar una publicación fallida.

## Base de datos e identidad

Producción usa **Cloudflare D1** (`sarin-bot-data`) para datos comerciales y **R2 privado** (`sarin-bot-files`) para archivos. **Firebase Authentication** valida identidades y conserva los UID. Firestore es un producto diferente: sus documentos anteriores se conservaron después de la migración, y los emuladores locales siguen probando ese backend. Ver documentos en la consola Firestore no significa que la aplicación activa los esté usando. No hay fallback automático a Firestore si falla D1.

La comprobación del 24 de octubre de 2026 a las 01:51 UTC encontró `SARIN_DATA_BACKEND=d1` en la versión Worker con el 100% de tráfico y los bindings D1/R2 esperados. `GET /api/session` por sí solo comprueba autenticación, no acredita qué base de datos utiliza el proceso. La copia Firestore y los respaldos privados no se eliminan con una publicación. La [reversión de datos](cloudflare-data-migration.md#reversión) requiere reconciliar las escrituras posteriores al corte.

## Configuración inicial de Actions

En `andresleosan/SarinBotSAAS`, configurar:

| Tipo | Nombre | Uso |
| --- | --- | --- |
| Actions secret | `CLOUDFLARE_API_TOKEN` | Token dedicado al despliegue, con permisos mínimos para Worker/Containers y Pages de la cuenta indicada. |
| Actions variable | `CLOUDFLARE_ACCOUNT_ID` | Cuenta que contiene los recursos existentes de Sarin. |
| Actions variable | `NEXT_PUBLIC_FIREBASE_API_KEY` | Configuración pública de la aplicación web Firebase de producción. |
| Actions variable | `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Dominio de Auth de producción. |
| Actions variable | `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | `sarinbotsaas`. |
| Actions variable | `NEXT_PUBLIC_FIREBASE_APP_ID` | ID de la aplicación web Firebase de producción. |

El token de CI no es el OAuth humano de Wrangler. No copiar claves Admin, WIF, tokens de proveedores ni secretos del runtime a GitHub. El token de GitHub proporcionado al job tiene permiso de lectura del repositorio, usado para comprobar que se publica el commit vigente de `main`. El entorno del job se llama `production`.

Una vez preparada y verificada la credencial, desactivar los despliegues Git independientes de producción y preview de Pages; conservar el proyecto y su binding privado `SARIN_APP_HOST` hacia `sarin-bot-app`. No habilitar un segundo build automático en Workers Builds. Actions realiza la publicación directa sobre el proyecto Pages existente.

## Garantías y límites

- Las publicaciones ya iniciadas se serializan y no se cancelan automáticamente por un push posterior. GitHub puede sustituir una ejecución pendiente por otra más reciente. Un commit obsoleto se rechaza antes de empezar a modificar el despliegue; una publicación ya iniciada debe terminar o reconciliarse antes de la siguiente.
- La imagen se construye para `linux/amd64`, con el commit de origen identificado, y se fija por digest del registro. Pages solo se publica después de comprobar el Worker y el Container esperados.
- La configuración generada usa `keep_vars` y no vuelve a aplicar las variables predeterminadas del archivo versionado. Los bindings de datos, la identidad y el máximo de una instancia se verifican. Las credenciales privadas permanecen en Cloudflare.
- Un push normal no importa datos, no aplica migraciones D1 y no cambia flags operativas. Un cambio de esquema exige una operación de migración revisada y compatible antes de publicar el código que la necesita.
- Worker, Container y Pages no forman una transacción. Un fallo puede dejar una publicación parcial. No interpretar un `wrangler deploy` exitoso como prueba suficiente de rollout completo.
- La cola de inferencias sigue siendo local al proceso. El máximo de una instancia no garantiza que un despliegue preserve solicitudes en curso; no reintentar automáticamente mutaciones ni conversaciones cuando su resultado sea incierto.

## Publicación y recuperación

Después de un push, revisar el job **Deploy Cloudflare production**, además de los tres jobs de verificación. La publicación solo se considera completa cuando el job verifica la versión Worker, el digest del Container y el despliegue Pages correspondiente. La portada estática por sí sola no prueba que la aplicación Next esté actualizada.

Si un job falla antes de publicar, corregir la causa y ejecutar de nuevo el workflow para el `main` vigente. Si falla después de modificar Cloudflare, comprobar las versiones realmente activas antes de reintentar. Un job exitoso registra los identificadores finales; uno fallido informa la etapa y un código saneado. Conservar además los identificadores obtenidos de la inspección del despliegue anterior y del estado activo. No sustituir secretos ni resetear datos para recuperar una publicación. Una reversión debe conservar D1/R2 y sus limpiadores compatibles; los procedimientos de [runtime](cloudflare-no-vps-runbook.md) y [datos](cloudflare-data-migration.md) siguen aplicando.

Los commits históricos de ramas se conservan al consolidar `main`. La rama antigua del fallback del catálogo se retiene en la ascendencia sin reintroducir su retirada de categorías y descripciones. El respaldo Git completo se guarda fuera del repositorio. Los archivos sin commit de la carpeta de trabajo original se conservan por separado del estado publicado.
