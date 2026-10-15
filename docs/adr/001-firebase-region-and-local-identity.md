# ADR-001: Región Firestore e identidad local de Firebase Admin

Fecha: 2026-10-14
Estado: aceptada

## Contexto

Sarin conecta con el proyecto Firebase `sarinbotsaas`. Google Authentication ya estaba habilitado. La organización impide generar claves de servicio mediante `iam.disableServiceAccountKeyCreation`; el propietario eligió `us-east1` para Firestore.

## Decisión

Crear la base `(default)` de Firestore Native, edición Standard, en `us-east1`. Conectar el servidor local mediante ADC de impersonación de una cuenta dedicada, con selección explícita `FIREBASE_ADMIN_CREDENTIAL_MODE=adc`.

La cuenta runtime usa `roles/firebaseauth.viewer` y `roles/datastore.user`. El permiso del operador para generar tokens temporales se limita a esa cuenta. El archivo ADC se conserva fuera del repositorio, separado de la configuración Google Cloud de otros proyectos.

## Alternativas consideradas

- Certificado descargable: bloqueado por la organización. Se conserva la compatibilidad existente en el código para otros despliegues.
- Desactivar la política organizacional: innecesario para la conexión local.
- Credenciales directas de usuario: no equivalen a la identidad runtime y Firebase Auth limita el cliente OAuth estándar de gcloud.

## Consecuencias

La región de la base queda fija; cambiarla requiere planificar una migración a otra base. ADC evita emitir claves privadas de servicio, pero su archivo contiene credenciales sensibles de origen y debe protegerse.

El despliegue Cloudflare requiere definir y validar por separado una identidad renovable durante ejecución. Un token de un build GitHub no resuelve ese requisito.
