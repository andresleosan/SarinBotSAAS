# Agenda clara interna y preparación local — 14 de octubre de 2026

Alcance aprobado: trasladar el diseño elegido a las pantallas internas, probar el recorrido completo con emuladores y añadir CI. La Mac, Ollama y el túnel quedan pendientes por indicación del propietario.

## Cambios

Tokens compartidos, DM Sans, rostro de Sarin, foco azul y superficies claras en acceso, shell, agenda, onboarding, QR, facturación, consola, isla y Vault. Se ajustan campos horarios, acciones y QR para 320 px. Markdown y diálogos conservan sus restricciones. No cambian APIs, hooks de negocio, permisos, persistencia ni dependencias.

`test:journey` crea cuentas nuevas y datos sintéticos por corrida sobre Auth/Firestore oficiales, verifica tokens y contratos reales y realiza limpieza limitada a sus propios documentos. La reserva usa `createAppointment` real, pues el chat requiere el motor excluido de esta tarea. Guardas de proyecto demo, loopback, redirecciones, puertos y entorno; configuración Vitest dedicada con `envDir:false`.

CI incluye tres jobs: tipos/pruebas/builds/audit, reglas y recorrido emulado, y comprobación del Worker con dry-run. Acciones oficiales fijadas por SHA, permisos de lectura, ningún secreto o despliegue. El launcher se detiene al terminar el ensayo. El autodeploy de Pages sigue siendo independiente.

## Evidencia local

- Build Next y build Pages aprobados; artefacto de portada verificado (41 archivos, sin rutas privadas/configuración backend).
- TypeScript y `git diff --check` aprobados.
- Suite: 150 pruebas aprobadas; ocho pruebas opt-in omitidas en esa invocación.
- Firestore oficial Java 21: las siete pruebas de reglas/integración pasan por separado.
- `test:local` aprobado: Auth/roles/API/Admin SDK y rechazos 403.
- `test:journey`: una prueba integrada, 61 comprobaciones y limpieza verificada, sin inferencia. Ocho pruebas de guardas/limpieza incluidas en la suite.
- Worker: ocho pruebas, TypeScript y dry-run aprobados. `npm audit`: cero vulnerabilidades.
- Revisiones independientes de UI/Vault/CI sin bloqueantes. Se corrige el salto de nombres largos de servicio y el aviso de navegación suave siguiendo [Next.js](https://nextjs.org/docs/messages/missing-data-scroll-behavior).

## Navegador

Chrome real, cuentas locales de admin, negocio y cliente. Acceso restringido a admin para negocio comprobado. Onboarding manual creó un negocio explícitamente de prueba y activó siete días. Se creó un bloqueo con campos de hora mediante eventos nativos y se canceló; la agenda mostró el estado actualizado. QR, facturación, acceso del cliente a la isla y estado del motor sin conexión comprobados. En las siete vistas revisadas a 320 px, el documento mantuvo 305/305 px útiles sin desbordamiento horizontal; QR observado de 197 px. Viewport restaurado y sesión devuelta al administrador.

Vault: estado vacío, controles y diálogos claros revisados; sin mensajes enviados al motor. La importación automática de archivo está limitada por el permiso de archivos de la extensión Chrome. Las pruebas automatizadas de IndexedDB, importación y cifrado sí pasan. El diálogo de exportación cerró sin error; la herramienta no capturó el evento de descarga, por lo que no se afirma una verificación de ese archivo. No se modificó la bóveda personal. El negocio y bloqueo cancelado de la revisión UI quedan únicamente en el emulador temporal, claramente etiquetados como prueba; desaparecen al reiniciarlo.

Capturas: [agenda](sarin-dashboard-agenda-clara.png), [Vault](sarin-vault-agenda-clara.png), [isla móvil](sarin-isla-agenda-clara-mobile.png).

## Publicación y reversión

Push del commit `d761de4d194a3017b7db60d0e27665e70fd03495`. Los tres jobs reales del [CI 38523876656](https://github.com/andresleosan/SarinBotSAAS/actions/runs/38523876656) finalizaron con `success`: tipos/pruebas/builds, reglas/recorrido local y comprobación del Worker. Las pantallas privadas se revisan en `http://127.0.0.1:3030`; `sarinbotsaas.pages.dev` continúa siendo la portada temporal, comprobada por HTTP 200 y sin enlaces a las rutas privadas. Para revertir, revertir el commit de este adelanto y regenerar el build; no hay migraciones de datos. Referencia previa: `389d300`.
