# Prueba pagada de diez citas

Decisión del propietario, 16 de octubre de 2026: sustituir los siete días gratuitos por un pago único de **5.000 COP** que habilita configurar un negocio y crear **diez citas**, sin límite de días. Después se necesita un plan. La activación usa el proceso de revisión de comprobantes existente, sin pasarela nueva ni cobros automáticos.

## Estado y contratos

Actualización del piloto aprobado: el acceso introductorio también puede regalarse mediante una invitación administrativa individual. El canje con Google verificado habilita el mismo límite de diez citas y 700 respuestas sin cobro ni vencimiento por días; no crea recibo ni referencia de pago. Esta excepción sustituye el requisito de pago aprobado de los párrafos siguientes cuando el origen es `invitation`.

El código está ligado al correo normalizado, admite un solo canje y vence a los siete días por defecto (configurable de uno a treinta antes de emitir). Solo se muestra completo al emitirlo y no se puede recuperar; si se pierde, revocar y emitir otro. El vencimiento del código no vence una cortesía ya activada. Un comprobante pendiente debe resolverse antes del canje. No se permite una segunda prueba ni reemplazar historial pagado.

Administración distingue revocar un código sin usar de suspender/reactivar cortesía con motivo y control de versión. La suspensión conserva consumo y lectura/cancelación; reactivar no devuelve citas ni respuestas. Un plan pagado vigente prevalece sobre la suspensión de cortesía; la suspensión global prevalece siempre. Reintentar un canje confirmado devuelve el estado actual y no lo reactiva. El historial administrativo consulta la bolsa exacta de cortesía después de contratar un plan; una bolsa ausente muestra consumo no disponible.

`paidTrial` distingue `{ source?: 'payment', paymentId }` de `{ source: 'invitation', invitationId, accessSuspended }`. Los documentos pagados anteriores sin `source` siguen siendo válidos. La proyección pública enumera consumo, origen y suspensión, sin referencias privadas de invitación/pago. Los intentos nuevos se limitan por UID a diez en 60 segundos; la recuperación del mismo canje confirmado no consume otro intento. Esto no identifica a una persona que use varias cuentas.

Un usuario sin negocio puede consultar facturación. Un comprobante válido de prueba o plan crea, en la misma transacción, un borrador privado con `status: pending_payment`, `slug: ''` y `onboardingCompleted: false`. Todavía no se reserva un enlace ni se escribe una isla pública. La configuración y cualquier inferencia comercial requieren pago aprobado.

El comprobante `kind: paid_trial` conserva `amountCOP: 5000` y `appointmentAllowance: 10`; no acepta precio, duración ni plan elegidos por el navegador. Aprobarlo crea `subscription.paidTrial` con su referencia privada de pago, activación, límite diez y consumo cero. La aprobación es idempotente y una compra distinta no puede volver a activar la prueba. No recibe gracia inicial de 24 horas.

La reserva consume una unidad únicamente cuando una cita nueva queda guardada. El contador vive en el documento del negocio y se escribe con la cita y su proyección pública dentro de la misma transacción; así dos recursos o fechas diferentes compiten por el mismo cupo. Fallos, conflictos, bloqueos y reintentos no descuentan. Una cancelación no devuelve cupo. La confirmación de una cita ya guardada se puede recuperar después del décimo cupo y de un fallo de respuesta o de contabilidad.

Las 700 respuestas totales de IA son un límite independiente de seguridad de uso. No son 700 citas ni una bolsa que se reinicie por fecha. No existe el acceso anterior de treinta respuestas gratuitas sin negocio. Copiloto, WhatsApp y ampliaciones quedan fuera de la prueba.

La proyección pública solo incluye activación, límite y consumo; no contiene `paidTrial.paymentId`, `lastPaymentId`, imágenes ni identidad privada del dueño. Las reglas mantienen todas las escrituras de pagos, activación y contadores reservadas al servidor.

Al agotar diez citas se bloquean nuevas reservas, configuración e inferencia; el propietario puede consultar su agenda, cancelar citas y pagar un plan. Subir otro comprobante no levanta ese bloqueo antes de su aprobación. Un plan aprobado empieza desde el momento de aprobación o después de una vigencia pagada existente. Nunca se aplaza por el antiguo `trialEndsAt`.

## Compatibilidad y reversión

No se aplica una migración ni se borra información. `trialEndsAt` se conserva como dato histórico pero no concede acceso. Las suscripciones pagadas vigentes conservan su vencimiento. Los negocios con la antigua prueba gratuita deberán comprar la nueva oferta o un plan; conservan configuración y citas. El campo histórico `trialDaysDefault` se omite de la configuración pública y se elimina solo al guardar ajustes, sin modificar bancos o precios por lectura.

Antes de cualquier despliegue se debe verificar un backup de Firestore y conservar la imagen anterior. Revertir únicamente el código preserva los documentos nuevos y contadores, pero el código anterior no interpreta la prueba pagada y puede volver a conceder acceso gratuito. En una reversión operativa se debe pausar la entrada de nuevas reservas hasta restaurar una versión que reconozca este contrato. No borrar ni reiniciar `paidTrial`, comprobantes o contadores. Este trabajo no despliega ni modifica la base real.
