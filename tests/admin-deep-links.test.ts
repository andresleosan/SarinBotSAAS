import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryFirestore } from './memoryFirestore';

const state = vi.hoisted(() => ({ db: undefined as unknown, verify: vi.fn() }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => state.db, getAdminAuth: () => ({ verifyIdToken: state.verify }) }));
import { GET } from '@/app/api/admin/route';

const request = (query = '', token = 'admin-token') => new Request(`https://local.invalid/api/admin${query}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
const receipt = (id: string, submittedAt = 1) => ({ id, tenantId: 'business', tenantName: 'Negocio de prueba', ownerUid: 'synthetic-owner', ownerEmail: 'synthetic@example.test', bankSelected: 'Banco de prueba', amountCOP: 19000, status: 'pending', submittedAt });
beforeEach(() => {
  state.db = memoryFirestore().db;
  state.verify.mockReset().mockImplementation(async token => ({ uid: token === 'admin-token' ? 'admin' : 'ordinary' }));
  vi.stubEnv('SUPERADMIN_UID', 'admin');
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('No network is expected'); }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('administrator payment deep links', () => {
  it('authorizes focused reads before accessing database records', async () => {
    state.db = { collection() { throw new Error('Unauthorized database read'); } };
    expect((await GET(request('?focusPayment=old-payment', ''))).status).toBe(401);
    expect((await GET(request('?focusPayment=old-payment', 'ordinary-token'))).status).toBe(403);
  });

  it.each(['?focusPayment=', '?focusPayment=../payment', '?focusPayment=one&focusPayment=two'])('rejects invalid or ambiguous focused payment ids: %s', async query => {
    state.db = { collection() { throw new Error('Invalid input reached storage'); } };
    expect((await GET(request(query))).status).toBe(400);
  });

  it('includes a payment outside the first 500 records without exposing its image or mutating data', async () => {
    const rows: Record<string, Record<string, unknown>> = { 'paymentReceipts/old-payment': { ...receipt('old-payment'), receiptDataUrl: 'private-image-data', receiptImageUrl: 'https://private.invalid/image' } };
    for (let index = 0; index < 500; index++) rows[`paymentReceipts/new-${index}`] = receipt(`new-${index}`, 100 + index);
    const store = memoryFirestore(rows); state.db = store.db;
    const before = structuredClone([...store.rows]);
    const response = await GET(request('?focusPayment=old-payment'));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const data = await response.json();
    expect(data.receipts).toHaveLength(501);
    expect(data.receipts.find((item: { id: string }) => item.id === 'old-payment')).toEqual(receipt('old-payment'));
    expect(JSON.stringify(data)).not.toMatch(/private-image-data|private\.invalid|receiptDataUrl|receiptImageUrl/);
    expect([...store.rows]).toEqual(before);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns 404 when the focused payment no longer exists', async () => {
    expect((await GET(request('?focusPayment=deleted-payment'))).status).toBe(404);
  });

  it('keeps a payment already loaded only once', async () => {
    state.db = memoryFirestore({ 'paymentReceipts/present-payment': receipt('present-payment') }).db;
    const data = await (await GET(request('?focusPayment=present-payment'))).json();
    expect(data.receipts).toHaveLength(1);
    expect(data.receipts[0].id).toBe('present-payment');
  });

  it('preserves the existing authorized receipt image read', async () => {
    state.db = memoryFirestore({ 'paymentReceipts/present-payment': receipt('present-payment'), 'paymentImages/present-payment': { receiptDataUrl: 'synthetic-image' } }).db;
    const response = await GET(request('?receiptId=present-payment'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ receiptDataUrl: 'synthetic-image' });
  });
});
