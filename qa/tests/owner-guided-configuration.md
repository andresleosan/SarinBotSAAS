# Protocolo de configuración guiada del dueño

Este documento define comprobaciones reproducibles; **no registra resultados ejecutados**. Guardar resultados, fallos, omitidas, capturas y limitaciones en un reporte de ejecución separado. Base funcional: [diseño](../../docs/superpowers/specs/2026-10-22-owner-guided-configuration-design.md) y [plan](../../docs/superpowers/plans/2026-10-22-owner-guided-configuration.md).

## Preparación y aislamiento

1. Trabajar desde una fuente reconciliada y un worktree aislado. Registrar HEAD, `git status --short`, fecha, sistema operativo y versiones. Usar Node 24, pnpm 11.23.0 y Java 21 o posterior. Preservar el lockfile.
2. Instalar con `pnpm install --frozen-lockfile` si hace falta. No añadir dependencias, endpoints, flags ni cambios de backend para facilitar el ensayo.
3. Ejecutar comprobaciones automatizadas con el demo detenido. Para navegador, iniciar `pnpm run dev:local --port 3042`. Este launcher prepara Auth y Firestore oficiales en loopback, proyecto **demo-sarin-bot**, sin credenciales Firebase reales. Requiere libres los puertos 3042, 8080, 9099, 4400 y 4500.
4. Abrir `http://127.0.0.1:3042`, comprobar la banda de entorno local y usar las cuentas emuladas. No ejecutar este protocolo en producción. No usar inferencia remota, pagos, invitaciones reales ni datos de clientes/pacientes/menores.
5. Inventariar cuentas y documentos sintéticos propios antes de modificarlos. Preparar, mediante las herramientas locales existentes o un fixture temporal identificado, un negocio inicial con acceso comercial, uno general configurado, uno de salud y uno general habilitado para menores representados. Conservar también un negocio sin acceso y uno con invitación local suspendida. Las cuentas sembradas por el launcher no implican que estos negocios ya existan.
6. Preparar servicios, recursos, preguntas con IDs conocidos y siete días cerrados; incluir descripción/categoría de servicio, redes y ubicación opcionales. Usar un logo sintético válido. En salud, conservar tono/reglas históricos sintéticos para comprobar que ocultar campos no los borra. No configurar datos clínicos.
7. Registrar los medios utilizados para cada fixture y simulación. Un transporte interceptado debe limitarse al origen loopback y a solicitudes del ensayo, sin alterar archivos del producto. Si no existe ese medio, marcar el escenario de red controlada como **no ejecutado en navegador** y vincular su prueba automatizada; no atribuirle observación visual.

## Comprobaciones automatizadas

Ejecutar los comandos secuencialmente desde la raíz y registrar salida y código de salida:

```powershell
node --version
pnpm --version
java -version
pnpm exec vitest run tests/owner-configuration-model.test.ts tests/owner-configuration-provider.test.tsx tests/owner-configuration-workspace.test.tsx tests/owner-guided-configuration.test.tsx tests/onboarding-assistance.test.tsx tests/business-location-onboarding.test.tsx tests/business-branding-ui.test.tsx tests/schemas.test.ts tests/businesses.test.ts tests/booking-data-policy.test.ts --configLoader runner --maxWorkers 2
pnpm test --configLoader runner --maxWorkers 2
pnpm run typecheck
pnpm run build
```

Conservar fallos anteriores y omitidas reales. No sumar focal y completa como pruebas distintas ni sustituir build por tipos. Si el entorno requiere cachés externas, ajustes de TEMP/TMP o copia física por dependencias enlazadas, documentar los ajustes y la identidad de la fuente exacta, sin copiar secretos. No aumentar plazos ni filtrar la suite completa para obtener un pase.

Con el demo activo, las comprobaciones locales existentes son complementarias:

```powershell
pnpm run test:local --port 3042
pnpm run test:journey --port 3042
```

