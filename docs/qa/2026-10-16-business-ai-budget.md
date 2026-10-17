# Presupuesto de IA por negocio — aceptación local

Runtime **`205a771`**, sobre `49895c2`, rama `codex/commercial-pilot-20261016`. El propietario aceptó los límites iniciales con la condición de observar el consumo individual y subir los topes desde administración. **Implementado localmente; no publicado ni activado en producción.** Esta aceptación de presupuesto no autoriza un despliegue.

## Resultado

El nuevo apartado de `/admin` permite seleccionar un negocio, ver sus contadores autoritativos de hoy/mes y compararlos con el fondo global. Distingue importe registrado y reservado, muestra tokens, margen calculado y período en Colombia. Mantiene el historial mensual por proveedor separado: su telemetría es informativa y no se utiliza para inventar saldo del presupuesto.

Se puede guardar una excepción diaria/mensual en USD con motivo, o restaurar los valores generales. El presupuesto global y los límites de tokens siguen aplicándose. El formulario general permite editar expresamente esos otros topes y la pausa global; no suben automáticamente al cambiar un negocio. Los valores iniciales aprobados son USD 0,50/día y USD 8/mes globales, USD 0,10/día y USD 2/mes por negocio.

No se reinician consumo, llamadas, cuotas de respuestas ni importes pendientes de conciliación. Un cambio afecta a reservas de gasto nuevas; las llamadas en curso mantienen su reserva original. La cifra es contabilidad conservadora de Sarin, no una factura ni garantía de capacidad para todos los paquetes. El margen monetario positivo no garantiza admisión: también se reserva el importe de la próxima llamada y se aplican los límites diarios/mensuales de tokens.

## Contrato y protección

- `GET /api/admin/abuse?businessId=<id>` devuelve una lectura consistente del negocio, configuración, excepción y cuatro períodos. Rechaza parámetros repetidos, mezclados con `cursor` o ajenos; autenticación y superadmin en API y dominio. El GET anterior y su paginación de llamadas se conservan.
- `PATCH /api/admin/abuse`, `action: configure_business`: `{businessId, expectedVersion, expectedSettingsVersion, limits: {businessDayUsd, businessMonthUsd} | null, reason}`. Verifica negocio existente y versión tanto de base como de excepción dentro de una transacción. Obtiene actor/fecha en servidor. Conflictos: 409, entrada inválida: 400, no administrador: 403.
- Excepción privada: `serverSettings/pilotAiBudgetBusiness_<sha256(businessId)>`. Ausencia o `limits:null` hereda. Restaurar mantiene documento y versión, evitando reutilizar una edición antigua. La última modificación conserva motivo, actor y fecha; no se presenta como un historial completo de todas las ediciones.
- La admisión lee configuración, excepción y los cuatro contadores en la misma transacción, antes de fetch pagado. Registro corrupto o asignado a otro negocio falla cerrado. No hay migración SQL, protocolo público nuevo, dependencia nueva ni escritura de producción.
- Mantenimiento conserva únicamente el GET exacto autenticado por `businessId` adicional a las excepciones ya existentes; no abre chat ni otros parámetros. Next vuelve a comprobar superadmin.
- La UI se remonta por UID y negocio, descarta lecturas tardías y comprueba el UID antes de enviar. Un error de guardado desactiva la edición hasta actualizar: no presupone que un cambio con respuesta perdida haya fallado. Consultar de nuevo no reinicia el consumo.

## Evidencia

| Comprobación | Resultado |
| --- | --- |
| Suite completa final | **838 aprobadas / 25 omitidas**, 95 archivos aprobados y cuatro omitidos, salida 0. |
| Dominio y D1 focalizados | Doce pruebas aprobadas, incluidas las cinco nuevas de dominio y dos nuevas sobre Workerd/D1 con dos handles. Se cuentan también dentro de la suite completa. |
| UI focalizada | Veinte pruebas aprobadas entre panel nuevo, controles de IA e historial; tres son nuevas del presupuesto. No sumarlas al total anterior. |
| API | Dos pruebas aprobadas, incluida la nueva de lectura/cambio individual, exclusión de consultas y autorización. |
| Worker | **73 aprobadas**, TypeScript y dry-run sin construir/desplegar contenedores correctos; salida 0. Incluye 24 de router. |
| Aplicación | TypeScript final y build Next correctos, salida 0. |
| Revisión independiente | Sin hallazgos accionables en autorización, CAS, D1, herencia/corrupción, aislamiento, respuestas inciertas y contabilidad. |
| Chrome real | Administrador de `demo-sarin-bot` en loopback, dos negocios sintéticos, aumento individual, persistencia en pestaña nueva, aislamiento, restauración y cambio global explícito/restaurado. |
| Móvil | Viewport 390 × 844; documento 375 px, sin desbordamiento horizontal. Captura real y viewport restablecido. |

