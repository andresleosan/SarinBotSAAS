import 'server-only';
import type { z } from 'zod';
import type { ChatActor } from '@/types/chat';
import type { Business, Appointment } from '@/types/firestore';
import type { Database, Transaction } from '@/lib/storage/types';
import type { BookingSubjectCase } from '@/lib/booking-subject';
import { NEXT_AVAILABILITY_DAYS, type NextAvailabilityResult } from '@/lib/booking-availability';
import { getAdminDb } from '@/lib/firebase/admin';
import { getAvailableSlots, toColombiaTimestamp } from '@/lib/sarin/availability';
import { isSubscriptionAllowed } from '@/lib/sarin/subscription';
import { structuredAvailabilitySchema, nextStructuredAvailabilitySchema, structuredProposalSchema, documentIdSchema } from './schemas';
import { assertConsent } from './consent';
import { assertBookingSubjectConsent } from './booking-subject-consent';
import { assertBookingIntakePolicy } from './booking-data-policy';
import { assertClientCanBook } from './client-policy';
import { createBookingProposal } from './booking-proposals';
import { HttpError } from './http';
async function readBookingBusiness(tx: Transaction, user: ChatActor, businessId: string, subjectCase: BookingSubjectCase, db: Database, now: number): Promise<Business> {
  const doc = await tx.get(db.collection('businesses').doc(businessId));
  if (!doc.exists) throw new HttpError(404, 'El negocio no existe.');
  const business = doc.data() as Business;
  await assertConsent(user.uid, 'account', undefined, db, tx); await assertConsent(user.uid, 'business_client', business, db, tx);
  await assertBookingSubjectConsent(tx, user, business, subjectCase, db); await assertBookingIntakePolicy(tx, business.id, business.sarinConfig.intakeFields, db);
  if (!business.sarinConfig.onboardingCompleted || !business.slug) throw new HttpError(403, 'El negocio todavía no está configurado.');
  if (!isSubscriptionAllowed(business, now)) throw new HttpError(402, 'La suscripción del negocio está vencida.');
  await assertClientCanBook(tx, business, user.uid, now, db);
  return business;
}

const DAY_MILLISECONDS = 86400000;
// Colombia has a fixed UTC-05:00 offset; the host timezone must not affect dates.
const colombiaDateKey = (timestamp: number) => new Date(timestamp - 5 * 3600000).toISOString().slice(0, 10);

export async function readNextStructuredAvailability(user: ChatActor, businessId: string, supplied: z.input<typeof nextStructuredAvailabilitySchema>, db: Database = getAdminDb()): Promise<NextAvailabilityResult> {
  documentIdSchema.parse(businessId); const input = nextStructuredAvailabilitySchema.parse(supplied), now = Date.now();
  const horizon = now + 366 * DAY_MILLISECONDS;
  const from = Math.max(toColombiaTimestamp(input.afterDateKey, '00:00') + DAY_MILLISECONDS, toColombiaTimestamp(colombiaDateKey(now), '00:00'));
  if (from > horizon) throw new HttpError(400, 'Puedes reservar hasta un año por adelantado.');
  const through = Math.min(from + (NEXT_AVAILABILITY_DAYS - 1) * DAY_MILLISECONDS, toColombiaTimestamp(colombiaDateKey(horizon), '00:00'));
  const fromDateKey = colombiaDateKey(from), throughDateKey = colombiaDateKey(through);
  return db.runTransaction(async tx => {
    const business = await readBookingBusiness(tx, user, businessId, input.case, db, now);
    const service = business.services.find(candidate => candidate.id === input.serviceId);
    if (!service) throw new HttpError(400, 'Selecciona un servicio del negocio.');
    const resources = business.resources.filter(resource => resource.active && service.resourceIds.includes(resource.id) && (!input.resourceId || resource.id === input.resourceId));
    if (!resources.length) throw new HttpError(400, 'Selecciona un profesional disponible para este servicio.');
    // No limit(): the storage boundary fails explicitly when its maximum read is
    // exceeded. Truncating confirmed appointments could invent available slots.
    const appointments = await tx.get(db.collection('businesses').doc(businessId).collection('appointments').where('dateKey', '>=', fromDateKey).where('dateKey', '<=', throughDateKey).where('status', '==', 'confirmed'));
    const existingAppointments = appointments.docs.map(document => document.data() as Appointment), availabilityNow = Date.now();
    for (let date = from; date <= through; date += DAY_MILLISECONDS) {
      const dateKey = colombiaDateKey(date);
      const availability = getAvailableSlots({ tenant: business, dateKey, serviceId: input.serviceId, resourceId: input.resourceId, existingAppointments, now: availabilityNow });
      if (availability.some(resource => resource.slots.length > 0)) return { dateKey, availability, fromDateKey, throughDateKey };
    }
    return { dateKey: null, availability: [], fromDateKey, throughDateKey };
  });
}
export async function readStructuredAvailability(user: ChatActor, businessId: string, supplied: z.input<typeof structuredAvailabilitySchema>, db: Database = getAdminDb()): Promise<ReturnType<typeof getAvailableSlots>> {
  documentIdSchema.parse(businessId); const input = structuredAvailabilitySchema.parse(supplied);
  if (toColombiaTimestamp(input.dateKey, '00:00') > Date.now() + 366 * 86400000) throw new HttpError(400, 'Puedes reservar hasta un año por adelantado.');
  return db.runTransaction(async tx => {
    const ref = db.collection('businesses').doc(businessId), business = await readBookingBusiness(tx, user, businessId, input.case, db, Date.now());
    if (!business.services.some(service => service.id === input.serviceId && (!input.resourceId || service.resourceIds.includes(input.resourceId)))) throw new HttpError(400, 'Selecciona un servicio del negocio.');
    const appointments = await tx.get(ref.collection('appointments').where('dateKey', '==', input.dateKey).where('status', '==', 'confirmed'));
    return getAvailableSlots({ tenant: business, ...input, existingAppointments: appointments.docs.map(document => document.data() as Appointment) });
  });
}
export async function createStructuredBookingProposal(user: ChatActor, businessId: string, supplied: z.input<typeof structuredProposalSchema>, db: Database = getAdminDb()) {
  const input = structuredProposalSchema.parse(supplied);
  return createBookingProposal(user, businessId, input.selection, input.case.bookingRequestId, db, { case: input.case, beneficiary: input.beneficiary });
}
