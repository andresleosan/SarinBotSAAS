import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPlatformYCloudClient } from '@/lib/server/platform-ycloud-client';
import { createPlatformMenu } from '../shared/platform-whatsapp-menu';
import { identity, now } from './platform-whatsapp-test-fixtures';
const fetcher = vi.fn();
const account = { id: identity.wabaId, accountReviewStatus: 'APPROVED', banState: 'REINSTATE', restrictions: [], paymentMethodAttached: true };
const phone = { id: identity.phoneNumberId, wabaId: identity.wabaId, phoneNumber: identity.phoneE164, status: 'CONNECTED' };
beforeEach(() => { vi.stubGlobal('fetch', fetcher); fetcher.mockReset(); vi.spyOn(Date, 'now').mockReturnValue(now); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const client = () => createPlatformYCloudClient({ scope: identity, apiKey: 'synthetic-key', sendEnabled: true });
it('observes exactly two fixed own-scope resources and uses local start time', async () => {
  fetcher.mockResolvedValueOnce(Response.json(account)).mockImplementationOnce(async () => { vi.mocked(Date.now).mockReturnValue(now + 999); return Response.json(phone); });
  expect(await client().readAccountConnection()).toEqual({ connected: true, observedAt: now });
  expect(fetcher.mock.calls.map(c => c[0])).toEqual(['https://api.ycloud.com/v2/whatsapp/businessAccounts/' + identity.wabaId, 'https://api.ycloud.com/v2/whatsapp/phoneNumbers/' + identity.wabaId + '/' + encodeURIComponent(identity.phoneE164)]);
  expect(fetcher.mock.calls.every(c => c[1].redirect === 'error' && c[1].headers['X-API-Key'] === 'synthetic-key')).toBe(true);
});
it('accepts current authenticated GET readiness when optional event-only fields are absent', async () => {
  fetcher.mockResolvedValueOnce(Response.json({ id: identity.wabaId, accountReviewStatus: 'APPROVED', paymentMethodAttached: true })).mockResolvedValueOnce(Response.json(phone));
  expect(await client().readAccountConnection()).toEqual({ connected: true, observedAt: now });
});
it.each([{ status: 'DISCONNECTED' }, { updateEvent: 'ACCOUNT_OFFBOARDED' }])('distinguishes proven disconnect %j', async change => {
  fetcher.mockResolvedValueOnce(Response.json(account)).mockResolvedValueOnce(Response.json({ ...phone, ...change }));
  expect(await client().readAccountConnection()).toEqual({ connected: false, observedAt: now });
});
it.each([
  { account: { removedReason: 'ACCOUNT_DISCONNECTED' }, phone: { status: 'DISCONNECTED' } },
  { account: { removedInitiatedBy: 'WHATSAPP_BUSINESS_APP' }, phone: { updateEvent: 'ACCOUNT_OFFBOARDED' } },
  { account: {}, phone: { status: 'DISCONNECTED', removedReason: 'UNKNOWN_OPTIONAL_METADATA' } },
])('preserves exact negative facts despite optional removal metadata without timestamp %#', async change => {
  fetcher.mockResolvedValueOnce(Response.json({ ...account, ...change.account })).mockResolvedValueOnce(Response.json({ ...phone, ...change.phone }));
  expect(await client().readAccountConnection()).toEqual({ connected: false, observedAt: now });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it('keeps removal metadata without a known negative fact indeterminate', async () => {
  fetcher.mockResolvedValueOnce(Response.json({ ...account, removedReason: 'ACCOUNT_DISCONNECTED' })).mockResolvedValueOnce(Response.json(phone));
  await expect(client().readAccountConnection()).rejects.toMatchObject({ code: 'PLATFORM_PROVIDER_UNKNOWN' });
});
it.each([{ id: 'foreign' }, { status: 'UNKNOWN' }, { updateEvent: 'UNKNOWN' }, { phoneNumber: undefined }])('rejects indeterminate phone %j', async change => {
  fetcher.mockResolvedValueOnce(Response.json(account)).mockResolvedValueOnce(Response.json({ ...phone, ...change }));
  await expect(client().readAccountConnection()).rejects.toMatchObject({ code: 'PLATFORM_PROVIDER_UNKNOWN' });
});
it.each([{ paymentMethodAttached: false }, { restrictions: null }, { restrictions: ['restricted'] }, { banState: 'UNKNOWN' }, { accountReviewStatus: 'PENDING' }])('closes positive readiness for %j', async change => {
  fetcher.mockResolvedValueOnce(Response.json({ ...account, ...change })).mockResolvedValueOnce(Response.json(phone));
  await expect(client().readAccountConnection()).rejects.toMatchObject({ code: 'PLATFORM_PROVIDER_UNKNOWN' });
});
it('never converts 404 into disconnect or retries', async () => {
  fetcher.mockResolvedValue(new Response('{}', { status: 404 }));
  await expect(client().readAccountConnection()).rejects.toThrow(); expect(fetcher).toHaveBeenCalledTimes(1);
});
it.each(['accepted', 'failed', 'unknown'])('dispatches one bounded interactive message and handles %s', async status => {
  const id = '00000000-0000-4000-8000-000000000008', input = { to: '+12025550123', text: 'Soporte', buttons: createPlatformMenu(id, 'reply'), externalId: id, signal: new AbortController().signal };
  fetcher.mockResolvedValue(Response.json({ id: 'synthetic-message', status }));
  expect((await client().sendButtons(input)).status).toBe(status === 'failed' ? 'rejected' : status);
  expect(fetcher).toHaveBeenCalledTimes(1); expect(fetcher.mock.calls[0][0]).toBe('https://api.ycloud.com/v2/whatsapp/messages/sendDirectly');
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ from: identity.phoneE164, to: input.to, type: 'interactive', externalId: id, interactive: { type: 'button', body: { text: input.text }, action: { buttons: input.buttons.map(reply => ({ type: 'reply', reply })) } } });
});
it('aborts before dispatch with zero calls and treats postdispatch timeout as unknown', async () => {
  const id = '00000000-0000-4000-8000-000000000008', controller = new AbortController(), input = { to: '+12025550123', text: 'Soporte', buttons: createPlatformMenu(id, 'reply'), externalId: id, signal: controller.signal };
  controller.abort(); expect(await client().sendButtons(input)).toEqual({ status: 'cancelled' }); expect(fetcher).not.toHaveBeenCalled();
  fetcher.mockRejectedValue(new DOMException('timeout', 'AbortError'));
  expect(await client().sendButtons({ ...input, signal: new AbortController().signal })).toEqual({ status: 'unknown' }); expect(fetcher).toHaveBeenCalledTimes(1);
});
