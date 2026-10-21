import { describe, expect, it } from 'vitest';
import { isPlatformWhatsAppConnectionRecord as connectionGuard, isPlatformWhatsAppControlRecord as controlGuard, isPlatformWhatsAppConversationRecord as conversationGuard, isPlatformWhatsAppEventRecord as eventGuard, isPlatformWhatsAppStoredEvent as storedGuard, isPlatformWhatsAppAliasRecord, isPlatformWhatsAppConflictRecord, isPlatformWhatsAppScope, isPlatformWhatsAppCiphertext, PLATFORM_DIGEST_PATTERN as platformDigestPattern, PLATFORM_ID_PATTERN as platformIdPattern, PLATFORM_PHONE_PATTERN as platformPhonePattern } from '../shared/platform-whatsapp-records';

const identity = { version: 1, provider: 'ycloud', purpose: 'platform_support', wabaId: '12345', phoneE164: '+15550000001', phoneNumberId: '67890' };
const digest = 'a'.repeat(64);
const metadata = { ...identity, receivedAt: 2000, expiresAt: 2592002000 };
const cipher = { version: 1, iv: 'AAAAAAAAAAAAAAAA', tag: 'AAAAAAAAAAAAAAAAAAAAAA==', data: 'e30=' };
const connection = () => ({ ...identity, recordType: 'connection', connectionRevision: 0, providerConnection: 'unverified', paused: false, pausedReason: null, updatedAt: 0, connectedAt: null, connectedRevision: null, lastSignedInboundAt: null, lastHumanEchoAt: null, lastDeliveryAt: null });
const event = () => ({ ...metadata, recordType: 'event', state: 'body_present', connectionRevision: 1, conversationId: digest, kind: 'incoming_text', occurredAt: 1000, canonicalIdentity: digest, fingerprint: digest, bodyExpiresAt: 86401000, content: { ...cipher } });
const alias = () => ({ ...metadata, recordType: 'alias', state: 'metadata', canonicalEventId: 'event_' + digest, conversationId: digest, fingerprint: digest, bodyExpiresAt: 0 });
const conflict = () => ({ ...metadata, recordType: 'conflict', state: 'metadata', conversationId: digest, fingerprint: digest });
const control = () => ({ ...metadata, recordType: 'control', state: 'connection_control', updatedAt: 2000, actorUid: ' ', fingerprint: digest, action: 'pause', targetId: 'platform_whatsapp', resultRevision: 0 });
const conversation = () => ({ ...identity, recordType: 'conversation', state: 'body_present', mode: 'human', revision: 0, updatedAt: 0, lastInboundAt: null, lastHumanAt: null, bodyExpiresAt: 86401000, expiresAt: 0, previewOccurredAt: 1000, previewReceivedAt: 2000, canonicalIdentity: digest, contactContent: { ...cipher }, conflictAt: null });

