import 'server-only';
import { z } from 'zod';
import type { ChatActor } from '@/types/chat';
import type { Business, Appointment } from '@/types/firestore';
import type { Database } from '@/lib/storage/types';
import { bookingBeneficiarySchema } from '@/lib/booking-subject';
import { getAdminDb } from '@/lib/firebase/admin';
import { assertOwner } from './businesses';
import { assertConsent } from './consent';
import { documentIdSchema } from './schemas';
import { HttpError } from './http';
const count = z.number().int().nonnegative().safe();
export const representationReviewInputSchema = z.object({ expectedRevision: count.max(Number.MAX_SAFE_INTEGER - 1), status: z.enum(['reviewed', 'needs_contact']) }).strict();
const reviewSchema = z.object({ revision: count, status: z.enum(['declared', 'reviewed', 'needs_contact']), reviewedBy: z.string().min(1).max(128).nullable(), reviewedAt: count.nullable() }).strict();
export async function updateRepresentationReview(owner: ChatActor, businessId: string, appointmentId: string, supplied: z.input<typeof representationReviewInputSchema>, db: Database = getAdminDb()): Promise<Appointment> {
  documentIdSchema.parse(businessId); documentIdSchema.parse(appointmentId); const input = representationReviewInputSchema.parse(supplied), businessRef = db.collection('businesses').doc(businessId), ref = businessRef.collection('appointments').doc(appointmentId);
  return db.runTransaction(async tx => {
    const [businessDoc, doc] = await Promise.all([tx.get(businessRef), tx.get(ref)]);
    if (!businessDoc.exists || !doc.exists) throw new HttpError(404, 'La cita no existe.');
    const business = businessDoc.data() as Business, appointment = doc.data() as Appointment; assertOwner(business, owner.uid);
    if (appointment.id !== appointmentId || appointment.tenantId !== businessId) throw new HttpError(503, 'No se pudo validar la cita.');
    const beneficiary = bookingBeneficiarySchema.safeParse(appointment.beneficiary);
    if (appointment.type !== 'appointment' || !beneficiary.success || beneficiary.data.kind !== 'represented_minor') throw new HttpError(409, 'Esta cita no tiene una representación declarada.');
    const review = reviewSchema.safeParse(appointment.representationReview);
    if (!review.success || (review.data.status === 'declared' ? review.data.revision !== 0 || review.data.reviewedBy !== null || review.data.reviewedAt !== null : review.data.revision < 1 || !review.data.reviewedBy || review.data.reviewedAt === null)) throw new HttpError(503, 'No se pudo validar la revisión.');
    if (review.data.revision !== input.expectedRevision) throw new HttpError(409, 'La revisión cambió. Actualiza antes de guardar.', 'REPRESENTATION_REVIEW_CONFLICT');
    await assertConsent(owner.uid, 'account', undefined, db, tx);
    const updated: Appointment = { ...appointment, representationReview: { revision: review.data.revision + 1, status: input.status, reviewedBy: owner.uid, reviewedAt: Date.now() } };
    tx.set(ref, updated); return updated;
  });
}
