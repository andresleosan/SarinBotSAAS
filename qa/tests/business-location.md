# Ubicación y modalidad del negocio

Tercer incremento de la secuencia autorizada. Los pasos de próxima fecha disponible y descarga de calendario están publicados; runtime de partida `ba34b40`, Containers v16.

## Contrato y alcance

Campos opcionales publicados por el propietario: modalidad en el local, a domicilio o en línea; dirección presencial de hasta 200 caracteres e indicaciones de hasta 500. Sin publicar oculta la sección. Dirección no aplicable a las otras modalidades. El enlace Cómo llegar se genera con la dirección y abre Google Maps al pulsarlo; sin mapas incrustados, geolocalización, claves o consultas automáticas a terceros.

El servidor valida el objeto, conserva el dato si un cliente anterior omite location y permite quitarlo con null. La proyección pública utiliza campos permitidos y omite datos históricos malformados. Es un campo JSON opcional, sin migración SQL; reversión compatible a la imagen actual.

## Pruebas

1. Schema: modalidades, límites, controles, texto vacío, propiedades desconocidas, dirección no presencial y codificación segura del mapa.
2. Persistencia: propiedad exclusiva del dueño, decisiones y suscripción actuales, preservación por omisión, eliminación explícita y escritura atómica de las proyecciones.
3. Ficha anónima y autenticada: modalidad/dirección/indicaciones correctas; ausente o malformada no muestra una tarjeta vacía; texto se presenta sin interpretar HTML.
4. Configuración: hidratación, guardado, cambio de modalidad, quitar publicación, borrador del asistente que omite ubicación y polling que no sobrescribe cambios sin guardar.
5. Emuladores oficiales demo-sarin-bot: propietario y negocio sintéticos, guardados reales solo de ubicación, lectura pública independiente y captura guardada con verificación de deltas antes de limpiar.
6. Móvil 320×740 y 390×844 y escritorio: controles de 44 px, foco, textos largos y ausencia de desbordamiento.
7. Revisar red: no peticiones a Google antes de pulsar el enlace, no inferencia/propuestas/citas nuevas durante estos controles.
8. Limpiar solo registros propios, conservar Auth/decisiones compartidas, detener procesos propios y restaurar viewport/sesión real.

## Publicación

Congelar la revisión, construir y auditar imagen y reversión, ejecutar humo sin red/credenciales, comprobar instancia actual/cola y publicar con mantenimiento/drenaje. Verificar una instancia efectiva, cero antiguas, HTTP, iconos y autenticación. No configurar una dirección real ni aceptar consentimientos o crear citas reales para fabricar cobertura visual.

Fuente del formato del enlace: [Google Maps URLs](https://developers.google.com/maps/documentation/urls/get-started).