describe('frozen platform record contracts', () => {
  it('accepts exact new inbound time keys while preserving legacy and echo shapes', () => {
    for (const customerSentAt of [null, 0, 2000]) expect(eventGuard({ ...event(), customerSentAt })).toBe(true);
    for (const customerSentAt of [-1, 1.5, 2001, undefined, '0']) expect(eventGuard({ ...event(), customerSentAt })).toBe(false);
    expect(eventGuard({ ...event(), kind: 'human_echo', customerSentAt: null })).toBe(false);
    expect(eventGuard({ ...event(), customerSentAt: null, extra: true })).toBe(false);
  });
  it('admits only bounded exact audio/choice disposition and ciphertext combinations', () => {
    const base = { ...event(), kind: 'incoming_audio', customerSentAt: null, ingressDisposition: 'descriptor_retained' };
    expect(eventGuard(base)).toBe(true); expect(eventGuard({ ...base, state: 'body_erased', content: null })).toBe(true);
    expect(eventGuard({ ...base, ingressDisposition: 'control_only' })).toBe(false);
    const denied = { ...base, state: 'body_erased', content: null, ingressDisposition: 'control_only' };
    expect(eventGuard(denied)).toBe(true); expect(eventGuard({ ...denied, kind: 'incoming_choice' })).toBe(true);
    expect(eventGuard({ ...base, kind: 'incoming_choice' })).toBe(false);
    expect(eventGuard({ ...denied, customerSentAt: undefined })).toBe(false);
    expect(eventGuard({ ...denied, audio: {} })).toBe(false);
    expect(eventGuard({ ...event(), ingressDisposition: 'control_only' })).toBe(false);
  });
  it('exposes the retained structural scope/ciphertext guards', () => {
    expect(isPlatformWhatsAppScope(identity)).toBe(true);
    expect(isPlatformWhatsAppScope({ ...identity, phoneNumberId: undefined })).toBe(false);
    expect(isPlatformWhatsAppCiphertext(cipher)).toBe(true);
    expect(isPlatformWhatsAppCiphertext({ ...cipher, extra: true })).toBe(false);
  });
  const variants = [
    ['connection', connection, connectionGuard], ['event', event, eventGuard], ['alias', alias, isPlatformWhatsAppAliasRecord],
    ['conflict', conflict, isPlatformWhatsAppConflictRecord], ['control', control, controlGuard], ['conversation', conversation, conversationGuard],
  ] as const;
  it.each(variants)('%s requires every field and rejects extra enumerable keys', (_, build, guard) => {
    const record = build();
    expect(guard(record)).toBe(true);
    expect(guard({ ...record, extra: null })).toBe(false);
    for (const key of Object.keys(record)) {
      const missing: Record<string, unknown> = { ...record };
      delete missing[key];
      expect(guard(missing), key).toBe(false);
    }
    expect(guard(Object.assign(Object.create({ inherited: true }), record))).toBe(true);
    expect(guard(Object.defineProperty({ ...record, [Symbol('extra')]: 1 }, 'hidden', { value: true }))).toBe(true);
    for (const invalid of [null, [], 1, 'record']) expect(guard(invalid)).toBe(false);
  });
  it('keeps exact numeric, phone and lowercase digest boundaries', () => {
    for (const value of ['12345', '1'.repeat(30)]) expect(platformIdPattern.test(value)).toBe(true);
    for (const value of ['1234', '1'.repeat(31), '12345\n', ' 12345', '１２３４５']) expect(platformIdPattern.test(value)).toBe(false);
    for (const value of ['+12345678', '+123456789012345']) expect(platformPhonePattern.test(value)).toBe(true);
    for (const value of ['+02345678', '+1234567', '+1234567890123456', '+12345678\n']) expect(platformPhonePattern.test(value)).toBe(false);
    expect(platformDigestPattern.test(digest)).toBe(true);
    for (const value of [digest.toUpperCase(), digest + '\n', digest.slice(1)]) expect(platformDigestPattern.test(value)).toBe(false);
  });
  it('enforces the published integer ceiling on revisions and nullable fields', () => {
    for (const value of [0, 8640000000000000]) {
      expect(connectionGuard({ ...connection(), connectionRevision: value, connectedAt: value })).toBe(true);
    }
    for (const value of [-1, 0.1, NaN, Infinity, 8640000000000001, '0', undefined]) {
      expect(connectionGuard({ ...connection(), connectionRevision: value })).toBe(false);
      expect(connectionGuard({ ...connection(), connectedAt: value })).toBe(false);
    }
    expect(connectionGuard({ ...connection(), lastDeliveryAt: 0 })).toBe(false);
  });
  it('requires disconnected pause/reason without inventing an inverse relation', () => {
    expect(connectionGuard({ ...connection(), providerConnection: 'disconnected' })).toBe(false);
    expect(connectionGuard({ ...connection(), providerConnection: 'disconnected', paused: true, pausedReason: 'manual' })).toBe(false);
    expect(connectionGuard({ ...connection(), providerConnection: 'disconnected', paused: true, pausedReason: 'disconnected' })).toBe(true);
    expect(connectionGuard({ ...connection(), providerConnection: 'connected', paused: false, pausedReason: 'disconnected' })).toBe(true);
  });
  it('applies metadata TTL and the minimum occurrence/receipt body TTL', () => {
    for (const build of [event, alias, conflict, control]) expect(storedGuard({ ...build(), expiresAt: 2592002001 })).toBe(false);
    expect(eventGuard({ ...event(), occurredAt: 3000, bodyExpiresAt: 86402000 })).toBe(true);
    expect(eventGuard({ ...event(), bodyExpiresAt: 86402000 })).toBe(false);
    expect(eventGuard({ ...event(), kind: 'human_echo' })).toBe(true);
    expect(eventGuard({ ...event(), kind: 'message_status' })).toBe(false);
    expect(storedGuard({ ...alias(), bodyExpiresAt: 8640000000000000 })).toBe(true);
    expect(storedGuard({ ...alias(), canonicalEventId: digest })).toBe(false);
  });
  it('keeps structural envelopes separate from authenticated/canonical decoding', () => {
    expect(eventGuard({ ...event(), state: 'body_erased', content: null })).toBe(true);
    expect(eventGuard({ ...event(), state: 'body_erased' })).toBe(false);
    expect(eventGuard({ ...event(), content: null })).toBe(false);
    // Noncanonical pad bits still satisfy the structural record guard.
    expect(eventGuard({ ...event(), content: { ...cipher, tag: 'A'.repeat(21) + 'B==', data: 'AB==' } })).toBe(true);
    for (const changed of [{ version: 2 }, { iv: 'A'.repeat(15) }, { tag: 'A'.repeat(24) }, { data: '' }, { data: 'AA-_' }, { data: 'A'.repeat(333340) }, { extra: true }]) {
      expect(eventGuard({ ...event(), content: { ...cipher, ...changed } })).toBe(false);
    }
    expect(eventGuard({ ...event(), content: { ...cipher, data: 'A'.repeat(333336) } })).toBe(true);
  });
  it('keeps connection and conversation control actions/targets distinct', () => {
    for (const action of ['pause', 'resume', 'disconnect', 'record_connected']) expect(controlGuard({ ...control(), action })).toBe(true);
    for (const action of ['human', 'review']) expect(controlGuard({ ...control(), state: 'conversation_control', targetId: digest, action })).toBe(true);
    for (const change of [{ updatedAt: 2001 }, { actorUid: '' }, { actorUid: 'a'.repeat(129) }, { action: 'human' }, { targetId: digest }, { state: 'conversation_control', targetId: digest, action: 'pause' }]) expect(controlGuard({ ...control(), ...change })).toBe(false);
    expect(controlGuard({ ...control(), actorUid: 'a'.repeat(128) })).toBe(true);
  });
  it('allows arbitrary valid conversation expiry but only human/review modes', () => {
    expect(conversationGuard({ ...conversation(), mode: 'review', expiresAt: 8640000000000000 })).toBe(true);
    expect(conversationGuard({ ...conversation(), mode: 'bot' })).toBe(false);
    expect(conversationGuard({ ...conversation(), previewOccurredAt: 3000, bodyExpiresAt: 86402000 })).toBe(true);
    expect(conversationGuard({ ...conversation(), bodyExpiresAt: 86402000 })).toBe(false);
    expect(conversationGuard({ ...conversation(), state: 'body_erased', contactContent: null })).toBe(true);
  });
  it('limits the stored-event union to canonical, alias, conflict and control', () => {
    for (const build of [event, alias, conflict, control]) expect(storedGuard(build())).toBe(true);
    for (const build of [connection, conversation]) expect(storedGuard(build())).toBe(false);
  });
});
