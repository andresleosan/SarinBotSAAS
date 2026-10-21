import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryFirestore } from './memoryFirestore';
import type { Business } from '@/types/firestore';

const state = vi.hoisted(() => ({ db: undefined as unknown, verify: vi.fn() }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => state.db, getAdminAuth: () => ({ verifyIdToken: state.verify }) }));
import { GET, POST } from '@/app/api/admin/copilot/route';

const now = Date.UTC(2026, 9, 17, 15);
const day = 86_400_000;
function business(id = 'alpha', changes: Partial<Business> = {}): Business {
  return { id, slug: id, name: `Negocio ${id}`, ownerUid: 'private-owner', ownerEmail: 'private@example.test', category: 'Servicios', phoneWhatsApp: '+573001234567', timezone: 'America/Bogota', subscription: { status: 'active', trialEndsAt: 0, currentPeriodEndsAt: now + 2 * day }, sarinConfig: { onboardingCompleted: true, tone: 'private-tone', customRules: 'private-rules', intakeFields: [] }, resources: [], services: [], weeklySchedule: {}, createdAt: now - day, ...changes };
}
function fixture(): Record<string, Record<string, unknown>> {
  return {
    'businesses/alpha': { ...business() },
    'businesses/beta': { ...business('beta', { subscription: { status: 'active', trialEndsAt: 0, currentPeriodEndsAt: now + 20 * day } }) },
    'responseQuotaScopes/business_alpha': { initializedAt: now - day },
    'responseQuotaScopes/business_alpha/periods/current': { id: 'current', source: 'subscription', planId: 'monthly', startsAt: now - day, endsAt: now + 2 * day, includedResponses: 3000, extraResponses: 0, usedResponses: 2500, reservedResponses: 0 },
    'paymentReceipts/payment-alpha': { id: 'payment-alpha', tenantId: 'alpha', tenantName: 'Negocio alpha', ownerUid: 'private-owner', ownerEmail: 'private@example.test', bankSelected: 'private-bank', receiptDataUrl: 'private-image', rejectionReason: 'private-reason', amountCOP: 19000, status: 'pending', submittedAt: now - 1000 },
    'serverSettings/ai': { provider: 'deepseek', updatedAt: now },
  };
}
const request = (method = 'GET', body?: unknown, query = '', token = 'admin-token') => new Request(`https://local.invalid/api/admin/copilot${query}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
const question = (requestId = 'request-0001') => ({ requestId, question: '¿Qué pagos tengo pendientes?' });
const answer = (reply = 'Hay un comprobante pendiente.', sourceIds = ['payment-payment-alpha']) => Response.json({ model: 'deepseek-flash', choices: [{ message: { role: 'assistant', content: JSON.stringify({ reply, sourceIds }) } }], usage: { prompt_tokens: 100, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 100, completion_tokens: 20, total_tokens: 120 } });

beforeEach(() => {
  state.db = memoryFirestore(fixture()).db;
  state.verify.mockReset().mockImplementation(async token => ({ uid: token === 'admin-token' ? 'admin' : 'ordinary' }));
  vi.spyOn(Date, 'now').mockReturnValue(now);
  vi.stubEnv('SUPERADMIN_UID', 'admin');
  vi.stubEnv('DEEPSEEK_API_KEY', 'synthetic-private-key');
  vi.stubEnv('DEEPSEEK_MODEL', 'deepseek-flash');
  vi.stubGlobal('fetch', vi.fn(async () => answer()));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('private administrator snapshot', () => {
  it.each(['GET', 'POST'])('authorizes %s before reading any data or invoking a provider', async method => {
    state.db = { collection() { throw new Error('An unauthorized database read occurred'); } };
    const handler = method === 'GET' ? GET : POST;
    expect((await handler(request(method, method === 'POST' ? question() : undefined, '', ''))).status).toBe(401);
    expect((await handler(request(method, method === 'POST' ? question() : undefined, '', 'ordinary-token'))).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('derives pending work from real data without inference, sensitive fields or any writes', async () => {
    const store = memoryFirestore(fixture()); state.db = store.db;
    const before = structuredClone([...store.rows]);
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const data = await response.json();
    expect(data).toMatchObject({ generatedAt: now, timeZone: 'America/Bogota', scopeBusinessId: null, metrics: { businesses: 2, pendingPayments: 1, quotaWarnings: 1, quotaExhausted: 0, expiringSubscriptions: 1 }, coverage: { businessesLoaded: 2, businessesTruncated: false, paymentsLoaded: 1, paymentsTruncated: false, allowancesUnavailable: 0 } });
    expect(data.sources).toContainEqual(expect.objectContaining({ id: 'payment-payment-alpha', href: '/admin?focusPayment=payment-alpha#payment-payment-alpha' }));
    expect(data.attention).toContainEqual(expect.objectContaining({ sourceId: 'business-alpha', kind: 'quota_warning' }));
    expect(JSON.stringify(data)).not.toMatch(/private-|private@|573001234567|ownerUid|ownerEmail|receiptDataUrl|customRules/);
    expect(fetch).not.toHaveBeenCalled();
    expect([...store.rows]).toEqual(before);
  });

  it('reports bounded coverage rather than presenting the first hundred records as global totals', async () => {
    const rows: Record<string, Record<string, unknown>> = {};
    for (let index = 0; index < 102; index++) {
      const id = `business-${index}`;
      rows[`businesses/${id}`] = business(id, { createdAt: now + index }) as unknown as Record<string, unknown>;
      rows[`paymentReceipts/payment-${index}`] = { id: `payment-${index}`, tenantId: id, tenantName: id, status: 'pending', submittedAt: now + index, amountCOP: 1000 };
    }
    state.db = memoryFirestore(rows).db;
    const data = await (await GET(request())).json();
    expect(data.businesses).toHaveLength(100);
    expect(data.metrics.businesses).toBe(100);
    expect(data.metrics.pendingPayments).toBe(100);
    expect(data.coverage).toMatchObject({ limit: 100, businessesTruncated: true, paymentsTruncated: true });
  });

  it('filters facts and payment queries to the selected business while retaining selector choices', async () => {
    const data = await (await GET(request('GET', undefined, '?businessId=beta'))).json();
    expect(data.scopeBusinessId).toBe('beta');
    expect(data.businesses).toHaveLength(2);
    expect(data.metrics).toMatchObject({ businesses: 1, pendingPayments: 0, quotaWarnings: 0, expiringSubscriptions: 0 });
    expect(data.sources.every((source: { businessId: string }) => source.businessId === 'beta')).toBe(true);
    expect(data.attention).toEqual([]);
  });

  it('surfaces unavailable quota without treating it as zero remaining', async () => {
    const rows = fixture(); rows['responseQuotaScopes/business_alpha/periods/current'].usedResponses = -1;
    state.db = memoryFirestore(rows).db;
    const data = await (await GET(request())).json();
    expect(data.coverage.allowancesUnavailable).toBe(1);
    expect(data.businesses.find((row: { id: string }) => row.id === 'alpha')).toMatchObject({ quotaState: 'unavailable', remainingResponses: null });
    expect(data.metrics.quotaExhausted).toBe(0);
    expect(data.attention).toContainEqual(expect.objectContaining({ kind: 'quota_unavailable' }));
  });

  it.each(['?businessId=missing', '?businessId=alpha&businessId=beta', '?unknown=x', '?businessId=../alpha'])('rejects invalid or unavailable scope %s', async query => {
    expect([400, 404]).toContain((await GET(request('GET', undefined, query))).status);
  });
});

describe('grounded read-only administrative questions', () => {
  it('uses the configured provider once, returns server-owned sources and meters only the administrator', async () => {
    const store = memoryFirestore(fixture()); state.db = store.db;
    const before = structuredClone([...store.rows]);
    const response = await POST(request('POST', question()));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toMatchObject({ reply: 'Hay un comprobante pendiente.', provider: 'deepseek' });
    expect(data.sources).toEqual([expect.objectContaining({ id: 'payment-payment-alpha', href: '/admin?focusPayment=payment-alpha#payment-payment-alpha' })]);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(url.toString()).toBe('https://api.deepseek.com/chat/completions');
    const payload = JSON.parse(options!.body as string);
    expect(payload.tools).toBeUndefined();
    expect(JSON.stringify(payload.messages)).not.toMatch(/private-|private@|573001234567/);
    for (const [path, row] of before) expect(store.rows.get(path)).toEqual(row);
    const added = [...store.rows].filter(([path]) => !before.some(([old]) => old === path));
    expect(added.some(([path]) => path.startsWith('responseQuotaTurns/'))).toBe(false);
    const ledger = added.find(([path]) => path.startsWith('aiUsageCalls/'));
    expect(ledger?.[1].data).toMatchObject({ businessId: null, mode: 'sarin_admin_copilot' });
    expect(JSON.stringify(added)).not.toContain(question().question);
    expect(JSON.stringify(added)).not.toContain(data.reply);
  });

  it('excludes other businesses from provider context when scoped', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => answer('El negocio no tiene pagos pendientes.', ['business-beta'])));
    const response = await POST(request('POST', { ...question(), businessId: 'beta' }));
    expect(response.status).toBe(200);
    const payload = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(JSON.stringify(payload.messages)).not.toContain('Negocio alpha');
    expect(JSON.stringify(payload.messages)).toContain('Negocio beta');
  });

  it.each([
    { ...question(), tools: ['approve_payment'] }, { ...question(), question: '' }, { ...question(), question: 'x'.repeat(2001) }, { ...question(), businessId: '../x' }, { ...question(), requestId: 'bad' },
  ])('rejects invalid input before any inference: %j', async body => {
    expect((await POST(request('POST', body))).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects invented sources, model-supplied links and unexpected tool calls without executing changes', async () => {
    for (const [index, result] of [answer('Texto', ['invented']), answer('Visita https://external.invalid', ['business-alpha']), Response.json({ choices: [{ message: { content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'approve_payment', arguments: '{}' } }] } }] })].entries()) {
      vi.stubGlobal('fetch', vi.fn(async () => result));
      const response = await POST(request('POST', question(`invalid-response-${index}`)));
      expect(response.status).toBe(502);
    }
  });

  it('does not infer twice for the same request identifier, including after a provider error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
    expect((await POST(request('POST', question()))).status).toBe(503);
    expect((await POST(request('POST', question()))).status).toBe(409);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('applies the durable minute limit across repeated calls without charging a tenant', async () => {
    for (let index = 0; index < 10; index++) expect((await POST(request('POST', question(`minute-${index.toString().padStart(3, '0')}`)))).status).toBe(200);
    expect((await POST(request('POST', question('minute-over-limit')))).status).toBe(429);
    expect(fetch).toHaveBeenCalledTimes(10);
  });

  it('keeps a daily limit even after minute windows expire', async () => {
    for (let index = 0; index < 60; index++) {
      vi.mocked(Date.now).mockReturnValue(now + index * 61_000);
      expect((await POST(request('POST', question(`daily-${index.toString().padStart(3, '0')}`)))).status).toBe(200);
    }
    expect((await POST(request('POST', question('daily-over-limit')))).status).toBe(429);
    expect(fetch).toHaveBeenCalledTimes(60);
  });
});
