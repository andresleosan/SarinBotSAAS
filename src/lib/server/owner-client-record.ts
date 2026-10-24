import 'server-only';
import { createHash } from 'node:crypto';
import type { z } from 'zod';
import type { ChatActor } from '@/types/chat';
import type { Appointment, Business } from '@/types/firestore';
import type { Database, Query, QueryDocumentSnapshot } from '@/lib/storage/types';
import { getAdminDb } from '@/lib/firebase/admin';
import { readAttendanceMetadata } from '@/lib/appointment-attendance';
import { compareOwnerClientRecordRows, ownerClientRecordInputSchema, OwnerClientRecordModelError, projectOwnerClientRecordRow, type OwnerClientRecordPage } from '@/lib/owner-client-record';
import { appointmentRescheduleRevision } from './appointment-rescheduling';
import { assertOwner } from './businesses';
import { clientUidSchema } from './client-policy';
import { HttpError } from './http';
import { documentIdSchema } from './schemas';

const changed = () => new HttpError(409, 'Las reservas cambiaron. Actualiza para continuar.', 'CLIENT_RECORD_CHANGED');
const unverifiable = () => new OwnerClientRecordModelError();
const exactId = documentIdSchema.refine(value => !/[^A-Za-z0-9_-]/.test(value));
const exactUid = clientUidSchema.refine(value => !/[\x00-\x1f\x7f]/.test(value));

/** Fingerprint only: every request separately authorizes the owner and source UID. */
export function ownerClientRecordCursorRevision(appointment: Appointment): string {
  try {
    if (Object.hasOwn(appointment, 'rescheduleRevision') && appointment.rescheduleRevision === undefined) throw unverifiable();
    const rescheduleRevision = appointmentRescheduleRevision(appointment);
    const attendanceRevision = readAttendanceMetadata(appointment)?.revision ?? 0;
    return createHash('sha256').update(JSON.stringify({
      id: appointment.id, startAt: appointment.startAt, status: appointment.status, rescheduleRevision, attendanceRevision,
    })).digest('hex');
  } catch { throw unverifiable(); }
}

export async function readOwnerClientRecord(
  owner: ChatActor, businessId: string, sourceAppointmentId: string,
  supplied: z.input<typeof ownerClientRecordInputSchema>, db: Database = getAdminDb(),
): Promise<OwnerClientRecordPage> {
  exactId.parse(businessId); exactId.parse(sourceAppointmentId);
  const input = ownerClientRecordInputSchema.parse(supplied);
  exactUid.parse(input.clientUid);
  return db.runTransaction(async tx => {
    const businessRef = db.collection('businesses').doc(businessId);
    const businessDoc = await tx.get(businessRef);
    if (!businessDoc.exists) throw new HttpError(404, 'El negocio no existe.');
    const business = businessDoc.data() as Business;
    assertOwner(business, owner.uid);
    if (business.id !== businessId) throw new HttpError(404, 'El negocio no existe.');
    const appointments = businessRef.collection('appointments');
    const sourceDoc = await tx.get(appointments.doc(sourceAppointmentId));
    const source = sourceDoc.data() as Appointment | undefined;
    if (!sourceDoc.exists || !source || source.id !== sourceAppointmentId || source.tenantId !== businessId || source.type !== 'appointment') throw new HttpError(404, 'La cita no existe.');
    if (!exactUid.safeParse(source.client?.uid).success) throw new HttpError(409, 'Esta cita no tiene una cuenta verificable.', 'CLIENT_RECORD_NO_ACCOUNT');
    if (source.client!.uid !== input.clientUid) throw new HttpError(404, 'La cita no existe.');

    const context = { businessId, clientUid: input.clientUid, resources: Array.isArray(business.resources) ? business.resources : [] };
    const base = appointments.where('client.uid', '==', input.clientUid).where('type', '==', 'appointment');
    const filtered = input.filter === 'all' ? base : base.where('status', '==', input.filter);
    const cursor = input.cursor;
    if (cursor) {
      const anchorDoc = await tx.get(appointments.doc(cursor.appointmentId));
      const anchor = anchorDoc.data() as Appointment | undefined;
      if (!anchorDoc.exists || !anchor || anchor.id !== cursor.appointmentId || anchor.tenantId !== businessId
        || anchor.type !== 'appointment' || anchor.client?.uid !== input.clientUid || anchor.startAt !== cursor.startAt
        || (input.filter !== 'all' && anchor.status !== input.filter)) throw changed();
      if (ownerClientRecordCursorRevision(anchor) !== cursor.revision) throw changed();
    }

    type Verified = { row: ReturnType<typeof projectOwnerClientRecordRow>; revision: string };
    const verified: Verified[] = [];
    const seen = new Set<string>();
    const append = (documents: QueryDocumentSnapshot[], limit: number, block: 'first' | 'tail' | 'older') => {
      if (documents.length > limit) throw unverifiable();
      for (const document of documents) {
        const raw = document.data();
        const row = projectOwnerClientRecordRow(document.id, raw, context);
        const revision = ownerClientRecordCursorRevision(raw as Appointment);
        const previous = verified.at(-1)?.row;
        if (seen.has(row.appointmentId) || (previous && compareOwnerClientRecordRows(previous, row) >= 0)
          || (input.filter !== 'all' && raw.status !== input.filter)
          || (cursor && (compareOwnerClientRecordRows(cursor, row) >= 0
            || (block === 'tail' && row.startAt !== cursor.startAt) || (block === 'older' && row.startAt >= cursor.startAt)))) throw unverifiable();
        seen.add(row.appointmentId); verified.push({ row, revision });
      }
    };
    const query = async (target: Query, limit: number, block: 'first' | 'tail' | 'older') => {
      const snapshot = await tx.get(target.limit(limit));
      append(snapshot.docs, limit, block);
    };
    if (!cursor) {
      await query(filtered.orderBy('startAt', 'desc').orderBy('id', 'asc'), 21, 'first');
    } else {
      await query(filtered.where('startAt', '==', cursor.startAt).where('id', '>', cursor.appointmentId).orderBy('id', 'asc'), 21, 'tail');
      if (verified.length < 21) await query(filtered.where('startAt', '<', cursor.startAt).orderBy('startAt', 'desc').orderBy('id', 'asc'), 21 - verified.length, 'older');
    }
    const returned = verified.slice(0, 20), last = returned.at(-1);
    return {
      scope: { businessId, sourceAppointmentId, clientUid: input.clientUid }, filter: input.filter, checkedAt: Date.now(),
      rows: returned.map(item => item.row),
      nextCursor: verified.length === 21 && last ? { appointmentId: last.row.appointmentId, startAt: last.row.startAt, revision: last.revision } : null,
      coverage: { mode: 'indexed_appointments', completeness: 'not_guaranteed' },
    };
  });
}
