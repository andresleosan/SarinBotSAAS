# Fresha como referencia comercial para Sarin

Investigación del 16 de octubre de 2026. Alcance: páginas públicas y documentación oficial de Fresha, comparadas con el modelo de producto de Sarin en este checkout. No se implementó un marketplace ni se hicieron reservas, pagos o cambios en Fresha como parte de esta investigación documental. El recorrido interactivo del registro se registra por separado por el agente principal.

## Conclusión

Sarin puede evolucionar hacia un marketplace usando su motor de negocios, servicios y citas. Conviene avanzar primero con perfiles comerciales completos y una reserva clara por negocio; después, incorporar descubrimiento entre negocios de una misma zona. Fresha sirve como referencia de experiencia, pero su amplitud actual no debe convertirse en el alcance del primer lanzamiento de Sarin.

**Sarin todavía no ofrece un marketplace.** La API tiene una proyección pública por slug, pero la interfaz `/b/[slug]` muestra el acceso con Google antes de enseñar el perfil del negocio. La comprobación E2E sin sesión del agente principal confirmó ese comportamiento. Permitir descubrir negocios y explorar su perfil sin iniciar sesión, solicitando Google al confirmar una reserva, es un cambio de experiencia pendiente; no forma parte de lo ya entregado.

El usuario que más necesita resolver el problema inmediato es el propietario que quiere recibir reservas y el cliente que necesita elegir y gestionar una cita. Posponer un catálogo global unos meses no impide operar con el enlace/QR existente. En cambio, mostrar negocios sin información útil, disponibilidad o un recorrido fiable de reserva perjudicaría la conversión. Esta priorización es una recomendación para Sarin, no un resultado medido de mercado.

## Qué hace Fresha

