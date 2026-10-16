# Marketplace después de diez negocios

Idea reservada del 16 de octubre de 2026. Condición del propietario: no mostrarla en producción durante la etapa actual y revisarla cuando haya al menos diez negocios registrados. No se crea un catálogo, una ruta pública, una bandera activa ni una publicación automática como parte de este documento.

## Propósito

Permitir que una persona que ya reservó o se registró en un negocio descubra otros servicios dentro de Sarin. El enlace y QR de cada negocio siguen funcionando de forma independiente del directorio. El negocio decide si desea aparecer; contratar Sarin no equivale a aceptar publicación en un marketplace.

## Umbral y decisión de apertura

Contar diez negocios reales registrados, excluyendo ensayos QA, borradores técnicos y duplicados confirmados. Registrar además cuántos están activos, tienen información completa y disponibilidad útil. Esos indicadores ayudan a evaluar el piloto sin sustituir el umbral pedido por el propietario.

Al alcanzar diez, revisar con el propietario la zona/categorías cubiertas, el consentimiento, los datos públicos, el soporte y la capacidad. La apertura requiere decisión manual posterior. El contador no debe desbloquear navegación, APIs o indexación por sí solo.

## Primera versión a evaluar

- Entrada **Explorar negocios** desde la cuenta del cliente, después de decidir la apertura. Mientras tanto no se anuncia como función próxima en la interfaz de producción.
- Listado paginado por ciudad/zona y categoría, con nombre, logo, descripción breve, servicios y rango de precios cuando los datos lo permitan.
- Perfil visible antes del acceso, con servicios/precio/duración, contacto público, horarios y acción de reservar. Pedir autenticación al confirmar.
- Estados separados: borrador, pendiente de revisión, publicado y oculto. Retirar un negocio del directorio no cancela sus citas ni rompe su QR.
- Ordenamiento inicial simple y explicable. No inventar estrellas, reseñas, distancias o disponibilidad.

## Datos y fronteras

Reutilizar el negocio/slug existente, servicios, recursos y agenda. Diseñar una proyección pública específica de ciudad, zona, categoría, datos comerciales y publicación consentida. Excluir UID privado, correos de acceso, pruebas, pagos, comprobantes, contadores internos y conversaciones. Domicilios particulares y negocios a domicilio requieren decidir qué ubicación se muestra; no publicar por defecto una dirección privada.

Imágenes públicas separadas de comprobantes privados R2. Consultas D1 con filtros, índices y paginación; no descargar todas las empresas para filtrar en el navegador. Una cuenta global del cliente puede unificar referencias a sus citas, pero cada lectura y mutación sigue comprobando su UID y tenant.

## Lo que espera

Reseñas hasta poder verificarlas contra citas completadas y moderarlas. Comisiones hasta tener atribución y conciliación justificables. Pagos/anticipos, devoluciones de servicios de terceros, billetera, nómina, mapa avanzado y búsqueda global por disponibilidad quedan fuera del piloto inicial. Mantener la suscripción de Sarin como fuente de ingreso existente.

## Cómo decidir si aporta valor

Medir exploración a perfil, perfil a inicio de reserva, reserva confirmada, resultados sin oferta, asistencia y repetición. Distinguir reservas del QR propio de descubrimiento entre negocios. No afirmar que diez negocios garantizan liquidez del marketplace; la oferta debe ser útil para una zona y necesidad concretas.

Referencia: [análisis de Fresha](../qa/2026-10-16-fresha-analysis.md) y [brief del piloto](BRIEF.md). La guía oficial de Fresha separa creación de workspace y publicación del perfil: [workspace](https://www.fresha.com/help-center/knowledge-base/workspace-settings/40-create-a-new-workspace), [perfil online](https://www.fresha.com/help-center/knowledge-base/online-presence/266-create-your-online-profile). Las decisiones de alcance anteriores son propuestas para Sarin.