Estas pruebas no reemplazan el recorrido manual ni demuestran por sí solas los casos de transporte controlado de este protocolo. Contrastar las pruebas de modelo, provider, workspace e integración con las reglas siguientes: proyección completa y IDs, autoridad revocable, scopes UID/época/negocio, plazo GET de 10 s, aviso POST a los 20 s, comando pendiente/incierto, asistente optativo y logo separado.

## Recorrido de navegador: alta y edición

Usar Network con registro de solicitudes y el DOM visible para distinguir GET de POST. Sanear la evidencia; no guardar cabeceras Authorization, tokens, cuerpos de conversaciones ni exports privados.

| Caso | Pasos y criterio observable |
| --- | --- |
| Entrada y autoridad | Abrir `/dashboard/onboarding` con un negocio permitido. Retener el GET propio de entrada, además del poller si hace falta: antes de resolverlo no deben aparecer borrador, editor, logo ni conversación. Liberar una respuesta válida del dueño y comprobar que se abre la vista correspondiente. La caché previa no basta. |
| Alta manual, etapa 1 | Con `onboardingCompleted=false`, elegir **Configurar manualmente**. Completar nombre, categoría, enlace y WhatsApp. Abrir detalles opcionales solo cuando se necesitan; comprobar modalidad, dirección y redes. Nombre deriva slug solo durante alta y el slug sigue editable. Introducir una URL opcional inválida: Continuar debe informar y mostrar su campo. Escribir el slug no lo reserva. |
| Alta manual, etapa 2 | Continuar por Personas o estaciones → Servicios → Horarios, una subsección visible cada vez. Completar nombres, precio COP, duración y preparación en minutos y relación servicio/recurso. Atrás y Continuar conservan campos e IDs y no envían POST. Probar todos los días cerrados como caso válido y un intervalo cruzado como error. |
| Alta manual, etapa 3 | Abrir Revisión y guardado. Comprobar resumen de identidad, ubicación, recursos, servicios y horarios y el aviso de que al guardar los datos aparecerán en la página de reservas. Una sola acción Guardar configuración envía el payload agregado completo. No debe haber Guardar borrador/Publicar separados. Verificar éxito y efecto público con datos sintéticos; guardar no activa WhatsApp, crea otro negocio ni inicia un cobro. |
| Error oculto | Preparar una referencia inválida de servicio/recurso mediante fixture controlado o un valor inválido en una sección distinta. Pedir revisión: debe revelar la sección pertinente y permitir llegar al campo/aviso con foco. No aceptar un resumen que esconda el error. |
| Negocio configurado | Entrar a Mi negocio; abrir Datos y contactos, Servicios y recursos, Horarios y Cómo responde Sarin. Cambiar solo precio de un servicio. Revisar y guardar: conservar IDs, recursos, horario, metadatos, preguntas y demás campos sin editar. El enlace configurado es readonly. |
| Descarte | Modificar varias secciones. Cancelar edición abre confirmación inline; Continuar editando conserva cambios. Descartar cambios de configuración restaura la última configuración observada sin POST. Comprobar que cambiar de sección conserva el borrador antes del descarte. |
| Metadatos opcionales | Editar y luego borrar descripción/categoría, redes o ubicación. Guardar explícitamente y comprobar vacíos/null permitidos. Una propuesta que omite metadatos conserva los valores locales, incluidos borrados explícitos. Reordenar servicios no debe asignar metadatos por índice. |
| Gates comerciales | Sin pago/invitación vigente, mostrar explicación y enlace a pagos, sin editor ni conversación activos. Contrastar prueba pagada e invitación local válidas, prueba agotada e invitación suspendida. Conservar límites y texto de acceso; no canjear invitaciones reales para el ensayo. |
| Consentimiento y política | Retirar o dejar pendiente el consentimiento sintético: los comandos agregados quedan bloqueados sin borrar borrador. Una política no lista/fallida muestra estado y reintento y no monta editor activo ni IA. Probar recuperación de lectura. El default general válido puede tener `configured=false`; no confundirlo con lectura fallida. |

