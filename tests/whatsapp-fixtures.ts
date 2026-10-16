import { vi } from 'vitest';
export const phoneId = '100001';
export const wabaId = '200001';
export const businessId = 'business_a';
export const sender = '573001112233';
export function syntheticWhatsAppEnv() {
  vi.stubEnv('WHATSAPP_ENABLED', 'true');
  vi.stubEnv('WHATSAPP_RETENTION_ENABLED', 'true');
  vi.stubEnv('WHATSAPP_GRAPH_API_VERSION', 'v25.0');
  vi.stubEnv('WHATSAPP_APP_SECRET', 'synthetic-app-secret');
  vi.stubEnv('WHATSAPP_VERIFY_TOKEN', 'synthetic-verify-token');
  vi.stubEnv('WHATSAPP_CONTENT_KEY', Buffer.alloc(32, 7).toString('base64'));
  vi.stubEnv('WHATSAPP_PHONE_CREDENTIALS_JSON', JSON.stringify({ [phoneId]: { wabaId, accessToken: 'synthetic-token' } }));
}
export function whatsappRows() {
  return {
    [`businesses/${businessId}`]: { id: businessId },
    [`whatsappNumbers/${phoneId}`]: { businessId, phoneNumberId: phoneId, wabaId, enabled: true, verifiedAt: 1, updatedAt: 1 },
    [`whatsappBusinesses/${businessId}`]: { phoneNumberId: phoneId },
  };
}
export function inbound(wamid = 'wamid.synthetic-one', timestamp = Date.now()) {
  return { object: 'whatsapp_business_account', entry: [{ id: wabaId, changes: [{ field: 'messages', value: {
    messaging_product: 'whatsapp', metadata: { phone_number_id: phoneId }, contacts: [{ wa_id: sender, profile: { name: 'Synthetic Customer' } }],
    messages: [{ id: wamid, from: sender, timestamp: String(Math.floor(timestamp / 1000)), type: 'text', text: { body: 'Reserva sintética' } }],
  } }] }] };
}
