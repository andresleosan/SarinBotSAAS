import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { describe, it } from 'vitest';
import { deleteApp, getApps } from 'firebase-admin/app';
import type { Firestore } from 'firebase-admin/firestore';
import { getAdminAuth, getAdminDb } from '@/lib/firebase/admin';
import { createAppointment, readAvailability } from '@/lib/server/bookings';
import { publicBusiness } from '@/lib/server/businesses';
import { bookingSchema, businessConfigSchema } from '@/lib/server/schemas';
import { isSubscriptionAllowed } from '@/lib/sarin/subscription';
import type { Appointment, Business, PaymentReceipt, PlatformSettings } from '@/types/firestore';
import { LOCAL_TEST_ACCOUNTS, LOCAL_SUPERADMIN_UID } from '../src/lib/firebase/emulator-constants.mjs';
import { assertJourneyEnvironment, assertJourneyUrl, cleanupOwnedDocuments, createJourneyFixture, removeJourneyBank } from '../scripts/lib/local-journey.mjs';

// Ordinary pnpm test always skips this fixture. The CLI pins and validates the
// entire environment before SDK initialization and creates a new UUID per run.
describe.skipIf(process.env.SARIN_LOCAL_JOURNEY !== '1')('opt-in real local SaaS journey', () => {
  it('completes onboarding, real reservations, manual billing and strict tenant isolation', async () => {
    assertJourneyEnvironment(process.env);
    const fixture = createJourneyFixture(process.env.SARIN_JOURNEY_RUN!);
    const port = Number(process.env.SARIN_JOURNEY_PORT);
    const base = `http://127.0.0.1:${port}`;
    const auth = getAdminAuth();
    const db = getAdminDb();
    const createdAccounts: string[] = [];
    let claimedRun = false;
    let addedBank = false;
    let createdSettings = false;
    let cleanupFailure: unknown;
    let checks = 0;
    const check = (condition: unknown, message: string) => { assert.ok(condition, message); checks++; };
    const requestId = (purpose: string) => `${fixture.runId}-${purpose}`;
    const dateKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + 2 * 86400000));

    async function json<T>(url: string, init: RequestInit = {}) {
      const response = await fetch(assertJourneyUrl(url, port), { ...init, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(60000) });
      const body = await response.json().catch(() => null) as T;
      return { response, body };
    }
    function api<T>(path: string, token?: string, method = 'GET', body?: unknown) {
      assert.ok(path.startsWith('/api/') && !path.startsWith('/api/sarin/'), 'El ensayo no llama endpoints de inferencia.');
      return json<T>(`${base}${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    }
    async function login(account: { uid: string; providerUid: string; email: string; displayName: string }) {
      const signed = await json<{ idToken?: string; localId?: string }>('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=sarin-local-emulator-only', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestUri: base, returnSecureToken: true,
          postBody: new URLSearchParams({ providerId: 'google.com', id_token: JSON.stringify({ sub: account.providerUid, email: account.email, email_verified: true, name: account.displayName }) }).toString() }),
      });
      check(signed.response.ok && typeof signed.body?.idToken === 'string' && signed.body.localId === account.uid, 'Auth no corresponde a las cuentas sintéticas del ensayo.');
      const token = signed.body.idToken!;
      const decoded = await auth.verifyIdToken(token, true);
      check(decoded.uid === account.uid && decoded.aud === 'demo-sarin-bot', 'El token no pertenece al proyecto demo-sarin-bot.');
      return { token, decoded };
    }
    function firestoreRead(path: string, token: string) {
      return json<{ fields?: Record<string, unknown> }>(`http://127.0.0.1:8080/v1/projects/demo-sarin-bot/databases/(default)/documents/${path}`, { headers: { Authorization: `Bearer ${token}` } });
    }
    async function ownDocuments() {
      const rows: { path: string; data: Record<string, unknown> }[] = [];
      for (const collection of ['appointments', 'bookingLocks']) {
        const snapshot = await db.collection(`businesses/${fixture.businessId}/${collection}`).get();
        for (const doc of snapshot.docs) rows.push({ path: doc.ref.path, data: doc.data() });
      }
      for (const collection of ['paymentImages', 'paymentReceipts']) {
        const snapshot = await db.collection(collection).where('ownerUid', '==', fixture.ownerUid).get();
        for (const doc of snapshot.docs) rows.push({ path: doc.ref.path, data: doc.data() });
      }
      const references = [db.doc(`publicBusinesses/${fixture.slug}`), db.doc(`businessSlugs/${fixture.slug}`), ...fixture.accounts.map(account => db.doc(`users/${account.uid}`)), db.doc(`businesses/${fixture.businessId}`)];
      for (const doc of await db.getAll(...references)) if (doc.exists) rows.push({ path: doc.ref.path, data: doc.data()! });
      return rows;
    }
    async function missingUser(uid: string): Promise<boolean> {
      try { await auth.getUser(uid); return false; } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'auth/user-not-found') return true;
        throw error;
      }
    }

    try {
      // The fixed seeded admin is reused only for login and API actions on this
      // run's IDs; /api/session is never called for it, and it is never deleted.
      const adminAccount = LOCAL_TEST_ACCOUNTS.find(account => account.role === 'admin');
      assert.ok(adminAccount);
      const admin = await login(adminAccount);
      const consoleResult = await api<{ businesses: Business[]; receipts: PaymentReceipt[] }>('/api/admin', admin.token);
      check(consoleResult.response.ok && Array.isArray(consoleResult.body?.businesses), 'Next no está conectado a los mismos emuladores y UID administrador local.');
      const adminProfileBefore = (await db.doc(`users/${LOCAL_SUPERADMIN_UID}`).get()).data();

      for (const account of fixture.accounts) check(await missingUser(account.uid), 'Una cuenta del ensayo ya existe: no se sobrescribió.');
      check((await ownDocuments()).length === 0, 'Hay documentos previos para esta corrida; se preservaron.');
      claimedRun = true;
      for (const account of fixture.accounts) {
        // Track before import so a failed/partial Auth response still cleans up
        // only the UUID namespaces that were verified absent above.
        createdAccounts.push(account.uid);
        const result = await auth.importUsers([{ uid: account.uid, email: account.email, displayName: account.displayName, emailVerified: true,
          providerData: [{ providerId: 'google.com', uid: account.providerUid, email: account.email, displayName: account.displayName }] }]);
        check(result.failureCount === 0, 'No se pudo crear una cuenta sintética en Auth.');
      }
      const [owner, client, outsider] = await Promise.all(fixture.accounts.map(account => login(account)));
      for (const identity of [owner, client, outsider]) {
        const session = await api<{ isSuperadmin: boolean }>('/api/session', identity.token);
        check(session.response.ok && session.body.isSuperadmin === false, 'Una cuenta sintética recibió acceso administrativo.');
      }
      for (const method of ['GET', 'PATCH']) {
        const body = method === 'PATCH' ? { provider: 'deepseek' } : undefined;
        check((await api('/api/admin/ai', undefined, method, body)).response.status === 401, 'El selector de IA admitió una solicitud sin sesión.');
        check((await api('/api/admin/ai', owner.token, method, body)).response.status === 403, 'Una cuenta normal accedió al selector de IA.');
      }
      check((await api('/api/admin/ai/usage')).response.status === 401, 'El consumo de IA admitió una solicitud sin sesión.');
      check((await api('/api/admin/ai/usage', owner.token)).response.status === 403, 'Una cuenta normal accedió al consumo de IA.');
      const usage = await api<{ provider: string; timeZone: string; totals: { calls: number }; businesses: unknown[] }>('/api/admin/ai/usage', admin.token);
      check(usage.response.ok && usage.body.provider === 'deepseek' && usage.body.timeZone === 'America/Bogota' && Array.isArray(usage.body.businesses) && Number.isSafeInteger(usage.body.totals?.calls), 'El administrador no pudo consultar el consumo de IA.');
      console.log('Fase 1 OK: Auth oficial, roles y aislamiento del servidor demo.');

      const config = businessConfigSchema.parse({ name: 'Negocio sintético del ensayo', category: 'Ensayo sin clientes reales', slug: fixture.slug, phoneWhatsApp: '573001234567',
        tone: 'Claro', customRules: 'Datos sintéticos de esta corrida', intakeFields: [{ key: 'reason', label: 'Motivo del ensayo', required: true }],
        resources: [{ id: 'room', name: 'Recurso sintético', active: true }],
        services: [{ id: 'service', name: 'Consulta sintética', durationMinutes: 60, bufferMinutes: 15, price: 100, resourceIds: ['room'] }],
        weeklySchedule: Object.fromEntries(Array.from({ length: 7 }, (_, day) => [day, { isOpen: true, intervals: [{ start: '09:00', end: '18:00' }] }])) });
      const created = await api<{ business: Business }>('/api/businesses', owner.token, 'POST', config);
      check(created.response.status === 201 && created.body.business.id === fixture.businessId && created.body.business.ownerUid === fixture.ownerUid, 'Onboarding no creó el negocio esperado.');
      const business = created.body.business;
      check(business.subscription.status === 'trial' && business.subscription.trialEndsAt - business.createdAt === 7 * 86400000, 'La prueba no dura siete días.');
      const repeated = await api<{ business: Business }>('/api/businesses', owner.token, 'POST', { ...config, name: 'Negocio sintético actualizado' });
      check(repeated.response.status === 201 && repeated.body.business.subscription.trialEndsAt === business.subscription.trialEndsAt && repeated.body.business.name === 'Negocio sintético actualizado', 'Guardar configuración reinició la prueba o no aplicó cambios.');
      const collision = await api('/api/businesses', outsider.token, 'POST', config);
      check(collision.response.status === 409, 'Un segundo dueño reutilizó un slug existente.');
      const projection = await firestoreRead(`publicBusinesses/${fixture.slug}`, client.token);
      check(projection.response.ok && !projection.body.fields?.ownerUid && !projection.body.fields?.ownerEmail, 'La proyección pública filtró identidad del dueño.');
      const projected = (await db.doc(`publicBusinesses/${fixture.slug}`).get()).data();
      check(isDeepStrictEqual(projected?.weeklySchedule, config.weeklySchedule) && projected?.timezone === 'America/Bogota', 'El horario público no coincide con la configuración.');
      check((await firestoreRead(`businesses/${fixture.businessId}`, client.token)).response.status === 403, 'Un cliente accedió al documento privado del negocio.');
      const slots = await readAvailability(repeated.body.business, dateKey, 'service', 'room', db);
      check(slots[0]?.slots.includes('10:00') && slots[0]?.slots.includes('14:00'), 'No se calcularon horarios disponibles reales.');
      console.log('Fase 2 OK: onboarding, prueba única, slug y proyección/horarios reales.');

      // No client booking API exists: execute the same validated implementation
      // used by tools, with an Auth-verified identity and real Admin transactions.
      const booking = bookingSchema.parse({ dateKey, startTimeStr: '10:00', resourceId: 'room', serviceId: 'service', clientPhone: '573001234567', intakeAnswers: { reason: 'Ensayo sintético' } });
      const appointment = await createAppointment(client.decoded, fixture.businessId, booking, requestId('booking'), db);
      check(appointment.client?.uid === fixture.clientUid && appointment.reservedUntilAt - appointment.endAt === 15 * 60000, 'La cita no conserva identidad y buffer.');
      const sameAppointment = await createAppointment(client.decoded, fixture.businessId, booking, requestId('booking'), db);
      check(sameAppointment.id === appointment.id, 'Reintentar una reserva duplicó la cita.');
      await assert.rejects(createAppointment(outsider.decoded, fixture.businessId, booking, requestId('double'), db), { status: 409 }); checks++;
      const ownerAppointments = await api<{ appointments: Appointment[] }>(`/api/businesses/${fixture.businessId}/appointments?date=${dateKey}`, owner.token);
      const otherAppointments = await api<{ appointments: Appointment[] }>(`/api/businesses/${fixture.businessId}/appointments?date=${dateKey}`, outsider.token);
      check(ownerAppointments.response.ok && ownerAppointments.body.appointments.some(item => item.id === appointment.id), 'El dueño no pudo leer su agenda.');
      check(otherAppointments.response.ok && otherAppointments.body.appointments.length === 0, 'Otro usuario pudo ver citas ajenas.');
      const path = `/api/businesses/${fixture.businessId}/appointments`;
      check((await api(path, outsider.token, 'PATCH', { appointmentId: appointment.id })).response.status === 403, 'Otro usuario canceló una cita ajena.');
      const block = { dateKey, startTimeStr: '10:00', endTimeStr: '11:00', resourceId: 'room', requestId: requestId('block'), motivo: 'Bloqueo sintético' };
      check((await api(path, client.token, 'POST', block)).response.status === 403, 'Un cliente creó un bloqueo administrativo.');
      check((await api(path, owner.token, 'POST', block)).response.status === 409, 'Se permitió un bloqueo encima de una cita.');
      const cancelled = await api<{ appointment: Appointment }>(path, client.token, 'PATCH', { appointmentId: appointment.id });
      check(cancelled.response.ok && cancelled.body.appointment.status === 'cancelled_by_client', 'El cliente no pudo cancelar su cita.');
      const blocked = await api<{ appointment: Appointment }>(path, owner.token, 'POST', block);
      check(blocked.response.status === 201 && blocked.body.appointment.type === 'manual_block', 'El dueño no pudo bloquear el horario liberado.');
      await assert.rejects(createAppointment(client.decoded, fixture.businessId, booking, requestId('blocked'), db), { status: 409 }); checks++;
      check((await api(path, owner.token, 'PATCH', { appointmentId: blocked.body.appointment.id })).response.ok, 'El dueño no pudo cancelar su bloqueo.');
      const race = await Promise.allSettled([createAppointment(client.decoded, fixture.businessId, { ...booking, startTimeStr: '14:00' }, requestId('race-a'), db), createAppointment(outsider.decoded, fixture.businessId, { ...booking, startTimeStr: '14:00' }, requestId('race-b'), db)]);
      check(race.filter(result => result.status === 'fulfilled').length === 1 && race.some(result => result.status === 'rejected' && result.reason?.status === 409), 'La reserva concurrente permitió double-booking.');
      console.log('Fase 3 OK: reservas reales/idempotentes, carrera concurrente, cancelación, bloqueos y permisos.');

      const expired: Business = { ...repeated.body.business, subscription: { status: 'past_due', trialEndsAt: Date.now() - 1, currentPeriodEndsAt: 0 } };
      await db.runTransaction(async transaction => { transaction.set(db.doc(`businesses/${fixture.businessId}`), expired); transaction.set(db.doc(`publicBusinesses/${fixture.slug}`), publicBusiness(expired)); });
      check(!isSubscriptionAllowed(expired), 'La suscripción vencida sigue permitida.');
      await assert.rejects(createAppointment(client.decoded, fixture.businessId, { ...booking, startTimeStr: '09:00' }, requestId('expired'), db), { status: 402 }); checks++;
      const bankSelected = await db.runTransaction(async transaction => {
        const ref = db.doc('platformSettings/main'); const snapshot = await transaction.get(ref); const data = snapshot.data() ?? {};
        if (data.bankAccounts !== undefined && !Array.isArray(data.bankAccounts)) throw new Error('La configuración bancaria local no es válida; se preservó.');
        const accounts = data.bankAccounts ?? [];
        if (accounts.length) { assert.ok(typeof accounts[0].id === 'string'); return accounts[0].id as string; }
        transaction.set(ref, { bankAccounts: [fixture.bank] }, { merge: true });
        createdSettings = !snapshot.exists; addedBank = true;
        return fixture.bank.id;
      });
      const receiptDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jwL8AAAAASUVORK5CYII=';
      check(Buffer.from(receiptDataUrl.split(',')[1], 'base64').byteLength < 150 * 1024, 'La captura sintética supera el límite.');
      const uploadInput = { bankSelected, receiptDataUrl, planId: 'weekly', requestId: requestId('receipt') };
      check((await api('/api/billing', client.token, 'POST', uploadInput)).response.status === 403, 'Un cliente subió pagos de un negocio ajeno.');
      check((await api('/api/billing', owner.token, 'POST', { ...uploadInput, planId: 'unlimited' })).response.status === 400, 'Se aceptó un plan inexistente.');
      check((await api('/api/billing', owner.token, 'POST', { ...uploadInput, amountCOP: 1, periodDays: 365 })).response.status === 400, 'El cliente pudo elegir un importe o duración arbitrarios.');
      const uploaded = await api<{ receipt: PaymentReceipt; business: Business }>('/api/billing', owner.token, 'POST', uploadInput);
      check(uploaded.response.status === 201 && uploaded.body.receipt.status === 'pending' && uploaded.body.receipt.ownerUid === fixture.ownerUid, 'La API no almacenó el comprobante pendiente.');
      const receiptId = uploaded.body.receipt.id;
      const repeatedUpload = await api<{ receipt: PaymentReceipt; business: Business }>('/api/billing', owner.token, 'POST', uploadInput);
      check(repeatedUpload.response.status === 201 && repeatedUpload.body.receipt.id === receiptId && repeatedUpload.body.business.subscription.graceEndsAt === uploaded.body.business.subscription.graceEndsAt, 'Repetir el comprobante duplicó el pago o su gracia.');
      const ownerBilling = await api<{ receipts: PaymentReceipt[]; settings: PlatformSettings }>('/api/billing', owner.token);
      check(uploaded.body.receipt.planId === 'weekly' && uploaded.body.receipt.periodDays === 7 && uploaded.body.receipt.amountCOP === ownerBilling.body.settings.weeklyPriceCOP, 'El comprobante semanal no conserva los siete días y su precio configurado.');
      check(ownerBilling.response.ok && ownerBilling.body.receipts.some(item => item.id === receiptId) && !JSON.stringify(ownerBilling.body.receipts).includes('data:image/'), 'La lista de pagos expuso la imagen o perdió el comprobante.');
      const image = (await db.doc(`paymentImages/${receiptId}`).get()).data();
      check(image?.receiptDataUrl === receiptDataUrl && !(await db.doc(`paymentReceipts/${receiptId}`).get()).data()?.receiptDataUrl, 'La imagen no está separada del documento de lista.');
      check((await api(`/api/billing?receiptId=${receiptId}`, client.token)).response.status === 403, 'La API de facturación expuso una imagen al cliente.');
      check((await firestoreRead(`paymentImages/${receiptId}`, client.token)).response.status === 403 && (await firestoreRead(`paymentReceipts/${receiptId}`, client.token)).response.status === 403, 'Las reglas expusieron el pago directamente al cliente.');
      const clientBilling = await api<{ receipts: PaymentReceipt[] }>('/api/billing', client.token);
      check(clientBilling.response.ok && clientBilling.body.receipts.length === 0, 'Un cliente recibió pagos de otro dueño.');
      const publicWithPayment = (await db.doc(`publicBusinesses/${fixture.slug}`).get()).data();
      check(!publicWithPayment?.subscription.lastPaymentId && !publicWithPayment?.subscription.graceGrantedAt, 'La proyección expuso metadatos privados de pago.');
      console.log('Fase 4 OK: suscripción vencida, captura sintética, documento dedicado, gracia y pago privado.');

      check((await api('/api/admin', owner.token)).response.status === 403 && (await api('/api/admin', client.token)).response.status === 403, 'Se permitió acceso a consola sin UID administrador.');
      check((await api('/api/admin', owner.token, 'PATCH', { action: 'approve', paymentId: receiptId })).response.status === 403, 'El dueño aprobó su propio comprobante.');
      const adminImage = await api<{ receiptDataUrl: string }>(`/api/admin?receiptId=${receiptId}`, admin.token);
      check(adminImage.response.ok && adminImage.body.receiptDataUrl === receiptDataUrl, 'El administrador no pudo revisar la imagen.');
      const approved = await api<{ receipt: PaymentReceipt; business: Business }>('/api/admin', admin.token, 'PATCH', { action: 'approve', paymentId: receiptId });
      check(approved.response.ok && approved.body.receipt.status === 'approved' && approved.body.business.subscription.status === 'active' && isSubscriptionAllowed(approved.body.business), 'La aprobación no reactivó la suscripción.');
      const days = (approved.body.business.subscription.currentPeriodEndsAt - Date.now()) / 86400000;
      check(days > 6.99 && days <= 7, 'La activación semanal no dura siete días.');
      const repeatedApproval = await api<{ receipt: PaymentReceipt; business: Business }>('/api/admin', admin.token, 'PATCH', { action: 'approve', paymentId: receiptId });
      check(repeatedApproval.response.ok && repeatedApproval.body.business.subscription.currentPeriodEndsAt === approved.body.business.subscription.currentPeriodEndsAt && repeatedApproval.body.receipt.reviewedAt === approved.body.receipt.reviewedAt, 'Repetir aprobación extendió dos veces la suscripción.');
      check((await api('/api/admin', admin.token, 'PATCH', { action: 'reject', paymentId: receiptId })).response.status === 409, 'Se cambió un pago previamente aprobado.');
      let paidUntil = approved.body.business.subscription.currentPeriodEndsAt;
      for (const plan of [
        { id: 'fortnightly', days: 15, amount: ownerBilling.body.settings.fortnightlyPriceCOP },
        { id: 'monthly', days: 30, amount: ownerBilling.body.settings.monthlyPriceCOP },
      ]) {
        const renewal = await api<{ receipt: PaymentReceipt }>('/api/billing', owner.token, 'POST', { ...uploadInput, planId: plan.id, requestId: requestId(plan.id) });
        check(renewal.response.status === 201 && renewal.body.receipt.planId === plan.id && renewal.body.receipt.periodDays === plan.days && renewal.body.receipt.amountCOP === plan.amount, 'La renovación no conserva su plan y precio.');
        const approval = await api<{ business: Business }>('/api/admin', admin.token, 'PATCH', { action: 'approve', paymentId: renewal.body.receipt.id });
        check(approval.response.ok && approval.body.business.subscription.currentPeriodEndsAt === paidUntil + plan.days * 86400000, 'La renovación no suma los días contratados al acceso vigente.');
        paidUntil = approval.body.business.subscription.currentPeriodEndsAt;
      }
      const reactivated = await createAppointment(client.decoded, fixture.businessId, { ...booking, startTimeStr: '09:00' }, requestId('reactivated'), db);
      check(reactivated.status === 'confirmed', 'No se pudo reservar después de reactivar.');
      check(isDeepStrictEqual((await db.doc(`users/${LOCAL_SUPERADMIN_UID}`).get()).data(), adminProfileBefore), 'El ensayo modificó el perfil del administrador sembrado.');
      console.log(`Fase 5 OK: revisión administrativa, reactivación, aprobación idempotente. ${checks} comprobaciones verificadas.`);
    } finally {
      try {
        if (claimedRun) {
          const rows = await ownDocuments();
          await cleanupOwnedDocuments(rows, fixture, async path => { await db.doc(path).delete(); });
          if (addedBank) await db.runTransaction(async transaction => {
            const ref = db.doc('platformSettings/main'); const snapshot = await transaction.get(ref);
            if (!snapshot.exists) return;
            const removal = removeJourneyBank(snapshot.data()!, fixture.bank, createdSettings);
            if (removal.action === 'delete') transaction.delete(ref);
            else if (removal.action === 'update') transaction.update(ref, { bankAccounts: removal.bankAccounts });
          });
          for (const uid of createdAccounts) if (!await missingUser(uid)) await auth.deleteUser(uid);
          assert.equal((await ownDocuments()).length, 0, 'La limpieza dejó documentos sintéticos.');
          for (const uid of createdAccounts) assert.ok(await missingUser(uid), 'La limpieza dejó una cuenta sintética.');
          if (addedBank) assert.ok(!(await db.doc('platformSettings/main').get()).data()?.bankAccounts?.some((account: { id: string }) => account.id === fixture.bank.id), 'La limpieza dejó la cuenta bancaria sintética.');
          console.log('Limpieza OK: documentos, cuentas y banco sintéticos retirados; datos manuales, admin local y Vault preservados.');
        }
      } catch (error) { cleanupFailure = error; }
      await closeAdmin(db);
      if (cleanupFailure) throw cleanupFailure;
    }
  }, 240000);
});

async function closeAdmin(db: Firestore) {
  await db.terminate();
  const app = getApps().find(value => value.name === 'sarin-admin');
  if (app) await deleteApp(app);
}
