import 'server-only';
import type { ChatActor } from '@/types/chat';
import type { Business, TenantResource } from '@/types/firestore';
import type { Database, Transaction } from '@/lib/storage/types';
import { getAdminDb } from '@/lib/firebase/admin';
import { hasOwnTeamAgendaAccess, projectTeamAgenda, teamDocumentIdSchema, teamUidSchema, type BusinessTeamMembership, type TeamAgendaView } from '@/lib/business-team';
import { isDateKey } from '@/lib/sarin/calendar-time';
import { readVerifiedTeamSnapshot, teamAccessEnabled } from './business-team';
import { readBookingDataPolicy } from './booking-data-policy';
import { assertConsent } from './consent';
import { HttpError } from './http';

const denied = (): never => { throw new HttpError(403, 'No tienes acceso a esta agenda.', 'TEAM_AGENDA_DENIED'); };
export async function assertTeamAgendaAccess(tx: Transaction, actor: ChatActor, businessId: string, db: Database): Promise<{
  business: Business; membership: BusinessTeamMembership; resource: TenantResource;
}> {
  teamDocumentIdSchema.parse(businessId); teamUidSchema.parse(actor.uid);
  if (!teamAccessEnabled()) return denied();
  const { business, membership } = await readVerifiedTeamSnapshot(tx, businessId, actor.uid, db);
  const resource = business.resources.find(value => value.id === membership?.resourceId);
  if (!membership || !resource || !hasOwnTeamAgendaAccess(membership, { businessId, memberUid: actor.uid, ownerUid: business.ownerUid, resource })) return denied();
  const { capability } = await readBookingDataPolicy(businessId, db, tx);
  if (!business.sarinConfig.onboardingCompleted || !capability.configured || capability.dataMode !== 'general' || capability.representedMinorsEnabled) return denied();
  await assertConsent(actor.uid, 'account', undefined, db, tx);
  await assertConsent(business.ownerUid, 'account', undefined, db, tx);
  return { business, membership, resource };
}
export async function readTeamAssignedAgenda(actor: ChatActor, businessId: string, dateKey: string, db: Database = getAdminDb()): Promise<TeamAgendaView> {
  teamDocumentIdSchema.parse(businessId); teamUidSchema.parse(actor.uid);
  const today = Math.floor((Date.now() - 5 * 3600000) / 86400000) * 86400000 + 5 * 3600000;
  const dateStart = Date.parse(`${dateKey}T00:00:00-05:00`);
  if (dateKey.length !== 10 || !isDateKey(dateKey) || dateStart < today || dateStart > today + 31 * 86400000) throw new HttpError(400, 'Consulta un día entre hoy y los próximos 31 días.');
  return db.runTransaction(async tx => {
    const { business, membership, resource } = await assertTeamAgendaAccess(tx, actor, businessId, db);
    const snapshot = await tx.get(db.collection('businesses').doc(businessId).collection('appointments').where('dateKey', '==', dateKey).where('resourceId', '==', resource.id).limit(1000));
    if (snapshot.size >= 1000) throw new HttpError(413, 'La agenda supera el límite de lectura.', 'TEAM_AGENDA_TOO_LARGE');
    try {
      const appointments = snapshot.docs.map(doc => {
        const value = doc.data();
        if (value?.id !== doc.id) throw new Error('Invalid appointment identity');
        return value;
      });
      const view = projectTeamAgenda({ businessId, businessName: business.name, resource: { id: resource.id, name: resource.name }, dateKey,
        checkedAt: Date.now(), membershipRevision: membership.revision }, appointments);
      view.rows.sort((a, b) => a.startAt - b.startAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      return view;
    } catch { throw new HttpError(503, 'No se pudo validar la agenda.', 'TEAM_AGENDA_UNAVAILABLE'); }
  });
}
