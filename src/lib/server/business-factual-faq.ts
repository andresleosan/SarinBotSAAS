import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Business } from '@/types/firestore';
import type { ChatActor } from '@/types/chat';
import type { Database, Transaction } from '@/lib/storage/types';
import { getAdminDb } from '@/lib/firebase/admin';
import { factualFaqAppliedSchema, factualFaqCommandCanonicalString, factualFaqCommandSchema, factualFaqQuestion, factualFaqStateSchema, factualFaqTopicSchema, type ClientFactualFaqAnswer, type ClientFactualFaqTopics, type FactualFaqApplied, type FactualFaqCommand, type FactualFaqState, type FactualFaqTopic, type OwnerFactualFaqView } from '@/lib/business-factual-faq';
import { isSubscriptionAllowed } from '@/lib/sarin/subscription';
import { StorageError } from '@/lib/storage/database';
import { assertOwner, stableDocumentId } from './businesses';
import { assertConsent } from './consent';
import { readBookingDataPolicy } from './booking-data-policy';
import { documentIdSchema } from './schemas';
import { HttpError } from './http';

const unavailable = () => new HttpError(503, 'No se pueden verificar las respuestas del negocio.', 'FACTUAL_FAQ_UNAVAILABLE');
const changed = () => new HttpError(409, 'Las respuestas o la política cambiaron. Actualiza y vuelve a elegir.', 'FACTUAL_FAQ_CHANGED');
const receiptSchema = z.object({ version: z.literal(1), businessId: documentIdSchema, actorUid: z.string().min(1).max(128), requestId: factualFaqCommandSchema.shape.requestId, commandFingerprint: factualFaqAppliedSchema.shape.commandFingerprint, applied: factualFaqAppliedSchema }).strict().refine(value => value.requestId === value.applied.requestId && value.commandFingerprint === value.applied.commandFingerprint);
export const factualFaqCommandFingerprint = (command: FactualFaqCommand): string => createHash('sha256').update(factualFaqCommandCanonicalString(command)).digest('hex');
function readFailure(error: unknown): never {
  if (error instanceof StorageError && error.code === 'DATA_CONFLICT') throw error;
  throw unavailable();
}
async function stateIn(tx: Transaction, db: Database, businessId: string): Promise<FactualFaqState> {
  try {
    const doc = await tx.get(db.collection('businesses').doc(businessId).collection('factualFaq').doc('current'));
    if (!doc.exists) return { version: 1, businessId, revision: 0, items: [], updatedAt: null };
    const parsed = factualFaqStateSchema.safeParse(doc.data());
    if (!parsed.success || parsed.data.businessId !== businessId || parsed.data.revision === 0) throw unavailable();
    return parsed.data;
  } catch (error) { return readFailure(error); }
}
async function contextIn(tx: Transaction, db: Database, businessId: string) {
  const doc = await tx.get(db.collection('businesses').doc(businessId));
  if (!doc.exists) throw new HttpError(404, 'El negocio no existe.');
  const business = { ...doc.data(), id: businessId } as Business;
  let policy;
  try { policy = (await readBookingDataPolicy(businessId, db, tx)).capability; }
  catch (error) { return readFailure(error); }
  const state = await stateIn(tx, db, businessId);
  const supported = policy.dataMode === 'general' && !policy.representedMinorsEnabled;
  return { business, state, policyRevision: policy.revision, supported, eligible: supported && business.sarinConfig?.onboardingCompleted === true && isSubscriptionAllowed(business, Date.now()) };
}
async function appliedIn(tx: Transaction, db: Database, businessId: string, uid: string, requestId?: string): Promise<FactualFaqApplied | null> {
  if (!requestId) return null;
  try {
    const doc = await tx.get(db.collection('businesses').doc(businessId).collection('factualFaqOperations').doc(stableDocumentId('factual-faq', businessId, uid, requestId)));
    if (!doc.exists) return null;
    const parsed = receiptSchema.safeParse(doc.data());
    if (!parsed.success || parsed.data.actorUid !== uid || parsed.data.businessId !== businessId || parsed.data.requestId !== requestId) throw unavailable();
    return parsed.data.applied;
  } catch (error) { return readFailure(error); }
}
const view = (context: Awaited<ReturnType<typeof contextIn>>, applied: FactualFaqApplied | null): OwnerFactualFaqView => {
  if (applied && applied.revision > context.state.revision) throw unavailable();
  return { state: context.state, policyRevision: context.policyRevision, eligible: context.eligible, applied };
};
export async function readOwnerFactualFaq(owner: ChatActor, businessId: string, requestId?: string, db: Database = getAdminDb()): Promise<OwnerFactualFaqView> {
  documentIdSchema.parse(businessId);
  if (requestId !== undefined) factualFaqCommandSchema.shape.requestId.parse(requestId);
  return db.runTransaction(async tx => {
    const context = await contextIn(tx, db, businessId);
    assertOwner(context.business, owner.uid);
    return view(context, await appliedIn(tx, db, businessId, owner.uid, requestId));
  });
}
export async function saveOwnerFactualFaq(owner: ChatActor, businessId: string, supplied: FactualFaqCommand, db: Database = getAdminDb()): Promise<OwnerFactualFaqView> {
  documentIdSchema.parse(businessId);
  const command = factualFaqCommandSchema.parse(supplied), fingerprint = factualFaqCommandFingerprint(command);
  return db.runTransaction(async tx => {
    const context = await contextIn(tx, db, businessId);
    assertOwner(context.business, owner.uid);
    const previous = await appliedIn(tx, db, businessId, owner.uid, command.requestId);
    if (previous) {
      if (previous.commandFingerprint !== fingerprint) throw new HttpError(409, 'Este identificador ya se usó para otras respuestas.', 'FACTUAL_FAQ_REQUEST_REUSED');
      return view(context, previous);
    }
    if (!context.eligible || context.state.revision !== command.expectedRevision || context.policyRevision !== command.expectedPolicyRevision || context.state.revision >= Number.MAX_SAFE_INTEGER - 1) throw changed();
    await assertConsent(owner.uid, 'account', undefined, db, tx);
    const savedAt = Date.now(), revision = context.state.revision + 1;
    const state: FactualFaqState = { version: 1, businessId, revision, items: command.items, updatedAt: savedAt };
    const applied: FactualFaqApplied = { requestId: command.requestId, commandFingerprint: fingerprint, revision, savedAt };
    const ref = db.collection('businesses').doc(businessId);
    tx.set(ref.collection('factualFaq').doc('current'), state);
    tx.set(ref.collection('factualFaqOperations').doc(stableDocumentId('factual-faq', businessId, owner.uid, command.requestId)), { version: 1, businessId, actorUid: owner.uid, requestId: command.requestId, commandFingerprint: fingerprint, applied });
    return view({ ...context, state }, applied);
  });
}
async function clientContext(tx: Transaction, db: Database, actor: ChatActor, businessId: string) {
  const context = await contextIn(tx, db, businessId);
  await assertConsent(actor.uid, 'account', undefined, db, tx);
  await assertConsent(actor.uid, 'business_client', context.business, db, tx);
  if (!context.business.sarinConfig?.onboardingCompleted || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(context.business.slug) || !context.supported) throw new HttpError(409, 'Esta información no está disponible para este recorrido.', 'FACTUAL_FAQ_UNSUPPORTED');
  return context;
}
export async function readClientFactualFaqTopics(actor: ChatActor, businessId: string, db: Database = getAdminDb()): Promise<ClientFactualFaqTopics> {
  documentIdSchema.parse(businessId);
  return db.runTransaction(async tx => {
    const { state } = await clientContext(tx, db, actor, businessId);
    return { businessId, revision: state.revision, topics: state.items.map(item => ({ topic: item.topic, question: factualFaqQuestion(item.topic) })) };
  });
}
export async function readClientFactualFaqAnswer(actor: ChatActor, businessId: string, topic: FactualFaqTopic, revision: number, db: Database = getAdminDb()): Promise<ClientFactualFaqAnswer> {
  documentIdSchema.parse(businessId); factualFaqTopicSchema.parse(topic); z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1).parse(revision);
  return db.runTransaction(async tx => {
    const { state } = await clientContext(tx, db, actor, businessId), item = state.items.find(value => value.topic === topic);
    if (revision !== state.revision || !item) throw changed();
    return { businessId, revision, topic, question: factualFaqQuestion(topic), answer: item.answer, source: 'business' };
  });
}

