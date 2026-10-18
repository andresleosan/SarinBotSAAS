# Lista de espera dentro de Sarin

Estado: alcance autorizado con «ok seguir», sobre el incremento de recordatorios publicado en v19. Se mantiene la autorización de implementar, probar y publicar cada incremento antes del siguiente. Base documental `711dab5`; runtime productivo `ed28549`.

## Recorrido aprobado y decisiones

Cuando una consulta correcta del calendario no encuentre horarios para el servicio, día de Colombia y profesional elegidos, el cliente podrá pulsar «Apuntarme a la lista de espera». La primera entrega admite **una solicitud activa por cuenta y negocio**; cambiarla requiere salir explícitamente o esperar a que venza. Este límite mantiene la función comprensible y acota el almacenamiento privado.

«Mis citas» mostrará la solicitud independientemente de sus pestañas, con servicio actual, día y profesional o «Cualquiera disponible». Se comprueba al abrir la sección y mediante «Comprobar horarios». No habrá sondeo adicional, mensajes externos, alarma con la app cerrada, orden de prioridad, exclusividad ni reserva automática. Texto: «Consulta aquí si aparecen horarios. El horario se reserva cuando confirmas una cita».

Si aparecen horarios, «Elegir horario» abre un caso nuevo del calendario conservando servicio, fecha, profesional y condición propia/representada. No conserva hora, nombre del beneficiario, contacto, preguntas ni consentimientos del caso anterior. Continúa por los controles actuales, precio vigente, resumen y confirmación. La solicitud permanece hasta salir explícitamente o finalizar el día solicitado; abrir o confirmar una reserva no la elimina ni se infiere su cumplimiento por otra cita parecida. La interfaz explica esta permanencia.

Estados: cargando, sin solicitud (solo tras lectura correcta), esperando, horarios disponibles, suspendida, vencida, guardando, saliendo y error con reintento. Un fallo de lectura nunca significa agenda llena. «Salir de la lista» permanece disponible aunque ya no se permitan nuevas reservas. El control de operaciones de reservas, cambios, cancelación y exportación impide acciones simultáneas incompatibles.

## Contrato y almacenamiento

Archivo compartido `src/types/waitlist.ts`. DTO:

```ts
type WaitlistState = {
  businessId: string; ownerUid: string; revision: number; serverNow: number;
  request: WaitlistRequestView | null;
};
type WaitlistRequestView = {
  id: string; serviceId: string; dateKey: string; resourceId: string | null;
  subjectKind: 'self' | 'represented_minor';
  representativeRole?: 'parent' | 'legal_guardian';
  createdAt: number; expiresAt: number;
  status: 'waiting' | 'available' | 'suspended' | 'expired';
  reason?: 'consent_changed' | 'booking_policy_changed' | 'business_unavailable'
    | 'client_blocked' | 'client_limit' | 'service_unavailable';
  checkedAt: number | null;
};
```

GET `/api/businesses/[id]/waitlist` devuelve el DTO. POST en la misma ruta recibe `{ requestId, expectedRevision, case: BookingSubjectCase, serviceId, dateKey, resourceId? }`. POST `/waitlist/cancel` recibe `{ requestId, expectedRevision, entryId }`. Cuerpos estrictos sin UID aportado; identidad de sesión, `no-store`, errores explícitos. Funciones `readWaitlist(user,businessId,db?)`, `joinWaitlist(user,businessId,input,db?)`, `cancelWaitlist(user,businessId,input,db?)`.

Documento privado determinista `businesses/{businessId}/waitlistRequests/{stableDocumentId('waitlist', businessId, uid)}`: versión 1, ownerUid, businessId, revisión monotónica, updatedAt, request y lastOperation `{requestId,operationHash,appliedRevision}`. La solicitud guarda selección, caso mínimo, fechas y anclas verificadas de permisos account/business/subject y revisión de política. ID de entrada determinista a partir de negocio, UID y requestId. Ningún nombre, teléfono, respuesta libre o cuerpo de conversación.