## Memoria, concurrencia y respuestas tardías

1. Editar nombre y precio, quedar en Servicios y navegar a otro módulo por un enlace de la aplicación. Volver con **Atrás** y después usar **Adelante/Atrás**. Cada reentrada exige un GET nuevo antes de mostrar contenido privado; tras verificar la misma autoridad, recuperar el borrador y la sección. Confirmar ausencia de POST por navegar. No afirmar recuperación tras recargar o cerrar la pestaña.
2. Con borrador sucio en vista A, cambiar la configuración publicada en una segunda vista local B y guardar B. Esperar la observación en A: mantener su borrador y mostrar actualización externa. Guardar directo queda bloqueado. Cargar la configuración actual exige confirmación de descarte; probar también conservar el borrador, revisar diferencias por secciones y la acción explícita de guardar la configuración completa sobre la actual.
3. Después de revisar un snapshot externo, publicar otro cambio desde B antes del preflight de A. El GET previo al POST debe detectar el nuevo fingerprint y exigir revisión nueva; una revisión antigua no autoriza sobrescribirlo. Un caché viejo inicial o cambio exclusivo de logo no debe crear ese conflicto.
4. Cambiar de cuenta/época de autenticación y volver a la ruta: ningún valor ni callback del dueño anterior debe aparecer en la nueva sesión. Una respuesta retenida de la cuenta anterior no puede poblarla.
5. Con la misma UID/época/ID y caché anterior, interceptar el GET propio con 403 de propietario, `business:null` o propietario distinto. El controller/logo/asistente desaparecen y el borrador/comando se purgan. Repetir con POST propio y con una lectura de resultado iniciada antes de salir de la ruta. Liberar después una respuesta antigua exitosa: no puede reconstruir la generación revocada. Una verificación positiva posterior comienza desde la configuración actual.
6. Simular red caída/timeout GET y un mensaje opaco de error del poller conservando su caché. La vista se protege; no interpreta códigos dentro del texto. Reintentar verificación realiza GET propio tipado y refresh del poller. Una lectura propia positiva con error del poller aún pendiente no expone contenido privado; tras recuperarse ambos, se conserva el borrador protegido. El GET tiene deadline de 10 s con cleanup.
7. Distinguir 402 comercial, consentimiento pendiente y validación definitiva de una pérdida de propiedad: conservan borrador y explican la condición. El servidor conserva la comprobación final de permisos; no simular autorización modificando el cliente.

## POST lento A, consulta coincidente y barrera de escritura

Este caso necesita transporte local controlado con capacidad de mantener pendiente **la misma promesa POST**; una pausa de animación o throttle sin control no demuestra el contrato.

1. Preparar A válida y guardar. Dejar completar su GET previo y retener la respuesta de su único POST. Registrar número de POST y payload A sin secretos.
2. A los 20 s comprobar el aviso de espera. El POST original sigue pendiente y su señal no está abortada; no hay POST de reemplazo ni otro comando. Navegar a otro módulo y volver conserva la operación, tras verificar autoridad nuevamente.
3. Elegir Consultar configuración actual y devolver por GET exactamente la proyección configurable de A, excluyendo logo/suscripción. Debe mostrar coincidencia sin afirmar guardado completado. La fase sigue saving y el comando A conserva su payload/fingerprint.
4. Intentar editar/aplicar propuesta, descartar, cargar configuración externa o enviar B. Ninguna acción debe retirar la barrera ni producir un segundo POST. La navegación y consulta de lectura siguen disponibles. El logo conserva su operación propia.
5. Resolver finalmente la respuesta del **POST A original** con Business válido del mismo dueño/negocio: solo esta respuesta permite saved, retira la barrera y pide refresh una vez. Un GET coincidente anterior no lo hacía.
6. En otra sesión de ensayo, repetir hasta la consulta coincidente y rechazar realmente el transporte POST A o devolver 5xx/respuesta no verificable. Debe quedar uncertain, conservar A y explicar que se puede consultar pero no guardar otra vez desde esa sesión de memoria. Otro GET coincidente sigue sin promover saved ni habilitar B.
7. Repetir consulta GET con una configuración diferente: mostrar diferencias sin deducir que A falló o terminó. La consulta usa un controlador separado y no aborta el POST. Revocar realmente la autoridad sí oculta/purga y aborta sus controladores, sin prometer deshacer una escritura que pudo llegar al servidor.
8. Con cambios, POST pendiente o resultado incierto, intentar salir/recargar mediante el mecanismo nativo: registrar si el navegador muestra beforeunload. No afirmar que garantiza bloqueo ni persistencia. No recomendar recargar/cerrar como recuperación segura o segundo envío garantizado.

