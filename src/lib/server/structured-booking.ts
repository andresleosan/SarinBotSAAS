import 'server-only';
import type { z } from 'zod';
import type { ChatActor } from '@/types/chat';
import type { Business, Appointment } from '@/types/firestore';
import type { Database } from '@/lib/storage/types';
import { getAdminDb } from '@/lib/firebase/admin';
import { getAvailableSlots, toColombiaTimestamp } from '@/lib/sarin/availability';
import { isSubscriptionAllowed } from '@/lib/sarin/subscription';
import { structuredAvailabilitySchema, structuredProposalSchema, documentIdSchema } from './schemas';
import { assertConsent } from './consent';
import { assertBookingSubjectConsent } from './booking-subject-consent';
import { assertBookingIntakePolicy } from './booking-data-policy';
import { assertClientCanBook } from './client-policy';
import { createBookingProposal } from './booking-proposals';
import { HttpError } from './http';
export async function readStructuredAvailability(user: ChatActor, businessId: string, supplied: z.input<typeof structuredAvailabilitySchema>, db: Database = getAdminDb()): Promise<ReturnType<typeof getAvailableSlots>> {
  documentIdSchema.parse(businessId); const input = structuredAvailabilitySchema.parse(supplied);
  if (toColombiaTimestamp(input.dateKey, '00:00') > Date.now() + 366 * 86400000) throw new HttpError(400, 'Puedes reservar hasta un año por adelantado.');
  return db.runTransaction(async tx => {
    const ref = db.collection('businesses').doc(businessId), doc = await tx.get(ref);
    if (!doc.exists) throw new HttpError(404, 'El negocio no existe.');
    const business = doc.data() as Business;
    await assertConsent(user.uid, 'account', undefined, db, tx); await assertConsent(user.uid, 'business_client', business, db, tx);
    await assertBookingSubjectConsent(tx, user, business, input.case, db); await assertBookingIntakePolicy(tx, business.id, business.sarinConfig.intakeFields, db);
    if (!business.sarinConfig.onboardingCompleted || !business.slug) throw new HttpError(403, 'El negocio todavía no está configurado.');
    if (!isSubscriptionAllowed(business)) throw new HttpError(402, 'La suscripción del negocio está vencida.');
    await assertClientCanBook(tx, business, user.uid, Date.now(), db);
    if (!business.services.some(service => service.id === input.serviceId && (!input.resourceId || service.resourceIds.includes(input.resourceId)))) throw new HttpError(400, 'Selecciona un servicio del negocio.');
    const appointments = await tx.get(ref.collection('appointments').where('dateKey', '==', input.dateKey).where('status', '==', 'confirmed'));
    return getAvailableSlots({ tenant: business, ...input, existingAppointments: appointments.docs.map(document => document.data() as Appointment) });
  });
}
export async function createStructuredBookingProposal(user: ChatActor, businessId: string, supplied: z.input<typeof structuredProposalSchema>, db: Database = getAdminDb()) {
  const input = structuredProposalSchema.parse(supplied);
  return createBookingProposal(user, businessId, input.selection, input.case.bookingRequestId, db, { case: input.case, beneficiary: input.beneficiary });
}