Los tests nuevos fallaron antes de implementar los exports/endpoint/UI y la excepción del router; luego pasaron. La primera suite completa falló cinco casos del panel WhatsApp porque su mock aislado de Auth no incluía `useAuth` al montar el componente nuevo. Se aisló ese componente en la prueba específica de WhatsApp, conservando todas sus aserciones; pasaron sus cinco casos y la suite completa. No se modificó Auth de producto para hacer pasar el fixture.

QA visual con datos sembrados únicamente en los emuladores. Barbería: USD 0,02 registrado y USD 0,03 reservado hoy, USD 0,20 + 0,03 del mes. Se aumentaron sus topes de 0,10/2 a **0,25/3** sin cambiar esos contadores ni el otro negocio; después se restauraron. La lectura independiente del emulador verificó excepción versión 2 con `limits:null`, contadores intactos y ningún override para el otro negocio. El presupuesto global se ensayó **8 → 9 → 8 USD/mes**, quedando en versión 3. Ninguno de esos valores representa gasto real.

- [Consumo y límites personalizados en escritorio](2026-10-16-business-ai-budget-desktop.jpg).
- [Controles de edición en escritorio](2026-10-16-business-ai-budget-controls.jpg).
- [Controles con viewport de 390 px](2026-10-16-business-ai-budget-mobile.jpg).

El proveedor de capturas entrega JPEG: archivos de escritorio 1764 × 885 y móvil 375 × 812. La prueba de responsive usa el viewport documentado 390 × 844, comprobado en DOM; las dimensiones del archivo entregado difieren de las del viewport. Se verificaron formato real y dimensiones, sin editar las imágenes.

El runner local fuerza la compuerta monetaria en `false` y desconecta proveedores pagados; por eso se muestra el aviso de control inactivo. La aplicación del límite y su concurrencia se prueban mediante dominio/D1 y las regresiones existentes de motor antes de fetch, no mediante gasto real en el navegador. Cero llamadas pagadas o datos reales de niños/pacientes. Los errores de captura CDP en pestañas anteriores se resolvieron con pestañas nuevas y capturas normales; las capturas guardadas y dimensiones móviles se comprobaron. La consola de la pestaña de comprobación no mostró errores de aplicación.

Se cerraron Next y Auth/Firestore/hub locales al terminar, verificando que no quedaran listeners en 3042/8080/9099/4400. Logs privados en `.superpowers/sdd/2026-10-16-business-ai-budget/`: `domain-red.log`, `domain-green.log`, `route-red.log`, `route-green.log`, `ui-red.log`, `ui-green.log`, `worker-red.log`, `worker-green.log`, `all-tests.log`, `all-tests-final.log`, `cloudflare-check.log`, `typecheck-final.log`, `build.log` y `browser-readback.json`.

La revisión separó tres asuntos que no afirma resolver: el diseño de salud/representación, activación/facturación reales y telemetría histórica ajena al cambio. La separación es correcta: están documentados como diseño o pendientes, y el contador del presupuesto usa sus propios períodos persistentes.

## Publicación y reversión

Se construyó una imagen nueva desde el archivo Git exacto de `205a7717b06981210e18751bad63d22e724a8ff9`: **`sarin-bot:pilot-205a771`**, ID **`sha256:6a7101665c2388e80d18e925f73169b27581ce5097c4210cdb7c669c9026a7ad`**, Linux/amd64, **79.692.719 bytes**. Archivo fuente SHA-256 `b261c8533ab8f76fb656406f922eab0c10fbbfed409e2b2c55bf02abc3444572`. [Manifiesto actual](2026-10-16-business-ai-budget-release.json). La comprobación del contenedor sin red externa y con archivos de solo lectura pasó: Sharp nativo, sesión 401, términos/privacidad y documentos 200, origen canónico afirmativo 200, origen ajeno 403, decisión incompleta 400 y constancia sin autenticación 401. Sin Auth/D1 reales; el smoke no sustituye el rollout. El build usa red para dependencias, el smoke no.

La imagen anterior de consentimiento no incluye el panel ni la lectura de excepciones. Para publicar se requiere también Worker de esta revisión. Mantener una instancia, origen canónico, respaldo recuperable y secuencia de configuración/activación bajo mantenimiento. Conservar excepciones, versiones, períodos y reservas inciertas en backups y rollback; no reabrir una imagen que ignore el contrato de consentimiento/confirmación ni descartar ajustes individuales para encajar datos antiguos.

Conservación/proveedores siguen pendientes. El propietario incluyó salud/menores y delegó los casos reales: el [diseño de ese flujo](../superpowers/specs/2026-10-16-health-and-represented-booking-design.md) está listo para revisar, **sin implementación ni promesa de que las autorizaciones generales lo cubran**.