Join valida fecha real desde hoy hasta 366 días en Colombia, clasificación/política de preguntas, permisos de cuenta/negocio/caso, negocio listo, suscripción, bloqueo/límite del cliente, servicio y profesional vigentes. Una transacción comprueba todos los requisitos y la disponibilidad del día sin truncar citas confirmadas. Si hay huecos: 409 `WAITLIST_SLOTS_AVAILABLE`. Si existe una solicitud no vencida: 409 `WAITLIST_REQUEST_EXISTS`; incluye suspendidas. Solo un alta explícita sustituye una solicitud vencida. Se limita admisión de altas con el mecanismo existente, sin IA ni consumo de cuota de citas.

GET es transaccional y no escribe. Una solicitud vencida no consulta horarios. Permisos/política/negocio/catálogo/restricciones no vigentes suspenden disponibilidad; corrupción produce 503. Compara todas las anclas verificadas: retirar y reaceptar permisos no reactiva una solicitud antigua. Cancel exige propiedad, revisión e ID, pero no negocio existente, suscripción ni permisos activos. Al cancelar elimina selección/caso y conserva el documento vacío con revisión y última operación, para impedir ABA/reaparición.

Reintento exacto de la última operación devuelve la proyección actual sin escribir; mismo requestId con contenido diferente o revisión antigua produce conflicto. Una operación antigua nunca resucita una entrada cancelada o reemplazada. Respuesta incierta en cliente se resuelve con GET, sin repetir automáticamente la intención. Toda respuesta y callback se vincula a UID, negocio y caso; cambios de ámbito descartan respuestas tardías, incluso A→B→A.

## Compatibilidad, conservación y coste

Nueva colección privada admitida por el protocolo D1; reglas de Firestore mantienen denegado el acceso directo. Lectura puntual de un documento por cuenta/negocio y consulta existente de citas del día; no se necesita un índice SQL nuevo por diseño. Se medirá D1 real con historial para confirmar el coste y no inventar huecos por límites. No se altera Appointment, sus fingerprints, propuestas ni transacciones de confirmar/cambiar/cancelar citas. v19 puede ignorar los documentos nuevos; reversión conserva datos.

Vencimiento al finalizar el día de Colombia es un estado derivado, no TTL. Sin purga automática. Una cancelación retira inmediatamente selección y caso, conservando tombstone mínimo; un alta tras vencer sustituye la selección anterior. El procedimiento privado de exportación/eliminación por cuenta o negocio incluirá estos documentos y se ensayará preservando vecinos. No se asocia eliminación de una cita a una solicitud no vinculada.

Sin proveedores nuevos, correo, SMS, push ni inferencia. Una comprobación al montar/actualizar, sin sondeo adicional. El consumo depende de consultas explícitas y altas/bajas; no se promete importe o ahorro sin medición.

## Validación y publicación

Pruebas de autorización cruzada, reglas privadas, fechas/reloj, filtros exactos, salud/menores, revocar/reaceptar, permisos suspendidos, cancelación sin negocio/permisos, duplicados/revisiones/ABA, pérdida de respuesta, corrupción y D1 real concurrente. UI: resultado vacío vigente, cambios de selección/ámbito, mutex, reanudación con caso nuevo sin datos personales, catálogo cambiado, teclado y anchos 320/390/1280. Fixture aislado demo-*; limpieza solo de sus datos.

Revisión independiente, suite aplicable y build de imagen congelada. Paquete v19 inmutable, nueva reversión compatible, instancia única y cola drenada para publicación. Verificación HTTP/navegador productiva sin aceptar consentimientos ni crear reservas reales para QA. Se documentarán límites de observación.

## Referencias

Guías oficiales consultadas durante la exploración: [configuración de lista de espera](https://www.fresha.com/help-center/knowledge-base/calendar/259-set-up-and-manage-your-waitlist), [gestión de entradas](https://www.fresha.com/help-center/knowledge-base/calendar/101629-manage-waitlist-entries-1), [actualizaciones](https://www.fresha.com/help-center/knowledge-base/calendar/169-send-waitlist-updates). La consulta dentro de Sarin es una adaptación propia; no se atribuye a Fresha una reserva silenciosa.