## Asistente, salud, menores y logo

- Entrar y completar el camino manual sin montar una conversación. En general, elegir Preparar con Sarin explícitamente; debe ocupar el ancho de la tarea. Para probar propuesta, usar únicamente un stub local identificado y sin inferencia externa. Revisar diferencias antes de Usar propuesta en el borrador; aceptarla copia al borrador y abre revisión sin POST. Cambiar el borrador después del preview obliga a revisar de nuevo. Error/cuota conserva el formulario y no provoca reintento automático. Salir del asistente desmonta/aborta su conversación conforme al hook existente.
- En salud, conservar configuración manual, ocultar conversación y editores de tono/reglas. Guardar excluye preguntas libres incompatibles y preserva valores históricos de tono/reglas sin activar su uso. En general con menores representados, excluir intake restringido según política. No usar datos reales de pacientes o menores. El futuro slot de alcance informativo no se considera implementado por este incremento ni se inventan capacidades del asistente.
- Con un borrador agregado sucio, abrir Logo, seleccionar un archivo sintético y cambiar de sección: la instancia se conserva montada/hidden/inert dentro de esta ruta. Guardar/eliminar logo usa su operación y hash propios; no envía el POST agregado, no reemplaza el borrador ni crea conflicto de configuración por sí solo. Cancelar configuración no revierte logo guardado. Al salir de la ruta no prometer conservación de una selección de archivo sin guardar.

## Presentación y accesibilidad real

Repetir alta y edición de servicio a **320, 390 y 1280 px** de ancho y a **zoom 200 %**; registrar tamaño y método de zoom. Revisar visualmente capturas saneadas, no solo snapshots de DOM.

Comprobar Tab/Shift+Tab, Enter/Espacio, foco visible, orden coherente, foco de validación, apertura de detalles que contienen errores, etiquetas y unidades; controles de al menos 44 px y ausencia de desbordamiento horizontal. La tarea visible conserva espacio para campos largos y botones. Paneles ocultos y logo oculto no reciben foco. Confirmaciones inline permiten continuar sin pérdida. Verificar diferencias, avisos de error/espera y revisión en pantalla estrecha; no afirmar anuncio de lector de pantalla si no se ensayó con uno.

## Evidencia y cierre

Registrar cada caso con estado **pasó / falló / no ejecutado**, entorno, acción, resultado observado y evidencia. Distinguir pruebas automatizadas, navegador con datos reales del emulador, navegador con respuestas interceptadas y casos no observados. Un pase local no demuestra CI remota ni runtime desplegado.

El POST existente no ofrece CAS agregado ni estado durable de operación: entre preflight y escritura puede entrar otra edición. No prometer eliminación de esa carrera, idempotencia de servidor, recuperación durable o resolución de uncertain por GET coincidente. Borrador y barrera viven en memoria de una pestaña; un rollback de UI no deshace configuración o logo ya guardados.

Cerrar pestañas y procesos propios; detener dev:local con Ctrl+C y limpiar únicamente fixtures inventariados de esta ejecución, preservando cuentas sembradas y datos ajenos. Este protocolo no despliega ni modifica flags, canales, dependencias o backend.
