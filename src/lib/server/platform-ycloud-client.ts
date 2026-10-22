import 'server-only';
import { isPlatformWhatsAppScope, PLATFORM_PHONE_PATTERN, type PlatformWhatsAppScope } from '../../../shared/platform-whatsapp-records';
import { workText, workUuid, type DeliveryResult } from '../../../shared/platform-whatsapp-work';
import { parsePlatformMenuChoice } from '../../../shared/platform-whatsapp-menu';
import { HttpError } from './http';

const unavailable = () => new HttpError(503, 'La observación de YCloud no está disponible.', 'PLATFORM_PROVIDER_UNKNOWN');
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
async function json(response: Response, signal: AbortSignal): Promise<Record<string, unknown>> {
  const reader = response.body?.getReader(); if (!reader) throw unavailable();
  let bytes = 0; const chunks: Uint8Array[] = [];
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    for (;;) { signal.throwIfAborted(); const r = await reader.read(); if (r.done) break; bytes += r.value.length; if (bytes > 131072) throw unavailable(); chunks.push(r.value); }
    signal.throwIfAborted();
    const all = new Uint8Array(bytes); let offset = 0; for (const c of chunks) { all.set(c, offset); offset += c.length; }
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(all));
    if (!object(value)) throw unavailable(); return value;
  } finally { signal.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export function createPlatformYCloudClient(config: { scope: PlatformWhatsAppScope; apiKey: string; sendEnabled: boolean }) {
  const scope = { ...config.scope };
  if (!isPlatformWhatsAppScope(scope) || !/^[\x21-\x7e]{1,4096}$/.test(config.apiKey)) throw unavailable();
  const headers = { 'X-API-Key': config.apiKey, 'Content-Type': 'application/json', Accept: 'application/json' };
  const request = (path: string, signal: AbortSignal, body?: string) => fetch('https://api.ycloud.com/v2' + path, { method: body === undefined ? 'GET' : 'POST', headers, signal, cache: 'no-store', redirect: 'error', ...(body === undefined ? {} : { body }) });
  return {
    async readAccountConnection(): Promise<{ connected: boolean; observedAt: number }> {
      const observedAt = Date.now(), signal = AbortSignal.timeout(10000);
      const accountResponse = await request('/whatsapp/businessAccounts/' + encodeURIComponent(scope.wabaId), signal);
      if (!accountResponse.ok) { await accountResponse.body?.cancel(); throw unavailable(); }
      const account = await json(accountResponse, signal);
      const phoneResponse = await request('/whatsapp/phoneNumbers/' + encodeURIComponent(scope.wabaId) + '/' + encodeURIComponent(scope.phoneE164), signal);
      if (!phoneResponse.ok) { await phoneResponse.body?.cancel(); throw unavailable(); }
      const phone = await json(phoneResponse, signal);
      if (account.id !== scope.wabaId || phone.id !== scope.phoneNumberId || phone.wabaId !== scope.wabaId || phone.phoneNumber !== scope.phoneE164) throw unavailable();
      if (['PARTNER_REMOVED', 'PARTNER_APP_UNINSTALLED'].includes(String(account.updateEvent)) || typeof account.removedTime === 'string' && Number.isFinite(Date.parse(account.removedTime))) return { connected: false, observedAt };
      if (['removedTime', 'removedReason', 'removedInitiatedBy'].some(k => account[k] !== undefined || phone[k] !== undefined)) throw unavailable();
      if (phone.status === 'DISCONNECTED' || phone.updateEvent === 'ACCOUNT_OFFBOARDED') return { connected: false, observedAt };
      if (phone.status !== 'CONNECTED' || phone.updateEvent !== undefined && phone.updateEvent !== 'ACCOUNT_RECONNECTED' || account.accountReviewStatus !== 'APPROVED' || account.banState !== 'REINSTATE' || account.paymentMethodAttached !== true || !Array.isArray(account.restrictions) || account.restrictions.length) throw unavailable();
      return { connected: true, observedAt };
    },
    async sendButtons(input: { to: string; text: string; buttons: Array<{ id: string; title: string }>; externalId: string; signal: AbortSignal }): Promise<DeliveryResult> {
      if (input.signal.aborted) return { status: 'cancelled' };
      if (!config.sendEnabled || !PLATFORM_PHONE_PATTERN.test(input.to) || input.to === scope.phoneE164 || !workText(input.text, 'reply') || !workUuid(input.externalId) || input.buttons.length < 1 || input.buttons.length > 3 || new Set(input.buttons.map(b => b.id)).size !== input.buttons.length || new Set(input.buttons.map(b => b.title)).size !== input.buttons.length || input.buttons.some(b => !parsePlatformMenuChoice(b.id) || !b.id.endsWith(':' + input.externalId) || Buffer.byteLength(b.id, 'utf8') > 256 || !workText(b.title, 'reply') || b.title.length > 20 || /[*_~`]/.test(b.title))) return { status: 'cancelled' };
      const body = JSON.stringify({ from: scope.phoneE164, to: input.to, type: 'interactive', externalId: input.externalId, interactive: { type: 'button', body: { text: input.text }, action: { buttons: input.buttons.map(reply => ({ type: 'reply', reply })) } } });
      const signal = AbortSignal.any([input.signal, AbortSignal.timeout(15000)]);
      try {
        signal.throwIfAborted();
        const response = await request('/whatsapp/messages/sendDirectly', signal, body), value = await json(response, signal);
        if (!response.ok) return { status: 'unknown' };
        if (!workText(value.id, 'provider') || ['wabaId', 'from', 'to', 'externalId'].some(k => value[k] !== undefined && value[k] !== ({ wabaId: scope.wabaId, from: scope.phoneE164, to: input.to, externalId: input.externalId } as Record<string, string>)[k])) return { status: 'unknown' };
        if (value.status === 'failed') return { status: 'rejected' };
        if (value.status !== undefined && !['accepted', 'sent', 'delivered', 'read'].includes(String(value.status))) return { status: 'unknown' };
        return { status: 'accepted', providerId: value.id };
      } catch { return { status: 'unknown' }; }
    },
  };
}
