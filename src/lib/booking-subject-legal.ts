import type { BookingCapability, BookingSubjectCase, BookingSubjectDecisions } from './booking-subject';
import { legalContact, type ConsentBusiness } from './legal';
export const BOOKING_SUBJECT_LEGAL_VERSION = '2026-10-16.subject.1';
export function bookingSubjectContent(business: ConsentBusiness, subjectCase: BookingSubjectCase, capability: BookingCapability) {
  const represented = subjectCase.subjectKind === 'represented_minor', health = capability.dataMode === 'health';
  return {
    version: BOOKING_SUBJECT_LEGAL_VERSION, scope: 'booking_subject' as const,
    business: { id: business.id, name: business.name, phoneWhatsApp: business.phoneWhatsApp }, case: subjectCase,
    policyRevision: capability.revision, dataMode: capability.dataMode,
    dataAuthorization: `Autorizo el tratamiento de los datos mínimos ${represented ? 'del menor a quien represento' : 'de mi reserva'} para agendar y gestionar esta cita con ${business.name}, conforme a este aviso.`,
    sensitiveDataAuthorization: `Autorizo expresamente el tratamiento de los datos de esta reserva que pueden revelar información de salud para agendar y gestionar la cita con ${business.name}, conforme a este aviso.`,
    representationDeclaration: 'Declaro que actúo como padre, madre o representante legal del menor para quien gestiono esta reserva. Deben respetarse sus derechos y ser informado y escuchado de forma adecuada a su madurez. Google acredita mi cuenta; no acredita edad, parentesco o tutela.',
    notice: `${business.name} utiliza los datos de esta cita para su agenda y atención. ALS Dev Studio opera SarinBot y sus controles de acceso y soporte. Se recoge el contacto del adulto y, para un menor representado, un nombre breve y la calidad declarada del representante. La selección de servicio y horario puede revelar salud. Este formulario no utiliza IA ni recoge síntomas, diagnósticos, documentos o historia clínica. La declaración no certifica parentesco y no sustituye el consentimiento médico. El negocio revisará las dudas de representación por su procedimiento.`,
    alternative: `La autorización de datos sensibles es facultativa. Puedes contactar directamente a ${business.name} en ${business.phoneWhatsApp} para que gestione tu solicitud por su procedimiento; no se crea una cita automáticamente.`,
    rights: `Puedes consultar o cancelar citas guardadas y retirar este permiso sin nueva aceptación. La retirada impide nuevas operaciones de este caso y no borra automáticamente registros ni cancela una cita ya guardada. No hay borrado automático general; se conservan registros y copias de recuperación, y los plazos por categoría están pendientes de definición. Para consultar, corregir, solicitar supresión o copia y ejercer tus derechos: ${legalContact.email}. El negocio atiende sus propias obligaciones y solicitudes en el contacto indicado.`,
    processors: 'La aplicación procesa y guarda la reserva en la infraestructura de Cloudflare; Firebase Authentication identifica la cuenta del adulto. El recorrido sin IA evita transmitir esta selección o beneficiario a un modelo, pero no elimina su tratamiento en estos sistemas.',
    purposes: ['booking_management', 'booking_contact', 'authorization_evidence', ...(represented ? ['represented_minor_booking'] : []), ...(health ? ['sensitive_booking_management'] : [])],
    categories: ['adult_account_contact', 'service_resource_schedule', ...(represented ? ['minor_display_name', 'declared_representative_role'] : []), ...(health ? ['health_revealing_booking'] : [])],
    requirements: { dataAuthorized: health || represented, sensitiveDataAuthorized: health, representationDeclared: represented },
  };
}
export type BookingSubjectDocuments = ReturnType<typeof bookingSubjectContent> & { fingerprint: string };
export type BookingSubjectReceipt = { uid: string; scope: 'booking_subject'; businessId: string; case: BookingSubjectCase; requestId: string; action: 'accept' | 'revoke'; revision: number; occurredAt: number; policyRevision: number; decisions: BookingSubjectDecisions; documents: BookingSubjectDocuments };
export type BookingSubjectConsentStatus = { required: boolean; active: boolean; revision: number; capability: BookingCapability; documents: BookingSubjectDocuments; receipt: BookingSubjectReceipt | null };