| Área | Evidencia oficial consultada | Aplicación a Sarin |
| --- | --- | --- |
| Dos públicos | La portada de clientes busca tratamiento, ubicación y momento; enlaza una entrada separada para negocios. [Portada española](https://www.fresha.com/es). | Conservar una entrada para contratar Sarin y otra para descubrir/reservar, con acciones y textos distintos. |
| Descubrimiento | Fresha describe filtros por precio, distancia y disponibilidad. Su visibilidad depende de ubicación, catálogo, horarios, precios, reseñas y demanda. [Ayuda de visibilidad](https://www.fresha.com/help-center/knowledge-base/online-profile/601-boost-your-marketplace-visibility), [marketplace](https://www.fresha.com/for-business/features/marketplace). | Empezar con ciudad/zona y categoría, y añadir filtros que los datos reales permitan cumplir. Un directorio no equivale todavía a búsqueda por disponibilidad. |
| Perfil comercial | Un perfil real en Bogotá presenta fotos, servicios agrupados, precio y duración, equipo, opiniones, descripción, horario, dirección y acción de reserva. [Ejemplo público](https://www.fresha.com/es/a/barberia-lords-parque-93-bogota-carrera-11-94a-25-iz3ini3s). | Ampliar la isla de negocio existente para que permita decidir antes de abrir el chat. No es necesario replicar todos los módulos del ejemplo. |
| Conversión | El cliente selecciona servicio(s), profesional cuando corresponda, fecha/hora y revisa precio/detalles. Puede explorar sin iniciar sesión; confirmar requiere una cuenta. Algunas configuraciones exigen anticipo o tarjeta. [Recorrido oficial](https://www.fresha.com/help-center/knowledge-base/online-presence/102398-learn-how-clients-book-appointments-online). | Añadir exploración del perfil sin sesión: hoy Sarin muestra Google primero. Solicitar acceso al confirmar, junto con selección directa y resumen revisable. La disponibilidad, el importe y la escritura de la cita deben seguir reglas deterministas del servidor. |
| Catálogo visual | Las imágenes pueden vincularse a un servicio y funcionar como entrada a reservarlo. [Imágenes de servicios](https://www.fresha.com/help-center/knowledge-base/catalog/100669-add-images-to-a-service). | Primero fotos de negocio y servicios con precio/duración; portafolios y promociones avanzadas pueden esperar. |
| Registro del negocio | La creación del workspace recoge nombre, actividad principal y relacionadas, tamaño del equipo y modalidad presencial, a domicilio o virtual. La publicación del perfil es otro recorrido. [Crear workspace](https://www.fresha.com/help-center/knowledge-base/workspace-settings/40-create-a-new-workspace). | Separar alta/configuración del negocio de su publicación en el catálogo. No publicar automáticamente borradores o negocios incompletos. |
| Publicación | La guía solicita contacto, dirección/pin, horarios, imágenes, atributos, descripción y aceptación de condiciones/comisiones; para habilitarla incluye datos de facturación. [Crear perfil online](https://www.fresha.com/help-center/knowledge-base/online-presence/266-create-your-online-profile). | Añadir un checklist de perfil y una decisión explícita de aparecer públicamente. No confundir pagar Sarin con tener un perfil listo para recibir clientes. |
| Reputación | La ayuda vincula valoraciones a citas completadas y permite responder públicamente o solo al cliente. La política prevé moderación y revisión de decisiones. [Responder reseñas](https://www.fresha.com/help-center/knowledge-base/personal-account/35-respond-to-your-personal-reviews), [política](https://terms.fresha.com/review-policy). | Posponer hasta disponer de citas completadas, autorización por cita, denuncias y moderación. No crear estrellas o testimonios de muestra como si fueran reales. |

La guía de Fresha para nuevas altas también distingue el enlace de reserva propio de los canales de descubrimiento y mide de dónde llegó cada cliente. Para Sarin, registrar el canal de entrada de una reserva permite evaluar el catálogo sin introducir inmediatamente comisiones. [Canales y gestión de citas](https://www.fresha.com/help-center/knowledge-base/online-presence/102398-learn-how-clients-book-appointments-online).

## Monetización y límites de la comparación

La página inglesa de precios consultada mostraba lo siguiente. Se conserva el símbolo `$` de la fuente: el contenido devuelto no identifica expresamente la moneda ni confirma estas tarifas para un negocio colombiano. No son precios propuestos para Sarin. [Precios oficiales](https://www.fresha.com/pricing).

| Concepto observado | Tarifa mostrada |
| --- | --- |
| Independent | $19.95 al mes; un profesional reservable |
| Team | $14.95 al mes por profesional reservable |
| Marketplace: cliente nuevo atribuido | 20% una vez, con mínimo de $6 |
| Marketplace: cliente recurrente | Sin nueva comisión de adquisición |
| Pago online | 2,79% + $0.20 por transacción |
| Extras | Existen complementos de pago; impuestos locales excluidos |

Esto combina suscripción del software, adquisición y procesamiento de pagos. No debe presentarse Fresha como un producto totalmente gratuito basándose en textos promocionales o reseñas antiguas. Su ayuda explica que la atribución puede mantenerse si alguien descubre el negocio en Fresha y termina reservando desde otra vía; además tiene reglas específicas para cancelaciones y ausencias. No conviene reproducir una comisión sin resolver atribución, reclamaciones y conciliación. [Comisión de nuevos clientes](https://www.fresha.com/help-center/knowledge-base/billing-and-fees/188-marketplace-new-client-fees).

Fresha permite usar agenda y reservas sin activar su procesamiento de pagos. Su ayuda limita este último a países seleccionados, y los términos remiten a las tarifas efectivas de la cuenta. Se verificó oferta pública de barberías en Bogotá, pero eso **no confirma** habilitación de cobros, liquidaciones o tarifas de Fresha Pay para Colombia. No se consiguió una lista oficial completa que resolviera esa disponibilidad en esta consulta. [Pagos opcionales](https://www.fresha.com/pricing), [disponibilidad de liquidaciones](https://www.fresha.com/help-center/knowledge-base/wallets/119-set-up-automatic-payouts), [términos para negocios](https://terms.fresha.com/partner-terms), [oferta de Bogotá](https://www.fresha.com/lp/es/bt/barber%C3%ADas/co-bogot%C3%A1).

Hay una discrepancia documental en reseñas: la política indica siete días tras completar una cita; la ayuda del recorrido permite publicar/eliminar sin ese límite y menciona treinta días para editar. Se conserva la discrepancia; no se adopta ninguno de esos plazos para Sarin. [Política](https://terms.fresha.com/review-policy), [ayuda del recorrido](https://www.fresha.com/help-center/knowledge-base/online-presence/102398-learn-how-clients-book-appointments-online).

Una diferencia de producto a considerar: la ayuda de Fresha indica que retirar el perfil del marketplace desactiva todos sus canales de reserva online. Para Sarin recomiendo que la publicación en el catálogo sea opcional y que el enlace directo siga funcionando cuando el negocio decida ocultarse del directorio. Es una recomendación, pendiente de decisión e implementación. [Condición de Fresha](https://www.fresha.com/help-center/knowledge-base/billing-and-fees/188-marketplace-new-client-fees).

## Base existente y brechas de Sarin

Observación del código actual:

- [Business y servicios](../../src/types/firestore.ts): ya existen nombre, categoría libre, slug, contacto, recursos, servicios con precio/duración/buffer y horario semanal. Hay citas con estados de completada y ausencia, además de confirmación/cancelación.
- [Configuración y proyección pública](../../src/lib/server/businesses.ts): ya existen datos públicos por slug y un borrador privado previo al pago aprobado. Esto no implica que la pantalla del negocio pueda explorarse sin sesión. La publicación en un catálogo requeriría un estado propio; no debe inferirse solo de la existencia del documento.
- [Validación de configuración](../../src/lib/server/schemas.ts): no hay campos actuales de ciudad, dirección estructurada, coordenadas, fotografías, atributos públicos, reseñas o consentimiento de publicación.
- [Isla del cliente](../../src/app/b/%5Bslug%5D/page.tsx) y [Mis citas](../../src/components/client-appointments.tsx): después de iniciar sesión ofrecen el contexto de un negocio y la consulta posterior de citas, calendario/historial, cancelación y `.ics`. `AuthGate` envuelve la página completa: sin sesión se ve Google antes del perfil, confirmado también en E2E por el agente principal. No son un catálogo entre negocios ni una cuenta global de citas de todos ellos.
- [Oferta comercial](../commercial-plans.md) y [prueba pagada](../paid-trial.md): Sarin monetiza el uso del software por prueba/planes y revisión de comprobantes. Esa factura corresponde al negocio que contrata Sarin; no equivale al pago del cliente por un corte, consulta u otro servicio.
- [Arquitectura vigente](../../STACK.md): D1/R2, Auth Google y APIs autorizadas permiten extender el producto sin añadir una VPS. El puente actual limita lecturas a 1.000 documentos; un catálogo creciente requiere consultas e índices específicos y paginación, no descargar todos los negocios para filtrarlos en el navegador.

El catálogo debería usar una proyección pública específica con campos mínimos para descubrir el negocio. Sus imágenes públicas necesitan un flujo y autorización propios, separados de los comprobantes privados R2. Estos son requisitos de diseño propuestos, no recursos creados por este análisis.

| Capacidad | Estado actual de Sarin | Trabajo para marketplace |
| --- | --- | --- |
| Datos públicos por slug | API existente con proyección de negocio. | Definir datos mínimos de perfil y descubrimiento, sin exponer datos privados. |
| Explorar el perfil sin cuenta | No disponible en la pantalla actual: Google aparece antes del perfil. | Separar presentación pública de las acciones autenticadas; pedir Google al confirmar. |
| Reserva e historial del cliente | Disponibles dentro de un negocio y con sesión. | Reutilizar las reglas de autorización y reserva existentes en el nuevo recorrido. |
| Descubrir entre negocios | Sin catálogo público ni filtros entre negocios. | Publicación voluntaria, ciudad/categoría, consulta paginada y datos reales. |

## Roadmap recomendado

| Fase | Alcance y criterio para avanzar | Qué se pospone |
| --- | --- | --- |
| V1: venta y reserva por negocio | Completar aceptación comercial: alta/pago/aprobación/configuración, servicios comprensibles, reserva sin conflictos, próximas citas e historial. Mejorar perfil con ubicación, descripción y fotos reales. Proponer reserva directa por formulario/calendario reutilizando la lógica transaccional existente. Medir reservas completadas y fallos. | Directorio global, clasificación, reseñas y comisión. El QR/enlace es un sustituto suficiente para la captación inicial. |
| V2: catálogo local piloto | Publicación voluntaria y revisión básica; ciudad/zona, categoría, nombre y servicios; lista paginada y perfil explorables sin sesión, con Google al confirmar una reserva. Esto requiere cambiar la experiencia actual, que pide Google antes del perfil. Pilotar en una zona y categoría con negocios realmente operativos. Medir búsqueda → perfil → inicio → cita confirmada, resultados vacíos y consultas fuera de cobertura. | Mapa avanzado, cercanía exacta y promesas de disponibilidad global en tiempo real. No hay fecha comprometida sin acordar alcance. |
| V3: marketplace y retención | Añadir búsqueda por fecha/disponibilidad donde pueda calcularse de forma fiable; reprogramación, recordatorios y reseñas de citas completadas con moderación. Definir ordenamiento transparente y medir asistencia/repetición. | Billetera, reparto automático de fondos, productos, membresías y nómina no son necesarios para validar descubrimiento. |
| Expansión de pagos | Solo después de demanda real: estudiar proveedor para Colombia, anticipos, devoluciones, conciliación y costos. Mantener separados el cobro de Sarin al negocio y el cobro del negocio al cliente. | No activar comisiones de marketplace por imitación. No custodiar tarjetas o saldo desde el código de Sarin. |

El plazo del primer incremento debe estimarse después de elegir si incluye reserva directa, fotos y ubicación o solo el catálogo. Este informe no compromete fechas ni incorpora esas funciones al alcance autorizado actual.

Para empezar, recomiendo mantener la suscripción de Sarin como ingreso principal y ofrecer el directorio como piloto del producto. Una comisión de adquisición solo tendría sentido si se demuestra que Sarin aporta clientes nuevos y puede justificar su atribución. Los destacados patrocinados necesitarían identificarse como publicidad y no confundirse con calidad o disponibilidad. Son opciones de monetización futuras, no cargos autorizados.

El presupuesto de alojamiento sigue siendo el objetivo existente de USD 15 mensuales. El catálogo no requiere por sí mismo una VPS ni otro proveedor: primero debe medirse el costo incremental de consultas D1, imágenes/tráfico R2 y actividad del contenedor. No se puede garantizar que el volumen de un marketplace quede dentro de ese importe usando solo el volumen inicial del proyecto.

## Límites de esta revisión

### Recorrido interactivo observado

En la pestaña de registro que el propietario ya tenía abierta, se revisaron los pasos de nombre comercial («Barberia norte»), categoría principal y relacionadas, tamaño del equipo y modalidad de atención. Se seleccionaron Barbería y profesional independiente para explorar las pantallas siguientes. El paso de modalidad mostró presencial, domicilio y virtual; no se completó la dirección ni la publicación. No se finalizó el alta, no se aceptaron acuerdos, no se contrató un plan ni se hizo un pago o reserva en Fresha. Esto confirma la separación de pasos del onboarding, sin acreditar el funcionamiento de una cuenta comercial terminada.

Se consultaron únicamente fuentes oficiales públicas y archivos locales del proyecto. No se validó un negocio real ni una cuenta comercial colombiana de Fresha; tampoco se verificaron pagos, facturación final, resultados del algoritmo de ranking o una reserva completa autenticada. Las funciones anunciadas no prueban su disponibilidad para todas las regiones o cuentas. La propuesta de fases y métricas es inferencia de producto para Sarin; no una afirmación de crecimiento garantizado por copiar Fresha.
