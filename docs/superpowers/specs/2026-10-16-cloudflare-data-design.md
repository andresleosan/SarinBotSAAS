# Datos de Sarin en Cloudflare

El propietario aprobó trasladar los datos comerciales a Cloudflare y mantener Firebase solo para autenticación Google. Se conserva `https://sarinbotsaas.pages.dev`, una instancia Node, la Mac con Ollama, Vault local y presupuesto máximo objetivo de USD 15/mes. Esta aprobación permite preparar, verificar y publicar la migración; no se vuelven a solicitar aprobaciones de alcance ya dadas.

## Decisión

Usar D1 para entidades comerciales y R2 privado para las imágenes de comprobantes. El UID de Firebase sigue siendo la identidad; perfiles, roles y relaciones de negocio se guardan en D1. Auth sigue validando tokens y revocación en el servidor. La identidad Google existente puede mantenerse para Auth sin permiso de datos después del período de reversión.

Se conserva el contrato documental actual detrás de una interfaz de datos pequeña, propia del proyecto, sin el SDK Firestore en la ruta D1. D1 tendrá una fila por entidad, clave de ruta estable y campos de consulta indexados mediante expresiones JSON. Conservar los payloads JSON de configuración evita transformar simultáneamente el modelo comercial, los importes, las cuotas y sus invariantes; no se copia una caché completa ni se crean dos fuentes de verdad. Las proyecciones públicas existentes siguen siendo explícitas y sin información del propietario. Un esquema relacional exhaustivo por cada campo obligaría a reescribir toda la lógica de pagos/reservas durante el corte; esta fase cambia la persistencia y mantiene el contrato probado.

## Acceso y atomicidad

El Container llama a `http://sarin-data.internal/execute`, interceptado por el Worker solo para la clase SarinApp y su ID singleton. No se expone SQL, credenciales de cuenta, base de datos o bucket al navegador. Los comandos tipados están en `shared/data-protocol.ts`. El Worker valida rutas, operaciones, campos, tamaños y límites; usa consultas parametrizadas.

Las lecturas D1 devuelven revisión global y documentos en un batch consistente. Una transacción Node vuelve a ejecutar su callback si observa otra revisión. El commit es un batch atómico D1: un guard SQL aborta si cambió la revisión, aplica todas las escrituras y la incrementa. Así se detectan inserciones fantasma, cruces de horarios y consumo concurrente de la décima cita incluso entre recursos/días. Los commits llevan UUID y registro idempotente para resolver una respuesta perdida sin duplicar efectos. La revisión global favorece corrección y carga inicial pequeña; su contención se medirá antes de ampliar capacidad.

Las imágenes se escriben primero en R2 con clave basada en hash y se referencian desde D1. D1/R2 no comparten transacción: un conflicto puede dejar un objeto privado huérfano, pero nunca un registro confirmado con un objeto pendiente de subir. El borrado de registros no elimina inmediatamente blobs de respaldo. No se habilita acceso público al bucket ni se registran contenidos.

## Navegador

Sustituir los cuatro listeners Firestore por APIs autorizadas y refresco periódico acotado, pausado en pestañas ocultas, con aborto/guardas al cambiar usuario/negocio. Mantener el filtro servidor por UID y negocio, la agenda por fecha y las citas visibles aunque la IA esté pausada. Una vista pública solo recibe `publicBusinesses`. No añadir WebSockets/DO de coordinación cuando la atomicidad D1 ya cubre las escrituras.

## Migración y reversión

1. Conservar fuera de Git el checkout inicial y configuración activa. Preparar una exportación Firestore recursiva, manifiesto de conteos/hash y restauración, sin imprimir datos personales ni tokens.
2. Crear recursos dedicados Sarin, aplicar esquema aditivo D1 e importar inicialmente sin cambiar tráfico. Verificar documentos y hashes; separar imágenes a R2 y comprobar sus bytes.
3. Ensayar backend real con D1/R2 locales: reservas simultáneas, cuotas, pagos, permisos, listeners, errores y reinicios. No escribir reservas ni pagos reales para probar.
4. Publicar la imagen revisada y preparar bindings con modo Firestore todavía disponible. Activar mantenimiento temporal, detener trabajo de fondo y confirmar ausencia de solicitudes en curso antes de la exportación final. Importar/verificar la copia final y activar D1; retirar mantenimiento.
5. Verificar con sesión real Google, lecturas de negocio/citas y Ollama. Firestore se conserva sin nuevas escrituras de aplicación como respaldo durante aceptación; no se borra proyecto ni se elimina Firebase Auth.
6. Si no hubo escrituras nuevas en D1, volver al backend Firestore y artefacto anterior. Si las hubo, mantener mantenimiento y exportar/reconciliar D1 hacia Firestore antes de devolver tráfico. Nunca revertir solo el flag perdiendo escrituras posteriores al corte.

## Costos y aceptación

D1/R2 tienen bolsas incluidas y precios por consumo; no constituyen un hard cap. Comprobar tamaños y tarifas vigentes antes de crear recursos y contabilizar junto con Containers dentro de USD 15. No se aumenta capacidad ni se contrata un plan adicional. La falta de permiso D1/R2 se resuelve con la autorización específica necesaria después de preparar el código revisable, sin ampliar acceso a otros proyectos.

Aceptación: ninguna lectura/escritura de datos comerciales usa Firestore al activar D1; Auth Google conserva los mismos UID; no hay reservas duplicadas ni doble consumo; APIs rechazan accesos entre negocios; toda entidad y archivo del corte tiene correspondencia verificada; copia y procedimiento de reversión están disponibles. WhatsApp sigue apagado y Vault permanece local.
